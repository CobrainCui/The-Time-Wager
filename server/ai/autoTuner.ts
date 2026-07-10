import { createInitialGame, GameState } from "../state/gameState.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { handleAIPhase } from "./aiOrchestrator.js";
import { analyzeGamePersona, AnalysisWeights } from "../logic/analysisLogic.js";
import { drawProjectsForEra } from "../state/gameEra.js";
import { shuffleArray } from "../utils/shuffle.js";

// Mapping persona strings back to English identifiers for easier comparison
const PERSONA_MAP: Record<string, string> = {
    "罗盘精算师": "compass",
    "时荫植者": "gardener",
    "涌机触发者": "trigger",
    "瞬刻炼金士": "alchemist"
};

export async function runAutoTuningSession(iterations: number = 10) {
    console.log(`\n=== 🤖 Starting Auto-Tuning Session (${iterations} iterations) ===`);
    
    const personas = ["罗盘精算师", "罗盘精算师", "时荫植者", "时荫植者", "涌机触发者", "瞬刻炼金士"];
    let totalMatches = 0;
    
    // Simple Hill Climbing Loop
    for (let i = 0; i < iterations; i++) {
        console.log(`\n--- Iteration ${i + 1} ---`);
        const game = createInitialGame("auto-tune", []);
        
        // Add 6 AI players
        personas.forEach((persona, index) => {
            game.players.push({
                id: `ai_${index}`,
                name: `AI_${persona}_${index}`,
                isAI: true,
                aiPersona: persona,
                connected: true,
                ready: false,
                energy: 15,
                wealth: 0,
                rank: 0,
                investment: {},
                longTerm: {},
                riskGains: {},
                inventory: [],
                usedCards: [],
                activeBuffs: [],
                slackedBy: [],
                totalEnergyConsumed: 15,
                wealthHistory: [0],
                investedRiskEnergy: 0,
                investedLongEnergy: 0,
                socialRank: null
            });
        });
        
        // Start Game
        game.phase = "ERA_INTRO";
        
        // Run Headless Loop
        while ((game.phase as string) !== "GAME_OVER" && (game.phase as string) !== "COMMUNITY_NAMING") {
            const previousPhase = game.phase as string;
            
            await handleAIPhase(game);
            
            // If the phase didn't change (e.g. AUCTION is skipped, or just everyone readied),
            // ensure we don't get stuck. In normal game tryAdvancePhase is called inside handleAIPhase.
            if ((game.phase as string) === previousPhase && (game.phase as string) === "AUCTION") {
                // AI currently doesn't do anything in auction, so force skip
                game.phase = "ERA_INTRO";
            }
        }
        
        // Analyze
        analyzeGamePersona(game);
        
        // Calculate Accuracy
        let correctMatches = 0;
        game.players.forEach(p => {
            const groundTruth = p.aiPersona!;
            const inferred = p.analysisResult?.primaryPersona || "";
            if (groundTruth === inferred) correctMatches++;
            console.log(`Player ${p.name} | Ground Truth: ${groundTruth} | Inferred: ${inferred}`);
        });
        
        const accuracy = (correctMatches / 6) * 100;
        totalMatches += correctMatches;
        console.log(`🎯 Iteration ${i + 1} Accuracy: ${accuracy.toFixed(2)}%`);
        
        // If accuracy is not 100%, perturb weights slightly (Hill Climbing step)
        if (accuracy < 100) {
            console.log("⚙️ Perturbing weights to improve accuracy...");
            AnalysisWeights.w_long_ratio += (Math.random() - 0.5) * 0.1;
            AnalysisWeights.w_wealth_curve += (Math.random() - 0.5) * 0.1;
            AnalysisWeights.w_risk_ratio += (Math.random() - 0.5) * 0.1;
            AnalysisWeights.w_roi_efficiency += (Math.random() - 0.5) * 2;
            
            // Ensure weights stay positive
            AnalysisWeights.w_long_ratio = Math.max(0.1, AnalysisWeights.w_long_ratio);
            AnalysisWeights.w_wealth_curve = Math.max(0.1, AnalysisWeights.w_wealth_curve);
            AnalysisWeights.w_risk_ratio = Math.max(0.1, AnalysisWeights.w_risk_ratio);
            AnalysisWeights.w_roi_efficiency = Math.max(1, AnalysisWeights.w_roi_efficiency);
        }
    }
    
    const overallAccuracy = (totalMatches / (iterations * 6)) * 100;
    console.log(`\n✅ Tuning Session Complete. Overall Accuracy: ${overallAccuracy.toFixed(2)}%`);
    console.log("Optimized Weights:");
    console.log(JSON.stringify(AnalysisWeights, null, 2));
}
