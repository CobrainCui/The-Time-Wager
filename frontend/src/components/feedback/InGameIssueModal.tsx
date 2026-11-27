import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ISSUE_CATEGORIES,
  ISSUE_CONTENT_MAX,
  submitIssueFeedback,
  type IssueCategory,
  type IssueContext,
} from "../../api/feedback";

export interface InGameIssueModalProps {
  open: boolean;
  onClose: () => void;
  context: IssueContext;
  onSwitchToPublicWall?: () => void;
}

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

const CATEGORY_PLACEHOLDERS: Record<IssueCategory, string> = {
  规则没看懂: "哪条规则或数值说明让你有疑惑？比如：某张道具卡、排名奖惩怎么算…",
  "界面/操作问题": "哪个按钮点不动、遮挡或显示怪怪的？简单说下位置就好",
  "AI 表现异常": "哪位 AI 的出价、投资或发言显得不太正常？",
  "卡顿/掉线": "什么时候出现卡住、转圈或没反应？",
  玩法建议: "对节奏、牌库、社交或任何玩法有什么好点子？",
};

function formatContextSummary(context: IssueContext): string {
  const parts: string[] = [];
  if (context.phase) parts.push(PHASE_LABELS[context.phase] ?? context.phase);
  if (context.era != null && context.round != null && context.era > 0 && context.round > 0) {
    parts.push(`第 ${context.era} 时代 · 第 ${context.round} 轮`);
  }
  if (context.humanCount != null || context.aiCount != null) {
    parts.push(`${context.humanCount ?? 0} 真人 + ${context.aiCount ?? 0} AI`);
  }
  if (context.deviceType) {
    const label =
      context.deviceType === "mobile" ? "手机端" : context.deviceType === "tablet" ? "平板端" : "电脑端";
    parts.push(label);
  }
  return parts.join(" · ");
}

const IssueDialog: React.FC<Omit<InGameIssueModalProps, "open">> = ({
  onClose,
  context,
  onSwitchToPublicWall,
}) => {
  const [category, setCategory] = useState<IssueCategory | null>(null);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const closeBtnRef = useRef<HTMLButtonElement>(null);

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
    const timer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => onClose(), 1400);
    return () => window.clearTimeout(timer);
  }, [done, onClose]);

  const trimmedLen = Array.from(content.trim()).length;
  const canSubmit = !submitting && category !== null && trimmedLen >= 2;
  const contextLine = formatContextSummary(context);

  const handleSubmit = async () => {
    if (!category) {
      setError("先选一个问题分类");
      return;
    }
    if (trimmedLen < 2) {
      setError("请至少写 2 个字描述问题或建议");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitIssueFeedback({
        category,
        content: content.trim(),
        context,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="feedback-backdrop" role="presentation" onClick={onClose}>
      <div
        className="feedback-panel feedback-panel--compact"
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="feedback-head">
          <div className="feedback-head-copy">
            <h2 id="issue-feedback-title">局中问题与建议</h2>
            <p>直达制作团队 · 不会公开 · 不影响当前对局</p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="feedback-close"
            onClick={onClose}
            aria-label="关闭问题反馈"
            title="关闭"
          >
            ✕
          </button>
        </header>

        <div className="feedback-body">
          {done ? (
            <div className="feedback-issue-done" role="status">
              <div className="feedback-issue-done-icon" aria-hidden="true">✓</div>
              <h3>已收到，谢谢你的反馈！</h3>
              <p>我们已经记录当前对局现场，会尽快排查和优化。</p>
              <button type="button" className="feedback-submit" onClick={onClose}>
                回到对局
              </button>
            </div>
          ) : (
            <div className="feedback-write">
              <div className="feedback-field">
                <span className="feedback-label">
                  遇到了什么情况？
                  <span className="feedback-label-hint">单选</span>
                </span>
                <div className="feedback-tags" role="group" aria-label="问题分类">
                  {ISSUE_CATEGORIES.map((cat) => {
                    const active = category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`feedback-tag-btn${active ? " is-selected" : ""}`}
                        aria-pressed={active}
                        onClick={() => {
                          setCategory(cat);
                          setError(null);
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="feedback-field">
                <span className="feedback-label">
                  简单说几句
                  <span className="feedback-label-hint">
                    {content.length}/{ISSUE_CONTENT_MAX}
                  </span>
                </span>
                <textarea
                  className="feedback-textarea"
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  maxLength={ISSUE_CONTENT_MAX}
                  rows={4}
                  placeholder={
                    category
                      ? CATEGORY_PLACEHOLDERS[category]
                      : "简单描述你遇到的卡点、疑惑或建议（最少 2 个字）"
                  }
                />
              </label>

              {contextLine && (
                <div className="feedback-issue-context">
                  <strong>自动附带现场：</strong>
                  <span>{contextLine}</span>
                  <em>（不含昵称与聊天记录）</em>
                </div>
              )}

              {error && (
                <p className="feedback-error" role="alert">
                  {error}
                </p>
              )}

              <div className="feedback-submit-row">
                {onSwitchToPublicWall ? (
                  <button
                    type="button"
                    className="feedback-link-btn"
                    onClick={onSwitchToPublicWall}
                  >
                    想去公开评价墙看看 / 打分 →
                  </button>
                ) : (
                  <span className="feedback-privacy-note">仅团队后台可见</span>
                )}
                <button
                  type="button"
                  className="feedback-submit"
                  disabled={!canSubmit}
                  aria-busy={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? "发送中…" : "发送反馈"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const InGameIssueModal: React.FC<InGameIssueModalProps> = ({
  open,
  onClose,
  context,
  onSwitchToPublicWall,
}) => {
  if (!open) return null;
  return createPortal(
    <IssueDialog
      onClose={onClose}
      context={context}
      onSwitchToPublicWall={onSwitchToPublicWall}
    />,
    document.body
  );
};
