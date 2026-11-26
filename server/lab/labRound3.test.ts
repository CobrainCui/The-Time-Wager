import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { AiModelConfig } from "../ai/aiConfig.js";
import { askAiJson, isReasoningModel, isSiliconFlowConfig } from "../ai/llmClient.js";
import {
  findNextAutoAuctionCard,
  getLeadingBidOnFocus,
  placeAuctionBid,
} from "../logic/auctionCards.js";
import {
  applyLabAuctionWave,
  askAgentWithValidation,
  AUCTION_MAX_DECISIONS_PER_LOT,
  createSeededLabGame,
  getLabActionBudget,
  LAB_AUCTION_LOT_MAX_MS,
  LAB_AUCTION_ROUND_MS,
  LabCallExpiredError,
  settleLabAuctionLot,
} from "./labRunner.js";
import { DEFAULT_LAB_SIX_SEAT_MODELS } from "./siliconflowModels.js";
import type { LabRunManifest } from "./labTypes.js";

function makeManifest(overrides: Partial<LabRunManifest> = {}): LabRunManifest {
  return {
    runId: "round3-check",
    name: "round3-check",
    condition: "C1",
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
    maxRetries: 1,
    chatEnabled: true,
    memoryEnabled: true,
    predictionEnabled: true,
    autoSocialScore: true,
    mock: false,
    roomId: "lab-round3-check",
    ...overrides,
  };
}

async function withMockChatServer(
  handler: (
    body: Record<string, unknown>,
    reqIndex: number,
    res: http.ServerResponse
  ) => void,
  fn: (baseURL: string) => Promise<void>
): Promise<void> {
  let reqCount = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      reqCount += 1;
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      handler(parsed, reqCount, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const baseURL = `http://127.0.0.1:${addr.port}/v1`;
  try {
    await fn(baseURL);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("isSiliconFlowConfig 与 isReasoningModel 正确识别硅基流动与推理模型", () => {
  const sfQwen: AiModelConfig = {
    apiKey: "test-key",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-32B",
    provider: "siliconflow",
    source: "shared",
  };
  assert.equal(isSiliconFlowConfig(sfQwen), true);
  assert.equal(isReasoningModel(sfQwen), true);

  const sfByPrefixOnly: AiModelConfig = {
    apiKey: "test-key",
    model: "zai-org/GLM-4.5-Air",
    provider: "custom",
    source: "shared",
  };
  assert.equal(isSiliconFlowConfig(sfByPrefixOnly), true);
  assert.equal(isReasoningModel(sfByPrefixOnly), true);

  const openAiNonReasoning: AiModelConfig = {
    apiKey: "test-key",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o",
    provider: "openai",
    source: "shared",
  };
  assert.equal(isSiliconFlowConfig(openAiNonReasoning), false);
  assert.equal(isReasoningModel(openAiNonReasoning), false);
});

test("askAiJson 对硅基流动推理模型启用流式保活与 thinking_budget 并支持 400 自动降级", async () => {
  const seenBodies: Array<Record<string, unknown>> = [];

  // Case A: 流式 SSE + enable_thinking + thinking_budget + usage
  await withMockChatServer(
    (body, _idx, res) => {
      seenBodies.push(body);
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      const chunks = [
        {
          id: "c1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { reasoning_content: "先算账..." } }],
        },
        {
          id: "c2",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: '{"action":"bid","amount":5}' } }],
        },
        {
          id: "c3",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
        },
      ];
      for (const c of chunks) {
        res.write(`data: ${JSON.stringify(c)}\n\n`);
      }
      res.end("data: [DONE]\n\n");
    },
    async (baseURL) => {
      const cfg: AiModelConfig = {
        apiKey: "test-key",
        baseURL,
        model: "Qwen/Qwen3-32B",
        provider: "siliconflow",
        source: "shared",
      };
      const result = await askAiJson("sys", "usr", {
        config: cfg,
        thinkingBudget: 512,
        maxOutputTokens: 1200,
        timeoutMs: 12_000,
        maxRetries: 0,
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, { action: "bid", amount: 5 });
      assert.equal(result.usage?.totalTokens, 150);
    }
  );

  assert.equal(seenBodies[0].stream, true);
  assert.equal(seenBodies[0].enable_thinking, true);
  assert.equal(seenBodies[0].thinking_budget, 512);
  assert.equal(seenBodies[0].max_tokens, 1200);

  // Case B: 400 参数不兼容时自动剥离 enable_thinking/thinking_budget 并重试成功
  const compatBodies: Array<Record<string, unknown>> = [];
  await withMockChatServer(
    (body, idx, res) => {
      compatBodies.push(body);
      if (idx === 1 && ("thinking_budget" in body || "enable_thinking" in body)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Invalid parameter: thinking_budget is not supported" },
          })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: '{"ok":true}' } }],
        })}\n\n`
      );
      res.end("data: [DONE]\n\n");
    },
    async (baseURL) => {
      const cfg: AiModelConfig = {
        apiKey: "test-key",
        baseURL,
        model: "Pro/deepseek-ai/DeepSeek-V3.2",
        provider: "siliconflow",
        source: "shared",
      };
      const result = await askAiJson("sys", "usr", {
        config: cfg,
        thinkingBudget: 384,
        maxOutputTokens: 900,
        timeoutMs: 8_000,
        maxRetries: 0,
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, { ok: true });
    }
  );
  assert.equal(compatBodies.length, 2);
  assert.equal("thinking_budget" in compatBodies[0], true);
  assert.equal("thinking_budget" in compatBodies[1], false);
  assert.equal("enable_thinking" in compatBodies[1], false);

  // Case C: disableThinking 时传递 enable_thinking: false 且不流式
  const fastBodies: Array<Record<string, unknown>> = [];
  await withMockChatServer(
    (body, _idx, res) => {
      fastBodies.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "nonstream-1",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: '{"fast":true}' } }],
        })
      );
    },
    async (baseURL) => {
      const cfg: AiModelConfig = {
        apiKey: "test-key",
        baseURL,
        model: "Qwen/Qwen3-32B",
        provider: "siliconflow",
        source: "shared",
      };
      const result = await askAiJson("sys", "usr", {
        config: cfg,
        disableThinking: true,
        timeoutMs: 8_000,
        maxRetries: 0,
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, { fast: true });
    }
  );
  assert.equal(fastBodies[0].enable_thinking, false);
  assert.notEqual(fastBodies[0].stream, true);

  // Case D: 若兼容端先后拒收 thinking 参数和 response_format: json_object（均返回 400），自动逐层降级成功
  const fallbackBodies: Array<Record<string, unknown>> = [];
  await withMockChatServer(
    (body, idx, res) => {
      fallbackBodies.push(body);
      if (idx === 1 && ("thinking_budget" in body || "enable_thinking" in body)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "400 Invalid parameter: thinking_budget" } }));
        return;
      }
      if ("response_format" in body) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "400 response_format json_object is not supported" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
      res.write(
        `data: ${JSON.stringify({
          id: "c1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: '{"recovered":true}' } }],
        })}\n\n`
      );
      res.end("data: [DONE]\n\n");
    },
    async (baseURL) => {
      const cfg: AiModelConfig = {
        apiKey: "test-key",
        baseURL,
        model: "Qwen/Qwen3-32B",
        provider: "siliconflow",
        source: "shared",
      };
      const result = await askAiJson("sys", "usr", {
        config: cfg,
        thinkingBudget: 384,
        maxOutputTokens: 900,
        timeoutMs: 8_000,
        maxRetries: 0,
      });
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, { recovered: true });
    }
  );
  assert.equal(fallbackBodies.length, 3);
  assert.equal("thinking_budget" in fallbackBodies[0], true);
  assert.equal("response_format" in fallbackBodies[1], true);
  assert.equal("response_format" in fallbackBodies[2], false);
  assert.equal("thinking_budget" in fallbackBodies[2], false);
});

test("askAgentWithValidation 分场景预算及超时降思考快速重试、本拍过期不炸局", async () => {
  assert.deepEqual(getLabActionBudget("investment"), {
    thinkingBudget: 1024,
    maxOutputTokens: 2400,
    timeoutMs: 30_000,
  });
  assert.deepEqual(getLabActionBudget("prediction"), {
    thinkingBudget: 512,
    maxOutputTokens: 1200,
    timeoutMs: 20_000,
  });
  assert.deepEqual(getLabActionBudget("auction"), {
    thinkingBudget: 384,
    maxOutputTokens: 900,
    timeoutMs: 15_000,
  });

  const manifest = makeManifest();
  const game = createSeededLabGame({
    roomId: manifest.roomId,
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 987654,
  });
  const sharedConfig: AiModelConfig = {
    apiKey: "test-key",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-32B",
    provider: "siliconflow",
    source: "shared",
  };
  const runCtrl = new AbortController();

  // Case A: 第 1 次思考只传 maxRetries=0，超时后第 2 次自动切 disableThinking: true（maxRetries=1）重试成功
  const seenOpts: Array<{
    disableThinking?: boolean;
    thinkingBudget?: number;
    timeoutMs?: number;
    maxRetries?: number;
  }> = [];
  const res = await askAgentWithValidation<{ action: string }>({
    game,
    player: game.players[0],
    manifest,
    sharedConfig,
    label: "auction-test",
    userPrompt: "pick",
    validate: (d) =>
      d && typeof d === "object" && typeof (d as { action?: unknown }).action === "string"
        ? { action: String((d as { action: string }).action) }
        : null,
    signal: runCtrl.signal,
    io: null,
    budgetKind: "auction",
    llmCaller: async (_sys, _usr, opts = {}) => {
      seenOpts.push({
        disableThinking: opts.disableThinking,
        thinkingBudget: opts.thinkingBudget,
        timeoutMs: opts.timeoutMs,
        maxRetries: opts.maxRetries,
      });
      if (seenOpts.length === 1) {
        return {
          ok: false,
          data: null,
          raw: "",
          latencyMs: 15_000,
          error: "auction-test: attempt 1: timeout 15000ms",
        };
      }
      return {
        ok: true,
        data: { action: "pass" },
        raw: '{"action":"pass"}',
        latencyMs: 600,
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      };
    },
  });

  assert.equal(res.value.action, "pass");
  assert.equal(seenOpts.length, 2);
  assert.equal(seenOpts[0].thinkingBudget, 384);
  assert.equal(seenOpts[0].timeoutMs, 15_000);
  assert.equal(seenOpts[0].maxRetries, 0);
  assert.equal(seenOpts[1].disableThinking, true);
  assert.equal(seenOpts[1].thinkingBudget, undefined);
  assert.equal(seenOpts[1].timeoutMs, 15_000);
  assert.equal(seenOpts[1].maxRetries, 1);

  // Case B: 第 1 次超时 -> 第 2 次快速重试 JSON 缺字段 -> 第 3 次继续 disableThinking: true 纠正成功
  const corrOpts: Array<{ disableThinking?: boolean; maxRetries?: number }> = [];
  const res3 = await askAgentWithValidation<{ action: string }>({
    game,
    player: game.players[2],
    manifest,
    sharedConfig,
    label: "auction-corr",
    userPrompt: "pick",
    validate: (d) =>
      d && typeof d === "object" && (d as { action?: unknown }).action === "pass"
        ? { action: "pass" }
        : null,
    signal: runCtrl.signal,
    io: null,
    budgetKind: "auction",
    llmCaller: async (_sys, _usr, opts = {}) => {
      corrOpts.push({ disableThinking: opts.disableThinking, maxRetries: opts.maxRetries });
      if (corrOpts.length === 1) {
        return { ok: false, data: null, raw: "", latencyMs: 15_000, error: "timeout 15000ms" };
      }
      if (corrOpts.length === 2) {
        return { ok: true, data: { wrong: true }, raw: '{"wrong":true}', latencyMs: 400 };
      }
      return { ok: true, data: { action: "pass" }, raw: '{"action":"pass"}', latencyMs: 350 };
    },
  });
  assert.equal(res3.value.action, "pass");
  assert.equal(corrOpts.length, 3);
  assert.equal(corrOpts[1].disableThinking, true);
  assert.equal(corrOpts[2].disableThinking, true);

  // Case C: 单拍截止 callSignal 已触发时抛出 LabCallExpiredError，而非 LabFatalError
  const lotCtrl = new AbortController();
  lotCtrl.abort();
  await assert.rejects(
    () =>
      askAgentWithValidation({
        game,
        player: game.players[1],
        manifest,
        sharedConfig,
        label: "auction-expired",
        userPrompt: "pick",
        validate: () => ({ ok: true }),
        signal: runCtrl.signal,
        callSignal: lotCtrl.signal,
        io: null,
        budgetKind: "auction",
      }),
    (err: unknown) => err instanceof LabCallExpiredError
  );
});

test("实验室拍卖常量与同波次严禁代抬价、过期截断校验", () => {
  assert.equal(AUCTION_MAX_DECISIONS_PER_LOT, 6);
  assert.equal(LAB_AUCTION_ROUND_MS, 10_000);
  assert.equal(LAB_AUCTION_LOT_MAX_MS, 60_000);

  const manifest = makeManifest();
  const game = createSeededLabGame({
    roomId: "lab-auction-test",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 20261126,
  });
  game.phase = "AUCTION";
  for (const p of game.players) p.wealth = 100;

  const focus = findNextAutoAuctionCard(game);
  assert.ok(focus);
  game.auctionFocusCardId = focus;
  game.auctionFocusSetAt = 1000;

  const passedOnCard = new Set<string>();
  const lotHardDeadline = 23_000;

  // 3 名 AI 并发全都明确只出价 5：只有洗牌后顺位第一的 AI 以 5 成交，
  // 另外两名出价 5 的 AI 绝不能被系统私自抬价到 10 / 15！
  const wave = applyLabAuctionWave({
    game,
    focus,
    lotHardDeadline,
    passedOnCard,
    nowMs: () => 2000,
    bidResults: [
      { player: game.players[0], decision: { action: "bid", amount: 5, reasoning: "值5" } },
      { player: game.players[1], decision: { action: "bid", amount: 5, reasoning: "值5" } },
      { player: game.players[2], decision: { action: "bid", amount: 5, reasoning: "值5" } },
    ],
  });

  assert.equal(wave.anyAction, true);
  assert.equal(wave.forcedSold, false);
  const leading = getLeadingBidOnFocus(game);
  assert.ok(leading);
  assert.equal(leading.amount, 5);
  assert.equal(game.auctionBids?.length ?? 0, 1);
  assert.equal(game.autoHostNextActionAt, 12_000);

  // 已过本拍硬截止时间后到达的出价必须被直接丢弃
  const lateWave = applyLabAuctionWave({
    game,
    focus,
    lotHardDeadline,
    passedOnCard,
    nowMs: () => lotHardDeadline + 1,
    bidResults: [
      { player: game.players[3], decision: { action: "bid", amount: 15, reasoning: "迟到出价" } },
    ],
  });
  assert.equal(lateWave.anyAction, false);
  assert.equal(game.auctionBids?.length ?? 0, 1);

  // 焦点已切换到另一张牌时，旧牌响应必须被丢弃
  game.auctionFocusCardId = "another_card_id";
  const staleFocusWave = applyLabAuctionWave({
    game,
    focus,
    lotHardDeadline,
    passedOnCard,
    nowMs: () => 5000,
    bidResults: [
      { player: game.players[4], decision: { action: "bid", amount: 15, reasoning: "旧牌出价" } },
    ],
  });
  assert.equal(staleFocusWave.anyAction, false);
  assert.equal(game.auctionBids?.length ?? 0, 1);
});

test("settleLabAuctionLot 在领先出价者付不起时流拍跳过并顺延下一张卡、不死循环", () => {
  const manifest = makeManifest();
  const game = createSeededLabGame({
    roomId: "lab-settle-unpayable",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 13579,
  });
  game.phase = "AUCTION";
  game.players[0].wealth = 100;

  const focus = findNextAutoAuctionCard(game);
  assert.ok(focus);
  game.auctionFocusCardId = focus;
  game.auctionFocusSetAt = 1000;
  game.autoHostNextActionAt = 11_000;

  const placed = placeAuctionBid(game, game.players[0].id, 50);
  assert.equal(placed.ok, true);

  // 模拟领先者后续因其他扣款导致账面只剩 10，无法支付已出价的 50
  game.players[0].wealth = 10;

  const outcome = settleLabAuctionLot(game, focus, false);
  assert.equal(outcome, "passed");
  assert.equal(game.autoHostNextActionAt, undefined);
  assert.equal(game.auctionFocusCardId, undefined);
  assert.equal((game.auctionPassedCardIds ?? []).includes(focus), true);
  assert.equal(game.auctionBids?.[0]?.status, "void_passed");

  const next = findNextAutoAuctionCard(game, focus);
  assert.ok(next);
  assert.notEqual(next, focus);
});
