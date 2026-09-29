import { GameState } from "../state/gameState.js";

const MAX_SETTLED = 120;
export const MAX_PENDING_PER_SENDER = 20;
export const PENDING_TTL_MS = 30 * 60 * 1000;

export function expireStalePendingTransactions(game: GameState, now = Date.now()): number {
  let expired = 0;
  for (const tx of game.transactions) {
    if (tx.status === "pending" && now - tx.timestamp > PENDING_TTL_MS) {
      tx.status = "rejected";
      expired += 1;
    }
  }
  return expired;
}

export function pendingCountFrom(game: GameState, fromId: string): number {
  return game.transactions.filter((t) => t.status === "pending" && t.fromId === fromId).length;
}

/** 超时 pending 先拒掉；已处理记录仅保留最近若干条 */
export function pruneSettledTransactions(game: GameState) {
  expireStalePendingTransactions(game);
  const pending = game.transactions.filter((t) => t.status === "pending");
  const settled = game.transactions.filter((t) => t.status !== "pending");
  if (settled.length <= MAX_SETTLED) {
    game.transactions = [...pending, ...settled].sort((a, b) => a.timestamp - b.timestamp);
    return;
  }
  settled.sort((a, b) => a.timestamp - b.timestamp);
  const kept = settled.slice(-MAX_SETTLED);
  game.transactions = [...pending, ...kept].sort((a, b) => a.timestamp - b.timestamp);
}
