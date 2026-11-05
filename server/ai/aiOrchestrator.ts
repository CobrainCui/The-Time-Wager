import type { Server } from "socket.io";
import type { GameState, Player } from "../state/gameState.js";
import { getCommunityNamer } from "../state/gameState.js";
import { AI_BOT_ENABLED, AI_SAFETY_ENABLED } from "../config/features.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import {
  AI_CONFIG,
  isAiModelConfigured,
  resolveAiModelConfigForSlot,
  type AiModelConfig,
} from "./aiConfig.js";
import { profileForPlayer, type AiProfile } from "./aiPersona.js";
import { buildAiObservation } from "./aiObservation.js";
import {
  buildSystemPrompt,
  buildInvestmentPrompt,
  buildAuctionPrompt,
  buildTransferDecisionPrompt,
  buildCommunityNamePrompt,
} from "./aiPrompt.js";
import { askAiJson } from "./llmClient.js";
import {
  buildFallbackInvestmentPlan,
  chooseAuctionAction,
  chooseCommunityName,
  decideIncomingTransfer,
  sanitizeInvestmentPlan,
} from "./aiPolicy.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { togglePlayerReady } from "../state/gameActions.js";
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
  placeAuctionBid,
  playerAvailableWealth,
} from "../logic/auctionCards.js";
import { resolvePendingTransfer } from "../logic/transferResolve.js";
import { sendGroupChatMessage } from "../logic/chatGroups.js";
import { sanitizeTransactionNote } from "../logic/forbiddenText.js";
import { appendSessionEvent } from "../state/sessionTelemetry.js";
import { isInvestmentBuffLockoutActive } from "../state/actionDeadline.js";
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

interface AiRoomState {
  sessionKey: string;
  phaseKey: string;
  phaseStartedAt: number;
  inFlight: Map<string, number>;
  forced: Set<string>;
  auction: Map<string, AiLotState>;
  buffRound: Map<string, number>;
  chatRound: Map<string, number>;
  tokens: Map<string, number>;
  lastErrorAt: number;
}

const AI_ROOMS = new Map<string, AiRoomState>();
/** 防止同一局在命名模型调用期间被重复触发 */
const AI_NAMING_IN_FLIGHT = new Set<string>();

function now(): number {
  return Date.now();
}

function phaseKey(game: GameState): string {
  return `${game.phase}:${game.globalRound}:${game.currentEra}:${game.roundInEra}`;
}

function sessionKey(game: GameState): string {
  return `${game.sessionId ?? ""}:${game.sessionStartedAt ?? ""}`;
}

function auctionSignature(game: GameState): string {
  const leading = getLeadingBidOnFocus(game);
  return `${game.auctionFocusCardId ?? "-"}:${leading?.amount ?? 0}:${leading?.playerId ?? "-"}`;
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
      tokens: new Map(),
      lastErrorAt: 0,
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
    state.auction.clear();
    state.forced.clear();
  }

  const key = phaseKey(game);
  if (state.phaseKey !== key) {
    state.phaseKey = key;
    state.phaseStartedAt = now();
    state.forced.clear();
    // 故障只阻断发生的那个阶段；进入新阶段后清理旧故障，避免 AI 整局装死
    if (game.aiFailures) {
      for (const [id, failure] of Object.entries(game.aiFailures)) {
        if (failure.phase !== game.phase) delete game.aiFailures[id];
      }
      if (Object.keys(game.aiFailures).length === 0 && game.aiDeadlinePaused) {
        game.aiDeadlinePaused = false;
        if (game.phase !== "INVESTMENT") game.investmentTimerPausedAt = undefined;
      }
    }
  }
  return state;
}

function aiPlayers(game: GameState): Player[] {
  return game.players.filter((p) => isAiPlayer(p) && p.connected);
}

function logWarn(state: AiRoomState, message: string): void {
  // 避免模型连续失败时刷屏
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

async function politeDelay(scale = 1): Promise<void> {
  const min = Math.max(0, AI_CONFIG.actionDelayMinMs * scale);
  const max = Math.max(min, AI_CONFIG.actionDelayMaxMs * scale);
  const jitter = Math.floor(Math.random() * Math.max(1, max - min + 1));
  await sleep(min + jitter);
}

function sumInvestment(plan: Record<number, number>): number {
  return Object.values(plan).reduce((s, v) => s + (Number(v) || 0), 0);
}

/** 按 AI 座位解析模型配置：每个 AI 可用不同的 Key / 模型。 */
function modelConfigFor(ai: Player): AiModelConfig | null {
  return resolveAiModelConfigForSlot(ai.aiSlot);
}

function hasUsableBudget(state: AiRoomState, ai: Player): boolean {
  if (!modelConfigFor(ai)) return false;
  if (AI_CONFIG.tokenBudgetPerGame <= 0) return true;
  return (state.tokens.get(ai.id) ?? 0) < AI_CONFIG.tokenBudgetPerGame;
}

/**
 * 严格 Agent 模式下记录一次模型失败：
 * - 不降级本地策略；
 * - 投资阶段自动暂停倒计时，避免超时把 AI 当成「已空过」；
 * - 通知管理端，等待重试/移除/人工接管。
 */
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
  failures[ai.id] = {
    playerId: ai.id,
    name: ai.name,
    phase: game.phase,
    at: now(),
    message: clean,
    kind,
  };
  if (!prev || prev.phase !== game.phase) {
    game.logs.push(`⚠️ AI「${ai.name}」模型失败，已暂停等待管理员处理（${clean}）`);
  }
  if (
    game.phase === "INVESTMENT" &&
    typeof game.investmentEndsAt === "number" &&
    game.investmentTimerPausedAt == null
  ) {
    game.investmentTimerPausedAt = now();
    game.aiDeadlinePaused = true;
  }
  if (io) {
    broadcastUpdate(io, game);
    io.to(game.roomId).emit("playerNotify", {
      type: "ai_stalled",
      message: "AI 玩家暂时离线，本局已暂停，等待管理员处理",
    });
  }
}

/** 管理端重试/移除后清除故障标记；若因 AI 故障暂停过倒计时，则自动继续。 */
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

function recordTokens(state: AiRoomState, ai: Player, totalTokens?: number): void {
  if (!totalTokens || totalTokens <= 0) return;
  state.tokens.set(ai.id, (state.tokens.get(ai.id) ?? 0) + totalTokens);
}

function isDone(game: GameState, ai: Player, state: AiRoomState): boolean {
  // 回合在 await 期间 AI 可能已被移除：立即结束，避免幽灵回合继续操作
  if (!game.players.some((p) => p.id === ai.id)) return true;
  // 严格模式：已记录模型故障的 AI 在当前阶段暂停，等待管理员重试/移除；
  // 进入下一阶段后自动恢复（故障记录仍保留给管理端参考）。
  const failure = game.aiFailures?.[ai.id];
  if (AI_CONFIG.strictAgent && failure && failure.phase === game.phase) return true;
  if (game.phase === "ROOM_WAITING" || game.phase === "TUTORIAL" || game.phase === "GAME_OVER") {
    return true;
  }
  if (game.phase === "AUCTION") {
    if (AI_CONFIG.verboseLogging) {
      const lotDiag = state.auction.get(ai.id);
      console.log(
        `[ai] auction diag ai=${ai.name} enabled=${AI_CONFIG.auctionEnabled} focus=${game.auctionFocusCardId ?? "null"} lot=${lotDiag ? `${lotDiag.lotKey}/${lotDiag.passed}/${lotDiag.decisions}` : "none"}`
      );
    }
    if (!AI_CONFIG.auctionEnabled) return true;
    const focus = game.auctionFocusCardId;
    if (!focus) return true;
    const lot = state.auction.get(ai.id);
    // 焦点可能已经切到下一张卡；旧卡的 passed/done 不能套用到新卡
    if (!lot || lot.lotKey !== `${game.currentEra}:${focus}`) return false;
    if (lot.passed) return true;
    const done = lot.doneSignature === auctionSignature(game);
    if (AI_CONFIG.verboseLogging) {
      console.log(
        `[ai] auction isDone ai=${ai.name} focus=${focus} passed=${lot.passed} decided=${lot.decisions} sig=${auctionSignature(game)} lotSig=${lot.doneSignature} done=${done}`
      );
    }
    return done;
  }
  if (game.phase === "COMMUNITY_NAMING") return true;
  return ai.ready;
}

/** 防止同一条转账被重复并发处理 */
const AI_TRANSFER_IN_FLIGHT = new Set<string>();
/** 转账决策失败后的重试退避（按 AI） */
const AI_TRANSFER_NEXT_TRY = new Map<string, number>();
const AI_TRANSFER_RETRY_MS = 30_000;

/**
 * 把收到的转账处理掉。
 * 严格 Agent 模式：接受/拒绝必须由模型判断；模型失败则挂起并通知管理员，不本地代决。
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
    AI_TRANSFER_IN_FLIGHT.add(tx.id);
    try {
      let accept: boolean;
      if (AI_CONFIG.strictAgent) {
        const modelConfig = modelConfigFor(ai);
        if (!modelConfig || !hasUsableBudget(state, ai)) {
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          game.logs.push(
            `⚠️ AI「${ai.name}」暂时无法处理转账（${
              modelConfig ? "token 预算已用尽" : "未配置模型"
            }），保留待处理`
          );
          break;
        }
        const observation = buildAiObservation(game, ai);
        const result = await askAiJson(
          buildSystemPrompt(profileForPlayer(ai)),
          buildTransferDecisionPrompt(observation, tx),
          { label: "transfer-decision", maxOutputTokens: 200, config: modelConfig }
        );
        if (!result.ok || !result.data) {
          // 转账是旁路操作：失败只退避重试，不暂停整局、不把 AI 标成全局故障
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          game.logs.push(
            `⚠️ AI「${ai.name}」转账决策失败：${(result.error ?? "无有效返回").slice(0, 120)}（30 秒后重试）`
          );
          break;
        }
        const raw = (result.data as { accept?: unknown }).accept;
        if (typeof raw !== "boolean") {
          AI_TRANSFER_NEXT_TRY.set(ai.id, now() + AI_TRANSFER_RETRY_MS);
          game.logs.push(`⚠️ AI「${ai.name}」转账决策缺少 accept，30 秒后重试`);
          break;
        }
        markAiPreflightOk(ai);
        recordTokens(state, ai, result.usage?.totalTokens);
        accept = raw;
        // 一个 AI 每秒最多处理一笔转账，避免一次性打满模型额度
        AI_TRANSFER_NEXT_TRY.set(ai.id, now() + 1_200);
      } else {
        accept = decideIncomingTransfer(game, ai, tx).accept;
      }

      if (!game.players.some((p) => p.id === ai.id)) break;
      const result = resolvePendingTransfer(game, tx.id, ai.id, accept);
      if (!result.ok) continue;
      acted = true;
      appendSessionEvent(
        game,
        "transaction_resolved",
        { txId: tx.id, accept, status: result.status, amount: result.amount, source: "ai" },
        ai.id
      );
    } finally {
      AI_TRANSFER_IN_FLIGHT.delete(tx.id);
    }
  }
  if (acted) pruneSettledTransactions(game);
  return acted;
}

/** AI 使用彩票后：确认领取待开奖结果（奖金由服务端线上随机生成） */
function resolveAiLottery(game: GameState, ai: Player): boolean {
  const offer = findPendingLotteryOffer(game, ai.id);
  if (!offer) return false;
  const result = acceptLotteryOffer(game, ai.id, offer.offerId);
  if (!result.ok) return false;
  game.logs.push(`🎲 彩票开奖！${ai.name} 获得 ${result.creditedAmount} 财富`);
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
      accepted: true,
      actor: "ai",
    },
    ai.id
  );
  return true;
}

/** 线上随机抽奖；结果等待下一次 AI 回合 / 看门狗确认领取 */
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
          actor: "ai",
        },
        ai.id
      );
      if (io) broadcastUpdate(io, game);
      // 开奖请求结束后，若其他人都已 ready，立即重新评估阶段
      tryAdvancePhase(game);
    })
    .catch((error) => {
      console.error("[ai] lottery draw failed:", error);
      tryAdvancePhase(game);
    });
}

/** 创建一笔 AI 发起的转账/私信。0 元且带备注视为私信，直接 accepted。 */
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
  if (AI_SAFETY_ENABLED) {
    message = guardAgentOutput(message, "note").text;
  }
  if (amt === 0 && !message) return false;
  if (amt > 0 && amt > playerAvailableWealth(game, ai)) return false;
  if (pendingCountFrom(game, ai.id) >= MAX_PENDING_PER_SENDER) return false;

  const tx = {
    id: `ai-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
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
      // 同一房间只由一名 AI 发一次固定安全回复
      if (now() - (game.lastAiSafetyReplyAt ?? 0) < SAFETY_REPLY_COOLDOWN_MS) {
        return false;
      }
    } else if ((game.safetyCrisisUntil ?? 0) > now()) {
      // 危机窗口内不闲聊，避免模型对危机内容自由发挥
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
    // AI 已经发出固定回复，避免系统提示在同一窗口重复
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

/**
 * 执行一份方案。所有动作都是同步函数，避免与真人操作交错。
 * 返回是否产生了可见动作。
 */
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

  // 2) 道具：每轮最多一张，且失败不阻塞
  if (plan.useCard && AI_CONFIG.buffEnabled && !isInvestmentBuffLockoutActive(game)) {
    const lastRound = state.buffRound.get(ai.id);
    if (lastRound !== game.globalRound) {
      const result = useBuffCard(game, ai.id, plan.useCard.cardId, {
        targetPlayerId: plan.useCard.targetPlayerId,
        targetProjectId: plan.useCard.targetProjectId,
        burnCardId: plan.useCard.burnCardId,
      });
      if (result.success) {
        if (!ai.usedCards) ai.usedCards = [];
        ai.usedCards.push(plan.useCard.cardId);
        state.buffRound.set(ai.id, game.globalRound);
        acted = true;
        if (plan.useCard.cardId === "buff_lottery") {
          triggerAiLotteryDraw(game, ai, io);
        }
      }
    }
  }

  // 3) 聊天：每轮最多一条
  if (plan.messages?.length && state.chatRound.get(ai.id) !== game.globalRound) {
    if (sendAiChat(game, ai, plan.messages[0])) {
      state.chatRound.set(ai.id, game.globalRound);
      acted = true;
    }
  }

  // 4) 转账
  if (plan.transfer) {
    if (createAiTransfer(game, ai, plan.transfer.toPlayerId, plan.transfer.amount, plan.transfer.note)) {
      acted = true;
    }
  }

  // 5) 投资：按「当前实际精力」再裁剪一次（咖啡/摸鱼都可能改变精力）
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

/** 最近一个危机窗口内，全场频道是否出现过危机信号（忽略系统安全提示本身） */
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

/**
 * 危机协议：覆盖模型给出的聊天内容。
 * 危机窗口内所有 AI 停止闲聊；本房间第一条消息使用服务端固定安全回复。
 * 投资决策不受影响，阶段仍会正常推进。
 * 导出供红队测试直接验证策略（不依赖群聊开关）。
 */
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
  // 危机窗口内也不要通过转账留言“劝解/追问”，只保留游戏动作
  if (plan.transfer) plan.transfer.note = "";
  if (at - (game.lastAiSafetyReplyAt ?? 0) >= SAFETY_REPLY_COOLDOWN_MS) {
    plan.messages = [CRISIS_REPLY];
  }
}

async function decideInvestmentPlan(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState
): Promise<{ plan: AiInvestmentPlan | null; usedLlm: boolean; failure?: string }> {
  const modelConfig = modelConfigFor(ai);
  if (!modelConfig) {
    if (AI_CONFIG.strictAgent) {
      return { plan: null, usedLlm: false, failure: "该座位未配置可用模型" };
    }
  } else if (hasUsableBudget(state, ai)) {
    const observation = buildAiObservation(game, ai);
    const result = await askAiJson(
      buildSystemPrompt(profile),
      buildInvestmentPrompt(observation, profile),
      { label: `invest-r${game.globalRound}`, config: modelConfig }
    );
    if (result.ok && result.data) {
      markAiPreflightOk(ai);
      recordTokens(state, ai, result.usage?.totalTokens);
      const sanitized = sanitizeInvestmentPlan(
        game,
        ai,
        result.data as Partial<AiInvestmentPlan>,
        profile
      );
      // 模型没给出有效投资时：严格模式视为失败，不再用本地策略补齐
      if (sumInvestment(sanitized.investment) <= 0 && spendableEnergy(ai) > 0) {
        if (AI_CONFIG.strictAgent) {
          return { plan: null, usedLlm: true, failure: "模型没有给出有效投资方案" };
        }
        const fallback = buildFallbackInvestmentPlan(game, ai, profile);
        sanitized.investment = fallback.investment;
        if (sanitized.coffee <= 0) sanitized.coffee = fallback.coffee;
      }
      return { plan: sanitized, usedLlm: true };
    }
    const reason = result.error ?? "模型未返回有效 JSON";
    if (AI_CONFIG.strictAgent) {
      return { plan: null, usedLlm: false, failure: reason };
    }
    logWarn(state, `${ai.name} 模型失败，改用本地策略：${reason}`);
  }
  if (AI_CONFIG.strictAgent) {
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

  const { plan, usedLlm, failure } = await decideInvestmentPlan(game, ai, profile, state);
  if (!game.players.some((p) => p.id === ai.id)) return false;
  if (!plan) {
    state.forced.add(ai.id);
    recordAiFailure(game, ai, io, failure ?? "模型决策失败", "model_error");
    return false;
  }
  applyCrisisProtocol(game, plan);
  if (!INVEST_PHASES.has(game.phase) || ai.ready) return false;

  const acted = applyInvestmentPlan(game, ai, plan, state, io);
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
        transfer: plan.transfer,
        source: "llm",
      },
      ai.id
    );
  }
  if (io) broadcastUpdate(io, game);
  return acted;
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
): Promise<{ plan: AiAuctionPlan | null; usedLlm: boolean; failure?: string }> {
  const modelConfig = modelConfigFor(ai);
  if (modelConfig && hasUsableBudget(state, ai)) {
    const observation = buildAiObservation(game, ai);
    const result = await askAiJson(
      buildSystemPrompt(profile),
      buildAuctionPrompt(observation, profile),
      { label: `auction-e${game.currentEra}`, config: modelConfig }
    );
    if (result.ok && result.data) {
      const plan = normalizeAuctionPlan(result.data);
      if (plan) {
        markAiPreflightOk(ai);
        recordTokens(state, ai, result.usage?.totalTokens);
        return { plan, usedLlm: true };
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

async function runAuctionTurn(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  state: AiRoomState,
  io: Server | null
): Promise<boolean> {
  if (!AI_CONFIG.auctionEnabled) {
    logDebug(`auction ${ai.name}: disabled`);
    return false;
  }
  const focus = game.auctionFocusCardId;
  if (!focus || game.phase !== "AUCTION") {
    logDebug(`auction ${ai.name}: no focus/phase (${game.phase}/${focus ?? "-"})`);
    return false;
  }
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
    // 自己暂时领先，不必再加价
    lot.doneSignature = signature;
    return false;
  }

  await politeDelay(0.7);
  if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus) {
    logDebug(`auction ${ai.name}: phase/focus changed during delay`);
    return false;
  }

  const decided = await decideAuctionPlan(game, ai, profile, state);
  if (!game.players.some((p) => p.id === ai.id)) return false;
  if (game.phase !== "AUCTION" || game.auctionFocusCardId !== focus) {
    logDebug(`auction ${ai.name}: focus changed during model call`);
    return false;
  }
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
    const result = placeAuctionBid(game, ai.id, plan.amount);
    if (!result.ok) {
      if (AI_CONFIG.strictAgent) {
        state.forced.add(ai.id);
        recordAiFailure(
          game,
          ai,
          io,
          `模型出价 ${plan.amount} 无效：${result.message ?? "低于最低加价或超过可用财富"}`,
          "invalid_output"
        );
        return false;
      }
      lot.passed = true;
    } else {
      acted = true;
    }
  } else {
    lot.passed = true;
  }

  lot.doneSignature = auctionSignature(game);
  appendSessionEvent(
    game,
    "ai_action",
    { kind: "auction", cardId: focus, action: plan.action, amount: plan.amount ?? null, reasoning: plan.reasoning },
    ai.id
  );
  if (io && acted) {
    broadcastUpdate(io, game);
    // 有人出价后让其他 AI 有机会跟价；inFlight 会阻止同一 AI 重入。
    void handleAIPhase(game, io);
  }
  return acted;
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
    // 转账回执与彩票开奖随时处理
    const resolved =
      (await resolveAiIncomingTransfers(game, ai, state, io)) ||
      resolveAiLottery(game, ai);
    // 转账处理期间阶段可能已经推进：不要把这回合“变形”成新阶段的决策
    if (game.phase !== startPhase) return resolved;
    if (AI_CONFIG.verboseLogging) console.log(`[ai] turn resolved ${ai.name} phase=${game.phase}`);

    if (game.phase === "AUCTION") {
      if (AI_CONFIG.verboseLogging) console.log(`[ai] turn -> auction ${ai.name}`);
      const acted = await runAuctionTurn(game, ai, profile, state, io);
      return acted || resolved;
    }
    if (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE") {
      const acted = await runInvestmentTurn(game, ai, profile, state, io);
      return acted || resolved;
    }
    if (READY_PHASES.has(game.phase)) {
      if (ai.ready) return resolved;
      // 准备是机械动作，不加拟人延迟：避免阶段切换时旧回合拖住 inFlight，
      // 让下一阶段（尤其是拍卖）误以为 AI 还在忙。
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
    const message = error instanceof Error ? error.message : String(error);
    logWarn(state, `${ai.name} 回合异常：${message}`);
    if (AI_CONFIG.strictAgent) {
      // 严格模式：投资/拍卖失败不降级；仅「准备」这类机械动作可以直接完成。
      if (READY_PHASES.has(game.phase) && !INVEST_PHASES.has(game.phase) && !ai.ready) {
        togglePlayerReady(game, ai.id);
        if (io) broadcastUpdate(io, game);
      } else {
        state.forced.add(ai.id);
        recordAiFailure(game, ai, io, `回合异常：${message}`, "model_error");
      }
      return false;
    }
    // 非严格模式：兜底 ready，绝不让 AI 卡住阶段
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

/**
 * 社区命名：若当前首富是 AI，由 AI 自己命名（模型失败则用本地名称池）。
 * 与真人首富的提交入口共用 finalizeCommunityName，榜单/归档行为完全一致。
 */
export async function ensureAiCommunityNaming(
  game: GameState,
  io: Server | null
): Promise<boolean> {
  if (!AI_BOT_ENABLED) return false;
  if (game.phase !== "COMMUNITY_NAMING" || game.communityName) return false;
  const namer = getCommunityNamer(game);
  if (!namer || !isAiPlayer(namer)) return false;
  // 严格模式：已记录故障就先等待管理员处理，避免每秒重试刷额度
  if (AI_CONFIG.strictAgent && game.aiFailures?.[namer.id]) return false;
  const key = `${game.roomId}:${game.sessionId ?? ""}`;
  if (AI_NAMING_IN_FLIGHT.has(key)) return false;
  AI_NAMING_IN_FLIGHT.add(key);
  const state = getRoomState(game);
  try {
    const profile = profileForPlayer(namer);
    let name = "";
    const modelConfig = modelConfigFor(namer);
    if (modelConfig && hasUsableBudget(state, namer)) {
      const observation = buildAiObservation(game, namer);
      const result = await askAiJson(
        buildSystemPrompt(profile),
        buildCommunityNamePrompt(observation),
        { label: "community-name", maxOutputTokens: 120, config: modelConfig }
      );
      if (result.ok) {
        markAiPreflightOk(namer);
        recordTokens(state, namer, result.usage?.totalTokens);
        const raw = (result.data as { name?: unknown } | null)?.name;
        name = sanitizeCommunityName(raw);
        if (AI_SAFETY_ENABLED) {
          const guarded = guardAgentOutput(name, "name");
          name = guarded.ok ? guarded.text : "";
        }
        if (name) {
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
      finalizeCommunityName(io, game, name, "ai");
      return true;
    }
    return false;
  } catch (error) {
    logWarn(state, `AI 社区命名失败：${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    AI_NAMING_IN_FLIGHT.delete(key);
  }
}

/**
 * 阶段入口：由 phaseController 在阶段变化时触发，也可由 socket handler 主动调用。
 * 并发安全：同一 AI 同一时刻只会有一个回合。
 */
export async function handleAIPhase(game: GameState, io: Server | null): Promise<void> {
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
  const phaseAtStart = game.phase;
  let actedAny = false;
  logDebug(`handleAIPhase phase=${game.phase} ai=${ais.length}`);

  // 分批驱动：先起 maxConcurrent 个，完成后再补下一批，直到本阶段没有可行动的 AI。
  // 不能简单 break，否则超过并发上限的 AI 会一直不 ready。
  for (;;) {
    const turns: Promise<boolean>[] = [];
    for (const ai of ais) {
      if (isDone(game, ai, state)) continue;
      if (state.inFlight.has(ai.id)) continue;
      if (state.inFlight.size >= AI_CONFIG.maxConcurrentPerRoom) break;
      state.inFlight.set(ai.id, now());
      if (AI_CONFIG.verboseLogging) {
        const pendingTx = game.transactions.filter(
          (t) => t.status === "pending" && t.toId === ai.id
        ).length;
        console.log(
          `[ai] turn start ${ai.name} phase=${game.phase} pendingTx=${pendingTx}`
        );
      }
      turns.push(
        runAiTurn(game, ai, state, io).finally(() => {
          state.inFlight.delete(ai.id);
          if (AI_CONFIG.verboseLogging) {
            console.log(`[ai] turn end ${ai.name} phase=${game.phase}`);
          }
        })
      );
    }
    if (turns.length === 0) {
      logDebug(
        `no more turns in phase=${game.phase} inFlight=${[...state.inFlight.keys()].join(",") || "-"}`
      );
      break;
    }
    await Promise.allSettled(turns);
    actedAny = true;
    // 阶段已经推进时，后续批次交给新阶段的 handleAIPhase
    if (game.phase !== phaseAtStart) break;
  }

  if (!actedAny) return;

  // 回合结束后如果阶段可推进，统一推一次
  tryAdvancePhase(game);
}

/**
 * 看门狗：每秒由 server/index.ts 调用。
 * 超过宽限时间仍未行动的 AI：严格模式标记故障并暂停，非严格模式才用本地策略兜底。
 */
export function ensureAiProgress(game: GameState, io: Server | null): boolean {
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
    // 首富是 AI 时由 AI 命名；不阻塞 tick
    void ensureAiCommunityNaming(game, io);
    return false;
  }

  const state = getRoomState(game);
  const overdue = now() - state.phaseStartedAt > AI_CONFIG.maxTurnMs;
  let changed = false;

  // 转账回执 / 彩票开奖不依赖阶段：AI 收到后最多 1 秒内处理，不让真人干等。
  for (const ai of ais) {
    void resolveAiIncomingTransfers(game, ai, state, io).then((resolved) => {
      if (resolved && io) broadcastUpdate(io, game);
    });
    if (resolveAiLottery(game, ai)) changed = true;
  }

  for (const ai of ais) {
    if (game.phase === "AUCTION") {
      if (!AI_CONFIG.auctionEnabled) continue;
      if (isDone(game, ai, state)) continue;
      const startedAt = state.inFlight.get(ai.id);
      if (startedAt != null) continue;
      if (!overdue) continue;
      if (AI_CONFIG.strictAgent) {
        if (!state.forced.has(ai.id)) {
          state.forced.add(ai.id);
          recordAiFailure(game, ai, io, "拍卖模型在宽限时间内没有返回", "model_error");
          changed = true;
        }
        continue;
      }
      // 非严格模式：拍卖不阻塞阶段；超时就让本地策略出一次手
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
        changed = result.ok || changed;
        if (!result.ok) lot.passed = true;
      } else if (plan.action === "force_buy") {
        const result = useForceBuyCard(game, ai.id);
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
    const startedAt = state.inFlight.get(ai.id);
    const hardTimeout = startedAt != null && now() - startedAt > AI_CONFIG.maxTurnMs + 5_000;
    if (!overdue && !hardTimeout) continue;
    if (AI_CONFIG.strictAgent && INVEST_PHASES.has(game.phase)) {
      // 严格模式：模型没在宽限时间内完成，就暂停等待管理员，不用本地策略落子
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

  if (changed) {
    tryAdvancePhase(game);
    if (io) broadcastUpdate(io, game);
  }
  return changed;
}

/** 房间销毁/结束时清理内存状态。 */
export function forgetAiRoom(roomId: string): void {
  AI_ROOMS.delete(roomId);
}

/** 移除单个 AI 时清理它的回合/拍卖/聊天状态，避免幽灵回合继续。 */
export function forgetAiPlayer(roomId: string, playerId: string): void {
  const state = AI_ROOMS.get(roomId);
  if (!state) return;
  state.inFlight.delete(playerId);
  state.forced.delete(playerId);
  state.auction.delete(playerId);
  state.buffRound.delete(playerId);
  state.chatRound.delete(playerId);
  state.tokens.delete(playerId);
}

/** 由 index.ts 的全局 tick 定期调用，避免房间删除后状态泄漏。 */
export function pruneAiRooms(activeRoomIds: Set<string>): void {
  for (const roomId of AI_ROOMS.keys()) {
    if (!activeRoomIds.has(roomId)) AI_ROOMS.delete(roomId);
  }
}

/** 管理端/诊断用：当前房间 AI 的运行状态。 */
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
    tokens: state ? Object.fromEntries(state.tokens) : {},
  };
}
