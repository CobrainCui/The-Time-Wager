import type { Player } from "../state/gameState.js";

/**
 * 按财富计算并列名次（competition ranking：1,1,3）。
 * 生产代码此前从未写入 player.rank，导致导出与 AI 观察恒为 0。
 */
export function computeWealthRanks(players: Player[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.wealth - a.wealth);
  const ranks = new Map<string, number>();
  let lastWealth: number | null = null;
  let lastRank = 0;
  sorted.forEach((p, index) => {
    const rank = lastWealth === p.wealth ? lastRank : index + 1;
    ranks.set(p.id, rank);
    lastWealth = p.wealth;
    lastRank = rank;
  });
  return ranks;
}
