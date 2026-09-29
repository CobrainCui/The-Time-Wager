import { GameState } from "./gameState.js";
import { 
  isEveryoneReady, 
  isEveryoneReadyToLeaveBuff,
  isInvestmentComplete, 
  resetAllReady 
} from "./gameActions.js";
import { settlePhase } from "../logic/projectSettlement.js";
import { drawProjectsForEra, updateEraCard } from "../state/gameEra.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { beginAuctionSession } from "../logic/auctionCards.js";
import { ensureSessionStarted, recordPhaseChange } from "./sessionTelemetry.js";
import { clearActionDeadline, startInvestmentDeadline } from "./actionDeadline.js";
import { applyRoundEnergy } from "../logic/energySchedule.js";

export function tryAdvancePhase(game: GameState) {
  const initialPhase = game.phase;
  if (game.phase === "ROOM_WAITING") return;
  
  // 1. ERA_INTRO -> ...
  if (game.phase === "ERA_INTRO") {
    if (isEveryoneReady(game)) {
      // === Era 1 逻辑 (无 Buff 阶段) ===
      if (game.currentEra === 1) {
          if (game.roundInEra === 1) {
            drawProjectsForEra(game);
          }
          
          game.phase = "INVESTMENT";
          startInvestmentDeadline(game);
          game.logs.push("⏱️ 10 分钟倒计时开始（投资阶段）");
      }
      // === Era 2+ 逻辑 (有 Buff 阶段) ===
      else {
          if (game.roundInEra === 1) {
            drawProjectsForEra(game);
          }
          clearActionDeadline(game);
          game.phase = "BUFF_USAGE";
      }
      
      resetAllReady(game);
    }
  }

  // 2. BUFF_USAGE -> INVESTMENT（全员真实玩家「进入讨论和投资」后开表）
  else if (game.phase === "BUFF_USAGE") {
      if (isEveryoneReadyToLeaveBuff(game)) {
          game.phase = "INVESTMENT";
          startInvestmentDeadline(game);
          game.logs.push("⏱️ 10 分钟倒计时开始（投资阶段）");
          resetAllReady(game);
      }
  }

  // 3. INVESTMENT -> SETTLEMENT
  else if (game.phase === "INVESTMENT") {
    if (isInvestmentComplete(game)) {
      settlePhase(game);
      clearActionDeadline(game);
      
      if (game.currentEra > 4) {
          game.phase = "COMMUNITY_NAMING";
      } else {
          game.phase = "SETTLEMENT";
      }
      resetAllReady(game);
    }
  }

  // 4. SETTLEMENT -> ERA_INTRO (或 AUCTION)
  else if (game.phase === "SETTLEMENT") {
    if (isEveryoneReady(game)) {
      advanceRound(game);
      // advanceRound 内部会处理 phase 变更（如果是换代且有拍卖）
      
      // ✅ 修复 Bug：使用类型断言 (as string) 绕过 TS 的类型收窄检查
      const currentPhase = game.phase as string;
      if (
          currentPhase !== "AUCTION" && 
          currentPhase !== "COMMUNITY_NAMING" && 
          currentPhase !== "GAME_OVER"
      ) {
          game.phase = "ERA_INTRO";
      }
      resetAllReady(game);
    }
  }

  if (game.phase !== initialPhase) {
    if (game.phase === "INVESTMENT") {
      ensureSessionStarted(game);
    }
    recordPhaseChange(game, initialPhase, game.phase, "tryAdvancePhase");
  }

  if (AI_BOT_ENABLED && game.phase !== initialPhase) {
    import("../ai/aiOrchestrator.js")
      .then(async (m) => {
        const { getGameIo } = await import("../network/gameIo.js");
        await m.handleAIPhase(game, getGameIo());
      })
      .catch((e) => console.error("AI Error:", e));
  }
}

function advanceRound(game: GameState) {
  clearActionDeadline(game);
  // 清理临时 Buff
  game.players.forEach(p => p.activeBuffs = []);

  game.globalRound += 1;
  game.roundInEra += 1;

  // 检查是否需要换代
  const isNewEra = game.roundInEra > 2;

  if (isNewEra) {
    // === 换代逻辑 ===
    game.roundInEra = 1;
    game.currentEra += 1;
    
    // 超过 Era 4 -> 游戏结束
    if (game.currentEra > 4) {
      settleEndGame(game);
      game.phase = "COMMUNITY_NAMING";
      return;
    }

    // 更新时代卡
    updateEraCard(game);
    
    // 换代前插入拍卖阶段
    game.phase = "AUCTION";
    beginAuctionSession(game);
    game.logs.push(`🔨 第 ${game.currentEra - 1} 轮拍卖会开启`);
  } else {
    // 时代内轮转，不做特殊处理
  }

  // 重置玩家状态
  game.players.forEach(p => {
    p.ready = false;
    p.investment = {};
    p.investmentDraft = undefined;
    p.preSubmitInvestmentDraft = undefined;
  });

  applyRoundEnergy(game);
}

function settleEndGame(game: GameState) {
    game.logs.push("🏁 游戏结束！正在结算未完成的长期项目...");
    
    game.activeProjects.forEach(proj => {
        if (proj.type !== 'long') return;
        
        let totalProgress = 0;
        game.players.forEach(p => {
            totalProgress += (p.longTerm[proj.id]?.totalInvested || 0);
        });
        
        let ratio = 1;
        if (totalProgress >= (proj.maxEnergy * 2 / 3)) {
            ratio = 10;
        } else if (totalProgress >= (proj.maxEnergy / 3)) {
            ratio = 5;
        }
        
        game.players.forEach(p => {
            const myInvest = p.longTerm[proj.id]?.totalInvested || 0;
            if (myInvest > 0) {
                const gain = myInvest * ratio;
                p.wealth += gain;
                game.logs.push(`📜 ${p.name} 结算长期项目「${proj.name}」(进度${totalProgress}/${proj.maxEnergy}, 比例1:${ratio}), 获得 ${gain}`);
            }
        });
    });
}