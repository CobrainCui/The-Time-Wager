import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState, type Player } from "../state/gameState.js";
import {
  armAutoHostStart,
  ensureAutoHost,
  resetAutoHostState,
} from "./autoHost.js";
import { AUTO_HOST_CONFIG } from "./autoHostConfig.js";
import { placeAuctionBid } from "../logic/auctionCards.js";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    socketId: `sock-${id}`,
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
    slackedBy: [],
    totalEnergyConsumed: 15,
    wealthHistory: [100],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    ...overrides,
  };
}

function roomId(suffix: string): string {
  return `auto-host-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

test("auto host starts a ready waiting room and advances era intro", () => {
  const game = createInitialGame(roomId("start"), []);
  game.autoHostEnabled = true;
  game.players = [player("h1"), player("h2")];

  const t0 = 1_000_000;
  assert.equal(armAutoHostStart(game, t0), true);
  assert.equal(game.autoStartAt, t0 + AUTO_HOST_CONFIG.startDelayMs);

  assert.equal(ensureAutoHost(game, null, t0 + AUTO_HOST_CONFIG.startDelayMs + 1), true);
  assert.equal(game.phase, "ERA_INTRO");
  assert.equal(game.autoStartAt, undefined);

  // 第一次进入时代介绍：只开始倒计时，不立刻推进
  ensureAutoHost(game, null, t0);
  assert.ok(game.autoHostNextActionAt != null);
  assert.equal(game.phase, "ERA_INTRO");

  ensureAutoHost(game, null, (game.autoHostNextActionAt ?? 0) + 1);
  assert.equal(game.phase, "INVESTMENT");
  assert.ok(game.investmentEndsAt != null);

  resetAutoHostState(game.roomId);
});

test("auto host passes unpriced auction lots, then ends the auction", () => {
  const game = createInitialGame(roomId("auction-pass"), []);
  game.autoHostEnabled = true;
  game.players = [player("h1"), player("h2")];
  game.phase = "AUCTION";
  game.currentEra = 2;
  game.roundInEra = 1;
  game.auctionFocusCardId = undefined;
  game.auctionFocusSetAt = undefined;
  game.auctionDistributedCardIds = [];
  game.auctionCompletedDeals = [];
  game.auctionBids = [];
  game.auctionPassedCardIds = [];
  game.auctionPassedCardIds = [];

  // 聚焦第一张
  let now = 2_000_000;
  assert.equal(ensureAutoHost(game, null, now), true);
  assert.ok(game.auctionFocusCardId);

  // 4 张卡全部无人出价 -> 每张到时自动跳过，最后结束拍卖
  for (let i = 0; i < 8 && game.phase === "AUCTION"; i++) {
    now += AUTO_HOST_CONFIG.auctionIdleMs + 1;
    ensureAutoHost(game, null, now);
  }
  assert.equal(game.phase, "ERA_INTRO");
  assert.equal((game.auctionPassedCardIds ?? []).length, 4);
  resetAutoHostState(game.roomId);
});

test("auto host hammers the leading bid and hands over the card", () => {
  const game = createInitialGame(roomId("auction-sold"), []);
  game.autoHostEnabled = true;
  const h1 = player("h1");
  const h2 = player("h2");
  game.players = [h1, h2];
  game.phase = "AUCTION";
  game.currentEra = 2;
  game.roundInEra = 1;
  game.auctionFocusCardId = "buff_gold";
  const base = Date.now();
  game.auctionFocusSetAt = base;
  game.auctionDistributedCardIds = [];
  game.auctionCompletedDeals = [];
  game.auctionBids = [];
  game.auctionPassedCardIds = [];

  const bid = placeAuctionBid(game, h1.id, 5);
  assert.equal(bid.ok, true);

  const now = Date.now() + AUTO_HOST_CONFIG.auctionIdleMs + 1;
  assert.equal(ensureAutoHost(game, null, now), true);
  assert.equal(h1.wealth, 95);
  assert.ok(h1.inventory.includes("buff_gold"));
  assert.equal((game.auctionCompletedDeals ?? []).length, 1);
  assert.notEqual(game.auctionFocusCardId, "buff_gold");
  resetAutoHostState(game.roomId);
});

test("auto host falls back to a system community name after timeout", () => {
  const game = createInitialGame(roomId("naming"), []);
  game.autoHostEnabled = true;
  game.sessionId = `naming-${Date.now()}`;
  game.players = [player("h1", { wealth: 500 }), player("h2", { wealth: 10 })];
  game.phase = "COMMUNITY_NAMING";

  const t0 = 4_000_000;
  assert.equal(ensureAutoHost(game, null, t0), true);
  assert.ok(game.autoHostNextActionAt != null);
  assert.equal(game.phase, "COMMUNITY_NAMING");

  ensureAutoHost(game, null, (game.autoHostNextActionAt ?? 0) + 1);
  assert.equal(game.phase, "GAME_OVER");
  assert.ok(game.communityName);
  resetAutoHostState(game.roomId);
});

test("turning auto host off clears pending timers", () => {
  const game: GameState = createInitialGame(roomId("off"), []);
  game.autoHostEnabled = false;
  game.autoStartAt = Date.now() + 10_000;
  game.autoHostNextActionAt = Date.now() + 10_000;
  assert.equal(ensureAutoHost(game, null, Date.now()), true);
  assert.equal(game.autoStartAt, undefined);
  assert.equal(game.autoHostNextActionAt, undefined);
});

test("AI richest player names the community when no model is configured", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const game = createInitialGame(roomId("ai-naming"), []);
    game.sessionId = `ai-naming-${Date.now()}`;
    game.phase = "COMMUNITY_NAMING";
    game.players = [
      player("human", { wealth: 80 }),
      player("ai-boss", { wealth: 900, isAI: true, aiDifficulty: "normal" }),
    ];
    const { ensureAiCommunityNaming } = await import("../ai/aiOrchestrator.js");
    const named = await ensureAiCommunityNaming(game, null);
    assert.equal(named, true);
    assert.equal(game.phase, "GAME_OVER");
    assert.ok(game.communityName);
    resetAutoHostState(game.roomId);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
