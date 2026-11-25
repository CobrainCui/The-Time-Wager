import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../util/atomicJson.js";
import { buildLabSessionQc } from "./labExport.js";
import type {
  LabPlayerSummary,
  LabRunManifest,
  LabRunRecord,
  LabSessionExport,
  LabSessionRecord,
} from "./labTypes.js";

type RunsFile = { runs: LabRunRecord[]; migratedAt?: number };
type ArchiveFile = { sessions: LabSessionRecord[] };

let runsPersistPath: string | null = null;
let sessionsPersistPath: string | null = null;
let persistDisabled = false;

const runsById = new Map<string, LabRunRecord>();
const sessionsById = new Map<string, LabSessionRecord>();

export function initLabStore(options: {
  runsPath: string;
  sessionsPath: string;
  agentEditionExperimentsDir?: string | null;
}): void {
  runsPersistPath = options.runsPath;
  sessionsPersistPath = options.sessionsPath;
  persistDisabled = false;
  runsById.clear();
  sessionsById.clear();

  const runsExisted = fs.existsSync(runsPersistPath);
  if (runsExisted) {
    loadRunsFromDisk();
  }
  if (fs.existsSync(sessionsPersistPath)) {
    loadSessionsFromDisk();
  }

  // 仅当还没有迁移过历史真实实验记录时，自动从 agent-edition/experiments 只读导入真实对局
  const hasMigrated = [...runsById.values()].some((r) => r.migratedFromAgentEdition);
  if (!hasMigrated && options.agentEditionExperimentsDir) {
    const imported = migrateRealExperimentsFromAgentEdition(options.agentEditionExperimentsDir);
    if (imported > 0) {
      persistAll();
      console.log(`[labStore] 已迁移 ${imported} 批历史真实实验记录到 6AI 实验室档案`);
    }
  }
}

function loadRunsFromDisk(): void {
  if (!runsPersistPath || !fs.existsSync(runsPersistPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(runsPersistPath, "utf8")) as RunsFile;
    if (!Array.isArray(parsed.runs)) {
      persistDisabled = true;
      return;
    }
    for (const r of parsed.runs) {
      if (r?.runId) runsById.set(r.runId, r);
    }
  } catch (err) {
    persistDisabled = true;
    console.error("[labStore] 加载实验批次档案失败，暂停写入:", err);
  }
}

function loadSessionsFromDisk(): void {
  if (!sessionsPersistPath || !fs.existsSync(sessionsPersistPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionsPersistPath, "utf8")) as ArchiveFile;
    if (!Array.isArray(parsed.sessions)) {
      persistDisabled = true;
      return;
    }
    for (const s of parsed.sessions) {
      if (s?.sessionId) sessionsById.set(s.sessionId, s);
    }
  } catch (err) {
    persistDisabled = true;
    console.error("[labStore] 加载实验场次档案失败，暂停写入:", err);
  }
}

function persistRuns(): void {
  if (!runsPersistPath || persistDisabled) return;
  try {
    const runs = [...runsById.values()].sort((a, b) => b.startedAt - a.startedAt);
    writeJsonAtomic(runsPersistPath, { runs });
  } catch (err) {
    console.error("[labStore] 写入实验批次失败:", err);
  }
}

function persistSessions(): void {
  if (!sessionsPersistPath || persistDisabled) return;
  try {
    const sessions = [...sessionsById.values()].sort((a, b) => b.completedAt - a.completedAt);
    writeJsonAtomic(sessionsPersistPath, { sessions });
  } catch (err) {
    console.error("[labStore] 写入实验场次失败:", err);
  }
}

function persistAll(): void {
  persistRuns();
  persistSessions();
}

function parseSimpleCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    return row;
  });
}

function migrateRealExperimentsFromAgentEdition(experimentsDir: string): number {
  if (!fs.existsSync(experimentsDir)) return 0;
  let importedRuns = 0;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(experimentsDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(experimentsDir, ent.name);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;

    let rawManifest: Record<string, unknown>;
    try {
      rawManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }

    // 只迁移真实大模型实验，排除旧的 mock 自检记录
    if (rawManifest.mock === true) continue;

    let rawRun: Record<string, unknown> = {};
    const runPath = path.join(dir, "run.json");
    if (fs.existsSync(runPath)) {
      try {
        rawRun = JSON.parse(fs.readFileSync(runPath, "utf8")) as Record<string, unknown>;
      } catch {
        rawRun = {};
      }
    }

    const runId = String(rawManifest.runId || ent.name);
    if (runsById.has(runId)) continue;

    const createdIso = String(rawManifest.createdAt || new Date().toISOString());
    const startedAt = Number.isFinite(Date.parse(createdIso)) ? Date.parse(createdIso) : Date.now();
    const durationMs = Number(rawRun.durationMs ?? 0) || 0;
    const requestedGames = Number(rawManifest.games ?? rawRun.requestedGames ?? 1) || 1;
    const completedGames = Number(rawRun.completedGames ?? 0) || 0;

    const manifest: LabRunManifest = {
      runId,
      name: String(rawManifest.name || runId),
      condition: String(rawManifest.condition || "unknown"),
      notes: String(rawManifest.notes || "从 agent-edition 历史真实实验迁入"),
      seedBase: Number(rawManifest.seedBase ?? 0) || 0,
      games: requestedGames,
      createdAt: createdIso,
      gitCommit: rawManifest.gitCommit ? String(rawManifest.gitCommit) : null,
      promptVersion: String(rawManifest.promptVersion || "v3-neutral-2026-11"),
      promptHash: String(rawManifest.promptHash || ""),
      models: Array.isArray(rawManifest.models) ? rawManifest.models.map(String) : [],
      providers: Array.isArray(rawManifest.providers) ? rawManifest.providers.map(String) : [],
      temperature: Number(rawManifest.temperature ?? 0.7),
      tokenBudgetPerAgent: Number(rawManifest.tokenBudget ?? 3_000_000) || 3_000_000,
      maxOutputTokens: 64_000,
      maxRetries: Number(rawManifest.maxRetries ?? 3) || 3,
      chatEnabled: rawManifest.chatEnabled !== false,
      memoryEnabled: rawManifest.memoryEnabled !== false,
      predictionEnabled: rawManifest.predictionEnabled !== false,
      autoSocialScore: true,
      mock: false,
      roomId: String(rawManifest.roomId || `lab-${runId}`),
    };

    const socialByPlayerId = new Map<string, { rank: string; reason: string }>();
    const socialCsvPath = path.join(dir, "social_scores.csv");
    if (fs.existsSync(socialCsvPath)) {
      try {
        for (const row of parseSimpleCsv(fs.readFileSync(socialCsvPath, "utf8"))) {
          if (row.playerId && row.rank) {
            socialByPlayerId.set(row.playerId, { rank: row.rank, reason: row.reason || "" });
          }
        }
      } catch {
        /* ignore */
      }
    }

    const sessionIds: string[] = [];
    const sessionsFile = path.join(dir, "sessions.json");
    if (fs.existsSync(sessionsFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(sessionsFile, "utf8")) as {
          sessions?: Array<Record<string, unknown>>;
        };
        for (const rawS of parsed.sessions ?? []) {
          const snapshot = rawS.snapshot as LabSessionExport | undefined;
          const sid = String(rawS.sessionId || snapshot?.meta?.sessionId || "");
          if (!sid || !snapshot) continue;

          // 把 social_scores.csv 评定结果合并进玩家和指标表
          const tokenByPid = new Map<string, number>();
          for (const d of snapshot.agentDecisions ?? []) {
            tokenByPid.set(d.playerId, (tokenByPid.get(d.playerId) ?? 0) + (d.totalTokens ?? 0));
          }
          for (const p of snapshot.players ?? []) {
            const sc = socialByPlayerId.get(p.id);
            if (sc && /^[A-E]$/.test(sc.rank)) {
              p.socialRank = sc.rank as "A" | "B" | "C" | "D" | "E";
              p.socialRankReason = sc.reason;
            }
            p.tokensUsed = tokenByPid.get(p.id) ?? p.tokensUsed ?? 0;
          }
          for (const mp of snapshot.metrics?.players ?? []) {
            const sc = socialByPlayerId.get(mp.playerId);
            if (sc && /^[A-E]$/.test(sc.rank)) {
              mp.socialRank = sc.rank as "A" | "B" | "C" | "D" | "E";
              mp.socialRankReason = sc.reason;
            }
            mp.tokensUsed = tokenByPid.get(mp.playerId) ?? mp.tokensUsed ?? 0;
          }

          const playersSummary: LabPlayerSummary[] = (snapshot.players ?? [])
            .slice()
            .sort((a, b) => b.wealth - a.wealth)
            .map((p) => ({
              id: p.id,
              name: p.name,
              wealth: p.wealth,
              agentIndex: p.agentIndex,
              model: p.agentModel,
              provider: p.agentProvider,
              socialRank: p.socialRank,
              socialRankReason: p.socialRankReason,
              tokensUsed: p.tokensUsed ?? 0,
            }));

          const qc = buildLabSessionQc(snapshot, {
            runId,
            condition: manifest.condition,
            seedBase: manifest.seedBase,
            seed: Number(snapshot.meta?.seed ?? manifest.seedBase) || manifest.seedBase,
            chatEnabled: manifest.chatEnabled,
            predictionEnabled: manifest.predictionEnabled,
            tokenBudgetPerAgent: manifest.tokenBudgetPerAgent,
            mock: false,
            status: "completed",
          });

          const record: LabSessionRecord = {
            sessionId: sid,
            runId,
            condition: manifest.condition,
            seedBase: manifest.seedBase,
            seed: Number(snapshot.meta?.seed ?? manifest.seedBase) || manifest.seedBase,
            sessionOrdinal: Number(snapshot.meta?.sessionOrdinal ?? 0) || 0,
            roomId: String(rawS.roomId || snapshot.meta?.roomId || manifest.roomId),
            communityName: String(rawS.communityName || snapshot.meta?.communityName || "未命名"),
            communityWealth: Number(rawS.communityWealth ?? 0) || 0,
            playerCount: Number(rawS.playerCount ?? snapshot.players?.length ?? 6),
            sessionStartedAt:
              typeof rawS.sessionStartedAt === "number" ? rawS.sessionStartedAt : startedAt,
            completedAt:
              typeof rawS.completedAt === "number"
                ? rawS.completedAt
                : startedAt + durationMs,
            eraTheme: (rawS.eraTheme as string | null) ?? snapshot.meta?.eraTheme ?? null,
            topPlayer: (rawS.topPlayer as { name: string; wealth: number }) ?? {
              name: playersSummary[0]?.name ?? "—",
              wealth: playersSummary[0]?.wealth ?? 0,
            },
            playersSummary,
            status: "completed",
            mock: false,
            qc,
            snapshot,
          };
          sessionsById.set(sid, record);
          sessionIds.push(sid);
        }
      } catch {
        /* ignore corrupted historical session file */
      }
    }

    const exitCode = Number(rawRun.exitCode ?? (sessionIds.length > 0 ? 0 : 2));
    const runStatus =
      exitCode === 0 && sessionIds.length >= requestedGames ? "completed" : "failed";

    const runRecord: LabRunRecord = {
      runId,
      manifest,
      status: runStatus,
      completedGames: Math.max(completedGames, sessionIds.length),
      failedGames: runStatus === "failed" ? Math.max(1, requestedGames - sessionIds.length) : 0,
      currentGameIndex: requestedGames,
      startedAt,
      finishedAt: startedAt + durationMs,
      durationMs,
      ...(runStatus === "failed"
        ? { failureReason: `历史真实实验未完成（退出码 ${exitCode}）` }
        : {}),
      sessionIds,
      migratedFromAgentEdition: true,
    };
    runsById.set(runId, runRecord);
    importedRuns += 1;
  }

  return importedRuns;
}

export function saveLabRun(run: LabRunRecord): void {
  runsById.set(run.runId, { ...run });
  persistRuns();
}

export function saveLabSession(session: LabSessionRecord): void {
  sessionsById.set(session.sessionId, session);
  persistSessions();
}

export function getLabRunById(runId: string): LabRunRecord | null {
  return runsById.get(runId) ?? null;
}

export function listLabRuns(filter?: { includeMock?: boolean; status?: string }): {
  runs: Array<LabRunRecord & { sessions: Array<Omit<LabSessionRecord, "snapshot">> }>;
  stats: {
    totalRuns: number;
    completedRealSessions: number;
    failedOrStoppedSessions: number;
    mockSessions: number;
  };
} {
  const includeMock = filter?.includeMock ?? true;
  const status = filter?.status ?? "all";

  const allSessions = [...sessionsById.values()];
  const stats = {
    totalRuns: runsById.size,
    completedRealSessions: allSessions.filter((s) => !s.mock && s.status === "completed").length,
    failedOrStoppedSessions: allSessions.filter((s) => s.status !== "completed").length,
    mockSessions: allSessions.filter((s) => s.mock).length,
  };

  let runs = [...runsById.values()];
  if (!includeMock) runs = runs.filter((r) => !r.manifest.mock);
  if (status === "failed") {
    runs = runs.filter((r) => r.status === "failed" || r.status === "stopped");
  } else if (status === "completed") {
    runs = runs.filter((r) => r.status === "completed");
  }

  runs.sort((a, b) => b.startedAt - a.startedAt);

  return {
    runs: runs.map((r) => {
      const runSessions = allSessions
        .filter((s) => s.runId === r.runId)
        .sort((a, b) => a.sessionOrdinal - b.sessionOrdinal)
        .map(({ snapshot: _snap, ...rest }) => rest);
      return { ...r, sessions: runSessions };
    }),
    stats,
  };
}

export function listLabSessionsByRunIds(runIds?: string[]): LabSessionRecord[] {
  const all = [...sessionsById.values()];
  if (!runIds || runIds.length === 0) return all;
  const set = new Set(runIds);
  return all.filter((s) => set.has(s.runId));
}

export function listAllLabRunsRaw(): LabRunRecord[] {
  return [...runsById.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function getLabSessionById(sessionId: string): LabSessionRecord | null {
  return sessionsById.get(sessionId) ?? null;
}

export function deleteLabRun(runId: string): boolean {
  const run = runsById.get(runId);
  if (!run || run.status === "running") return false;
  runsById.delete(runId);
  for (const [sid, s] of sessionsById) {
    if (s.runId === runId) sessionsById.delete(sid);
  }
  persistAll();
  return true;
}
