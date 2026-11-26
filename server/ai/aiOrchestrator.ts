import type { Server } from "socket.io";
import { randomBytes } from "node:crypto";
import type { ChatGroup, GameState, LotteryVisibility, Player, ProductAiDecision } from "../state/gameState.js";
import { getCommunityNamer } from "../state/gameState.js";
import { AI_BOT_ENABLED, AI_SAFETY_ENABLED } from "../config/features.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import {
  AI_CONFIG,
  isAiModelConfigured,
  resolveAiModelConfigForPlayer,
  type AiModelConfig,
} from "./aiConfig.js";
import { ProductAiMemory } from "./aiMemory.js";
import { profileForPlayer, type AiProfile } from "./aiPersona.js";
import { buildAiObservation } from "./aiObservation.js";
import {
  buildSystemPrompt,
  buildInvestmentPrompt,
  buildAuctionPrompt,
  buildTransferDecisionPrompt,
  buildCommunityNamePrompt,
  buildDirectMessageReplyPrompt,
  buildGroupChatReplyPrompt,
  buildGroupWelcomePrompt,
  buildOpeningChatPrompt,
} from "./aiPrompt.js";
import { askAiJson, type AiLlmResult } from "./llmClient.js";
import {
  buildFallbackInvestmentPlan,
  chooseAuctionAction,
  chooseCommunityName,
  decideIncomingTransfer,
  sanitizeInvestmentPlan,
} from "./aiPolicy.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { togglePlayerReady, unlockSubmittedInvestment } from "../state/gameActions.js";
import {
  applyInvestments,
  sanitizeInvestments,
  spendableEnergy,
} from "../logic/investmentLogic.js";
import { useBuffCard, useForceBuyCard } from "../logic/buffLogic.js";
import { purchaseCoffee } from "../logic/coffeeLogic.js";
import {
  formatAuctionSoldMessage,
  getLeadingBidOnFocus,
  getMinimumNextBid,
  placeAuctionBid,
  playerAvailableWealth,
} from "../logic/auctionCards.js";
import { resolvePendingTransfer } from "../logic/transferResolve.js";
import { sendGroupChatMessage, createCustomChatGroup } from "../logic/chatGroups.js";
import { sanitizeTransactionNote } from "../logic/forbiddenText.js";
import { appendSessionEvent } from "../state/sessionTelemetry.js";
import { getInvestmentRemainingMs, isInvestmentBuffLockoutActive } from "../state/actionDeadline.js";
import { finalizeCommunityName } from "../state/communityNaming.js";
import { sanitizeCommunityName } from "../state/communityLeaderboard.js";
import { findPendingLotteryOffer } from "../logic/lotterySettle.js";
import { acceptLotteryOffer, createRandomLotteryOffer } from "../logic/lotteryDraw.js";
import {
  MAX_PENDING_PER_SENDER,
  pendingCountFrom,
  pruneSettledTransactions,
} from "../util/pruneTransactions.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { syncAutoAuctionDeadline } from "../host/autoHost.js";
import { markAiPreflightOk } from "./aiPreflight.js";
import type { AiInvestmentPlan, AiAuctionPlan } from "./aiTypes.js";
import {
  CRISIS_REPLY,
  SAFETY_CRISIS_WINDOW_MS,
  SAFETY_NOTICE_FROM_ID,
  SAFETY_REPLY_COOLDOWN_MS,
  detectCrisisSignals,
  guardAgentOutput,
  isCrisisReply,
} from "./aiSafety.js";

const READY_PHASES = new Set<GameState["phase"]>([
  "ERA_INTRO",
  "SETTLEMENT",
  "INVESTMENT",
  "BUFF_USAGE",
]);
const INVEST_PHASES = new Set<GameState["phase"]>(["INVESTMENT", "BUFF_USAGE"]);

interface AiLotState {
  lotKey: string;
  decisions: number;
  passed: boolean;
  doneSignature: string;
}

interface PendingDmBatch {
  notes: string[];
  firstAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingGroupBatch {
  senderId: string;
  senderName: string;
  texts: string[];
  firstAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface AiRoomState {
  sessionKey: string;
  phaseKey: string;
  phaseStartedAt: number;
  inFlight: Map<string, number>;
  forced: Set<string>;
  auction: Map<string, AiLotState>;
  buffRound: Map<string, number>;
  chatRound: Map<string, number>;
  groupChatRound: Map<string, number>;
  groupCreateRound: Map<string, number>;
  tokens: Map<string, number>;
  dmReplied: Map<string, number>;
  dmLastAt: Map<string, number>;
  dmBatches: Map<string, PendingDmBatch>;
  groupBatches: Map<string, PendingGroupBatch>;
  transferReadyAt: Map<string, number>;
  transferTimers: Map<string, NodeJS.Timeout>;
  contextRefreshCount: Map<string, number>;
  /** 正在解锁重投的 AI 数量（防止看门狗或自动主持误以为已全部完成） */
  reinvestingIds: Set<string>;
  memories: Map<string, ProductAiMemory>;
  recordedOutcomeRounds: Map<string, Set<number>>;
  openingPhaseKey: string;
  openingUntil: number;
  openingWakeTimer: ReturnType<typeof setTimeout> | null;
  openingChatDoneKey: string;
  lastErrorAt: number;
  lastAutoKickAt: number;
}

const AI_ROOMS = new Map<string, AiRoomState>();
const AI_NAMING_IN_FLIGHT = new Set<string>();
/** 每个房间同一时间只让一名 AI 依次评估拍卖出价，避免多 AI 并发抢同一口最低价 */
const AUCTION_ROOM_SERIAL = new Map<string, Promise<void>>();

function now(): number {
  return Date.now();
}

function phaseKey(game: GameState): string {
  if (game.phase === "AUCTION") {
    return `${game.phase}:${game.globalRound}:${game.currentEra}:${game.roundInEra}:${game.auctionFocusCardId ?? "-"}`;
  }
  return `${game.phase}:${game.globalRound}:${game.currentEra}:${game.roundInEra}`;
}

export function getAiPhaseKey(game: GameState): string {
  return phaseKey(game);
}

function sessionKey(game: GameState): string {
  return `${game.sessionId ?? ""}:${game.sessionStartedAt ?? ""}`;
}

function auctionSignature(game: GameState): string {
  const leading = getLeadingBidOnFocus(game);
  return `${game.auctionFocusCardId ?? "-"}:${leading?.amount ?? 0}:${leading?.playerId ?? "-"}`;
}

function clearTimersInState(state: AiRoomState): void {
  for (const b of state.dmBatches.values()) {
    if (b.timer) clearTimeout(b.timer);
  }
  state.dmBatches.clear();
  for (const b of state.groupBatches.values()) {
    if (b.timer) clearTimeout(b.timer);
  }
  state.groupBatches.clear();
  for (const t of state.transferTimers.values()) {
    clearTimeout(t);
  }
  state.transferTimers.clear();
  if (state.openingWakeTimer) {
    clearTimeout(state.openingWakeTimer);
    state.openingWakeTimer = null;
  }
}

function getRoomState(game: GameState): AiRoomState {
  let state = AI_ROOMS.get(game.roomId);
  if (!state) {
    state = {
      sessionKey: sessionKey(game),
      phaseKey: phaseKey(game),
      phaseStartedAt: now(),
      inFlight: new Map(),
      forced: new Set(),
      auction: new Map(),
      buffRound: new Map(),
      chatRound: new Map(),
      groupChatRound: new Map(),
      groupCreateRound: new Map(),
      tokens: new Map(),
      dmReplied: new Map(),
      dmLastAt: new Map(),
      dmBatches: new Map(),
      groupBatches: new Map(),
      transferReadyAt: new Map(),
      transferTimers: new Map(),
      contextRefreshCount: new Map(),
      reinvestingIds: new Set(),
      memories: new Map(),
      recordedOutcomeRounds: new Map(),
      openingPhaseKey: "",
      openingUntil: 0,
      openingWakeTimer: null,
      openingChatDoneKey: "",
      lastErrorAt: 0,
      lastAutoKickAt: 0,
    };
    AI_ROOMS.set(game.roomId, state);
    return state;
  }

  const nextSession = sessionKey(game);
  if (state.sessionKey !== nextSession) {
    state.sessionKey = nextSession;
    state.tokens.clear();
    state.buffRound.clear();
    state.chatRound.clear();
    state.groupChatRound.clear();
    state.groupCreateRound.clear();
    state.dmReplied.clear();
    state.dmLastAt.clear();
    state.transferReadyAt.clear();
    state.contextRefreshCount.clear();
    state.reinvestingIds.clear();
    state.memories.clear();
    state.recordedOutcomeRounds.clear();
    state.openingPhaseKey = "";
    state.openingUntil = 0;
    state.openingChatDoneKey = "";
    state.lastAutoKickAt = 0;
    clearTimersInState(state);
    state.auction.clear();
    state.forced.clear();
  }

  const key = phaseKey(game);
  if (state.phaseKey !== key) {
    const prevPhase = state.phaseKey.split(":")[0];
    state.phaseKey = key;
    state.phaseStartedAt = now();
    state.forced.clear();
    state.contextRefreshCount.clear();
    state.reinvestingIds.clear();
    state.openingPhaseKey = "";
    state.openingUntil = 0;
    state.openingChatDoneKey = "";
    if (state.openingWakeTimer) {
      clearTimeout(state.openingWakeTimer);
      state.openingWakeTimer = null;
    }
    game.aiOpeningUntil = undefined;
    state.lastAutoKickAt = 0;
    game.aiTurnStatuses = {};
    if (prevPhase !== game.phase || !isChatPhaseAllowed(game)) {
      sweepStaleChatThinkingStatuses(game, 0);
    }
    if (game.aiFailures) {
      for (const [id, failure] of Object.entries(game.aiFailures)) {
        const failureKey = failure.phaseKey ?? failure.phase;
        if (failureKey !== key) delete game.aiFailures[id];
      }
      if (Object.keys(game.aiFailures).length === 0 && game.aiDeadlinePaused) {
        game.aiDeadlinePaused = false;
        if (game.phase !== "INVESTMENT") game.investmentTimerPausedAt = undefined;
      }
    }
  }
  return state;
}

export function hasAiTurnInFlight(roomId: string): boolean {
  const state = AI_ROOMS.get(roomId);
  if (!state) return false;
  return state.inFlight.size > 0 || state.reinvestingIds.size > 0;
}

function aiPlayers(game: GameState): Player[] {
  return game.players.filter((p) => isAiPlayer(p) && p.connected);
}

function logWarn(state: AiRoomState, message: string): void {
  if (now() - state.lastErrorAt < 10_000) return;
  state.lastErrorAt = now();
  console.warn(`[ai] ${message}`);
}

function logDebug(message: string): void {
  if (AI_CONFIG.verboseLogging) console.log(`[ai] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min: number, max: number): number {
  const lo = Math.max(0, Math.floor(min));
  const hi = Math.max(lo, Math.floor(max));
  return lo + Math.floor(Math.random() * Math.max(1, hi - lo + 1));
}

async function politeDelay(scale = 1): Promise<void> {
  await sleep(randomBetween(AI_CONFIG.actionDelayMinMs * scale, AI_CONFIG.actionDelayMaxMs * scale));
}

async function ensureMinimumElapsed(startedAt: number, minMs: number, maxMs: number): Promise<void> {
  const target = randomBetween(minMs, maxMs);
  const remaining = target - (now() - startedAt);
  if (remaining > 0) await sleep(remaining);
}

function setAiTurnStatus(
  game: GameState,
  ai: Player,
  status: "thinking" | "idle",
  io: Server | null
): void {
  if (!game.aiTurnStatuses) game.aiTurnStatuses = {};
  if (status === "idle") {
    if (!(ai.id in game.aiTurnStatuses)) return;
    delete game.aiTurnStatuses[ai.id];
  } else {
    game.aiTurnStatuses[ai.id] = {
      state: "thinking",
      phase: game.phase,
      updatedAt: now(),
    };
  }
  if (io) broadcastUpdate(io, game);
}

function setAiChatStatus(
  game: GameState,
  channelKey: string,
  ai: Player,
  status: "thinking" | "silent" | "clear",
  io: Server | null,
  broadcast = true
): void {
  if (!game.aiChatStatuses) game.aiChatStatuses = {};
  if (status === "clear") {
    const map = game.aiChatStatuses[channelKey];
    if (!map || !(ai.id in map)) return;
    delete map[ai.id];
    if (Object.keys(map).length === 0) delete game.aiChatStatuses[channelKey];
  } else {
    const map = (game.aiChatStatuses[channelKey] ??= {});
    map[ai.id] = {
      playerId: ai.id,
      playerName: ai.name,
      state: status,
      updatedAt: now(),
    };
  }
  if (io && broadcast) broadcastUpdate(io, game);
}

function clearChannelSilentStatuses(game: GameState, channelKey: string): void {
  const map = game.aiChatStatuses?.[channelKey];
  if (!map) return;
  for (const [id, entry] of Object.entries(map)) {
    if (entry.state === "silent") delete map[id];
  }
  if (Object.keys(map).length === 0) delete game.aiChatStatuses![channelKey];
}

/** 清理群聊防抖切换响应者时未被选中的陈旧 thinking 状态。 */
export function pruneGroupThinkingStatuses(
  game: GameState,
  channelKey: string,
  keepPlayerIds: Set<string>
): boolean {
  const map = game.aiChatStatuses?.[channelKey];
  if (!map) return false;
  let changed = false;
  for (const [id, entry] of Object.entries(map)) {
    if (entry.state === "thinking" && !keepPlayerIds.has(id)) {
      delete map[id];
      changed = true;
    }
  }
  if (Object.keys(map).length === 0) delete game.aiChatStatuses![channelKey];
  return changed;
}

/** 清理超过宽限时间或已不允许聊天的陈旧 thinking 状态。 */
export function sweepStaleChatThinkingStatuses(
  game: GameState,
  maxAgeMs = 90_000,
  at: number = now()
): boolean {
  const statuses = game.aiChatStatuses;
  if (!statuses) return false;
  let changed = false;
  for (const [channelKey, map] of Object.entries(statuses)) {
    for (const [id, entry] of Object.entries(map)) {
      if (entry.state === "thinking" && (maxAgeMs <= 0 || at - entry.updatedAt > maxAgeMs)) {
        delete map[id];
        changed = true;
      }
    }
    if (Object.keys(map).length === 0) delete statuses[channelKey];
  }
  return changed;
}

function sumInvestment(plan: Record<number, number>): number {
  return Object.values(plan).reduce((s, v) => s + (Number(v) || 0), 0);
}

function modelConfigFor(ai: Player): AiModelConfig | null {
  return resolveAiModelConfigForPlayer(ai);
}

function getAiMemory(state: AiRoomState, aiId: string): ProductAiMemory {
  let mem = state.memories.get(aiId);
  if (!mem) {
    mem = new ProductAiMemory();
    state.memories.set(aiId, mem);
  }
  return mem;
}

function syncSettlementMemories(game: GameState, ai: Player, state: AiRoomState): string {
  const mem = getAiMemory(state, ai.id);
  let seen = state.recordedOutcomeRounds.get(ai.id);
  if (!seen) {
    seen = new Set();
    state.recordedOutcomeRounds.set(ai.id, seen);
  }
  for (const h of game.sessionTelemetry?.settlementHistory ?? []) {
    if (seen.has(h.round)) continue;
    seen.add(h.round);
    let ownInvest = 0;
    let ownGain = 0;
    const highlights: string[] = [];
    for (const r of h.results) {
      const inv = r.playerInvestments[ai.id] ?? 0;
      const gain = r.playerGains[ai.id]?.total ?? 0;
      ownInvest += inv;
      ownGain += gain;
      if (r.isExploded && r.type !== "long" && inv > 0) {
        highlights.push(`${r.name}爆雷`);
      } else if (r.shortSold && inv > 0) {
        highlights.push(`${r.name}被做空`);
      }
    }
    const extra = highlights.length > 0 ? `（${highlights.join("、")}）` : "";
    mem.record(
      "outcome",
      `结算：投${ownInvest}，净变${ownGain >= 0 ? `+${ownGain}` : ownGain}，现财富${ai.wealth}${extra}`,
      { globalRound: h.round, era: h.currentEra, roundInEra: h.roundInEra }
    );
  }
  return mem.digest();
}

function isFastFallbackRetryable(error?: string): boolean {
  return /timeout|timed out|aborted|empty response|terminated|connection error|JSON\s*解析失败|429|500|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed|network|socket|hang up/i.test(
    error ?? ""
  );
}

export async function askProductAiWithFallback(
  system: string,
  user: string,
  options: {
    config: AiModelConfig;
    label: string;
    thinking?: {
      thinkingBudget: number;
      reasoningEffort?: "minimal" | "low" | "medium" | "high";
      timeoutMs: number;
      maxOutputTokens: number;
    };
    fast: {
      timeoutMs: number;
      maxRetries?: number;
      maxOutputTokens: number;
    };
  },
  llmCaller: typeof askAiJson = askAiJson
): Promise<AiLlmResult> {
  if (!options.thinking) {
    return llmCaller(system, user, {
      config: options.config,
      label: options.label,
      disableThinking: true,
      timeoutMs: options.fast.timeoutMs,
      maxRetries: options.fast.maxRetries ?? 1,
      maxOutputTokens: options.fast.maxOutputTokens,
    });
  }

  const first = await llmCaller(system, user, {
    config: options.config,
    label: options.label,
    disableThinking: false,
    thinkingBudget: options.thinking.thinkingBudget,
    reasoningEffort: options.thinking.reasoningEffort ?? "low",
    timeoutMs: options.thinking.timeoutMs,
    maxRetries: 0,
    maxOutputTokens: options.thinking.maxOutputTokens,
  });
  if (first.ok && first.data) return first;
  if (!isFastFallbackRetryable(first.error)) return first;

  const fallbackUser = /JSON\s*解析失败/i.test(first.error ?? "")
    ? `${user}\n\n注意：上一次回复不是完整合法的 JSON，请务必只输出一个完整的 JSON 对象（不要多余文字、不要在字符串中直接换行）。`
    : user;

  const fallback = await llmCaller(system, fallbackUser, {
    config: options.config,
    label: `${options.label}-fast`,
    disableThinking: true,
    timeoutMs: options.fast.timeoutMs,
    maxRetries: options.fast.maxRetries ?? 1,
    maxOutputTokens: options.fast.maxOutputTokens,
  });
  const totalUsage =
    first.usage || fallback.usage
      ? {
          promptTokens: (first.usage?.promptTokens ?? 0) + (fallback.usage?.promptTokens ?? 0),
          completionTokens:
            (first.usage?.completionTokens ?? 0) + (fallback.usage?.completionTokens ?? 0),
          totalTokens: (first.usage?.totalTokens ?? 0) + (fallback.usage?.totalTokens ?? 0),
        }
      : undefined;
  return {
    ...fallback,
    usage: totalUsage,
    latencyMs: (first.latencyMs ?? 0) + (fallback.latencyMs ?? 0),
  };
}

function pausesOnAiFailure(game: GameState): boolean {
  return AI_CONFIG.strictAgent && !game.autoHostEnabled;
}

function hasUsableBudget(state: AiRoomState, ai: Player, game?: GameState): boolean {
  if (!modelConfigFor(ai)) return false;
  const budget =
    typeof game?.aiTokenBudgetPerGame === "number" && game.aiTokenBudgetPerGame >= 0
      ? game.aiTokenBudgetPerGame
      : AI_CONFIG.tokenBudgetPerGame;
  if (budget <= 0) return true;
  return (state.tokens.get(ai.id) ?? 0) < budget;
}

function recordAiFailure(
  game: GameState,
  ai: Player,
  io: Server | null,
  message: string,
  kind: "model_error" | "invalid_output" | "not_configured" = "model_error"
): void {
  if (!AI_CONFIG.strictAgent) return;
  const clean = message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 240);
  const failures = (game.aiFailures ??= {});
  const prev = failures[ai.id];
  const pauseInvestment =
    pausesOnAiFailure(game) &&
    game.phase === "INVESTMENT" &&
    typeof game.investmentEndsAt === "number" &&
    game.investmentTimerPausedAt == null;
  failures[ai.id] = {
    playerId: ai.id,
    name: ai.name,
    phase: game.phase,
    phaseKey: phaseKey(game),
    at: now(),
    message: clean,
    kind,
  };
  if (!prev || (prev.phaseKey ?? prev.phase) !== phaseKey(game)) {
    game.logs.push(
      pauseInvestment
        ? `⚠️ AI「${ai.name}」模型失败，已暂停等待管理员处理（${clean}）`
        : `⚠️ AI「${ai.name}」模型失败，本轮继续（${clean}）`
    );
  }
  if (pauseInvestment) {
    game.investmentTimerPausedAt = now();
    game.aiDeadlinePaused = true;
  }
  if (io) {
    broadcastUpdate(io, game);
    if (pauseInvestment) {
      io.to(game.roomId).emit("playerNotify", {
        type: "ai_stalled",
        message: "AI 玩家暂时离线，本局已暂停，等待管理员处理",
      });
    }
  }
}

export function clearAiFailure(game: GameState, playerId: string, io: Server | null): void {
  const failure = game.aiFailures?.[playerId];
  if (failure) {
    delete game.aiFailures![playerId];
    const state = AI_ROOMS.get(game.roomId);
    state?.forced.delete(playerId);
    game.logs.push(`✅ AI「${failure.name}」故障已清除`);
  }
  const remaining = Object.keys(game.aiFailures ?? {}).length;
  if (remaining === 0 && game.aiDeadlinePaused) {
    if (
      game.phase === "INVESTMENT" &&
      typeof game.investmentEndsAt === "number" &&
      typeof game.investmentTimerPausedAt === "number"
    ) {
      const remainingMs = Math.max(
        0,
        game.investmentEndsAt - game.investmentTimerPausedAt
      );
      game.investmentEndsAt = now() + remainingMs;
      game.investmentTimerPausedAt = undefined;
      game.logs.push("▶️ AI 故障已处理，投资倒计时继续");
    }
    game.aiDeadlinePaused = false;
  }
  if (io) broadcastUpdate(io, game);
}

function recordTokens(
  state: AiRoomState,
  ai: Player,
  totalTokens?: number,
  game?: GameState
): void {
  if (!totalTokens || totalTokens <= 0) return;
  state.tokens.set(ai.id, (state.tokens.get(ai.id) ?? 0) + totalTokens);
  if (game) {
    const usage = (game.aiTokenUsage ??= {});
    usage[ai.id] = (usage[ai.id] ?? 0) + totalTokens;
  }
}

function recordAiDecision(
  game: GameState,
  ai: Player,
  entry: {
    kind: ProductAiDecision["kind"];
    reasoning?: string;
    summary?: string;
    model?: string;
    totalTokens?: number;
    latencyMs?: number;
  }
): void {
  const list = (game.aiDecisions ??= []);
  list.push({
    id: `aid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now(),
    phase: game.phase,
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    playerId: ai.id,
    playerName: ai.name,
    kind: entry.kind,
    model: entry.model ?? modelConfigFor(ai)?.model ?? ai.aiModelLabel,
    reasoning: String(entry.reasoning ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    ...(entry.summary ? { summary: entry.summary.slice(0, 240) } : {}),
    ...(typeof entry.totalTokens === "number" ? { totalTokens: entry.totalTokens } : {}),
    ...(typeof entry.latencyMs === "number" ? { latencyMs: entry.latencyMs } : {}),
  });
  if (list.length > 300) {
    game.aiDecisions = list.slice(-300);
  }
}

function hasDuePendingIncomingTransfer(
  game: GameState,
  ai: Player,
  state: AiRoomState
): boolean {
  if (AI_CONFIG.strictAgent && now() < (AI_TRANSFER_NEXT_TRY.get(ai.id) ?? 0)) {
    return false;
  }
  return game.transactions.some((tx) => {
    if (tx.status !== "pending" || tx.toId !== ai.id) return false;
    if (AI_TRANSFER_IN_FLIGHT.has(tx.id)) return false;
    const readyAt = state.transferReadyAt.get(tx.id);
    return readyAt == null || now() >= readyAt;
  });
}

function hasUnreadyConnectedHuman(game: GameState): boolean {
  return game.players.some((p) => !isAiPlayer(p) && p.connected && !p.ready);
}

function isOpeningWindowWaiting(game: GameState, state: AiRoomState): boolean {
  if (game.phase !== "INVESTMENT") return false;
  if (state.openingPhaseKey !== state.phaseKey) return false;
  if (now() >= state.openingUntil) return false;
  return hasUnreadyConnectedHuman(game);
}

function ensureOpeningNegotiationWindow(
  game: GameState,
  state: AiRoomState,
  io: Server | null
): boolean {
  if (game.phase !== "INVESTMENT") return false;
  if (AI_CONFIG.investOpeningWindowMs <= 0) return false;
  if (!hasUnreadyConnectedHuman(game)) return false;
  if (getInvestmentRemainingMs(game) <= 60_000) return false;

  if (state.openingPhaseKey !== state.phaseKey) {
    state.openingPhaseKey = state.phaseKey;
    state.openingUntil = now() + AI_CONFIG.investOpeningWindowMs;
    game.aiOpeningUntil = state.openingUntil;
    if (state.openingWakeTimer) clearTimeout(state.openingWakeTimer);
    const waitMs = Math.max(20, state.openingUntil - now() + 30);
    state.openingWakeTimer = setTimeout(() => {
      state.openingWakeTimer = null;
      if (state.phaseKey === phaseKey(game)) {
        state.openingUntil = 0;
        game.aiOpeningUntil = undefined;
        if (io) broadcastUpdate(io, game);
        void handleAIPhase(game, io);
      }
    }, waitMs);
    if (io) broadcastUpdate(io, game);

    if (
      state.openingChatDoneKey !== state.phaseKey &&
      AI_CONFIG.openingChatEnabled &&
      AI_CONFIG.chatEnabled &&
      GROUP_CHAT_ENABLED &&
      (game.safetyCrisisUntil ?? 0) <= now()
    ) {
      state.openingChatDoneKey = state.phaseKey;
      const ais = aiPlayers(game).filter(
        (p) => !p.ready && modelConfigFor(p) && hasUsableBudget(state, p, game)
      );
      if (ais.length > 0) {
        const speaker = ais[(Math.max(1, game.globalRound) - 1) % ais.length];
        void triggerAiOpeningChat(game, speaker, state, io);
      }
    }
  }

  return isOpeningWindowWaiting(game, state);
}

async function triggerAiOpeningChat(
  game: GameState,
  ai: Player,
  state: AiRoomState,
  io: Server | null
): Promise<void> {
  const startKey = state.phaseKey;
  const publicGroup = (game.chatGroups ?? []).find((g) => g.kind === "public");
  if (!publicGroup) return;
  const cfg = modelConfigFor(ai);
  if (!cfg || !hasUsableBudget(state, ai, game)) return;

  const delayMs = Math.min(
    randomBetween(1_200, 2_800),
    Math.max(0, Math.floor(AI_CONFIG.investOpeningWindowMs * 0.45))
  );
  if (delayMs > 0) await sleep(delayMs);
  if (game.phase !== "INVESTMENT" || state.phaseKey !== startKey) return;
  if (!isChatPhaseAllowed(game) || (game.safetyCrisisUntil ?? 0) > now()) return;
  if (!hasUnreadyConnectedHuman(game) || ai.ready) return;

  const channelKey = `group:${publicGroup.id}`;
  setAiChatStatus(game, channelKey, ai, "thinking", io);
  try {
    const profile = profileForPlayer(ai);
    const obs = buildAiObservation(game, ai);
    const memDigest = syncSettlementMemories(game, ai, state);
    const result = await askAiJson(
      buildSystemPrompt(profile),
      buildOpeningChatPrompt(obs, profile, memDigest),
      {
        label: `opening-chat-r${game.globalRound}`,
        timeoutMs: 12_000,
        maxRetries: 0,
        disableThinking: true,
        maxOutputTokens: 800,
        config: cfg,
      }
    );
    if (game.phase !== "INVESTMENT" || state.phaseKey !== startKey) {
      setAiChatStatus(game, channelKey, ai, "clear", io);
      return;
    }
    if (!result.ok || !result.data) {
      setAiChatStatus(game, channelKey, ai, "clear", io);
      return;
    }
    markAiPreflightOk(ai);
    recordTokens(state, ai, result.usage?.totalTokens, game);
    const parsed = result.data as { silent?: unknown; reply?: unknown; reasoning?: unknown };
    const rawReply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 80) : "";
    const posted =
      parsed.silent !== true &&
      rawReply &&
      isChatPhaseAllowed(game) &&
      (game.safetyCrisisUntil ?? 0) <= now() &&
      sendAiChat(game, ai, rawReply);

    if (posted) {
      setAiChatStatus(game, channelKey, ai, "clear", io);
      getAiMemory(state, ai.id).record(
        "social",
        `[全场开场] 我先说：「${rawReply.slice(0, 40)}」`,
        { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
      );
      if (io) {
        for (const target of game.players) {
          if (target.id === ai.id || !target.socketId) continue;
          io.to(target.socketId).emit("playerNotify", {
            type: "chat",
            message: `全场 · ${ai.name}：${rawReply.slice(0, 48)}`,
          });
        }
      }
    } else {
      setAiChatStatus(game, channelKey, ai, "clear", io);
    }
    recordAiDecision(game, ai, {
      kind: "opening_chat",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      summary: posted ? `全场开场：「${rawReply.slice(0, 32)}」` : "开场保持观察",
      model: cfg.model,
      totalTokens: result.usage?.totalTokens,
      latencyMs: result.latencyMs,
    });
    if (io) broadcastUpdate(io, game);
  } catch {
    setAiChatStatus(game, channelKey, ai, "clear", io);
  }
}

/** 所有在线真人都已提前锁定投资时，立即结束谈判等待并唤醒 AI 提交投资。 */
export function wakeAiOpeningWindowIfHumansReady(game: GameState, io: Server | null): boolean {
  if (game.isLabExperiment || !AI_BOT_ENABLED) return false;
  if (game.phase !== "INVESTMENT") return false;
  if (hasUnreadyConnectedHuman(game)) return false;
  const state = AI_ROOMS.get(game.roomId);
  const hadWindow = Boolean(
    (state && (state.openingUntil > now() || state.openingWakeTimer)) ||
      (game.aiOpeningUntil ?? 0) > now()
  );
  if (!hadWindow) return false;
  if (state) {
    if (state.openingWakeTimer) {
      clearTimeout(state.openingWakeTimer);
      state.openingWakeTimer = null;
    }
    state.openingUntil = 0;
  }
  game.aiOpeningUntil = undefined;
  if (io) broadcastUpdate(io, game);
  void handleAIPhase(game, io);
  return true;
}

export function isAiInOpeningWindow(game: GameState): boolean {
  const state = AI_ROOMS.get(game.roomId);
  if (!state) return false;
  return isOpeningWindowWaiting(game, state);
}
function isDone(game: GameState, ai: Player, state: AiRoomState): boolean {
  if (!game.players.some((p) => p.id === ai.id)) return true;
  const failure = game.aiFailures?.[ai.id];
  if (
    AI_CONFIG.strictAgent &&
    failure &&
    (failure.phaseKey ?? failure.phase) === phaseKey(game)
  ) {
    return true;
  }
  if (game.phase === "ROOM_WAITING" || game.phase === "TUTORIAL" || game.phase === "GAME_OVER") {
    return true;
  }
  if (hasDuePendingIncomingTransfer(game, ai, state) || Boolean(findPendingLotteryOffer(game, ai.id))) {
    return false;
  }
  if (game.phase === "INVESTMENT" && isOpeningWindowWaiting(game, state)) {
    return true;
  }
  if (game.phase === "AUCTION") {
    if (!AI_CONFIG.auctionEnabled) return true;
    const focus = game.auctionFocusCardId;
    if (!focus) return true;
    const lot = state.auction.get(ai.id);
    if (!lot || lot.lotKey !== `${game.currentEra}:${focus}`) return false;
    if (lot.passed) return true;
    return lot.doneSignature === auctionSignature(game);
  }
  if (game.phase === "COMMUNITY_NAMING") return true;
  return ai.ready;
}

/** 若 AI 决定解锁重投：回退当前轮投资并重新排一轮投资决策。 */
function triggerAiUnlockAndReinvest(
  game: GameState,
  ai: Player,
  state: AiRoomState,
  io: Server | null,
  reason: string
): boolean {
  if (game.phase !== "INVESTMENT" || !ai.ready) return false;
  if (getInvestmentRemainingMs(game) <= 0) return false;
  if (state.inFlight.has(ai.id) || state.reinvestingIds.has(ai.id)) return false;

  const unlocked = unlockSubmittedInvestment(game, ai.id, "ai");
  if (!unlocked.ok) return false;

  state.reinvestingIds.add(ai.id);
  game.logs.push(`🔓 AI「${ai.name}」因${reason}解锁本轮投资，重新调整方案`);
  recordAiDecision(game, ai, {
    kind: "unlock_reinvest",
    reasoning: `因${reason}解锁已锁定方案，重新评估投资`,
    summary: `解锁重投（${reason}）`,
  });
  appendSessionEvent(
    game,
    "ai_action",
    { kind: "unlock_reinvest", reason, globalRound: game.globalRound },
    ai.id
  );
  if (io) broadcastUpdate(io, game);

  void handleAIPhase(game, io).finally(() => {
    state.reinvestingIds.delete(ai.id);
  });
  return true;
}

const AI_TRANSFER_IN_FLIGHT = new Set<string>();
const AI_TRANSFER_NEXT_TRY = new Map<string, number>();
const AI_TRANSFER_RETRY_MS = 30_000;

/**
 * 把收到的转账处理掉（带拟人延迟与思考状态，带完整全局视角，可附带自然回应或解锁重投）。
 */
async function resolveAiIncomingTransfers(
  game: GameState,
  ai: Player,
  state: AiRoomState,
  io: Server | null
): Promise<boolean> {
  let acted = false;
  if (AI_CONFIG.strictAgent && now() < (AI_TRANSFER_NEXT_TRY.get(ai.id) ?? 0)) {
    return false;
  }
  for (const tx of game.transactions) {
    if (tx.status !== "pending" || tx.toId !== ai.id) continue;
    if (AI_TRANSFER_IN_FLIGHT.has(tx.id)) continue;

    // 拟人思考窗口：避免 1 秒内秒收
    let readyAt = state.transferReadyAt.get(tx.id);
    if (readyAt == null) {
      const waitMs = randomBetween(AI_CONFIG.transferDelayMinMs, AI_CONFIG.transferDelayMaxMs);
      readyAt = tx.timestamp + waitMs;
      state.transferReadyAt.set(tx.id, readyAt);
      const dmKey = `dm:${tx.fromId}:${ai.id}`;
      setAiChatStatus(game, dmKey, ai, "thinking", io);
    }
    if (now() < readyAt) {
      if (!state.transferTimers.has(tx.id)) {
        const delay = Math.max(50, readyAt - now() + 30);
        const timer = setTimeout(() => {
          state.transferTimers.delete(tx.id);
          void handleAIPhase(game, io);
        }, delay);
        state.transferTimers.set(tx.id, timer);
      }
      continue;
    }

    AI_TRANSFER_IN_FLIGHT.add(tx.id);
    const dmKey = `dm:${tx.fromId}:${ai.id}`;
    try {
      let accept: boolean;
      let replyText = "";
      let unlockToReinvest = false;

      if (AI_CONFIG.strictAgent) {
        const modelConfig = modelConfigFor(ai);
        if (!modelConfig || !hasUsableBudget(state, ai, game)) {
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          game.logs.push(
            `⚠️ AI「${ai.name}」暂时无法处理转账（${
              modelConfig ? "token 预算已用尽" : "未配置模型"
            }），保留待处理`
          );
          break;
        }
        setAiChatStatus(game, dmKey, ai, "thinking", io);
        const observation = buildAiObservation(game, ai);
        const memDigest = syncSettlementMemories(game, ai, state);
        const result = await askAiJson(
          buildSystemPrompt(profileForPlayer(ai)),
          buildTransferDecisionPrompt(observation, tx, memDigest),
          {
            label: "transfer-decision",
            disableThinking: true,
            maxOutputTokens: 1_500,
            config: modelConfig,
          }
        );
        if (!result.ok || !result.data) {
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          setAiChatStatus(game, dmKey, ai, "clear", io);
          game.logs.push(
            `⚠️ AI「${ai.name}」转账决策失败：${(result.error ?? "无有效返回").slice(0, 120)}（30 秒后重试）`
          );
          break;
        }
        const parsed = result.data as {
          accept?: unknown;
          reply?: unknown;
          unlockToReinvest?: unknown;
          reasoning?: unknown;
        };
        if (typeof parsed.accept !== "boolean") {
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          setAiChatStatus(game, dmKey, ai, "clear", io);
          game.logs.push(`⚠️ AI「${ai.name}」转账决策缺少 accept，30 秒后重试`);
          break;
        }
        markAiPreflightOk(ai);
        recordTokens(state, ai, result.usage?.totalTokens, game);
        accept = parsed.accept;
        replyText = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 80) : "";
        unlockToReinvest = parsed.unlockToReinvest === true;
        recordAiDecision(game, ai, {
          kind: "transfer",
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
          summary: `${accept ? "接收" : "退回"} ${tx.fromName} 转账 ${tx.amount}${replyText ? ` · 回复「${replyText.slice(0, 24)}」` : ""}`,
          model: modelConfig.model,
          totalTokens: result.usage?.totalTokens,
          latencyMs: result.latencyMs,
        });
        getAiMemory(state, ai.id).record(
          "social",
          `${accept ? "收下" : "退回"} ${tx.fromName} 转账 ${tx.amount}${tx.note ? `（${tx.note.slice(0, 36)}）` : ""}`,
          { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
        );
        AI_TRANSFER_NEXT_TRY.set(ai.id, now() + 1_200);
      } else {
        accept = decideIncomingTransfer(game, ai, tx).accept;
      }

      if (!game.players.some((p) => p.id === ai.id)) break;
      const result = resolvePendingTransfer(game, tx.id, ai.id, accept);
      state.transferReadyAt.delete(tx.id);
      if (!result.ok) {
        setAiChatStatus(game, dmKey, ai, "clear", io);
        continue;
      }
      acted = true;
      appendSessionEvent(
        game,
        "transaction_resolved",
        { txId: tx.id, accept, status: result.status, amount: result.amount, source: "ai" },
        ai.id
      );

      const sender = game.players.find((p) => p.id === tx.fromId);
      if (sender?.socketId && tx.amount > 0) {
        const verb = result.status === "accepted" ? "已接收你的转账" : "已退回你的转账";
        io?.to(sender.socketId).emit("playerNotify", {
          type: "transfer",
          message: `${ai.name} ${verb} ${result.amount}`,
        });
      }

      if (replyText && AI_CONFIG.chatEnabled && (game.safetyCrisisUntil ?? 0) <= now()) {
        const guarded = AI_SAFETY_ENABLED ? guardAgentOutput(replyText, "note").text.trim() : replyText;
        if (guarded && createAiTransfer(game, ai, tx.fromId, 0, guarded)) {
          setAiChatStatus(game, dmKey, ai, "clear", io, false);
          if (sender?.socketId) {
            io?.to(sender.socketId).emit("playerNotify", {
              type: "chat",
              message: `${ai.name}：${guarded}`,
            });
          }
        } else {
          setAiChatStatus(game, dmKey, ai, "silent", io, false);
        }
      } else {
        setAiChatStatus(game, dmKey, ai, "clear", io, false);
      }

      if (unlockToReinvest) {
        triggerAiUnlockAndReinvest(game, ai, state, io, "收到转账");
      }
    } finally {
      AI_TRANSFER_IN_FLIGHT.delete(tx.id);
    }
  }
  if (acted) {
    pruneSettledTransactions(game);
    if (io) broadcastUpdate(io, game);
  }
  return acted;
}

/** AI 使用彩票后：确认领取待开奖结果（公开开奖向全房公告点数，私密开奖完全保密） */
function resolveAiLottery(game: GameState, ai: Player, io: Server | null = null): boolean {
  const offer = findPendingLotteryOffer(game, ai.id);
  if (!offer) return false;
  const result = acceptLotteryOffer(game, ai.id, offer.offerId);
  if (!result.ok) return false;
  const visLabel = result.visibility === "private" ? "私密开奖" : "公开开奖";
  game.logs.push(`🎲 彩票${visLabel}！${ai.name} 获得 ${result.creditedAmount} 财富（骰子 ${result.roll ?? "-"}）`);
  if (result.visibility === "public" && io) {
    const rollText = typeof result.roll === "number" ? `掷出 ${result.roll} 点` : "已开奖";
    io.to(game.roomId).emit("playerNotify", {
      type: "lottery",
      message: `🎲 ${ai.name} 公开开奖【彩票】：${rollText}`,
    });
  }
  appendSessionEvent(
    game,
    "lottery_settled",
    {
      targetPlayerId: ai.id,
      enteredAmount: result.enteredAmount,
      creditedAmount: result.creditedAmount,
      goldApplied: result.goldApplied,
      roll: result.roll ?? null,
      source: result.source ?? "server",
      visibility: result.visibility,
      accepted: true,
      actor: "ai",
    },
    ai.id
  );
  return true;
}

/** 线上随机抽奖；抽中后直接尝试领取并按可见性播报 */
function triggerAiLotteryDraw(game: GameState, ai: Player, io: Server | null): void {
  void createRandomLotteryOffer(game, ai.id)
    .then((result) => {
      if (!result.ok) return;
      appendSessionEvent(
        game,
        "lottery_drawn",
        {
          targetPlayerId: ai.id,
          amount: result.offer.amount,
          roll: result.offer.roll ?? null,
          source: result.offer.source ?? "server",
          visibility: result.offer.visibility ?? "public",
          actor: "ai",
        },
        ai.id
      );
      resolveAiLottery(game, ai, io);
      if (io) broadcastUpdate(io, game);
      tryAdvancePhase(game);
    })
    .catch((error) => {
      console.error("[ai] lottery draw failed:", error);
      tryAdvancePhase(game);
    });
}

function createAiTransfer(
  game: GameState,
  ai: Player,
  toPlayerId: string,
  amount: number,
  note: string
): boolean {
  if (game.phase === "ROOM_WAITING" || game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
    return false;
  }
  const receiver = game.players.find((p) => p.id === toPlayerId);
  if (!receiver || receiver.id === ai.id) return false;
  const amt = Math.floor(Number(amount) || 0);
  if (amt < 0) return false;
  let message = sanitizeTransactionNote(String(note ?? "").trim().slice(0, 80));
  if (AI_SAFETY_ENABLED && message) {
    message = guardAgentOutput(message, "note").text;
  }
  if (amt === 0 && !message) return false;
  if (amt > 0 && amt > playerAvailableWealth(game, ai)) return false;
  if (pendingCountFrom(game, ai.id) >= MAX_PENDING_PER_SENDER) return false;

  const tx = {
    id: randomBytes(8).toString("hex"),
    fromId: ai.id,
    fromName: ai.name,
    toId: receiver.id,
    toName: receiver.name,
    amount: amt,
    note: message,
    status: (amt === 0 ? "accepted" : "pending") as "accepted" | "pending",
    timestamp: now(),
  };
  game.transactions.push(tx);
  appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx, source: "ai" }, ai.id);
  pruneSettledTransactions(game);
  return true;
}

const DM_REPLY_TIMEOUT_MS = 45_000;
const DM_REPLY_MAX_PER_GAME = 80;

function isChatPhaseAllowed(game: GameState): boolean {
  return (
    game.phase !== "ROOM_WAITING" &&
    game.phase !== "ERA_INTRO" &&
    game.phase !== "TUTORIAL" &&
    game.phase !== "GAME_OVER"
  );
}

/**
 * 真人给 AI 发私信后的延迟思考回复（支持防抖合批、保持沉默前端可见、全局上下文与解锁重投）。
 */
export async function handleAiDirectMessage(
  game: GameState,
  ai: Player,
  fromPlayerId: string,
  message: { id?: string; note: string },
  io: Server | null
): Promise<void> {
  if (game.isLabExperiment) return;
  if (!AI_BOT_ENABLED || !AI_CONFIG.chatEnabled) return;
  if (!isChatPhaseAllowed(game)) return;
  if ((game.safetyCrisisUntil ?? 0) > now()) return;
  const sender = game.players.find((p) => p.id === fromPlayerId);
  if (!sender || sender.id === ai.id) return;
  const note = String(message.note ?? "").trim().slice(0, 160);
  if (!note || detectCrisisSignals(note).risk) return;

  const state = getRoomState(game);
  const key = message.id || `${fromPlayerId}:${note.slice(0, 32)}`;
  if (state.dmReplied.has(key) || state.dmReplied.size >= DM_REPLY_MAX_PER_GAME) return;
  const modelConfig = modelConfigFor(ai);
  if (!modelConfig || !hasUsableBudget(state, ai, game)) return;
  state.dmReplied.set(key, now());

  const dmKey = `dm:${fromPlayerId}:${ai.id}`;
  clearChannelSilentStatuses(game, dmKey);
  setAiChatStatus(game, dmKey, ai, "thinking", io);

  let batch = state.dmBatches.get(dmKey);
  if (!batch) {
    batch = { notes: [], firstAt: now(), timer: null };
    state.dmBatches.set(dmKey, batch);
  }
  batch.notes.push(note);
  if (batch.timer) clearTimeout(batch.timer);

  batch.timer = setTimeout(() => {
    const active = state.dmBatches.get(dmKey);
    if (!active) return;
    state.dmBatches.delete(dmKey);
    void processAiDmBatch(game, ai, fromPlayerId, active.notes, active.firstAt, io);
  }, AI_CONFIG.dmDebounceMs);
}

async function processAiDmBatch(
  game: GameState,
  ai: Player,
  fromPlayerId: string,
  notes: string[],
  firstAt: number,
  io: Server | null
): Promise<void> {
  const state = getRoomState(game);
  const originPhaseKey = phaseKey(game);
  const dmKey = `dm:${fromPlayerId}:${ai.id}`;
  try {
    if (!isChatPhaseAllowed(game) || (game.safetyCrisisUntil ?? 0) > now()) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
      return;
    }
    const sender = game.players.find((p) => p.id === fromPlayerId);
    if (!sender || !game.players.some((p) => p.id === ai.id)) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
      return;
    }
    const modelConfig = modelConfigFor(ai);
    if (!modelConfig || !hasUsableBudget(state, ai, game)) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
      return;
    }

    const dmMemDigest = syncSettlementMemories(game, ai, state);
    const result = await askAiJson(
      buildSystemPrompt(profileForPlayer(ai)),
      buildDirectMessageReplyPrompt(buildAiObservation(game, ai), sender.id, sender.name, notes, dmMemDigest),
      {
        label: "dm-reply",
        timeoutMs: Math.max(DM_REPLY_TIMEOUT_MS, AI_CONFIG.decisionTimeoutMs),
        maxRetries: 1,
        disableThinking: true,
        maxOutputTokens: 1_500,
        config: modelConfig,
      }
    );
    await ensureMinimumElapsed(firstAt, AI_CONFIG.dmDelayMinMs, AI_CONFIG.dmDelayMaxMs);

    if (!game.players.some((p) => p.id === ai.id) || !isChatPhaseAllowed(game) || phaseKey(game) !== originPhaseKey) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
      return;
    }
    if (!result.ok || !result.data) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
      return;
    }

    markAiPreflightOk(ai);
    recordTokens(state, ai, result.usage?.totalTokens, game);

    const parsed = result.data as {
      silent?: unknown;
      reply?: unknown;
      unlockToReinvest?: unknown;
      reasoning?: unknown;
      transfer?: { amount?: unknown; note?: unknown } | null;
    };

    const wantsSilent = parsed.silent === true;
    let reply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 80) : "";
    if (reply && AI_SAFETY_ENABLED) {
      reply = guardAgentOutput(reply, "note").text.trim();
    }

    let sentSomething = false;
    const rawTx = parsed.transfer;
    if (rawTx && typeof rawTx === "object") {
      const txAmt = Math.floor(Number(rawTx.amount) || 0);
      const txNote = typeof rawTx.note === "string" ? rawTx.note.trim().slice(0, 60) : "";
      if (txAmt > 0 && txAmt <= playerAvailableWealth(game, ai)) {
        if (createAiTransfer(game, ai, sender.id, txAmt, txNote || reply || "给你转一笔")) {
          sentSomething = true;
          if (sender.socketId) {
            io?.to(sender.socketId).emit("playerNotify", {
              type: "transfer",
              message: `${ai.name} 向你转账 ${txAmt}（待确认）`,
            });
          }
        }
      }
    }

    if (!wantsSilent && reply) {
      if (createAiTransfer(game, ai, sender.id, 0, reply)) {
        sentSomething = true;
        appendSessionEvent(
          game,
          "ai_action",
          { kind: "dm_reply", toPlayerId: sender.id, note: reply, source: "llm" },
          ai.id
        );
        if (sender.socketId) {
          io?.to(sender.socketId).emit("playerNotify", {
            type: "chat",
            message: `${ai.name}：${reply}`,
          });
        }
      }
    }

    if (sentSomething) {
      setAiChatStatus(game, dmKey, ai, "clear", io);
    } else {
      // AI 明确选择沉默（或没说出口），在前端展示“已读·保持沉默”
      setAiChatStatus(game, dmKey, ai, "silent", io);
      appendSessionEvent(
        game,
        "ai_action",
        { kind: "dm_silent", toPlayerId: sender.id, source: "llm" },
        ai.id
      );
    }

    recordAiDecision(game, ai, {
      kind: "dm_reply",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      summary:
        !wantsSilent && reply
          ? `私信→${sender.name}：「${reply.slice(0, 32)}」`
          : `已读 ${sender.name} 私信（保持沉默）`,
      model: modelConfig.model,
      totalTokens: result.usage?.totalTokens,
      latencyMs: result.latencyMs,
    });
    if (!wantsSilent && reply) {
      getAiMemory(state, ai.id).record(
        "social",
        `与${sender.name}私信：「${notes[notes.length - 1]?.slice(0, 30) ?? ""}」→我回「${reply.slice(0, 36)}」`,
        { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
      );
    }

    if (parsed.unlockToReinvest === true) {
      triggerAiUnlockAndReinvest(game, ai, state, io, "私信协商");
    }
  } catch (error) {
    setAiChatStatus(game, dmKey, ai, "clear", io);
    logWarn(
      state,
      `${ai.name} 私信回复失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function selectGroupResponders(
  game: GameState,
  group: ChatGroup,
  texts: string[],
  senderId: string
): Player[] {
  const candidates = aiPlayers(game).filter((ai) => {
    if (ai.id === senderId) return false;
    return group.kind === "public" || group.memberIds.includes(ai.id);
  });
  if (candidates.length === 0) return [];
  if (group.kind === "custom") return candidates;

  const joined = texts.join(" ");
  const mentioned = candidates.filter((ai) => joined.includes(ai.name));
  if (mentioned.length > 0) {
    return mentioned.slice(0, 3);
  }
  // 没有点名时挑 2 名相关 AI（如领跑者/顺位轮转），避免每次全场 5 个 AI 同时刷屏
  const seed = `${game.globalRound}:${joined.slice(0, 24)}:${(game.groupMessages ?? []).length}`;
  const start = seed.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
  const rotated: Player[] = [];
  for (let i = 0; i < candidates.length && rotated.length < 2; i++) {
    rotated.push(candidates[(start + i) % candidates.length]);
  }
  return rotated;
}

/** 真人在全场或自定义群发消息后，触发 AI 思考并回应或保持沉默。 */
export function handleAiGroupMessage(
  game: GameState,
  groupId: string,
  senderId: string,
  text: string,
  io: Server | null
): void {
  if (game.isLabExperiment) return;
  if (!AI_BOT_ENABLED || !AI_CONFIG.chatEnabled || !GROUP_CHAT_ENABLED) return;
  if (!isChatPhaseAllowed(game)) return;
  if ((game.safetyCrisisUntil ?? 0) > now()) return;
  const sender = game.players.find((p) => p.id === senderId);
  const group = (game.chatGroups ?? []).find((g) => g.id === groupId);
  if (!sender || isAiPlayer(sender) || !group) return;
  const cleanText = String(text ?? "").trim().slice(0, 160);
  if (!cleanText || detectCrisisSignals(cleanText).risk) return;

  const state = getRoomState(game);
  const channelKey = `group:${groupId}`;
  clearChannelSilentStatuses(game, channelKey);

  const previewResponders = selectGroupResponders(game, group, [cleanText], senderId);
  for (const ai of previewResponders) {
    const cfg = modelConfigFor(ai);
    if (cfg && hasUsableBudget(state, ai, game)) {
      setAiChatStatus(game, channelKey, ai, "thinking", io, false);
    }
  }
  if (io && previewResponders.length > 0) broadcastUpdate(io, game);

  let batch = state.groupBatches.get(groupId);
  if (!batch) {
    batch = {
      senderId,
      senderName: sender.name,
      texts: [],
      firstAt: now(),
      timer: null,
    };
    state.groupBatches.set(groupId, batch);
  }
  batch.senderId = senderId;
  batch.senderName = sender.name;
  batch.texts.push(cleanText);
  if (batch.timer) clearTimeout(batch.timer);

  batch.timer = setTimeout(() => {
    const active = state.groupBatches.get(groupId);
    if (!active) return;
    state.groupBatches.delete(groupId);
    void processAiGroupBatch(game, groupId, active, io);
  }, AI_CONFIG.groupDebounceMs);
}

async function processAiGroupBatch(
  game: GameState,
  groupId: string,
  batch: PendingGroupBatch,
  io: Server | null
): Promise<void> {
  const state = getRoomState(game);
  const originPhaseKey = phaseKey(game);
  const channelKey = `group:${groupId}`;
  const group = (game.chatGroups ?? []).find((g) => g.id === groupId);
  if (!group) return;

  const responders = selectGroupResponders(game, group, batch.texts, batch.senderId);
  const prunedStaleThinking = pruneGroupThinkingStatuses(
    game,
    channelKey,
    new Set(responders.map((r) => r.id))
  );
  if (responders.length === 0) {
    if (prunedStaleThinking && io) broadcastUpdate(io, game);
    return;
  }

  // 确保全部候选进入 thinking
  for (const ai of responders) {
    const cfg = modelConfigFor(ai);
    if (cfg && hasUsableBudget(state, ai, game)) {
      setAiChatStatus(game, channelKey, ai, "thinking", io, false);
    }
  }
  if (io) broadcastUpdate(io, game);

  const joinedText = batch.texts.join(" ");
  let stepIndex = 0;
  let repliedInBatch = 0;

  // 错峰依次回复，使后思考的 AI 能看到前一个 AI 的发言并决定接话还是保持沉默
  for (const ai of responders) {
    try {
      if (!isChatPhaseAllowed(game) || (game.safetyCrisisUntil ?? 0) > now()) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        continue;
      }
      if (!game.players.some((p) => p.id === ai.id)) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        continue;
      }
      const cfg = modelConfigFor(ai);
      if (!cfg || !hasUsableBudget(state, ai, game)) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        continue;
      }

      const callStart = now();
      const addressedToMe = joinedText.includes(ai.name);
      const obs = buildAiObservation(game, ai);
      const groupMemDigest = syncSettlementMemories(game, ai, state);
      const result = await askAiJson(
        buildSystemPrompt(profileForPlayer(ai)),
        buildGroupChatReplyPrompt(
          obs,
          {
            groupId: group.id,
            groupName: group.name,
            isPublic: group.kind === "public",
            triggerSenderName: batch.senderName,
            recentTriggerTexts: batch.texts,
            addressedToMe,
            alreadyRepliedCount: repliedInBatch,
          },
          groupMemDigest
        ),
        {
          label: group.kind === "public" ? "public-chat-reply" : "group-chat-reply",
          timeoutMs: Math.max(DM_REPLY_TIMEOUT_MS, AI_CONFIG.decisionTimeoutMs),
          maxRetries: 1,
          disableThinking: true,
          maxOutputTokens: 1_500,
          config: cfg,
        }
      );

      const minWait =
        stepIndex === 0
          ? AI_CONFIG.groupChatDelayMinMs
          : Math.min(2_200, AI_CONFIG.groupChatDelayMinMs);
      const maxWait =
        stepIndex === 0
          ? AI_CONFIG.groupChatDelayMaxMs
          : Math.min(3_500, AI_CONFIG.groupChatDelayMaxMs);
      await ensureMinimumElapsed(stepIndex === 0 ? batch.firstAt : callStart, minWait, maxWait);
      stepIndex += 1;

      if (!isChatPhaseAllowed(game) || phaseKey(game) !== originPhaseKey || (game.safetyCrisisUntil ?? 0) > now()) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        continue;
      }
      if (!result.ok || !result.data) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        continue;
      }

      markAiPreflightOk(ai);
      recordTokens(state, ai, result.usage?.totalTokens, game);
      const parsed = result.data as {
        silent?: unknown;
        reply?: unknown;
        unlockToReinvest?: unknown;
        reasoning?: unknown;
      };
      const wantsSilent = parsed.silent === true;
      const rawReply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 80) : "";

      let posted = false;
      if (!wantsSilent && rawReply) {
        posted =
          group.kind === "public"
            ? sendAiChat(game, ai, rawReply)
            : sendAiGroupChat(game, ai, group.id, rawReply);
      }

      if (posted) {
        repliedInBatch += 1;
        setAiChatStatus(game, channelKey, ai, "clear", io);
        if (io) {
          for (const targetId of group.memberIds) {
            if (targetId === ai.id) continue;
            const target = game.players.find((p) => p.id === targetId);
            if (target?.socketId) {
              io.to(target.socketId).emit("playerNotify", {
                type: "chat",
                message: `${group.name} · ${ai.name}：${rawReply.slice(0, 48)}`,
              });
            }
          }
        }
      } else {
        setAiChatStatus(game, channelKey, ai, "silent", io);
      }

      recordAiDecision(game, ai, {
        kind: "group_chat",
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
        summary: posted
          ? `[${group.kind === "public" ? "全场" : group.name}] 「${rawReply.slice(0, 32)}」`
          : `[${group.kind === "public" ? "全场" : group.name}] 保持沉默`,
        model: cfg.model,
        totalTokens: result.usage?.totalTokens,
        latencyMs: result.latencyMs,
      });
      if (posted) {
        getAiMemory(state, ai.id).record(
          "social",
          `[${group.kind === "public" ? "全场" : group.name}] ${batch.senderName}说后我回：「${rawReply.slice(0, 40)}」`,
          { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
        );
      }

      if (parsed.unlockToReinvest === true) {
        triggerAiUnlockAndReinvest(game, ai, state, io, "群聊协商");
      }
    } catch (error) {
      setAiChatStatus(game, channelKey, ai, "clear", io, false);
      logWarn(
        state,
        `${ai.name} 群聊回复失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (io) broadcastUpdate(io, game);
}

/** 真人建群并拉入 AI 后，AI 成员顺序错峰选择冒泡打招呼或保持沉默。 */
export function handleAiGroupCreated(
  game: GameState,
  group: ChatGroup,
  creatorId: string,
  io: Server | null
): void {
  if (game.isLabExperiment) return;
  if (!AI_BOT_ENABLED || !AI_CONFIG.chatEnabled || !GROUP_CHAT_ENABLED) return;
  if (!isChatPhaseAllowed(game)) return;
  if ((game.safetyCrisisUntil ?? 0) > now()) return;
  const creator = game.players.find((p) => p.id === creatorId);
  if (!creator || isAiPlayer(creator)) return;

  const aiMembers = aiPlayers(game).filter((ai) => group.memberIds.includes(ai.id));
  if (aiMembers.length === 0) return;

  const state = getRoomState(game);
  const originPhaseKey = phaseKey(game);
  const channelKey = `group:${group.id}`;
  for (const ai of aiMembers) {
    const cfg = modelConfigFor(ai);
    if (cfg && hasUsableBudget(state, ai, game)) {
      setAiChatStatus(game, channelKey, ai, "thinking", io, false);
    }
  }
  if (io) broadcastUpdate(io, game);

  void (async () => {
    const memberNames = group.memberIds.map(
      (id) => game.players.find((p) => p.id === id)?.name ?? id
    );
    const createdAt = now();
    let repliedInWelcome = 0;

    for (let idx = 0; idx < aiMembers.length; idx++) {
      const ai = aiMembers[idx];
      const stepStart = idx === 0 ? createdAt : now();
      try {
        if (!isChatPhaseAllowed(game) || (game.safetyCrisisUntil ?? 0) > now()) {
          setAiChatStatus(game, channelKey, ai, "clear", io, false);
          continue;
        }
        const cfg = modelConfigFor(ai);
        if (!cfg || !hasUsableBudget(state, ai, game)) {
          setAiChatStatus(game, channelKey, ai, "clear", io, false);
          continue;
        }
        const result = await askAiJson(
          buildSystemPrompt(profileForPlayer(ai)),
          buildGroupWelcomePrompt(buildAiObservation(game, ai), {
            id: group.id,
            name: group.name,
            creatorName: creator.name,
            memberNames,
            alreadyRepliedCount: repliedInWelcome,
          }),
          {
            label: "group-welcome",
            timeoutMs: Math.max(DM_REPLY_TIMEOUT_MS, AI_CONFIG.decisionTimeoutMs),
            maxRetries: 1,
            disableThinking: true,
            maxOutputTokens: 1_500,
            config: cfg,
          }
        );
        await ensureMinimumElapsed(
          stepStart,
          idx === 0 ? 1_800 : 800,
          idx === 0 ? 3_200 : 1_800
        );

        if (!result.ok || !result.data || !isChatPhaseAllowed(game) || phaseKey(game) !== originPhaseKey) {
          setAiChatStatus(game, channelKey, ai, "clear", io, false);
          continue;
        }
        markAiPreflightOk(ai);
        recordTokens(state, ai, result.usage?.totalTokens, game);
        const parsed = result.data as {
          silent?: unknown;
          reply?: unknown;
          unlockToReinvest?: unknown;
          reasoning?: unknown;
        };
        const rawReply = typeof parsed.reply === "string" ? parsed.reply.trim().slice(0, 80) : "";
        const posted = parsed.silent !== true && rawReply && sendAiGroupChat(game, ai, group.id, rawReply);
        if (posted) {
          repliedInWelcome += 1;
          setAiChatStatus(game, channelKey, ai, "clear", io);
          if (io) {
            for (const targetId of group.memberIds) {
              if (targetId === ai.id) continue;
              const target = game.players.find((p) => p.id === targetId);
              if (target?.socketId) {
                io.to(target.socketId).emit("playerNotify", {
                  type: "chat",
                  message: `${group.name} · ${ai.name}：${rawReply.slice(0, 48)}`,
                });
              }
            }
          }
        } else {
          setAiChatStatus(game, channelKey, ai, "silent", io);
        }
        recordAiDecision(game, ai, {
          kind: "group_welcome",
          reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
          summary: posted
            ? `入群[${group.name}]：「${rawReply.slice(0, 32)}」`
            : `入群[${group.name}] 保持沉默`,
          model: cfg.model,
          totalTokens: result.usage?.totalTokens,
          latencyMs: result.latencyMs,
        });
        if (parsed.unlockToReinvest === true) {
          triggerAiUnlockAndReinvest(game, ai, state, io, "新群协商");
        }
      } catch (error) {
        setAiChatStatus(game, channelKey, ai, "clear", io, false);
        logWarn(
          state,
          `${ai.name} 建群反应失败：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    if (io) broadcastUpdate(io, game);
  })();
}

/** 公开发言：只在群聊开启时发送；所有文本先过安全闸门。 */
function sendAiChat(game: GameState, ai: Player, text: string): boolean {
  if (!GROUP_CHAT_ENABLED || !AI_CONFIG.chatEnabled) return false;
  const group = (game.chatGroups ?? []).find((g) => g.kind === "public");
  if (!group) return false;
  let clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return false;

  let crisisReply = false;
  if (AI_SAFETY_ENABLED) {
    crisisReply = isCrisisReply(clean);
    if (crisisReply) {
      if (now() - (game.lastAiSafetyReplyAt ?? 0) < SAFETY_REPLY_COOLDOWN_MS) {
        return false;
      }
    } else if ((game.safetyCrisisUntil ?? 0) > now()) {
      return false;
    }
    const guarded = guardAgentOutput(clean, "chat");
    if (!guarded.text) return false;
    clean = guarded.text;
  } else {
    clean = clean.slice(0, 80);
  }

  const result = sendGroupChatMessage(game, ai.id, group.id, clean, undefined, {
    allowAi: true,
  });
  if (!result.ok) return false;
  if (crisisReply) {
    const at = now();
    game.lastAiSafetyReplyAt = at;
    game.lastSafetyNoticeAt = at;
    game.safetyCrisisUntil = Math.max(
      game.safetyCrisisUntil ?? 0,
      at + SAFETY_CRISIS_WINDOW_MS
    );
  }
  appendSessionEvent(
    game,
    "group_message",
    { groupId: group.id, messageId: result.message.id, fromId: ai.id, source: "ai" },
    ai.id
  );
  return true;
}

/** AI 在自己被拉入的自定义群里发言。 */
function sendAiGroupChat(game: GameState, ai: Player, groupId: string, text: string): boolean {
  if (!GROUP_CHAT_ENABLED || !AI_CONFIG.chatEnabled) return false;
  const group = (game.chatGroups ?? []).find(
    (g) => g.id === groupId && g.kind === "custom"
  );
  if (!group || !group.memberIds.includes(ai.id)) return false;
  let clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  if (AI_SAFETY_ENABLED) {
    if ((game.safetyCrisisUntil ?? 0) > now()) return false;
    const guarded = guardAgentOutput(clean, "chat");
    if (!guarded.text) return false;
    clean = guarded.text;
  } else {
    clean = clean.slice(0, 80);
  }
  const result = sendGroupChatMessage(game, ai.id, group.id, clean, undefined, {
    allowAi: true,
  });
  if (!result.ok) return false;
  appendSessionEvent(
    game,
    "group_message",
    { groupId: group.id, messageId: result.message.id, fromId: ai.id, source: "ai" },
    ai.id
  );
  return true;
}

function applyInvestmentPlan(
  game: GameState,
  ai: Player,
  plan: AiInvestmentPlan,
  state: AiRoomState,
  io: Server | null = null
): boolean {
  if (!INVEST_PHASES.has(game.phase) || ai.ready) return false;
  let acted = false;

  // 1) 咖啡：先加精力，后面投资预算才够
  const wantedCoffee = Math.max(0, Math.min(2, Math.floor(Number(plan.coffee) || 0)));
  for (let i = 0; i < wantedCoffee; i++) {
    const result = purchaseCoffee(game, ai);
    if (!result.ok) break;
    acted = true;
  }

  // 2) 道具：支持单轮连打多张手牌（先点石成金/劳逸结合，再打彩票/摸鱼等），失败不阻塞
  const rawBuffPlans =
    plan.useCards && plan.useCards.length > 0
      ? plan.useCards
      : plan.useCard
        ? [plan.useCard]
        : [];
  if (rawBuffPlans.length > 0 && AI_CONFIG.buffEnabled && !isInvestmentBuffLockoutActive(game)) {
    const buffOrder = (cardId: string) =>
      cardId === "buff_gold" ? 0 : cardId === "buff_work_rest" ? 1 : cardId === "buff_lottery" ? 2 : 3;
    const orderedBuffs = [...rawBuffPlans].sort((a, b) => buffOrder(a.cardId) - buffOrder(b.cardId));
    for (const cardPlan of orderedBuffs) {
      const visibility: LotteryVisibility | undefined =
        cardPlan.cardId === "buff_lottery"
          ? cardPlan.visibility === "private"
            ? "private"
            : "public"
          : undefined;
      const result = useBuffCard(game, ai.id, cardPlan.cardId, {
        targetPlayerId: cardPlan.targetPlayerId,
        targetProjectId: cardPlan.targetProjectId,
        burnCardId: cardPlan.burnCardId,
        visibility,
      });
      if (result.success) {
        if (!ai.usedCards) ai.usedCards = [];
        ai.usedCards.push(cardPlan.cardId);
        state.buffRound.set(ai.id, game.globalRound);
        acted = true;
        if (cardPlan.cardId === "buff_lottery") {
          triggerAiLotteryDraw(game, ai, io);
        }
        if (result.notifyTargetId && result.notifyTargetMsg) {
          const target = game.players.find((p) => p.id === result.notifyTargetId);
          if (target?.socketId && !isAiPlayer(target) && target.id !== ai.id) {
            io?.to(target.socketId).emit("playerNotify", {
              type: result.investmentAutoUnlocked ? "investment" : "buff_hit",
              message: result.notifyTargetMsg,
            });
          }
          if (result.investmentAutoUnlocked && target && isAiPlayer(target) && target.id !== ai.id) {
            setTimeout(() => void handleAIPhase(game, io), 150);
          }
        }
      }
    }
  }

  // 3) 拉群：每轮最多一次，和真人使用同一套建群规则
  if (
    plan.createGroup &&
    state.groupCreateRound.get(ai.id) !== game.globalRound
  ) {
    const groupName = AI_SAFETY_ENABLED
      ? guardAgentOutput(String(plan.createGroup.name ?? ""), "groupName").text
      : plan.createGroup.name;
    const result = createCustomChatGroup(
      game,
      ai.id,
      plan.createGroup.memberIds,
      groupName
    );
    if (result.ok) {
      state.groupCreateRound.set(ai.id, game.globalRound);
      acted = true;
      appendSessionEvent(
        game,
        "chat_group_created",
        {
          groupId: result.group.id,
          name: result.group.name,
          memberIds: result.group.memberIds,
          source: "ai",
        },
        ai.id
      );
      game.logs.push(`👥 ${ai.name} 创建了群聊「${result.group.name}」`);
    }
  }

  // 4) 聊天：每轮最多一条公开消息 + 一条群消息
  if (plan.messages?.length && state.chatRound.get(ai.id) !== game.globalRound) {
    if (sendAiChat(game, ai, plan.messages[0])) {
      state.chatRound.set(ai.id, game.globalRound);
      acted = true;
    }
  }
  if (
    plan.groupMessages?.length &&
    state.groupChatRound.get(ai.id) !== game.globalRound
  ) {
    const groupPlan = plan.groupMessages[0];
    if (sendAiGroupChat(game, ai, groupPlan.groupId, groupPlan.text)) {
      state.groupChatRound.set(ai.id, game.globalRound);
      acted = true;
    }
  }

  // 5) 转账
  if (plan.transfer) {
    if (createAiTransfer(game, ai, plan.transfer.toPlayerId, plan.transfer.amount, plan.transfer.note)) {
      acted = true;
    }
  }

  // 6) 投资：按「当前实际精力」再裁剪一次（咖啡/摸鱼都可能改变精力）
  if (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE") {
    const sanitized = sanitizeInvestments(game, ai, plan.investment ?? {});
    const applied = applyInvestments(game, ai.id, sanitized, "ai");
    if (!applied) applyInvestments(game, ai.id, {}, "ai");
    acted = true;
  }

  if (!ai.ready) {
    togglePlayerReady(game, ai.id);
    appendSessionEvent(
      game,
      "player_ready",
      { phase: game.phase, globalRound: game.globalRound, source: "ai" },
      ai.id
    );
    acted = true;
  }
  return acted;
}

function recentPublicCrisis(game: GameState, at: number): boolean {
  const group = (game.chatGroups ?? []).find((g) => g.kind === "public");
  if (!group) return false;
  const cutoff = at - SAFETY_CRISIS_WINDOW_MS;
  return (game.groupMessages ?? [])
    .filter(
      (m) =>
        m.groupId === group.id &&
        m.fromId !== SAFETY_NOTICE_FROM_ID &&
        m.timestamp >= cutoff
    )
    .slice(-12)
    .some((m) => detectCrisisSignals(m.text).risk);
}

export function applyCrisisProtocol(
  game: GameState,
  plan: AiInvestmentPlan,
  at: number = now()
): void {
  if (!AI_SAFETY_ENABLED) return;
  if (recentPublicCrisis(game, at) && (game.safetyCrisisUntil ?? 0) <= at) {
    game.safetyCrisisUntil = at + SAFETY_CRISIS_WINDOW_MS;
  }
  if ((game.safetyCrisisUntil ?? 0) <= at) return;
  plan.messages = [];
  if (plan.transfer) plan.transfer.note = "";
  if (at - (game.lastAiSafetyReplyAt ?? 0) >= SAFETY_REPLY_COOLDOWN_MS) {
    plan.messages = [CRISIS_REPLY];
  }
}

function investmentContextSignature(game: GameState, ai: Player): string {
  // 仅追踪个人账本、直达私聊/转账以及本人所在的自定义小群动态；避免全场闲聊刷屏引发全桌 AI 重复重算
  const privateGroupIds = new Set(
    (game.chatGroups ?? [])
      .filter((g) => g.kind !== "public" && g.memberIds.includes(ai.id))
      .map((g) => g.id)
  );
  const lastTxTs = (game.transactions ?? [])
    .filter((t) => t.toId === ai.id && (t.status === "pending" || t.amount === 0))
    .reduce((m, t) => Math.max(m, t.timestamp), 0);
  const lastPrivateGroupTs = (game.groupMessages ?? [])
    .filter((m) => m.fromId !== ai.id && privateGroupIds.has(m.groupId))
    .reduce((m, msg) => Math.max(m, msg.timestamp), 0);
  const lastFeedTs = (game.publicFeed ?? []).reduce((m, item) => Math.max(m, item.timestamp), 0);
  return [
    spendableEnergy(ai),
    ai.wealth,
    (ai.inventory ?? []).length,
    (ai.activeBuffs ?? []).map((b) => b.cardId).join(","),
    lastTxTs,
    lastPrivateGroupTs,
    lastFeedTs,
  ].join("|");
}

async function decideInvestmentPlan(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState
): Promise<{
  plan: AiInvestmentPlan | null;
  usedLlm: boolean;
  failure?: string;
  totalTokens?: number;
  latencyMs?: number;
}> {
  const modelConfig = modelConfigFor(ai);
  // normal/hard 默认开启轻度思考，超时自动切极速重试；easy 或 AI_INVEST_THINKING=false 保持极速。
  const explicitInvestThink = (process.env.AI_INVEST_THINKING ?? "").trim().toLowerCase();
  const useLightThinking =
    explicitInvestThink === "false"
      ? false
      : explicitInvestThink === "true" || profile.difficulty !== "easy";
  if (!modelConfig) {
    if (pausesOnAiFailure(game)) {
      return { plan: null, usedLlm: false, failure: "该座位未配置可用模型" };
    }
  } else if (hasUsableBudget(state, ai, game)) {
    const observation = buildAiObservation(game, ai);
    const memDigest = syncSettlementMemories(game, ai, state);
    const investPrompt = buildInvestmentPrompt(observation, profile, memDigest);
    const result = await askProductAiWithFallback(buildSystemPrompt(profile), investPrompt, {
      config: modelConfig,
      label: `invest-r${game.globalRound}`,
      thinking: useLightThinking
        ? {
            thinkingBudget: profile.difficulty === "hard" ? 896 : 384,
            reasoningEffort: "low",
            timeoutMs: Math.min(20_000, Math.max(15_000, AI_CONFIG.decisionTimeoutMs)),
            maxOutputTokens: 4_096,
          }
        : undefined,
      fast: {
        timeoutMs: Math.max(20_000, Math.min(25_000, AI_CONFIG.decisionTimeoutMs)),
        maxRetries: 1,
        maxOutputTokens: 3_000,
      },
    });
    if (result.ok && result.data) {
      markAiPreflightOk(ai);
      recordTokens(state, ai, result.usage?.totalTokens, game);
      let totalTokens = result.usage?.totalTokens ?? 0;
      let latencyMs = result.latencyMs ?? 0;
      const sanitized = sanitizeInvestmentPlan(
        game,
        ai,
        result.data as Partial<AiInvestmentPlan>,
        profile
      );
      if (sumInvestment(sanitized.investment) <= 0 && spendableEnergy(ai) > 0) {
        if (AI_CONFIG.strictAgent) {
          if (hasUsableBudget(state, ai, game)) {
            const retry = await askAiJson(
              buildSystemPrompt(profile),
              [
                buildInvestmentPrompt(buildAiObservation(game, ai), profile, memDigest),
                "",
                "## 纠正",
                `上一次输出没有给任何项目分配精力，但你现在还有 ${spendableEnergy(ai)} 点可用精力。`,
                "本轮必须在 investment 中至少投入 1 点精力（若已经买咖啡等把精力用光，可以留空）。只输出 JSON。",
              ].join("\n"),
              {
                label: `invest-r${game.globalRound}-retry`,
                config: modelConfig,
                disableThinking: true,
                maxOutputTokens: 2_500,
              }
            );
            if (retry.ok && retry.data) {
              markAiPreflightOk(ai);
              recordTokens(state, ai, retry.usage?.totalTokens, game);
              totalTokens += retry.usage?.totalTokens ?? 0;
              latencyMs += retry.latencyMs ?? 0;
              const retryPlan = sanitizeInvestmentPlan(
                game,
                ai,
                retry.data as Partial<AiInvestmentPlan>,
                profile
              );
              if (sumInvestment(retryPlan.investment) > 0) {
                return { plan: retryPlan, usedLlm: true, totalTokens, latencyMs };
              }
            }
          }
          if (pausesOnAiFailure(game)) {
            return { plan: null, usedLlm: true, failure: "模型没有给出有效投资方案" };
          }
          logWarn(state, `${ai.name} 模型两次都没有分配精力，改用本地保守方案`);
        }
        const fallback = buildFallbackInvestmentPlan(game, ai, profile);
        sanitized.investment = fallback.investment;
        if (sanitized.coffee <= 0) sanitized.coffee = fallback.coffee;
      }
      return { plan: sanitized, usedLlm: true, totalTokens, latencyMs };
    }
    const reason = result.error ?? "模型未返回有效 JSON";
    if (pausesOnAiFailure(game)) {
      return { plan: null, usedLlm: false, failure: reason };
    }
    logWarn(state, `${ai.name} 模型失败，改用本地策略：${reason}`);
  }
  if (pausesOnAiFailure(game)) {
    return { plan: null, usedLlm: false, failure: "本局 token 预算已用尽或模型不可用" };
  }
  return { plan: buildFallbackInvestmentPlan(game, ai, profile), usedLlm: false };
}

async function runInvestmentTurn(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState,
  io: Server | null
): Promise<boolean> {
  await politeDelay(1);
  if (!INVEST_PHASES.has(game.phase) || ai.ready) return false;
  if (!game.players.some((p) => p.id === ai.id)) return false;
  if (
    AI_CONFIG.investStaggerMaxMs > 0 &&
    hasUnreadyConnectedHuman(game) &&
    getInvestmentRemainingMs(game) > 60_000
  ) {
    const slotBase = Math.max(0, (ai.aiSlot ?? 1) - 1);
    const maxStagger = AI_CONFIG.investStaggerMaxMs;
    const perSlot = Math.floor((maxStagger * Math.min(slotBase, 4)) / 5);
    const jitter = randomBetween(0, Math.max(100, Math.floor(maxStagger / 4)));
    await sleep(Math.min(maxStagger, perSlot + jitter));
    if (!INVEST_PHASES.has(game.phase) || ai.ready) return false;
    if (!game.players.some((p) => p.id === ai.id)) return false;
  }

  const hasModel = Boolean(modelConfigFor(ai));
  if (hasModel) setAiTurnStatus(game, ai, "thinking", io);
  try {
    const snapSig = investmentContextSignature(game, ai);
    let decision = await decideInvestmentPlan(game, ai, profile, state);
    if (!game.players.some((p) => p.id === ai.id)) return false;

    // 思考中途若收到新私信/转账/群聊/摸鱼/公开动态且剩余时间充足，刷新一次基于最新局面的决策（每轮最多 1 次）
    const refreshes = state.contextRefreshCount.get(ai.id) ?? 0;
    if (
      hasModel &&
      decision.plan &&
      refreshes < 1 &&
      INVEST_PHASES.has(game.phase) &&
      !ai.ready &&
      getInvestmentRemainingMs(game) > 45_000 &&
      investmentContextSignature(game, ai) !== snapSig
    ) {
      state.contextRefreshCount.set(ai.id, refreshes + 1);
      logDebug(`invest refresh ${ai.name}: context updated while thinking`);
      const refreshed = await decideInvestmentPlan(game, ai, profile, state);
      if (refreshed.plan) decision = refreshed;
      if (!game.players.some((p) => p.id === ai.id)) return false;
    }

    const { plan, usedLlm, failure, totalTokens, latencyMs } = decision;
    if (!plan) {
      state.forced.add(ai.id);
      recordAiFailure(game, ai, io, failure ?? "模型决策失败", "model_error");
      return false;
    }
    applyCrisisProtocol(game, plan);
    if (!INVEST_PHASES.has(game.phase) || ai.ready) return false;

    const acted = applyInvestmentPlan(game, ai, plan, state, io);
    if (usedLlm) {
      const investPairs = Object.entries(plan.investment ?? {})
        .filter(([, v]) => Number(v) > 0)
        .map(([pid, v]) => {
          const proj = game.activeProjects.find((p) => p.id === Number(pid));
          return `${proj?.name ?? `#${pid}`}:${v}`;
        });
      const summaryParts: string[] = [];
      if (investPairs.length > 0) summaryParts.push(`投 ${investPairs.join("、")}`);
      if ((plan.coffee ?? 0) > 0) summaryParts.push(`咖啡×${plan.coffee}`);
      const cards = plan.useCards?.length ? plan.useCards : plan.useCard ? [plan.useCard] : [];
      if (cards.length > 0) summaryParts.push(`道具 ${cards.map((c) => c.cardId).join("、")}`);
      if (plan.transfer && plan.transfer.amount > 0) summaryParts.push(`转账 ${plan.transfer.amount}`);
      recordAiDecision(game, ai, {
        kind: "investment",
        reasoning: plan.reasoning || "",
        summary: summaryParts.join(" · ") || "空过本轮",
        totalTokens,
        latencyMs,
      });
      getAiMemory(state, ai.id).record(
        "action",
        summaryParts.join("；") || "本轮未分配精力",
        { globalRound: game.globalRound, era: game.currentEra, roundInEra: game.roundInEra }
      );
    }
    if (usedLlm && plan.reasoning) {
      appendSessionEvent(
        game,
        "ai_action",
        {
          kind: "investment",
          reasoning: plan.reasoning,
          investment: plan.investment,
          coffee: plan.coffee,
          useCard: plan.useCard,
          useCards: plan.useCards ?? [],
          transfer: plan.transfer,
          createGroup: plan.createGroup ?? null,
          groupMessages: plan.groupMessages ?? [],
          source: "llm",
        },
        ai.id
      );
    }
    if (io) broadcastUpdate(io, game);
    return acted;
  } finally {
    setAiTurnStatus(game, ai, "idle", io);
  }
}

function normalizeAuctionPlan(raw: unknown): AiAuctionPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<AiAuctionPlan>;
  const action = data.action;
  if (action !== "bid" && action !== "pass" && action !== "force_buy") return null;
  const amount = Number(data.amount);
  if (action === "bid" && (!Number.isFinite(amount) || amount <= 0)) return null;
  return {
    action,
    ...(action === "bid" ? { amount } : {}),
    reasoning: typeof data.reasoning === "string" ? data.reasoning.slice(0, 200) : "",
  };
}

async function decideAuctionPlan(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState
): Promise<{
  plan: AiAuctionPlan | null;
  usedLlm: boolean;
  failure?: string;
  totalTokens?: number;
  latencyMs?: number;
}> {
  const modelConfig = modelConfigFor(ai);
  if (modelConfig && hasUsableBudget(state, ai, game)) {
    const observation = buildAiObservation(game, ai);
    const memDigest = syncSettlementMemories(game, ai, state);
    const useHardThinking =
      profile.difficulty === "hard" &&
      (process.env.AI_INVEST_THINKING ?? "").trim().toLowerCase() !== "false";
    const result = await askProductAiWithFallback(
      buildSystemPrompt(profile),
      buildAuctionPrompt(observation, profile, memDigest),
      {
        config: modelConfig,
        label: `auction-e${game.currentEra}`,
        thinking: useHardThinking
          ? {
              thinkingBudget: 384,
              reasoningEffort: "low",
              timeoutMs: 12_000,
              maxOutputTokens: 1_800,
            }
          : undefined,
        fast: {
          timeoutMs: 10_000,
          maxRetries: 0,
          maxOutputTokens: 1_500,
        },
      }
    );
    if (result.ok && result.data) {
      const plan = normalizeAuctionPlan(result.data);
      if (plan) {
        markAiPreflightOk(ai);
        recordTokens(state, ai, result.usage?.totalTokens, game);
        return {
          plan,
          usedLlm: true,
          totalTokens: result.usage?.totalTokens,
          latencyMs: result.latencyMs,
        };
      }
      if (AI_CONFIG.strictAgent) {
        return { plan: null, usedLlm: true, failure: "模型返回了不合法的拍卖动作" };
      }
    } else if (AI_CONFIG.strictAgent) {
      return { plan: null, usedLlm: false, failure: result.error ?? "拍卖模型调用失败" };
    }
  } else if (AI_CONFIG.strictAgent) {
    return {
      plan: null,
      usedLlm: false,
      failure: modelConfig ? "本局 token 预算已用尽" : "该座位未配置可用模型",
    };
  }
  if (AI_CONFIG.strictAgent) {
    return { plan: null, usedLlm: false, failure: "严格模式下不允许本地拍卖策略" };
  }
  return { plan: chooseAuctionAction(game, ai, profile, 0), usedLlm: false };
}

/** 串行化同房间内的拍卖决策，彻底消除多名 AI 并发抢同一口最低价的竞态。 */
function enqueueAuctionRoomStep<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = AUCTION_ROOM_SERIAL.get(roomId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  AUCTION_ROOM_SERIAL.set(
    roomId,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

async function runAuctionTurn(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState,
  io: Server | null
): Promise<boolean> {
  if (!AI_CONFIG.auctionEnabled) return false;
  const focus = game.auctionFocusCardId;
  if (!focus || game.phase !== "AUCTION") return false;

  return enqueueAuctionRoomStep(game.roomId, async () => {
    if (!AI_ROOMS.has(game.roomId)) return false;
    if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus) return false;
    const lotKey = `${game.currentEra}:${focus}`;
    let lot = state.auction.get(ai.id);
    if (!lot || lot.lotKey !== lotKey) {
      lot = { lotKey, decisions: 0, passed: false, doneSignature: "" };
      state.auction.set(ai.id, lot);
    }
    if (lot.passed) return false;
    const signature = auctionSignature(game);
    if (lot.doneSignature === signature) return false;
    if (lot.decisions >= AI_CONFIG.auctionMaxDecisions) {
      lot.passed = true;
      return false;
    }

    const leading = getLeadingBidOnFocus(game);
    if (leading?.playerId === ai.id) {
      lot.doneSignature = signature;
      return false;
    }

    const hasModel = Boolean(modelConfigFor(ai));
    if (hasModel) {
      setAiTurnStatus(game, ai, "thinking", io);
      await sleep(randomBetween(AI_CONFIG.auctionDelayMinMs, AI_CONFIG.auctionDelayMaxMs));
    } else {
      await politeDelay(0.4);
    }

    const isNearAuctionDeadline = () =>
      Boolean(game.autoHostNextActionAt && now() >= game.autoHostNextActionAt - 500);

    try {
      if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus) return false;
      if (isNearAuctionDeadline()) return false;
      const leadingNow = getLeadingBidOnFocus(game);
      if (leadingNow?.playerId === ai.id) {
        lot.doneSignature = auctionSignature(game);
        return false;
      }

      const decided = await decideAuctionPlan(game, ai, profile, state);
      if (!game.players.some((p) => p.id === ai.id)) return false;
      if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus) return false;
      if (isNearAuctionDeadline()) return false;

      if (!decided.plan) {
        state.forced.add(ai.id);
        recordAiFailure(
          game,
          ai,
          io,
          decided.failure ?? "拍卖模型决策失败",
          "model_error"
        );
        return false;
      }
      const plan = decided.plan;
      lot.decisions += 1;
      logDebug(
        `auction ${ai.name} ${focus} action=${plan.action} amount=${plan.amount ?? "-"} decisions=${lot.decisions}`
      );
      let acted = false;

      if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus || isNearAuctionDeadline()) {
        return false;
      }

      if (plan.action === "force_buy") {
        const result = useForceBuyCard(game, ai.id);
        lot.passed = true;
        acted = result.success;
        if (result.success && result.auctionSold && io) {
          io.to(game.roomId).emit("playerNotify", {
            type: "auction_sold",
            message: formatAuctionSoldMessage(game, result.auctionSold),
          });
        }
      } else if (plan.action === "bid" && typeof plan.amount === "number" && Number.isFinite(plan.amount)) {
        const latestMin = getMinimumNextBid(game);
        const plannedAmount = Math.max(0, Math.floor(plan.amount));
        if (plannedAmount >= latestMin) {
          const result = placeAuctionBid(game, ai.id, plannedAmount);
          if (result.ok) {
            acted = true;
          } else {
            lot.passed = true;
            game.logs.push(`⏭️ AI「${ai.name}」无法出价（${result.message ?? "出价无效"}），跳过本张`);
          }
        } else {
          // 严禁私自帮 AI 加价越过其上限；仅当当前最低加价已超其可用财富时直接放弃本张
          if (latestMin > playerAvailableWealth(game, ai)) {
            lot.passed = true;
          }
          game.logs.push(
            `⏭️ AI「${ai.name}」出价 ${plannedAmount} 低于最新最低价 ${latestMin}，不强行加价`
          );
        }
      } else {
        lot.passed = true;
      }

      lot.doneSignature = auctionSignature(game);
      if (decided.usedLlm) {
        const aucSummary =
          plan.action === "bid"
            ? `出价 ${plan.amount} 竞拍 ${focus}`
            : plan.action === "force_buy"
              ? `强买强卖 ${focus}`
              : `放弃竞拍 ${focus}`;
        recordAiDecision(game, ai, {
          kind: "auction",
          reasoning: plan.reasoning || "",
          summary: aucSummary,
          totalTokens: decided.totalTokens,
          latencyMs: decided.latencyMs,
        });
        getAiMemory(state, ai.id).record("action", aucSummary, {
          globalRound: game.globalRound,
          era: game.currentEra,
          roundInEra: game.roundInEra,
        });
      }
      appendSessionEvent(
        game,
        "ai_action",
        { kind: "auction", cardId: focus, action: plan.action, amount: plan.amount ?? null, reasoning: plan.reasoning },
        ai.id
      );
      if (acted) {
        syncAutoAuctionDeadline(game);
      }
      if (io && acted) {
        broadcastUpdate(io, game);
      }
      return acted;
    } finally {
      setAiTurnStatus(game, ai, "idle", io);
    }
  });
}

async function runAiTurn(
  game: GameState,
  ai: Player,
  state: AiRoomState,
  io: Server | null
): Promise<boolean> {
  const profile = profileForPlayer(ai);
  const startPhase = game.phase;
  try {
    const resolved =
      (await resolveAiIncomingTransfers(game, ai, state, io)) ||
      resolveAiLottery(game, ai, io);
    if (game.phase !== startPhase) return resolved;

    if (game.phase === "AUCTION") {
      const acted = await runAuctionTurn(game, ai, profile, state, io);
      return acted || resolved;
    }
    if (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE") {
      if (isOpeningWindowWaiting(game, state)) return resolved;
      const acted = await runInvestmentTurn(game, ai, profile, state, io);
      return acted || resolved;
    }
    if (READY_PHASES.has(game.phase)) {
      if (ai.ready) return resolved;
      if (!READY_PHASES.has(game.phase) || ai.ready) return resolved;
      togglePlayerReady(game, ai.id);
      appendSessionEvent(
        game,
        "player_ready",
        { phase: game.phase, globalRound: game.globalRound, source: "ai" },
        ai.id
      );
      if (io) broadcastUpdate(io, game);
      return true;
    }
    return resolved;
  } catch (error) {
    setAiTurnStatus(game, ai, "idle", io);
    const message = error instanceof Error ? error.message : String(error);
    logWarn(state, `${ai.name} 回合异常：${message}`);
    if (AI_CONFIG.strictAgent) {
      if (READY_PHASES.has(game.phase) && !INVEST_PHASES.has(game.phase) && !ai.ready) {
        togglePlayerReady(game, ai.id);
        if (io) broadcastUpdate(io, game);
      } else {
        state.forced.add(ai.id);
        recordAiFailure(game, ai, io, `回合异常：${message}`, "model_error");
      }
      return false;
    }
    try {
      if (READY_PHASES.has(game.phase) && !ai.ready) {
        togglePlayerReady(game, ai.id);
        if (io) broadcastUpdate(io, game);
      }
    } catch {
      /* ignore */
    }
    return false;
  }
}

export async function ensureAiCommunityNaming(
  game: GameState,
  io: Server | null
): Promise<boolean> {
  if (game.isLabExperiment) return false;
  if (!AI_BOT_ENABLED) return false;
  if (game.phase !== "COMMUNITY_NAMING" || game.communityName) return false;
  const namer = getCommunityNamer(game);
  if (!namer || !isAiPlayer(namer)) return false;
  const namerFailure = game.aiFailures?.[namer.id];
  if (
    AI_CONFIG.strictAgent &&
    namerFailure &&
    (namerFailure.phaseKey ?? namerFailure.phase) === phaseKey(game)
  ) {
    return false;
  }
  const key = `${game.roomId}:${game.sessionId ?? ""}`;
  if (AI_NAMING_IN_FLIGHT.has(key)) return false;
  AI_NAMING_IN_FLIGHT.add(key);
  const state = getRoomState(game);
  try {
    const profile = profileForPlayer(namer);
    let name = "";
    const modelConfig = modelConfigFor(namer);
    if (modelConfig && hasUsableBudget(state, namer, game)) {
      setAiTurnStatus(game, namer, "thinking", io);
      const observation = buildAiObservation(game, namer);
      const result = await askAiJson(
        buildSystemPrompt(profile),
        buildCommunityNamePrompt(observation),
        {
          label: "community-name",
          disableThinking: true,
          maxOutputTokens: 800,
          config: modelConfig,
        }
      );
      setAiTurnStatus(game, namer, "idle", io);
      if (result.ok) {
        markAiPreflightOk(namer);
        recordTokens(state, namer, result.usage?.totalTokens, game);
        const parsedName = result.data as { name?: unknown; reasoning?: unknown } | null;
        const raw = parsedName?.name;
        name = sanitizeCommunityName(raw);
        if (AI_SAFETY_ENABLED) {
          const guarded = guardAgentOutput(name, "name");
          name = guarded.ok ? guarded.text : "";
        }
        if (name) {
          recordAiDecision(game, namer, {
            kind: "community_name",
            reasoning: typeof parsedName?.reasoning === "string" ? parsedName.reasoning : "",
            summary: `命名社区「${name}」`,
            model: modelConfig.model,
            totalTokens: result.usage?.totalTokens,
            latencyMs: result.latencyMs,
          });
          appendSessionEvent(
            game,
            "ai_action",
            { kind: "community_name", name, source: "llm" },
            namer.id
          );
        }
      }
    }
    if (!name) {
      if (AI_CONFIG.strictAgent) {
        state.forced.add(namer.id);
        recordAiFailure(
          game,
          namer,
          io,
          modelConfig ? "模型没有返回合法社区名" : "该座位未配置可用模型",
          "invalid_output"
        );
        return false;
      }
      name = sanitizeCommunityName(chooseCommunityName(game, namer));
    }
    if (!name) name = sanitizeCommunityName(`社区-${game.roomId}`) || "未命名社区";
    if (game.phase === "COMMUNITY_NAMING" && !game.communityName) {
      game.logs.push(`🤖 ${namer.name} 为社区命名：${name}`);
      void finalizeCommunityName(io, game, name, "ai");
      return true;
    }
    return false;
  } catch (error) {
    setAiTurnStatus(game, namer, "idle", io);
    logWarn(state, `AI 社区命名失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    AI_NAMING_IN_FLIGHT.delete(key);
  }
}

export async function handleAIPhase(game: GameState, io: Server | null): Promise<void> {
  if (game.isLabExperiment) return;
  if (!AI_BOT_ENABLED) return;
  try {
    await handleAIPhaseInner(game, io);
  } catch (error) {
    console.error(
      `[ai] handleAIPhase failed (${game.roomId}):`,
      error instanceof Error ? error.stack ?? error.message : error
    );
  }
}

async function handleAIPhaseInner(game: GameState, io: Server | null): Promise<void> {
  const ais = aiPlayers(game);
  if (ais.length === 0) {
    AI_ROOMS.delete(game.roomId);
    return;
  }
  if (game.phase === "COMMUNITY_NAMING") {
    await ensureAiCommunityNaming(game, io);
    return;
  }

  const state = getRoomState(game);
  if (game.phase === "INVESTMENT") {
    ensureOpeningNegotiationWindow(game, state, io);
  }
  const phaseAtStart = game.phase;
  let actedAny = false;
  logDebug(`handleAIPhase phase=${game.phase} ai=${ais.length}`);

  for (;;) {
    const turns: Promise<boolean>[] = [];
    for (const ai of ais) {
      if (isDone(game, ai, state)) continue;
      if (state.inFlight.has(ai.id)) continue;
      if (state.inFlight.size >= AI_CONFIG.maxConcurrentPerRoom) break;
      state.inFlight.set(ai.id, now());
      turns.push(
        runAiTurn(game, ai, state, io).finally(() => {
          state.inFlight.delete(ai.id);
        })
      );
    }
    if (turns.length === 0) break;
    await Promise.allSettled(turns);
    actedAny = true;
    if (game.phase !== phaseAtStart) break;
  }

  if (!actedAny) return;

  tryAdvancePhase(game);
}

export function ensureAiProgress(game: GameState, io: Server | null): boolean {
  if (game.isLabExperiment) return false;
  if (!AI_BOT_ENABLED) return false;
  try {
    return ensureAiProgressInner(game, io);
  } catch (error) {
    console.error(
      `[ai] ensureAiProgress failed (${game.roomId}):`,
      error instanceof Error ? error.stack ?? error.message : error
    );
    return false;
  }
}

function ensureAiProgressInner(game: GameState, io: Server | null): boolean {
  const ais = aiPlayers(game);
  if (ais.length === 0) return false;

  if (game.phase === "COMMUNITY_NAMING") {
    void ensureAiCommunityNaming(game, io);
    return false;
  }

  const state = getRoomState(game);
  const effectiveDecisionTimeout = AI_CONFIG.disableThinking
    ? AI_CONFIG.decisionTimeoutMs
    : Math.max(AI_CONFIG.decisionTimeoutMs, 65_000);
  const effectiveMaxTurn = AI_CONFIG.disableThinking
    ? AI_CONFIG.maxTurnMs
    : Math.max(AI_CONFIG.maxTurnMs, 90_000);
  const openingWait = isOpeningWindowWaiting(game, state);
  const effectivePhaseStart = Math.max(
    state.phaseStartedAt,
    state.openingPhaseKey === state.phaseKey ? state.openingUntil : 0
  );
  const overdue = !openingWait && now() - effectivePhaseStart > effectiveMaxTurn;
  const turnBudget = Math.max(
    effectiveMaxTurn,
    effectiveDecisionTimeout * (AI_CONFIG.maxRetries + 1) + 5_000
  );
  let changed = false;
  let shouldKick = false;

  if (sweepStaleChatThinkingStatuses(game, isChatPhaseAllowed(game) ? 90_000 : 0)) {
    changed = true;
  }

  for (const ai of ais) {
    void resolveAiIncomingTransfers(game, ai, state, io).then((resolved) => {
      if (resolved && io) broadcastUpdate(io, game);
    });
    if (resolveAiLottery(game, ai, io)) changed = true;
  }

  for (const ai of ais) {
    if (game.phase === "AUCTION") {
      if (!AI_CONFIG.auctionEnabled) continue;
      if (isDone(game, ai, state)) continue;
      const startedAt = state.inFlight.get(ai.id);
      if (startedAt != null) {
        if (now() - startedAt <= turnBudget + 5_000) continue;
      } else if (state.inFlight.size > 0) {
        continue;
      } else if (!overdue) {
        if (!state.forced.has(ai.id)) shouldKick = true;
        continue;
      }
      if (AI_CONFIG.strictAgent) {
        if (!state.forced.has(ai.id)) {
          state.forced.add(ai.id);
          recordAiFailure(game, ai, io, "拍卖模型在宽限时间内没有返回", "model_error");
          changed = true;
        }
        continue;
      }
      if (
        game.phase !== "AUCTION" ||
        !game.auctionFocusCardId ||
        (game.autoHostNextActionAt != null && now() >= game.autoHostNextActionAt - 500)
      ) {
        continue;
      }
      const profile = profileForPlayer(ai);
      const lotKey = `${game.currentEra}:${game.auctionFocusCardId ?? "-"}`;
      let lot = state.auction.get(ai.id);
      if (!lot || lot.lotKey !== lotKey) {
        lot = { lotKey, decisions: 0, passed: false, doneSignature: "" };
        state.auction.set(ai.id, lot);
      }
      const plan = chooseAuctionAction(game, ai, profile, lot.decisions);
      lot.decisions += 1;
      if (plan.action === "bid" && typeof plan.amount === "number" && Number.isFinite(plan.amount)) {
        const result = placeAuctionBid(game, ai.id, plan.amount);
        if (result.ok) syncAutoAuctionDeadline(game);
        changed = result.ok || changed;
        if (!result.ok) lot.passed = true;
      } else if (plan.action === "force_buy") {
        const result = useForceBuyCard(game, ai.id);
        if (result.success) syncAutoAuctionDeadline(game);
        changed = result.success || changed;
        lot.passed = true;
        if (result.success && result.auctionSold && io) {
          io.to(game.roomId).emit("playerNotify", {
            type: "auction_sold",
            message: formatAuctionSoldMessage(game, result.auctionSold),
          });
        }
      } else {
        lot.passed = true;
      }
      lot.doneSignature = auctionSignature(game);
      continue;
    }

    if (!READY_PHASES.has(game.phase) || ai.ready) continue;
    if (game.phase === "INVESTMENT" && openingWait) continue;
    const startedAt = state.inFlight.get(ai.id);
    const hardTimeout = startedAt != null && now() - startedAt > turnBudget + 5_000;
    if (startedAt != null) {
      if (!hardTimeout) continue;
    } else if (state.inFlight.size > 0) {
      continue;
    } else if (!overdue) {
      if (!state.forced.has(ai.id)) shouldKick = true;
      continue;
    }
    if (pausesOnAiFailure(game) && INVEST_PHASES.has(game.phase)) {
      if (!state.forced.has(ai.id)) {
        state.forced.add(ai.id);
        recordAiFailure(game, ai, io, "模型在宽限时间内没有完成投资决策", "model_error");
        changed = true;
      }
      continue;
    }
    if (state.forced.has(ai.id)) {
      if (!ai.ready) {
        togglePlayerReady(game, ai.id);
        changed = true;
      }
      continue;
    }

    state.forced.add(ai.id);
    try {
      if (INVEST_PHASES.has(game.phase)) {
        const profile = profileForPlayer(ai);
        const plan = buildFallbackInvestmentPlan(game, ai, profile);
        applyInvestmentPlan(game, ai, plan, state, io);
      } else if (!ai.ready) {
        togglePlayerReady(game, ai.id);
      }
      changed = true;
      appendSessionEvent(
        game,
        "ai_action",
        { kind: "fallback_ready", phase: game.phase, globalRound: game.globalRound },
        ai.id
      );
    } catch {
      if (!ai.ready) {
        togglePlayerReady(game, ai.id);
        changed = true;
      }
    }
  }

  if (shouldKick && now() - state.lastAutoKickAt >= 1_500) {
    state.lastAutoKickAt = now();
    void handleAIPhase(game, io);
  }

  if (changed) {
    tryAdvancePhase(game);
    if (io) broadcastUpdate(io, game);
  }
  return changed;
}

export function forgetAiRoom(roomId: string): void {
  const state = AI_ROOMS.get(roomId);
  if (state) clearTimersInState(state);
  AI_ROOMS.delete(roomId);
  AUCTION_ROOM_SERIAL.delete(roomId);
}

export function forgetAiPlayer(roomId: string, playerId: string): void {
  const state = AI_ROOMS.get(roomId);
  if (!state) return;
  state.inFlight.delete(playerId);
  state.forced.delete(playerId);
  state.auction.delete(playerId);
  state.buffRound.delete(playerId);
  state.chatRound.delete(playerId);
  state.groupChatRound.delete(playerId);
  state.groupCreateRound.delete(playerId);
  state.tokens.delete(playerId);
  state.reinvestingIds.delete(playerId);
  state.memories.delete(playerId);
  state.recordedOutcomeRounds.delete(playerId);
}

export function pruneAiRooms(activeRoomIds: Set<string>): void {
  for (const [roomId, state] of AI_ROOMS.entries()) {
    if (!activeRoomIds.has(roomId)) {
      clearTimersInState(state);
      AI_ROOMS.delete(roomId);
      AUCTION_ROOM_SERIAL.delete(roomId);
    }
  }
}

export function aiRoomDiagnostics(game: GameState) {
  const state = AI_ROOMS.get(game.roomId);
  const aiModels = game.players
    .filter((p) => isAiPlayer(p))
    .map((p) => ({
      id: p.id,
      name: p.name,
      slot: p.aiSlot ?? null,
      model: modelConfigFor(p)?.model ?? null,
      source: modelConfigFor(p)?.source ?? null,
    }));
  return {
    enabled: AI_BOT_ENABLED,
    llmConfigured: isAiModelConfigured() || aiModels.some((m) => m.model !== null),
    aiModels,
    phase: game.phase,
    phaseStartedAt: state?.phaseStartedAt ?? null,
    inFlight: state ? [...state.inFlight.keys()] : [],
    forced: state ? [...state.forced] : [],
    tokens: state ? Object.fromEntries(state.tokens) : {},
  };
}
