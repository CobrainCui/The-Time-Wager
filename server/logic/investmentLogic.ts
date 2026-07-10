import { GameState } from "../state/gameState.js";

export function applyInvestments(game: GameState, playerId: string, investments: Record<number, number>) {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return;

  // 1. 校验总精力
  let totalSpent = 0;
  for (const amount of Object.values(investments)) {
    totalSpent += amount;
  }

  if (totalSpent > player.energy) {
    // 简单的服务端防作弊，如果超了就不接受
    return; 
  }

  // 2. 扣除精力 & 埋点
  player.energy -= totalSpent;
  player.totalEnergyConsumed += totalSpent; // ✅ 埋点：总消耗

  // 3. 更新投资
  player.investment = investments;

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
}