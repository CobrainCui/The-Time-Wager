import { GameState } from "../state/gameState.js";

const MAX_SETTLED = 120;

/** 保留全部 pending，已处理记录仅保留最近若干条，避免同步包过大 */
export function pruneSettledTransactions(game: GameState) {
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
