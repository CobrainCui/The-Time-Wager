import { GameState, Player, PersonaAnalysis, ActiveProject } from "../state/gameState.js";

export { AnalysisWeights } from "../secrets.js";

function calculateLongTermism(player: Player): number {
  if (player.totalEnergyConsumed === 0) return 0;
  const ratio = player.investedLongEnergy / player.totalEnergyConsumed;
  const score1 = ratio * 100 * AnalysisWeights.w_long_ratio;

  const wealthData = player.wealthHistory;
  const maxWealth = Math.max(...wealthData, 1); 
  const n = wealthData.length;
  let area = 0;
  if (n > 1) {
      for (let i = 0; i < n - 1; i++) {
          const h1 = wealthData[i] / maxWealth;
          const h2 = wealthData[i+1] / maxWealth;
          area += (h1 + h2) / 2 * (1 / (n - 1));
      }
  }
  const score2 = (1 - area) * 100 * AnalysisWeights.w_wealth_curve;
  const hasSpiritBuff = player.usedCards.includes('buff_spirit');
  const score3 = hasSpiritBuff ? AnalysisWeights.w_spirit_buff : 0;
  return Math.min(100, score1 + score2 + score3);
}

function calculateRiskTaking(player: Player, totalRiskEnergy: number): number {
  if (totalRiskEnergy === 0) return 0;
  const ratio = player.investedRiskEnergy / totalRiskEnergy;
  const score1 = ratio * 100 * AnalysisWeights.w_risk_ratio;
  const hasLottery = player.usedCards.includes('buff_lottery');
  const score2 = hasLottery ? AnalysisWeights.w_lottery_buff : 0;
  const hasShort = player.usedCards.includes('buff_short');
  const score3 = hasShort ? AnalysisWeights.w_short_buff : 0;
  return Math.min(100, score1 + score2 + score3);
}

function calculateRuleIntervention(player: Player): number {
  const count = player.usedCards.length;
  const score = count * AnalysisWeights.w_rule_intervention_per_card;
  return Math.min(100, score);
}

function calculateSocialConnection(player: Player): number {
  switch (player.socialRank) {
      case 'A': return 100;
      case 'B': return 80;
      case 'C': return 60;
      case 'D': return 40;
      case 'E': return 20;
      default: return 0;
  }
}

function calculateResourceConversion(player: Player, game: GameState): number {
  if (player.totalEnergyConsumed === 0) return 0;
  let weightedExcessGain = 0;

  const allProjects = [
      ...game.activeProjects, 
      ...game.completedProjects, 
      ...game.uncompletedProjects
  ];
  const uniqueProjects = Array.from(new Set(allProjects.map(p => p.id)))
      .map(id => allProjects.find(p => p.id === id)!);

  for (const project of uniqueProjects) {
      const myInvest = project.investorRecords?.[player.id] || 0;
      const myGain = project.earningRecords?.[player.id] || 0; 

      if (myInvest <= 0) continue;
      const myRate = myGain / myInvest;

      if (project.type === 'long') {
          if (myRate > AnalysisWeights.roi_threshold_long) weightedExcessGain += (myRate - AnalysisWeights.roi_threshold_long) * myInvest;
      }
      else if (project.type === 'short') {
          if (myRate > AnalysisWeights.roi_threshold_short) weightedExcessGain += (myRate - AnalysisWeights.roi_threshold_short) * myInvest;
      }
      else if (project.type === 'risk') {
          if (myGain > 0) weightedExcessGain += AnalysisWeights.roi_multiplier_risk * myInvest;
      }
  }

  const rawScore = weightedExcessGain / player.totalEnergyConsumed;
  return Math.min(100, rawScore * AnalysisWeights.w_roi_efficiency);
}

export function analyzeGamePersona(game: GameState) {
  game.players.forEach(p => {
    const scores = {
      longTermism: calculateLongTermism(p),
      riskTaking: calculateRiskTaking(p, game.totalRiskEnergyAvailable),
      ruleIntervention: calculateRuleIntervention(p),
      socialConnection: calculateSocialConnection(p),
      resourceConversion: calculateResourceConversion(p, game)
    };

    let persona = "随机诗人";

    const sCompass = (100 - scores.riskTaking)*0.4 + (100 - scores.ruleIntervention)*0.4 + scores.resourceConversion*0.2;
    const sGardener = scores.longTermism;
    const sTrigger = scores.resourceConversion*0.6 + scores.ruleIntervention*0.2 + scores.riskTaking*0.2;
    const sAlchemist = (100 - scores.longTermism)*0.6 + scores.ruleIntervention*0.2 + scores.resourceConversion*0.2;

    const candidates = [
        { name: "罗盘精算师", score: sCompass },
        { name: "时荫植者", score: sGardener },
        { name: "涌机触发者", score: sTrigger },
        { name: "瞬刻炼金士", score: sAlchemist }
    ];

    if (scores.socialConnection === 100) {
        persona = "桥梁架构师";
    } else {
        candidates.sort((a, b) => b.score - a.score);
        if (candidates[0].score > 20) {
            persona = candidates[0].name;
        }
    }

    // ✅ 保存详细得分以供前端调试
    p.analysisResult = {
        scores,
        personaScores: {
            compass: sCompass,
            gardener: sGardener,
            trigger: sTrigger,
            alchemist: sAlchemist
        },
        primaryPersona: persona
    };
    
    console.log(`📊 玩家 ${p.name} 分析: ${persona}`, p.analysisResult);
  });
}