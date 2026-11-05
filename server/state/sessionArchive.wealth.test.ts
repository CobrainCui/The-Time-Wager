import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type Player } from "./gameState.js";
import { archiveCompletedSession } from "./sessionArchive.js";

function player(id: string, name: string, wealth: number, isAI: boolean): Player {
  return {
    id,
    name,
    connected: true,
    ready: true,
    energy: 0,
    wealth,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 15,
    wealthHistory: [wealth],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    isAI,
  };
}

test("community leaderboard wealth counts AI and human seats equally", () => {
  const game = createInitialGame(`archive-test-${Date.now()}`, []);
  game.sessionId = `archive-test-${Date.now()}`;
  game.communityName = "测试社区";
  game.phase = "GAME_OVER";
  game.players = [
    player("human_1", "真人", 120, false),
    player("ai_1", "🤖AI", 900, true),
  ];

  const record = archiveCompletedSession(game);
  assert.equal(record.communityWealth, 1020, "AI 财富应与真人一样计入社区分");
  assert.equal(record.topPlayer.name, "🤖AI", "AI 可以成为首富");
  assert.equal(record.topPlayer.wealth, 900);
  assert.equal(record.aiPlayerCount, 1);
  assert.equal(record.humanPlayerCount, 1);
  assert.equal(record.playersSummary.length, 2);
  assert.equal(record.playersSummary.find((p) => p.name === "🤖AI")?.isAI, true);
});
