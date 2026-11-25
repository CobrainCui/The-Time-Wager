import { useCallback, useEffect, useRef, useState } from "react";
import { adminApiUrl, adminAuthHeaders } from "./adminFetch";
import "./AdminFeedback.css";

interface Props {
  onBack: () => void;
}

type FeedbackFilter = "all" | "visible" | "hidden";
type FeedbackStatus = "visible" | "hidden";

interface FeedbackItem {
  id: string | number;
  rating: number;
  content: string;
  tags?: unknown;
  createdAt: number | string;
  status: FeedbackStatus;
  source?: string | null;
  hiddenAt?: number | string | null;
}

interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 50;

const FILTERS: Array<{ value: FeedbackFilter; label: string; empty: string }> = [
  { value: "all", label: "全部", empty: "暂无玩家评价" },
  { value: "visible", label: "公开中", empty: "暂无公开中的评价" },
  { value: "hidden", label: "已隐藏", empty: "暂无已隐藏的评价" },
];

const SOURCE_LABELS: Record<string, string> = {
  lobby: "首页",
  game_over: "对局结束",
  unknown: "未知",
};

function toTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 兼容秒级时间戳
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatDateTime(value: number | string | null | undefined): string {
  const ts = toTimestamp(value);
  if (ts === null) return "—";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeRating(rating: number): number {
  const n = Math.round(Number(rating));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function starText(rating: number): string {
  const n = normalizeRating(rating);
  return n > 0 ? "⭐".repeat(n) : "—";
}

function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
  }
  if (typeof tags === "string" && tags.trim()) {
    try {
      const parsed = JSON.parse(tags);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {
      return tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function sourceLabel(source: string | null | undefined): string {
  if (!source) return SOURCE_LABELS.unknown;
  return SOURCE_LABELS[source] ?? SOURCE_LABELS.unknown;
}

export default function AdminFeedback({ onBack }: Props) {
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const reqSeqRef = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const seq = ++reqSeqRef.current;
      setError(null);
      if (offset === 0) setInitialLoading(true);
      else setLoadingMore(true);

      try {
        const params = new URLSearchParams({
          status: filter,
          offset: String(offset),
          limit: String(PAGE_SIZE),
        });
        const res = await fetch(adminApiUrl(`/api/admin/feedback?${params.toString()}`), {
          headers: adminAuthHeaders(),
        });
        if (seq !== reqSeqRef.current) return;

        if (res.status === 401) {
          setAuthExpired(true);
          setError("登录已失效，请重新登录");
          setItems([]);
          setTotal(0);
          setHasMore(false);
          return;
        }
        setAuthExpired(false);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (seq !== reqSeqRef.current) return;
          setError((body as { error?: string }).error ?? "加载失败，请稍后重试");
          return;
        }

        const data = (await res.json()) as FeedbackListResponse;
        if (seq !== reqSeqRef.current) return;
        const incoming = Array.isArray(data?.items) ? data.items : [];
        setItems((prev) => (offset === 0 ? incoming : [...prev, ...incoming]));
        setTotal(typeof data?.total === "number" ? data.total : incoming.length);
        setHasMore(Boolean(data?.hasMore));
      } catch {
        if (seq === reqSeqRef.current) setError("网络错误，请稍后重试");
      } finally {
        if (seq === reqSeqRef.current) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter],
  );

  useEffect(() => {
    // 放到下一拍再拉取，避免在 effect 内同步 setState。
    const timer = window.setTimeout(() => {
      void load(0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleFilterChange = (next: FeedbackFilter) => {
    if (next === filter) return;
    setFilter(next);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setError(null);
    setAuthExpired(false);
    setInitialLoading(true);
  };

  const handleStatus = async (item: FeedbackItem, next: FeedbackStatus) => {
    const key = String(item.id);
    if (busyId) return;
    setBusyId(key);
    try {
      const res = await fetch(adminApiUrl(`/api/admin/feedback/${encodeURIComponent(key)}/status`), {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status: next }),
      });
      if (res.status === 401) {
        setAuthExpired(true);
        setError("登录已失效，请重新登录");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "操作失败，请稍后重试");
        return;
      }

      // 当前筛选不再匹配新状态时，从列表移除并同步计数
      const removed = filter !== "all" && filter !== next;
      setItems((prev) =>
        removed
          ? prev.filter((it) => String(it.id) !== key)
          : prev.map((it) => (String(it.id) === key ? { ...it, status: next } : it)),
      );
      if (removed) setTotal((t) => Math.max(0, t - 1));
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item: FeedbackItem) => {
    if (!window.confirm("确定删除这条玩家评价？\n\n删除后不可恢复。")) return;
    const key = String(item.id);
    if (busyId) return;
    setBusyId(key);
    try {
      const res = await fetch(adminApiUrl(`/api/admin/feedback/${encodeURIComponent(key)}`), {
        method: "DELETE",
        headers: adminAuthHeaders(),
      });
      if (res.status === 401) {
        setAuthExpired(true);
        setError("登录已失效，请重新登录");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "删除失败，请稍后重试");
        return;
      }
      setItems((prev) => prev.filter((it) => String(it.id) !== key));
      setTotal((t) => Math.max(0, t - 1));
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setBusyId(null);
    }
  };

  const emptyText = FILTERS.find((f) => f.value === filter)?.empty ?? "暂无玩家评价";

  return (
    <div className="admin-feedback-page">
      <header className="admin-feedback-header">
        <div className="admin-feedback-heading">
          <button type="button" className="btn btn-ghost btn-sm admin-feedback-back" onClick={onBack}>
            ← 返回控制台
          </button>
          <h1 className="admin-feedback-title">玩家评价</h1>
          <p className="admin-feedback-count">共 {total} 条</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => void load(0)}
          disabled={initialLoading}
        >
          刷新
        </button>
      </header>

      <div className="admin-feedback-toolbar" role="group" aria-label="评价筛选">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`btn btn-sm ${filter === f.value ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={filter === f.value}
            onClick={() => handleFilterChange(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className={`admin-feedback-error${authExpired ? " admin-feedback-error-auth" : ""}`} role="alert">
          {error}
        </p>
      )}

      {initialLoading ? (
        <p className="admin-feedback-state">加载中…</p>
      ) : authExpired ? null : items.length === 0 ? (
        <p className="admin-feedback-state">{emptyText}</p>
      ) : (
        <>
          <ul className="admin-feedback-list">
            {items.map((item) => {
              const key = String(item.id);
              const hidden = item.status === "hidden";
              const busy = busyId === key;
              const tags = normalizeTags(item.tags);
              const rating = normalizeRating(item.rating);
              return (
                <li key={key} className="admin-feedback-card">
                  <div className="admin-feedback-meta">
                    <span className="admin-feedback-stars" aria-label={`${rating} 星`}>
                      {starText(item.rating)}
                    </span>
                    <span
                      className={`admin-feedback-badge ${hidden ? "is-hidden" : "is-visible"}`}
                    >
                      {hidden ? "已隐藏" : "公开中"}
                    </span>
                    <span className="admin-feedback-source">{sourceLabel(item.source)}</span>
                    <time className="admin-feedback-time">{formatDateTime(item.createdAt)}</time>
                  </div>

                  {tags.length > 0 && (
                    <div className="admin-feedback-tags">
                      {tags.map((tag, index) => (
                        <span key={`${tag}-${index}`} className="admin-feedback-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="admin-feedback-content">{item.content || "（无内容）"}</p>

                  <div className="admin-feedback-actions">
                    {hidden ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busy}
                        onClick={() => void handleStatus(item, "visible")}
                      >
                        {busy ? "处理中…" : "恢复"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => void handleStatus(item, "hidden")}
                      >
                        {busy ? "处理中…" : "隐藏"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm admin-feedback-delete"
                      disabled={busy}
                      onClick={() => void handleDelete(item)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <div className="admin-feedback-more">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={loadingMore}
                onClick={() => void load(items.length)}
              >
                {loadingMore ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
