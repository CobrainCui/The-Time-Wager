import { GameState } from "../state/gameState.js";

/**
 * 判断是否满足时代加成
 */
export function applyEraBonus(
  game: GameState,
  project: { name: string; era?: string; type: string },
  rankedInvestors: { player: any; invested: number }[]
) {
  if (!game.currentEraCard) return;
  if (!project.era) return;
  if (project.type === "risk") return;

  // 是否时代匹配
  if (project.era !== game.currentEraCard.era &&
      project.era !== game.currentEraCard.name) {
    return;
  }

  if (rankedInvestors.length === 0) return;

  // 投入最高者（若并列，eraOrder 靠前的已在排序中）
  const top = rankedInvestors[0];

  const bonus =
    project.type === "short" ? 30 :
    project.type === "long"  ? 50 : 0;

  if (bonus > 0) {
    top.player.achievement += bonus;
    game.logs.push(
      `🏅 ${top.player.name} 因完成「${project.name}」于时代「${game.currentEraCard.name}」获得时代加成 +${bonus}`
    );
  }
}
