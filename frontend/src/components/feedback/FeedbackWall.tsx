import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FEEDBACK_TAGS,
  fetchFeedback,
  submitFeedback,
  type FeedbackItem,
  type FeedbackSource,
  type FeedbackSummary,
  type FeedbackTag,
} from "../../api/feedback";

type FeedbackMode = "list" | "write";

export interface FeedbackWallProps {
  open: boolean;
  onClose: () => void;
  source: FeedbackSource;
  initialMode?: FeedbackMode;
  initialRating?: number;
}

type FeedbackDialogProps = Omit<FeedbackWallProps, "open">;

const PAGE_SIZE = 20;
const MAX_CONTENT = 300;
const MAX_TAGS = 3;

function clampRating(value: number | undefined): number {
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

const FeedbackDialog: React.FC<FeedbackDialogProps> = ({
  onClose,
  source,
  initialMode = "list",
  initialRating,
}) => {
  const [mode, setMode] = useState<FeedbackMode>(initialMode);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [rating, setRating] = useState(() => clampRating(initialRating));
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadFirstPage = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const page = await fetchFeedback(0, PAGE_SIZE);
      if (seq !== loadSeq.current) return;
      setItems(page.items);
      setSummary({ count: page.count, average: page.average });
      setHasMore(page.hasMore);
      setLoadError(null);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadError(err instanceof Error ? err.message : "加载评价失败，请稍后重试");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const seq = ++loadSeq.current;
    fetchFeedback(0, PAGE_SIZE)
      .then((page) => {
        if (seq !== loadSeq.current) return;
        setItems(page.items);
        setSummary({ count: page.count, average: page.average });
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setLoadError(
          err instanceof Error ? err.message : "加载评价失败，请稍后重试"
        );
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoading(false);
      });
    return () => {
      loadSeq.current += 1;
    };
  }, []);

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
      const page = await fetchFeedback(items.length, PAGE_SIZE);
      if (seq !== loadSeq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((item) => String(item.id)));
        const next = page.items.filter((item) => !seen.has(String(item.id)));
        return [...prev, ...next];
      });
      setSummary({ count: page.count, average: page.average });
      setHasMore(page.hasMore);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      setLoadMoreError(err instanceof Error ? err.message : "加载更多失败，请重试");
    } finally {
      if (seq === loadSeq.current) setLoadingMore(false);
    }
  };

  const toggleTag = (tag: FeedbackTag) => {
    setTags((prev) => {
      if (prev.includes(tag)) return prev.filter((item) => item !== tag);
      if (prev.length >= MAX_TAGS) return prev;
      return [...prev, tag];
    });
  };

  const canSubmit = !submitting && rating >= 1 && rating <= 5;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const result = await submitFeedback({
        rating,
        content: content.trim(),
        tags,
        source,
      });
      setItems((prev) => {
        const id = String(result.item.id);
        return [result.item, ...prev.filter((item) => String(item.id) !== id)];
      });
      setSummary(result.summary);
      setSuccess("谢谢你的评价");
      setMode("list");
      setContent("");
      setTags([]);
      setLoadingMore(false);
      setLoadError(null);
      setLoadMoreError(null);
      void loadFirstPage();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const empty = !loading && !loadError && items.length === 0;

  return (
    <div
      className="feedback-backdrop"
      role="presentation"
      onClick={onClose}
    >
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
            玩家评价
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
            写评价
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

              {empty && (
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

              {items.length > 0 && (
                <>
                  {summary && summary.count > 0 && (
                    <div className="feedback-summary">
                      平均 <strong>{formatAverage(summary.average)}</strong>
                      <span className="feedback-summary-dot" aria-hidden="true">
                        ·
                      </span>
                      共 {summary.count} 条
                    </div>
                  )}

                  {loadError && (
                    <div className="feedback-inline-error" role="alert">
                      <span>{loadError}</span>
                      <button type="button" onClick={handleRetry}>
                        重试
                      </button>
                    </div>
                  )}

                  <ul className="feedback-list">
                    {items.map((item) => (
                      <li className="feedback-item" key={String(item.id)}>
                        <div className="feedback-item-head">
                          <StarsView rating={item.rating} />
                          <span className="feedback-anon">匿名玩家</span>
                          <time className="feedback-date">
                            {formatDate(item.createdAt)}
                          </time>
                        </div>
                        {Array.isArray(item.tags) && item.tags.length > 0 && (
                          <div className="feedback-item-tags">
                            {item.tags
                              .filter((tag) =>
                                (FEEDBACK_TAGS as readonly string[]).includes(tag)
                              )
                              .map((tag) => (
                                <span className="feedback-item-tag" key={tag}>
                                  {tag}
                                </span>
                              ))}
                          </div>
                        )}
                        {item.content && (
                          <p className="feedback-item-content">{item.content}</p>
                        )}
                      </li>
                    ))}
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
              <p className="feedback-anon-note">
                公开展示 · 不显示昵称 · 不当词句自动打码
              </p>

              <div className="feedback-field">
                <span className="feedback-label">
                  评分
                  <span className="feedback-label-hint">
                    {rating > 0 ? `${rating} 星` : "请选择 1–5 星"}
                  </span>
                </span>
                <div className="feedback-rating" role="group" aria-label="评分">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`feedback-rating-btn${
                        rating >= value ? " is-active" : ""
                      }`}
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

              <label className="feedback-field">
                <span className="feedback-label">
                  评价内容
                  <span className="feedback-label-hint">
                    {content.length}/{MAX_CONTENT}
                  </span>
                </span>
                <textarea
                  className="feedback-textarea"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={MAX_CONTENT}
                  rows={5}
                  placeholder="说说这局体验（选填）"
                  aria-label="评价内容，最多 300 字"
                />
              </label>

              <div className="feedback-field">
                <span className="feedback-label">
                  标签
                  <span className="feedback-label-hint">
                    最多选 {MAX_TAGS} 个
                  </span>
                </span>
                <div className="feedback-tags">
                  {FEEDBACK_TAGS.map((tag) => {
                    const selected = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`feedback-tag-btn${selected ? " is-selected" : ""}`}
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

              {submitError && (
                <p className="feedback-error" role="alert">
                  {submitError}
                </p>
              )}

              <div className="feedback-submit-row">
                <span className="feedback-privacy-note">匿名提交 · 不收集账号信息</span>
                <button
                  type="button"
                  className="feedback-submit"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  aria-busy={submitting}
                >
                  {submitting ? "提交中…" : "提交评价"}
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
    />,
    document.body
  );
};
