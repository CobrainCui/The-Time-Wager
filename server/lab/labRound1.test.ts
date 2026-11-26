import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import { settlePhase } from "../logic/projectSettlement.js";
import { appendPublicFeed } from "../util/publicFeed.js";
import { initCommunityLeaderboardPersistence } from "../state/communityLeaderboard.js";
import { initSessionArchivePersistence } from "../state/sessionArchive.js";
import {
  buildLabObservation,
  createSeededLabGame,
  getDefaultLabTokenBudgetPerAgent,
  getLabConfigSummary,
  getLabLiveStatus,
  startLabRun,
} from "./labRunner.js";
import { buildLabInvestmentPrompt, buildLabPredictionPrompt } from "./labPrompts.js";
import {
  DEFAULT_LAB_SIX_SEAT_MODELS,
  SILICONFLOW_ALL_MODEL_IDS,
  SILICONFLOW_DEFAULT_BASE_URL,
  SILICONFLOW_MODEL_GROUPS,
} from "./siliconflowModels.js";
import { getLabRunById, initLabStore, listLabSessionsByRunIds } from "./labStore.js";
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

test("硅基流动国产实测可用模型池包含 8 家厂商共 12 款且 6 席默认模型各不相同", () => {
  assert.equal(SILICONFLOW_MODEL_GROUPS.length, 8);
  assert.equal(SILICONFLOW_ALL_MODEL_IDS.length, 12);
  assert.equal(DEFAULT_LAB_SIX_SEAT_MODELS.length, 6);
  assert.equal(new Set(DEFAULT_LAB_SIX_SEAT_MODELS).size, 6);

  const summary = getLabConfigSummary();
  assert.equal(summary.siliconflowBaseUrl, SILICONFLOW_DEFAULT_BASE_URL);
  assert.equal(summary.modelPoolGroups.length, 8);
  assert.equal(summary.defaultSeatModels.length, 6);
  assert.equal(summary.defaultLabTokenBudgetPerAgent, 5_000_000);
  assert.equal(getDefaultLabTokenBudgetPerAgent(), 5_000_000);
});

test("AI 盲视角观察与提示词严格屏蔽其他玩家的投资明细、私下转账与全知日志", () => {
  const manifest: LabRunManifest = {
    runId: "blind-check",
    name: "blind-check",
    condition: "C1",
    notes: "",
    seedBase: 20261125,
    games: 1,
    createdAt: new Date().toISOString(),
    gitCommit: null,
    promptVersion: "v3",
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
    roomId: "lab-blind-check",
  };

  const game = createSeededLabGame({
    roomId: "lab-blind-check",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed: 123456,
  });
  ensureProjectsDrawnForEra(game);
  const p1 = game.players[0];
  const p2 = game.players[1];
  const p3 = game.players[2];
  const targetProject = game.activeProjects[0];

  // p1 投 3，p2 投 7（关键机密明细，不得泄露给 p1），p2 并使用隐秘道具、与 p3 私下转账
  p1.investment[targetProject.id] = 3;
  p2.investment[targetProject.id] = 7;
  p2.inventory.push("secret_card_for_p2_only");
  targetProject.currentInvested = 10;
  targetProject.accumulatedInvested = 10;
  targetProject.investorRecords[p1.id] = 3;
  targetProject.investorRecords[p2.id] = 7;

  settlePhase(game);

  // p2 -> p3 私下待确认转账，带保密暗号备注
  game.transactions.push({
    id: "tx-secret-p2-p3",
    fromId: p2.id,
    fromName: p2.name,
    toId: p3.id,
    toName: p3.name,
    amount: 45,
    note: "SECRET_ALLIANCE_CODE_9981",
    status: "pending",
    timestamp: Date.now(),
  });
  game.logs.push("SECRET_GOD_LOG_PLAYER2_INVESTED_7");
  appendPublicFeed(game, "system", "公共动态：第 1 轮开始");

  const obsP1 = buildLabObservation(game, p1.id);
  const serializedObs = JSON.stringify(obsP1);
  const investPrompt = buildLabInvestmentPrompt(obsP1, "（无）", true);
  const predPrompt = buildLabPredictionPrompt(obsP1, "（无）");

  // 绝不包含他人之间的私下转账、他人手牌名、全知日志
  assert.equal("pendingTransactions" in (obsP1 as unknown as Record<string, unknown>), false);
  assert.equal("settlementHistory" in (obsP1 as unknown as Record<string, unknown>), false);
  assert.equal(serializedObs.includes("SECRET_ALLIANCE_CODE_9981"), false);
  assert.equal(serializedObs.includes("secret_card_for_p2_only"), false);
  assert.equal(serializedObs.includes("SECRET_GOD_LOG_PLAYER2_INVESTED_7"), false);
  assert.equal(serializedObs.includes("playerInvestments"), false);
  assert.equal(serializedObs.includes("playerGains"), false);

  // 不再拼接重复的观察 JSON
  assert.equal(investPrompt.includes("## 当前观察数据（JSON）"), false);
  assert.equal(predPrompt.includes("## 当前观察数据（JSON）"), false);
  assert.equal(investPrompt.includes("SECRET_ALLIANCE_CODE_9981"), false);
  assert.equal(investPrompt.includes("SECRET_GOD_LOG_PLAYER2_INVESTED_7"), false);

  // 本人视角能看到自己的投入与收益
  assert.equal(obsP1.mySettlementHistory.length, 1);
  assert.equal(obsP1.mySettlementHistory[0].projects[0].myInvested, 3);
});

test("支持不限额度（tokenBudgetPerAgent = 0）跑通完整 8 轮实验", async () => {
  const dir = makeTempDir("lab-unlimited-");
  try {
    initCommunityLeaderboardPersistence(path.join(dir, "leaderboard.json"));
    initSessionArchivePersistence(path.join(dir, "session_archive.json"));
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    const started = startLabRun({
      condition: "C2-unlimited",
      name: "不限额度校验",
      games: 1,
      seedBase: 20261126,
      chatEnabled: true,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: true,
      tokenBudgetPerAgent: 0,
      models: DEFAULT_LAB_SIX_SEAT_MODELS,
    });
    assert.equal(started.ok, true);
    assert.equal(started.run.manifest.tokenBudgetPerAgent, 0);
    await waitForLabFinish();

    const run = getLabRunById(started.run.runId);
    assert.ok(run);
    assert.equal(run.status, "completed");

    const sessions = listLabSessionsByRunIds([run.runId]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].qc.valid, true);
    assert.equal(sessions[0].qc.tokenBudgetExceeded, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
