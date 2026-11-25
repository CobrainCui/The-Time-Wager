import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { initCommunityLeaderboardPersistence, getPublicCommunityLeaderboard } from "../state/communityLeaderboard.js";
import { initSessionArchivePersistence, listSessions } from "../state/sessionArchive.js";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import {
  buildLabComparisonAnalysis,
  buildLabComparisonWorkbook,
  buildLabDatasetCsv,
  buildLabRunWorkbook,
  buildLabSessionWorkbook,
} from "./labExport.js";
import {
  createSeededLabGame,
  getDefaultLabTokenBudgetPerAgent,
  getLabLiveStatus,
  getProductBaselineTokenBudget,
  startLabRun,
} from "./labRunner.js";
import { deriveSeed } from "./labRng.js";
import {
  getLabRunById,
  initLabStore,
  listLabRuns,
  listLabSessionsByRunIds,
} from "./labStore.js";
import type { LabRunManifest } from "./labTypes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

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

test("默认消耗上限为产品版基准的 2 倍，且超限会严格终止本局不回退", async () => {
  const dir = makeTempDir("lab-budget-");
  try {
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    const baseline = getProductBaselineTokenBudget();
    const labDefault = getDefaultLabTokenBudgetPerAgent();
    assert.equal(labDefault, baseline * 5);

    const started = startLabRun({
      condition: "budget-fail",
      name: "预算超限测试",
      games: 1,
      seedBase: 123456,
      chatEnabled: true,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: true,
      tokenBudgetPerAgent: 100,
      models: Array(6).fill("mock-model"),
    });
    assert.equal(started.ok, true);
    await waitForLabFinish();

    const run = getLabRunById(started.run.runId);
    assert.ok(run);
    assert.equal(run.status, "failed");
    assert.equal(run.failedGames, 1);

    const sessions = listLabSessionsByRunIds([run.runId]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "failed");
    assert.equal(sessions[0].qc.valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("相同基准种子产生一致的时代顺序与项目发牌", () => {
  const seed = deriveSeed(20261104, 0);
  const manifest: LabRunManifest = {
    runId: "seed-check",
    name: "seed-check",
    condition: "C0",
    notes: "",
    seedBase: 20261104,
    games: 1,
    createdAt: new Date().toISOString(),
    gitCommit: null,
    promptVersion: "v3",
    promptHash: "hash",
    models: Array(6).fill("mock-model"),
    providers: Array(6).fill("mock"),
    temperature: 0.7,
    tokenBudgetPerAgent: 2_000_000,
    maxOutputTokens: 64_000,
    maxRetries: 3,
    chatEnabled: false,
    memoryEnabled: true,
    predictionEnabled: true,
    autoSocialScore: true,
    mock: true,
    roomId: "lab-seed-check",
  };

  const g1 = createSeededLabGame({
    roomId: "lab-s1",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed,
  });
  const g2 = createSeededLabGame({
    roomId: "lab-s2",
    manifest,
    gameIndex: 0,
    sessionOrdinal: 0,
    seed,
  });

  assert.deepEqual(g1.eraSequence, g2.eraSequence);
  assert.equal(g1.eraSequence.length, 4);

  ensureProjectsDrawnForEra(g1);
  ensureProjectsDrawnForEra(g2);
  assert.deepEqual(
    g1.activeProjects.map((p) => p.id),
    g2.activeProjects.map((p) => p.id)
  );
});

test("完整 8 轮实验链路、产品榜彻底隔离及三档 Excel/CSV 导出校验", async () => {
  const dir = makeTempDir("lab-e2e-");
  try {
    initCommunityLeaderboardPersistence(path.join(dir, "leaderboard.json"));
    initSessionArchivePersistence(path.join(dir, "session_archive.json"));
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: null,
    });

    const started = startLabRun({
      condition: "C1-test",
      name: "端到端自检",
      games: 1,
      seedBase: 20261125,
      chatEnabled: true,
      memoryEnabled: true,
      predictionEnabled: true,
      autoSocialScore: true,
      mock: true,
      tokenBudgetPerAgent: 2_000_000,
      models: Array(6).fill("mock-model"),
    });
    assert.equal(started.ok, true);
    await waitForLabFinish();

    const run = getLabRunById(started.run.runId);
    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.equal(run.completedGames, 1);

    const sessions = listLabSessionsByRunIds([run.runId]);
    assert.equal(sessions.length, 1);
    const s = sessions[0];
    assert.equal(s.status, "completed");
    assert.equal(s.qc.valid, true);
    assert.equal(s.snapshot.meta.currentEra, 4);
    assert.equal(s.snapshot.meta.globalRound, 8);
    assert.equal(s.snapshot.predictions.length, 24);
    assert.ok(s.snapshot.groupMessages.length > 0);
    assert.ok(s.snapshot.directMessages.length > 0);
    assert.ok(s.snapshot.agentDecisions.length > 0);

    // 产品版历史场次与排行榜必须零污染
    assert.equal(listSessions({ status: "all" }).total, 0);
    assert.equal(getPublicCommunityLeaderboard().length, 0);

    // 1 档：单局 16 表 Excel
    const sessionBuf = await buildLabSessionWorkbook(s.snapshot);
    const sessionWb = new ExcelJS.Workbook();
    await sessionWb.xlsx.load(sessionBuf as unknown as ArrayBuffer);
    assert.equal(sessionWb.worksheets.length, 16);

    // 2 档：单批 6 表 Excel
    const runBuf = await buildLabRunWorkbook(run, sessions);
    const runWb = new ExcelJS.Workbook();
    await runWb.xlsx.load(runBuf as unknown as ArrayBuffer);
    assert.equal(runWb.worksheets.length, 6);

    // 3 档：多批跨条件对比 6 表 Excel + CSV
    const analysis = buildLabComparisonAnalysis([run], sessions, { includeMock: true });
    assert.equal(analysis.datasetRows.length, 6);
    const compBuf = await buildLabComparisonWorkbook(analysis);
    const compWb = new ExcelJS.Workbook();
    await compWb.xlsx.load(compBuf as unknown as ArrayBuffer);
    assert.equal(compWb.worksheets.length, 6);

    const csv = buildLabDatasetCsv(analysis);
    const csvLines = csv.trim().split(/\r?\n/);
    assert.equal(csvLines.length, 7); // 1 header + 6 players
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("从 agent-edition/experiments 只读迁移历史真实大模型实验记录", () => {
  const expDir = path.join(repoRoot, "agent-edition", "experiments");
  if (!fs.existsSync(expDir)) return;

  const dir = makeTempDir("lab-migrate-");
  try {
    initLabStore({
      runsPath: path.join(dir, "lab_runs.json"),
      sessionsPath: path.join(dir, "lab_archive.json"),
      agentEditionExperimentsDir: expDir,
    });

    const { runs, stats } = listLabRuns({ includeMock: false, status: "all" });
    assert.ok(runs.length >= 3);
    assert.ok(stats.completedRealSessions >= 3);

    const c1 = runs.find((r) => r.manifest.condition === "C1");
    assert.ok(c1);
    assert.equal(c1.migratedFromAgentEdition, true);
    assert.equal(c1.status, "completed");
    assert.equal(c1.sessions.length, 1);
    assert.equal(c1.sessions[0].qc.valid, true);
    assert.ok(c1.sessions[0].playersSummary.every((p) => p.socialRank === "A"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
