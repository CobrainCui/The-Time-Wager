import type { Server } from "socket.io";
import type { GameState } from "../state/gameState.js";
import { getCommunityNamer } from "../state/gameState.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { AUTO_HOST_CONFIG } from "./autoHostConfig.js";
import { ensureAiSeatsFilled, startGameNow } from "../state/gameStart.js";
import { isInvestmentComplete, togglePlayerReady } from "../state/gameActions.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { recordPhaseChange, appendSessionEvent } from "../state/sessionTelemetry.js";
import {
  findNextAutoAuctionCard,
  formatAuctionSoldMessage,
  getLeadingBidOnFocus,
  hammerAuctionLot,
  isAuctionCardAvailable,
  markAuctionCardPassed,
  endAuctionSession,
  voidOpenBidsOnCard,
} from "../logic/auctionCards.js";
import {
  autoAcceptPendingLottery,
  createRandomLotteryOffer,
} from "../logic/lotteryDraw.js";
import {
  findPendingLotteryOffer,
  playerHasLotteryBuff,
} from "../logic/lotterySettle.js";
import { finalizeCommunityName } from "../state/communityNaming.js";
import { sanitizeCommunityName } from "../state/communityLeaderboard.js";
import { ensureAiCommunityNaming, handleAIPhase } from "../ai/aiOrchestrator.js";
import { AI_CONFIG } from "../ai/aiConfig.js";
import { canStartWithAi, verifyAiAgents } from "../ai/aiPreflight.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { isAiPlayer } from "../util/isAiPlayer.js";

interface AutoRoomState {
  phaseKey: string;
  deadlineAt: number;
  /** 命名阶段：AI 首富的模型调用是否已多等过一次 */
  aiNamingRetried?: boolean;
}

const AUTO_ROOMS = new Map<string, AutoRoomState>();

function phaseKey(game: GameState): string {
  return `${game.phase}:${game.globalRound}:${game.currentEra}:${game.roundInEra}`;
}

function autoState(game: GameState, now: number): AutoRoomState {
  const key = phaseKey(game);
  const prev = AUTO_ROOMS.get(game.roomId);
  if (!prev || prev.phaseKey !== key) {
    const next = { phaseKey: key, deadlineAt: 0 };
    AUTO_ROOMS.set(game.roomId, next);
    return next;
  }
  return prev;
}

/** 等待房是否具备自动开局条件（1–6 名真人；AI 开启时固定补满 6 席） */
function canAutoStart(game: GameState): boolean {
  const humans = game.players.filter((p) => p.connected && !isAiPlayer(p)).length;
  const humansNeeded = Math.max(1, AUTO_HOST_CONFIG.minPlayersToStart);
  if (humans < humansNeeded) return false;
  const connected = game.players.filter((p) => p.connected).length;
  // AI 开启时开局会补满 6 席；AI 关闭时必须已有 6 名真人
  const projected = AI_BOT_ENABLED ? 6 : connected;
  return projected >= 6;
}

/**
 * 玩家加入 / 管理员打开自动主持时调用：立刻开始等待房倒计时。
 * 返回是否改动了状态。
 */
export function armAutoHostStart(game: GameState, now = Date.now()): boolean {
  if (!game.autoHostEnabled || game.phase !== "ROOM_WAITING") return false;
  if (!canAutoStart(game)) {
    if (game.autoStartAt == null) return false;
    game.autoStartAt = undefined;
    return true;
  }
  if (game.autoStartAt != null) return false;
  game.autoStartAt = now + AUTO_HOST_CONFIG.startDelayMs;
  return true;
}

/** 切换自动主持时清掉旧倒计时，让系统重新按当前阶段计算 */
export function resetAutoHostState(roomId: string): void {
  AUTO_ROOMS.delete(roomId);
}

/** 房间销毁时清理，避免状态泄漏 */
export function pruneAutoHostRooms(activeRoomIds: Set<string>): void {
  for (const roomId of AUTO_ROOMS.keys()) {
    if (!activeRoomIds.has(roomId)) AUTO_ROOMS.delete(roomId);
  }
}

function logLotteryAccepted(game: GameState, result: {
  player: { id: string; name: string };
  creditedAmount: number;
  enteredAmount: number;
  roll?: number;
  source?: string;
}): void {
  game.logs.push(
    `🎲 彩票开奖！${result.player.name} 获得 ${result.creditedAmount} 财富${
      result.roll ? `（骰子 ${result.roll}）` : ""
    }`
  );
  appendSessionEvent(
    game,
    "lottery_settled",
    {
      targetPlayerId: result.player.id,
      enteredAmount: result.enteredAmount,
      creditedAmount: result.creditedAmount,
      roll: result.roll ?? null,
      source: result.source ?? "server",
      accepted: true,
      actor: "auto_host",
    },
    result.player.id
  );
}

/** 自动主持：处理彩票抽奖与超时领取 */
function autoLottery(game: GameState, io: Server | null, now: number): boolean {
  let changed = false;
  for (const player of game.players) {
    if (!playerHasLotteryBuff(player)) continue;
    if ((game.lotteryCompletedDeals ?? []).some((d) => d.playerId === player.id)) continue;

    const pending = findPendingLotteryOffer(game, player.id);
    if (pending) {
      const accepted = autoAcceptPendingLottery(
        game,
        player.id,
        now,
        AUTO_HOST_CONFIG.lotteryConfirmMs
      );
      if (accepted?.ok) {
        logLotteryAccepted(game, accepted);
        changed = true;
      }
      continue;
    }

    // 玩家打出彩票后通常已由 socket/AI 触发；这里是断线、旧局或并发失败时的兜底
    void createRandomLotteryOffer(game, player.id)
      .then((result) => {
        if (!result.ok) return;
        appendSessionEvent(
          game,
          "lottery_drawn",
          {
            targetPlayerId: player.id,
            amount: result.offer.amount,
            roll: result.offer.roll ?? null,
            source: result.offer.source ?? "server",
            actor: "auto_host",
          },
          player.id
        );
        if (io) broadcastUpdate(io, game);
        tryAdvancePhase(game);
      })
      .catch((error) => {
        console.error("[autoHost] lottery draw failed:", error);
        tryAdvancePhase(game);
      });
  }
  return changed;
}

function autoAuction(game: GameState, io: Server | null, now: number): boolean {
  let focus = game.auctionFocusCardId;
  if (focus && !isAuctionCardAvailable(game, focus)) {
    focus = undefined;
    game.auctionFocusCardId = undefined;
    game.auctionFocusSetAt = undefined;
  }

  if (!focus) {
    const next = findNextAutoAuctionCard(game);
    if (!next) {
      const prev = game.phase;
      if (!endAuctionSession(game)) return false;
      game.autoHostNextActionAt = undefined;
      game.logs.push("🔨 系统自动主持：本场拍卖结束");
      recordPhaseChange(game, prev, game.phase, "auto_host_end_auction");
      if (io) broadcastUpdate(io, game);
      if (AI_BOT_ENABLED) void handleAIPhase(game, io);
      return true;
    }
    game.auctionFocusCardId = next;
    game.auctionFocusSetAt = now;
    game.auctionPassedCardIds = (game.auctionPassedCardIds ?? []).filter((id) => id !== next);
    game.autoHostNextActionAt = now + AUTO_HOST_CONFIG.auctionIdleMs;
    game.logs.push(`📌 系统自动聚焦：[${next}]`);
    if (io) broadcastUpdate(io, game);
    if (AI_BOT_ENABLED) void handleAIPhase(game, io);
    return true;
  }

  const focusAt = game.auctionFocusSetAt ?? now;
  const lastBidAt = (game.auctionBids ?? [])
    .filter(
      (b) =>
        b.cardId === focus && (b.status === "leading" || b.status === "outbid")
    )
    .reduce((max, b) => Math.max(max, b.timestamp), 0);
  const idleDeadline = Math.max(focusAt, lastBidAt) + AUTO_HOST_CONFIG.auctionIdleMs;
  const hardDeadline = focusAt + AUTO_HOST_CONFIG.auctionLotMaxMs;
  const deadline = Math.min(idleDeadline, hardDeadline);
  game.autoHostNextActionAt = deadline;
  if (now < deadline) return false;

  const leading = getLeadingBidOnFocus(game);
  let action: "sold" | "passed" = "passed";
  if (leading) {
    const result = hammerAuctionLot(game);
    if (result.ok) {
      action = "sold";
      game.logs.push(
        `✅ 系统自动落槌：${result.playerName} 以 ${result.cost} 财富拍得 [${result.cardId}]`
      );
      appendSessionEvent(game, "auction_lot_sold", {
        cardId: result.cardId,
        playerId: result.playerId,
        cost: result.cost,
        nextFocusId: null,
        source: "auto_host",
      });
      if (io) {
        io.to(game.roomId).emit("playerNotify", {
          type: "auction_sold",
          message: formatAuctionSoldMessage(game, {
            cardId: result.cardId,
            playerId: result.playerId,
            cost: result.cost,
            source: "hammer",
          }),
        });
      }
    }
  }
  if (action === "passed") {
    // 无人出价，或最高出价者已付不起：本场跳过这张
    voidOpenBidsOnCard(game, focus, "void_passed");
    markAuctionCardPassed(game, focus);
    game.logs.push(`⏭️ 系统自动跳过 [${focus}]（无人出价或出价失效）`);
    appendSessionEvent(game, "auction_lot_passed", {
      cardId: focus,
      nextFocusId: null,
      source: "auto_host",
    });
  }

  const next = findNextAutoAuctionCard(game, focus);
  game.auctionFocusCardId = next;
  game.auctionFocusSetAt = next ? now : undefined;
  if (!next) {
    const prev = game.phase;
    if (endAuctionSession(game)) {
      game.logs.push("🔨 系统自动主持：本场拍卖结束");
      recordPhaseChange(game, prev, game.phase, "auto_host_end_auction");
    }
    game.autoHostNextActionAt = undefined;
  } else {
    game.autoHostNextActionAt = now + AUTO_HOST_CONFIG.auctionIdleMs;
  }

  if (io) broadcastUpdate(io, game);
  if (AI_BOT_ENABLED) void handleAIPhase(game, io);
  return true;
}

/**
 * 系统自动主持：每秒由 index.ts 调用。
 * - 只做「主持人会做的动作」，不改规则；
 * - 管理端仍可随时手动操作，手动操作会覆盖自动倒计时；
 * - io 允许为 null，便于单测验证状态流转。
 */
export function ensureAutoHost(
  game: GameState,
  io: Server | null,
  now = Date.now()
): boolean {
  if (!game.autoHostEnabled) {
    if (game.autoStartAt != null || game.autoHostNextActionAt != null) {
      game.autoStartAt = undefined;
      game.autoHostNextActionAt = undefined;
      return true;
    }
    return false;
  }

  if (game.phase === "ROOM_WAITING") {
    if (armAutoHostStart(game, now)) {
      if (io) broadcastUpdate(io, game);
      return true;
    }
    if (game.autoStartAt != null && now >= game.autoStartAt) {
      // 先补满 6 席，再做严格模式的模型连通性检测
      const filled = ensureAiSeatsFilled(game);
      if (!filled.ok) {
        game.autoStartAt = now + 60_000;
        game.logs.push(`⏱️ 系统自动开局被阻止：${filled.message}（60 秒后重试）`);
        return true;
      }
      const gate = canStartWithAi(game);
      if (!gate.ok) {
        void verifyAiAgents(game);
        game.autoStartAt = now + 5_000;
        const note = "⏳ 系统自动主持：正在检测 AI 模型连接，通过后自动开局";
        if (game.logs[game.logs.length - 1] !== note) game.logs.push(note);
        return true;
      }
      const result = startGameNow(io, game, "auto_host");
      if (!result.ok) {
        // 严格 Agent 模式下模型未就绪会拒绝开局；保留 60 秒后重试，并在日志里说明原因
        game.autoStartAt = now + 60_000;
        game.logs.push(`⏱️ 系统自动开局被阻止：${result.message}（60 秒后重试）`);
      }
      return true;
    }
    return false;
  }

  if (game.phase === "TUTORIAL" || game.phase === "GAME_OVER") {
    game.autoHostNextActionAt = undefined;
    return false;
  }

  if (game.phase === "ERA_INTRO" || game.phase === "SETTLEMENT") {
    const state = autoState(game, now);
    if (!state.deadlineAt) {
      const delay =
        game.phase === "ERA_INTRO"
          ? AUTO_HOST_CONFIG.introMs
          : AUTO_HOST_CONFIG.settlementMs;
      state.deadlineAt = now + delay;
      game.autoHostNextActionAt = state.deadlineAt;
      if (io) broadcastUpdate(io, game);
      return true;
    }
    game.autoHostNextActionAt = state.deadlineAt;
    if (now < state.deadlineAt) return false;

    let readied = 0;
    for (const player of game.players) {
      if (!player.connected || player.ready) continue;
      if (togglePlayerReady(game, player.id)) readied += 1;
    }
    if (readied > 0) {
      game.logs.push(
        `⏱️ 系统自动主持：${game.phase === "ERA_INTRO" ? "时代介绍" : "结算"}倒计时结束，进入下一阶段`
      );
    }
    state.deadlineAt = 0;
    game.autoHostNextActionAt = undefined;
    tryAdvancePhase(game);
    if (io) broadcastUpdate(io, game);
    return true;
  }

  if (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE") {
    game.autoHostNextActionAt = undefined;
    const lotteryChanged = autoLottery(game, io, now);
    // 抽奖/自动领取可能让「全员 ready」重新成立；兜底推一次阶段
    if (isInvestmentComplete(game)) {
      tryAdvancePhase(game);
      if (io) broadcastUpdate(io, game);
      return true;
    }
    return lotteryChanged;
  }

  if (game.phase === "AUCTION") {
    return autoAuction(game, io, now);
  }

  if (game.phase === "COMMUNITY_NAMING") {
    const state = autoState(game, now);
    if (!state.deadlineAt) {
      state.deadlineAt = now + AUTO_HOST_CONFIG.namingMs;
      game.autoHostNextActionAt = state.deadlineAt;
      if (aiNamer(game)) void ensureAiCommunityNaming(game, io);
      if (io) broadcastUpdate(io, game);
      return true;
    }
    game.autoHostNextActionAt = state.deadlineAt;
    if (game.communityName) return false;
    if (now < state.deadlineAt) return false;

    // 首富是 AI 且模型仍在返回：多等一个短窗口，避免系统名抢先覆盖 AI 命名
    if (aiNamer(game)) {
      if (!state.aiNamingRetried) {
        state.aiNamingRetried = true;
        state.deadlineAt = now + 12_000;
        game.autoHostNextActionAt = state.deadlineAt;
        void ensureAiCommunityNaming(game, io);
        if (io) broadcastUpdate(io, game);
        return true;
      }
      void ensureAiCommunityNaming(game, io);
    }
    if (aiNamer(game) && AI_CONFIG.strictAgent) {
      // 严格模式：AI 命名失败时不用系统名兜底，等待管理员重试或人工命名
      game.autoHostNextActionAt = undefined;
      return false;
    }
    const fallback = sanitizeCommunityName(`社区-${game.roomId}`) || "未命名社区";
    game.logs.push("⏱️ 系统自动主持：命名超时，使用系统名称");
    void finalizeCommunityName(io, game, fallback, "auto_host");
    return true;
  }

  return false;
}

function aiNamer(game: GameState): boolean {
  const namer = getCommunityNamer(game);
  return Boolean(namer && isAiPlayer(namer));
}
