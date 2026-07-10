import { GameState, Player, ActiveProject, SettlementProjectResult, GainBreakdown } from "../state/gameState.js";

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

  const playersBySeat = [...game.players].sort((a, b) => {
    return (a.draftOrder ?? 999) - (b.draftOrder ?? 999);
  });

  const remainingProjects: ActiveProject[] = [];

  for (const project of game.activeProjects) {
    if (!project.investorRecords) project.investorRecords = {};
    if (!project.earningRecords) project.earningRecords = {}; 
    if (!project.totalPayout) project.totalPayout = 0;

    const result = settleOneProject(game, project, playersBySeat, logs);
    snapshot.push(result);

    // 检查连续空投
    if (project.currentInvested === 0) {
        project.roundsNoInvestment = (project.roundsNoInvestment || 0) + 1;
    } else {
        project.roundsNoInvestment = 0;
    }

    if (result.isCompleted) {
        game.completedProjects.push(project);
        logs.push(`✅ 项目「${project.name}」已结束/完成，移出牌桌`);
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
  game.logs.push(...logs);

  game.players.forEach(p => {
      p.wealthHistory.push(p.wealth);
  });
}

function settleOneProject(
  game: GameState, 
  project: ActiveProject, 
  playersBySeat: Player[], 
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
      game.players.forEach(p => {
          const record = p.longTerm[project.id];
          if (record && record.status === 'active') {
              const currentAmount = p.investment?.[project.id] || 0;
              if (currentAmount < 3) {
                  const historyTotal = record.totalInvested;
                  const totalRefund = historyTotal + currentAmount; 
                  
                  p.wealth += totalRefund;
                  record.status = 'abandoned'; 
                  
                  project.totalPayout += totalRefund;
                  project.earningRecords[p.id] = (project.earningRecords[p.id] || 0) + totalRefund;

                  logs.push(`🚫 ${p.name} 对「${project.name}」追加投资不足3，判定放弃。退回 ${totalRefund}，退出排名。`);
                  
                  result.playerInvestments[p.id] = currentAmount;
                  result.playerGains[p.id] = { total: totalRefund, base: totalRefund, rank: 0, era: 0 };

                  if (p.investment) p.investment[project.id] = 0;
              }
          }
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
  .sort((a, b) => {
      // 1. 按总投入降序
      if (b.total !== a.total) return b.total - a.total;
      // 2. 按顺位 (穷人/高精力优先)
      return (a.player!.draftOrder ?? 999) - (b.player!.draftOrder ?? 999);
  });


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
      logs.push(`💥 风险项目「${project.name}」累计${totalAccumulated}，爆雷！`);
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
  if (project.type === 'long') {
    // 处理本轮投资者的投入记录逻辑已经在上面完成了
    // Long项目的特性：未完成不发钱
    if (isCompleted) {
      logs.push(`  ✅ 长期项目「${project.name}」已填满！发放累计收益与排名奖励。`);
      
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
      const rankedForBonus = allInvestors.map(i => ({ player: i.player! }));
      applyRankAndEraBonus(game, project, rankedForBonus, result, logs);

    } else {
      logs.push(`  ⏳ 长期项目进度 ${totalAccumulated}/${project.maxEnergy}`);
    }
    return result;
  }

  // === C. Short (短期项目) ===
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

    // 2. 排名惩罚 (爆雷时) -> 针对所有历史投资人
    if (isExploded) {
        logs.push(`  💥 ${project.name} 爆雷！执行排名惩罚。`);
        
        allInvestors.forEach(({ player }, index) => {
            if (!player) return;
            if (project.overInvestPenalty && index < project.overInvestPenalty.length) {
                const penalty = project.overInvestPenalty[index]; 
                
                // 扣钱
                player.wealth += penalty; // penalty 是负数
                
                const g = result.playerGains[player.id] || zeroGain();
                g.rank += penalty;
                g.total += penalty;
                result.playerGains[player.id] = g;
                
                // 惩罚不算 payout，也不算 earning (或者算负 earning?)
                project.totalPayout += penalty;
                project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + penalty;

                logs.push(`    💀 ${player.name} 排名第${index+1}，受到惩罚 ${penalty}`);
            }

            // 【保险】for Short (排名第一且爆雷) -> 获赔
            if (index === 0 && hasBuff(player, 'buff_insurance')) {
                player.wealth += 100;
                logs.push(`    🛡️ ${player.name} 在短期项目排名第一且爆雷，触发【保险】，获赔 100！`);
                
                project.totalPayout += 100;
                project.earningRecords[player.id] = (project.earningRecords[player.id] || 0) + 100;
                
                const g = result.playerGains[player.id] || zeroGain();
                g.total += 100;
                result.playerGains[player.id] = g;
            }
        });
    }

    // 3. 排名奖励 (恰好完成时) -> 针对所有历史投资人
    // ✅ 修复：必须是恰好完成 (==) 还是完成 (>=)? 
    // 逻辑：短期项目如果 >= maxEnergy 就容易爆。
    // 之前的逻辑：>= maxEnergy 触发 applyRankAndEraBonus
    // 你的需求：恰好完成 (totalAccumulated === maxEnergy) 时才有奖励。
    else if (isCompleted && !isExploded) {
        // 也就是 totalAccumulated === maxEnergy
         logs.push(`  🏅 ${project.name} 恰好完成！发放排名奖励与时代加成。`);
         
         const rankedForBonus = allInvestors.map(i => ({ player: i.player! }));
         applyRankAndEraBonus(game, project, rankedForBonus, result, logs);
    } 
    
    return result;
  }

  return result;
}

// 通用函数：处理排名奖励(rankRewards) 和 时代加成(eraBonus)
// 注意：传入的 rankedPlayers 必须是已经按贡献排序好的【全历史】投资人列表
function applyRankAndEraBonus(
    game: GameState, 
    project: ActiveProject, 
    rankedPlayers: { player: Player }[], 
    result: SettlementProjectResult,
    logs: string[],
    onlyEraBonus: boolean = false // Short项目如果是爆雷情况，可能只发EraBonus不发Rank? (目前代码没用到这个参数)
) {
    if (rankedPlayers.length === 0) return;
    const currentTheme = game.currentEraCard?.era; 
    const isEraMatch = project.era === currentTheme;

    rankedPlayers.forEach((entry, index) => {
        const { player } = entry;
        let rankExtra = 0;
        let eraExtra = 0;

        // 1. 排名奖励
        // ✅ 逻辑：短期(恰好完成) 和 长期(完成) 都会进到这里
        if (project.rankRewards && index < project.rankRewards.length) {
            rankExtra = project.rankRewards[index];
            logs.push(`    🏆 ${player.name} 排名第${index+1} 奖励 +${rankExtra}`);
        }

        // 2. 时代加成
        if (isEraMatch && index === 0) {
            eraExtra = project.type === 'long' ? 50 : 30;
            logs.push(`    🌟 ${player.name} 时代契合(第一名)加成 +${eraExtra}`);
        }

        let totalExtra = rankExtra + eraExtra;

        // 点石成金对额外奖励生效
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
    });
}