/**
 * 命运素描分类测试
 *
 * Baseline（改版前 legacy max-score 取 Top1 + score>20）：
 * - 合成夹具无统一记录；AI 对局 autoTuner 命中率随 LLM 波动，典型混淆对为 植者↔罗盘、涌机↔炼金。
 * - 改版后目标：六类合成代表用例 100% 通过（见下方 describe）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeGamePersona,
  classifyFateSketch,
  computePersonaDimensions,
  PersonaDimensionScores,
} from "./analysisLogic.js";
import { FATE_SKETCH_CONFIG } from "./personaConfig.js";
import { ActiveProject, GameState, Player } from "../state/gameState.js";

const FATE_SKETCH_PERSONA_NAMES = [
  "桥梁架构师",
  "瞬刻炼金士",
  "罗盘精算师",
  "时荫植者",
  "随机诗人",
  "涌机触发者",
] as const;

function makePlayer(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    energy: 0,
    wealth: 0,
    connected: true,
    ready: true,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 100,
    wealthHistory: [0],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    ...overrides,
  };
}

function makeGame(
  player: Player,
  projects: ActiveProject[],
  totalRiskEnergyAvailable = 600
): GameState {
  return {
    roomId: "test",
    players: [player],
    phase: "GAME_OVER",
    phaseFinished: new Set(),
    readyPlayers: new Set(),
    transactions: [],
    currentEra: 5,
    roundInEra: 2,
    globalRound: 10,
    eraSequence: [0, 1, 2, 3, 4],
    activeProjects: [],
    uncompletedProjects: [],
    completedProjects: projects,
    drawnProjects: new Set(),
    totalRiskEnergyAvailable,
    pendingEvents: {},
    eventCards: {},
    eventChoices: {},
    logs: [],
    playerLogs: {},
  };
}

function shortProject(
  id: number,
  playerId: string,
  invest: number,
  gain: number
): ActiveProject {
  return {
    id,
    name: "短期",
    type: "short",
    era: "科技",
    maxEnergy: 50,
    accumulatedInvested: invest,
    currentInvested: 0,
    roundsNoInvestment: 0,
    investedThisRound: false,
    investorRecords: { [playerId]: invest },
    earningRecords: { [playerId]: gain },
    totalPayout: gain,
  };
}

function longProject(
  id: number,
  playerId: string,
  invest: number,
  gain: number
): ActiveProject {
  return {
    id,
    name: "长期",
    type: "long",
    era: "气候",
    maxEnergy: 70,
    accumulatedInvested: invest,
    currentInvested: 0,
    roundsNoInvestment: 0,
    investedThisRound: false,
    investorRecords: { [playerId]: invest },
    earningRecords: { [playerId]: gain },
    totalPayout: gain,
  };
}

describe("classifyFateSketch (分层判定)", () => {
  const base: PersonaDimensionScores = {
    longTermism: 40,
    shortTermism: 40,
    riskTaking: 30,
    ruleIntervention: 25,
    socialConnection: 60,
    resourceConversion: 35,
  };

  it("社交满分 → 桥梁架构师", () => {
    assert.equal(
      classifyFateSketch({ ...base, socialConnection: 100 }),
      "桥梁架构师"
    );
  });

  it("高长期主义 → 时荫植者（优先于涌机/炼金）", () => {
    assert.equal(
      classifyFateSketch({ ...base, longTermism: 75, riskTaking: 80 }),
      "时荫植者"
    );
  });

  it("高风险 + 高干预 → 涌机触发者", () => {
    assert.equal(
      classifyFateSketch({
        ...base,
        longTermism: 40,
        riskTaking: 55,
        ruleIntervention: 50,
        resourceConversion: 30,
      }),
      "涌机触发者"
    );
  });

  it("高短期 + 高干预 + 中低风险 → 瞬刻炼金士", () => {
    assert.equal(
      classifyFateSketch({
        ...base,
        longTermism: 35,
        shortTermism: 60,
        riskTaking: 40,
        ruleIntervention: 45,
      }),
      "瞬刻炼金士"
    );
  });

  it("低风险低干预高 ROI 且非植者级长期 → 罗盘精算师", () => {
    assert.equal(
      classifyFateSketch({
        ...base,
        longTermism: 45,
        riskTaking: 25,
        ruleIntervention: 20,
        resourceConversion: 55,
      }),
      "罗盘精算师"
    );
  });

  it("四不像 → 随机诗人", () => {
    assert.equal(
      classifyFateSketch({
        ...base,
        longTermism: 50,
        shortTermism: 30,
        riskTaking: 45,
        ruleIntervention: 30,
        resourceConversion: 30,
      }),
      "随机诗人"
    );
  });
});

describe("computePersonaDimensions + analyzeGamePersona 合成场景", () => {
  it("时荫植者：长期精力主导 + 后期财富曲线", () => {
    const p = makePlayer("gardener", {
      investedLongEnergy: 88,
      totalEnergyConsumed: 100,
      investedShortEnergy: 8,
      investedRiskEnergy: 4,
      wealthHistory: [0, 0, 0, 0, 5, 120],
      usedCards: ["buff_spirit"],
    });
    const game = makeGame(p, [
      longProject(1, "gardener", 88, 2000),
      shortProject(2, "gardener", 8, 50),
    ]);
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "时荫植者");
  });

  it("罗盘精算师：低风险、少道具、高超额 ROI", () => {
    const p = makePlayer("compass", {
      investedShortEnergy: 70,
      investedLongEnergy: 15,
      investedRiskEnergy: 15,
      totalEnergyConsumed: 100,
      wealthHistory: [10, 30, 50, 70, 90, 110],
      usedCards: [],
    });
    const game = makeGame(
      p,
      [shortProject(1, "compass", 70, 2200)],
      600
    );
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "罗盘精算师");
  });

  it("涌机触发者：高风险投入 + 攻击型道具", () => {
    const p = makePlayer("trigger", {
      investedRiskEnergy: 280,
      investedShortEnergy: 40,
      investedLongEnergy: 20,
      totalEnergyConsumed: 100,
      usedCards: ["buff_lottery", "buff_short", "buff_slack"],
      wealthHistory: [0, 20, 80, 200, 300, 400],
    });
    const game = makeGame(
      p,
      [shortProject(1, "trigger", 40, 800)],
      400
    );
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "涌机触发者");
  });

  it("瞬刻炼金士：短线为主 + 干扰道具、少碰风险盘", () => {
    const p = makePlayer("alchemist", {
      investedShortEnergy: 90,
      investedLongEnergy: 6,
      investedRiskEnergy: 4,
      totalEnergyConsumed: 100,
      usedCards: ["buff_slack", "buff_rebound", "buff_short"],
      wealthHistory: [5, 40, 60, 80, 90, 100],
    });
    const game = makeGame(p, [shortProject(1, "alchemist", 82, 600)], 500);
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "瞬刻炼金士");
  });

  it("桥梁架构师：主持社交 A 档", () => {
    const p = makePlayer("bridge", {
      socialRank: "A",
      investedShortEnergy: 50,
      totalEnergyConsumed: 100,
    });
    const game = makeGame(p, []);
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "桥梁架构师");
  });

  it("随机诗人：各维中庸", () => {
    const p = makePlayer("poet", {
      investedShortEnergy: 35,
      investedLongEnergy: 35,
      investedRiskEnergy: 30,
      totalEnergyConsumed: 100,
      wealthHistory: [20, 25, 30, 35, 40, 45],
      usedCards: ["buff_gold"],
    });
    const game = makeGame(
      p,
      [shortProject(1, "poet", 35, 400)],
      600
    );
    const scores = computePersonaDimensions(p, game);
    assert.equal(classifyFateSketch(scores), "随机诗人");
  });

  it("旧局无 short 埋点时从项目记录回填", () => {
    const p = makePlayer("backfill", {
      investedShortEnergy: 0,
      investedLongEnergy: 0,
      totalEnergyConsumed: 50,
    });
    const game = makeGame(
      p,
      [shortProject(1, "backfill", 40, 200), longProject(2, "backfill", 10, 100)],
      200
    );
    analyzeGamePersona(game);
    assert.equal(p.investedShortEnergy, 40);
    assert.equal(p.investedLongEnergy, 10);
    assert.ok((p.analysisResult?.scores.shortTermism ?? 0) > 30);
  });

  it("植者 vs 罗盘：高长期应归植者而非罗盘", () => {
    const p = makePlayer("not-compass", {
      investedLongEnergy: 80,
      investedShortEnergy: 12,
      investedRiskEnergy: 8,
      totalEnergyConsumed: 100,
      wealthHistory: [0, 0, 0, 10, 80, 150],
      usedCards: [],
    });
    const game = makeGame(p, [
      longProject(1, "not-compass", 80, 1800),
      shortProject(2, "not-compass", 12, 200),
    ]);
    analyzeGamePersona(game);
    assert.equal(p.analysisResult?.primaryPersona, "时荫植者");
  });
});

describe("FATE_SKETCH_CONFIG 玩家简介", () => {
  it("六类命运素描均有非空 desc", () => {
    for (const name of FATE_SKETCH_PERSONA_NAMES) {
      const entry = FATE_SKETCH_CONFIG[name];
      assert.ok(entry, name);
      assert.ok(entry.desc.length >= 40, name);
      assert.equal(entry.name, name);
    }
  });

  it("analyzeGamePersona 的 primaryPersonaDesc 与配置一致", () => {
    const p = makePlayer("bridge", {
      socialRank: "A",
      investedShortEnergy: 50,
      totalEnergyConsumed: 100,
    });
    const game = makeGame(p, []);
    analyzeGamePersona(game);
    const persona = p.analysisResult!.primaryPersona;
    assert.equal(
      p.analysisResult!.primaryPersonaDesc,
      FATE_SKETCH_CONFIG[persona]?.desc
    );
  });
});
