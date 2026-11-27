import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createInitialGame, type GameState } from "../state/gameState.js";
import { addAiPlayer } from "./aiRoster.js";
import { canStartWithAi, clearAiPreflightCache, verifyAiAgents } from "./aiPreflight.js";
import { clearAiFailure } from "./aiOrchestrator.js";

function resetEnv() {
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  for (let slot = 1; slot <= 5; slot++) {
    delete process.env[`AI_PLAYER_${slot}_API_KEY`];
    delete process.env[`AI_PLAYER_${slot}_MODEL`];
    delete process.env[`AI_PLAYER_${slot}_BASE_URL`];
  }
  process.env.AI_STRICT_AGENT = "true";
}

test("严格模式：没有模型配置时拒绝添加 AI，并说明该填哪个变量", () => {
  resetEnv();
  const game = createInitialGame("strict-add", []);
  const result = addAiPlayer(game);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /AI_PLAYER_1_API_KEY/);
  }
  assert.equal(game.players.length, 0);
});

test("严格模式：配置了模型 Key 后可以添加 AI，座位号从 1 开始", () => {
  resetEnv();
  process.env.AI_API_KEY = "sk-strict-test";
  const game = createInitialGame("strict-add-ok", []);
  const result = addAiPlayer(game);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.player.aiSlot, 1);
});

test("严格模式：AI 连接未检测时不允许开局", () => {
  resetEnv();
  process.env.AI_API_KEY = "sk-strict-test";
  const game = createInitialGame("strict-gate", []);
  addAiPlayer(game);
  const gate = canStartWithAi(game);
  assert.equal(gate.ok, false);
  assert.match(gate.message ?? "", /检测/);
});

test("清除 AI 故障会恢复被系统暂停的投资倒计时", () => {
  resetEnv();
  process.env.AI_API_KEY = "sk-strict-test";
  const game = createInitialGame("strict-resume", []);
  const added = addAiPlayer(game);
  assert.equal(added.ok, true);
  if (!added.ok) return;
  game.phase = "INVESTMENT";
  game.investmentEndsAt = Date.now() + 60_000;
  game.investmentTimerPausedAt = Date.now();
  game.aiDeadlinePaused = true;
  game.aiFailures = {
    [added.player.id]: {
      playerId: added.player.id,
      name: added.player.name,
      phase: "INVESTMENT",
      at: Date.now(),
      message: "model down",
      kind: "model_error",
    },
  };

  clearAiFailure(game as GameState, added.player.id, null);
  assert.equal(game.investmentTimerPausedAt, undefined);
  assert.equal(game.aiDeadlinePaused, false);
  assert.equal(Object.keys(game.aiFailures ?? {}).length, 0);
  assert.ok((game.investmentEndsAt ?? 0) > Date.now() + 50_000);
});

test("预检对硅基流动请求携带 enable_thinking:false，遇到 503 或 400 参数拒绝会自动重试成功", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  let mode: "transient503" | "param400" = "transient503";
  let reqCount = 0;

  const mockServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      reqCount += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      bodies.push(body);
      if (reqCount === 1) {
        if (mode === "transient503") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "temporary 503 overload" } }));
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "unknown field enable_thinking" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "ok",
          object: "chat.completion",
          created: 1,
          model: String(body.model ?? "deepseek-ai/DeepSeek-V4.1-Flash"),
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        })
      );
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const addr = mockServer.address();
  const baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/v1`;
  const savedEnv = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_MODEL: process.env.AI_MODEL,
  };
  try {
    resetEnv();
    clearAiPreflightCache();
    process.env.AI_API_KEY = "sk-preflight-test";
    process.env.AI_PROVIDER = "siliconflow";
    process.env.AI_BASE_URL = baseUrl;
    process.env.AI_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

    const game = createInitialGame("strict-preflight-retry", []);
    const added = addAiPlayer(game);
    assert.equal(added.ok, true);

    // 场景1：首次 503 临时故障，保留 enable_thinking:false 自动重试成功
    mode = "transient503";
    reqCount = 0;
    const res1 = await verifyAiAgents(game, { force: true });
    assert.equal(res1.ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].enable_thinking, false);
    assert.equal(bodies[1].enable_thinking, false);

    // 场景2：首次 400 参数不兼容，自动剥离 enable_thinking 后重试成功
    bodies.length = 0;
    mode = "param400";
    reqCount = 0;
    const res2 = await verifyAiAgents(game, { force: true });
    assert.equal(res2.ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].enable_thinking, false);
    assert.equal("enable_thinking" in bodies[1], false);
  } finally {
    clearAiPreflightCache();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
});
