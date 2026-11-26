import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "socket.io";
import {
  AI_CONFIG,
  resolveAiModelConfig,
  resolveAiModelConfigForSlot,
  resolveLabDefaultSeatModels,
  type AiModelConfig,
} from "../ai/aiConfig.js";
import {
  SILICONFLOW_ALL_MODEL_IDS,
  SILICONFLOW_DEFAULT_BASE_URL,
  SILICONFLOW_MODEL_GROUPS,
} from "./siliconflowModels.js";
import { askAiJson, type AiLlmResult } from "../ai/llmClient.js";
import { STARTING_WEALTH } from "../config/startingWealth.js";
import { eraCards } from "../data/game_data.js";
import {
  getLeadingBidOnFocus,
  getLotCurrentBid,
  getMinimumNextBid,
  hammerAuctionLot,
  markAuctionCardPassed,
  endAuctionSession,
  findNextAutoAuctionCard,
  placeAuctionBid,
  playerAvailableWealth,
  voidOpenBidsOnCard,
} from "../logic/auctionCards.js";
import { useBuffCard, useForceBuyCard } from "../logic/buffLogic.js";
import {
  createCustomChatGroup,
  ensurePublicChatGroup,
  sendGroupChatMessage,
} from "../logic/chatGroups.js";
import { COFFEE_WEALTH_COST, purchaseCoffee } from "../logic/coffeeLogic.js";
import { applyRoundEnergy } from "../logic/energySchedule.js";
import { maskForbiddenText, normalizeNoteInput, sanitizeTransactionNote } from "../logic/forbiddenText.js";
import { applyInvestments, sanitizeInvestments } from "../logic/investmentLogic.js";
import {
  acceptLotteryOffer,
  createRandomLotteryOffer,
  settleAllPendingLotteryOffers,
} from "../logic/lotteryDraw.js";
import { resolvePendingTransfer } from "../logic/transferResolve.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { getGameIo } from "../network/gameIo.js";
import { clearActionDeadline } from "../state/actionDeadline.js";
import { sanitizeCommunityName } from "../state/communityLeaderboard.js";
import { finalizeCommunityName } from "../state/communityNaming.js";
import { togglePlayerReady } from "../state/gameActions.js";
import {
  createInitialGame,
  getCommunityNamer,
  type GameState,
  type LabAgentDecision,
  type LabDirectMessage,
  type LabInteractionMode,
  type LabThinkingMode,
  type Player,
  type Transaction,
} from "../state/gameState.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { appendSessionEvent, ensureSessionStarted } from "../state/sessionTelemetry.js";
import { rooms } from "../state/store.js";
import { computeWealthRanks } from "../util/playerRank.js";
import { buildLabSessionExport, buildLabSessionQc } from "./labExport.js";
import { LabAgentMemory } from "./labMemory.js";
import { askMockLabLlm } from "./labMockLlm.js";
import {
  buildLabAuctionPrompt,
  buildLabChatPrompt,
  buildLabCommunityNamePrompt,
  buildLabInvestmentPrompt,
  buildLabPredictionPrompt,
  buildLabSystemPrompt,
  buildLabTransactionPrompt,
  computeLabPromptHash,
  DEFAULT_LAB_BEHAVIOR_PROMPTS,
  LAB_PROMPT_VERSION,
  summarizeLabGroupChats,
  type LabObservation,
} from "./labPrompts.js";
import { deriveSeed, normalizeSeed, Rng, shuffleWithGameRng } from "./labRng.js";
import { getLabRunById, saveLabRun, saveLabSession } from "./labStore.js";
import type {
  LabLiveStatus,
  LabRunManifest,
  LabRunRecord,
  LabSessionRecord,
  LabStartParams,
} from "./labTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_MEMORY_ROOT = path.resolve(__dirname, "../../data/lab_memory");

const MAX_PUBLIC_CHAT_PER_ROUND = 6;
const MAX_PRIVATE_CHAT_PER_ROUND = 6;
const AUCTION_MAX_WEALTH_RATIO = 0.35;
export const AUCTION_MAX_DECISIONS_PER_LOT = 2;
export const LAB_AUCTION_ROUND_MS = 10_000;
export const LAB_AUCTION_LOT_MAX_MS = 22_000;

export class LabFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabFatalError";
  }
}

export class LabStoppedError extends Error {
  constructor(message = "实验已被手动停止") {
    super(message);
    this.name = "LabStoppedError";
  }
}

export class LabCallExpiredError extends Error {
  constructor(message = "单拍决策已超时截断") {
    super(message);
    this.name = "LabCallExpiredError";
  }
}

export type LabActionBudgetKind =
  | "investment"
  | "prediction"
  | "chat"
  | "auction"
  | "transaction"
  | "community_name";

export interface LabActionCallBudget {
  thinkingBudget: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export function getLabActionBudget(
  kind: LabActionBudgetKind = "investment",
  thinkingMode: LabThinkingMode = "moderate"
): LabActionCallBudget {
  if (thinkingMode === "fast") {
    switch (kind) {
      case "investment":
        return { thinkingBudget: 0, maxOutputTokens: 1600, timeoutMs: 20_000 };
      case "prediction":
      case "chat":
        return { thinkingBudget: 0, maxOutputTokens: 900, timeoutMs: 15_000 };
      case "auction":
      case "transaction":
      case "community_name":
        return { thinkingBudget: 0, maxOutputTokens: 600, timeoutMs: 12_000 };
    }
  }
  if (thinkingMode === "deep") {
    switch (kind) {
      case "investment":
        return { thinkingBudget: 3072, maxOutputTokens: 5000, timeoutMs: 55_000 };
      case "prediction":
      case "chat":
        return { thinkingBudget: 1536, maxOutputTokens: 3000, timeoutMs: 35_000 };
      case "auction":
      case "transaction":
      case "community_name":
        return { thinkingBudget: 1024, maxOutputTokens: 2000, timeoutMs: 25_000 };
    }
  }
  switch (kind) {
    case "investment":
      return { thinkingBudget: 1024, maxOutputTokens: 2400, timeoutMs: 30_000 };
    case "prediction":
    case "chat":
      return { thinkingBudget: 512, maxOutputTokens: 1200, timeoutMs: 20_000 };
    case "auction":
    case "transaction":
    case "community_name":
      return { thinkingBudget: 384, maxOutputTokens: 900, timeoutMs: 15_000 };
  }
}

interface ActiveLabContext {
  runId: string;
  manifest: LabRunManifest;
  startedAt: number;
  currentGameIndex: number;
  completedGames: number;
  failedGames: number;
  roomId: string | null;
  sessionIds: string[];
  abortController: AbortController;
  stopReason: string | null;
}

let activeContext: ActiveLabContext | null = null;
let lastPromptHash: string | null = null;
let onRoomListChanged: ((io: Server) => void) | null = null;

export function setLabRoomListNotifier(fn: (io: Server) => void): void {
  onRoomListChanged = fn;
}

function notifyRoomList(): void {
  const io = getGameIo();
  if (io && onRoomListChanged) onRoomListChanged(io);
}

export interface LabAuctionBidResult {
  player: Player;
  decision: {
    action: "bid" | "pass" | "force_buy";
    amount?: number;
    reasoning: string;
  };
  rawThinking?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs?: number;
}

export function applyLabAuctionWave(options: {
  game: GameState;
  focus: string;
  bidResults: LabAuctionBidResult[];
  lotHardDeadline: number;
  passedOnCard: Set<string>;
  memories?: Map<string, LabAgentMemory>;
  nowMs?: () => number;
}): { anyAction: boolean; forcedSold: boolean } {
  const { game, focus, bidResults, lotHardDeadline, passedOnCard, memories, nowMs } = options;
  const now = nowMs ?? Date.now;
  let anyAction = false;
  let forcedSold = false;

  // 按种子随机打乱同波次并发出价的结算顺序，避免靠前座位天然抢占低价
  const shuffled = shuffleWithGameRng(game, bidResults);

  for (const { player, decision, rawThinking, usage, latencyMs } of shuffled) {
    if (game.auctionFocusCardId !== focus || now() > lotHardDeadline) break;
    recordLabDecision(
      game,
      player,
      "auction",
      decision.reasoning,
      { cardId: focus, ...decision },
      usage,
      latencyMs,
      rawThinking
    );
    const mem = memories?.get(player.id);
    if (decision.action === "force_buy" && player.inventory.includes("buff_force_buy")) {
      const fb = useForceBuyCard(game, player.id);
      if (fb.success) {
        forcedSold = true;
        anyAction = true;
        game.autoHostNextActionAt = undefined;
        mem?.record("action", `拍卖 ${focus}：使用强买强卖`, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
        break;
      }
    }
    if (decision.action === "bid") {
      const currentLeading = getLeadingBidOnFocus(game)?.playerId;
      if (currentLeading !== player.id) {
        const minNext = getMinimumNextBid(game);
        const maxBid = Math.max(
          0,
          Math.floor(playerAvailableWealth(game, player) * AUCTION_MAX_WEALTH_RATIO)
        );
        const amount = decision.amount;
        if (
          typeof amount === "number" &&
          Number.isSafeInteger(amount) &&
          amount >= minNext &&
          amount <= maxBid &&
          game.auctionFocusCardId === focus &&
          now() <= lotHardDeadline
        ) {
          const bidRes = placeAuctionBid(game, player.id, amount);
          if (bidRes.ok) {
            anyAction = true;
            game.autoHostNextActionAt = Math.min(lotHardDeadline, now() + LAB_AUCTION_ROUND_MS);
            mem?.record("action", `拍卖 ${focus}：出价 ${amount}`, {
              globalRound: game.globalRound,
              era: game.currentEra,
              roundInEra: game.roundInEra,
            });
          } else {
            passedOnCard.add(player.id);
          }
        } else if (
          typeof amount !== "number" ||
          !Number.isSafeInteger(amount) ||
          amount > maxBid ||
          minNext > maxBid
        ) {
          // 严禁把 AI 的出价强行抬升到 minNext；超上限或非法出价直接弃权
          passedOnCard.add(player.id);
        }
      }
    } else {
      passedOnCard.add(player.id);
    }
  }

  return { anyAction, forcedSold };
}

export function settleLabAuctionLot(
  game: GameState,
  focus: string,
  forcedSold: boolean
): "forced_sold" | "sold" | "passed" {
  game.autoHostNextActionAt = undefined;
  if (forcedSold) {
    game.auctionFocusCardId = undefined;
    game.auctionFocusSetAt = undefined;
    return "forced_sold";
  }
  if (game.auctionFocusCardId === focus) {
    const leading = getLeadingBidOnFocus(game);
    if (leading) {
      const hammered = hammerAuctionLot(game);
      if (hammered.ok) {
        game.auctionFocusCardId = undefined;
        game.auctionFocusSetAt = undefined;
        return "sold";
      }
    }
    voidOpenBidsOnCard(game, focus, "void_passed");
    markAuctionCardPassed(game, focus);
    game.logs.push(`⏭️ 实验室拍卖跳过 [${focus}]（无人出价或最高出价者无法支付）`);
  }
  game.auctionFocusCardId = undefined;
  game.auctionFocusSetAt = undefined;
  return "passed";
}

function getPromptHash(): string {
  if (!lastPromptHash) lastPromptHash = computeLabPromptHash();
  return lastPromptHash;
}

function readGitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 产品版单局基准 token 上限（未设置小上限时按 100 万），
 * 实验室默认单局上限提高至 500 万 / AI / 局（或设为 0 表示不限额度），且支持研究员手动调节。
 */
export function getProductBaselineTokenBudget(): number {
  return AI_CONFIG.tokenBudgetPerGame > 0 ? AI_CONFIG.tokenBudgetPerGame : 1_000_000;
}

export function getDefaultLabTokenBudgetPerAgent(): number {
  return getProductBaselineTokenBudget() * 5;
}

export function getLabConfigSummary() {
  const shared = resolveAiModelConfig();
  const productBaseline = getProductBaselineTokenBudget();
  const defaultLabBudget = getDefaultLabTokenBudgetPerAgent();
  const defaultSeatModels = resolveLabDefaultSeatModels();
  const suggested = new Set<string>(SILICONFLOW_ALL_MODEL_IDS);
  if (shared?.model) suggested.add(shared.model);
  for (let slot = 1; slot <= 5; slot++) {
    const slotCfg = resolveAiModelConfigForSlot(slot);
    if (slotCfg?.model) suggested.add(slotCfg.model);
  }
  for (const m of defaultSeatModels) suggested.add(m);

  return {
    keyConfigured: shared !== null,
    provider: shared?.provider ?? "siliconflow(未填入密钥)",
    siliconflowBaseUrl: SILICONFLOW_DEFAULT_BASE_URL,
    defaultModel: shared?.model ?? defaultSeatModels[0],
    defaultSeatModels,
    modelPoolGroups: SILICONFLOW_MODEL_GROUPS,
    suggestedModels: Array.from(suggested),
    temperature: AI_CONFIG.temperature,
    productTokenBudgetPerAgent: productBaseline,
    defaultLabTokenBudgetPerAgent: defaultLabBudget,
    minTokenBudgetPerAgent: 0,
    maxTokenBudgetPerAgent: 100_000_000,
    promptVersion: LAB_PROMPT_VERSION,
    promptHash: getPromptHash(),
    defaultBehaviorPrompts: DEFAULT_LAB_BEHAVIOR_PROMPTS,
    activeRun: getLabLiveStatus(),
  };
}

export async function runLabPreflight(models: string[]) {
  const shared = resolveAiModelConfig();
  if (!shared) {
    return {
      ok: false,
      error: "服务端尚未配置共享模型密钥（AI_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）",
      results: [] as Array<{ model: string; ok: boolean; latencyMs: number; error?: string }>,
    };
  }
  const uniqueModels = Array.from(new Set(models.map((m) => m.trim()).filter(Boolean)));
  if (uniqueModels.length === 0) uniqueModels.push(shared.model);

  const results = await Promise.all(
    uniqueModels.map(async (model) => {
      const cfg: AiModelConfig = {
        ...shared,
        model,
      };
      const started = Date.now();
      const res = await askAiJson(
        "你是连通性检测助手，只输出 JSON。",
        '请只回复 {"ok":true}',
        {
          config: cfg,
          timeoutMs: 25_000,
          maxRetries: 0,
          maxOutputTokens: 64,
          disableThinking: true,
          label: `lab-preflight-${model}`,
        }
      );
      return {
        model,
        ok: res.ok,
        latencyMs: res.latencyMs || Date.now() - started,
        ...(res.ok ? {} : { error: res.error || "调用失败" }),
      };
    })
  );

  return {
    ok: results.every((r) => r.ok),
    results,
  };
}

export function getLabLiveStatus(): LabLiveStatus {
  if (!activeContext) {
    return {
      running: false,
      runId: null,
      condition: null,
      name: null,
      roomId: null,
      currentGameIndex: 0,
      totalGames: 0,
      completedGames: 0,
      startedAt: null,
      elapsedMs: 0,
      phase: null,
      currentEra: 0,
      roundInEra: 0,
      globalRound: 0,
      mock: false,
      tokenBudgetPerAgent: getDefaultLabTokenBudgetPerAgent(),
      seats: [],
      recentLogs: [],
    };
  }
  const game = activeContext.roomId ? rooms[activeContext.roomId] : undefined;
  const usage = game?.labTokenUsage ?? {};
  const turnStatuses = game?.aiTurnStatuses ?? {};
  return {
    running: true,
    runId: activeContext.runId,
    condition: activeContext.manifest.condition,
    name: activeContext.manifest.name,
    roomId: activeContext.roomId,
    currentGameIndex: activeContext.currentGameIndex,
    totalGames: activeContext.manifest.games,
    completedGames: activeContext.completedGames,
    startedAt: activeContext.startedAt,
    elapsedMs: Date.now() - activeContext.startedAt,
    phase: game?.phase ?? null,
    currentEra: game?.currentEra ?? 0,
    roundInEra: game?.roundInEra ?? 0,
    globalRound: game?.globalRound ?? 0,
    mock: activeContext.manifest.mock,
    tokenBudgetPerAgent: activeContext.manifest.tokenBudgetPerAgent,
    seats: (game?.players ?? []).map((p, idx) => ({
      agentIndex: p.agentIndex ?? idx + 1,
      playerId: p.id,
      name: p.name,
      model: p.agentModel ?? "",
      tokensUsed: usage[p.id] ?? 0,
      wealth: p.wealth,
      thinking: turnStatuses[p.id]?.state === "thinking",
    })),
    recentLogs: (game?.logs ?? []).slice(-12),
  };
}

export function stopActiveLabRun(reason = "管理员手动停止实验"): { ok: boolean; runId?: string } {
  if (!activeContext) return { ok: false };
  const ctx = activeContext;
  ctx.stopReason = reason;
  ctx.abortController.abort();
  if (ctx.roomId && rooms[ctx.roomId]) {
    const io = getGameIo();
    if (io) io.to(ctx.roomId).emit("roomDissolved");
  }
  return { ok: true, runId: ctx.runId };
}

function timestampForId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

function safeName(value: string): string {
  return String(value).replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 48) || "lab";
}

function makeRoomId(runId: string, gameIdx: number): string {
  const short = runId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 28) || "run";
  return `lab-${short}-g${gameIdx + 1}`.slice(0, 48);
}

function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new LabStoppedError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LabStoppedError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new LabStoppedError(activeContext?.stopReason || "实验已被手动停止");
}

function int(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function oneLine(text: unknown, max = 300): string {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function createAgentPlayer(
  seatIndex: number,
  model: string,
  provider: string
): Player {
  const id = randomBytes(15).toString("base64url");
  return {
    id,
    name: `玩家${seatIndex}`,
    connected: true,
    ready: false,
    energy: 15,
    wealth: STARTING_WEALTH,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    buffRoundNotes: [],
    slackedBy: [],
    coffeePurchasesThisRound: 0,
    totalEnergyConsumed: 0,
    wealthHistory: [STARTING_WEALTH],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    isAI: true,
    isAgent: true,
    agentIndex: seatIndex,
    agentModel: model,
    agentProvider: provider,
    aiModelLabel: `${provider}:${model}`,
  };
}

export function createSeededLabGame(options: {
  roomId: string;
  manifest: LabRunManifest;
  gameIndex: number;
  sessionOrdinal: number;
  seed: number;
}): GameState {
  const rng = new Rng(options.seed);
  const eraSequence = rng.shuffle([0, 1, 2, 3, 4]).slice(0, 4);
  const game = createInitialGame(options.roomId, []);
  game.isLabExperiment = true;
  game.autoHostEnabled = false;
  game.eraSequence = eraSequence;
  game.currentEraCard = eraCards.find((c) => c.id === eraSequence[0] + 1) || eraCards[0];
  game.labRngState = rng.rngState;
  game.labPredictions = [];
  game.labDirectMessages = [];
  game.labAgentDecisions = [];
  game.labTokenUsage = {};
  game.labMeta = {
    runId: options.manifest.runId,
    condition: options.manifest.condition,
    name: options.manifest.name,
    notes: options.manifest.notes,
    gameIndex: options.gameIndex,
    totalGames: options.manifest.games,
    seedBase: options.manifest.seedBase,
    seed: options.seed,
    sessionOrdinal: options.sessionOrdinal,
    chatEnabled: options.manifest.chatEnabled,
    memoryEnabled: options.manifest.memoryEnabled,
    predictionEnabled: options.manifest.predictionEnabled,
    autoSocialScore: options.manifest.autoSocialScore,
    mock: options.manifest.mock,
    tokenBudgetPerAgent: options.manifest.tokenBudgetPerAgent,
    interactionMode: options.manifest.interactionMode ?? "guided_two_step",
    thinkingMode: options.manifest.thinkingMode ?? "moderate",
    publicChatEnabled: options.manifest.publicChatEnabled !== false,
    privateChatEnabled: options.manifest.privateChatEnabled !== false,
    customGroupsEnabled: options.manifest.customGroupsEnabled !== false,
    transferEnabled: options.manifest.transferEnabled !== false,
    auctionEnabled: options.manifest.auctionEnabled !== false,
    buffCardsEnabled: options.manifest.buffCardsEnabled !== false,
    coffeeEnabled: options.manifest.coffeeEnabled !== false,
    ...(options.manifest.customSystemPrompt
      ? { customSystemPrompt: options.manifest.customSystemPrompt }
      : {}),
    promptVersion: options.manifest.promptVersion,
    promptHash: options.manifest.promptHash,
    gitCommit: options.manifest.gitCommit,
    models: options.manifest.models,
    providers: options.manifest.providers,
    startedAt: Date.now(),
  };

  for (let i = 0; i < 6; i++) {
    const model = options.manifest.models[i] || "unknown";
    const provider = options.manifest.providers[i] || "shared";
    const player = createAgentPlayer(i + 1, model, provider);
    game.players.push(player);
    game.labTokenUsage[player.id] = 0;
  }

  if (options.manifest.chatEnabled && options.manifest.publicChatEnabled !== false) {
    ensurePublicChatGroup(game);
    const pub = (game.chatGroups ?? []).find((g) => g.kind === "public");
    if (pub) pub.memberIds = game.players.map((p) => p.id);
  }

  return game;
}

export function buildLabObservation(game: GameState, playerId: string): LabObservation {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) throw new LabFatalError(`玩家 ${playerId} 不存在`);

  const ranks = computeWealthRanks(game.players);
  const players = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    wealth: p.wealth,
    rank: ranks.get(p.id) ?? p.rank ?? 0,
    energy: p.id === playerId ? p.energy : null,
    ready: p.ready === true,
    isMe: p.id === playerId,
    inventoryCount: p.inventory?.length ?? 0,
  }));

  const leader = [...players].sort((a, b) => b.wealth - a.wealth)[0] ?? null;
  const pending = (game.transactions ?? []).filter((t) => t.status === "pending");
  const myPending = pending.filter((t) => t.toId === playerId);
  const myOutgoing = pending.filter((t) => t.fromId === playerId && t.amount > 0);
  const myPendingOut = myOutgoing.reduce((s, t) => s + t.amount, 0);

  const publicGroup = (game.chatGroups ?? []).find((g) => g.kind === "public") ?? null;
  const publicMessages = publicGroup
    ? (game.groupMessages ?? []).filter((m) => m.groupId === publicGroup.id)
    : [];
  const privateMessages = (game.labDirectMessages ?? []).filter((m) => m.toId === playerId);
  const groupChats = summarizeLabGroupChats(
    game.chatGroups ?? [],
    playerId,
    game.groupMessages ?? []
  );

  // 盲视角结算回顾：仅含项目公开状态与「本人」投入/收益，绝不下发他人明细
  const mySettlementHistory = (game.sessionTelemetry?.settlementHistory ?? [])
    .slice(-3)
    .map((entry) => ({
      round: entry.round,
      currentEra: entry.currentEra,
      roundInEra: entry.roundInEra,
      projects: entry.results.map((r) => ({
        projectId: r.projectId,
        name: r.name,
        type: r.type,
        isCompleted: r.isCompleted,
        isExploded: r.isExploded,
        shortSold: r.shortSold,
        endGradient: r.endGradient,
        totalInvested: r.totalInvested,
        myInvested: r.playerInvestments?.[playerId] ?? 0,
        myGain: r.playerGains?.[playerId]?.total ?? 0,
      })),
    }));

  const auction = game.auctionFocusCardId
    ? {
        focusCardId: game.auctionFocusCardId,
        currentBid: getLotCurrentBid(game),
        minimumNextBid: getMinimumNextBid(game),
        highBidderId: getLeadingBidOnFocus(game)?.playerId ?? null,
        highBidderName: getLeadingBidOnFocus(game)?.playerName ?? null,
        soldCardIds: (game.auctionCompletedDeals ?? []).map((d) => d.cardId),
        distributedCardIds: game.auctionDistributedCardIds ?? [],
        bidHistory: (game.auctionBids ?? [])
          .filter((b) => b.cardId === game.auctionFocusCardId)
          .slice(-10)
          .map((b) => ({ playerName: b.playerName, amount: b.amount })),
      }
    : null;

  return {
    phase: game.phase,
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    serverNow: Date.now(),
    me: {
      id: me.id,
      name: me.name,
      energy: Number(me.energy ?? 0),
      wealth: me.wealth,
      rank: ranks.get(me.id) ?? me.rank ?? 0,
      ready: me.ready === true,
      inventory: [...(me.inventory ?? [])],
      usedCards: [...(me.usedCards ?? [])],
      coffeePurchases: me.coffeePurchasesThisRound ?? 0,
      investment: { ...(me.investment ?? {}) },
      pendingOut: myPendingOut,
    },
    players,
    projects: game.activeProjects.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      maxEnergy: p.maxEnergy,
      currentInvested: p.currentInvested,
      accumulatedInvested: p.accumulatedInvested,
      myAccumulatedInvested: p.investorRecords?.[playerId] ?? 0,
      rankRewards: p.rankRewards,
      overInvestPenalty: p.overInvestPenalty,
      rate: p.rate,
      era: p.era,
      roundsNoInvestment: p.roundsNoInvestment,
      investedThisRound: p.investedThisRound,
    })),
    eraCard: game.currentEraCard
      ? {
          id: game.currentEraCard.id,
          name: game.currentEraCard.name,
          era: game.currentEraCard.era,
          description: game.currentEraCard.description,
        }
      : null,
    currencyLeader: leader ? leader.name : null,
    myPendingTransactions: myPending,
    myOutgoingTransactions: myOutgoing,
    publicMessages,
    privateMessages,
    groupChats,
    publicGroupId: publicGroup?.id ?? null,
    mySettlementHistory,
    auction,
    recentLogs: (game.publicFeed ?? []).slice(-10).map((f) => f.text),
  };
}

interface ChatMessageInput {
  channel?: string;
  toPlayerId?: string;
  text?: string;
}

interface ChatPlanFields {
  reasoning?: string;
  messages?: ChatMessageInput[];
  groupMessages?: Array<{ groupId?: string; text?: string }>;
  createGroup?: { name?: string; memberIds?: string[] } | null;
}

interface InvestmentPlan extends ChatPlanFields {
  transfer?: { toPlayerId?: string; amount?: number; note?: string } | null;
  coffee?: number;
  useCard?: {
    cardId?: string;
    targetPlayerId?: string;
    targetProjectId?: number;
    burnCardId?: string;
    burnFromInventory?: boolean;
  } | null;
  investment: Record<string, number>;
}

function applyLabChatPlan(options: {
  game: GameState;
  player: Player;
  plan: ChatPlanFields;
  mem: LabAgentMemory;
  counters: { pubUsed: number; privUsed: number };
  allowCreateGroup: boolean;
  allowPublic?: boolean;
  allowPrivate?: boolean;
  allowGroupMessages?: boolean;
  maxMessagesThisStep: number;
}): void {
  const {
    game,
    player,
    plan,
    mem,
    counters,
    allowCreateGroup,
    allowPublic = true,
    allowPrivate = true,
    allowGroupMessages = true,
    maxMessagesThisStep,
  } = options;

  if (allowCreateGroup && plan.createGroup && Array.isArray(plan.createGroup.memberIds)) {
    const memberIds = plan.createGroup.memberIds.filter(
      (id) => id !== player.id && game.players.some((x) => x.id === id)
    );
    if (memberIds.length >= 2) {
      const cg = createCustomChatGroup(game, player.id, memberIds, plan.createGroup.name);
      if (cg.ok) {
        mem.record("action", `创建群聊「${cg.group.name}」`, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
      }
    }
  }

  const pubGroup = (game.chatGroups ?? []).find((g) => g.kind === "public");
  for (const m of (plan.messages ?? []).slice(0, maxMessagesThisStep)) {
    if (!m || typeof m.text !== "string") continue;
    if (m.channel === "public" && allowPublic && pubGroup && counters.pubUsed < MAX_PUBLIC_CHAT_PER_ROUND) {
      const sent = sendGroupChatMessage(game, player.id, pubGroup.id, m.text, undefined, {
        allowAi: true,
      });
      if (sent.ok) {
        counters.pubUsed += 1;
        mem.record("chat", `[我·公开] ${sent.message.text}`, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
      }
    } else if (m.channel === "private" && allowPrivate && m.toPlayerId) {
      if (sendLabDirectMessage(game, player, m.toPlayerId, m.text, counters.privUsed)) {
        counters.privUsed += 1;
        const target = game.players.find((x) => x.id === m.toPlayerId);
        mem.record("chat", `[我·私聊→${target?.name ?? m.toPlayerId}] ${oneLine(m.text, 220)}`, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
      }
    }
  }

  if (allowGroupMessages) {
    for (const gm of (plan.groupMessages ?? []).slice(0, 3)) {
      if (!gm?.groupId || typeof gm.text !== "string") continue;
      const sent = sendGroupChatMessage(game, player.id, gm.groupId, gm.text, undefined, {
        allowAi: true,
      });
      if (sent.ok) {
        mem.record("chat", `[我·群聊] ${sent.message.text}`, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
      }
    }
  }
}

function cleanRawThinking(rawThinking?: string): string | undefined {
  const cleaned = String(rawThinking ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 24_000);
  return cleaned || undefined;
}

function recordLabDecision(
  game: GameState,
  player: Player,
  kind: LabAgentDecision["kind"],
  reasoning: string,
  action: unknown,
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number },
  latencyMs?: number,
  rawThinking?: string
): void {
  if (!game.labAgentDecisions) game.labAgentDecisions = [];
  const preservedThinking = cleanRawThinking(rawThinking);
  game.labAgentDecisions.push({
    id: `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    phase: game.phase,
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    playerId: player.id,
    playerName: player.name,
    kind,
    model: player.agentModel,
    reasoning: oneLine(reasoning, 1200),
    ...(preservedThinking ? { rawThinking: preservedThinking } : {}),
    action,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    totalTokens: usage?.totalTokens,
    latencyMs,
  });
  if (game.labAgentDecisions.length > 2000) {
    game.labAgentDecisions = game.labAgentDecisions.slice(-2000);
  }
}

function setTurnStatus(
  game: GameState,
  player: Player,
  state: "thinking" | "idle",
  io: Server | null
): void {
  if (!game.aiTurnStatuses) game.aiTurnStatuses = {};
  game.aiTurnStatuses[player.id] = { state, phase: game.phase, updatedAt: Date.now() };
  if (io) broadcastUpdate(io, game);
}

export async function askAgentWithValidation<T>(options: {
  game: GameState;
  player: Player;
  manifest: LabRunManifest;
  sharedConfig: AiModelConfig | null;
  label: string;
  userPrompt: string;
  validate: (data: unknown) => T | null;
  signal: AbortSignal;
  io: Server | null;
  budgetKind?: LabActionBudgetKind;
  callSignal?: AbortSignal;
  llmCaller?: typeof askAiJson;
}): Promise<{
  value: T;
  rawThinking?: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  latencyMs: number;
}> {
  const {
    game,
    player,
    manifest,
    sharedConfig,
    label,
    userPrompt,
    validate,
    signal,
    io,
    budgetKind = "investment",
    callSignal,
    llmCaller = askAiJson,
  } = options;
  ensureNotAborted(signal);
  if (callSignal?.aborted) {
    throw new LabCallExpiredError(`${player.name} 在 ${label} 超出本拍时限`);
  }
  if (!game.labTokenUsage) game.labTokenUsage = {};
  const budget = manifest.tokenBudgetPerAgent;
  const usedBefore = game.labTokenUsage[player.id] ?? 0;
  if (budget > 0 && usedBefore >= budget) {
    throw new LabFatalError(
      `${player.name}（${player.agentModel}）单局消耗 ${usedBefore} 已达到上限 ${budget}`
    );
  }

  const thinkingMode = manifest.thinkingMode ?? "moderate";
  const actionBudget = getLabActionBudget(budgetKind, thinkingMode);
  // 非拍卖阶段给足真实推理与首字等待窗口（拍卖保持 15s 紧限，避免拖慢拍品节奏）
  const effectiveTimeoutMs =
    budgetKind === "auction"
      ? actionBudget.timeoutMs
      : budgetKind === "investment"
        ? Math.max(actionBudget.timeoutMs, 65_000)
        : Math.max(actionBudget.timeoutMs, 60_000);
  const effectiveMaxOutputTokens =
    budgetKind === "auction"
      ? actionBudget.maxOutputTokens
      : budgetKind === "investment"
        ? Math.max(actionBudget.maxOutputTokens, 4096)
        : Math.max(actionBudget.maxOutputTokens, 2400);
  const fastRetryTimeoutMs = budgetKind === "auction" ? 15_000 : 55_000;
  const combinedController = new AbortController();
  const onRunAbort = () => combinedController.abort();
  const onCallAbort = () => combinedController.abort();
  if (signal.aborted || callSignal?.aborted) combinedController.abort();
  signal.addEventListener("abort", onRunAbort, { once: true });
  callSignal?.addEventListener("abort", onCallAbort, { once: true });

  const systemPrompt = buildLabSystemPrompt(player.agentIndex ?? 1, player.name, {
    interactionMode: manifest.interactionMode,
    customSystemPrompt: manifest.customSystemPrompt,
  });
  let prompt = userPrompt;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalLatencyMs = 0;
  const thinkingChunks: string[] = [];
  let fastRetryNoThinking = thinkingMode === "fast" || actionBudget.thinkingBudget <= 0;
  let hadTransportRetry = false;
  let transportRetries = 0;
  let maxAttempts = 2;

  setTurnStatus(game, player, "thinking", io);
  try {
    // 6 名真实 AI 同毫秒并发建连硅基流动易触发瞬时 Connection error，轻微错峰 150ms/席（拍卖除外）
    if (!manifest.mock && llmCaller === askAiJson && budgetKind !== "auction") {
      const seatOffsetMs = (Math.max(1, player.agentIndex ?? 1) - 1) * 150;
      if (seatOffsetMs > 0) {
        await sleepAbortable(seatOffsetMs, combinedController.signal).catch(() => {
          if (signal.aborted) throw new LabStoppedError();
          throw new LabCallExpiredError(`${player.name} 在 ${label} 超出本拍时限`);
        });
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      ensureNotAborted(signal);
      if (callSignal?.aborted) {
        throw new LabCallExpiredError(`${player.name} 在 ${label} 超出本拍时限`);
      }
      let res: AiLlmResult;
      if (manifest.mock) {
        res = askMockLabLlm(systemPrompt, prompt);
      } else {
        if (!sharedConfig) {
          throw new LabFatalError("服务端未配置共享模型密钥，无法执行真实大模型实验");
        }
        const seatCfg: AiModelConfig = {
          ...sharedConfig,
          model: player.agentModel || sharedConfig.model,
          provider: player.agentProvider || sharedConfig.provider,
        };
        res = await llmCaller(
          systemPrompt,
          prompt,
          fastRetryNoThinking
            ? {
                config: seatCfg,
                timeoutMs: fastRetryTimeoutMs,
                maxRetries: 1,
                maxOutputTokens: effectiveMaxOutputTokens,
                disableThinking: true,
                label: `${player.name}:${label}:fast`,
                signal: combinedController.signal,
              }
            : {
                config: seatCfg,
                timeoutMs: effectiveTimeoutMs,
                maxRetries: 0,
                maxOutputTokens: effectiveMaxOutputTokens,
                disableThinking: false,
                thinkingBudget: actionBudget.thinkingBudget,
                label: `${player.name}:${label}`,
                signal: combinedController.signal,
              }
        );
      }
      ensureNotAborted(signal);
      if (callSignal?.aborted) {
        throw new LabCallExpiredError(`${player.name} 在 ${label} 超出本拍时限`);
      }

      totalLatencyMs += res.latencyMs ?? 0;
      if (res.rawThinking?.trim()) {
        thinkingChunks.push(res.rawThinking.trim());
      }
      if (res.usage) {
        totalPromptTokens += res.usage.promptTokens;
        totalCompletionTokens += res.usage.completionTokens;
        totalTokens += res.usage.totalTokens;
        const nextUsed = (game.labTokenUsage[player.id] ?? 0) + res.usage.totalTokens;
        game.labTokenUsage[player.id] = nextUsed;
        if (budget > 0 && nextUsed > budget) {
          throw new LabFatalError(
            `${player.name}（${player.agentModel}）单局消耗 ${nextUsed} 超出上限 ${budget}`
          );
        }
      }

      if (!res.ok) {
        const isJsonParseError = /JSON\s*解析失败/i.test(res.error ?? "");
        const isTimeoutLike = /timeout|timed out|aborted|empty response|terminated/i.test(
          res.error ?? ""
        );
        const isTransientNet = /429|500|502|503|504|connection error|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|hang up/i.test(
          res.error ?? ""
        );
        if (isJsonParseError && attempt < Math.max(maxAttempts, 3)) {
          if (attempt >= 2) fastRetryNoThinking = true;
          maxAttempts = Math.max(maxAttempts, 3);
          prompt = `${userPrompt}\n\n注意：上一次回复不是完整合法的 JSON，请务必只输出一个完整的 JSON 对象（不要多余文字、不要在字符串中直接换行）。`;
          continue;
        }
        if (!manifest.mock && !hadTransportRetry && (isTimeoutLike || isTransientNet)) {
          if (isTimeoutLike) fastRetryNoThinking = true;
          hadTransportRetry = true;
          transportRetries += 1;
          maxAttempts = Math.max(maxAttempts, attempt + 2);
          if (!manifest.mock && llmCaller === askAiJson && isTransientNet) {
            await sleepAbortable(400, combinedController.signal).catch(() => {});
          }
          continue;
        }
        if (!manifest.mock && llmCaller === askAiJson && transportRetries < 2 && isTransientNet) {
          transportRetries += 1;
          maxAttempts = Math.min(4, maxAttempts + 1);
          await sleepAbortable(600, combinedController.signal).catch(() => {});
          continue;
        }
        throw new LabFatalError(
          `${player.name}（${player.agentModel}）在 ${label} 调用失败：${res.error || "未知错误"}`
        );
      }

      const validated = validate(res.data);
      if (validated != null) {
        const mergedThinking = thinkingChunks.join("\n\n").trim();
        return {
          value: validated,
          rawThinking: cleanRawThinking(mergedThinking),
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens,
          },
          latencyMs: totalLatencyMs,
        };
      }
      prompt = `${userPrompt}\n\n注意：上一次输出缺少必要字段或取值不合法，请严格按照要求输出单个合法 JSON 对象。`;
    }
    throw new LabFatalError(
      `${player.name}（${player.agentModel}）在 ${label} 连续输出语义校验失败`
    );
  } finally {
    signal.removeEventListener("abort", onRunAbort);
    callSignal?.removeEventListener("abort", onCallAbort);
    setTurnStatus(game, player, "idle", io);
  }
}

function sendLabDirectMessage(
  game: GameState,
  sender: Player,
  toId: string,
  rawText: unknown,
  usedThisRound: number
): boolean {
  if (usedThisRound >= MAX_PRIVATE_CHAT_PER_ROUND) return false;
  const receiver = game.players.find((p) => p.id === toId && p.id !== sender.id);
  if (!receiver) return false;
  const trimmed = normalizeNoteInput(rawText);
  if (!trimmed) return false;
  const safeText = maskForbiddenText(sanitizeTransactionNote(trimmed).slice(0, 300));
  if (!game.labDirectMessages) game.labDirectMessages = [];
  game.labDirectMessages.push({
    id: `dm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    fromId: sender.id,
    fromName: sender.name,
    toId: receiver.id,
    toName: receiver.name,
    text: safeText,
    timestamp: Date.now(),
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
  });
  return true;
}

async function resolveIncomingTransfers(options: {
  game: GameState;
  memories: Map<string, LabAgentMemory>;
  manifest: LabRunManifest;
  sharedConfig: AiModelConfig | null;
  signal: AbortSignal;
  io: Server | null;
}): Promise<void> {
  const { game, memories, manifest, sharedConfig, signal, io } = options;
  const pending = (game.transactions ?? []).filter((t) => t.status === "pending" && t.amount > 0);
  if (pending.length === 0) return;

  await Promise.all(
    pending.map(async (tx) => {
      const receiver = game.players.find((p) => p.id === tx.toId);
      if (!receiver) return;
      const obs = buildLabObservation(game, receiver.id);
      const mem = memories.get(receiver.id)!;
      const res = await askAgentWithValidation<{ decision: "accept" | "reject"; reasoning: string }>({
        game,
        player: receiver,
        manifest,
        sharedConfig,
        label: `tx-${tx.id.slice(0, 6)}`,
        userPrompt: buildLabTransactionPrompt(obs, tx, mem.digest()),
        validate: (data) => {
          if (!data || typeof data !== "object") return null;
          const d = (data as { decision?: unknown }).decision;
          if (d !== "accept" && d !== "reject") return null;
          return {
            decision: d,
            reasoning: String((data as { reasoning?: unknown }).reasoning ?? ""),
          };
        },
        signal,
        io,
        budgetKind: "transaction",
      });
      resolvePendingTransfer(game, tx.id, receiver.id, res.value.decision === "accept");
      recordLabDecision(
        game,
        receiver,
        "transaction",
        res.value.reasoning,
        { txId: tx.id, fromName: tx.fromName, amount: tx.amount, decision: res.value.decision },
        res.usage,
        res.latencyMs,
        res.rawThinking
      );
      mem.record(
        "transfer",
        `收到 ${tx.fromName} 转账 ${tx.amount}（备注：${oneLine(tx.note, 80) || "无"}），我${res.value.decision === "accept" ? "接受" : "拒绝"}了`,
        { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
      );
    })
  );
  if (io) broadcastUpdate(io, game);
}

function ingestRoundChatsIntoMemories(
  game: GameState,
  memories: Map<string, LabAgentMemory>,
  seenPublic: Set<string>,
  seenDm: Set<string>
): void {
  const groupLabels = new Map(
    (game.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "公开" : `群聊·${g.name}`])
  );
  for (const m of game.groupMessages ?? []) {
    if (seenPublic.has(m.id)) continue;
    seenPublic.add(m.id);
    const group = (game.chatGroups ?? []).find((g) => g.id === m.groupId);
    const label = groupLabels.get(m.groupId) ?? "群聊";
    for (const p of game.players) {
      if (p.id === m.fromId) continue;
      if (group && group.kind === "custom" && !group.memberIds.includes(p.id)) continue;
      memories.get(p.id)?.record("chat", `[${label}] ${m.fromName}: ${oneLine(m.text, 220)}`, {
        globalRound: game.globalRound,
        era: game.currentEra,
        roundInEra: game.roundInEra,
      });
    }
  }
  for (const dm of game.labDirectMessages ?? []) {
    if (seenDm.has(dm.id)) continue;
    seenDm.add(dm.id);
    memories.get(dm.toId)?.record("chat", `[私聊] ${dm.fromName} → 你: ${oneLine(dm.text, 220)}`, {
      globalRound: game.globalRound,
      era: game.currentEra,
      roundInEra: game.roundInEra,
    });
  }
}

async function runSingleLabGame(options: {
  ctx: ActiveLabContext;
  gameIndex: number;
  sessionOrdinal: number;
  seed: number;
  sharedConfig: AiModelConfig | null;
}): Promise<LabSessionRecord> {
  const { ctx, gameIndex, sessionOrdinal, seed, sharedConfig } = options;
  const { manifest, abortController } = ctx;
  const signal = abortController.signal;
  const io = getGameIo();
  const roomId = makeRoomId(manifest.runId, gameIndex);
  ctx.roomId = roomId;

  const game = createSeededLabGame({
    roomId,
    manifest,
    gameIndex,
    sessionOrdinal,
    seed,
  });
  rooms[roomId] = game;
  ensureSessionStarted(game);
  applyRoundEnergy(game, { relock: true });
  game.phase = "ERA_INTRO";
  game.logs.push(
    `🧪 6AI 实验第 ${gameIndex + 1}/${manifest.games} 局开始（条件：${manifest.condition}，种子：${seed}）`
  );
  notifyRoomList();
  if (io) broadcastUpdate(io, game);

  const memories = new Map<string, LabAgentMemory>();
  const runMemDir = path.join(DATA_MEMORY_ROOT, safeName(manifest.runId));
  for (const p of game.players) {
    const mem = new LabAgentMemory(p.agentIndex ?? 1, runMemDir, manifest.memoryEnabled);
    mem.beginSession(game.sessionId || roomId);
    memories.set(p.id, mem);
  }

  const seenPublicMsgs = new Set<string>();
  const seenDmMsgs = new Set<string>();
  const recordedSettlementRounds = new Set<number>();
  const predictionSentForEra = new Set<number>();

  const stepPauseMs = (realMs: number, mockMs: number) =>
    sleepAbortable(manifest.mock ? mockMs : realMs, signal);

  let failureReason: string | undefined;
  let finalStatus: LabSessionRecord["status"] = "completed";

  try {
    while ((game.phase as string) !== "GAME_OVER") {
      ensureNotAborted(signal);

      if (game.phase === "ERA_INTRO") {
        if (manifest.predictionEnabled && !predictionSentForEra.has(game.currentEra)) {
          predictionSentForEra.add(game.currentEra);
          const allIds = game.players.map((p) => p.id);
          await Promise.all(
            game.players.map(async (p) => {
              const obs = buildLabObservation(game, p.id);
              const mem = memories.get(p.id)!;
              const res = await askAgentWithValidation<{ ranking: string[]; reasoning: string }>({
                game,
                player: p,
                manifest,
                sharedConfig,
                label: `era${game.currentEra}-prediction`,
                userPrompt: buildLabPredictionPrompt(obs, mem.digest()),
                validate: (data) => {
                  if (!data || typeof data !== "object") return null;
                  const raw = (data as { ranking?: unknown }).ranking;
                  if (!Array.isArray(raw)) return null;
                  const byName = new Map(game.players.map((x) => [x.name, x.id]));
                  const ranking = raw
                    .map((v) => (typeof v === "string" ? byName.get(v) ?? v : ""))
                    .filter((v): v is string => !!v);
                  if (
                    ranking.length !== allIds.length ||
                    new Set(ranking).size !== ranking.length ||
                    ranking.some((id) => !allIds.includes(id))
                  ) {
                    return null;
                  }
                  return {
                    ranking,
                    reasoning: String((data as { reasoning?: unknown }).reasoning ?? ""),
                  };
                },
                signal,
                io,
                budgetKind: "prediction",
              });
              if (!game.labPredictions) game.labPredictions = [];
              game.labPredictions.push({
                id: `pred-${Date.now().toString(36)}-${p.agentIndex ?? 0}`,
                playerId: p.id,
                playerName: p.name,
                era: game.currentEra,
                globalRound: game.globalRound,
                ranking: res.value.ranking,
                reasoning: oneLine(res.value.reasoning, 400),
                model: p.agentModel,
                timestamp: Date.now(),
              });
              recordLabDecision(
                game,
                p,
                "prediction",
                res.value.reasoning,
                { ranking: res.value.ranking },
                res.usage,
                res.latencyMs,
                res.rawThinking
              );
              const names = res.value.ranking
                .map((id) => game.players.find((x) => x.id === id)?.name ?? id)
                .join(" > ");
              mem.record("prediction", `时代 ${game.currentEra} 预测最终排名：${names}`, {
                globalRound: game.globalRound,
                era: game.currentEra,
                roundInEra: game.roundInEra,
              });
            })
          );
        }
        for (const p of game.players) togglePlayerReady(game, p.id);
        tryAdvancePhase(game);
        if (io) broadcastUpdate(io, game);
        await stepPauseMs(400, 20);
        continue;
      }

      if (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE") {
        const allowTransfer = manifest.transferEnabled !== false;
        const allowBuffCards = manifest.buffCardsEnabled !== false;
        const allowCoffee = manifest.coffeeEnabled !== false;
        const allowPublic = manifest.chatEnabled && manifest.publicChatEnabled !== false;
        const allowPrivate = manifest.chatEnabled && manifest.privateChatEnabled !== false;
        const allowGroups = manifest.chatEnabled && manifest.customGroupsEnabled !== false;
        const anyChatAllowed = allowPublic || allowPrivate || allowGroups;
        const interactionMode = manifest.interactionMode ?? "guided_two_step";
        const promptFlags = {
          interactionMode,
          publicChatEnabled: allowPublic,
          privateChatEnabled: allowPrivate,
          customGroupsEnabled: allowGroups,
          transferEnabled: allowTransfer,
          buffCardsEnabled: allowBuffCards,
          coffeeEnabled: allowCoffee,
        };

        if (allowTransfer) {
          await resolveIncomingTransfers({ game, memories, manifest, sharedConfig, signal, io });
        }
        ingestRoundChatsIntoMemories(game, memories, seenPublicMsgs, seenDmMsgs);

        const roundChatCounters = new Map<string, { pubUsed: number; privUsed: number }>();
        for (const p of game.players) {
          roundChatCounters.set(p.id, { pubUsed: 0, privUsed: 0 });
        }

        // 先聊后投模式（引导温和或自由语气）执行同轮两步闭环；彻底放手一步直出时直接走第二步
        if (anyChatAllowed && interactionMode !== "free_one_step") {
          const chatPlans = await Promise.all(
            game.players.map(async (p) => {
              const obs = buildLabObservation(game, p.id);
              const mem = memories.get(p.id)!;
              const res = await askAgentWithValidation<ChatPlanFields>({
                game,
                player: p,
                manifest,
                sharedConfig,
                label: `r${game.globalRound}-chat`,
                userPrompt: buildLabChatPrompt(obs, mem.digest(), promptFlags),
                validate: (data) => {
                  if (!data || typeof data !== "object") return null;
                  const raw = data as Partial<ChatPlanFields>;
                  if (
                    raw.messages !== undefined &&
                    !Array.isArray(raw.messages) &&
                    raw.groupMessages !== undefined &&
                    !Array.isArray(raw.groupMessages)
                  ) {
                    return null;
                  }
                  return {
                    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
                    messages: Array.isArray(raw.messages) ? raw.messages : [],
                    groupMessages: Array.isArray(raw.groupMessages) ? raw.groupMessages : [],
                    createGroup: raw.createGroup ?? null,
                  };
                },
                signal,
                io,
                budgetKind: "chat",
              });
              return {
                player: p,
                plan: res.value,
                rawThinking: res.rawThinking,
                usage: res.usage,
                latencyMs: res.latencyMs,
              };
            })
          );

          for (const { player, plan, rawThinking, usage, latencyMs } of chatPlans) {
            ensureNotAborted(signal);
            const mem = memories.get(player.id)!;
            const counters = roundChatCounters.get(player.id)!;
            applyLabChatPlan({
              game,
              player,
              plan,
              mem,
              counters,
              allowCreateGroup: allowGroups,
              allowPublic,
              allowPrivate,
              allowGroupMessages: allowGroups,
              maxMessagesThisStep: 3,
            });
            recordLabDecision(
              game,
              player,
              "chat",
              plan.reasoning ?? "",
              {
                messages: plan.messages ?? [],
                groupMessages: plan.groupMessages ?? [],
                createGroup: plan.createGroup ?? null,
              },
              usage,
              latencyMs,
              rawThinking
            );
          }

          ingestRoundChatsIntoMemories(game, memories, seenPublicMsgs, seenDmMsgs);
          if (io) broadcastUpdate(io, game);
          await stepPauseMs(350, 15);
        }

        // 请求 6 名 AI 给出完整行动方案，再按顺序严格校验并写入状态
        const plans = await Promise.all(
          game.players.map(async (p) => {
            const obs = buildLabObservation(game, p.id);
            const mem = memories.get(p.id)!;
            const res = await askAgentWithValidation<InvestmentPlan>({
              game,
              player: p,
              manifest,
              sharedConfig,
              label: `r${game.globalRound}-investment`,
              userPrompt: buildLabInvestmentPrompt(obs, mem.digest(), anyChatAllowed, promptFlags),
              validate: (data) => {
                if (!data || typeof data !== "object") return null;
                const raw = data as Partial<InvestmentPlan>;
                if (!raw.investment || typeof raw.investment !== "object") return null;
                return {
                  reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
                  messages: Array.isArray(raw.messages) ? raw.messages : [],
                  groupMessages: Array.isArray(raw.groupMessages) ? raw.groupMessages : [],
                  createGroup: raw.createGroup ?? null,
                  transfer: raw.transfer ?? null,
                  coffee: int(raw.coffee) ?? 0,
                  useCard: raw.useCard ?? null,
                  investment: raw.investment,
                };
              },
              signal,
              io,
              budgetKind: "investment",
            });
            return {
              player: p,
              plan: res.value,
              rawThinking: res.rawThinking,
              usage: res.usage,
              latencyMs: res.latencyMs,
            };
          })
        );

        for (const { player, plan, rawThinking, usage, latencyMs } of plans) {
          ensureNotAborted(signal);
          const mem = memories.get(player.id)!;

          if (anyChatAllowed) {
            const counters = roundChatCounters.get(player.id)!;
            applyLabChatPlan({
              game,
              player,
              plan,
              mem,
              counters,
              allowCreateGroup: allowGroups && interactionMode === "free_one_step",
              allowPublic,
              allowPrivate,
              allowGroupMessages: allowGroups,
              maxMessagesThisStep: interactionMode === "free_one_step" ? 3 : 1,
            });
          }

          // 买咖啡（最多 3 杯，不超过可用财富；关闭时不执行）
          const avail = playerAvailableWealth(game, player);
          const maxCups = allowCoffee
            ? Math.min(3, Math.max(0, Math.floor(avail / COFFEE_WEALTH_COST)))
            : 0;
          const cups = Math.min(Math.max(0, int(plan.coffee) ?? 0), maxCups);
          for (let c = 0; c < cups; c++) {
            purchaseCoffee(game, player);
          }

          // 道具卡
          if (allowBuffCards && plan.useCard?.cardId && player.inventory.includes(plan.useCard.cardId)) {
            const c = plan.useCard;
            const cardId = c.cardId!;
            if (cardId === "buff_lottery") {
              const buffRes = useBuffCard(game, player.id, "buff_lottery", {});
              if (buffRes.success) {
                const drawn = await createRandomLotteryOffer(game, player.id);
                if (drawn.ok) acceptLotteryOffer(game, player.id, drawn.offer.offerId);
              }
            } else if (cardId !== "buff_force_buy") {
              useBuffCard(game, player.id, cardId, {
                targetPlayerId: c.targetPlayerId,
                targetProjectId: c.targetProjectId,
                burnCardId: c.burnCardId,
                burnFromInventory: c.burnFromInventory,
              });
            }
          }

          // 转账（amount > 0 才算真实转账）
          if (allowTransfer && plan.transfer && plan.transfer.toPlayerId) {
            const amount = int(plan.transfer.amount) ?? 0;
            const toPlayer = game.players.find(
              (x) => x.id === plan.transfer!.toPlayerId && x.id !== player.id
            );
            const txAvail = playerAvailableWealth(game, player);
            if (toPlayer && amount > 0 && amount <= txAvail) {
              const note = maskForbiddenText(
                sanitizeTransactionNote(normalizeNoteInput(plan.transfer.note ?? ""))
              );
              const tx: Transaction = {
                id: `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                fromId: player.id,
                fromName: player.name,
                toId: toPlayer.id,
                toName: toPlayer.name,
                amount,
                note,
                status: "pending",
                timestamp: Date.now(),
              };
              game.transactions.push(tx);
              appendSessionEvent(
                game,
                "transaction_created",
                {
                  txId: tx.id,
                  fromId: player.id,
                  toId: toPlayer.id,
                  amount,
                  note,
                },
                player.id
              );
            }
          }

          // 投资与锁定
          const sanitizedInvest = sanitizeInvestments(
            game,
            player,
            (plan.investment ?? {}) as Record<number, number>
          );
          applyInvestments(game, player.id, sanitizedInvest, "player");
          togglePlayerReady(game, player.id);

          recordLabDecision(
            game,
            player,
            "investment",
            plan.reasoning ?? "",
            {
              messages: plan.messages ?? [],
              groupMessages: plan.groupMessages ?? [],
              createGroup: plan.createGroup ?? null,
              transfer: allowTransfer ? (plan.transfer ?? null) : null,
              coffee: cups,
              useCard: allowBuffCards ? (plan.useCard ?? null) : null,
              investment: sanitizedInvest,
            },
            usage,
            latencyMs,
            rawThinking
          );
          mem.record(
            "action",
            `第 ${game.globalRound} 轮投资 ${JSON.stringify(sanitizedInvest)}` +
              (cups ? `；咖啡 ${cups} 杯` : ""),
            { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
          );
        }

        // 结算前处理本轮刚发出的待收转账 + 彩票
        if (allowTransfer) {
          await resolveIncomingTransfers({ game, memories, manifest, sharedConfig, signal, io });
        }
        ingestRoundChatsIntoMemories(game, memories, seenPublicMsgs, seenDmMsgs);
        settleAllPendingLotteryOffers(game);
        clearActionDeadline(game);
        tryAdvancePhase(game);
        if (io) broadcastUpdate(io, game);
        await stepPauseMs(600, 30);
        continue;
      }

      if (game.phase === "SETTLEMENT") {
        const ranks = computeWealthRanks(game.players);
        for (const h of game.sessionTelemetry?.settlementHistory ?? []) {
          if (recordedSettlementRounds.has(h.round)) continue;
          recordedSettlementRounds.add(h.round);
          for (const p of game.players) {
            let ownInvest = 0;
            let ownGain = 0;
            for (const r of h.results) {
              ownInvest += r.playerInvestments[p.id] ?? 0;
              ownGain += r.playerGains[p.id]?.total ?? 0;
            }
            memories.get(p.id)?.record(
              "outcome",
              `第 ${h.round} 轮结算：财富 ${p.wealth}，排名 ${ranks.get(p.id) ?? p.rank}；投入 ${ownInvest}，收益 ${ownGain}`,
              { globalRound: h.round, era: game.currentEra, roundInEra: game.roundInEra }
            );
          }
        }
        if (io) broadcastUpdate(io, game);
        await stepPauseMs(1000, 40);
        for (const p of game.players) togglePlayerReady(game, p.id);
        tryAdvancePhase(game);
        if (io) broadcastUpdate(io, game);
        continue;
      }

      if (game.phase === "AUCTION") {
        if (manifest.auctionEnabled === false) {
          game.autoHostNextActionAt = undefined;
          endAuctionSession(game);
          game.logs.push("⏭️ 本局已配置关闭拍卖会，直接进入下一时代");
          if (io) broadcastUpdate(io, game);
          await stepPauseMs(200, 10);
          continue;
        }
        let lastFocus: string | undefined;
        while ((game.phase as string) === "AUCTION") {
          ensureNotAborted(signal);
          const focus = findNextAutoAuctionCard(game, lastFocus);
          if (!focus) {
            game.autoHostNextActionAt = undefined;
            endAuctionSession(game);
            break;
          }
          lastFocus = focus;
          const lotStartedAt = Date.now();
          const lotHardDeadline = lotStartedAt + LAB_AUCTION_LOT_MAX_MS;
          game.auctionFocusCardId = focus;
          game.auctionFocusSetAt = lotStartedAt;
          game.autoHostNextActionAt = Math.min(lotHardDeadline, lotStartedAt + LAB_AUCTION_ROUND_MS);
          if (io) broadcastUpdate(io, game);

          const passedOnCard = new Set<string>();
          const decisionsOnCard = new Map<string, number>();
          let forcedSold = false;
          const lotAbort = new AbortController();
          const lotTimer = setTimeout(() => lotAbort.abort(), LAB_AUCTION_LOT_MAX_MS);

          try {
            for (let pass = 0; pass < AUCTION_MAX_DECISIONS_PER_LOT; pass++) {
              ensureNotAborted(signal);
              if (Date.now() >= lotHardDeadline) break;
              const leadingId = getLeadingBidOnFocus(game)?.playerId ?? null;
              const candidates = game.players.filter(
                (p) =>
                  p.id !== leadingId &&
                  !passedOnCard.has(p.id) &&
                  (decisionsOnCard.get(p.id) ?? 0) < AUCTION_MAX_DECISIONS_PER_LOT
              );
              if (candidates.length === 0) break;

              const rawResults = await Promise.all(
                candidates.map(async (p): Promise<LabAuctionBidResult | null> => {
                  const obs = buildLabObservation(game, p.id);
                  const avail = playerAvailableWealth(game, p);
                  const maxBid = Math.max(0, Math.floor(avail * AUCTION_MAX_WEALTH_RATIO));
                  const mem = memories.get(p.id)!;
                  decisionsOnCard.set(p.id, (decisionsOnCard.get(p.id) ?? 0) + 1);
                  try {
                    const res = await askAgentWithValidation<{
                      action: "bid" | "pass" | "force_buy";
                      amount?: number;
                      reasoning: string;
                    }>({
                      game,
                      player: p,
                      manifest,
                      sharedConfig,
                      label: `auction-${focus}`,
                      userPrompt: buildLabAuctionPrompt(obs, focus, maxBid, mem.digest()),
                      validate: (data) => {
                        if (!data || typeof data !== "object") return null;
                        const a = (data as { action?: unknown }).action;
                        if (a !== "bid" && a !== "pass" && a !== "force_buy") return null;
                        return {
                          action: a,
                          amount: int((data as { amount?: unknown }).amount) ?? undefined,
                          reasoning: String((data as { reasoning?: unknown }).reasoning ?? ""),
                        };
                      },
                      signal,
                      callSignal: lotAbort.signal,
                      budgetKind: "auction",
                      io,
                    });
                    return {
                      player: p,
                      decision: res.value,
                      rawThinking: res.rawThinking,
                      usage: res.usage,
                      latencyMs: res.latencyMs,
                    };
                  } catch (err) {
                    if (err instanceof LabCallExpiredError) {
                      return null;
                    }
                    throw err;
                  }
                })
              );

              const bidResults = rawResults.filter((r): r is LabAuctionBidResult => r !== null);
              const wave = applyLabAuctionWave({
                game,
                focus,
                bidResults,
                lotHardDeadline,
                passedOnCard,
                memories,
              });
              forcedSold = wave.forcedSold;

              if (io) broadcastUpdate(io, game);
              if (forcedSold || !wave.anyAction || Date.now() >= lotHardDeadline) break;
              await stepPauseMs(300, 15);
            }
          } finally {
            clearTimeout(lotTimer);
          }

          settleLabAuctionLot(game, focus, forcedSold);
          if (io) broadcastUpdate(io, game);
          await stepPauseMs(400, 20);
        }
        if (io) broadcastUpdate(io, game);
        continue;
      }

      if (game.phase === "COMMUNITY_NAMING") {
        const namer = getCommunityNamer(game) ?? game.players[0];
        const obs = buildLabObservation(game, namer.id);
        const res = await askAgentWithValidation<{ name: string; reasoning: string }>({
          game,
          player: namer,
          manifest,
          sharedConfig,
          label: "community-name",
          userPrompt: buildLabCommunityNamePrompt(obs),
          validate: (data) => {
            if (!data || typeof data !== "object") return null;
            const raw = (data as { name?: unknown }).name;
            if (typeof raw !== "string" || !raw.trim()) return null;
            const cleaned = sanitizeCommunityName(raw);
            if (!cleaned) return null;
            return {
              name: cleaned,
              reasoning: String((data as { reasoning?: unknown }).reasoning ?? ""),
            };
          },
          signal,
          io,
          budgetKind: "community_name",
        });
        recordLabDecision(
          game,
          namer,
          "community_name",
          res.value.reasoning,
          { name: res.value.name },
          res.usage,
          res.latencyMs,
          res.rawThinking
        );
        await finalizeCommunityName(io, game, res.value.name, "lab_agent");
        break;
      }

      // 兜底防止异常阶段死循环
      break;
    }
  } catch (err) {
    if (err instanceof LabStoppedError) {
      finalStatus = "stopped";
      failureReason = err.message;
    } else {
      finalStatus = "failed";
      failureReason = err instanceof Error ? err.message : String(err);
    }
    game.logs.push(`❌ 实验终止：${failureReason}`);
    if (io) broadcastUpdate(io, game);
  }

  const snapshot = buildLabSessionExport(game);
  const qc = buildLabSessionQc(snapshot, {
    runId: manifest.runId,
    condition: manifest.condition,
    seedBase: manifest.seedBase,
    seed,
    chatEnabled: manifest.chatEnabled,
    predictionEnabled: manifest.predictionEnabled,
    tokenBudgetPerAgent: manifest.tokenBudgetPerAgent,
    mock: manifest.mock,
    status: finalStatus,
    failureReason,
  });

  const sortedPlayers = [...snapshot.players].sort((a, b) => b.wealth - a.wealth);
  const communityWealth = Math.round(
    snapshot.players.reduce((s, p) => s + (Number(p.wealth) || 0), 0)
  );
  const sessionRecord: LabSessionRecord = {
    sessionId: game.sessionId || `${manifest.runId}-g${gameIndex + 1}`,
    runId: manifest.runId,
    condition: manifest.condition,
    seedBase: manifest.seedBase,
    seed,
    sessionOrdinal,
    roomId,
    communityName: game.communityName ?? (finalStatus === "completed" ? "未命名" : "未完成（作废）"),
    communityWealth,
    playerCount: game.players.length,
    sessionStartedAt: game.sessionStartedAt ?? null,
    completedAt: Date.now(),
    eraTheme: game.currentEraCard?.name ?? null,
    topPlayer: {
      name: sortedPlayers[0]?.name ?? "—",
      wealth: sortedPlayers[0]?.wealth ?? 0,
    },
    playersSummary: sortedPlayers.map((p) => ({
      id: p.id,
      name: p.name,
      wealth: p.wealth,
      agentIndex: p.agentIndex,
      model: p.agentModel,
      provider: p.agentProvider,
      socialRank: p.socialRank,
      socialRankReason: p.socialRankReason,
      tokensUsed: p.tokensUsed ?? 0,
    })),
    status: finalStatus,
    ...(failureReason ? { failureReason } : {}),
    mock: manifest.mock,
    qc,
    snapshot,
  };

  saveLabSession(sessionRecord);

  try {
    await sleepAbortable(manifest.mock ? 50 : 1200, signal);
  } catch {
    /* ignore abort during final linger */
  }
  if (rooms[roomId]) {
    if (io) io.to(roomId).emit("roomDissolved");
    delete rooms[roomId];
    notifyRoomList();
  }
  ctx.roomId = null;

  return sessionRecord;
}

export function startLabRun(params: LabStartParams): {
  ok: true;
  run: LabRunRecord;
} | {
  ok: false;
  error: string;
} {
  if (activeContext) {
    return {
      ok: false,
      error: "当前已有正在运行的实验批次，请等待跑完或先停止当前批次",
    };
  }

  const shared = resolveAiModelConfig();
  if (!params.mock && !shared) {
    return {
      ok: false,
      error: "服务端未配置共享模型密钥，请先配置或勾选「免费假跑自检」模式",
    };
  }

  const condition = safeName(params.condition || (params.mock ? "smoke" : "C1"));
  const games = Math.max(1, Math.min(20, Math.trunc(Number(params.games) || 1)));
  const seedBase = normalizeSeed(params.seedBase) || Math.trunc(Date.now() % 2_000_000_000) || 1;
  const maxBudget = 100_000_000;
  const rawBudget = Number(params.tokenBudgetPerAgent);
  const tokenBudgetPerAgent =
    Number.isFinite(rawBudget) && rawBudget === 0
      ? 0
      : Number.isFinite(rawBudget) && rawBudget > 0
        ? Math.max(100, Math.min(maxBudget, Math.trunc(rawBudget)))
        : getDefaultLabTokenBudgetPerAgent();

  const defaultSeatModels = resolveLabDefaultSeatModels();
  const providerName = params.mock ? "mock" : shared?.provider || "siliconflow";
  const models: string[] = [];
  const providers: string[] = [];
  for (let i = 0; i < 6; i++) {
    const m = params.mock
      ? "mock-model"
      : String(params.models?.[i] ?? "").trim() || defaultSeatModels[i] || shared?.model || "deepseek-ai/DeepSeek-V4.1-Flash";
    models.push(m);
    providers.push(providerName);
  }

  const interactionMode: LabInteractionMode =
    params.interactionMode === "free_two_step" ||
    params.interactionMode === "free_one_step" ||
    params.interactionMode === "guided_two_step"
      ? params.interactionMode
      : "guided_two_step";
  const thinkingMode: LabThinkingMode =
    params.thinkingMode === "fast" ||
    params.thinkingMode === "moderate" ||
    params.thinkingMode === "deep"
      ? params.thinkingMode
      : "moderate";
  const chatEnabled = params.chatEnabled !== false;
  const publicChatEnabled = chatEnabled && params.publicChatEnabled !== false;
  const privateChatEnabled = chatEnabled && params.privateChatEnabled !== false;
  const customGroupsEnabled = chatEnabled && params.customGroupsEnabled !== false;
  const effectiveChatEnabled = publicChatEnabled || privateChatEnabled || customGroupsEnabled;
  const customSystemPrompt =
    typeof params.customSystemPrompt === "string" && params.customSystemPrompt.trim()
      ? params.customSystemPrompt.trim().slice(0, 6000)
      : undefined;

  const stamp = timestampForId();
  const runId = `${condition}-${seedBase}-${stamp}`;
  const manifest: LabRunManifest = {
    runId,
    name: String(params.name ?? "").trim() || runId,
    condition,
    notes:
      String(params.notes ?? "").trim() ||
      (params.mock ? "免费假跑自检（仅校验流程，不代表真实模型）" : "真实大模型对照实验"),
    seedBase,
    games,
    createdAt: new Date().toISOString(),
    gitCommit: readGitCommit(),
    promptVersion: LAB_PROMPT_VERSION,
    promptHash: getPromptHash(),
    models,
    providers,
    temperature: AI_CONFIG.temperature,
    tokenBudgetPerAgent,
    maxOutputTokens: Math.max(64_000, AI_CONFIG.maxOutputTokens * 2),
    maxRetries: Math.max(3, AI_CONFIG.maxRetries),
    chatEnabled: effectiveChatEnabled,
    memoryEnabled: params.memoryEnabled !== false,
    predictionEnabled: params.predictionEnabled !== false,
    autoSocialScore: params.autoSocialScore !== false,
    mock: Boolean(params.mock),
    roomId: makeRoomId(runId, 0),
    interactionMode,
    thinkingMode,
    publicChatEnabled,
    privateChatEnabled,
    customGroupsEnabled,
    transferEnabled: params.transferEnabled !== false,
    auctionEnabled: params.auctionEnabled !== false,
    buffCardsEnabled: params.buffCardsEnabled !== false,
    coffeeEnabled: params.coffeeEnabled !== false,
    ...(customSystemPrompt ? { customSystemPrompt } : {}),
  };

  const startedAt = Date.now();
  const initialRecord: LabRunRecord = {
    runId,
    manifest,
    status: "running",
    completedGames: 0,
    failedGames: 0,
    currentGameIndex: 0,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    sessionIds: [],
  };
  saveLabRun(initialRecord);

  const ctx: ActiveLabContext = {
    runId,
    manifest,
    startedAt,
    currentGameIndex: 0,
    completedGames: 0,
    failedGames: 0,
    roomId: null,
    sessionIds: [],
    abortController: new AbortController(),
    stopReason: null,
  };
  activeContext = ctx;

  void (async () => {
    let runStatus: LabRunRecord["status"] = "completed";
    let runFailureReason: string | undefined;

    try {
      for (let i = 0; i < manifest.games; i++) {
        ensureNotAborted(ctx.abortController.signal);
        ctx.currentGameIndex = i;
        const derived = deriveSeed(manifest.seedBase, i);
        const session = await runSingleLabGame({
          ctx,
          gameIndex: i,
          sessionOrdinal: i,
          seed: derived,
          sharedConfig: shared,
        });
        ctx.sessionIds.push(session.sessionId);

        if (session.status === "completed") {
          ctx.completedGames += 1;
          saveLabRun({
            ...initialRecord,
            status: "running",
            completedGames: ctx.completedGames,
            failedGames: ctx.failedGames,
            currentGameIndex: i + 1,
            durationMs: Date.now() - startedAt,
            sessionIds: [...ctx.sessionIds],
          });
        } else {
          ctx.failedGames += 1;
          runStatus = session.status === "stopped" ? "stopped" : "failed";
          runFailureReason = session.failureReason || "本局未能完成";
          break;
        }
      }
    } catch (err) {
      if (err instanceof LabStoppedError) {
        runStatus = "stopped";
        runFailureReason = err.message;
      } else {
        runStatus = "failed";
        runFailureReason = err instanceof Error ? err.message : String(err);
      }
    } finally {
      const finishedAt = Date.now();
      const latest = getLabRunById(runId) ?? initialRecord;
      saveLabRun({
        ...latest,
        status: runStatus,
        completedGames: ctx.completedGames,
        failedGames: ctx.failedGames,
        currentGameIndex: ctx.currentGameIndex,
        finishedAt,
        durationMs: finishedAt - startedAt,
        ...(runFailureReason ? { failureReason: runFailureReason } : {}),
        sessionIds: [...ctx.sessionIds],
      });
      if (ctx.roomId && rooms[ctx.roomId]) {
        delete rooms[ctx.roomId];
        notifyRoomList();
      }
      activeContext = null;
    }
  })();

  return { ok: true, run: initialRecord };
}
