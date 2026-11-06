import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState, type Player } from "./gameState.js";
import { startGameNow, ensureAiSeatsFilled, resolveSeatTarget } from "./gameStart.js";

function human(id: string): Player {
  return {
    id,
    name: id,
    connected: true,
    ready: false,
    energy: 15,
    wealth: 100,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    buffRoundNotes: [],
    slackedBy: [],
    coffeePurchasesThisRound: 0,
    totalEnergyConsumed: 15,
    wealthHistory: [100],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
  };
}

test("从时代介绍强制进入投资时，清空上一阶段的 ready 与草稿", () => {  const game: GameState = createInitialGame("force-invest", []);
  game.phase = "ERA_INTRO";
  game.energyTableSize = 6;
  game.sessionId = "s1";
  game.sessionStartedAt = Date.now();
  game.players = [human("p1"), human("p2")];
  game.players[0].ready = true;
  game.players[0].investment = { 1: 5 };
  game.players[0].investmentDraft = { 1: 5 };
  game.readyPlayers.add("p1");

  const result = startGameNow(null, game, "admin");
  assert.equal(result.ok, true);
  assert.equal(game.phase, "INVESTMENT");
  assert.equal(game.players.every((p) => p.ready === false), true);
  assert.equal(game.readyPlayers.size, 0);
  assert.deepEqual(game.players[0].investment, {});
  assert.equal(game.players[0].investmentDraft, undefined);
});

test("正式开局固定 6 席：6 名真人无需补 AI", () => {
  const game = createInitialGame("six-humans", []);
  game.players = Array.from({ length: 6 }, (_, i) => human(`p${i + 1}`));
  const result = ensureAiSeatsFilled(game);
  assert.equal(result.ok, true);
  assert.equal(result.added, 0);
  assert.equal(game.players.length, 6);
});

test("正式开局至少需要 1 名在线真人", () => {
  const game = createInitialGame("no-humans", []);
  game.players = [];
  const result = ensureAiSeatsFilled(game);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /真人/);
});

test("房主选 AI 人数：目标人数 = 真人座位 + AI 座位", () => {
  const game = createInitialGame("seat-target", []);
  game.players = [human("p1")];
  game.aiSeats = 3;
  assert.equal(resolveSeatTarget(game), 4);
  game.players.push(human("p2"));
  assert.equal(resolveSeatTarget(game), 5);
  game.players.push(human("p3"));
  // 3 真人 + 3 AI 超过 6 席，封顶 6
  assert.equal(resolveSeatTarget(game), 6);
});

test("不足 4 人时拒绝开局", () => {
  const game = createInitialGame("too-few", []);
  game.players = [human("p1")];
  game.aiSeats = 2;
  const result = ensureAiSeatsFilled(game);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /开局需要|至少 4 人/);
});

test("4 名真人 + AI 设为 0：不需要任何 AI 也能开局", () => {
  const game = createInitialGame("four-humans", []);
  game.players = Array.from({ length: 4 }, (_, i) => human(`p${i + 1}`));
  game.aiSeats = 0;
  const result = ensureAiSeatsFilled(game);
  assert.equal(result.ok, true);
  assert.equal(result.added, 0);
  assert.equal(game.players.length, 4);
});
