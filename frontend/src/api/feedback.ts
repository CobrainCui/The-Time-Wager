import { BACKEND_URL } from "../socket";

/** 固定标签白名单（与后端保持一致） */
export const FEEDBACK_TAGS = [
  "好玩",
  "规则清晰",
  "AI 陪玩",
  "适合开黑",
  "节奏偏慢",
  "需要改进",
] as const;

export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export type FeedbackSource = "lobby" | "game_over";

export interface FeedbackItem {
  id: string | number;
  rating: number;
  content: string;
  tags: string[];
  createdAt: number | string;
  source: FeedbackSource;
}

export interface FeedbackSummary {
  count: number;
  average: number;
}

export interface FeedbackPage extends FeedbackSummary {
  items: FeedbackItem[];
  total: number;
  hasMore: boolean;
}

export interface SubmitFeedbackInput {
  rating: number;
  content: string;
  tags: string[];
  source: FeedbackSource;
}

export interface SubmitFeedbackResult {
  item: FeedbackItem;
  summary: FeedbackSummary;
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
  if (res.status === 409) return new Error("你刚刚已经提交过评价了，请稍后再试");
  if (res.status === 429) return new Error("提交太频繁，请稍后再试");
  return new Error(`玩家评价请求失败（${res.status}）`);
}

export async function fetchFeedback(
  offset = 0,
  limit = 20
): Promise<FeedbackPage> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
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
