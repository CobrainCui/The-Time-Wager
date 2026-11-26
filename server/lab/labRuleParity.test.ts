import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { playerAvailableWealth, findNextAutoAuctionCard } from "../logic/auctionCards.js";
import { COFFEE_WEALTH_COST, purchaseCoffee } from "../logic/coffeeLogic.js";
import { applyInvestments, sanitizeInvestments } from "../logic/investmentLogic.js";
import { ackLighterBurnNotice, resolveRoundBuffsAtSettlement } from "../logic/roundBuffResolve.js";
import { initCommunityLeaderboardPersistence } from "../state/communityLeaderboard.js";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import { initSessionArchivePersistence } from "../state/sessionArchive.js";
import { LabAgentMemory } from "./labMemory.js";
import {
  buildLabAuctionPrompt,
  buildLabChatPrompt,
  buildLabInvestmentPrompt,
  buildLabSlackReactionPrompt,
  buildLabSystemPrompt,
} from "./labPrompts.js";
import {
  applyLabAuctionWave,
  AUCTION_MAX_DECISIONS_PER_LOT,
  AUCTION_MAX_WEALTH_RATIO,
  buildLabObservation,
  createSeededLabGame,
  executeLabUseCards,
  getLabLiveStatus,
  startLabRun,
} from "./labRunner.js";
import { getLabRunById, initLabStore, listLabSessionsByRunIds } from "./labStore.js";
import { DEFAULT_LAB_SIX_SEAT_MODELS } from "./siliconflowModels.js";
import type { LabRunManifest } from "./labTypes.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeManifest(overrides: Partial<LabRunManifest> = {}): LabRunManifest {
  return {
    runId: "parity-check",
    name: "parity-check",
    condition: "parity",
    notes: "",
    seedBase: 20261126,
    games: 1,
    createdAt: new Date().toISOString(),
    gitCommit: null,
    promptVersion: "v4-lab6ai-2026-11",
    promptHash: "hash",
    models: DEFAULT_LAB_SIX_SEAT_MODELS,
    providers: Array(6).fill("siliconflow"),
    temperature: 0.7,
    tokenBudgetPerAgent: 5_000_000,
    maxOutputTokens: 64_000,
    maxRetries: 2,
    chatEnabled: true,
    memoryEnabled: true,
    predictionEnabled: true,
    autoSocialScore: true,
    mock: false,
    roomId: "lab-parity-check",
    ...overrides,
  };
}

async function waitForLabFinish(runId?: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!getLabLiveStatus().running) {
      if (!runId) return;
      const run = getLabRunById(runId);
      if (!run || run.status !== "running") return;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Timed out waiting for Lab run to finish");
}

test("道具卡复合使用：点石成金+彩票（私密/公开）按最优顺序执行且尊重视野隔离", async () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-combo-gold-lottery",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 101,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";

  // 即使 AI 把 buff_lottery 写在前面、buff_gold 写在后面，执行器也应先激活点石成金再开私密彩票
  const p1 = game.players[0];
  p1.wealth = 100;
  p1.inventory = ["buff_lottery", "buff_gold"];
  const mem1 = new LabAgentMemory(1, os.tmpdir(), false);

  const executed1 = await executeLabUseCards({
    game,
    player: p1,
    allowBuffCards: true,
    mem: mem1,
    rawCards: [
      { cardId: "buff_lottery", visibility: "private" },
      { cardId: "buff_gold" },
    ],
  });
  assert.equal(executed1.length, 2);
  assert.equal(executed1[0].cardId, "buff_gold");
  assert.equal(executed1[1].cardId, "buff_lottery");
  assert.equal(executed1[1].visibility, "private");
  assert.equal(p1.inventory.length, 0);
  const deal1 = (game.lotteryCompletedDeals ?? []).find((d) => d.playerId === p1.id);
  assert.ok(deal1);
  assert.equal(deal1.goldApplied, true);
  assert.equal(deal1.amount, Math.floor((deal1.enteredAmount ?? 0) * 1.5));
  assert.equal(
    (game.publicFeed ?? []).some((f) => f.kind === "lottery" && f.text.includes(p1.name)),
    false,
    "私密开奖不得写入全桌公开动态"
  );

  // 公开开奖应写入公开动态（仅点数，不暴露点石成金）
  const p2 = game.players[1];
  p2.inventory = ["buff_lottery", "buff_gold"];
  const executed2 = await executeLabUseCards({
    game,
    player: p2,
    allowBuffCards: true,
    rawCards: [{ cardId: "buff_lottery", visibility: "public" }, { cardId: "buff_gold" }],
  });
  assert.equal(executed2.length, 2);
  assert.equal(
    (game.publicFeed ?? []).some((f) => f.kind === "lottery" && f.text.includes(p2.name)),
    true
  );
});

test("道具卡复合使用：同轮对自己打 摸鱼传染+劳逸结合 无论数组顺序均净增 +8 精力且立刻可投", async () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-combo-self-slack",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 202,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";

  const p1 = game.players[0];
  p1.energy = 15;
  p1.inventory = ["buff_slack", "buff_work_rest"];

  // 故意先传 buff_slack 再传 buff_work_rest，验证自动先触发劳逸结合，再打摸鱼变 +8
  const executed = await executeLabUseCards({
    game,
    player: p1,
    allowBuffCards: true,
    rawCards: [
      { cardId: "buff_slack", targetPlayerId: p1.id },
      { cardId: "buff_work_rest" },
    ],
  });
  assert.equal(executed.length, 2);
  assert.equal(executed[0].cardId, "buff_work_rest");
  assert.equal(executed[1].cardId, "buff_slack");
  assert.equal(p1.energy, 23);
  assert.equal(p1.slackedBy?.length ?? 0, 0);

  const proj = game.activeProjects[0];
  const sanitized = sanitizeInvestments(game, p1, { [proj.id]: 23 });
  assert.equal(sanitized[proj.id], 23);
  assert.equal(applyInvestments(game, p1.id, sanitized, "player"), true);
  assert.equal(p1.energy, 0);
});

test("拍卖支持 100% 可用财富、多轮竞价，且破产负财富不可预支", () => {
  assert.equal(AUCTION_MAX_WEALTH_RATIO, 1);
  assert.equal(AUCTION_MAX_DECISIONS_PER_LOT, 6);

  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-auction-full-wealth",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 303,
  });
  game.phase = "AUCTION";
  game.players[0].wealth = 100;
  game.players[1].wealth = -35; // 破产负财富玩家

  const focus = findNextAutoAuctionCard(game);
  assert.ok(focus);
  game.auctionFocusCardId = focus;

  // 破产玩家可用财富应为 0（不可预支），财富保持 -35 不被归零
  assert.equal(playerAvailableWealth(game, game.players[1]), 0);
  assert.equal(game.players[1].wealth, -35);

  const passed = new Set<string>();
  // 100% 可用财富 100 出价应成功；出价 105 或破产者出价 5 应被拦截弃权
  const wave1 = applyLabAuctionWave({
    game,
    focus,
    lotHardDeadline: Date.now() + 60_000,
    passedOnCard: passed,
    bidResults: [
      { player: game.players[0], decision: { action: "bid", amount: 100, reasoning: "梭哈100%" } },
      { player: game.players[1], decision: { action: "bid", amount: 10, reasoning: "试图预支" } },
    ],
  });
  assert.equal(wave1.anyAction, true);
  assert.equal(passed.has(game.players[1].id), true);

  // 买咖啡：可用财富足够时可买 >=4 杯；破产时禁止购买
  game.players[2].wealth = COFFEE_WEALTH_COST * 5;
  for (let i = 0; i < 5; i++) {
    assert.equal(purchaseCoffee(game, game.players[2]).ok, true);
  }
  assert.equal(game.players[2].coffeePurchasesThisRound, 5);
  assert.equal(purchaseCoffee(game, game.players[1]).ok, false);
});

test("盲视角观察与提示词补全个人长期>=3、风险追回、手牌中文说明与打火机隔离", () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-obs-parity",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 404,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";

  const p1 = game.players[0];
  const p2 = game.players[1];
  const longProj = game.activeProjects.find((p) => p.type === "long") ?? game.activeProjects[0];
  const riskProj = game.activeProjects.find((p) => p.type === "risk") ?? game.activeProjects[0];

  p1.inventory = ["buff_gold", "buff_lottery"];
  p1.longTerm[longProj.id] = { totalInvested: 6, status: "active" };
  p1.riskGains[riskProj.id] = 40;
  p2.inventory = ["buff_short"];
  p2.energy = 11;
  p2.riskGains[riskProj.id] = 60;

  const obs1 = buildLabObservation(game, p1.id);
  assert.equal(obs1.me.availableWealth, p1.wealth);
  assert.equal(obs1.me.inventoryDetails[0].name, "点石成金");
  assert.equal(obs1.me.activeLongTerm.length, 1);
  assert.equal(obs1.me.riskExposure[0]?.historicalGainAtRisk, 40);
  // 严禁泄露对手精力与对手手牌详情
  const opp2 = obs1.players.find((x) => x.id === p2.id);
  assert.equal(opp2?.energy, null);
  assert.equal((opp2 as unknown as { inventory?: unknown }).inventory, undefined);

  const sys = buildLabSystemPrompt(1, p1.name);
  assert.ok(sys.includes("复杂规则与道具复合使用速查"));
  assert.ok(sys.includes("useCards"));
  assert.ok(sys.includes("可用财富的 100%"));

  const investPrompt = buildLabInvestmentPrompt(obs1, "（暂无）", true);
  assert.ok(investPrompt.includes("点石成金(buff_gold)"));
  assert.ok(investPrompt.includes("本轮须续投 ≥3 点否则 1:1 放弃"));
  assert.ok(investPrompt.includes("历史已赚 40 财富，若爆雷将全额追回"));
  assert.ok(investPrompt.includes("\"useCards\""));

  const chatPrompt = buildLabChatPrompt(obs1, "（暂无）");
  assert.ok(chatPrompt.includes("\"transfer\""));

  // 打火机结算只通知被指定者并移除手牌
  p1.inventory = ["buff_lighter"];
  p2.inventory = ["buff_gold"];
  game.lighterBurnDeclarations = [
    {
      id: "burn-1",
      casterId: p1.id,
      casterName: p1.name,
      targetPlayerId: p2.id,
      burnCardId: "buff_gold",
    },
  ];
  const burnSummary = resolveRoundBuffsAtSettlement(game);
  assert.equal(burnSummary.hits, 1);
  assert.equal((p1.pendingLighterBurnNotices ?? []).length, 0);
  assert.equal(p2.pendingLighterBurnNotices?.length, 1);
  assert.equal(
    ackLighterBurnNotice(game, p2.id, p2.pendingLighterBurnNotices![0].id),
    true
  );
  assert.equal(p2.inventory.includes("buff_gold"), false);

  // 拍卖和摸鱼反制提示词检查
  game.phase = "AUCTION";
  game.auctionFocusCardId = "buff_lottery";
  const aucObs = buildLabObservation(game, p1.id);
  const aucPrompt = buildLabAuctionPrompt(aucObs, "buff_lottery", aucObs.me.availableWealth, "（暂无）");
  assert.ok(aucPrompt.includes("可用财富的 100% 均可出价"));
  assert.ok(aucPrompt.includes("正在拍卖：【彩票】（buff_lottery）"));

  const reactPrompt = buildLabSlackReactionPrompt(obs1, "（暂无）", { [longProj.id]: 6 });
  assert.ok(reactPrompt.includes("阶段：被摸鱼后反制与重投"));
});

test("实时链路上验证：沟通步转账当轮到账、被摸鱼触发反制重投窗口并完成", async () => {
  const dir = makeTempDir("lab-parity-e2e-");
  const prevApiKey = process.env.AI_API_KEY;
  const prevBaseUrl = process.env.AI_BASE_URL;
  const prevProvider = process.env.AI_PROVIDER;
  const prevModel = process.env.AI_MODEL;

  const slackReactionsSeen: string[] = [];
  let p2InvestWealthSeen = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        messages?: Array<{ role: string; content: string }>;
      };
      const sys = body.messages?.find((m) => m.role === "system")?.content ?? "";
      const usr = body.messages?.find((m) => m.role === "user")?.content ?? "";
      const seatM = /第\s*(\d+)\s*号座位/.exec(sys);
      const seat = seatM ? Number(seatM[1]) : 1;

      const playerIds: Array<{ id: string; isMe: boolean }> = [];
      for (const line of usr.split(/\r?\n/)) {
        const m = /^-\s*([^|]+?)\s*\|\s*ID=([^\s|]+)\s*\|/.exec(line.trim());
        if (m) playerIds.push({ id: m[2].trim(), isMe: m[1].includes("（你）") });
      }
      const projIds: number[] = [];
      for (const line of usr.split(/\r?\n/)) {
        const m = /^-\s*ID\s*(\d+)\s*\|/.exec(line.trim());
        if (m) projIds.push(Number(m[1]));
      }
      const roundM = /第\s*(\d+)\s*(?:\/\d+\s*)?全局轮/.exec(usr);
      const round = roundM ? Number(roundM[1]) : 1;

      let out: unknown;
      if (usr.includes("任务：预测本局结束时")) {
        out = { reasoning: "排序预测", ranking: playerIds.map((p) => p.id) };
      } else if (usr.includes("阶段：被摸鱼后反制与重投")) {
        const meId = playerIds.find((p) => p.isMe)?.id ?? "";
        slackReactionsSeen.push(`r${round}-seat${seat}`);
        out = {
          reasoning: "被摸鱼后立刻重配精力",
          coffee: 0,
          useCards: usr.includes("buff_work_rest") && meId
            ? [{ cardId: "buff_work_rest", targetPlayerId: meId }]
            : [],
          investment: projIds[0] ? { [String(projIds[0])]: 7 } : {},
        };
      } else if (usr.includes("阶段：投资前沟通")) {
        // 第 1 轮 1 号位在沟通步直接向 2 号位转账 20 财富
        const targetP2 = playerIds[1]?.id;
        out = {
          reasoning: "沟通并转合作诚意",
          messages: [],
          groupMessages: [],
          createGroup: null,
          transfer:
            round === 1 && seat === 1 && targetP2
              ? { toPlayerId: targetP2, amount: 20, note: "沟通步即时转账" }
              : null,
        };
      } else if (usr.includes("向你发起转账")) {
        out = { reasoning: "当轮收下转账", decision: "accept" };
      } else if (usr.includes("阶段：拍卖会")) {
        // 仅在第 1 场拍卖（时代 2）让 1 号位拍得摸鱼传染（buff_slack）
        const isEra2SlackAuction = usr.includes("时代 2") && /正在拍卖：[^\n]*（buff_slack）/.test(usr);
        const minM = /最低下一口[：:]\s*(\d+)/.exec(usr);
        const minNext = minM ? Number(minM[1]) : 5;
        if (seat === 1 && isEra2SlackAuction && minNext <= 10) {
          out = { reasoning: "拍下摸鱼测试反应窗口", action: "bid", amount: minNext };
        } else {
          out = { reasoning: "放弃", action: "pass" };
        }
      } else if (usr.includes("需要为这个社区命名")) {
        out = { reasoning: "命名", name: "规则一致社区" };
      } else {
        // 投资步：检查第 1 轮 2 号位是否已当轮收到 1 号位沟通步转账的 20（100 -> 120）
        if (round === 1 && seat === 2) {
          const wM = /财富[：:]\s*(-?\d+)/.exec(usr);
          p2InvestWealthSeen = wM ? Number(wM[1]) : 0;
        }
        const eM = /精力[：:]\s*(-?\d+)/.exec(usr);
        const energy = eM ? Math.max(0, Number(eM[1])) : 15;
        const targetP2 = playerIds[1]?.id;
        // 第 3 轮（时代 2 第 1 轮）1 号位对 2 号位打出刚拍得的摸鱼传染
        const useCards =
          round === 3 && seat === 1 && usr.includes("摸鱼传染(buff_slack)") && targetP2
            ? [{ cardId: "buff_slack", targetPlayerId: targetP2 }]
            : [];
        out = {
          reasoning: "按可用精力投资",
          messages: [],
          groupMessages: [],
          createGroup: null,
          transfer: null,
          coffee: 0,
          useCards,
          investment: projIds[0] && energy > 0 ? { [String(projIds[0])]: energy } : {},
          ready: true,
        };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "mock-chat-completion",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(out) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;

  try {
    process.env.AI_API_KEY = "test-parity-key";
    process.env.AI_BASE_URL = `http://127.0.0.1:${addr.port}/v1`;
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-4o-mini";

    initCommunityLeaderboardPersistence(path.join(dir, "leaderboard.json"));
    initSessionArchivePersistence(path.join(dir, "session_archive.json"));
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    const started = startLabRun({
      condition: "parity-e2e",
      name: "规则对齐端到端验证",
      games: 1,
      seedBase: 20261199,
      chatEnabled: true,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: false,
      interactionMode: "guided_two_step",
      thinkingMode: "fast",
      tokenBudgetPerAgent: 5_000_000,
      models: Array(6).fill("gpt-4o-mini"),
    });
    assert.equal(started.ok, true);
    await waitForLabFinish(started.run.runId, 60_000);

    const run = getLabRunById(started.run.runId);
    assert.equal(run?.status, "completed");
    const [session] = listLabSessionsByRunIds([started.run.runId]);
    assert.equal(session.qc.valid, true);
    assert.equal(session.communityName, "规则一致社区");

    // 1. 沟通步发起的转账必须在当轮投资前确认，让 2 号位在当轮投资时就看到 120 财富
    assert.equal(p2InvestWealthSeen, 120);

    // 2. 第 3 轮 1 号位拍得并对 2 号位打出摸鱼传染，只有第 3 轮触发了 2 号位的摸鱼反制窗口
    assert.deepEqual(slackReactionsSeen, ["r3-seat2"]);
    const slackDecisions = session.snapshot.agentDecisions.filter(
      (d) => d.kind === "slack_reaction"
    );
    assert.equal(slackDecisions.length, 1);
    assert.equal(slackDecisions[0].globalRound, 3);
  } finally {
    if (prevApiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prevApiKey;
    if (prevBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = prevBaseUrl;
    if (prevProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevProvider;
    if (prevModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevModel;

    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
