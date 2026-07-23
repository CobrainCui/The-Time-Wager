import { GameState, Player, PersonaAnalysis, MbtiPersona, ActiveProject } from "../state/gameState.js";

import { AnalysisWeights } from "../secrets.js";
export { AnalysisWeights };

// ========== 命运素描：原有五维加权系统 ==========

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

// ========== 决策基因：四轴 MBTI 系统 ==========

import { DECISION_GENE_CONFIG, FATE_SKETCH_CONFIG } from "./personaConfig.js";

function calculateMbtiPersona(player: Player, game: GameState): MbtiPersona {
  const totalEnergy = player.totalEnergyConsumed || 1;

  // 轴 T：长期精力比 vs 短期精力比（用 investedLongEnergy 和推算出的短期精力）
  const longRatio = player.investedLongEnergy / totalEnergy;
  // 推算短期精力：总精力 - 长期 - 风险（剩余基本是短期/现金）
  const shortEnergyEst = Math.max(0, totalEnergy - player.investedLongEnergy - player.investedRiskEnergy);
  const shortRatio = shortEnergyEst / totalEnergy;
  const longShortScore = (longRatio - shortRatio) * 100; // 正=长期，负=短期

  // 轴 R：风险偏好（和原有一致）
  const riskConservScore = game.totalRiskEnergyAvailable > 0
    ? Math.min(100, (player.investedRiskEnergy / game.totalRiskEnergyAvailable) * 100 * AnalysisWeights.w_risk_ratio)
    : 0;

  // 轴 D：规则破坏度（和原有一致）
  const disruptFollowScore = Math.min(100, player.usedCards.length * AnalysisWeights.w_rule_intervention_per_card);

  // 轴 M：利益 vs 社交（ROI效率得分 - 社交连接得分）
  const roiScore = calculateResourceConversion(player, game);
  const socialScore = calculateSocialConnection(player);
  const profitSocialScore = roiScore - socialScore; // 正=利益导向，负=社交导向

  // 新的判定四字母：
  // Time: L (长线) / Q (短线)
  // Risk: A (激进) / G (稳健)
  // Disruption: D (干预/破坏) / C (顺应)
  // Motivation: V (利益 Value) / R (社交 Relationship)
  const T = longShortScore >= 0 ? "L" : "Q";
  const percentL = Math.min(100, Math.max(0, 50 + longShortScore / 2));
  
  const R = riskConservScore >= 50 ? "A" : "G";
  const percentA = riskConservScore; // riskConservScore 本身就是激进程度 0~100
  
  const D_axis = disruptFollowScore >= 50 ? "D" : "C";
  const percentD = disruptFollowScore;
  
  const M = profitSocialScore >= 0 ? "V" : "R";
  const percentV = Math.min(100, Math.max(0, 50 + profitSocialScore / 2));
  
  const code = `${T}${R}${D_axis}${M}`;

  return {
    axes: { 
      Time: { code: T, percent: T === "L" ? percentL : 100 - percentL }, 
      Risk: { code: R, percent: R === "A" ? percentA : 100 - percentA }, 
      Disruption: { code: D_axis, percent: D_axis === "D" ? percentD : 100 - percentD }, 
      Motivation: { code: M, percent: M === "V" ? percentV : 100 - percentV } 
    },
    code,
    label: DECISION_GENE_CONFIG[code]?.name || code,
    desc: DECISION_GENE_CONFIG[code]?.desc || "未知决策基因",
    axisScores: { longShort: longShortScore, riskConserv: riskConservScore, disruptFollow: disruptFollowScore, profitSocial: profitSocialScore },
  };
}

// ========== 主入口 ==========

export function analyzeGamePersona(game: GameState) {
  game.players.forEach(p => {
    const scores = {
      longTermism: calculateLongTermism(p),
      riskTaking: calculateRiskTaking(p, game.totalRiskEnergyAvailable),
      ruleIntervention: calculateRuleIntervention(p),
      socialConnection: calculateSocialConnection(p),
      resourceConversion: calculateResourceConversion(p, game)
    };

    // --- 命运素描 ---
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

    // --- 决策基因 ---
    const mbtiPersona = calculateMbtiPersona(p, game);

    p.analysisResult = {
        scores,
        personaScores: { compass: sCompass, gardener: sGardener, trigger: sTrigger, alchemist: sAlchemist },
        primaryPersona: persona,
        primaryPersonaDesc: FATE_SKETCH_CONFIG[persona]?.desc || "暂无描述",
        mbtiPersona,
    };
    
    console.log(`📊 玩家 ${p.name} 命运素描: ${persona} | 决策基因: ${mbtiPersona.code} ${mbtiPersona.label}`);
  });
}