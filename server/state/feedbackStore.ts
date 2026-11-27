import crypto from "crypto";
import fs from "fs";
import { writeJsonAtomic } from "../util/atomicJson.js";
import { maskForbiddenText, normalizeNoteInput } from "../logic/forbiddenText.js";

export type FeedbackStatus = "visible" | "hidden";
export type FeedbackSource = "lobby" | "game_over" | "unknown";
export type PublicFeedbackSort = "featured" | "newest" | "highest" | "lowest";

export const FEEDBACK_POSITIVE_TAGS = [
  "好玩上头",
  "策略有深度",
  "适合开黑",
  "AI 很聪明",
  "人格报告准",
  "规则易上手",
] as const;

export const FEEDBACK_CONSTRUCTIVE_TAGS = [
  "节奏偏慢",
  "新手易迷糊",
  "AI 有待加强",
  "界面待优化",
  "期待新玩法",
] as const;

export const FEEDBACK_TAGS = [
  ...FEEDBACK_POSITIVE_TAGS,
  ...FEEDBACK_CONSTRUCTIVE_TAGS,
] as const;

export const FEEDBACK_LEGACY_TAGS = [
  "好玩",
  "规则清晰",
  "AI 陪玩",
  "需要改进",
] as const;

const TAG_SET = new Set<string>([...FEEDBACK_TAGS, ...FEEDBACK_LEGACY_TAGS]);

const VALID_PERSONA_NAMES = new Set<string>([
  "桥梁架构师",
  "瞬刻炼金士",
  "罗盘精算师",
  "时荫植者",
  "随机诗人",
  "涌机触发者",
]);

export const FEEDBACK_CONTENT_MAX = 500;
export const FEEDBACK_REPLY_MAX = 500;
export const FEEDBACK_MAX_ENTRIES = 5000;
export const SELF_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const PUBLIC_DEFAULT_LIMIT = 20;
const PUBLIC_MAX_LIMIT = 50;
const ADMIN_DEFAULT_LIMIT = 50;
const ADMIN_MAX_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export type FeedbackGameContext = {
  modeLabel?: string;
  humanCount?: number;
  aiCount?: number;
  personaName?: string;
};

export type FeedbackOfficialReply = {
  content: string;
  updatedAt: number;
};

export type FeedbackEntry = {
  id: string;
  rating: number;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  status: FeedbackStatus;
  source: FeedbackSource;
  hiddenAt?: number;
  verifiedGameOver: boolean;
  gameContext?: FeedbackGameContext;
  helpfulCount: number;
  helpfulVoterIds: string[];
  pinned: boolean;
  pinnedAt?: number;
  officialReply?: FeedbackOfficialReply;
  editTokenHash?: string;
};

export type PublicFeedbackEntry = {
  id: string;
  rating: number;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  source: FeedbackSource;
  verifiedGameOver: boolean;
  gameContext?: FeedbackGameContext;
  helpfulCount: number;
  viewerHasVoted?: boolean;
  pinned: boolean;
  officialReply?: FeedbackOfficialReply;
};

export type AdminFeedbackEntry = Omit<FeedbackEntry, "helpfulVoterIds" | "editTokenHash">;

export type FeedbackDistribution = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
};

export type FeedbackStats = {
  count: number;
  average: number;
  positiveRate: number;
  distribution: FeedbackDistribution;
  tagCounts: Array<{ tag: string; count: number }>;
  verifiedCount: number;
  recent7dCount: number;
};

type FeedbackFile = { entries: FeedbackEntry[] };

let persistPath: string | null = null;
let persistDisabled = false;
let entries: FeedbackEntry[] = [];

export function initFeedbackPersistence(filePath: string): void {
  persistPath = filePath;
  persistDisabled = false;
  entries = [];
  loadFromDisk();
  sortEntries();
}

function loadFromDisk(): void {
  if (!persistPath || !fs.existsSync(persistPath)) return;
  try {
    const raw = fs.readFileSync(persistPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FeedbackFile> | null;
    if (!parsed || !Array.isArray(parsed.entries)) {
      persistDisabled = true;
      console.error("Feedback store parse: missing entries array; refusing further writes");
      return;
    }
    entries = parsed.entries
      .map(normalizeLoadedEntry)
      .filter((entry): entry is FeedbackEntry => entry != null);
  } catch (err) {
    persistDisabled = true;
    console.error("Failed to load feedback store; refusing further writes:", err);
  }
}

function sanitizeTextBlock(raw: unknown, maxLen: number, mask: boolean): string {
  if (typeof raw !== "string") return "";
  const normalized = mask ? normalizeNoteInput(raw) : raw;
  const capped = Array.from(normalized).slice(0, maxLen).join("");
  // 去掉控制字符后再打码；保留换行，最多留一个空行，避免评价挤成一行。
  const withoutControl = capped
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
  const finalText = mask ? maskForbiddenText(withoutControl) : withoutControl;
  return finalText.trim();
}

function sanitizeFeedbackContent(raw: unknown): string {
  return sanitizeTextBlock(raw, FEEDBACK_CONTENT_MAX, true);
}

function sanitizeReplyContent(raw: unknown): string {
  return sanitizeTextBlock(raw, FEEDBACK_REPLY_MAX, false);
}

function sanitizeGameContext(raw: unknown): FeedbackGameContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const out: FeedbackGameContext = {};

  if (typeof obj.modeLabel === "string") {
    const cleaned = maskForbiddenText(
      obj.modeLabel
        .replace(/[\r\n\u0000-\u001F\u007F-\u009F]/g, " ")
        .trim()
    ).slice(0, 24);
    if (cleaned) out.modeLabel = cleaned;
  }

  if (typeof obj.humanCount === "number" && Number.isInteger(obj.humanCount) && obj.humanCount >= 0 && obj.humanCount <= 6) {
    out.humanCount = obj.humanCount;
  }
  if (typeof obj.aiCount === "number" && Number.isInteger(obj.aiCount) && obj.aiCount >= 0 && obj.aiCount <= 6) {
    out.aiCount = obj.aiCount;
  }

  if (typeof obj.personaName === "string") {
    const persona = obj.personaName.trim();
    if (VALID_PERSONA_NAMES.has(persona)) {
      out.personaName = persona;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeVoterId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 6 || trimmed.length > 80) return null;
  if (!/^[a-zA-Z0-9_.:-]+$/.test(trimmed)) return null;
  return trimmed;
}

function normalizeVoterIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const val of raw) {
    const id = sanitizeVoterId(val);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 2000) break;
  }
  return out;
}

function normalizeOfficialReply(raw: unknown): FeedbackOfficialReply | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const content = sanitizeReplyContent(obj.content);
  if (!content) return undefined;
  const updatedAt =
    typeof obj.updatedAt === "number" && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now();
  return { content, updatedAt };
}

function normalizeLoadedEntry(value: unknown): FeedbackEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (
    typeof raw.rating !== "number" ||
    !Number.isInteger(raw.rating) ||
    raw.rating < 1 ||
    raw.rating > 5
  ) {
    return null;
  }
  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  const source = normalizeSource(raw.source);
  const voterIds = normalizeVoterIds(raw.helpfulVoterIds);
  const pinned = raw.pinned === true;

  const entry: FeedbackEntry = {
    id: raw.id,
    rating: raw.rating,
    content: typeof raw.content === "string" ? sanitizeFeedbackContent(raw.content) : "",
    tags: normalizeTags(raw.tags),
    createdAt,
    status: raw.status === "hidden" ? "hidden" : "visible",
    source,
    verifiedGameOver:
      typeof raw.verifiedGameOver === "boolean" ? raw.verifiedGameOver : source === "game_over",
    helpfulCount: voterIds.length,
    helpfulVoterIds: voterIds,
    pinned,
  };

  if (typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)) {
    entry.updatedAt = raw.updatedAt;
  }
  if (
    entry.status === "hidden" &&
    typeof raw.hiddenAt === "number" &&
    Number.isFinite(raw.hiddenAt)
  ) {
    entry.hiddenAt = raw.hiddenAt;
  }
  const gameContext = sanitizeGameContext(raw.gameContext);
  if (gameContext) {
    entry.gameContext = gameContext;
  }
  if (pinned && typeof raw.pinnedAt === "number" && Number.isFinite(raw.pinnedAt)) {
    entry.pinnedAt = raw.pinnedAt;
  }
  const officialReply = normalizeOfficialReply(raw.officialReply);
  if (officialReply) {
    entry.officialReply = officialReply;
  }
  if (typeof raw.editTokenHash === "string" && raw.editTokenHash.length > 0) {
    entry.editTokenHash = raw.editTokenHash;
  }

  return entry;
}

function sortEntries(): void {
  entries.sort((a, b) => b.createdAt - a.createdAt);
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const tag = value.trim();
    if (!TAG_SET.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 3) break;
  }
  return out;
}

function normalizeSource(raw: unknown): FeedbackSource {
  return raw === "lobby" || raw === "game_over" ? raw : "unknown";
}

function createId(): string {
  let id = "";
  do {
    const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    id = `fb_${Date.now().toString(36)}_${random}`;
  } while (entries.some((entry) => entry.id === id));
  return id;
}

function hashEditToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function verifyEditToken(token: string, expectedHash: string): boolean {
  const actualBuf = Buffer.from(hashEditToken(token), "utf-8");
  const expectedBuf = Buffer.from(expectedHash, "utf-8");
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function clampLimit(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeOffset(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function pruneOverflow(): void {
  while (entries.length > FEEDBACK_MAX_ENTRIES) {
    let victim = -1;
    // entries 已按时间倒序，优先淘汰最旧的未置顶隐藏条目，其次最旧的未置顶条目。
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].status === "hidden" && !entries[i].pinned) {
        victim = i;
        break;
      }
    }
    if (victim === -1) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (!entries[i].pinned) {
          victim = i;
          break;
        }
      }
    }
    if (victim === -1) victim = entries.length - 1;
    entries.splice(victim, 1);
  }
}

function persistToDisk(): void {
  if (!persistPath || persistDisabled) return;
  try {
    writeJsonAtomic(persistPath, { entries });
  } catch (err) {
    console.error("Failed to persist feedback store:", err);
  }
}

function cloneGameContext(ctx?: FeedbackGameContext): FeedbackGameContext | undefined {
  return ctx ? { ...ctx } : undefined;
}

function cloneOfficialReply(reply?: FeedbackOfficialReply): FeedbackOfficialReply | undefined {
  return reply ? { ...reply } : undefined;
}

function cloneEntry(entry: FeedbackEntry): FeedbackEntry {
  return {
    ...entry,
    tags: [...entry.tags],
    helpfulVoterIds: [...entry.helpfulVoterIds],
    ...(entry.gameContext ? { gameContext: cloneGameContext(entry.gameContext) } : {}),
    ...(entry.officialReply ? { officialReply: cloneOfficialReply(entry.officialReply) } : {}),
  };
}

export function addFeedback(
  input: unknown
):
  | {
      ok: true;
      entry: FeedbackEntry;
      editToken: string;
      summary: { count: number; average: number };
      stats: FeedbackStats;
    }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "参数格式有误" };
  }
  const raw = input as Record<string, unknown>;
  const rating = raw.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return { ok: false, error: "评分必须为 1-5 的整数" };
  }

  const source = normalizeSource(raw.source);
  const verifiedGameOver = source === "game_over";
  const gameContext = verifiedGameOver ? sanitizeGameContext(raw.gameContext) : undefined;
  const editToken = crypto.randomBytes(24).toString("hex");

  const entry: FeedbackEntry = {
    id: createId(),
    rating,
    content: sanitizeFeedbackContent(raw.content),
    tags: normalizeTags(raw.tags),
    createdAt: Date.now(),
    status: "visible",
    source,
    verifiedGameOver,
    ...(gameContext ? { gameContext } : {}),
    helpfulCount: 0,
    helpfulVoterIds: [],
    pinned: false,
    editTokenHash: hashEditToken(editToken),
  };

  entries.push(entry);
  sortEntries();
  pruneOverflow();
  persistToDisk();

  const stats = getFeedbackStats();
  return {
    ok: true,
    entry: cloneEntry(entry),
    editToken,
    summary: { count: stats.count, average: stats.average },
    stats,
  };
}

export function updateOwnFeedback(
  id: string,
  editToken: unknown,
  patch: unknown
):
  | {
      ok: true;
      entry: FeedbackEntry;
      summary: { count: number; average: number };
      stats: FeedbackStats;
    }
  | { ok: false; statusCode: number; error: string } {
  const token = typeof editToken === "string" ? editToken.trim() : "";
  if (!token) {
    return { ok: false, statusCode: 403, error: "缺少编辑凭证，无法修改" };
  }
  const entry = entries.find((item) => item.id === id);
  if (!entry || entry.status !== "visible") {
    return { ok: false, statusCode: 404, error: "评价不存在或已下线" };
  }
  if (!entry.editTokenHash || !verifyEditToken(token, entry.editTokenHash)) {
    return { ok: false, statusCode: 403, error: "编辑凭证无效，只能修改本机发布的评价" };
  }
  if (Date.now() - entry.createdAt > SELF_EDIT_WINDOW_MS) {
    return { ok: false, statusCode: 403, error: "已超过 7 天可修改期限" };
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return { ok: false, statusCode: 400, error: "参数格式有误" };
  }
  const raw = patch as Record<string, unknown>;
  const rating = raw.rating;
  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {
    return { ok: false, statusCode: 400, error: "评分必须为 1-5 的整数" };
  }

  entry.rating = rating;
  entry.content = sanitizeFeedbackContent(raw.content);
  entry.tags = normalizeTags(raw.tags);
  entry.updatedAt = Date.now();

  if (raw.clearGameContext === true) {
    delete entry.gameContext;
  } else if (entry.verifiedGameOver && raw.gameContext !== undefined) {
    const nextCtx = sanitizeGameContext(raw.gameContext);
    if (nextCtx) entry.gameContext = nextCtx;
    else delete entry.gameContext;
  }

  persistToDisk();

  const stats = getFeedbackStats();
  return {
    ok: true,
    entry: cloneEntry(entry),
    summary: { count: stats.count, average: stats.average },
    stats,
  };
}

export function toggleFeedbackHelpful(
  id: string,
  rawVoterId: unknown
):
  | { ok: true; helpfulCount: number; voted: boolean }
  | { ok: false; statusCode: number; error: string } {
  const voterId = sanitizeVoterId(rawVoterId);
  if (!voterId) {
    return { ok: false, statusCode: 400, error: "无效的投票标识" };
  }
  const entry = entries.find((item) => item.id === id);
  if (!entry || entry.status !== "visible") {
    return { ok: false, statusCode: 404, error: "评价不存在" };
  }
  const index = entry.helpfulVoterIds.indexOf(voterId);
  let voted = false;
  if (index >= 0) {
    entry.helpfulVoterIds.splice(index, 1);
    voted = false;
  } else {
    entry.helpfulVoterIds.push(voterId);
    voted = true;
  }
  entry.helpfulCount = entry.helpfulVoterIds.length;
  persistToDisk();
  return { ok: true, helpfulCount: entry.helpfulCount, voted };
}

function averageOf(list: FeedbackEntry[]): number {
  if (list.length === 0) return 0;
  const sum = list.reduce((total, entry) => total + entry.rating, 0);
  return Math.round((sum / list.length) * 10) / 10;
}

export function toPublicFeedbackEntry(
  entry: FeedbackEntry,
  viewerId?: string | null
): PublicFeedbackEntry {
  const cleanViewer = sanitizeVoterId(viewerId);
  return {
    id: entry.id,
    rating: entry.rating,
    content: entry.content,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
    source: entry.source,
    verifiedGameOver: entry.verifiedGameOver,
    ...(entry.gameContext ? { gameContext: cloneGameContext(entry.gameContext) } : {}),
    helpfulCount: entry.helpfulCount,
    ...(cleanViewer ? { viewerHasVoted: entry.helpfulVoterIds.includes(cleanViewer) } : {}),
    pinned: entry.pinned,
    ...(entry.officialReply ? { officialReply: cloneOfficialReply(entry.officialReply) } : {}),
  };
}

export function toAdminFeedbackEntry(entry: FeedbackEntry): AdminFeedbackEntry {
  return {
    id: entry.id,
    rating: entry.rating,
    content: entry.content,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
    status: entry.status,
    source: entry.source,
    ...(entry.hiddenAt != null ? { hiddenAt: entry.hiddenAt } : {}),
    verifiedGameOver: entry.verifiedGameOver,
    ...(entry.gameContext ? { gameContext: cloneGameContext(entry.gameContext) } : {}),
    helpfulCount: entry.helpfulCount,
    pinned: entry.pinned,
    ...(entry.pinnedAt != null ? { pinnedAt: entry.pinnedAt } : {}),
    ...(entry.officialReply ? { officialReply: cloneOfficialReply(entry.officialReply) } : {}),
  };
}

export function getFeedbackStats(): FeedbackStats {
  const visible = entries.filter((entry) => entry.status === "visible");
  const distribution: FeedbackDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const tagMap = new Map<string, number>();
  const now = Date.now();
  let positiveCount = 0;
  let verifiedCount = 0;
  let recent7dCount = 0;

  for (const entry of visible) {
    const r = entry.rating as 1 | 2 | 3 | 4 | 5;
    if (r >= 1 && r <= 5) distribution[r] += 1;
    if (entry.rating >= 4) positiveCount += 1;
    if (entry.verifiedGameOver) verifiedCount += 1;
    if (now - entry.createdAt <= 7 * DAY_MS) recent7dCount += 1;
    for (const tag of entry.tags) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
    }
  }

  const tagCounts = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));

  return {
    count: visible.length,
    average: averageOf(visible),
    positiveRate: visible.length > 0 ? Math.round((positiveCount / visible.length) * 100) : 0,
    distribution,
    tagCounts,
    verifiedCount,
    recent7dCount,
  };
}

export function getFeedbackSummary(): { count: number; average: number } {
  const visible = entries.filter((entry) => entry.status === "visible");
  return { count: visible.length, average: averageOf(visible) };
}

function featuredScore(entry: FeedbackEntry): number {
  return (
    entry.helpfulCount * 3 +
    (entry.content.length > 0 ? 4 : 0) +
    (entry.content.length >= 20 ? 2 : 0) +
    (entry.verifiedGameOver ? 2 : 0) +
    (entry.officialReply ? 1 : 0)
  );
}

function normalizeSort(raw: unknown): PublicFeedbackSort {
  if (raw === "newest" || raw === "highest" || raw === "lowest" || raw === "featured") {
    return raw;
  }
  return "featured";
}

function sortPublicEntries(list: FeedbackEntry[], sort: PublicFeedbackSort): FeedbackEntry[] {
  const copy = [...list];
  if (sort === "newest") {
    return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
  if (sort === "highest") {
    return copy.sort((a, b) => b.rating - a.rating || b.helpfulCount - a.helpfulCount || b.createdAt - a.createdAt);
  }
  if (sort === "lowest") {
    return copy.sort((a, b) => a.rating - b.rating || b.helpfulCount - a.helpfulCount || b.createdAt - a.createdAt);
  }
  // featured：置顶优先，其次互动与内容质量分，最后按时间倒序
  return copy.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const pa = a.pinnedAt ?? a.createdAt;
      const pb = b.pinnedAt ?? b.createdAt;
      if (pa !== pb) return pb - pa;
    }
    const diff = featuredScore(b) - featuredScore(a);
    if (diff !== 0) return diff;
    return b.createdAt - a.createdAt;
  });
}

export function listPublicFeedback(
  query: {
    offset?: unknown;
    limit?: unknown;
    sort?: unknown;
    rating?: unknown;
    tag?: unknown;
    withContent?: unknown;
    verifiedOnly?: unknown;
    voterId?: unknown;
  } = {}
): {
  items: PublicFeedbackEntry[];
  total: number;
  average: number;
  count: number;
  hasMore: boolean;
  stats: FeedbackStats;
} {
  const offset = normalizeOffset(query.offset);
  const limit = clampLimit(query.limit, PUBLIC_DEFAULT_LIMIT, 1, PUBLIC_MAX_LIMIT);
  const sort = normalizeSort(query.sort);
  const ratingFilter =
    typeof query.rating === "number" && Number.isInteger(query.rating) && query.rating >= 1 && query.rating <= 5
      ? query.rating
      : typeof query.rating === "string" && /^[1-5]$/.test(query.rating.trim())
        ? Number(query.rating.trim())
        : null;
  const tagFilter = typeof query.tag === "string" && query.tag.trim() ? query.tag.trim() : null;
  const withContent = query.withContent === true || query.withContent === "1" || query.withContent === "true";
  const verifiedOnly = query.verifiedOnly === true || query.verifiedOnly === "1" || query.verifiedOnly === "true";
  const viewerId = sanitizeVoterId(query.voterId);

  const visible = entries.filter((entry) => entry.status === "visible");
  const filtered = visible.filter((entry) => {
    if (ratingFilter !== null && entry.rating !== ratingFilter) return false;
    if (tagFilter !== null && !entry.tags.includes(tagFilter)) return false;
    if (withContent && entry.content.trim().length === 0) return false;
    if (verifiedOnly && !entry.verifiedGameOver) return false;
    return true;
  });

  const sorted = sortPublicEntries(filtered, sort);
  const total = sorted.length;
  const items = sorted
    .slice(offset, offset + limit)
    .map((entry) => toPublicFeedbackEntry(entry, viewerId));
  const stats = getFeedbackStats();

  return {
    items,
    total,
    average: stats.average,
    count: stats.count,
    hasMore: offset + items.length < total,
    stats,
  };
}

export type AdminFeedbackFilterQuery = {
  status: FeedbackStatus | "all";
  rating?: unknown;
  source?: unknown;
  tag?: unknown;
  q?: unknown;
  pinnedOnly?: unknown;
  offset?: unknown;
  limit?: unknown;
};

function filterAdminEntries(query: Omit<AdminFeedbackFilterQuery, "offset" | "limit">): FeedbackEntry[] {
  const status = query.status;
  const ratingFilter =
    typeof query.rating === "number" && Number.isInteger(query.rating) && query.rating >= 1 && query.rating <= 5
      ? query.rating
      : typeof query.rating === "string" && /^[1-5]$/.test(query.rating.trim())
        ? Number(query.rating.trim())
        : null;
  const sourceFilter =
    query.source === "lobby" || query.source === "game_over" || query.source === "unknown"
      ? query.source
      : null;
  const tagFilter = typeof query.tag === "string" && query.tag.trim() ? query.tag.trim() : null;
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
  const pinnedOnly = query.pinnedOnly === true || query.pinnedOnly === "1" || query.pinnedOnly === "true";

  return entries.filter((entry) => {
    if (status !== "all" && entry.status !== status) return false;
    if (pinnedOnly && !entry.pinned) return false;
    if (ratingFilter !== null && entry.rating !== ratingFilter) return false;
    if (sourceFilter !== null && entry.source !== sourceFilter) return false;
    if (tagFilter !== null && !entry.tags.includes(tagFilter)) return false;
    if (q) {
      const haystacks = [
        entry.content,
        ...entry.tags,
        entry.officialReply?.content ?? "",
        entry.gameContext?.modeLabel ?? "",
        entry.gameContext?.personaName ?? "",
      ];
      if (!haystacks.some((h) => h.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

export function listAdminFeedback(query: AdminFeedbackFilterQuery): {
  items: AdminFeedbackEntry[];
  total: number;
  hasMore: boolean;
  stats: FeedbackStats;
  statusCounts: { all: number; visible: number; hidden: number; pinned: number };
} {
  const offset = normalizeOffset(query.offset);
  const limit = clampLimit(query.limit, ADMIN_DEFAULT_LIMIT, 1, ADMIN_MAX_LIMIT);
  const filtered = filterAdminEntries(query);
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit).map(toAdminFeedbackEntry);

  let visibleCount = 0;
  let hiddenCount = 0;
  let pinnedCount = 0;
  for (const entry of entries) {
    if (entry.status === "visible") visibleCount += 1;
    else hiddenCount += 1;
    if (entry.pinned) pinnedCount += 1;
  }

  return {
    items,
    total,
    hasMore: offset + items.length < total,
    stats: getFeedbackStats(),
    statusCounts: {
      all: entries.length,
      visible: visibleCount,
      hidden: hiddenCount,
      pinned: pinnedCount,
    },
  };
}

export function getAdminFeedbackForExport(
  query: Omit<AdminFeedbackFilterQuery, "offset" | "limit">
): AdminFeedbackEntry[] {
  return filterAdminEntries(query).map(toAdminFeedbackEntry);
}

export function setFeedbackStatus(id: string, status: FeedbackStatus): boolean {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return false;
  if (status === "hidden") {
    entry.status = "hidden";
    entry.hiddenAt = Date.now();
  } else {
    entry.status = "visible";
    delete entry.hiddenAt;
  }
  persistToDisk();
  return true;
}

export function setFeedbackPinned(id: string, pinned: boolean): boolean {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return false;
  entry.pinned = pinned;
  if (pinned) {
    entry.pinnedAt = Date.now();
  } else {
    delete entry.pinnedAt;
  }
  persistToDisk();
  return true;
}

export function setFeedbackReply(
  id: string,
  rawContent: unknown
): { ok: true; officialReply?: FeedbackOfficialReply } | { ok: false } {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return { ok: false };
  const cleaned = sanitizeReplyContent(rawContent);
  if (!cleaned) {
    delete entry.officialReply;
    persistToDisk();
    return { ok: true };
  }
  const reply: FeedbackOfficialReply = {
    content: cleaned,
    updatedAt: Date.now(),
  };
  entry.officialReply = reply;
  persistToDisk();
  return { ok: true, officialReply: cloneOfficialReply(reply) };
}

export function deleteFeedback(id: string): boolean {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  entries.splice(index, 1);
  persistToDisk();
  return true;
}

/** 仅测试使用：清空内存态并解除持久化路径。 */
export function resetFeedbackStoreForTests(): void {
  entries = [];
  persistPath = null;
  persistDisabled = false;
}
