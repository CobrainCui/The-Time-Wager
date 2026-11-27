import { BACKEND_URL } from "../socket";

/** 正向评价标签 */
export const FEEDBACK_POSITIVE_TAGS = [
  "好玩上头",
  "策略有深度",
  "适合开黑",
  "AI 很聪明",
  "人格报告准",
  "规则易上手",
] as const;

/** 建议改进标签 */
export const FEEDBACK_CONSTRUCTIVE_TAGS = [
  "节奏偏慢",
  "新手易迷糊",
  "AI 有待加强",
  "界面待优化",
  "期待新玩法",
] as const;

/** 全部可选标签 */
export const FEEDBACK_TAGS = [
  ...FEEDBACK_POSITIVE_TAGS,
  ...FEEDBACK_CONSTRUCTIVE_TAGS,
] as const;

/** 兼容历史展示的旧标签 */
export const FEEDBACK_LEGACY_TAGS = [
  "好玩",
  "规则清晰",
  "AI 陪玩",
  "需要改进",
] as const;

export const ALL_DISPLAYABLE_TAGS = new Set<string>([
  ...FEEDBACK_TAGS,
  ...FEEDBACK_LEGACY_TAGS,
]);

export const FEEDBACK_CONTENT_MAX = 500;

export const ISSUE_CATEGORIES = [
  "规则没看懂",
  "界面/操作问题",
  "AI 表现异常",
  "卡顿/掉线",
  "玩法建议",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
export const ISSUE_CONTENT_MAX = 600;

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export type FeedbackSource = "lobby" | "game_over" | "unknown";
export type PublicFeedbackSort = "featured" | "newest" | "highest" | "lowest";

export interface FeedbackGameContext {
  modeLabel?: string;
  humanCount?: number;
  aiCount?: number;
  personaName?: string;
}

export interface FeedbackOfficialReply {
  content: string;
  updatedAt: number;
}

export interface FeedbackItem {
  id: string | number;
  rating: number;
  content: string;
  tags: string[];
  createdAt: number | string;
  updatedAt?: number;
  source: FeedbackSource;
  verifiedGameOver?: boolean;
  gameContext?: FeedbackGameContext;
  helpfulCount?: number;
  viewerHasVoted?: boolean;
  pinned?: boolean;
  officialReply?: FeedbackOfficialReply;
}

export interface FeedbackDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface FeedbackStats {
  count: number;
  average: number;
  positiveRate: number;
  distribution: FeedbackDistribution;
  tagCounts: Array<{ tag: string; count: number }>;
  verifiedCount: number;
  recent7dCount: number;
}

export interface FeedbackSummary {
  count: number;
  average: number;
}

export interface FeedbackPage extends FeedbackSummary {
  items: FeedbackItem[];
  total: number;
  hasMore: boolean;
  stats?: FeedbackStats;
}

export interface FetchFeedbackQuery {
  offset?: number;
  limit?: number;
  sort?: PublicFeedbackSort;
  rating?: number | null;
  tag?: string | null;
  withContent?: boolean;
  verifiedOnly?: boolean;
}

export interface SubmitFeedbackInput {
  rating: number;
  content: string;
  tags: string[];
  source: FeedbackSource;
  gameContext?: FeedbackGameContext;
}

export interface SubmitFeedbackResult {
  item: FeedbackItem;
  summary: FeedbackSummary;
  stats?: FeedbackStats;
  editToken?: string;
}

export interface UpdateFeedbackInput {
  editToken: string;
  rating: number;
  content: string;
  tags: string[];
  gameContext?: FeedbackGameContext;
  clearGameContext?: boolean;
}

export interface UpdateFeedbackResult {
  item: FeedbackItem;
  summary: FeedbackSummary;
  stats?: FeedbackStats;
}

export interface IssueContext {
  roomId?: string;
  phase?: string;
  era?: number;
  round?: number;
  humanCount?: number;
  aiCount?: number;
  deviceType?: "mobile" | "tablet" | "desktop";
  viewport?: string;
}

export interface SubmitIssueInput {
  category: IssueCategory;
  content: string;
  context: IssueContext;
}

const CLIENT_ID_KEY = "gydd_feedback_client_id";
const OWNED_REVIEWS_KEY = "gydd_feedback_owned_v1";
const SELF_EDIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface OwnedReviewRecord {
  id: string;
  editToken: string;
  createdAt: number;
  sessionKey?: string;
}

export function getFeedbackClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && /^[a-zA-Z0-9_.:-]{6,80}$/.test(existing)) {
      return existing;
    }
    const created = `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return "";
  }
}

function readOwnedReviews(): OwnedReviewRecord[] {
  try {
    const raw = localStorage.getItem(OWNED_REVIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (item): item is OwnedReviewRecord =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.editToken === "string" &&
        typeof item.createdAt === "number" &&
        now - item.createdAt <= SELF_EDIT_WINDOW_MS
    );
  } catch {
    return [];
  }
}

function writeOwnedReviews(list: OwnedReviewRecord[]): void {
  try {
    localStorage.setItem(OWNED_REVIEWS_KEY, JSON.stringify(list.slice(-30)));
  } catch {
    /* ignore quota/private mode errors */
  }
}

export function saveOwnedReview(id: string | number, editToken: string | undefined, sessionKey?: string): void {
  if (!editToken) return;
  const keyId = String(id);
  const current = readOwnedReviews().filter((item) => item.id !== keyId);
  current.push({
    id: keyId,
    editToken,
    createdAt: Date.now(),
    ...(sessionKey ? { sessionKey } : {}),
  });
  writeOwnedReviews(current);
}

export function getOwnedReviewToken(id: string | number): string | null {
  const keyId = String(id);
  return readOwnedReviews().find((item) => item.id === keyId)?.editToken ?? null;
}

export function getOwnedReviewForSession(sessionKey: string | undefined): { id: string; editToken: string } | null {
  if (!sessionKey) return null;
  const found = readOwnedReviews().find((item) => item.sessionKey === sessionKey);
  return found ? { id: found.id, editToken: found.editToken } : null;
}

function feedbackApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BACKEND_URL}${p}`;
}

async function feedbackError(res: Response): Promise<Error> {
  let detail = "";
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === "string") detail = data.error.trim();
  } catch {
    /* 非 JSON 响应，使用兜底文案 */
  }
  if (detail) return new Error(detail);
  if (res.status === 409) return new Error("你刚刚已经提交过了，请稍后再试");
  if (res.status === 429) return new Error("提交太频繁，请稍后再试");
  return new Error(`请求失败（${res.status}）`);
}

export async function fetchFeedback(
  query: FetchFeedbackQuery = {}
): Promise<FeedbackPage> {
  const params = new URLSearchParams({
    offset: String(query.offset ?? 0),
    limit: String(query.limit ?? 20),
    sort: query.sort ?? "featured",
  });
  if (query.rating != null && query.rating >= 1 && query.rating <= 5) {
    params.set("rating", String(query.rating));
  }
  if (query.tag) {
    params.set("tag", query.tag);
  }
  if (query.withContent) {
    params.set("withContent", "1");
  }
  if (query.verifiedOnly) {
    params.set("verifiedOnly", "1");
  }
  const clientId = getFeedbackClientId();
  if (clientId) {
    params.set("voterId", clientId);
  }

  let res: Response;
  try {
    res = await fetch(feedbackApiUrl(`/api/feedback?${params.toString()}`), {
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new Error("网络连接失败，请稍后重试");
  }
  if (!res.ok) throw await feedbackError(res);

  const data = (await res.json()) as Partial<FeedbackPage>;
  const items = Array.isArray(data.items) ? data.items : [];
  const count =
    typeof data.count === "number"
      ? data.count
      : typeof data.total === "number"
        ? data.total
        : items.length;
  return {
    items,
    total: typeof data.total === "number" ? data.total : count,
    count,
    average: typeof data.average === "number" ? data.average : 0,
    hasMore: Boolean(data.hasMore),
    stats: data.stats,
  };
}

export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<SubmitFeedbackResult> {
  let res: Response;
  try {
    res = await fetch(feedbackApiUrl("/api/feedback"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("网络连接失败，请稍后重试");
  }
  if (!res.ok) throw await feedbackError(res);
  return (await res.json()) as SubmitFeedbackResult;
}

export async function updateOwnFeedback(
  id: string | number,
  input: UpdateFeedbackInput
): Promise<UpdateFeedbackResult> {
  let res: Response;
  try {
    res = await fetch(feedbackApiUrl(`/api/feedback/${encodeURIComponent(String(id))}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("网络连接失败，请稍后重试");
  }
  if (!res.ok) throw await feedbackError(res);
  return (await res.json()) as UpdateFeedbackResult;
}

export async function toggleFeedbackHelpful(
  id: string | number
): Promise<{ helpfulCount: number; voted: boolean }> {
  const voterId = getFeedbackClientId();
  let res: Response;
  try {
    res = await fetch(feedbackApiUrl(`/api/feedback/${encodeURIComponent(String(id))}/helpful`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ voterId }),
    });
  } catch {
    throw new Error("网络连接失败，请稍后重试");
  }
  if (!res.ok) throw await feedbackError(res);
  return (await res.json()) as { helpfulCount: number; voted: boolean };
}

export async function submitIssueFeedback(
  input: SubmitIssueInput
): Promise<{ ok: true; id: string }> {
  let res: Response;
  try {
    res = await fetch(feedbackApiUrl("/api/issue-feedback"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("网络连接失败，请稍后重试");
  }
  if (!res.ok) throw await feedbackError(res);
  return (await res.json()) as { ok: true; id: string };
}
