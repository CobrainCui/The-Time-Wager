import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState, type Player } from "../state/gameState.js";
import { addAiPlayer, countAiPlayers, fillAiPlayers, removeAiPlayer } from "./aiRoster.js";
import { buildFallbackInvestmentPlan, chooseAuctionAction, sanitizeInvestmentPlan } from "./aiPolicy.js";
import { handleAIPhase } from "./aiOrchestrator.js";
import { profileFor, profileForPlayer } from "./aiPersona.js";
import { buildAiObservation } from "./aiObservation.js";
import { buildSystemPrompt } from "./aiPrompt.js";
import { getCommunityNamer } from "../state/gameState.js";
import { applyInvestments } from "../logic/investmentLogic.js";
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
