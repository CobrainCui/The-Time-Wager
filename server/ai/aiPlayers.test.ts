import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState, type Player } from "../state/gameState.js";
import {
  addAiPlayer,
  countAiPlayers,
  fillAiPlayers,
  removeAiPlayer,
  setAiPlayerModel,
} from "./aiRoster.js";
import { buildFallbackInvestmentPlan, chooseAuctionAction, sanitizeInvestmentPlan } from "./aiPolicy.js";
import {
  askProductAiWithFallback,
  ensureAiProgress,
  forgetAiRoom,
  getAiPhaseKey,
  handleAIPhase,
  isAiInOpeningWindow,
  pruneGroupThinkingStatuses,
  sweepStaleChatThinkingStatuses,
  wakeAiOpeningWindowIfHumansReady,
} from "./aiOrchestrator.js";
import { buildOpeningChatPrompt } from "./aiPrompt.js";
import { ProductAiMemory } from "./aiMemory.js";
import { verifyAiAgents } from "./aiPreflight.js";
import { profileFor, profileForPlayer } from "./aiPersona.js";
import { buildAiObservation } from "./aiObservation.js";
import { buildSystemPrompt } from "./aiPrompt.js";
import { getCommunityNamer } from "../state/gameState.js";
import { applyInvestments } from "../logic/investmentLogic.js";
import { unlockSubmittedInvestment } from "../state/gameActions.js";
import { createLotteryOffer } from "../logic/lotterySettle.js";
import { acceptLotteryOffer } from "../logic/lotteryDraw.js";
import { serializeGameForClient } from "../network/broadcast.js";
import { createCustomChatGroup } from "../logic/chatGroups.js";
import { buildSessionExport } from "../export/sessionExport.js";
import { resetGameSession } from "../state/gameState.js";
import {
  shortTermProjects,
  longTermProjects,
  riskProjects,
  type ProjectCard,
} from "../data/game_data.js";
import type { ActiveProject } from "../state/gameState.js";

// 这些用例验证本地策略/托管兜底路径；严格 Agent 模式单独在 aiStrict.test.ts 覆盖。
process.env.AI_STRICT_AGENT = "false";

function project(card: ProjectCard): ActiveProject {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    maxEnergy: card.maxEnergy,
    era: card.era,
    rankRewards: card.rankRewards,
    overInvestPenalty: card.overInvestPenalty,
    accumulatedInvested: 0,
    currentInvested: 0,
    roundsNoInvestment: 0,
    investedThisRound: false,
    investorRecords: {},
    earningRecords: {},
    totalPayout: 0,
  };
}

function makeGame(): { game: GameState; human: Player; ai: Player } {
  const game = createInitialGame("ai-test-room", []);
  const human: Player = {
    id: "human_1",
    name: "真人",
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
  };
  game.players.push(human);
  const added = addAiPlayer(game, { persona: "罗盘精算师", difficulty: "normal" });
  assert.equal(added.ok, true);
  const ai = (added as { ok: true; player: Player }).player;
  game.phase = "INVESTMENT";
  game.activeProjects = [
    project(shortTermProjects[0]),
    project(shortTermProjects[1]),
    project(longTermProjects[0]),
    project(riskProjects[0]),
  ];
  game.energyTableSize = 2;
  for (const p of game.players) {
    p.energy = 15;
    p.connected = true;
  }
  return { game, human, ai };
}

test("AI observation does not expose whether other seats are AI or human", () => {
  const { game, ai } = makeGame();
  const obs = buildAiObservation(game, ai);
  for (const p of obs.players) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(p, "isAI"),
      false,
      "players payload 不应带 isAI"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(p, "agentModel"),
      false,
      "players payload 不应带模型"
    );
  }
  assert.equal(obs.players.find((p) => p.id === ai.id)?.name, ai.name);
});

test("sanitizeInvestmentPlan rejects an AI-created group with only one other member", () => {
  const { game, ai, human } = makeGame();
  const plan = sanitizeInvestmentPlan(game, ai, {
    reasoning: "拉个群聊合作",
    messages: [],
    createGroup: { name: "合作群", memberIds: [human.id, ai.id] },
    transfer: null,
    coffee: 0,
    useCard: null,
    investment: {},
  });
  assert.equal(plan.createGroup, null, "不足 2 名其他玩家时应拒绝");
});

test("sanitizeInvestmentPlan keeps a valid AI-created group", () => {
  const { game, ai, human } = makeGame();
  const other: Player = { ...human, id: "human_2", name: "乙" };
  game.players.push(other);
  const plan = sanitizeInvestmentPlan(game, ai, {
    reasoning: "拉个群聊合作",
    messages: [],
    createGroup: { name: "合作群", memberIds: ["human_1", other.id] },
    transfer: null,
    coffee: 0,
    useCard: null,
    investment: {},
  });
  assert.equal(plan.createGroup?.name, "合作群");
  assert.deepEqual(new Set(plan.createGroup!.memberIds), new Set(["human_1", other.id]));
});

test("fallback investment is legal and spends within energy", () => {
  const { game, ai } = makeGame();
  const plan = buildFallbackInvestmentPlan(game, ai);
  const total = Object.values(plan.investment).reduce((s, v) => s + v, 0);
  assert.ok(total <= ai.energy, `投资 ${total} 不应超过精力 ${ai.energy}`);
  for (const [id, amount] of Object.entries(plan.investment)) {
    assert.ok(game.activeProjects.some((p) => p.id === Number(id)), "项目必须在牌桌上");
    assert.ok(Number.isInteger(amount) && amount > 0, "投入必须是正整数");
  }
  const applied = applyInvestments(game, ai.id, plan.investment, "ai");
  assert.equal(applied, true);
  assert.ok(game.players.find((p) => p.id === ai.id)!.energy >= 0);
});

test("sanitizeInvestmentPlan rejects unknown projects and caps coffee", () => {
  const { game, ai } = makeGame();
  ai.wealth = 100;
  const plan = sanitizeInvestmentPlan(
    game,
    ai,
    {
      reasoning: "x",
      messages: ["hello"],
      transfer: { toPlayerId: "missing", amount: 999, note: "x" },
      coffee: 99,
      useCard: null,
      investment: { 9999: 10, [String(game.activeProjects[0].id)]: 999 },
    },
    profileFor("瞬刻炼金士", "normal")
  );
  const total = Object.values(plan.investment).reduce((s, v) => s + v, 0);
  assert.ok(total <= ai.energy + plan.coffee, "投资不得超过精力 + 咖啡");
  assert.ok(plan.coffee <= 2, "咖啡最多 2 杯");
  assert.equal(plan.transfer, null, "无效转账应被丢弃");
  assert.ok(!(9999 in plan.investment), "未知项目应被丢弃");
});

test("auction policy passes without focus and respects budget", () => {
  const { game, ai } = makeGame();
  game.phase = "AUCTION";
  game.auctionFocusCardId = undefined;
  assert.equal(chooseAuctionAction(game, ai, profileFor("涌机触发者", "hard"), 0).action, "pass");

  game.auctionFocusCardId = "buff_gold";
  game.auctionBids = [];
  ai.wealth = 4;
  assert.equal(chooseAuctionAction(game, ai, profileFor("涌机触发者", "hard"), 0).action, "pass");

  ai.wealth = 100;
  const plan = chooseAuctionAction(game, ai, profileFor("涌机触发者", "hard"), 0);
  assert.equal(plan.action, "bid");
  assert.equal(plan.amount, 5);
});

test("handleAIPhase bids in an auction when a lot is focused", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const { game, ai } = makeGame();
    game.phase = "AUCTION";
    game.currentEra = 1;
    game.auctionBids = [];
    game.auctionDistributedCardIds = [];
    game.auctionCompletedDeals = [];
    game.forceBuyUsedPlayerIds = [];
    game.auctionFocusCardId = "buff_gold";
    ai.wealth = 100;
    await handleAIPhase(game, null);
    assert.ok((game.auctionBids ?? []).length > 0, "AI 应在焦点卡上出价");
    const bid = game.auctionBids![0];
    assert.equal(bid.playerId, ai.id);
    assert.equal(bid.amount, 5);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("AI roster caps at five AI and six seats", () => {
  const { game } = makeGame();
  const beforePhase = game.phase;
  game.phase = "ROOM_WAITING";
  const added = fillAiPlayers(game, 6);
  game.phase = beforePhase;
  assert.ok(added >= 0);
  assert.equal(game.players.length, 6);
  assert.equal(countAiPlayers(game), 5);
  const extra = addAiPlayer(game, { persona: "时荫植者" });
  assert.equal(extra.ok, false);
});

test("handleAIPhase readies AI and submits a legal investment without a model", async () => {
  const saved = {
    AI_API_KEY: process.env.AI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  };
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const { game, human, ai } = makeGame();
    game.phase = "INVESTMENT";
    if (human.socketId) human.socketId = undefined;
    await handleAIPhase(game, null);
    const after = game.players.find((p) => p.id === ai.id)!;
    assert.equal(after.ready, true, "AI 必须 ready，不能阻塞阶段");
    const total = Object.values(after.investment).reduce((s, v) => s + v, 0);
    assert.ok(total <= 15, "AI 投资不得超过本轮精力");
    for (const id of Object.keys(after.investment)) {
      assert.ok(game.activeProjects.some((p) => p.id === Number(id)));
    }
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("new AI players have no preset persona and get a freeform prompt", () => {
  const { ai } = makeGame();
  assert.equal(ai.aiPersona, undefined, "产品版默认不指定人格");
  const profile = profileForPlayer(ai);
  assert.equal(profile.freeform, true);
  assert.equal(profile.personaLabel, "自由发挥");
  const prompt = buildSystemPrompt(profile);
  assert.ok(prompt.includes("自由发挥"), "提示词应鼓励模型自行形成打法");
  assert.ok(!prompt.includes("你的性格倾向"), "自由发挥不应注入固定人格");
});

test("AI 座位号按添加顺序分配，移除后优先复用空位", () => {
  const game = createInitialGame("ai-slot-room", []);
  const first = addAiPlayer(game);
  const second = addAiPlayer(game);
  const third = addAiPlayer(game);
  assert.ok(first.ok && second.ok && third.ok);
  assert.deepEqual(
    [first.player.aiSlot, second.player.aiSlot, third.player.aiSlot],
    [1, 2, 3]
  );
  assert.equal(removeAiPlayer(game, second.player.id), true);
  const reused = addAiPlayer(game);
  assert.ok(reused.ok);
  assert.equal(reused.player.aiSlot, 2, "空出的座位应被优先复用，保证配置映射稳定");
});

test("AI can become the community namer when it is the richest online player", () => {
  const { game, human, ai } = makeGame();
  human.connected = true;
  human.wealth = 50;
  ai.connected = true;
  ai.wealth = 999;
  assert.equal(getCommunityNamer(game)?.id, ai.id);
});

test("lottery public visibility feeds publicFeed without buff_gold leak, private stays hidden", () => {
  const { game, human, ai } = makeGame();
  human.inventory.push("buff_gold", "buff_lottery");
  human.activeBuffs.push({ cardId: "buff_gold" }, { cardId: "buff_lottery" });
  ai.inventory.push("buff_lottery");
  ai.activeBuffs.push({ cardId: "buff_lottery" });

  const pubDraw = createLotteryOffer(game, human.id, 30, {
    roll: 5,
    source: "server",
    visibility: "public",
  });
  const pubRes = acceptLotteryOffer(game, human.id, pubDraw.offer.offerId);
  assert.equal(pubRes.ok, true);
  assert.equal(game.publicFeed?.length, 1);
  assert.ok(game.publicFeed?.[0].text.includes("公开开奖【彩票】：掷出 5 点"));
  assert.ok(!game.publicFeed?.[0].text.includes("点石成金"));
  assert.ok(!game.publicFeed?.[0].text.includes("60"));

  const privDraw = createLotteryOffer(game, ai.id, 100, {
    roll: 6,
    source: "server",
    visibility: "private",
  });
  const privRes = acceptLotteryOffer(game, ai.id, privDraw.offer.offerId);
  assert.equal(privRes.ok, true);
  assert.equal(game.publicFeed?.length, 1, "私密开奖不应写入 publicFeed");

  const obs = buildAiObservation(game, ai);
  assert.equal(obs.publicFeed.length, 1);
  assert.ok(obs.publicFeed[0].text.includes("公开开奖"));
});

test("AI observation retains accepted/rejected transfers in directHistory", () => {
  const { game, human, ai } = makeGame();
  game.transactions.push({
    id: "tx-1yuan",
    fromId: human.id,
    fromName: human.name,
    toId: ai.id,
    toName: ai.name,
    amount: 1,
    note: "转1块钱试试",
    status: "accepted",
    timestamp: Date.now() - 1000,
  });
  const obs = buildAiObservation(game, ai);
  assert.equal(obs.directHistory.length, 1);
  assert.equal(obs.directHistory[0].amount, 1);
  assert.equal(obs.directHistory[0].status, "accepted");
  assert.equal(obs.directHistory[0].direction, "in");
});

test("AI can unlock its own submitted investment via source='ai'", () => {
  const { game, ai } = makeGame();
  game.phase = "INVESTMENT";
  game.investmentEndsAt = Date.now() + 60_000;
  const projId = game.activeProjects[0].id;
  const applied = applyInvestments(game, ai.id, { [projId]: 6 });
  assert.equal(applied, true);
  ai.ready = true;
  game.readyPlayers.add(ai.id);

  const blockedSelf = unlockSubmittedInvestment(game, ai.id, "self");
  assert.deepEqual(blockedSelf, { ok: false, reason: "ai_player" });

  const unlockedByAi = unlockSubmittedInvestment(game, ai.id, "ai");
  assert.deepEqual(unlockedByAi, { ok: true });
  assert.equal(ai.ready, false);
  assert.equal(ai.energy, 15);
  assert.equal(ai.investmentDraft?.[projId], 6);
});

test("serializeGameForClient scopes aiChatStatuses for group membership and 1v1 DMs", () => {
  const { game, human, ai } = makeGame();
  game.phase = "ROOM_WAITING";
  const added2 = addAiPlayer(game);
  const added3 = addAiPlayer(game);
  assert.ok(added2.ok && added3.ok);
  game.phase = "INVESTMENT";
  const ai2 = added2.player;
  const ai3 = added3.player;

  const shared = createCustomChatGroup(game, human.id, [ai.id, ai2.id], "公开联盟");
  const secret = createCustomChatGroup(game, ai.id, [ai2.id, ai3.id], "AI密聊");
  assert.ok(shared.ok && secret.ok);

  game.aiChatStatuses = {
    [`group:${shared.group.id}`]: {
      [ai.id]: { playerId: ai.id, playerName: ai.name, state: "silent", updatedAt: Date.now() },
    },
    [`group:${secret.group.id}`]: {
      [ai2.id]: { playerId: ai2.id, playerName: ai2.name, state: "thinking", updatedAt: Date.now() },
    },
    [`dm:${human.id}:${ai.id}`]: {
      [ai.id]: { playerId: ai.id, playerName: ai.name, state: "thinking", updatedAt: Date.now() },
    },
  };

  const humanPayload = serializeGameForClient(game, {}, human.id) as {
    aiChatStatuses?: Record<string, Record<string, { state: string }>>;
  };
  assert.equal(humanPayload.aiChatStatuses?.[`group:${shared.group.id}`]?.[ai.id]?.state, "silent");
  assert.equal(humanPayload.aiChatStatuses?.[`group:${secret.group.id}`], undefined);
  assert.equal(humanPayload.aiChatStatuses?.[`peer:${ai.id}`]?.[ai.id]?.state, "thinking");

  const otherPayload = serializeGameForClient(game, {}, ai3.id) as {
    aiChatStatuses?: Record<string, Record<string, { state: string }>>;
  };
  assert.equal(otherPayload.aiChatStatuses?.[`group:${shared.group.id}`], undefined);
  assert.equal(otherPayload.aiChatStatuses?.[`group:${secret.group.id}`]?.[ai2.id]?.state, "thinking");
  assert.equal(otherPayload.aiChatStatuses?.[`peer:${ai.id}`], undefined);
});

test("sanitizeInvestmentPlan preserves multi-card useCards combos within inventory stock", () => {
  const { game, ai } = makeGame();
  ai.inventory = ["buff_gold", "buff_lottery"];
  const plan = sanitizeInvestmentPlan(game, ai, {
    useCards: [
      { cardId: "buff_gold" },
      { cardId: "buff_lottery", visibility: "private" },
      { cardId: "buff_gold" }, // 超过库存的第二张点石成金应被过滤
    ],
    investment: { [game.activeProjects[0].id]: 5 },
  } as unknown as Parameters<typeof sanitizeInvestmentPlan>[2]);
  assert.equal(plan.useCards?.length, 2);
  assert.deepEqual(
    plan.useCards?.map((c) => ({ cardId: c.cardId, visibility: c.visibility })),
    [
      { cardId: "buff_gold", visibility: undefined },
      { cardId: "buff_lottery", visibility: "private" },
    ]
  );
  assert.equal(plan.useCard?.cardId, "buff_gold");
});

test("AI observation strictly hides opponents' private energy, hand, drafts, and current investments", () => {
  const { game, human, ai } = makeGame();
  human.energy = 11;
  human.inventory = ["buff_gold", "buff_short"];
  human.activeBuffs = [{ cardId: "buff_gold" }];
  human.investmentDraft = { [game.activeProjects[0].id]: 9 };
  human.investment = { [game.activeProjects[1].id]: 4 };
  human.coffeePurchasesThisRound = 2;

  const obs = buildAiObservation(game, ai);
  const opponent = obs.players.find((p) => p.id === human.id)!;
  assert.equal(opponent.isMe, false);
  for (const forbidden of [
    "energy",
    "inventory",
    "inventoryCount",
    "activeBuffs",
    "usedCards",
    "investment",
    "investmentDraft",
    "longTerm",
    "riskGains",
    "coffeePurchases",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(opponent, forbidden),
      false,
      `opponent observation must not expose ${forbidden}`
    );
  }
  for (const proj of obs.projects) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "investorRecords"),
      false,
      "projects must not expose other players' investorRecords"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(proj, "currentInvested"),
      false,
      "projects must not expose current-round hidden investments"
    );
  }
});

test("sanitizeInvestmentPlan does not clip long investments by headroom (prevents 1:1 abandon)", () => {
  const { game, ai } = makeGame();
  game.phase = "INVESTMENT";
  const lp = project(longTermProjects[0]);
  lp.accumulatedInvested = lp.maxEnergy - 2; // 仅剩 2 格 headroom
  game.activeProjects = [lp];
  ai.energy = 10;
  ai.longTerm = {
    [lp.id]: { totalInvested: 12, status: "active" },
  };

  const sanitized = sanitizeInvestmentPlan(game, ai, {
    coffee: 0,
    investment: { [lp.id]: 5 },
  });
  assert.equal(
    sanitized.investment[lp.id],
    5,
    "长期项目仅余 2 格时续投 5 点不应被 headroom 裁成 2 后被 >=3 规则清零"
  );
});

test("sanitizeInvestmentPlan counts self work_rest+slack (+8) and retroactive work_rest (+16) energy", () => {
  const { game, human, ai } = makeGame();
  game.phase = "INVESTMENT";
  const sp = project(shortTermProjects[0]);
  sp.maxEnergy = 40;
  game.activeProjects = [sp];
  ai.energy = 10;
  ai.inventory = ["buff_work_rest", "buff_slack"];
  ai.slackEnergyLost = [8];
  ai.slackedBy = [human.id];

  const sanitized = sanitizeInvestmentPlan(game, ai, {
    coffee: 0,
    useCards: [
      { cardId: "buff_work_rest" }, // 省略 targetPlayerId 时应默认自身，且追溯恢复 +16
      { cardId: "buff_slack", targetPlayerId: ai.id }, // 自摸鱼再 +8
    ],
    investment: { [sp.id]: 34 }, // 10 + 16 + 8 = 34
  });
  assert.equal(sanitized.useCards?.length, 2);
  assert.equal(sanitized.useCards?.[0]?.targetPlayerId, ai.id);
  assert.equal(sanitized.investment[sp.id], 34);
});

test("getAiPhaseKey changes across auction focus cards and status cleaners clear stale thinking", () => {
  const { game, ai } = makeGame();
  game.phase = "AUCTION";
  game.globalRound = 3;
  game.currentEra = 2;
  game.roundInEra = 1;
  game.auctionFocusCardId = "buff_gold";
  const k1 = getAiPhaseKey(game);
  game.auctionFocusCardId = "buff_slack";
  const k2 = getAiPhaseKey(game);
  assert.notEqual(k1, k2, "拍卖切换焦点卡时 phaseKey 必须变化以防看门狗误杀");

  const ai2: Player = {
    ...ai,
    id: "ai_2",
    name: "AI2",
    aiSlot: 2,
  };
  const baseNow = Date.now();
  game.aiChatStatuses = {
    "group:public": {
      [ai.id]: { playerId: ai.id, playerName: ai.name, state: "thinking", updatedAt: baseNow - 10_000 },
      [ai2.id]: { playerId: ai2.id, playerName: ai2.name, state: "thinking", updatedAt: baseNow - 120_000 },
    },
  };
  assert.equal(pruneGroupThinkingStatuses(game, "group:public", new Set([ai2.id])), true);
  assert.equal(game.aiChatStatuses["group:public"]?.[ai.id], undefined);
  assert.ok(game.aiChatStatuses["group:public"]?.[ai2.id]);
  assert.equal(sweepStaleChatThinkingStatuses(game, 90_000, baseNow), true);
  assert.equal(game.aiChatStatuses["group:public"], undefined);
});

test("sanitizeInvestmentPlan redistributes energy clipped from over-headroom short/risk bets", () => {
  const { game, ai } = makeGame();
  game.phase = "INVESTMENT";
  const shortSmall = project(shortTermProjects[0]);
  shortSmall.accumulatedInvested = shortSmall.maxEnergy - 6; // 仅余 6 格
  const safeLong = project(longTermProjects[0]);
  game.activeProjects = [shortSmall, safeLong];
  ai.energy = 15;

  const sanitized = sanitizeInvestmentPlan(game, ai, {
    coffee: 0,
    investment: { [shortSmall.id]: 15 },
  });
  assert.equal(sanitized.investment[shortSmall.id], 6);
  assert.equal(sanitized.investment[safeLong.id], 9);
  assert.equal(
    (sanitized.investment[shortSmall.id] ?? 0) + (sanitized.investment[safeLong.id] ?? 0),
    15
  );
});

test("serializeGameForClient exposes aiDecisions/aiTokenUsage only to god view and resetGameSession clears them", () => {
  const { game, human, ai } = makeGame();
  game.aiDecisions = [
    {
      id: "d1",
      timestamp: Date.now(),
      phase: "INVESTMENT",
      era: 1,
      roundInEra: 1,
      globalRound: 1,
      playerId: ai.id,
      playerName: ai.name,
      kind: "investment",
      model: "test-model",
      reasoning: "秘密内心推理",
      summary: "投 15",
      totalTokens: 1234,
      latencyMs: 500,
    },
  ];
  game.aiTokenUsage = { [ai.id]: 1234 };
  game.aiTokenBudgetPerGame = 3_000_000;

  const playerPayload = serializeGameForClient(game, {}, human.id) as Record<string, unknown>;
  assert.equal(playerPayload.aiDecisions, undefined);
  assert.equal(playerPayload.aiTokenUsage, undefined);
  assert.equal(playerPayload.aiTokenBudgetPerGame, undefined);

  const godPayload = serializeGameForClient(game, { isGodView: true }, null) as {
    aiDecisions?: unknown[];
    aiTokenUsage?: Record<string, number>;
    aiTokenBudgetPerGame?: number;
  };
  assert.equal(godPayload.aiDecisions?.length, 1);
  assert.equal(godPayload.aiTokenUsage?.[ai.id], 1234);
  assert.equal(godPayload.aiTokenBudgetPerGame, 3_000_000);

  const exported = buildSessionExport(game);
  const exportedAi = exported.players.find((p) => p.id === ai.id);
  assert.equal(exportedAi?.aiTokensUsed, 1234);

  ai.aiModelOverride = "deepseek-ai/DeepSeek-V4.1-Flash";
  resetGameSession(game);
  assert.deepEqual(game.aiDecisions, []);
  assert.deepEqual(game.aiTokenUsage, {});
  const godAfter = serializeGameForClient(game, { isGodView: true }, null) as {
    players: Array<{ id: string; aiModelOverride?: string }>;
  };
  const humanAfter = serializeGameForClient(game, { isGodView: false }, human.id) as {
    players: Array<{ id: string; aiModelOverride?: string }>;
  };
  assert.equal(godAfter.players.find((p) => p.id === ai.id)?.aiModelOverride, "deepseek-ai/DeepSeek-V4.1-Flash");
  assert.equal(humanAfter.players.find((p) => p.id === ai.id)?.aiModelOverride, undefined);
});

test("ProductAiMemory records, masks PII, formats digest by round, and clears", () => {
  const mem = new ProductAiMemory();
  assert.equal(mem.digest(), "");
  mem.record("action", "投新能源汽车 8 点", { globalRound: 1, era: 1, roundInEra: 1 });
  mem.record("social", "和玩家A约好，电话 13812345678", { globalRound: 1, era: 1, roundInEra: 1 });
  mem.record("outcome", "净赚 +120", { globalRound: 2, era: 1, roundInEra: 2 });

  const d = mem.digest();
  assert.match(d, /第 1 轮/);
  assert.match(d, /第 2 轮/);
  assert.equal(d.includes("13812345678"), false);
  mem.clear();
  assert.equal(mem.size(), 0);
});

test("setAiPlayerModel switches seat model dynamically and verifyAiAgents includes results array", async () => {
  const savedKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "sk-test-roster-model";
  try {
    const game = createInitialGame("model-switch", []);
    const added = addAiPlayer(game, { model: "Qwen/Qwen3.8-27B" });
    assert.equal(added.ok, true);
    if (!added.ok) return;
    assert.equal(added.player.aiModelOverride, "Qwen/Qwen3.8-27B");
    assert.match(added.player.aiModelLabel ?? "", /Qwen3\.8-27B/);

    const bad = setAiPlayerModel(game, added.player.id, "bad model with space");
    assert.equal(bad.ok, false);

    const switched = setAiPlayerModel(game, added.player.id, "zai-org/GLM-5.3");
    assert.equal(switched.ok, true);
    assert.equal(added.player.aiModelOverride, "zai-org/GLM-5.3");
    assert.match(added.player.aiModelLabel ?? "", /GLM-5\.3/);

    delete process.env.AI_API_KEY;
    const preflight = await verifyAiAgents(game, { force: true });
    assert.equal(preflight.ok, false);
    assert.equal(preflight.results?.length, 1);
    assert.equal(typeof preflight.results?.[0]?.latencyMs, "number");
  } finally {
    if (savedKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedKey;
  }
});

test("fillAiPlayers on SiliconFlow assigns 5 verified domestic models by default and honors diverseModels=false", () => {
  const savedAiKey = process.env.AI_API_KEY;
  const savedSfKey = process.env.SILICONFLOW_API_KEY;
  const savedSfModel = process.env.SILICONFLOW_MODEL;
  delete process.env.AI_API_KEY;
  delete process.env.SILICONFLOW_MODEL;
  process.env.SILICONFLOW_API_KEY = "sk-sf-diverse-test";
  try {
    const g1 = createInitialGame("sf-default-lineup", []);
    const added = fillAiPlayers(g1, 6);
    assert.equal(added, 5);
    assert.deepEqual(
      g1.players.map((p) => p.aiModelOverride),
      [
        "deepseek-ai/DeepSeek-V4.1-Flash",
        "Qwen/Qwen3.6-35B-A3B",
        "zai-org/GLM-5.2",
        "Pro/moonshotai/Kimi-K2.6",
        "tencent/Hy4-preview",
      ]
    );

    const g2 = createInitialGame("sf-uniform-lineup", []);
    const added2 = fillAiPlayers(g2, 6, { diverseModels: false });
    assert.equal(added2, 5);
    assert.deepEqual(
      g2.players.map((p) => p.aiModelOverride),
      [undefined, undefined, undefined, undefined, undefined]
    );
  } finally {
    if (savedAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = savedAiKey;
    if (savedSfKey === undefined) delete process.env.SILICONFLOW_API_KEY;
    else process.env.SILICONFLOW_API_KEY = savedSfKey;
    if (savedSfModel === undefined) delete process.env.SILICONFLOW_MODEL;
    else process.env.SILICONFLOW_MODEL = savedSfModel;
  }
});

test("askProductAiWithFallback switches from light thinking to fast mode on timeout", async () => {
  const calls: Array<{ disableThinking?: boolean; thinkingBudget?: number; user: string }> = [];
  const res = await askProductAiWithFallback(
    "sys",
    "usr",
    {
      config: { apiKey: "sk-x", model: "deepseek-ai/DeepSeek-V4.1-Flash", provider: "siliconflow", source: "shared" },
      label: "invest-r1",
      thinking: { thinkingBudget: 640, reasoningEffort: "low", timeoutMs: 35_000, maxOutputTokens: 4096 },
      fast: { timeoutMs: 25_000, maxRetries: 1, maxOutputTokens: 3000 },
    },
    async (_sys, user, opts) => {
      calls.push({ disableThinking: opts?.disableThinking, thinkingBudget: opts?.thinkingBudget, user });
      if (calls.length === 1) {
        return {
          ok: false,
          data: null,
          raw: "",
          latencyMs: 24_000,
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          error: "invest-r1: attempt 1: timeout 24000ms",
        };
      }
      return {
        ok: true,
        data: { investment: { 101: 15 }, reasoning: "ok" },
        raw: "{}",
        latencyMs: 1_200,
        usage: { promptTokens: 90, completionTokens: 60, totalTokens: 150 },
      };
    }
  );
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.disableThinking, false);
  assert.equal(calls[0]?.thinkingBudget, 640);
  assert.equal(calls[1]?.disableThinking, true);
  assert.equal(calls[1]?.user, "usr");
  assert.equal(res.usage?.totalTokens, 300);
  assert.equal(res.latencyMs, 25_200);
});

test("askProductAiWithFallback retries fast mode with JSON reminder on JSON parse error and on connection error", async () => {
  const seenPrompts: string[] = [];
  let attempt = 0;
  const jsonRes = await askProductAiWithFallback(
    "sys",
    "base-prompt",
    {
      config: { apiKey: "sk-x", model: "deepseek-ai/DeepSeek-V4.1-Flash", provider: "siliconflow", source: "shared" },
      label: "invest-json",
      thinking: { thinkingBudget: 640, reasoningEffort: "low", timeoutMs: 35_000, maxOutputTokens: 4096 },
      fast: { timeoutMs: 25_000, maxRetries: 1, maxOutputTokens: 3000 },
    },
    async (_sys, user) => {
      seenPrompts.push(user);
      attempt += 1;
      if (attempt === 1) {
        return { ok: false, data: null, raw: "{", latencyMs: 1000, error: "invest-json: attempt 1: JSON 解析失败" };
      }
      return { ok: true, data: { investment: { 101: 10 }, reasoning: "fixed" }, raw: "{}", latencyMs: 500 };
    }
  );
  assert.equal(jsonRes.ok, true);
  assert.equal(seenPrompts.length, 2);
  assert.match(seenPrompts[1] ?? "", /完整合法的 JSON/);

  let connCalls = 0;
  const connRes = await askProductAiWithFallback(
    "sys",
    "base-prompt",
    {
      config: { apiKey: "sk-x", model: "zai-org/GLM-5.3", provider: "siliconflow", source: "shared" },
      label: "invest-conn",
      thinking: { thinkingBudget: 640, reasoningEffort: "low", timeoutMs: 35_000, maxOutputTokens: 4096 },
      fast: { timeoutMs: 25_000, maxRetries: 1, maxOutputTokens: 3000 },
    },
    async () => {
      connCalls += 1;
      if (connCalls === 1) {
        return { ok: false, data: null, raw: "", latencyMs: 800, error: "invest-conn: attempt 1: Connection error." };
      }
      return { ok: true, data: { investment: { 101: 8 }, reasoning: "ok" }, raw: "{}", latencyMs: 400 };
    }
  );
  assert.equal(connRes.ok, true);
  assert.equal(connCalls, 2);
});

test("opening negotiation window pauses AI locking until humans lock in or window ends", async () => {
  const prevWin = process.env.AI_INVEST_OPENING_WINDOW_MS;
  const prevStagger = process.env.AI_INVEST_STAGGER_MAX_MS;
  const prevChat = process.env.AI_OPENING_CHAT_ENABLED;
  process.env.AI_INVEST_OPENING_WINDOW_MS = "10000";
  process.env.AI_INVEST_STAGGER_MAX_MS = "0";
  process.env.AI_OPENING_CHAT_ENABLED = "false";

  const { game, human, ai } = makeGame();
  game.roomId = "ai-opening-win-test";
  try {
    game.investmentEndsAt = Date.now() + 180_000;

    await handleAIPhase(game, null);
    assert.equal(isAiInOpeningWindow(game), true);
    assert.equal(ai.ready, false);
    assert.equal(typeof game.aiOpeningUntil, "number");
    assert.equal(ensureAiProgress(game, null), false);

    // 人类玩家全部锁定后立即唤醒 AI
    human.ready = true;
    const woke = wakeAiOpeningWindowIfHumansReady(game, null);
    assert.equal(woke, true);
    assert.equal(isAiInOpeningWindow(game), false);

    for (let i = 0; i < 40 && !ai.ready; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(ai.ready, true);
  } finally {
    forgetAiRoom(game.roomId);
    if (prevWin === undefined) delete process.env.AI_INVEST_OPENING_WINDOW_MS;
    else process.env.AI_INVEST_OPENING_WINDOW_MS = prevWin;
    if (prevStagger === undefined) delete process.env.AI_INVEST_STAGGER_MAX_MS;
    else process.env.AI_INVEST_STAGGER_MAX_MS = prevStagger;
    if (prevChat === undefined) delete process.env.AI_OPENING_CHAT_ENABLED;
    else process.env.AI_OPENING_CHAT_ENABLED = prevChat;
  }
});

test("opening negotiation window is skipped when disabled or no unready connected human exists", async () => {
  const prevWin = process.env.AI_INVEST_OPENING_WINDOW_MS;
  const prevStagger = process.env.AI_INVEST_STAGGER_MAX_MS;
  const prevChat = process.env.AI_OPENING_CHAT_ENABLED;
  process.env.AI_INVEST_OPENING_WINDOW_MS = "0";
  process.env.AI_INVEST_STAGGER_MAX_MS = "0";
  process.env.AI_OPENING_CHAT_ENABLED = "false";

  const { game, ai } = makeGame();
  game.roomId = "ai-opening-skip-test";
  try {
    game.investmentEndsAt = Date.now() + 180_000;

    await handleAIPhase(game, null);
    assert.equal(isAiInOpeningWindow(game), false);
    assert.equal(ai.ready, true);
  } finally {
    forgetAiRoom(game.roomId);
    if (prevWin === undefined) delete process.env.AI_INVEST_OPENING_WINDOW_MS;
    else process.env.AI_INVEST_OPENING_WINDOW_MS = prevWin;
    if (prevStagger === undefined) delete process.env.AI_INVEST_STAGGER_MAX_MS;
    else process.env.AI_INVEST_STAGGER_MAX_MS = prevStagger;
    if (prevChat === undefined) delete process.env.AI_OPENING_CHAT_ENABLED;
    else process.env.AI_OPENING_CHAT_ENABLED = prevChat;
  }
});

test("buildOpeningChatPrompt formats opening negotiation prompt with memory block", () => {
  const { game, ai } = makeGame();
  const obs = buildAiObservation(game, ai);
  const prompt = buildOpeningChatPrompt(
    obs,
    profileForPlayer(ai),
    "第1轮记忆：观察各玩家资金节奏",
  );
  assert.ok(prompt.includes(game.activeProjects[0]!.name));
  assert.ok(prompt.includes("第1轮记忆：观察各玩家资金节奏"));
  assert.ok(prompt.includes('"silent":false,"reply"'));
});

test("sanitizeInvestmentPlan resolves player names and Chinese card names and blocks lighter self/lighter burn", () => {
  const { game, human, ai } = makeGame();
  ai.inventory = ["buff_slack", "buff_lighter"];
  const plan = sanitizeInvestmentPlan(
    game,
    ai,
    {
      useCards: [
        { cardId: "摸鱼传染" as unknown as string, targetPlayerId: human.name },
        { cardId: "打火机" as unknown as string, targetPlayerId: human.name, burnCardId: "点石成金" },
      ],
      transfer: { toPlayerId: human.name, amount: 5, note: "测试" },
      investment: { [game.activeProjects[0]!.id]: 5 },
    },
    profileForPlayer(ai),
  );
  assert.equal(plan.useCards?.length, 2);
  assert.equal(plan.useCards?.[0]?.cardId, "buff_slack");
  assert.equal(plan.useCards?.[0]?.targetPlayerId, human.id);
  assert.equal(plan.useCards?.[1]?.cardId, "buff_lighter");
  assert.equal(plan.useCards?.[1]?.burnCardId, "buff_gold");
  assert.equal(plan.transfer?.toPlayerId, human.id);

  // 禁止打火机指定烧毁 buff_lighter
  const badLighter = sanitizeInvestmentPlan(
    game,
    ai,
    {
      useCards: [{ cardId: "buff_lighter", targetPlayerId: human.id, burnCardId: "buff_lighter" }],
      investment: {},
    },
    profileForPlayer(ai),
  );
  assert.equal(badLighter.useCards?.length, 0);
});

test("askProductAiWithFallback stops before fast retry when external signal is aborted", async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const res = await askProductAiWithFallback(
    "sys",
    "usr",
    {
      config: { apiKey: "sk-x", model: "Qwen/Qwen3.8-27B", provider: "siliconflow", source: "shared" },
      label: "auction-abort",
      signal: ctrl.signal,
      thinking: { thinkingBudget: 384, reasoningEffort: "low", timeoutMs: 12_000, maxOutputTokens: 2400 },
      fast: { timeoutMs: 12_000, maxRetries: 0, maxOutputTokens: 2048 },
    },
    async () => {
      calls += 1;
      ctrl.abort();
      return { ok: false, data: null, raw: "", latencyMs: 100, error: "aborted" };
    }
  );
  assert.equal(calls, 1);
  assert.equal(res.ok, false);
});
