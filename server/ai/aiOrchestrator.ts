import type { Server } from "socket.io";
import { GameState, Player } from "../state/gameState.js";
import { askLLM } from "./llmClient.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { togglePlayerReady } from "../state/gameActions.js";
import { applyInvestments } from "../logic/investmentLogic.js";
import { useBuffCard } from "../logic/buffLogic.js";
import { broadcastUpdate } from "../network/broadcast.js";

import { PERSONA_PROMPTS } from "../secrets.js";

export async function handleAIPhase(game: GameState, io: Server | null) {
    // Only process if there are AI players and they haven't finished this phase
    const aiPlayers = game.players.filter(p => p.isAI && !p.ready);
    if (aiPlayers.length === 0) return;

    for (const ai of aiPlayers) {
        try {
            await processAITurn(game, ai);
        } catch (e) {
            console.error(`AI ${ai.name} failed to process turn:`, e);
            // Default action: just ready up to not block the game
            togglePlayerReady(game, ai.id);
        }
    }

    // After all AIs have moved, try advancing phase
    tryAdvancePhase(game);
    if (io) broadcastUpdate(io, game);
}

async function processAITurn(game: GameState, ai: Player) {
    const personaPrompt = PERSONA_PROMPTS[ai.aiPersona || "罗盘精算师"] || PERSONA_PROMPTS["罗盘精算师"];
    const baseSystemPrompt = `你现在在玩一个叫《光阴对赌》的资源管理桌游。\n${personaPrompt}\n你需要以严格的 JSON 格式输出你的决策。`;

    const stateSummary = {
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
        myEnergy: ai.energy,
        myWealth: ai.wealth,
        myInventory: ai.inventory,
        activeProjects: game.activeProjects.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            maxEnergy: p.maxEnergy,
            currentInvested: p.currentInvested,
            accumulatedInvested: p.accumulatedInvested
        }))
    };

    if (game.phase === "BUFF_USAGE" || game.phase === "INVESTMENT") {
        // 投资阶段内可用道具；不想用则直接投
        const availableBuffs = ai.inventory;
        if (game.phase === "BUFF_USAGE" || availableBuffs.length > 0) {
          if (availableBuffs.length > 0) {
            const prompt = `当前可在投资阶段使用道具卡。你手上的卡牌有: ${availableBuffs.join(", ")}。\n如果你想用卡，请输出 {"useCard": true, "cardId": "卡片ID", "targetProjectId": 目标项目ID(如果需要), "targetPlayerId": 目标玩家ID(如果需要)}。如果不想用，输出 {"useCard": false}。`;
            const buffRes = await askLLM(baseSystemPrompt, JSON.stringify(stateSummary) + "\n\n" + prompt);
            if (buffRes?.useCard && availableBuffs.includes(buffRes.cardId)) {
              const used = useBuffCard(game, ai.id, buffRes.cardId, buffRes);
              if (used.success) {
                if (!ai.usedCards) ai.usedCards = [];
                ai.usedCards.push(buffRes.cardId);
              }
            }
          }
          if (game.phase === "BUFF_USAGE") {
            togglePlayerReady(game, ai.id);
            return;
          }
        }

        const prompt = `当前是投资阶段。你有 ${ai.energy} 点精力。请将精力分配到项目上。你可以分配部分或全部精力。\n输出格式: {"investment": {"项目ID1": 投入精力数, "项目ID2": 投入精力数}}。注意：投入精力之和不能超过 ${ai.energy}，键必须是数字ID。`;
        
        const res = await askLLM(baseSystemPrompt, JSON.stringify(stateSummary) + "\n\n" + prompt);
        
        let investment: Record<number, number> = {};
        let totalAssigned = 0;
        
        if (res?.investment) {
            for (const [pId, amount] of Object.entries(res.investment)) {
                const numAmount = Number(amount);
                if (numAmount > 0) {
                    if (totalAssigned + numAmount <= ai.energy) {
                        investment[Number(pId)] = numAmount;
                        totalAssigned += numAmount;
                    }
                }
            }
        }
        
        applyInvestments(game, ai.id, investment);
        togglePlayerReady(game, ai.id);
    }
    else if (game.phase === "AUCTION") {
        // To be simple, AI will pass on auction for now
        // A more advanced system could have AI bid.
        togglePlayerReady(game, ai.id); // For auction this might not be enough, depends on auction logic
    }
    else {
        // Any other phase (ERA_INTRO, SETTLEMENT, COMMUNITY_NAMING, GAME_OVER), AI just readies up
        togglePlayerReady(game, ai.id);
    }
}
