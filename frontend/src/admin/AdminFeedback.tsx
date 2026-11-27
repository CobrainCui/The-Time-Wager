import { useCallback, useEffect, useRef, useState } from "react";
import { adminApiUrl, adminAuthHeaders } from "./adminFetch";
import "./AdminFeedback.css";

interface Props {
  onBack: () => void;
}

type AdminSection = "reviews" | "issues";
type FeedbackFilter = "all" | "visible" | "hidden" | "pinned";
type FeedbackStatus = "visible" | "hidden";
type IssueFilter = "all" | "open" | "resolved";
type IssueStatus = "open" | "resolved";

interface FeedbackGameContext {
  modeLabel?: string;
  humanCount?: number;
  aiCount?: number;
  personaName?: string;
}

interface OfficialReply {
  content: string;
  updatedAt: number;
}

interface FeedbackItem {
  id: string | number;
  rating: number;
  content: string;
  tags?: unknown;
  createdAt: number | string;
  updatedAt?: number;
  status: FeedbackStatus;
  source?: string | null;
  hiddenAt?: number | string | null;
  verifiedGameOver?: boolean;
  gameContext?: FeedbackGameContext;
  helpfulCount?: number;
  pinned?: boolean;
  officialReply?: OfficialReply;
}

interface FeedbackStats {
  count: number;
  average: number;
  positiveRate: number;
  verifiedCount: number;
  recent7dCount: number;
  tagCounts: Array<{ tag: string; count: number }>;
}

interface FeedbackListResponse {
  items: FeedbackItem[];
  total: number;
  hasMore: boolean;
  stats?: FeedbackStats;
  statusCounts?: { all: number; visible: number; hidden: number; pinned: number };
  openIssueCount?: number;
}

interface IssueItem {
  id: string;
  category: string;
  content: string;
  context?: {
    roomId?: string;
    phase?: string;
    era?: number;
    round?: number;
    humanCount?: number;
    aiCount?: number;
    deviceType?: string;
    viewport?: string;
  };
  status: IssueStatus;
  createdAt: number;
  resolvedAt?: number;
  adminNote?: string;
}

interface IssueListResponse {
  items: IssueItem[];
  total: number;
  hasMore: boolean;
  counts?: { all: number; open: number; resolved: number };
}

const PAGE_SIZE = 50;

const REVIEW_FILTERS: Array<{ value: FeedbackFilter; label: string; empty: string }> = [
  { value: "all", label: "全部", empty: "暂无玩家评价" },
  { value: "visible", label: "公开中", empty: "暂无公开中的评价" },
  { value: "hidden", label: "已隐藏", empty: "暂无已隐藏的评价" },
  { value: "pinned", label: "精选置顶", empty: "暂无置顶评价" },
];

const ISSUE_FILTERS: Array<{ value: IssueFilter; label: string; empty: string }> = [
  { value: "all", label: "全部", empty: "暂无局中反馈" },
  { value: "open", label: "待处理", empty: "暂无待处理的问题反馈" },
  { value: "resolved", label: "已处理", empty: "暂无已处理的问题反馈" },
];

const ISSUE_CATEGORIES = [
  "规则没看懂",
  "界面/操作问题",
  "AI 表现异常",
  "卡顿/掉线",
  "玩法建议",
];

const SOURCE_LABELS: Record<string, string> = {
  lobby: "首页",
  game_over: "对局结束",
  unknown: "未知",
};

const PHASE_LABELS: Record<string, string> = {
  ROOM_WAITING: "等待开局",
  ERA_INTRO: "时代介绍",
  TUTORIAL: "新手教程",
  BUFF_USAGE: "使用道具",
  INVESTMENT: "投资阶段",
  SETTLEMENT: "本轮结算",
  AUCTION: "拍卖阶段",
  COMMUNITY_NAMING: "社区命名",
  GAME_OVER: "对局结束",
};

const DEVICE_LABELS: Record<string, string> = {
  mobile: "手机",
  tablet: "平板",
  desktop: "电脑",
};

function toTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
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
    return tags
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
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

async function downloadAdminExcel(urlPath: string, fallbackName: string): Promise<void> {
  const res = await fetch(adminApiUrl(urlPath), {
    headers: adminAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "导出失败，请稍后重试");
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminFeedback({ onBack }: Props) {
  const [section, setSection] = useState<AdminSection>("reviews");
  const [authExpired, setAuthExpired] = useState(false);

  // --- 公开评价态 ---
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [ratingFilter, setRatingFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewSearchDebounced, setReviewSearchDebounced] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [statusCounts, setStatusCounts] = useState<{
    all: number;
    visible: number;
    hidden: number;
    pinned: number;
  } | null>(null);
  const [openIssueCount, setOpenIssueCount] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingReviews, setExportingReviews] = useState(false);

  // 官方回复内联编辑器
  const [replyTargetId, setReplyTargetId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  // --- 局中问题反馈态 ---
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [issueCategoryFilter, setIssueCategoryFilter] = useState<string>("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [issueSearchDebounced, setIssueSearchDebounced] = useState("");
  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [issueHasMore, setIssueHasMore] = useState(false);
  const [issueCounts, setIssueCounts] = useState<{ all: number; open: number; resolved: number } | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesLoadingMore, setIssuesLoadingMore] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueBusyId, setIssueBusyId] = useState<string | null>(null);
  const [resolveNoteId, setResolveNoteId] = useState<string | null>(null);
  const [resolveNoteDraft, setResolveNoteDraft] = useState("");
  const [exportingIssues, setExportingIssues] = useState(false);

  const reqSeqRef = useRef(0);
  const issueSeqRef = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setReviewSearchDebounced(reviewSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [reviewSearch]);

  useEffect(() => {
    const t = window.setTimeout(() => setIssueSearchDebounced(issueSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [issueSearch]);

  const buildReviewQueryParams = useCallback(
    (offset?: number) => {
      const params = new URLSearchParams({
        status: filter === "pinned" ? "all" : filter,
      });
      if (filter === "pinned") params.set("pinnedOnly", "1");
      if (ratingFilter !== "all") params.set("rating", ratingFilter);
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      if (reviewSearchDebounced) params.set("q", reviewSearchDebounced);
      if (offset != null) {
        params.set("offset", String(offset));
        params.set("limit", String(PAGE_SIZE));
      }
      return params;
    },
    [filter, ratingFilter, sourceFilter, reviewSearchDebounced]
  );

  const buildIssueQueryParams = useCallback(
    (offset?: number) => {
      const params = new URLSearchParams({
        status: issueFilter,
      });
      if (issueCategoryFilter !== "all") params.set("category", issueCategoryFilter);
      if (issueSearchDebounced) params.set("q", issueSearchDebounced);
      if (offset != null) {
        params.set("offset", String(offset));
        params.set("limit", String(PAGE_SIZE));
      }
      return params;
    },
    [issueFilter, issueCategoryFilter, issueSearchDebounced]
  );

  const loadReviews = useCallback(
    async (offset: number) => {
      const seq = ++reqSeqRef.current;
      setError(null);
      if (offset === 0) setInitialLoading(true);
      else setLoadingMore(true);

      try {
        const params = buildReviewQueryParams(offset);
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
        if (data?.stats) setStats(data.stats);
        if (data?.statusCounts) setStatusCounts(data.statusCounts);
        if (typeof data?.openIssueCount === "number") setOpenIssueCount(data.openIssueCount);
      } catch {
        if (seq === reqSeqRef.current) setError("网络错误，请稍后重试");
      } finally {
        if (seq === reqSeqRef.current) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [buildReviewQueryParams]
  );

  const loadIssues = useCallback(
    async (offset: number) => {
      const seq = ++issueSeqRef.current;
      setIssueError(null);
      if (offset === 0) setIssuesLoading(true);
      else setIssuesLoadingMore(true);

      try {
        const params = buildIssueQueryParams(offset);
        const res = await fetch(adminApiUrl(`/api/admin/issues?${params.toString()}`), {
          headers: adminAuthHeaders(),
        });
        if (seq !== issueSeqRef.current) return;

        if (res.status === 401) {
          setAuthExpired(true);
          setIssueError("登录已失效，请重新登录");
          setIssues([]);
          setIssueTotal(0);
          setIssueHasMore(false);
          return;
        }
        setAuthExpired(false);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (seq !== issueSeqRef.current) return;
          setIssueError((body as { error?: string }).error ?? "加载失败，请稍后重试");
          return;
        }

        const data = (await res.json()) as IssueListResponse;
        if (seq !== issueSeqRef.current) return;
        const incoming = Array.isArray(data?.items) ? data.items : [];
        setIssues((prev) => (offset === 0 ? incoming : [...prev, ...incoming]));
        setIssueTotal(typeof data?.total === "number" ? data.total : incoming.length);
        setIssueHasMore(Boolean(data?.hasMore));
        if (data?.counts) {
          setIssueCounts(data.counts);
          setOpenIssueCount(data.counts.open);
        }
      } catch {
        if (seq === issueSeqRef.current) setIssueError("网络错误，请稍后重试");
      } finally {
        if (seq === issueSeqRef.current) {
          setIssuesLoading(false);
          setIssuesLoadingMore(false);
        }
      }
    },
    [buildIssueQueryParams]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadReviews(0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadReviews]);

  useEffect(() => {
    if (section !== "issues") return;
    const timer = window.setTimeout(() => {
      void loadIssues(0);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [section, loadIssues]);

  const handleFilterChange = (next: FeedbackFilter) => {
    if (next === filter) return;
    setFilter(next);
    setItems([]);
    setTotal(0);
    setHasMore(false);
    setError(null);
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
      void loadReviews(0);
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setBusyId(null);
    }
  };

  const handlePin = async (item: FeedbackItem) => {
    const key = String(item.id);
    if (busyId) return;
    const nextPinned = !item.pinned;
    setBusyId(key);
    try {
      const res = await fetch(adminApiUrl(`/api/admin/feedback/${encodeURIComponent(key)}/pin`), {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ pinned: nextPinned }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "操作失败，请稍后重试");
        return;
      }
      void loadReviews(0);
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setBusyId(null);
    }
  };

  const openReplyEditor = (item: FeedbackItem) => {
    const key = String(item.id);
    if (replyTargetId === key) {
      setReplyTargetId(null);
      setReplyDraft("");
      return;
    }
    setReplyTargetId(key);
    setReplyDraft(item.officialReply?.content ?? "");
  };

  const handleSaveReply = async (item: FeedbackItem, contentToSave: string) => {
    const key = String(item.id);
    if (replyBusy) return;
    setReplyBusy(true);
    try {
      const res = await fetch(adminApiUrl(`/api/admin/feedback/${encodeURIComponent(key)}/reply`), {
        method: "POST",
        headers: adminAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ content: contentToSave }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "回复保存失败");
        return;
      }
      const data = (await res.json()) as { officialReply: OfficialReply | null };
      setItems((prev) =>
        prev.map((it) =>
          String(it.id) === key
            ? { ...it, officialReply: data.officialReply ?? undefined }
            : it
        )
      );
      setReplyTargetId(null);
      setReplyDraft("");
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setReplyBusy(false);
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "删除失败，请稍后重试");
        return;
      }
      void loadReviews(0);
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setBusyId(null);
    }
  };

  const handleIssueStatus = async (item: IssueItem, nextStatus: IssueStatus, note?: string) => {
    if (issueBusyId) return;
    setIssueBusyId(item.id);
    try {
      const res = await fetch(
        adminApiUrl(`/api/admin/issues/${encodeURIComponent(item.id)}/status`),
        {
          method: "POST",
          headers: adminAuthHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            status: nextStatus,
            ...(note !== undefined ? { adminNote: note } : {}),
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "操作失败");
        return;
      }
      setResolveNoteId(null);
      setResolveNoteDraft("");
      void loadIssues(0);
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setIssueBusyId(null);
    }
  };

  const handleDeleteIssue = async (item: IssueItem) => {
    if (!window.confirm("确定删除这条问题反馈？\n\n删除后不可恢复。")) return;
    if (issueBusyId) return;
    setIssueBusyId(item.id);
    try {
      const res = await fetch(adminApiUrl(`/api/admin/issues/${encodeURIComponent(item.id)}`), {
        method: "DELETE",
        headers: adminAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert((body as { error?: string }).error ?? "删除失败");
        return;
      }
      void loadIssues(0);
    } catch {
      window.alert("网络错误，请稍后重试");
    } finally {
      setIssueBusyId(null);
    }
  };

  const handleExportReviews = async () => {
    if (exportingReviews) return;
    setExportingReviews(true);
    try {
      const params = buildReviewQueryParams();
      await downloadAdminExcel(`/api/admin/feedback/export?${params.toString()}`, "player_reviews.xlsx");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExportingReviews(false);
    }
  };

  const handleExportIssues = async () => {
    if (exportingIssues) return;
    setExportingIssues(true);
    try {
      const params = buildIssueQueryParams();
      await downloadAdminExcel(`/api/admin/issues/export?${params.toString()}`, "issue_feedback.xlsx");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExportingIssues(false);
    }
  };

  const emptyReviewText = REVIEW_FILTERS.find((f) => f.value === filter)?.empty ?? "暂无玩家评价";
  const emptyIssueText = ISSUE_FILTERS.find((f) => f.value === issueFilter)?.empty ?? "暂无局中反馈";

  return (
    <div className="admin-feedback-page">
      <header className="admin-feedback-header">
        <div className="admin-feedback-heading">
          <button type="button" className="btn btn-ghost btn-sm admin-feedback-back" onClick={onBack}>
            ← 返回控制台
          </button>
          <h1 className="admin-feedback-title">玩家评价与反馈</h1>
          <p className="admin-feedback-count">
            {section === "reviews"
              ? `当前筛选共 ${total} 条公开评价`
              : `当前筛选共 ${issueTotal} 条局中反馈`}
          </p>
        </div>
        <div className="admin-feedback-head-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={section === "reviews" ? exportingReviews : exportingIssues}
            onClick={() =>
              void (section === "reviews" ? handleExportReviews() : handleExportIssues())
            }
          >
            {section === "reviews"
              ? exportingReviews
                ? "导出中…"
                : "📥 导出评价 Excel"
              : exportingIssues
                ? "导出中…"
                : "📥 导出反馈 Excel"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              void (section === "reviews" ? loadReviews(0) : loadIssues(0))
            }
            disabled={section === "reviews" ? initialLoading : issuesLoading}
          >
            刷新
          </button>
        </div>
      </header>

      <div className="admin-feedback-sections" role="tablist" aria-label="反馈类型切换">
        <button
          type="button"
          role="tab"
          aria-selected={section === "reviews"}
          className={`admin-feedback-section-tab${section === "reviews" ? " is-active" : ""}`}
          onClick={() => setSection("reviews")}
        >
          公开评价墙
          {statusCounts && <span className="admin-tab-pill">{statusCounts.all}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "issues"}
          className={`admin-feedback-section-tab${section === "issues" ? " is-active" : ""}`}
          onClick={() => setSection("issues")}
        >
          局中问题反馈
          {openIssueCount > 0 && (
            <span className="admin-tab-pill is-warn">{openIssueCount} 待处理</span>
          )}
        </button>
      </div>

      {section === "reviews" ? (
        <>
          {stats && (
            <section className="admin-feedback-stats" aria-label="评价数据概览">
              <div className="admin-stat-card">
                <span className="admin-stat-label">公开均分</span>
                <strong className="admin-stat-value">
                  {stats.count > 0 ? stats.average.toFixed(1) : "—"}
                </strong>
                <span className="admin-stat-sub">
                  {stats.count > 0 ? `好评率 ${stats.positiveRate}%` : "暂无公开评分"}
                </span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-label">近 7 天新增</span>
                <strong className="admin-stat-value">{stats.recent7dCount}</strong>
                <span className="admin-stat-sub">公开中 {stats.count} 条</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-label">已完局评价</span>
                <strong className="admin-stat-value">{stats.verifiedCount}</strong>
                <span className="admin-stat-sub">
                  {stats.count > 0
                    ? `占 ${Math.round((stats.verifiedCount / stats.count) * 100)}%`
                    : "打完 4 时代后提交"}
                </span>
              </div>
              <div className="admin-stat-card admin-stat-card--tags">
                <span className="admin-stat-label">高频标签 Top 5</span>
                <div className="admin-stat-tags">
                  {stats.tagCounts.length > 0 ? (
                    stats.tagCounts.slice(0, 5).map((tc) => (
                      <span key={tc.tag} className="admin-feedback-tag">
                        {tc.tag} ({tc.count})
                      </span>
                    ))
                  ) : (
                    <span className="admin-stat-sub">暂无标签数据</span>
                  )}
                </div>
              </div>
            </section>
          )}

          <div className="admin-feedback-toolbar" role="group" aria-label="评价筛选">
            {REVIEW_FILTERS.map((f) => {
              const count =
                statusCounts && f.value === "all"
                  ? statusCounts.all
                  : statusCounts && f.value === "visible"
                    ? statusCounts.visible
                    : statusCounts && f.value === "hidden"
                      ? statusCounts.hidden
                      : statusCounts && f.value === "pinned"
                        ? statusCounts.pinned
                        : null;
              return (
                <button
                  key={f.value}
                  type="button"
                  className={`btn btn-sm ${filter === f.value ? "btn-primary" : "btn-ghost"}`}
                  aria-pressed={filter === f.value}
                  onClick={() => handleFilterChange(f.value)}
                >
                  {f.label}
                  {count != null ? ` (${count})` : ""}
                </button>
              );
            })}

            <select
              className="admin-feedback-select"
              aria-label="按星级筛选"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">全部星级</option>
              <option value="5">5 星</option>
              <option value="4">4 星</option>
              <option value="3">3 星</option>
              <option value="2">2 星</option>
              <option value="1">1 星</option>
            </select>

            <select
              className="admin-feedback-select"
              aria-label="按来源筛选"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="all">全部来源</option>
              <option value="game_over">对局结束</option>
              <option value="lobby">首页</option>
            </select>

            <input
              type="search"
              className="admin-feedback-search"
              placeholder="搜索评价内容、标签或人格…"
              value={reviewSearch}
              onChange={(e) => setReviewSearch(e.target.value)}
            />
          </div>

          {error && (
            <p
              className={`admin-feedback-error${authExpired ? " admin-feedback-error-auth" : ""}`}
              role="alert"
            >
              {error}
            </p>
          )}

          {initialLoading ? (
            <p className="admin-feedback-state">加载中…</p>
          ) : authExpired ? null : items.length === 0 ? (
            <p className="admin-feedback-state">{emptyReviewText}</p>
          ) : (
            <>
              <ul className="admin-feedback-list">
                {items.map((item) => {
                  const key = String(item.id);
                  const hidden = item.status === "hidden";
                  const busy = busyId === key;
                  const tags = normalizeTags(item.tags);
                  const rating = normalizeRating(item.rating);
                  const editingReply = replyTargetId === key;

                  return (
                    <li
                      key={key}
                      className={`admin-feedback-card${item.pinned ? " is-pinned" : ""}`}
                    >
                      <div className="admin-feedback-meta">
                        <span className="admin-feedback-stars" aria-label={`${rating} 星`}>
                          {starText(item.rating)}
                        </span>
                        <span
                          className={`admin-feedback-badge ${hidden ? "is-hidden" : "is-visible"}`}
                        >
                          {hidden ? "已隐藏" : "公开中"}
                        </span>
                        {item.pinned && (
                          <span className="admin-feedback-badge is-pinned">精选置顶</span>
                        )}
                        {item.verifiedGameOver && (
                          <span className="admin-feedback-badge is-verified">✓ 已完局</span>
                        )}
                        <span className="admin-feedback-source">{sourceLabel(item.source)}</span>
                        {item.gameContext?.modeLabel && (
                          <span className="admin-feedback-source">
                            {item.gameContext.modeLabel}
                          </span>
                        )}
                        {item.gameContext?.personaName && (
                          <span className="admin-feedback-source">
                            {item.gameContext.personaName}
                          </span>
                        )}
                        {(item.helpfulCount ?? 0) > 0 && (
                          <span className="admin-feedback-source">
                            👍 {item.helpfulCount}
                          </span>
                        )}
                        <time className="admin-feedback-time">
                          {formatDateTime(item.createdAt)}
                          {item.updatedAt ? `（改于 ${formatDateTime(item.updatedAt)}）` : ""}
                        </time>
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

                      {item.officialReply && !editingReply && (
                        <div className="admin-feedback-reply-box">
                          <div className="admin-feedback-reply-head">
                            <span>官方回复</span>
                            <time>{formatDateTime(item.officialReply.updatedAt)}</time>
                          </div>
                          <p>{item.officialReply.content}</p>
                        </div>
                      )}

                      {editingReply && (
                        <div className="admin-feedback-reply-editor">
                          <textarea
                            rows={3}
                            maxLength={500}
                            placeholder="写下官方公开回复（留空保存即可撤回回复）…"
                            value={replyDraft}
                            onChange={(e) => setReplyDraft(e.target.value)}
                          />
                          <div className="admin-feedback-reply-editor-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={replyBusy}
                              onClick={() => {
                                setReplyTargetId(null);
                                setReplyDraft("");
                              }}
                            >
                              取消
                            </button>
                            {item.officialReply && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm admin-feedback-delete"
                                disabled={replyBusy}
                                onClick={() => void handleSaveReply(item, "")}
                              >
                                撤回回复
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={replyBusy}
                              onClick={() => void handleSaveReply(item, replyDraft)}
                            >
                              {replyBusy ? "保存中…" : "发布回复"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="admin-feedback-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => void handlePin(item)}
                        >
                          {item.pinned ? "取消置顶" : "置顶精选"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => openReplyEditor(item)}
                        >
                          {item.officialReply ? "编辑回复" : "官方回复"}
                        </button>
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
                    onClick={() => void loadReviews(items.length)}
                  >
                    {loadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <div className="admin-feedback-toolbar" role="group" aria-label="局中反馈筛选">
            {ISSUE_FILTERS.map((f) => {
              const count =
                issueCounts && f.value === "all"
                  ? issueCounts.all
                  : issueCounts && f.value === "open"
                    ? issueCounts.open
                    : issueCounts && f.value === "resolved"
                      ? issueCounts.resolved
                      : null;
              return (
                <button
                  key={f.value}
                  type="button"
                  className={`btn btn-sm ${issueFilter === f.value ? "btn-primary" : "btn-ghost"}`}
                  aria-pressed={issueFilter === f.value}
                  onClick={() => setIssueFilter(f.value)}
                >
                  {f.label}
                  {count != null ? ` (${count})` : ""}
                </button>
              );
            })}

            <select
              className="admin-feedback-select"
              aria-label="按分类筛选"
              value={issueCategoryFilter}
              onChange={(e) => setIssueCategoryFilter(e.target.value)}
            >
              <option value="all">全部分类</option>
              {ISSUE_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <input
              type="search"
              className="admin-feedback-search"
              placeholder="搜索反馈内容、房号或备注…"
              value={issueSearch}
              onChange={(e) => setIssueSearch(e.target.value)}
            />
          </div>

          {issueError && (
            <p
              className={`admin-feedback-error${authExpired ? " admin-feedback-error-auth" : ""}`}
              role="alert"
            >
              {issueError}
            </p>
          )}

          {issuesLoading ? (
            <p className="admin-feedback-state">加载中…</p>
          ) : authExpired ? null : issues.length === 0 ? (
            <p className="admin-feedback-state">{emptyIssueText}</p>
          ) : (
            <>
              <ul className="admin-feedback-list">
                {issues.map((item) => {
                  const busy = issueBusyId === item.id;
                  const resolved = item.status === "resolved";
                  const ctx = item.context ?? {};
                  const editingNote = resolveNoteId === item.id;

                  return (
                    <li key={item.id} className="admin-feedback-card">
                      <div className="admin-feedback-meta">
                        <span className="admin-feedback-badge is-pinned">{item.category}</span>
                        <span
                          className={`admin-feedback-badge ${
                            resolved ? "is-visible" : "is-warn"
                          }`}
                        >
                          {resolved ? "已处理" : "待处理"}
                        </span>
                        {ctx.phase && (
                          <span className="admin-feedback-source">
                            {PHASE_LABELS[ctx.phase] ?? ctx.phase}
                          </span>
                        )}
                        {ctx.era != null && ctx.round != null && ctx.era > 0 && ctx.round > 0 && (
                          <span className="admin-feedback-source">
                            第{ctx.era}时代 第{ctx.round}轮
                          </span>
                        )}
                        {(ctx.humanCount != null || ctx.aiCount != null) && (
                          <span className="admin-feedback-source">
                            {ctx.humanCount ?? 0}真人+{ctx.aiCount ?? 0}AI
                          </span>
                        )}
                        {ctx.deviceType && (
                          <span className="admin-feedback-source">
                            {DEVICE_LABELS[ctx.deviceType] ?? ctx.deviceType}
                            {ctx.viewport ? ` ${ctx.viewport}` : ""}
                          </span>
                        )}
                        {ctx.roomId && (
                          <span className="admin-feedback-source">房号 {ctx.roomId}</span>
                        )}
                        <time className="admin-feedback-time">{formatDateTime(item.createdAt)}</time>
                      </div>

                      <p className="admin-feedback-content">{item.content}</p>

                      {item.adminNote && !editingNote && (
                        <div className="admin-feedback-reply-box">
                          <div className="admin-feedback-reply-head">
                            <span>处理备注</span>
                            {item.resolvedAt && <time>{formatDateTime(item.resolvedAt)}</time>}
                          </div>
                          <p>{item.adminNote}</p>
                        </div>
                      )}

                      {editingNote && (
                        <div className="admin-feedback-reply-editor">
                          <textarea
                            rows={2}
                            maxLength={300}
                            placeholder="可选填处理备注（如：已定位并在下版修复）…"
                            value={resolveNoteDraft}
                            onChange={(e) => setResolveNoteDraft(e.target.value)}
                          />
                          <div className="admin-feedback-reply-editor-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => {
                                setResolveNoteId(null);
                                setResolveNoteDraft("");
                              }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busy}
                              onClick={() =>
                                void handleIssueStatus(item, "resolved", resolveNoteDraft)
                              }
                            >
                              {busy ? "保存中…" : "确认标记已处理"}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="admin-feedback-actions">
                        {resolved ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            onClick={() => void handleIssueStatus(item, "open")}
                          >
                            重新标为待处理
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => {
                              if (editingNote) {
                                setResolveNoteId(null);
                                setResolveNoteDraft("");
                              } else {
                                setResolveNoteId(item.id);
                                setResolveNoteDraft(item.adminNote ?? "");
                              }
                            }}
                          >
                            {editingNote ? "收起备注" : "标记已处理"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm admin-feedback-delete"
                          disabled={busy}
                          onClick={() => void handleDeleteIssue(item)}
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {issueHasMore && (
                <div className="admin-feedback-more">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={issuesLoadingMore}
                    onClick={() => void loadIssues(issues.length)}
                  >
                    {issuesLoadingMore ? "加载中…" : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
