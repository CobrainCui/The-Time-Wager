import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";

type Props = {
  /** 目标时间戳；为空则不显示 */
  at?: number | null;
  /** 例如「自动开局」「进入下一阶段」 */
  label: string;
  /** 是否显示「系统自动主持」前缀 */
  showPrefix?: boolean;
  compact?: boolean;
};

/**
 * 系统自动主持倒计时。
 * 用本地时钟平滑显示，服务端每次广播的 autoHostNextActionAt 会校正误差。
 */
export const AutoHostCountdown: React.FC<Props> = ({
  at,
  label,
  showPrefix = true,
  compact = false,
}) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (at == null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [at]);

  if (at == null) return null;
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: compact ? "0.2rem 0.5rem" : "0.35rem 0.7rem",
        borderRadius: "9999px",
        background: "rgba(56,189,248,0.1)",
        border: "1px solid rgba(56,189,248,0.28)",
        color: "#7dd3fc",
        fontSize: uiRem(compact ? 0.72 : 0.8),
        fontWeight: 700,
        lineHeight: 1.35,
      }}
    >
      <span aria-hidden>🤖</span>
      {showPrefix && <span>系统自动主持</span>}
      <span>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          color: "#bae6fd",
          fontWeight: 800,
          minWidth: "2.2em",
          textAlign: "right",
        }}
      >
        {seconds}s
      </span>
    </div>
  );
};
