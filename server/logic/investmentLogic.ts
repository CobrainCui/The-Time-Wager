import { GameState, Player } from "../state/gameState.js";
import { appendSessionEvent } from "../state/sessionTelemetry.js";

/** 将预填投资裁剪为合法方案（精力上限、长期项目规则等） */
export function sanitizeInvestments(
  game: GameState,
  player: Player,
  investments: Record<number, number>
): Record<number, number> {
  const sanitized: Record<number, number> = {};
  let remaining = player.energy;

  for (const proj of game.activeProjects) {
    let val = Math.max(0, Math.floor(Number(investments[proj.id] ?? 0)));
    if (proj.type === "long") {
      const longStatus = player.longTerm[proj.id];
      if (longStatus?.status === "abandoned") {
        val = 0;
      } else if (longStatus?.status === "active" && val > 0 && val < 3) {
        val = 0;
      }
    }
    val = Math.min(val, remaining);
    if (val > 0) {
      sanitized[proj.id] = val;
      remaining -= val;
    }
  }
  return sanitized;
}

export function applyInvestments(
  game: GameState,
  playerId: string,
  investments: Record<number, number>
): boolean {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return false;

  // 1. 校验总精力
  let totalSpent = 0;
  for (const amount of Object.values(investments)) {
    totalSpent += amount;
  }

  if (totalSpent > player.energy) {
    // 简单的服务端防作弊，如果超了就不接受
    return false;
  }

  // 2. 扣除精力 & 埋点
  player.energy -= totalSpent;
  player.totalEnergyConsumed += totalSpent; // ✅ 埋点：总消耗

  // 3. 更新投资
  player.investment = investments;
  player.investmentDraft = undefined;

  // 4. 埋点：分类统计 (Risk/Long)
  for (const [projIdStr, amount] of Object.entries(investments)) {
      const projId = Number(projIdStr);
      const project = game.activeProjects.find(p => p.id === projId);
      
      if (project && amount > 0) {
          if (project.type === 'risk') {
              player.investedRiskEnergy += amount;
          } else if (project.type === 'long') {
              player.investedLongEnergy += amount;
          }
      }
  }
  
  // 5. 记录日志
  game.logs.push(`📝 ${player.name} 完成了投资决策 (投入 ${totalSpent} 精力)`);

  appendSessionEvent(
    game,
    "investment_submitted",
    {
      globalRound: game.globalRound,
      currentEra: game.currentEra,
      roundInEra: game.roundInEra,
      investments: { ...investments },
      totalSpent,
    },
    playerId
  );

  return true;
}