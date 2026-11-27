import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState, type Player } from "../state/gameState.js";
import {
  armAutoHostStart,
  ensureAutoHost,
  resetAutoHostState,
  syncAutoAuctionDeadline,
} from "./autoHost.js";
import { AUTO_HOST_CONFIG } from "./autoHostConfig.js";
import { placeAuctionBid } from "../logic/auctionCards.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { handleActionTimeExpired } from "../state/actionTimeExpiry.js";
import { handleAIPhase, hasAiTurnInFlight } from "../ai/aiOrchestrator.js";

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

test("auto host starts a ready waiting room; with humans it waits at era intro and reminds", () => {
  const game = createInitialGame(roomId("start"), []);
  game.autoHostEnabled = true;
  // 产品版正式开局固定 6 席；本用例用 6 名真人避免依赖 AI Key
  game.players = [
    player("h1"),
    player("h2"),
    player("h3"),
    player("h4"),
    player("h5"),
    player("h6"),
  ];

  const t0 = 1_000_000;
  assert.equal(armAutoHostStart(game, t0), true);
  assert.equal(game.autoStartAt, t0 + AUTO_HOST_CONFIG.startDelayMs);

  assert.equal(ensureAutoHost(game, null, t0 + AUTO_HOST_CONFIG.startDelayMs + 1), true);
  assert.equal(game.phase, "ERA_INTRO");
  assert.equal(game.autoStartAt, undefined);

  // 有真人在线：不自动替玩家点继续，也不自动推进
  ensureAutoHost(game, null, t0);
  assert.equal(game.autoHostNextActionAt, undefined);
  assert.equal(game.phase, "ERA_INTRO");

  // 停留过久：系统主持人只发提醒
  ensureAutoHost(game, null, t0 + AUTO_HOST_CONFIG.phaseReminderMs + 1);
  assert.equal(game.phase, "ERA_INTRO");
  assert.ok(
    game.logs.some((line) => line.includes("系统主持人提醒")),
    "应记录停留提醒"
  );

  // 真人自己点「继续」后才进入投资
  for (const p of game.players) {
    p.ready = true;
    game.readyPlayers.add(p.id);
  }
  tryAdvancePhase(game);
  assert.equal(game.phase, "INVESTMENT");
  assert.ok(game.investmentEndsAt != null);

  resetAutoHostState(game.roomId);
});

test("with humans and autoHostEnabled, all-locked advances after short grace period unless unlocked", () => {
  const game = createInitialGame(roomId("invest-wait"), []);
  game.autoHostEnabled = true;
  game.phase = "INVESTMENT";
  game.activeProjects = [
    {
      id: 1,
      name: "P1",
      type: "short",
      maxEnergy: 20,
      accumulatedInvested: 0,
      currentInvested: 0,
      roundsNoInvestment: 0,
      investedThisRound: false,
      investorRecords: {},
      earningRecords: {},
      totalPayout: 0,
    },
  ];
  game.players = [player("h1"), player("h2")];
  for (const p of game.players) {
    p.ready = true;
    game.readyPlayers.add(p.id);
  }
  const t0 = Date.now();
  game.investmentEndsAt = t0 + 10 * 60_000;

  // 刚全员锁定时只启动缓冲倒计时，不立即结算，玩家仍可解锁
  assert.equal(ensureAutoHost(game, null, t0), true);
  tryAdvancePhase(game);
  assert.equal(game.phase, "INVESTMENT");
  assert.equal(game.autoHostNextActionAt, t0 + AUTO_HOST_CONFIG.allLockedGraceMs);

  // 若有人在缓冲期内解锁，立即取消自动结算
  game.players[0].ready = false;
  game.readyPlayers.delete("h1");
  ensureAutoHost(game, null, t0 + 1_000);
  assert.equal(game.phase, "INVESTMENT");
  assert.equal(game.autoHostNextActionAt, undefined);

  // 重新全员锁定并经过缓冲期，自动进入结算
  game.players[0].ready = true;
  game.readyPlayers.add("h1");
  const t1 = t0 + 2_000;
  ensureAutoHost(game, null, t1);
  assert.equal(game.phase, "INVESTMENT");
  assert.equal(ensureAutoHost(game, null, t1 + AUTO_HOST_CONFIG.allLockedGraceMs + 1), true);
  assert.equal(game.phase, "SETTLEMENT");
  resetAutoHostState(game.roomId);
});

test("with autoHostEnabled=false, all-locked investment still waits for timer", () => {
  const game = createInitialGame(roomId("invest-manual"), []);
  game.autoHostEnabled = false;
  game.phase = "INVESTMENT";
  game.activeProjects = [
    {
      id: 1,
      name: "P1",
      type: "short",
      maxEnergy: 20,
      accumulatedInvested: 0,
      currentInvested: 0,
      roundsNoInvestment: 0,
      investedThisRound: false,
      investorRecords: {},
      earningRecords: {},
      totalPayout: 0,
    },
  ];
  game.players = [player("h1"), player("h2")];
  for (const p of game.players) {
    p.ready = true;
    game.readyPlayers.add(p.id);
  }
  game.investmentEndsAt = Date.now() + 10 * 60_000;

  ensureAutoHost(game, null, Date.now());
  tryAdvancePhase(game);
  assert.equal(game.phase, "INVESTMENT");

  game.investmentEndsAt = Date.now() - 1;
  assert.equal(handleActionTimeExpired(game), true);
  assert.equal(game.phase, "SETTLEMENT");
  resetAutoHostState(game.roomId);
});

test("without connected humans the auto host still advances a fully locked investment", () => {
  const game = createInitialGame(roomId("invest-ai"), []);
  game.autoHostEnabled = true;
  game.phase = "INVESTMENT";
  game.activeProjects = [
    {
      id: 1,
      name: "P1",
      type: "short",
      maxEnergy: 20,
      accumulatedInvested: 0,
      currentInvested: 0,
      roundsNoInvestment: 0,
      investedThisRound: false,
      investorRecords: {},
      earningRecords: {},
      totalPayout: 0,
    },
  ];
  game.players = [
    player("ai-1", { isAI: true, ready: true }),
    player("ai-2", { isAI: true, ready: true }),
  ];
  for (const p of game.players) game.readyPlayers.add(p.id);
  game.investmentEndsAt = Date.now() + 10 * 60_000;

  assert.equal(ensureAutoHost(game, null, Date.now()), true);
  assert.equal(game.phase, "SETTLEMENT");
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

test("严格模式：AI 首富没有模型时拒绝用本地名称兜底，并记录故障", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    AI_STRICT_AGENT: process.env.AI_STRICT_AGENT,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.AI_STRICT_AGENT = "true";
  try {
    const game = createInitialGame(roomId("ai-naming-strict"), []);
    game.sessionId = `ai-naming-strict-${Date.now()}`;
    game.phase = "COMMUNITY_NAMING";
    game.players = [
      player("human", { wealth: 80 }),
      player("ai-boss", { wealth: 900, isAI: true, aiDifficulty: "normal" }),
    ];
    const { ensureAiCommunityNaming } = await import("../ai/aiOrchestrator.js");
    const named = await ensureAiCommunityNaming(game, null);
    assert.equal(named, false, "严格模式不能用本地名称池代替模型");
    assert.equal(game.communityName, undefined);
    assert.ok(game.aiFailures?.["ai-boss"], "应记录 AI 故障供管理端处理");
    resetAutoHostState(game.roomId);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
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

test("AI richest player names the community when no model is configured (non-strict legacy)", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    AI_STRICT_AGENT: process.env.AI_STRICT_AGENT,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.AI_STRICT_AGENT = "false";
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

test("autoAuction updates and signals new deadline immediately when a bid arrives", () => {
  const game = createInitialGame(roomId("auction-sync"), []);
  game.autoHostEnabled = true;
  const h1 = player("h1");
  const h2 = player("h2");
  game.players = [h1, h2];
  game.phase = "AUCTION";
  game.currentEra = 2;
  game.roundInEra = 1;
  const t0 = Date.now();
  game.auctionFocusCardId = "buff_gold";
  game.auctionFocusSetAt = t0;
  game.auctionDistributedCardIds = [];
  game.auctionCompletedDeals = [];
  game.auctionBids = [];
  game.auctionPassedCardIds = [];

  assert.equal(syncAutoAuctionDeadline(game, t0), true);
  assert.equal(game.autoHostNextActionAt, t0 + AUTO_HOST_CONFIG.auctionIdleMs);

  const bidTime = t0 + 3_000;
  const bid = placeAuctionBid(game, h1.id, 5);
  assert.equal(bid.ok, true);
  bid.bid.timestamp = bidTime;

  // ensureAutoHost 必须在未到期前也因 deadline 延后返回 true，使 tick 立即广播最新倒计时
  assert.equal(ensureAutoHost(game, null, bidTime + 500), true);
  assert.equal(
    game.autoHostNextActionAt,
    Math.min(
      bidTime + AUTO_HOST_CONFIG.auctionIdleMs,
      t0 + AUTO_HOST_CONFIG.auctionLotMaxMs
    )
  );
  // 同一时间戳再 tick 应无变化
  assert.equal(ensureAutoHost(game, null, bidTime + 1_000), false);
  // 到达该截止时间立即落槌
  assert.equal(ensureAutoHost(game, null, game.autoHostNextActionAt!), true);
  assert.equal(h1.wealth, 95);
  assert.ok(h1.inventory.includes("buff_gold"));
  resetAutoHostState(game.roomId);
});

test("autoAuction waits within hardDeadline if AI turn is in flight, then settles at hardDeadline", () => {
  const game = createInitialGame(roomId("auction-inflight"), []);
  game.autoHostEnabled = true;
  const h1 = player("h1");
  const ai1 = player("ai-1", { isAI: true });
  game.players = [h1, ai1];
  game.phase = "AUCTION";
  game.currentEra = 2;
  game.roundInEra = 1;
  const t0 = Date.now();
  game.auctionFocusCardId = "buff_gold";
  game.auctionFocusSetAt = t0;
  game.auctionDistributedCardIds = [];
  game.auctionCompletedDeals = [];
  game.auctionBids = [];
  game.auctionPassedCardIds = [];

  // 即使没有 AI inFlight，到达 hardDeadline 时仍正常跳过或落槌
  const hardDeadline = t0 + AUTO_HOST_CONFIG.auctionLotMaxMs;
  assert.equal(ensureAutoHost(game, null, hardDeadline + 1), true);
  assert.notEqual(game.auctionFocusCardId, "buff_gold");
  resetAutoHostState(game.roomId);
});

test("autoAuction preserves extended deadline across ticks while AI turn is in flight", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.SILICONFLOW_API_KEY;
  const game = createInitialGame(roomId("auction-inflight-preserve"), []);
  game.autoHostEnabled = true;
  const h1 = player("h1");
  const ai1 = player("ai-1", { isAI: true, aiPersona: "瞬刻炼金士", aiDifficulty: "easy" });
  game.players = [h1, ai1];
  game.phase = "AUCTION";
  game.currentEra = 2;
  game.roundInEra = 1;
  const t0 = Date.now();
  game.auctionFocusCardId = "buff_gold";
  game.auctionFocusSetAt = t0;
  game.auctionDistributedCardIds = [];
  game.auctionCompletedDeals = [];
  game.auctionBids = [];
  game.auctionPassedCardIds = [];
  game.forceBuyUsedPlayerIds = [];

  const turnPromise = handleAIPhase(game, null);
  try {
    assert.equal(hasAiTurnInFlight(game.roomId), true);
    const baseIdleDeadline = t0 + AUTO_HOST_CONFIG.auctionIdleMs;
    const checkNow = baseIdleDeadline + 100;
    assert.equal(ensureAutoHost(game, null, checkNow), true);
    const extendedDeadline = game.autoHostNextActionAt!;
    assert.ok(extendedDeadline > baseIdleDeadline);
    assert.ok(extendedDeadline <= t0 + AUTO_HOST_CONFIG.auctionLotMaxMs);

    // 后续 tick 仍在扩展窗口内，syncAutoAuctionDeadline 不应把倒计时拉回 baseIdleDeadline
    assert.equal(syncAutoAuctionDeadline(game, checkNow + 50), false);
    assert.equal(game.autoHostNextActionAt, extendedDeadline);
    assert.equal(ensureAutoHost(game, null, checkNow + 50), false);
    assert.equal(game.autoHostNextActionAt, extendedDeadline);
  } finally {
    await turnPromise;
    resetAutoHostState(game.roomId);
    for (const [k, v] of Object.entries(saved)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
