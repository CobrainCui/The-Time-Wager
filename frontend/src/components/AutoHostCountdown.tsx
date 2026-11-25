import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { useServerClockSkewRef } from "../hooks/useServerClockSkewRef";
import { computeClockSkewMs } from "../utils/actionCountdown";

type Props = {
  /** 目标时间戳；为空则不显示 */
  at?: number | null;
  /** 服务端基准时间戳，用于校准本地时钟偏移 */
  serverNow?: number;
  /** 例如「自动开局」「进入下一阶段」 */
  label: string;
  /** 是否显示「系统自动主持」前缀 */
  showPrefix?: boolean;
  compact?: boolean;
};

function calcCountdownSeconds(at: number | null | undefined, skewMs: number): number {
  if (at == null) return 0;
  return Math.max(0, Math.ceil((at - (Date.now() + skewMs)) / 1000));
}

/**
 * 系统自动主持倒计时。
 * 用服务端 serverNow 校准本地时钟偏移，服务端每次广播的 autoHostNextActionAt 会即时同步。
 */
export const AutoHostCountdown: React.FC<Props> = ({
  at,
  serverNow,
  label,
  showPrefix = true,
  compact = false,
}) => {
  const skewRef = useServerClockSkewRef(serverNow);
  const [seconds, setSeconds] = useState(() =>
    calcCountdownSeconds(at, serverNow != null ? computeClockSkewMs(serverNow) : 0)
  );

  useEffect(() => {
    if (at == null) return;
    const sync = () => setSeconds(calcCountdownSeconds(at, skewRef.current));
    const immediate = setTimeout(sync, 0);
    const timer = setInterval(sync, 500);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [at, serverNow, skewRef]);

  if (at == null) return null;

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
