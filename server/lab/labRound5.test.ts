import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { AiModelConfig } from "../ai/aiConfig.js";
import { askAiJson, extractThinkTags } from "../ai/llmClient.js";
import { initCommunityLeaderboardPersistence } from "../state/communityLeaderboard.js";
import { initSessionArchivePersistence } from "../state/sessionArchive.js";
import {
  buildLabSystemPrompt,
  DEFAULT_LAB_BEHAVIOR_PROMPTS,
} from "./labPrompts.js";
import {
  askAgentWithValidation,
  createSeededLabGame,
  getLabActionBudget,
  getLabConfigSummary,
  getLabLiveStatus,
  startLabRun,
} from "./labRunner.js";
import { initLabStore, listLabSessionsByRunIds } from "./labStore.js";
import { DEFAULT_LAB_SIX_SEAT_MODELS } from "./siliconflowModels.js";
import type { LabRunManifest } from "./labTypes.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function waitForLabFinish(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!getLabLiveStatus().running) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Timed out waiting for Lab run to finish");
}

test("askAiJson 完整保留流式 reasoning_content 与正文 <think> 原始思考过程", async () => {
  const extracted = extractThinkTags("<think>先比对两个项目回报率</think>\n{\"ok\":true}");
  assert.equal(extracted.think, "先比对两个项目回报率");
  assert.equal(extracted.content, '{"ok":true}');

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const chunks = [
      { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "第一段推演；" } }] },
      { id: "c2", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "第二段核对。" } }] },
      { id: "c3", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: '{"investment":{"1":5},"ready":true}' } }] },
    ];
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  try {
    const cfg: AiModelConfig = {
      apiKey: "test-key",
      baseURL: `http://127.0.0.1:${addr.port}/v1`,
      model: "Qwen/Qwen3.8-27B",
      provider: "siliconflow",
      source: "shared",
    };
    const result = await askAiJson("sys", "usr", {
      config: cfg,
      thinkingBudget: 512,
      maxOutputTokens: 1200,
      timeoutMs: 8_000,
      maxRetries: 0,
    });
    assert.equal(result.ok, true);
    assert.equal(result.rawThinking, "第一段推演；第二段核对。");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("系统提示词可独立替换行为部分，自动保留安全边界与规则库，并支持三档思考预算", () => {
  const summary = getLabConfigSummary();
  assert.ok(summary.defaultBehaviorPrompts.guided_two_step.includes("自然平和"));
  assert.equal(summary.defaultBehaviorPrompts.free_two_step.includes("自然平和"), false);
  assert.equal(summary.defaultBehaviorPrompts.free_one_step.includes("自然平和"), false);

  const customSys = buildLabSystemPrompt(2, "玩家2", {
    interactionMode: "free_one_step",
    customSystemPrompt: "自定义：我是 {seatName}（{seatIndex}号），一切自己判断。",
  });
  assert.ok(customSys.includes("自定义：我是 玩家2（2号），一切自己判断。"));
  assert.ok(customSys.includes("## 安全边界（重要）"));
  assert.ok(customSys.includes("## 规则知识库"));
  assert.ok(DEFAULT_LAB_BEHAVIOR_PROMPTS.guided_two_step.includes("{seatName}"));

  assert.equal(getLabActionBudget("investment", "fast").thinkingBudget, 0);
  assert.equal(getLabActionBudget("investment", "moderate").thinkingBudget, 1024);
  assert.equal(getLabActionBudget("investment", "deep").thinkingBudget, 3072);
});

test("自由一步模式、关闭拍卖/转账与原始思考过程落盘校验", async () => {
  const dir = makeTempDir("lab-round5-");
  try {
    initCommunityLeaderboardPersistence(path.join(dir, "leaderboard.json"));
    initSessionArchivePersistence(path.join(dir, "session_archive.json"));
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    const started = startLabRun({
      condition: "free-one-step-no-auction",
      name: "一步自由模式与模块开关测试",
      games: 1,
      seedBase: 20261130,
      chatEnabled: true,
      publicChatEnabled: true,
      privateChatEnabled: false,
      customGroupsEnabled: false,
      transferEnabled: false,
      auctionEnabled: false,
      buffCardsEnabled: false,
      coffeeEnabled: false,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      interactionMode: "free_one_step",
      thinkingMode: "fast",
      customSystemPrompt: "我是 {seatName}，自主决策不问任何人。",
      mock: true,
      tokenBudgetPerAgent: 5_000_000,
      models: DEFAULT_LAB_SIX_SEAT_MODELS,
    });
    assert.equal(started.ok, true);
    await waitForLabFinish();

    const [session] = listLabSessionsByRunIds([started.run.runId]);
    assert.equal(session.qc.valid, true);
    // 一步自由模式不会拆分单独的 chat 步
    assert.equal(session.snapshot.agentDecisions.filter((d) => d.kind === "chat").length, 0);
    // 关闭私聊、小群、拍卖和转账后均应为 0
    assert.equal(session.snapshot.directMessages.length, 0);
    assert.equal(session.snapshot.auctionBids.length, 0);
    assert.equal(session.snapshot.transactions.length, 0);
    // 所有决策均保留 rawThinking
    assert.ok(session.snapshot.agentDecisions.some((d) => Boolean(d.rawThinking)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("首轮输出格式纠偏后再遇超时，仍会触发极速降思考重试", async () => {
  const manifest: LabRunManifest = {
    runId: "round5-fast-retry",
    name: "round5-fast-retry",
    condition: "C1",
    notes: "",
    seedBase: 20261130,
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
    roomId: "lab-round5-fast-retry",
  };
  const game = createSeededLabGame({
    roomId: manifest.roomId,
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 12345,
  });
  const sharedConfig: AiModelConfig = {
    apiKey: "test-key",
    baseURL: "https://api.siliconflow.cn/v1",
    model: "tencent/Hy4-preview",
    provider: "siliconflow",
    source: "shared",
  };
  const calls: Array<{ disableThinking?: boolean }> = [];
  const res = await askAgentWithValidation<{ reasoning: string }>({
    game,
    player: game.players[4],
    manifest,
    sharedConfig,
    label: "r3-chat",
    userPrompt: "chat",
    validate: (d) =>
      d && typeof d === "object" && typeof (d as { reasoning?: unknown }).reasoning === "string"
        ? { reasoning: String((d as { reasoning: string }).reasoning) }
        : null,
    signal: new AbortController().signal,
    io: null,
    budgetKind: "chat",
    llmCaller: async (_sys, _usr, opts = {}) => {
      calls.push({ disableThinking: opts.disableThinking });
      if (calls.length === 1) {
        return { ok: true, data: { invalid: true }, raw: '{"invalid":true}', latencyMs: 500 };
      }
      if (calls.length === 2) {
        return { ok: false, data: null, raw: "", latencyMs: 60_000, error: "timeout 60000ms" };
      }
      return {
        ok: true,
        data: { reasoning: "极速重试成功" },
        raw: '{"reasoning":"极速重试成功"}',
        latencyMs: 900,
      };
    },
  });
  assert.equal(res.value.reasoning, "极速重试成功");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].disableThinking, false);
  assert.equal(calls[1].disableThinking, false);
  assert.equal(calls[2].disableThinking, true);
});
