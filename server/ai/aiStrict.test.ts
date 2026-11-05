import test from "node:test";
import assert from "node:assert/strict";
import { createInitialGame, type GameState } from "../state/gameState.js";
import { addAiPlayer } from "./aiRoster.js";
import { canStartWithAi } from "./aiPreflight.js";
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
