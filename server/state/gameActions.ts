import { GameState, Player } from "./gameState.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { applyInvestments, reopenSubmittedInvestment, sanitizeInvestments } from "../logic/investmentLogic.js";
import { getInvestmentRemainingMs } from "./actionDeadline.js";

export function playersRequiringAction(game: GameState): Player[] {
  return game.players.filter(
    (p) => p.connected && (AI_BOT_ENABLED || !isAiPlayer(p))
  );
}

/**
 * 玩家点击“准备/下一阶段”
 * @returns 是否从未就绪变为就绪
 */
export function togglePlayerReady(game: GameState, playerId: string): boolean {
  const player = game.players.find((p) => p.id === playerId);
  if (!player || player.ready) return false;
  player.ready = true;
  game.readyPlayers.add(playerId);
  return true;
}

/**
 * 重置所有人的准备状态 (进入新阶段时调用)
 */
export function resetAllReady(game: GameState) {
  // 1. 重置玩家对象
  game.players.forEach((p) => (p.ready = false));
  // 2. 清空集合
  game.readyPlayers.clear();
}

/**
 * 检查是否所有人都准备好了
 */
export function isEveryoneReady(game: GameState): boolean {
  const players = playersRequiringAction(game);
  if (players.length === 0) return false;
  return players.every((p) => p.ready);
}

/** 遗留：旧「进入讨论」闸门；正常流程已不再进入 BUFF_USAGE */
export function isEveryoneReadyToLeaveBuff(game: GameState): boolean {
  const gate = game.players.filter((p) => p.connected && !isAiPlayer(p));
  if (gate.length === 0) return false;
  return gate.every((p) => p.ready);
}

/**
 * 检查投资是否完成
 */
export function isInvestmentComplete(game: GameState): boolean {
  const players = playersRequiringAction(game);
  if (players.length === 0) return false;
  return players.every((p) => p.ready);
}

/**
 * 倒计时结束或管理员强制结算：为尚未提交的玩家应用预填（或空方案）并标记 ready
 */
export function forceSubmitPendingInvestments(
  game: GameState,
  source: "deadline" | "admin_force" = "deadline"
) {
  if (game.phase !== "INVESTMENT") return;

  for (const player of playersRequiringAction(game)) {
    if (player.ready) continue;
    const raw = player.investmentDraft ?? {};
    let investments = sanitizeInvestments(game, player, raw);
    let applied = applyInvestments(game, player.id, investments, source);
    if (!applied) {
      investments = {};
      applied = applyInvestments(game, player.id, investments, source);
    }
    if (!applied) {
      game.logs.push(`⚠️ ${player.name} 自动提交投资失败，按未投资推进`);
    }
    togglePlayerReady(game, player.id);
  }
}

export type AdminUnlockResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_ready" | "wrong_phase" | "timer_closed" | "ai_player" };

/**
 * 上帝解锁：仅投资阶段、倒计时未结束时，回退单个已锁定真人玩家到「未锁定」可再编辑状态。
 * 结算页 / 倒计时结束后不可解锁。
 */
export function adminUnlockPlayer(game: GameState, playerId: string): AdminUnlockResult {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { ok: false, reason: "not_found" };
  if (isAiPlayer(player)) return { ok: false, reason: "ai_player" };
  if (!player.ready) return { ok: false, reason: "not_ready" };

  if (game.phase !== "INVESTMENT") return { ok: false, reason: "wrong_phase" };
  if (getInvestmentRemainingMs(game) <= 0) {
    return { ok: false, reason: "timer_closed" };
  }

  reopenSubmittedInvestment(game, playerId);
  player.ready = false;
  game.readyPlayers.delete(playerId);
  return { ok: true };
}