import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import { sendGroupChatMessage, ensurePublicChatGroup } from "../logic/chatGroups.js";
import { initCommunityLeaderboardPersistence } from "../state/communityLeaderboard.js";
import { initSessionArchivePersistence } from "../state/sessionArchive.js";
import {
  buildLabChatPrompt,
  buildLabInvestmentPrompt,
  buildLabSystemPrompt,
  LAB_PROMPT_VERSION,
} from "./labPrompts.js";
import {
  buildLabObservation,
  createSeededLabGame,
  getLabLiveStatus,
  startLabRun,
} from "./labRunner.js";
import { getLabRunById, initLabStore, listLabSessionsByRunIds } from "./labStore.js";
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

test("提示词版本升级且系统/沟通提示词包含自然平和协商引导", () => {
  assert.equal(LAB_PROMPT_VERSION, "v4-lab6ai-2026-11");
  const sys = buildLabSystemPrompt(1, "玩家1");
  assert.ok(sys.includes("自然平和") && sys.includes("有商有量"));

  const manifest: LabRunManifest = {
    runId: "prompt-v4-check",
    name: "prompt-v4-check",
    condition: "C1",
    notes: "",
    seedBase: 20261126,
    games: 1,
    createdAt: new Date().toISOString(),
    gitCommit: null,
    promptVersion: LAB_PROMPT_VERSION,
    promptHash: "hash",
    models: DEFAULT_LAB_SIX_SEAT_MODELS,
    providers: Array(6).fill("siliconflow"),
    temperature: 0.7,
    tokenBudgetPerAgent: 5_000_000,
    maxOutputTokens: 64_000,
    maxRetries: 3,
    chatEnabled: true,
    memoryEnabled: true,
    predictionEnabled: true,
    autoSocialScore: true,
    mock: true,
    roomId: "lab-prompt-v4",
  };

  const game = createSeededLabGame({
    roomId: "lab-prompt-v4",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 123456,
  });
  ensureProjectsDrawnForEra(game);
  game.phase = "INVESTMENT";
  ensurePublicChatGroup(game);
  const pubGroup = game.chatGroups?.find((g) => g.kind === "public");
  assert.ok(pubGroup);
  const sent = sendGroupChatMessage(
    game,
    game.players[1].id,
    pubGroup.id,
    "这轮我想看下长期项目，大家可以商量错峰一下",
    undefined,
    { allowAi: true }
  );
  assert.equal(sent.ok, true);

  const obs = buildLabObservation(game, game.players[0].id);
  const chatPrompt = buildLabChatPrompt(obs, "（暂无历史记忆）");
  assert.ok(chatPrompt.includes("阶段：投资前沟通"));
  assert.ok(chatPrompt.includes("只沟通、暂不提交投资"));
  assert.ok(chatPrompt.includes("这轮我想看下长期项目"));

  const investPrompt = buildLabInvestmentPrompt(obs, "（暂无历史记忆）", true);
  assert.ok(investPrompt.includes("本轮投资前沟通刚刚结束"));
  assert.ok(investPrompt.includes("这轮我想看下长期项目"));
});

test("开启沟通时执行同轮「先沟通、再投资」两步闭环；关闭沟通时不触发沟通步骤", async () => {
  const dir = makeTempDir("lab-round4-");
  try {
    initCommunityLeaderboardPersistence(path.join(dir, "leaderboard.json"));
    initSessionArchivePersistence(path.join(dir, "session_archive.json"));
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    // 1. chatEnabled = true
    const withChat = startLabRun({
      condition: "C1-two-step",
      name: "两步沟通闭环校验",
      games: 1,
      seedBase: 20261128,
      chatEnabled: true,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: true,
      tokenBudgetPerAgent: 5_000_000,
      models: DEFAULT_LAB_SIX_SEAT_MODELS,
    });
    assert.equal(withChat.ok, true);
    await waitForLabFinish();

    const run1 = getLabRunById(withChat.run.runId);
    assert.equal(run1?.status, "completed");
    const [session1] = listLabSessionsByRunIds([withChat.run.runId]);
    assert.equal(session1.qc.valid, true);

    const decisions1 = session1.snapshot.agentDecisions;
    const chatDecisions = decisions1.filter((d) => d.kind === "chat");
    const investDecisions = decisions1.filter((d) => d.kind === "investment");
    assert.equal(chatDecisions.length, 48, "8 轮 × 6 人 = 48 条投资前沟通决策");
    assert.equal(investDecisions.length, 48, "8 轮 × 6 人 = 48 条投资决策");

    // 确认同一全局轮内，chat 全部发生在 investment 之前
    for (let r = 1; r <= 8; r++) {
      const roundChatMaxIdx = Math.max(
        ...decisions1
          .map((d, idx) => ({ d, idx }))
          .filter((x) => x.d.globalRound === r && x.d.kind === "chat")
          .map((x) => x.idx)
      );
      const roundInvestMinIdx = Math.min(
        ...decisions1
          .map((d, idx) => ({ d, idx }))
          .filter((x) => x.d.globalRound === r && x.d.kind === "investment")
          .map((x) => x.idx)
      );
      assert.ok(roundChatMaxIdx < roundInvestMinIdx, `第 ${r} 轮必须先沟通再投资`);
    }

    // 2. chatEnabled = false (C0 对照)
    const noChat = startLabRun({
      condition: "C0-no-chat",
      name: "无沟通对照校验",
      games: 1,
      seedBase: 20261128,
      chatEnabled: false,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: true,
      tokenBudgetPerAgent: 5_000_000,
      models: DEFAULT_LAB_SIX_SEAT_MODELS,
    });
    assert.equal(noChat.ok, true);
    await waitForLabFinish();

    const [session0] = listLabSessionsByRunIds([noChat.run.runId]);
    assert.equal(session0.qc.valid, true);
    assert.equal(
      session0.snapshot.agentDecisions.filter((d) => d.kind === "chat").length,
      0
    );
    assert.equal(session0.snapshot.groupMessages.length, 0);
    assert.equal(session0.snapshot.directMessages.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
