import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ALL_DISPLAYABLE_TAGS,
  FEEDBACK_CONSTRUCTIVE_TAGS,
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_POSITIVE_TAGS,
  fetchFeedback,
  getOwnedReviewToken,
  saveOwnedReview,
  submitFeedback,
  toggleFeedbackHelpful,
  updateOwnFeedback,
  type FeedbackGameContext,
  type FeedbackItem,
  type FeedbackSource,
  type FeedbackStats,
  type FeedbackSummary,
  type PublicFeedbackSort,
} from "../../api/feedback";

type FeedbackMode = "list" | "write";

export interface FeedbackWallProps {
  open: boolean;
  onClose: () => void;
  source: FeedbackSource;
  initialMode?: FeedbackMode;
  initialRating?: number;
  gameContext?: FeedbackGameContext;
  sessionKey?: string;
  initialEditItem?: FeedbackItem | null;
  onReviewSaved?: (item: FeedbackItem) => void;
}

type FeedbackDialogProps = Omit<FeedbackWallProps, "open">;

const PAGE_SIZE = 20;
const MAX_TAGS = 3;
const LONG_CONTENT_CHAR_THRESHOLD = 140;
const LONG_CONTENT_LINE_THRESHOLD = 4;

const SORT_OPTIONS: Array<{ value: PublicFeedbackSort; label: string }> = [
  { value: "featured", label: "精选优先" },
  { value: "newest", label: "最新发布" },
  { value: "highest", label: "好评优先" },
  { value: "lowest", label: "差评优先" },
];

const RATING_LABELS: Record<number, string> = {
  1: "1 星 · 体验较差",
  2: "2 星 · 有点失望",
  3: "3 星 · 中规中矩",
  4: "4 星 · 挺好玩的",
  5: "5 星 · 强烈推荐",
};

function clampInitialRating(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 0;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function formatDate(value: number | string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatAverage(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function getReputationLabel(stats: FeedbackStats | null): string {
  if (!stats || stats.count === 0) return "虚位以待";
  if (stats.count < 3) return "口碑收集中";
  if (stats.positiveRate >= 90) return "好评如潮";
  if (stats.positiveRate >= 80) return "特别好评";
  if (stats.positiveRate >= 65) return "多半好评";
  if (stats.positiveRate >= 50) return "褒贬不一";
  return "有待改进";
}

function isLongContent(text: string): boolean {
  if (Array.from(text).length > LONG_CONTENT_CHAR_THRESHOLD) return true;
  return text.split("\n").length > LONG_CONTENT_LINE_THRESHOLD;
}

function StarsView({ rating }: { rating: number }) {
  const safe = Math.min(5, Math.max(0, Math.round(rating)));
  return (
    <span className="feedback-stars-view" role="img" aria-label={`${safe} 星`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < safe ? "is-on" : ""} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

const CONSTRUCTIVE_TAG_SET = new Set<string>(FEEDBACK_CONSTRUCTIVE_TAGS);

const FeedbackDialog: React.FC<FeedbackDialogProps> = ({
  onClose,
  source,
  initialMode = "list",
  initialRating,
  gameContext,
  sessionKey,
  initialEditItem = null,
  onReviewSaved,
}) => {
  const [mode, setMode] = useState<FeedbackMode>(initialMode);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // 筛选与排序
  const [sort, setSort] = useState<PublicFeedbackSort>("featured");
  const [ratingFilter, setRatingFilter] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [withContentOnly, setWithContentOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [votingIds, setVotingIds] = useState<Set<string>>(() => new Set());

  // 写评 / 修改态
  const [editingId, setEditingId] = useState<string | null>(
    initialEditItem ? String(initialEditItem.id) : null
  );
  const [rating, setRating] = useState(() =>
    initialEditItem ? clampInitialRating(initialEditItem.rating) : clampInitialRating(initialRating)
  );
  const [content, setContent] = useState(() => initialEditItem?.content ?? "");
  const [tags, setTags] = useState<string[]>(() =>
    initialEditItem ? [...initialEditItem.tags] : []
  );
  const [attachGameContext, setAttachGameContext] = useState(() => {
    if (initialEditItem) return Boolean(initialEditItem.gameContext);
    return source === "game_over" && Boolean(gameContext);
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters =
    ratingFilter !== null || tagFilter !== null || withContentOnly || verifiedOnly;

  const currentQuery = useMemo(
    () => ({
      sort,
      rating: ratingFilter,
      tag: tagFilter,
      withContent: withContentOnly,
      verifiedOnly,
    }),
    [sort, ratingFilter, tagFilter, withContentOnly, verifiedOnly]
  );

  const loadFirstPage = useCallback(
    async (queryOverride?: typeof currentQuery) => {
      const q = queryOverride ?? currentQuery;
      const seq = ++loadSeq.current;
      try {
        const page = await fetchFeedback({
          offset: 0,
          limit: PAGE_SIZE,
          ...q,
        });
        if (seq !== loadSeq.current) return;
        setItems(page.items);
        setSummary({ count: page.count, average: page.average });
        if (page.stats) setStats(page.stats);
        setHasMore(page.hasMore);
        setLoadError(null);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setLoadError(err instanceof Error ? err.message : "加载评价失败，请稍后重试");
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [currentQuery]
  );

  useEffect(() => {
    const seq = ++loadSeq.current;
    fetchFeedback({
      offset: 0,
      limit: PAGE_SIZE,
      ...currentQuery,
    })
      .then((page) => {
        if (seq !== loadSeq.current) return;
        setItems(page.items);
        setSummary({ count: page.count, average: page.average });
        if (page.stats) setStats(page.stats);
        setHasMore(page.hasMore);
        setLoadError(null);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setLoadError(err instanceof Error ? err.message : "加载评价失败，请稍后重试");
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
    return () => {
      loadSeq.current += 1;
    };
  }, [currentQuery]);

  // 锁住页面滚动，关闭时恢复原值。
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [mode]);

  const switchMode = (next: FeedbackMode) => {
    setMode(next);
    if (next === "write") {
      setSubmitError(null);
      setSuccess(null);
    }
  };

  const resetFilters = () => {
    setLoading(true);
    setRatingFilter(null);
    setTagFilter(null);
    setWithContentOnly(false);
    setVerifiedOnly(false);
  };

  const applyFilterChange = (updater: () => void) => {
    setLoading(true);
    setLoadError(null);
    setLoadMoreError(null);
    updater();
  };

  const handleRetry = () => {
    setLoading(true);
    setLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
    void loadFirstPage();
  };

  const handleLoadMore = async () => {
    if (loading || loadingMore || !hasMore) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchFeedback({
        offset: items.length,
        limit: PAGE_SIZE,
        ...currentQuery,
      });
      if (seq !== loadSeq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => String(item.id)));
        const next = page.items.filter((item) => !seen.has(String(item.id)));
        return [...prev, ...next];
      });
      setSummary({ count: page.count, average: page.average });
      if (page.stats) setStats(page.stats);
      setHasMore(page.hasMore);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadMoreError(err instanceof Error ? err.message : "加载更多失败，请重试");
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      if (prev.includes(tag)) return prev.filter((item) => item !== tag);
      if (prev.length >= MAX_TAGS) return prev;
      return [...prev, tag];
    });
  };

  const handleHelpfulToggle = async (item: FeedbackItem) => {
    const idKey = String(item.id);
    if (votingIds.has(idKey)) return;

    const prevVoted = Boolean(item.viewerHasVoted);
    const prevCount = item.helpfulCount ?? 0;
    const nextVoted = !prevVoted;
    const nextCount = Math.max(0, prevCount + (nextVoted ? 1 : -1));

    setVotingIds((prev) => new Set(prev).add(idKey));
    setItems((prev) =>
      prev.map((it) =>
        String(it.id) === idKey
          ? { ...it, viewerHasVoted: nextVoted, helpfulCount: nextCount }
          : it
      )
    );

    try {
      const res = await toggleFeedbackHelpful(item.id);
      setItems((prev) =>
        prev.map((it) =>
          String(it.id) === idKey
            ? { ...it, viewerHasVoted: res.voted, helpfulCount: res.helpfulCount }
            : it
        )
      );
    } catch {
      // 失败回滚
      setItems((prev) =>
        prev.map((it) =>
          String(it.id) === idKey
            ? { ...it, viewerHasVoted: prevVoted, helpfulCount: prevCount }
            : it
        )
      );
    } finally {
      setVotingIds((prev) => {
        const next = new Set(prev);
        next.delete(idKey);
        return next;
      });
    }
  };

  const startEditItem = (item: FeedbackItem) => {
    setEditingId(String(item.id));
    setRating(clampInitialRating(item.rating));
    setContent(item.content);
    setTags([...item.tags]);
    setAttachGameContext(Boolean(item.gameContext));
    setSubmitError(null);
    setSuccess(null);
    setMode("write");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setRating(clampInitialRating(initialRating));
    setContent("");
    setTags([]);
    setAttachGameContext(source === "game_over" && Boolean(gameContext));
    setSubmitError(null);
    setMode("list");
  };

  const toggleExpand = (idKey: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idKey)) next.delete(idKey);
      else next.add(idKey);
      return next;
    });
  };

  const canSubmit = !submitting && rating >= 1 && rating <= 5;
  const activeContext =
    editingId != null
      ? items.find((it) => String(it.id) === editingId)?.gameContext ??
        (initialEditItem && String(initialEditItem.id) === editingId
          ? initialEditItem.gameContext
          : undefined) ??
        (source === "game_over" ? gameContext : undefined)
      : source === "game_over"
        ? gameContext
        : undefined;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      if (editingId) {
        const token = getOwnedReviewToken(editingId);
        if (!token) {
          setSubmitError("本机未找到该评价的修改凭证，无法编辑");
          return;
        }
        const result = await updateOwnFeedback(editingId, {
          editToken: token,
          rating,
          content: content.trim(),
          tags,
          ...(activeContext && attachGameContext
            ? { gameContext: activeContext }
            : { clearGameContext: true }),
        });
        setItems((prev) =>
          prev.map((it) => (String(it.id) === editingId ? { ...it, ...result.item } : it))
        );
        setSummary(result.summary);
        if (result.stats) setStats(result.stats);
        onReviewSaved?.(result.item);
        setSuccess("已更新你的评价");
        setEditingId(null);
        setContent("");
        setTags([]);
        setMode("list");
        void loadFirstPage();
      } else {
        const result = await submitFeedback({
          rating,
          content: content.trim(),
          tags,
          source,
          ...(source === "game_over" && attachGameContext && gameContext
            ? { gameContext }
            : {}),
        });
        saveOwnedReview(result.item.id, result.editToken, sessionKey);
        onReviewSaved?.(result.item);
        setSummary(result.summary);
        if (result.stats) setStats(result.stats);
        setSuccess("谢谢你的评价");
        setContent("");
        setTags([]);
        setRating(0);
        setMode("list");
        const nextQuery: typeof currentQuery = {
          sort: "newest",
          rating: null,
          tag: null,
          withContent: false,
          verifiedOnly: false,
        };
        setSort("newest");
        setRatingFilter(null);
        setTagFilter(null);
        setWithContentOnly(false);
        setVerifiedOnly(false);
        setLoadingMore(false);
        setLoadError(null);
        setLoadMoreError(null);
        void loadFirstPage(nextQuery);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const overallCount = stats?.count ?? summary?.count ?? 0;
  const completelyEmpty = !loading && !loadError && overallCount === 0 && !hasActiveFilters;
  const filteredEmpty = !loading && !loadError && items.length === 0 && !completelyEmpty;

  const showConstructiveFirst = rating >= 1 && rating <= 3;
  const tagGroups = showConstructiveFirst
    ? [
        { title: "待改进的地方", list: FEEDBACK_CONSTRUCTIVE_TAGS },
        { title: "也有值得夸的", list: FEEDBACK_POSITIVE_TAGS },
      ]
    : [
        { title: "体验亮点", list: FEEDBACK_POSITIVE_TAGS },
        { title: "希望改进", list: FEEDBACK_CONSTRUCTIVE_TAGS },
      ];

  const contextPreview = [
    activeContext?.modeLabel,
    activeContext?.personaName ? `人格：${activeContext.personaName}` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="feedback-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feedback-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-wall-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="feedback-head">
          <div className="feedback-head-copy">
            <h2 id="feedback-wall-title">玩家评价</h2>
            <p>公开 · 匿名 · 真实体验</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="feedback-close"
            onClick={onClose}
            aria-label="关闭玩家评价"
            title="关闭"
          >
            ✕
          </button>
        </header>

        <div className="feedback-tabs" role="tablist" aria-label="玩家评价">
          <button
            type="button"
            role="tab"
            id="feedback-tab-list"
            aria-selected={mode === "list"}
            aria-controls="feedback-panel-list"
            className={`feedback-tab${mode === "list" ? " is-active" : ""}`}
            onClick={() => switchMode("list")}
          >
            玩家口碑
            {overallCount > 0 && <span className="feedback-tab-count">{overallCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            id="feedback-tab-write"
            aria-selected={mode === "write"}
            aria-controls="feedback-panel-write"
            className={`feedback-tab${mode === "write" ? " is-active" : ""}`}
            onClick={() => switchMode("write")}
          >
            {editingId ? "修改评价" : "写评价"}
          </button>
        </div>

        {success && mode === "list" && (
          <p className="feedback-success" role="status">
            {success}
          </p>
        )}

        <div
          ref={bodyRef}
          className="feedback-body"
          aria-busy={loading && items.length === 0}
        >
          {mode === "list" ? (
            <div
              id="feedback-panel-list"
              role="tabpanel"
              aria-labelledby="feedback-tab-list"
            >
              {/* 口碑总览卡 */}
              {stats && stats.count > 0 && (
                <section className="feedback-overview" aria-label="评分口碑概览">
                  <div className="feedback-overview-top">
                    <div className="feedback-score-box">
                      <div className="feedback-score-row">
                        <strong className="feedback-score-num">
                          {formatAverage(stats.average)}
                        </strong>
                        <span className="feedback-score-badge">
                          {getReputationLabel(stats)}
                        </span>
                      </div>
                      <StarsView rating={Math.round(stats.average)} />
                      <div className="feedback-score-meta">
                        <span>{stats.count} 条评价</span>
                        {stats.verifiedCount > 0 && (
                          <span>· {stats.verifiedCount} 条已完局</span>
                        )}
                      </div>
                    </div>

                    <div className="feedback-dist" role="group" aria-label="按星级筛选">
                      {([5, 4, 3, 2, 1] as const).map((star) => {
                        const starCount = stats.distribution[star] ?? 0;
                        const pct =
                          stats.count > 0 ? Math.round((starCount / stats.count) * 100) : 0;
                        const active = ratingFilter === star;
                        return (
                          <button
                            key={star}
                            type="button"
                            className={`feedback-dist-row${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            onClick={() =>
                              applyFilterChange(() =>
                                setRatingFilter((prev) => (prev === star ? null : star))
                              )
                            }
                            title={`只看 ${star} 星评价`}
                          >
                            <span className="feedback-dist-star">{star}★</span>
                            <span className="feedback-dist-track">
                              <span
                                className="feedback-dist-fill"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                            <span className="feedback-dist-count">{starCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {stats.tagCounts.length > 0 && (
                    <div className="feedback-tag-cloud" role="group" aria-label="热门标签筛选">
                      {stats.tagCounts.slice(0, 8).map((tc) => {
                        const active = tagFilter === tc.tag;
                        return (
                          <button
                            key={tc.tag}
                            type="button"
                            className={`feedback-cloud-chip${active ? " is-active" : ""}`}
                            aria-pressed={active}
                            onClick={() =>
                              applyFilterChange(() =>
                                setTagFilter((prev) => (prev === tc.tag ? null : tc.tag))
                              )
                            }
                          >
                            <span>{tc.tag}</span>
                            <span className="feedback-cloud-num">{tc.count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* 排序与筛选栏 */}
              {overallCount > 0 && (
                <div className="feedback-controls">
                  <div className="feedback-sort-row" role="group" aria-label="排序方式">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={`feedback-ctrl-pill${sort === opt.value ? " is-active" : ""}`}
                        aria-pressed={sort === opt.value}
                        onClick={() =>
                          applyFilterChange(() => setSort(opt.value))
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="feedback-filter-row">
                    <button
                      type="button"
                      className={`feedback-ctrl-toggle${verifiedOnly ? " is-active" : ""}`}
                      aria-pressed={verifiedOnly}
                      onClick={() =>
                        applyFilterChange(() => setVerifiedOnly((v) => !v))
                      }
                    >
                      ✓ 只看已完局
                    </button>
                    <button
                      type="button"
                      className={`feedback-ctrl-toggle${withContentOnly ? " is-active" : ""}`}
                      aria-pressed={withContentOnly}
                      onClick={() =>
                        applyFilterChange(() => setWithContentOnly((v) => !v))
                      }
                    >
                      只看有字评
                    </button>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        className="feedback-reset-btn"
                        onClick={resetFilters}
                      >
                        重置筛选
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loading && items.length === 0 && (
                <div className="feedback-state" aria-live="polite">
                  <span className="feedback-spinner" aria-hidden="true" />
                  <p>加载评价中…</p>
                </div>
              )}

              {!loading && loadError && items.length === 0 && (
                <div className="feedback-state feedback-state--error">
                  <p role="alert">{loadError}</p>
                  <button type="button" className="feedback-retry" onClick={handleRetry}>
                    重试
                  </button>
                </div>
              )}

              {completelyEmpty && (
                <div className="feedback-state">
                  <p>还没有评价，来写第一条</p>
                  <button
                    type="button"
                    className="feedback-retry"
                    onClick={() => switchMode("write")}
                  >
                    写第一条
                  </button>
                </div>
              )}

              {filteredEmpty && (
                <div className="feedback-state">
                  <p>没有符合当前筛选条件的评价</p>
                  <button type="button" className="feedback-retry" onClick={resetFilters}>
                    查看全部评价
                  </button>
                </div>
              )}

              {items.length > 0 && (
                <>
                  {loadError && (
                    <div className="feedback-inline-error" role="alert">
                      <span>{loadError}</span>
                      <button type="button" onClick={handleRetry}>
                        重试
                      </button>
                    </div>
                  )}

                  <ul className="feedback-list">
                    {items.map((item) => {
                      const idKey = String(item.id);
                      const canEditOwn = Boolean(getOwnedReviewToken(item.id));
                      const long = Boolean(item.content && isLongContent(item.content));
                      const expanded = expandedIds.has(idKey);
                      const helpfulCount = item.helpfulCount ?? 0;
                      const voted = Boolean(item.viewerHasVoted);

                      return (
                        <li
                          className={`feedback-item${item.pinned ? " is-pinned" : ""}`}
                          key={idKey}
                        >
                          <div className="feedback-item-head">
                            <StarsView rating={item.rating} />
                            {item.pinned && (
                              <span className="feedback-badge feedback-badge--pin">精选</span>
                            )}
                            {item.verifiedGameOver ? (
                              <span className="feedback-badge feedback-badge--verified">
                                ✓ 已完局
                              </span>
                            ) : (
                              <span className="feedback-anon">匿名玩家</span>
                            )}
                            {item.gameContext?.modeLabel && (
                              <span className="feedback-context-chip">
                                {item.gameContext.modeLabel}
                              </span>
                            )}
                            {item.gameContext?.personaName && (
                              <span className="feedback-context-chip feedback-context-chip--persona">
                                {item.gameContext.personaName}
                              </span>
                            )}
                            <time className="feedback-date">
                              {formatDate(item.createdAt)}
                              {item.updatedAt ? " · 已修改" : ""}
                            </time>
                          </div>

                          {Array.isArray(item.tags) && item.tags.length > 0 && (
                            <div className="feedback-item-tags">
                              {item.tags
                                .filter((tag) => ALL_DISPLAYABLE_TAGS.has(tag))
                                .map((tag) => (
                                  <span
                                    className={`feedback-item-tag${
                                      CONSTRUCTIVE_TAG_SET.has(tag) ? " is-constructive" : ""
                                    }`}
                                    key={tag}
                                  >
                                    {tag}
                                  </span>
                                ))}
                            </div>
                          )}

                          {item.content && (
                            <div className="feedback-item-content-wrap">
                              <p
                                className={`feedback-item-content${
                                  long && !expanded ? " is-clamped" : ""
                                }`}
                              >
                                {item.content}
                              </p>
                              {long && (
                                <button
                                  type="button"
                                  className="feedback-expand-btn"
                                  onClick={() => toggleExpand(idKey)}
                                >
                                  {expanded ? "收起" : "展开全文"}
                                </button>
                              )}
                            </div>
                          )}

                          {item.officialReply && (
                            <div className="feedback-official-reply">
                              <div className="feedback-official-reply-head">
                                <span>官方回复</span>
                                <time>{formatDate(item.officialReply.updatedAt)}</time>
                              </div>
                              <p>{item.officialReply.content}</p>
                            </div>
                          )}

                          <div className="feedback-item-foot">
                            <button
                              type="button"
                              className={`feedback-helpful-btn${voted ? " is-voted" : ""}`}
                              aria-pressed={voted}
                              disabled={votingIds.has(idKey)}
                              onClick={() => void handleHelpfulToggle(item)}
                            >
                              <span aria-hidden="true">👍</span>
                              <span>有帮助</span>
                              {helpfulCount > 0 && (
                                <span className="feedback-helpful-num">{helpfulCount}</span>
                              )}
                            </button>

                            {canEditOwn && (
                              <button
                                type="button"
                                className="feedback-edit-own-btn"
                                onClick={() => startEditItem(item)}
                              >
                                修改评价
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {loadMoreError && (
                    <div className="feedback-inline-error" role="alert">
                      <span>{loadMoreError}</span>
                      <button type="button" onClick={() => void handleLoadMore()}>
                        重试
                      </button>
                    </div>
                  )}

                  {hasMore && (
                    <button
                      type="button"
                      className="feedback-more"
                      onClick={() => void handleLoadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? "加载中…" : "加载更多"}
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div
              id="feedback-panel-write"
              role="tabpanel"
              aria-labelledby="feedback-tab-write"
              className="feedback-write"
            >
              <div className="feedback-anon-note">
                <span>
                  {editingId
                    ? "正在修改你之前发布的评价（保留已有赞数）"
                    : "公开展示 · 不显示昵称 · 不当词句自动打码"}
                </span>
                {editingId && (
                  <button
                    type="button"
                    className="feedback-cancel-edit"
                    onClick={cancelEdit}
                  >
                    取消修改
                  </button>
                )}
              </div>

              <div className="feedback-field">
                <span className="feedback-label">
                  评分
                  <span className="feedback-label-hint">
                    {rating > 0 ? RATING_LABELS[rating] ?? `${rating} 星` : "请点击 1–5 星"}
                  </span>
                </span>
                <div className="feedback-rating" role="group" aria-label="评分">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`feedback-rating-btn${rating >= value ? " is-active" : ""}`}
                      aria-label={`${value} 星`}
                      aria-pressed={rating === value}
                      onClick={() => setRating(value)}
                    >
                      <span aria-hidden="true">★</span>
                      <span className="feedback-rating-num" aria-hidden="true">
                        {value}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {activeContext && contextPreview && (
                <label className="feedback-context-check">
                  <input
                    type="checkbox"
                    checked={attachGameContext}
                    onChange={(event) => setAttachGameContext(event.target.checked)}
                  />
                  <span>
                    附带本局信息（匿名）：<strong>{contextPreview}</strong>
                  </span>
                </label>
              )}

              <label className="feedback-field">
                <span className="feedback-label">
                  评价内容
                  <span className="feedback-label-hint">
                    {content.length}/{FEEDBACK_CONTENT_MAX}
                  </span>
                </span>
                <textarea
                  className="feedback-textarea"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={FEEDBACK_CONTENT_MAX}
                  rows={5}
                  placeholder="说说这局体验、最喜欢或觉得还能改进的地方（选填）"
                  aria-label="评价内容，最多 500 字"
                />
              </label>

              <div className="feedback-field">
                <span className="feedback-label">
                  印象标签
                  <span className="feedback-label-hint">
                    已选 {tags.length}/{MAX_TAGS}
                  </span>
                </span>
                <div className="feedback-tag-groups">
                  {tagGroups.map((group) => (
                    <div key={group.title} className="feedback-tag-group">
                      <span className="feedback-tag-group-title">{group.title}</span>
                      <div className="feedback-tags">
                        {group.list.map((tag) => {
                          const selected = tags.includes(tag);
                          const isConstructive = CONSTRUCTIVE_TAG_SET.has(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={`feedback-tag-btn${
                                isConstructive ? " is-constructive" : ""
                              }${selected ? " is-selected" : ""}`}
                              aria-pressed={selected}
                              disabled={!selected && tags.length >= MAX_TAGS}
                              onClick={() => toggleTag(tag)}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {submitError && (
                <p className="feedback-error" role="alert">
                  {submitError}
                </p>
              )}

              <div className="feedback-submit-row">
                <span className="feedback-privacy-note">
                  {source === "game_over"
                    ? "完局评价将自动标注「已完局」"
                    : "匿名提交 · 不收集账号信息"}
                </span>
                <button
                  type="button"
                  className="feedback-submit"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  aria-busy={submitting}
                >
                  {submitting
                    ? "保存中…"
                    : editingId
                      ? "保存修改"
                      : "提交评价"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const FeedbackWall: React.FC<FeedbackWallProps> = (props) => {
  if (!props.open) return null;
  return createPortal(
    <FeedbackDialog
      onClose={props.onClose}
      source={props.source}
      initialMode={props.initialMode}
      initialRating={props.initialRating}
      gameContext={props.gameContext}
      sessionKey={props.sessionKey}
      initialEditItem={props.initialEditItem}
      onReviewSaved={props.onReviewSaved}
    />,
    document.body
  );
};
