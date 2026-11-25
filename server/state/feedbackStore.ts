import fs from "fs";
import { writeJsonAtomic } from "../util/atomicJson.js";
import { maskForbiddenText, normalizeNoteInput } from "../logic/forbiddenText.js";

export type FeedbackStatus = "visible" | "hidden";
export type FeedbackSource = "lobby" | "game_over" | "unknown";

export type FeedbackEntry = {
  id: string;
  rating: number;
  content: string;
  tags: string[];
  createdAt: number;
  status: FeedbackStatus;
  source: FeedbackSource;
  hiddenAt?: number;
};

export type PublicFeedbackEntry = Pick<
  FeedbackEntry,
  "id" | "rating" | "content" | "tags" | "createdAt" | "source"
>;

export const FEEDBACK_TAGS = [
  "好玩",
  "规则清晰",
  "AI 陪玩",
  "适合开黑",
  "节奏偏慢",
  "需要改进",
] as const;

const TAG_SET = new Set<string>(FEEDBACK_TAGS);

export const FEEDBACK_CONTENT_MAX = 300;
export const FEEDBACK_MAX_ENTRIES = 5000;

const PUBLIC_DEFAULT_LIMIT = 20;
const PUBLIC_MAX_LIMIT = 50;
const ADMIN_DEFAULT_LIMIT = 50;
const ADMIN_MAX_LIMIT = 100;

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
  const entry: FeedbackEntry = {
    id: raw.id,
    rating: raw.rating,
    content: typeof raw.content === "string" ? raw.content : "",
    tags: normalizeTags(raw.tags),
    createdAt,
    status: raw.status === "hidden" ? "hidden" : "visible",
    source: normalizeSource(raw.source),
  };
  if (
    entry.status === "hidden" &&
    typeof raw.hiddenAt === "number" &&
    Number.isFinite(raw.hiddenAt)
  ) {
    entry.hiddenAt = raw.hiddenAt;
  }
  return entry;
}

function sortEntries(): void {
  entries.sort((a, b) => b.createdAt - a.createdAt);
}

function sanitizeFeedbackContent(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const capped = Array.from(normalizeNoteInput(raw))
    .slice(0, FEEDBACK_CONTENT_MAX)
    .join("");
  // 去掉控制字符后再打码；保留换行，最多留一个空行，避免评价挤成一行。
  const withoutControl = capped
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
  return maskForbiddenText(withoutControl).trim();
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
    // entries 已按时间倒序，从尾部向前找到最旧的隐藏条目。
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].status === "hidden") {
        victim = i;
        break;
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

export function addFeedback(
  input: unknown
):
  | { ok: true; entry: FeedbackEntry; summary: { count: number; average: number } }
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

  const entry: FeedbackEntry = {
    id: createId(),
    rating,
    content: sanitizeFeedbackContent(raw.content),
    tags: normalizeTags(raw.tags),
    createdAt: Date.now(),
    status: "visible",
    source: normalizeSource(raw.source),
  };

  entries.push(entry);
  sortEntries();
  pruneOverflow();
  persistToDisk();

  return {
    ok: true,
    entry: { ...entry, tags: [...entry.tags] },
    summary: getFeedbackSummary(),
  };
}

function averageOf(list: FeedbackEntry[]): number {
  if (list.length === 0) return 0;
  const sum = list.reduce((total, entry) => total + entry.rating, 0);
  return Math.round((sum / list.length) * 10) / 10;
}

export function toPublicFeedbackEntry(entry: FeedbackEntry): PublicFeedbackEntry {
  return {
    id: entry.id,
    rating: entry.rating,
    content: entry.content,
    tags: [...entry.tags],
    createdAt: entry.createdAt,
    source: entry.source,
  };
}

export function getFeedbackSummary(): { count: number; average: number } {
  const visible = entries.filter((entry) => entry.status === "visible");
  return { count: visible.length, average: averageOf(visible) };
}

export function listPublicFeedback(
  query: { offset?: unknown; limit?: unknown } = {}
): {
  items: PublicFeedbackEntry[];
  total: number;
  average: number;
  count: number;
  hasMore: boolean;
} {
  const offset = normalizeOffset(query.offset);
  const limit = clampLimit(query.limit, PUBLIC_DEFAULT_LIMIT, 1, PUBLIC_MAX_LIMIT);
  const visible = entries.filter((entry) => entry.status === "visible");
  const total = visible.length;
  const items = visible.slice(offset, offset + limit).map(toPublicFeedbackEntry);
  return {
    items,
    total,
    average: averageOf(visible),
    count: total,
    hasMore: offset + items.length < total,
  };
}

export function listAdminFeedback(query: {
  status: FeedbackStatus | "all";
  offset?: unknown;
  limit?: unknown;
}): { items: FeedbackEntry[]; total: number; hasMore: boolean } {
  const offset = normalizeOffset(query.offset);
  const limit = clampLimit(query.limit, ADMIN_DEFAULT_LIMIT, 1, ADMIN_MAX_LIMIT);
  const status = query.status;
  const filtered =
    status === "all" ? entries : entries.filter((entry) => entry.status === status);
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit).map((entry) => ({
    ...entry,
    tags: [...entry.tags],
  }));
  return { items, total, hasMore: offset + items.length < total };
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
