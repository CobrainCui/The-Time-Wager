import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { initCommunityLeaderboardPersistence } from "../state/communityLeaderboard.js";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import { initSessionArchivePersistence } from "../state/sessionArchive.js";
import { useBuffCard, useForceBuyCard } from "../logic/buffLogic.js";
import { acceptLotteryOffer, createRandomLotteryOffer } from "../logic/lotteryDraw.js";
import {
  askAgentWithValidation,
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
    runId: "resilience-check",
    name: "resilience-check",
    condition: "resilience",
    notes: "",
    seedBase: 20261127,
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
    roomId: "lab-resilience-check",
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

test("跨轮连续打出多张【彩票】不被旧 lotteryCompletedDeals 拦截且导出保留全部记录", async () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-multi-lottery",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 515,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";

  const p1 = game.players[0];
  p1.wealth = 100;
  p1.inventory = ["buff_lottery", "buff_lottery"];

  game.globalRound = 1;
  useBuffCard(game, p1.id, "buff_lottery", { visibility: "public" });
  const draw1 = await createRandomLotteryOffer(game, p1.id, { online: false });
  assert.equal(draw1.ok, true);
  if (draw1.ok) {
    const acc1 = acceptLotteryOffer(game, p1.id, draw1.offer.offerId);
    assert.equal(acc1.ok, true);
  }

  game.globalRound = 3;
  useBuffCard(game, p1.id, "buff_lottery", { visibility: "private" });
  const draw2 = await createRandomLotteryOffer(game, p1.id, { online: false });
  assert.equal(draw2.ok, true, "第二张跨轮彩票必须可以正常开奖");
  if (draw2.ok) {
    const acc2 = acceptLotteryOffer(game, p1.id, draw2.offer.offerId);
    assert.equal(acc2.ok, true);
  }
  assert.equal(game.lotteryCompletedDeals?.length, 2);
});

test("executeLabUseCards 支持玩家名/中文卡名解析并拦截无劳逸自摸鱼", async () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-card-resolve",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 616,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";

  const p1 = game.players[0];
  const p2 = game.players[1];
  p1.energy = 15;
  p1.inventory = ["buff_slack", "buff_lighter"];

  // 1) 没有劳逸结合时试图对自己用摸鱼传染，必须拦截且保留手牌
  const selfSlackRes = await executeLabUseCards({
    game,
    player: p1,
    allowBuffCards: true,
    rawCards: [{ cardId: "摸鱼传染", targetPlayerId: p1.name }],
  });
  assert.equal(selfSlackRes.length, 0);
  assert.equal(p1.energy, 15);
  assert.equal(p1.inventory.includes("buff_slack"), true);

  // 2) 用中文名对他人打出摸鱼传染 + 用中文名打火机烧点石成金
  const validRes = await executeLabUseCards({
    game,
    player: p1,
    allowBuffCards: true,
    rawCards: [
      { cardId: "摸鱼传染", targetPlayerId: p2.name },
      { cardId: "打火机", targetPlayerId: p2.name, burnCardId: "点石成金" },
    ],
  });
  assert.equal(validRes.length, 2);
  assert.equal(p2.energy, 7);
  assert.equal(game.lighterBurnDeclarations?.[0]?.burnCardId, "buff_gold");
});

test("advanceAuctionFocus 在 autoHostEnabled 时使用强买强卖不会回跳已流拍拍品", () => {
  const manifest = makeManifest({ mock: true });
  const game = createSeededLabGame({
    roomId: "lab-force-buy-no-wrap",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 717,
  });
  game.phase = "AUCTION";
  game.currentEra = 3;
  game.autoHostEnabled = true;
  game.auctionPassedCardIds = ["buff_force_buy", "buff_slack", "buff_work_rest"];
  game.auctionFocusCardId = "buff_short";
  game.players[0].inventory = ["buff_force_buy"];

  const res = useForceBuyCard(game, game.players[0].id);
  assert.equal(res.success, true);
  assert.equal(game.auctionFocusCardId, undefined);
});

test("实验室端到端容错：拍卖单席永久报错/慢响应与连环摸鱼反制都不会卡死整局", async () => {
  const dir = makeTempDir("lab-resilience-e2e-");
  const prevApiKey = process.env.AI_API_KEY;
  const prevBaseUrl = process.env.AI_BASE_URL;
  const prevProvider = process.env.AI_PROVIDER;
  const prevModel = process.env.AI_MODEL;

  const slackReactionsSeen: string[] = [];

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

      const playerIds: Array<{ id: string; name: string; isMe: boolean }> = [];
      for (const line of usr.split(/\r?\n/)) {
        const m = /^-\s*([^|]+?)\s*\|\s*ID=([^\s|]+)\s*\|/.exec(line.trim());
        if (m) {
          playerIds.push({
            name: m[1].replace(/（你）$/, "").trim(),
            id: m[2].trim(),
            isMe: m[1].includes("（你）"),
          });
        }
      }
      const projIds: number[] = [];
      for (const line of usr.split(/\r?\n/)) {
        const m = /^-\s*ID\s*(\d+)\s*\|/.exec(line.trim());
        if (m) projIds.push(Number(m[1]));
      }
      const roundM = /第\s*(\d+)\s*(?:\/\d+\s*)?全局轮/.exec(usr);
      const round = roundM ? Number(roundM[1]) : 1;

      // 模拟拍卖阶段 6 号位接口直接返回 403/400 致命错，检验其它席位出价不被整局炸毁
      if (usr.includes("阶段：拍卖会") && seat === 6) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "simulated seat 6 auction failure" } }));
        return;
      }

      let out: unknown;
      if (usr.includes("任务：预测本局结束时")) {
        out = { reasoning: "排序", ranking: playerIds.map((p) => p.id) };
      } else if (usr.includes("阶段：被摸鱼后反制与重投")) {
        slackReactionsSeen.push(`r${round}-seat${seat}`);
        const target3 = playerIds[2]?.id;
        // 故意在第 1 波由 2 号位连环对 3 号位再打摸鱼，验证 2 波封顶与自动推进不会死循环
        const useCards =
          seat === 2 && usr.includes("buff_slack") && target3
            ? [{ cardId: "buff_slack", targetPlayerId: target3 }]
            : [];
        out = {
          reasoning: "被摸鱼后重投",
          coffee: 0,
          useCards,
          investment: projIds[0] ? { [String(projIds[0])]: 5 } : {},
        };
      } else if (usr.includes("阶段：投资前沟通")) {
        out = { reasoning: "略", messages: [], groupMessages: [], createGroup: null, transfer: null };
      } else if (usr.includes("向你发起转账")) {
        out = { reasoning: "收", decision: "accept" };
      } else if (usr.includes("阶段：拍卖会")) {
        const minM = /最低下一口[：:]\s*(\d+)/.exec(usr);
        const minNext = minM ? Number(minM[1]) : 5;
        if (seat === 1 && usr.includes("（buff_slack）") && minNext <= 10) {
          out = { reasoning: "拍摸鱼", action: "bid", amount: minNext };
        } else if (seat === 2 && usr.includes("（buff_slack）") && usr.includes("时代 2") && minNext <= 15) {
          out = { reasoning: "2号位也拍摸鱼", action: "bid", amount: minNext };
        } else {
          out = { reasoning: "过", action: "pass" };
        }
      } else if (usr.includes("需要为这个社区命名")) {
        out = { reasoning: "命名", name: "容错测试社区" };
      } else {
        const eM = /精力[：:]\s*(-?\d+)/.exec(usr);
        const energy = eM ? Math.max(0, Number(eM[1])) : 15;
        const target2 = playerIds[1]?.id;
        const useCards =
          round === 3 && seat === 1 && usr.includes("buff_slack") && target2
            ? [{ cardId: "buff_slack", targetPlayerId: target2 }]
            : [];
        out = {
          reasoning: "稳健投资",
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
          id: "mock-resilience",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: JSON.stringify(out) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 30, total_tokens: 110 },
        })
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;

  try {
    process.env.AI_API_KEY = "test-resilience-key";
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
      condition: "resilience-e2e",
      name: "拍卖单席异常与连环摸鱼容错",
      games: 1,
      seedBase: 20261177,
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
    assert.equal(session.status, "completed");
    assert.equal(session.qc.valid, true);
    assert.equal(session.communityName, "容错测试社区");
    assert.ok(session.snapshot.auctionCompletedDeals.length >= 1, "其他正常 AI 应成功拍得道具");
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

test("labStore 启动加载会把遗留的 running 批次自动恢复标记为 failed", () => {
  const dir = makeTempDir("lab-store-recover-");
  try {
    const runsPath = path.join(dir, "lab_runs.json");
    const sessionsPath = path.join(dir, "lab_archive.json");
    fs.writeFileSync(
      runsPath,
      JSON.stringify({
        runs: [
          {
            runId: "stale-running-1",
            manifest: makeManifest({ runId: "stale-running-1" }),
            status: "running",
            completedGames: 0,
            failedGames: 0,
            currentGameIndex: 0,
            startedAt: Date.now() - 60_000,
            finishedAt: null,
            durationMs: 0,
            sessionIds: [],
          },
        ],
      }),
      "utf8"
    );
    initLabStore({
      runsPath,
      sessionsPath,
      agentEditionExperimentsDir: null,
    });
    const recovered = getLabRunById("stale-running-1");
    assert.equal(recovered?.status, "failed");
    assert.match(recovered?.failureReason ?? "", /中断/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("askAgentWithValidation 遇到先断连后思考超时时，必须自动降级为 fast 无思考重试并成功", async () => {
  const manifest = makeManifest({ mock: false, thinkingMode: "moderate" });
  const game = createSeededLabGame({
    roomId: "retry-fast-fallback",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 20261127,
  });
  const sharedConfig = {
    apiKey: "sk-test-key",
    baseURL: "https://example.invalid/v1",
    model: "zai-org/GLM-5.2",
    provider: "siliconflow",
    source: "shared" as const,
  };
  const runCtrl = new AbortController();
  const calls: Array<{ label?: string; disableThinking?: boolean }> = [];

  const res = await askAgentWithValidation<{ investment: Record<string, number> }>({
    game,
    player: game.players[2],
    manifest,
    sharedConfig,
    label: "r5-investment",
    userPrompt: "invest",
    validate: (data) =>
      data && typeof data === "object" && (data as { investment?: unknown }).investment
        ? { investment: (data as { investment: Record<string, number> }).investment }
        : null,
    signal: runCtrl.signal,
    io: null,
    budgetKind: "investment",
    llmCaller: async (_sys, _usr, opts = {}) => {
      calls.push({ label: opts.label, disableThinking: opts.disableThinking });
      if (calls.length === 1) {
        return { ok: false, data: null, raw: "", latencyMs: 500, error: "Connection error." };
      }
      if (calls.length === 2) {
        return { ok: false, data: null, raw: "", latencyMs: 65_000, error: "Request timed out." };
      }
      return {
        ok: true,
        data: { investment: { 101: 5 } },
        raw: '{"investment":{"101":5}}',
        latencyMs: 1_200,
      };
    },
  });

  assert.deepEqual(res.value.investment, { 101: 5 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].disableThinking, false);
  assert.equal(calls[1].disableThinking, false);
  assert.equal(calls[2].disableThinking, true);
  assert.match(calls[2].label ?? "", /:fast$/);
});
