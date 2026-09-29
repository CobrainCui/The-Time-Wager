import { GameState, Player, ActiveProject, SettlementProjectResult, GainBreakdown } from "../state/gameState.js";
import { appendSettlementRound } from "../state/sessionTelemetry.js";
import {
  applyLongTermRoundInvestments,
  refundOnAbandon,
  shouldTreatAsAbandon,
  syncLongTermRecordsFromHistory,
} from "./longTermLogic.js";

// 辅助：创建零收益对象
const zeroGain = (): GainBreakdown => ({ total: 0, base: 0, rank: 0, era: 0 });

// 辅助：检查是否有 Buff
function hasBuff(player: Player, buffId: string): boolean {
    return player.activeBuffs && player.activeBuffs.some(b => b.cardId === buffId);
}

export function settlePhase(game: GameState) {
  const snapshot: SettlementProjectResult[] = [];
  const logs: string[] = [];
  logs.push(`=== ${game.currentEra}时代 第${game.roundInEra}轮 结算 ===`);

  const remainingProjects: ActiveProject[] = [];

  for (const project of game.activeProjects) {
    if (!project.investorRecords) project.investorRecords = {};
    if (!project.earningRecords) project.earningRecords = {}; 
    if (!project.totalPayout) project.totalPayout = 0;

    const result = settleOneProject(game, project, logs);
    snapshot.push(result);

    // 检查连续空投
    if (project.currentInvested === 0) {
        project.roundsNoInvestment = (project.roundsNoInvestment || 0) + 1;
    } else {
        project.roundsNoInvestment = 0;
    }

    if (result.isCompleted) {
        game.completedProjects.push(project);
        if (project.type === "long" && result.isExploded) {
            logs.push(
              `✅ 项目「${project.name}」长期超额完成（${result.totalInvested}/${project.maxEnergy}），移出牌桌`
            );
        } else if (project.type === "long") {
            logs.push(`✅ 项目「${project.name}」长期恰好完成，移出牌桌`);
        } else if (project.type === "short" && result.isExploded) {
            logs.push(`💥 项目「${project.name}」短期投爆，移出牌桌`);
        } else {
            logs.push(`✅ 项目「${project.name}」已结束/完成，移出牌桌`);
        }
    } else if (result.isExploded) {
        game.uncompletedProjects.push(project);
        logs.push(`💥 项目「${project.name}」已爆掉，移出牌桌`);
    } else if (project.roundsNoInvestment >= 2) {
        game.uncompletedProjects.push(project);
        logs.push(`🗑️ 项目「${project.name}」连续2轮无人问津，自动撤资离场`);
    } else {
        remainingProjects.push(project);
    }
  }

  game.activeProjects = remainingProjects;

  game.lastSettlement = {
    round: game.globalRound,
    results: snapshot
  };
  appendSettlementRound(game, snapshot);
  game.logs.push(...logs);

  game.players.forEach(p => {
      p.wealthHistory.push(p.wealth);
  });
}

export function settleOneProject(
  game: GameState, 
  project: ActiveProject, 
  logs: string[]
): SettlementProjectResult {
  
  const result: SettlementProjectResult = {
    projectId: project.id,
    name: project.name,
    type: project.type,
    maxEnergy: project.maxEnergy,
    totalInvested: 0,
    isExploded: false,
    isCompleted: false,
    playerInvestments: {},
    playerGains: {}
  };

  // === 0. 长期项目放弃检测 ===
  if (project.type === 'long') {
      syncLongTermRecordsFromHistory(project, game.players);
      game.players.forEach(p => {
          const record = p.longTerm[project.id];
          const currentAmount = p.investment?.[project.id] || 0;
          if (!shouldTreatAsAbandon(record, currentAmount)) return;

          const totalRefund = refundOnAbandon(record!, currentAmount);

          p.wealth += totalRefund;
          record!.status = "abandoned";

          p.investedLongEnergy = Math.max(0, p.investedLongEnergy - totalRefund);

          project.totalPayout += totalRefund;
          project.earningRecords[p.id] = (project.earningRecords[p.id] || 0) + totalRefund;

          logs.push(`🚫 ${p.name} 对「${project.name}」追加投资不足3，判定放弃。退回 ${totalRefund}，退出排名。`);

          result.playerInvestments[p.id] = currentAmount;
          result.playerGains[p.id] = { total: totalRefund, base: totalRefund, rank: 0, era: 0 };

          if (p.investment) p.investment[project.id] = 0;
      });
  }

  // === 1. 统计本轮投资者并更新记录 ===
  // 这一步只处理"本轮"的投入，更新 accumulated 和 investorRecords
  const currentRoundInvestors = game.players
    .map(p => ({ player: p, amount: p.investment?.[project.id] || 0 }))
    .filter(i => {
        if (i.amount <= 0) return false;
        if (project.type === 'long') {
            const status = i.player.longTerm[project.id]?.status;
            if (status === 'abandoned' || status === 'completed') return false;
        }
        return true;
    });

  // 更新总进度和个人记录
  currentRoundInvestors.forEach(i => {
      // 记录本轮投入，用于前端显示
      result.playerInvestments[i.player.id] = i.amount;
      // 初始化收益对象
      if (!result.playerGains[i.player.id]) result.playerGains[i.player.id] = zeroGain();
      
      const pid = i.player.id;
      // ✅ 核心：更新历史累计投入
      project.investorRecords[pid] = (project.investorRecords[pid] || 0) + i.amount;
  });

  applyLongTermRoundInvestments(project, currentRoundInvestors);
  
  const roundTotal = currentRoundInvestors.reduce((s, i) => s + i.amount, 0);
  project.currentInvested = roundTotal; 
  project.accumulatedInvested += roundTotal; 

  const totalAccumulated = project.accumulatedInvested;
  const isExploded = totalAccumulated > project.maxEnergy;
  const isCompleted = totalAccumulated >= project.maxEnergy;

  result.totalInvested = totalAccumulated;
  result.isExploded = isExploded;
  result.isCompleted = isCompleted;

  // === 辅助：构建全历史投资人列表 (用于排名) ===
  // 排除已放弃的长期投资者
  const allInvestorIds = Object.keys(project.investorRecords);
  const allInvestors = allInvestorIds.map(id => {
      const p = game.players.find(pl => pl.id === id);
      return { 
          player: p, 
          total: project.investorRecords[id] 
      };
  })
  .filter(item => {
      if (!item.player) return false;
      if (project.type === 'long') {
          return item.player.longTerm[project.id]?.status !== 'abandoned';
      }
      return true;
  })
  .sort((a, b) => b.total - a.total);


  // === 处理【项目做空】(buff_short) ===
  game.players.forEach(p => {
      const shortBuffs = p.activeBuffs.filter(b => b.cardId === 'buff_short' && b.targetProjectId === project.id);
      
      shortBuffs.forEach(buff => {
          const prediction = buff.extraData; 
          let success = false;
          
          if (prediction === 'empty' && currentRoundInvestors.length === 0) {
              success = true;
          }
          // 预测恰好完成 (严格等于)
          else if (prediction === 'full' && totalAccumulated === project.maxEnergy) {
              success = true;
          }

          if (success) {
              const reward = prediction === 'empty' ? 200 : 150;
              p.wealth += reward;
              
              project.totalPayout += reward;
              project.earningRecords[p.id] = (project.earningRecords[p.id] || 0) + reward;
              
              const g = result.playerGains[p.id] || zeroGain();
              g.total += reward;
              result.playerGains[p.id] = g;

              logs.push(`📉 ${p.name} 【项目做空】判定成功(${prediction})，获得 ${reward} 财富！`);
          } else {
              logs.push(`📉 ${p.name} 【项目做空】判定失败(${prediction})。当前进度: ${totalAccumulated}/${project.maxEnergy}`);
          }
      });
  });

  if (currentRoundInvestors.length === 0 && !isExploded && !isCompleted) return result; 

  // === A. Risk (风险项目) ===
  if (project.type === 'risk') {
    if (isExploded) {
      logs.push(`💥 风险项目「${project.name}」累计${totalAccumulated}，投入超过上限，投爆！`);
      game.players.forEach(p => {
        // 【保险】
        const myRiskInvest = p.investment?.[project.id] || 0; // 保险看的是本轮投入? 还是累计? 需求说是投入>=5，通常指累计比较合理，但为了稳妥这里先读本轮，或者读记录
        // 修正：保险看的是累计投入还是本轮？原逻辑是 p.investment。假设只保本轮。
        // 但为了更符合"投入过"的概念，这里用本轮判断比较安全。
        if (hasBuff(p, 'buff_insurance') && myRiskInvest >= 5) {
            p.wealth += 100;
            logs.push(`🛡️ ${p.name} 触发【保险】(风险项目)，获得赔付 100 财富！`);
            
            project.totalPayout += 100;
            project.earningRecords[p.id] = (project.earningRecords[p.id] || 0) + 100;
            
            const g = result.playerGains[p.id] || zeroGain();
            g.total += 100;
            result.playerGains[p.id] = g;
        }

        const historyGain = p.riskGains?.[project.id] || 0;
        if (historyGain > 0) {
          p.wealth -= historyGain;
          p.riskGains[project.id] = 0;
          logs.push(`  💸 ${p.name} 被追回历史收益 -${historyGain}`);
          
          project.totalPayout -= historyGain;
          project.earningRecords[p.id] = (project.earningRecords[p.id] || 0) - historyGain;
        }
      });
    } else {
      let rate = 20; 
      if (project.name.includes("成瘾") || project.name.includes("完美") || project.name.includes("幸福")) rate = 25;

      // 风险项目回报只给本轮投资者
      currentRoundInvestors.forEach(({ player, amount }) => {
        let gain = amount * rate;

        if (hasBuff(player, 'buff_gold')) {
            const original = gain;
            gain = Math.floor(gain * 1.5);
            logs.push(`✨ ${player.name} 【点石成金】生效，收益 ${original} -> ${gain}`);
        }

        player.wealth += gain;
        
        if (!player.riskGains) player.riskGains = {};
        player.riskGains[project.id] = (player.riskGains[project.id] || 0) + gain;

        const g = result.playerGains[player.id] || zeroGain();
        g.base += gain;
        g.total += gain;
        result.playerGains[player.id] = g;
        
        project.totalPayout += gain;
        project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + gain;
        
        logs.push(`  💰 ${player.name} 风险回报 +${gain}`);
      });
    }
    return result;
  }

  // === B. Long (长期项目) ===
  // 时代加成：累计 >= maxEnergy（含超填）结束时，主题契合的历史第一 +50（见 applyRankAndEraBonus）
  if (project.type === 'long') {
    // 处理本轮投资者的投入记录逻辑已经在上面完成了
    // Long项目的特性：未完成不发钱
    if (isCompleted) {
      if (isExploded) {
        logs.push(
          `  ✅ 长期项目「${project.name}」超额完成（${totalAccumulated}/${project.maxEnergy}）！发放累计收益与排名奖励。`
        );
      } else {
        logs.push(
          `  ✅ 长期项目「${project.name}」恰好完成！发放累计收益与排名奖励。`
        );
      }
      
      // ✅ 核心修正：遍历所有历史投资人 (allInvestors) 发放收益
      allInvestors.forEach(({ player, total }) => {
        if (!player) return;

        // 1. 基础收益 = 累计投入 * 15
        let baseGain = total * 15;

        if (hasBuff(player, 'buff_gold')) {
            const original = baseGain;
            baseGain = Math.floor(baseGain * 1.5);
            logs.push(`✨ ${player.name} 【点石成金】生效，收益 ${original} -> ${baseGain}`);
        }

        player.wealth += baseGain;
        
        // 记录到结果 (注意：该玩家可能本轮没投，playerGains可能为空，需初始化)
        const g = result.playerGains[player.id] || zeroGain();
        g.base += baseGain;
        g.total += baseGain;
        result.playerGains[player.id] = g;
        
        project.totalPayout += baseGain;
        project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + baseGain;

        if (player.longTerm[project.id]) player.longTerm[project.id].status = 'completed';
      });

      // 2. 排名与时代奖励 (也是针对所有历史投资人)
      applyRankAndEraBonus(game, project, allInvestors, result, logs);

    } else {
      logs.push(`  ⏳ 长期项目进度 ${totalAccumulated}/${project.maxEnergy}`);
    }
    return result;
  }

  // === C. Short (短期项目) ===
  // 时代加成：仅恰好满额（isCompleted && !isExploded）时发放；超上限爆掉无时代加成。风险项目永不参与。
  if (project.type === 'short') {
    // 1. 基础收益：只发给本轮投资者
    currentRoundInvestors.forEach(({ player, amount }) => {
        let baseGain = amount * 10;
        let totalGain = baseGain;

        if (hasBuff(player, 'buff_gold') && totalGain > 0) {
            const original = totalGain;
            totalGain = Math.floor(totalGain * 1.5);
            logs.push(`✨ ${player.name} 【点石成金】生效，收益 ${original} -> ${totalGain}`);
        }

        player.wealth += totalGain;
        
        const g = result.playerGains[player.id] || zeroGain();
        g.base += baseGain; // 记录原始base
        g.total += totalGain; // 记录加成后的total
        result.playerGains[player.id] = g;
        
        project.totalPayout += totalGain;
        project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + totalGain;

        logs.push(`  💰 ${player.name} 短期收益 ${totalGain}`);
    });

    // 2. 排名惩罚 (超上限投爆时) -> 针对所有历史投资人，投入相同则并列共享惩罚
    if (isExploded) {
        logs.push(`  💥 ${project.name} 投爆！执行排名惩罚。`);

        const groups = groupInvestorsByTiedTotal(allInvestors);
        for (const group of groups) {
            const penaltyEach = sharedPoolAmount(project.overInvestPenalty, group.startIndex, group.size);
            for (const { player } of group.members) {
                if (!player) continue;
                if (penaltyEach !== 0) {
                    player.wealth += penaltyEach;

                    const g = result.playerGains[player.id] || zeroGain();
                    g.rank += penaltyEach;
                    g.total += penaltyEach;
                    result.playerGains[player.id] = g;

                    project.totalPayout += penaltyEach;
                    project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + penaltyEach;

                    logs.push(
                      group.size > 1
                        ? `    💀 ${player.name} 并列第${group.startIndex + 1}（${group.size}人共享），惩罚 ${penaltyEach}`
                        : `    💀 ${player.name} 排名第${group.startIndex + 1}，受到惩罚 ${penaltyEach}`
                    );
                }

                // 【保险】for Short (并列第一且超上限投爆) -> 获赔
                if (group.startIndex === 0 && hasBuff(player, 'buff_insurance')) {
                    player.wealth += 100;
                    logs.push(`    🛡️ ${player.name} 在短期项目并列第一且超上限投爆，触发【保险】，获赔 100！`);

                    project.totalPayout += 100;
                    project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + 100;

                    const g = result.playerGains[player.id] || zeroGain();
                    g.total += 100;
                    result.playerGains[player.id] = g;
                }
            }
        }
    }

    // 3. 排名奖励 (恰好完成时) -> 针对所有历史投资人
    else if (isCompleted && !isExploded) {
         logs.push(`  🏅 ${project.name} 恰好完成！发放排名奖励与时代加成。`);
         applyRankAndEraBonus(game, project, allInvestors, result, logs);
    } 
    
    return result;
  }

  return result;
}

// 排名奖励(rankRewards) + 时代加成(eraBonus)，财富计入 player.wealth。
// 投入相同则并列：共享所占用名次池（floor(sum/k)）；时代加成仅第一名并列组共享。
//   短期 +30：仅 totalAccumulated === maxEnergy（调用方须为 !isExploded 分支）
//   长期 +50：totalAccumulated >= maxEnergy（含超填）
//   风险：不进入本函数；短期超上限投爆：不进入本函数
type InvestorEntry = { player: Player | undefined; total: number };

type TiedInvestorGroup = {
  members: InvestorEntry[];
  startIndex: number;
  size: number;
};

/** 按累计投入降序后的列表，将相同投入归为并列组 */
export function groupInvestorsByTiedTotal(investors: InvestorEntry[]): TiedInvestorGroup[] {
  const groups: TiedInvestorGroup[] = [];
  let i = 0;
  while (i < investors.length) {
    const total = investors[i].total;
    let j = i + 1;
    while (j < investors.length && investors[j].total === total) j += 1;
    groups.push({
      members: investors.slice(i, j),
      startIndex: i,
      size: j - i,
    });
    i = j;
  }
  return groups;
}

/** 均分名次数组中 [start, start+size) 的合计（向零取整，正负对称） */
export function sharedPoolAmount(values: number[] | undefined, startIndex: number, size: number): number {
  if (!values || size <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const v = values[startIndex + i];
    if (typeof v === "number") sum += v;
  }
  return Math.trunc(sum / size);
}

function applyRankAndEraBonus(
    game: GameState, 
    project: ActiveProject, 
    rankedInvestors: InvestorEntry[], 
    result: SettlementProjectResult,
    logs: string[],
) {
    if (rankedInvestors.length === 0) return;
    const currentTheme = game.currentEraCard?.era; 
    const isEraMatch = project.era === currentTheme;
    const eraPool = project.type === 'long' ? 50 : 30;

    const groups = groupInvestorsByTiedTotal(rankedInvestors);
    for (const group of groups) {
        const rankExtra = sharedPoolAmount(project.rankRewards, group.startIndex, group.size);
        const eraExtra =
          isEraMatch && group.startIndex === 0
            ? Math.trunc(eraPool / group.size)
            : 0;

        for (const { player } of group.members) {
            if (!player) continue;

            if (rankExtra !== 0) {
                logs.push(
                  group.size > 1
                    ? `    🏆 ${player.name} 并列第${group.startIndex + 1}（${group.size}人共享）奖励 +${rankExtra}`
                    : `    🏆 ${player.name} 排名第${group.startIndex + 1} 奖励 +${rankExtra}`
                );
            }
            if (eraExtra !== 0) {
                logs.push(
                  group.size > 1
                    ? `    🌟 ${player.name} 时代契合(并列第一共享)加成 +${eraExtra}`
                    : `    🌟 ${player.name} 时代契合(第一名)加成 +${eraExtra}`
                );
            }

            let totalExtra = rankExtra + eraExtra;

            if (hasBuff(player, 'buff_gold') && totalExtra > 0) {
                totalExtra = Math.floor(totalExtra * 1.5);
            }

            if (totalExtra !== 0) {
                player.wealth += totalExtra;

                const g = result.playerGains[player.id] || zeroGain();
                g.rank += rankExtra;
                g.era += eraExtra;
                g.total += totalExtra;
                result.playerGains[player.id] = g;

                project.totalPayout += totalExtra;
                project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + totalExtra;
            }
        }
    }
}