import fs from "fs";
import { writeJsonAtomic } from "../util/atomicJson.js";
import { maskForbiddenText } from "../logic/forbiddenText.js";

export const ISSUE_CATEGORIES = [
  "规则没看懂",
  "界面/操作问题",
  "AI 表现异常",
  "卡顿/掉线",
  "玩法建议",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export type IssueStatus = "open" | "resolved";

const CATEGORY_SET = new Set<string>(ISSUE_CATEGORIES);

const VALID_PHASES = new Set<string>([
  "ROOM_WAITING",
  "ERA_INTRO",
  "TUTORIAL",
  "BUFF_USAGE",
  "INVESTMENT",
  "SETTLEMENT",
  "AUCTION",
  "COMMUNITY_NAMING",
  "GAME_OVER",
]);

export const ISSUE_CONTENT_MIN = 2;
export const ISSUE_CONTENT_MAX = 600;
export const ISSUE_ADMIN_NOTE_MAX = 300;
export const ISSUE_MAX_ENTRIES = 5000;

const ADMIN_DEFAULT_LIMIT = 50;
const ADMIN_MAX_LIMIT = 100;

export type IssueContext = {
  roomId?: string;
  phase?: string;
  era?: number;
  round?: number;
  humanCount?: number;
  aiCount?: number;
  deviceType?: "mobile" | "tablet" | "desktop";
  viewport?: string;
};

export type IssueFeedbackEntry = {
  id: string;
  category: IssueCategory;
  content: string;
  context: IssueContext;
  status: IssueStatus;
  createdAt: number;
  resolvedAt?: number;
  adminNote?: string;
};

type IssueFile = { entries: IssueFeedbackEntry[] };

let persistPath: string | null = null;
let persistDisabled = false;
let entries: IssueFeedbackEntry[] = [];

export function initIssueFeedbackPersistence(filePath: string): void {
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
    const parsed = JSON.parse(raw) as Partial<IssueFile> | null;
    if (!parsed || !Array.isArray(parsed.entries)) {
      persistDisabled = true;
      console.error("Issue feedback store parse: missing entries array; refusing further writes");
      return;
    }
    entries = parsed.entries
      .map(normalizeLoadedEntry)
      .filter((entry): entry is IssueFeedbackEntry => entry != null);
  } catch (err) {
    persistDisabled = true;
    console.error("Failed to load issue feedback store; refusing further writes:", err);
  }
}

function sanitizeContent(raw: unknown, maxLen: number, mask: boolean): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  const capped = Array.from(trimmed).slice(0, maxLen).join("");
  const withoutControl = capped
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, "")
    .replace(/\n{3,}/g, "\n\n");
  const finalText = mask ? maskForbiddenText(withoutControl) : withoutControl;
  return finalText.trim();
}

function sanitizeContext(raw: unknown): IssueContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: IssueContext = {};

  if (typeof obj.roomId === "string") {
    const code = obj.roomId.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 8);
    if (code) out.roomId = code;
  }
  if (typeof obj.phase === "string" && VALID_PHASES.has(obj.phase.trim())) {
    out.phase = obj.phase.trim();
  }
  if (typeof obj.era === "number" && Number.isInteger(obj.era) && obj.era >= 0 && obj.era <= 10) {
    out.era = obj.era;
  }
  if (typeof obj.round === "number" && Number.isInteger(obj.round) && obj.round >= 0 && obj.round <= 30) {
    out.round = obj.round;
  }
  if (
    typeof obj.humanCount === "number" &&
    Number.isInteger(obj.humanCount) &&
    obj.humanCount >= 0 &&
    obj.humanCount <= 6
  ) {
    out.humanCount = obj.humanCount;
  }
  if (
    typeof obj.aiCount === "number" &&
    Number.isInteger(obj.aiCount) &&
    obj.aiCount >= 0 &&
    obj.aiCount <= 6
  ) {
    out.aiCount = obj.aiCount;
  }
  if (obj.deviceType === "mobile" || obj.deviceType === "tablet" || obj.deviceType === "desktop") {
    out.deviceType = obj.deviceType;
  }
  if (typeof obj.viewport === "string") {
    const m = /^(\d{2,5})x(\d{2,5})$/.exec(obj.viewport.trim());
    if (m) out.viewport = `${m[1]}x${m[2]}`;
  }

  return out;
}

function normalizeLoadedEntry(value: unknown): IssueFeedbackEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.category !== "string" || !CATEGORY_SET.has(raw.category)) return null;
  const content = sanitizeContent(raw.content, ISSUE_CONTENT_MAX, true);
  if (!content) return null;

  const createdAt =
    typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : 0;
  const status: IssueStatus = raw.status === "resolved" ? "resolved" : "open";

  const entry: IssueFeedbackEntry = {
    id: raw.id,
    category: raw.category as IssueCategory,
    content,
    context: sanitizeContext(raw.context),
    status,
    createdAt,
  };
  if (status === "resolved" && typeof raw.resolvedAt === "number" && Number.isFinite(raw.resolvedAt)) {
    entry.resolvedAt = raw.resolvedAt;
  }
  if (typeof raw.adminNote === "string") {
    const note = sanitizeContent(raw.adminNote, ISSUE_ADMIN_NOTE_MAX, false);
    if (note) entry.adminNote = note;
  }
  return entry;
}

function sortEntries(): void {
  entries.sort((a, b) => b.createdAt - a.createdAt);
}

function createId(): string {
  let id = "";
  do {
    const random = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    id = `iss_${Date.now().toString(36)}_${random}`;
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
  while (entries.length > ISSUE_MAX_ENTRIES) {
    let victim = -1;
    // 优先淘汰最旧的已处理反馈
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].status === "resolved") {
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
    console.error("Failed to persist issue feedback store:", err);
  }
}

function cloneEntry(entry: IssueFeedbackEntry): IssueFeedbackEntry {
  return {
    ...entry,
    context: { ...entry.context },
  };
}

export function addIssueFeedback(
  input: unknown
): { ok: true; entry: IssueFeedbackEntry } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "参数格式有误" };
  }
  const raw = input as Record<string, unknown>;
  const category = typeof raw.category === "string" ? raw.category.trim() : "";
  if (!CATEGORY_SET.has(category)) {
    return { ok: false, error: "请选择一个问题分类" };
  }

  const content = sanitizeContent(raw.content, ISSUE_CONTENT_MAX, true);
  if (Array.from(content).length < ISSUE_CONTENT_MIN) {
    return { ok: false, error: "请简短描述遇到的问题或建议（至少 2 个字）" };
  }

  const entry: IssueFeedbackEntry = {
    id: createId(),
    category: category as IssueCategory,
    content,
    context: sanitizeContext(raw.context),
    status: "open",
    createdAt: Date.now(),
  };

  entries.push(entry);
  sortEntries();
  pruneOverflow();
  persistToDisk();

  return { ok: true, entry: cloneEntry(entry) };
}

export function getIssueCounts(): { all: number; open: number; resolved: number } {
  let open = 0;
  let resolved = 0;
  for (const entry of entries) {
    if (entry.status === "open") open += 1;
    else resolved += 1;
  }
  return { all: entries.length, open, resolved };
}

export type AdminIssueFilterQuery = {
  status: IssueStatus | "all";
  category?: unknown;
  q?: unknown;
  offset?: unknown;
  limit?: unknown;
};

function filterIssues(query: Omit<AdminIssueFilterQuery, "offset" | "limit">): IssueFeedbackEntry[] {
  const categoryFilter =
    typeof query.category === "string" && CATEGORY_SET.has(query.category.trim())
      ? query.category.trim()
      : null;
  const q = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";

  return entries.filter((entry) => {
    if (query.status !== "all" && entry.status !== query.status) return false;
    if (categoryFilter && entry.category !== categoryFilter) return false;
    if (q) {
      const haystacks = [
        entry.content,
        entry.category,
        entry.adminNote ?? "",
        entry.context.roomId ?? "",
        entry.context.phase ?? "",
      ];
      if (!haystacks.some((h) => h.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

export function listAdminIssues(query: AdminIssueFilterQuery): {
  items: IssueFeedbackEntry[];
  total: number;
  hasMore: boolean;
  counts: { all: number; open: number; resolved: number };
} {
  const offset = normalizeOffset(query.offset);
  const limit = clampLimit(query.limit, ADMIN_DEFAULT_LIMIT, 1, ADMIN_MAX_LIMIT);
  const filtered = filterIssues(query);
  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit).map(cloneEntry);
  return {
    items,
    total,
    hasMore: offset + items.length < total,
    counts: getIssueCounts(),
  };
}

export function getAdminIssuesForExport(
  query: Omit<AdminIssueFilterQuery, "offset" | "limit">
): IssueFeedbackEntry[] {
  return filterIssues(query).map(cloneEntry);
}

export function setIssueStatus(
  id: string,
  status: IssueStatus,
  rawAdminNote?: unknown
): { ok: true; entry: IssueFeedbackEntry } | { ok: false } {
  const entry = entries.find((item) => item.id === id);
  if (!entry) return { ok: false };

  entry.status = status;
  if (status === "resolved") {
    entry.resolvedAt = Date.now();
  } else {
    delete entry.resolvedAt;
  }

  if (rawAdminNote !== undefined) {
    const cleaned = sanitizeContent(rawAdminNote, ISSUE_ADMIN_NOTE_MAX, false);
    if (cleaned) entry.adminNote = cleaned;
    else delete entry.adminNote;
  }

  persistToDisk();
  return { ok: true, entry: cloneEntry(entry) };
}

export function deleteIssueFeedback(id: string): boolean {
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  entries.splice(index, 1);
  persistToDisk();
  return true;
}

/** 仅测试使用：清空内存态并解除持久化路径。 */
export function resetIssueFeedbackStoreForTests(): void {
  entries = [];
  persistPath = null;
  persistDisabled = false;
}
