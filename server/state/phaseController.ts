import { GameState } from "./gameState.js";
import { 
  isEveryoneReady, 
  isDraftingComplete, 
  isInvestmentComplete, 
  resetAllReady 
} from "./gameActions.js";
import { settlePhase } from "../logic/projectSettlement.js";
import { drawProjectsForEra, updateEraCard } from "../state/gameEra.js";
import { shuffleArray } from "../utils/shuffle.js";
import { eraCards } from "../data/game_data.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { beginAuctionSession } from "../logic/auctionCards.js";
import { appendSessionEvent, ensureSessionStarted, recordPhaseChange } from "./sessionTelemetry.js";

// 统一倒计时：10分钟 (包含 Buff 阶段和 Investment 阶段)
const TOTAL_ACTION_TIME_MS = 10 * 60 * 1000;

export function tryAdvancePhase(game: GameState) {
  const initialPhase = game.phase;
  
  // 1. ERA_INTRO -> ...
  if (game.phase === "ERA_INTRO") {
    if (isEveryoneReady(game)) {
      // === Era 1 逻辑 (无 Buff 阶段) ===
      if (game.currentEra === 1) {
          // Era 1 第1轮: 随机座次 -> 抽卡 -> 直接进 Investment
          if (game.roundInEra === 1) {
            const shuffledIds = shuffleArray(game.players.map(p => p.id));
            game.players.forEach(p => { p.draftOrder = shuffledIds.indexOf(p.id) + 1; });
            appendSessionEvent(game, "draft_seat_chosen", {
              mode: "random",
              orders: Object.fromEntries(
                game.players.map((p) => [p.id, p.draftOrder])
              ),
            });
            drawProjectsForEra(game);
          }
          
          game.phase = "INVESTMENT";
          game.investmentEndsAt = Date.now() + TOTAL_ACTION_TIME_MS;
      } 
      // === Era 2+ 逻辑 (有 Buff 阶段) ===
      else {
          // Era 2+ 第1轮: 进入选座 (Drafting)
          if (game.roundInEra === 1) {
            game.phase = "DRAFTING";
            game.players.forEach(p => p.draftOrder = undefined);
            const draftingPool = AI_BOT_ENABLED
              ? game.players
              : game.players.filter((p) => !isAiPlayer(p));
            const sorted = [...draftingPool].sort((a, b) => {
                if (a.wealth !== b.wealth) return a.wealth - b.wealth;
                return a.energy - b.energy; // 财富相同比精力
            });
            game.draftingState = {
              queue: sorted.map(p => p.id),
              currentIndex: 0,
              availableSlots: [1, 2, 3, 4, 5, 6]
            };
          }
          // Era 2+ 第2轮: 跳过选座，直接进入 Buff 阶段
          else {
            game.phase = "BUFF_USAGE";
            game.investmentEndsAt = Date.now() + TOTAL_ACTION_TIME_MS; // 开始10分钟倒计时
            game.buffPhaseEndsAt = game.investmentEndsAt; 
          }
      }
      
      resetAllReady(game);
    }
  }

  // 2. DRAFTING -> BUFF_USAGE (仅 Era 2+ 会触发)
  else if (game.phase === "DRAFTING") {
    if (isDraftingComplete(game)) {
      drawProjectsForEra(game); // 选完座后更新项目
      
      // 选完座后进入 Buff 阶段，开始计时
      game.phase = "BUFF_USAGE";
      game.investmentEndsAt = Date.now() + TOTAL_ACTION_TIME_MS;
      game.buffPhaseEndsAt = game.investmentEndsAt;
      
      resetAllReady(game);
    }
  }

  // 3. BUFF_USAGE -> INVESTMENT
  else if (game.phase === "BUFF_USAGE") {
      if (isEveryoneReady(game)) {
          game.phase = "INVESTMENT";
          // 倒计时继续
          game.buffPhaseEndsAt = undefined;
          resetAllReady(game);
      }
  }

  // 4. INVESTMENT -> SETTLEMENT
  else if (game.phase === "INVESTMENT") {
    if (isInvestmentComplete(game)) {
      settlePhase(game);
      game.investmentEndsAt = undefined; // 结束倒计时
      
      if (game.currentEra > 4) {
          game.phase = "COMMUNITY_NAMING";
      } else {
          game.phase = "SETTLEMENT";
      }
      resetAllReady(game);
    }
  }

  // 5. SETTLEMENT -> ERA_INTRO (或 AUCTION)
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
      .then((m) => m.handleAIPhase(game))
      .catch((e) => console.error("AI Error:", e));
  }
}

function advanceRound(game: GameState) {
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

    const energyMap: Record<number, number> = { 1: 15, 2: 13, 3: 11, 4: 9 };
    p.energy = energyMap[game.currentEra] || 9;
  });
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