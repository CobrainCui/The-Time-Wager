import { createInitialGame, GameState, Player } from "../state/gameState.js";
import { handleAIPhase } from "./aiOrchestrator.js";
import {
  analyzeGamePersona,
  AnalysisWeights,
  FateSketchThresholds,
} from "../logic/analysisLogic.js";
import { applyRoundEnergy } from "../logic/energySchedule.js";

/** 五种可 AI 扮演的命运素描（桥梁依赖主持评分，不在此评估） */
const AI_PERSONA_SLOTS = [
  "罗盘精算师",
  "时荫植者",
  "涌机触发者",
  "瞬刻炼金士",
  "罗盘精算师",
  "时荫植者",
] as const;

export type PersonaEvalResult = {
  correct: number;
  total: number;
  accuracy: number;
  confusion: Record<string, Record<string, number>>;
  mismatches: { name: string; expected: string; got: string }[];
};

export function evaluatePersonaAccuracy(game: GameState): PersonaEvalResult {
  const confusion: Record<string, Record<string, number>> = {};
  const mismatches: PersonaEvalResult["mismatches"] = [];
  let correct = 0;
  let total = 0;

  for (const p of game.players) {
    if (!p.isAI || !p.aiPersona) continue;
    total++;
    const expected = p.aiPersona;
    const got = p.analysisResult?.primaryPersona ?? "";
    if (got === expected) correct++;

    if (!confusion[expected]) confusion[expected] = {};
    confusion[expected][got] = (confusion[expected][got] ?? 0) + 1;

    if (got !== expected) {
      mismatches.push({ name: p.name, expected, got });
    }
  }

  return {
    correct,
    total,
    accuracy: total > 0 ? (correct / total) * 100 : 0,
    confusion,
    mismatches,
  };
}

function pushAiPlayer(game: GameState, persona: string, index: number) {
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
    investedShortEnergy: 0,
    socialRank: null,
  });
}

export async function runAutoTuningSession(iterations: number = 10) {
  console.log(
    `\n=== 🤖 Starting Auto-Tuning Session (${iterations} iterations) ===`
  );

  let totalMatches = 0;
  let totalSlots = 0;
  const aggregateConfusion: Record<string, Record<string, number>> = {};

  for (let i = 0; i < iterations; i++) {
    console.log(`\n--- Iteration ${i + 1} ---`);
    const game = createInitialGame("auto-tune", []);

    AI_PERSONA_SLOTS.forEach((persona, index) => {
      pushAiPlayer(game, persona, index);
    });

    applyRoundEnergy(game, { relock: true });
    game.phase = "ERA_INTRO";

    while (
      (game.phase as string) !== "GAME_OVER" &&
      (game.phase as string) !== "COMMUNITY_NAMING"
    ) {
      const previousPhase = game.phase as string;

      await handleAIPhase(game, null);

      if (
        (game.phase as string) === previousPhase &&
        (game.phase as string) === "AUCTION"
      ) {
        game.phase = "ERA_INTRO";
      }
    }

    analyzeGamePersona(game);

    const evalResult = evaluatePersonaAccuracy(game);
    totalMatches += evalResult.correct;
    totalSlots += evalResult.total;

    for (const m of evalResult.mismatches) {
      console.log(
        `Player ${m.name} | Ground Truth: ${m.expected} | Inferred: ${m.got}`
      );
    }
    console.log(
      `🎯 Iteration ${i + 1} Accuracy: ${evalResult.accuracy.toFixed(2)}%`
    );

    for (const [expected, row] of Object.entries(evalResult.confusion)) {
      if (!aggregateConfusion[expected]) aggregateConfusion[expected] = {};
      for (const [got, count] of Object.entries(row)) {
        aggregateConfusion[expected][got] =
          (aggregateConfusion[expected][got] ?? 0) + count;
      }
    }

    if (evalResult.accuracy < 100) {
      console.log("⚙️ Perturbing weights/thresholds (hill-climb step)...");
      AnalysisWeights.w_long_ratio += (Math.random() - 0.5) * 0.05;
      AnalysisWeights.w_short_ratio += (Math.random() - 0.5) * 0.05;
      AnalysisWeights.w_risk_ratio += (Math.random() - 0.5) * 0.05;
      AnalysisWeights.w_roi_efficiency += (Math.random() - 0.5) * 1;
      FateSketchThresholds.gardenerLongTermMin += (Math.random() - 0.5) * 2;
      FateSketchThresholds.compassLongTermMax += (Math.random() - 0.5) * 2;

      AnalysisWeights.w_long_ratio = Math.max(0.1, AnalysisWeights.w_long_ratio);
      AnalysisWeights.w_short_ratio = Math.max(0.1, AnalysisWeights.w_short_ratio);
      AnalysisWeights.w_risk_ratio = Math.max(0.1, AnalysisWeights.w_risk_ratio);
      AnalysisWeights.w_roi_efficiency = Math.max(
        1,
        AnalysisWeights.w_roi_efficiency
      );
    }
  }

  const overallAccuracy =
    totalSlots > 0 ? (totalMatches / totalSlots) * 100 : 0;
  console.log(
    `\n✅ Tuning Session Complete. Overall Accuracy: ${overallAccuracy.toFixed(2)}%`
  );
  console.log("Aggregate confusion (rows=expected, cols=inferred):");
  console.log(JSON.stringify(aggregateConfusion, null, 2));
  console.log("AnalysisWeights:", JSON.stringify(AnalysisWeights, null, 2));
  console.log(
    "FateSketchThresholds:",
    JSON.stringify(FateSketchThresholds, null, 2)
  );
}
