import { GameState, Player } from "./gameState.js";

/**
 * 玩家点击“准备/下一阶段”
 */
export function togglePlayerReady(game: GameState, playerId: string) {
  const player = game.players.find((p) => p.id === playerId);
  if (player) {
    // 1. 更新玩家对象上的状态
    player.ready = true;
    // 2. ✅ 核心修复：同步更新到 Set 集合中，这样前端收到的 readyPlayers 数组才会有数据
    game.readyPlayers.add(playerId);
  }
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
  // 只检查已连接的玩家
  const connectedPlayers = game.players.filter(p => p.connected);
  if (connectedPlayers.length === 0) return false;
  
  // 只要每个人都 ready = true 即可
  return connectedPlayers.every(p => p.ready);
}

/**
 * 检查选座是否完成
 */
export function isDraftingComplete(game: GameState): boolean {
  const connectedPlayers = game.players.filter(p => p.connected);
  // 所有人都有 draftOrder (非 undefined)
  return connectedPlayers.every(p => p.draftOrder !== undefined);
}

/**
 * 检查投资是否完成
 */
export function isInvestmentComplete(game: GameState): boolean {
  const connectedPlayers = game.players.filter(p => p.connected);
  return connectedPlayers.every(p => p.ready);
}