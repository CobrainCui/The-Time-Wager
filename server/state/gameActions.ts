import { GameState, Player } from "./gameState.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { applyInvestments, reopenSubmittedInvestment, sanitizeInvestments } from "../logic/investmentLogic.js";

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

/** 道具阶段：与玩家端 BuffUsage 一致，仅统计已连接的真实玩家是否均已「进入讨论和投资」 */
export function isEveryoneReadyToLeaveBuff(game: GameState): boolean {
  const gate = game.players.filter((p) => p.connected && !isAiPlayer(p));
  if (gate.length === 0) return false;
  return gate.every((p) => p.ready);
}

/**
 * 检查选座是否完成
 */
export function isDraftingComplete(game: GameState): boolean {
  const players = playersRequiringAction(game);
  if (players.length === 0) return false;
  return players.every((p) => p.draftOrder !== undefined);
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
export function forceSubmitPendingInvestments(game: GameState) {
  if (game.phase !== "INVESTMENT") return;

  for (const player of playersRequiringAction(game)) {
    if (player.ready) continue;
    const raw = player.investmentDraft ?? {};
    let investments = sanitizeInvestments(game, player, raw);
    let applied = applyInvestments(game, player.id, investments);
    if (!applied) {
      investments = {};
      applied = applyInvestments(game, player.id, investments);
    }
    if (!applied) {
      game.logs.push(`⚠️ ${player.name} 自动提交投资失败，按未投资推进`);
    }
    togglePlayerReady(game, player.id);
  }
}

/** 上帝解锁：投资阶段重新开放已提交方案；道具阶段仅取消「进入讨论」ready */
export function adminUnlockPlayer(game: GameState, playerId: string): boolean {
  const player = game.players.find((p) => p.id === playerId);
  if (!player || !player.ready) return false;

  if (game.phase === "INVESTMENT") {
    reopenSubmittedInvestment(game, playerId);
  } else if (game.phase === "BUFF_USAGE") {
    game.logs.push(`🔓 上帝解锁 ${player.name}，可继续调整道具与预填`);
  } else {
    game.logs.push(`🔓 上帝解锁 ${player.name}，可重新操作`);
  }

  player.ready = false;
  game.readyPlayers.delete(playerId);
  return true;
}