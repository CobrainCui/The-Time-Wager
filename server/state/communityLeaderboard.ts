import fs from "fs";
import { Server } from "socket.io";
import { globalLeaderboard, rooms } from "./store.js";
import { broadcastUpdate } from "../network/broadcast.js";

export type CommunityLeaderboardEntry = {
  name: string;
  score: number;
  roomId: string;
  recordedAt: number;
};

const TOP_N = 10;
const MAX_NAME_LENGTH = 20;

let persistPath: string | null = null;

export function initCommunityLeaderboardPersistence(filePath: string): void {
  persistPath = filePath;
  loadFromDisk();
}

function loadFromDisk(): void {
  if (!persistPath || !fs.existsSync(persistPath)) return;
  try {
    const raw = fs.readFileSync(persistPath, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: CommunityLeaderboardEntry[] };
    if (!Array.isArray(parsed.entries)) return;
    globalLeaderboard.length = 0;
    for (const e of parsed.entries) {
      if (typeof e.name !== "string" || typeof e.score !== "number") continue;
      globalLeaderboard.push({
        name: e.name,
        score: e.score,
        roomId: typeof e.roomId === "string" ? e.roomId : "",
        recordedAt: typeof e.recordedAt === "number" ? e.recordedAt : 0,
      });
    }
    sortAndTrimInPlace();
  } catch (err) {
    console.error("Failed to load community leaderboard:", err);
  }
}

function persistToDisk(): void {
  if (!persistPath) return;
  try {
    const dir = persistPath.replace(/[/\\][^/\\]+$/, "");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      persistPath,
      JSON.stringify({ entries: getCommunityLeaderboard() }, null, 2),
      "utf-8"
    );
  } catch (err) {
    console.error("Failed to persist community leaderboard:", err);
  }
}

function sortAndTrimInPlace(): void {
  globalLeaderboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.recordedAt - a.recordedAt;
  });
  while (globalLeaderboard.length > TOP_N) globalLeaderboard.pop();
}

/** 去除控制字符、首尾空白，限制长度 */
export function sanitizeCommunityName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

export function getCommunityLeaderboard(): CommunityLeaderboardEntry[] {
  return globalLeaderboard.map((e) => ({ ...e }));
}

/** 同一 roomId 只保留最新一条（同房重开一局后更新分数，不重复占榜） */
export function recordCommunityScore(
  name: string,
  score: number,
  roomId: string
): CommunityLeaderboardEntry[] {
  const safeScore = Number.isFinite(score) ? Math.round(score) : 0;
  const recordedAt = Date.now();
  const idx = globalLeaderboard.findIndex((e) => e.roomId === roomId);
  const entry: CommunityLeaderboardEntry = { name, score: safeScore, roomId, recordedAt };
  if (idx >= 0) {
    globalLeaderboard[idx] = entry;
  } else {
    globalLeaderboard.push(entry);
  }
  sortAndTrimInPlace();
  persistToDisk();
  return getCommunityLeaderboard();
}

export function broadcastLeaderboardToAllRooms(io: Server): void {
  for (const game of Object.values(rooms)) {
    broadcastUpdate(io, game);
  }
}
