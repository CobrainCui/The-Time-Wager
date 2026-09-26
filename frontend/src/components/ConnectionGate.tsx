import React from "react";
import { uiRem } from "../utils/typography";

interface Props {
  connected: boolean;
  error: string | null;
  onRetry: () => void;
  /** admin 子域提示更具体 */
  variant?: "player" | "admin";
  children: React.ReactNode;
}

export const ConnectionGate: React.FC<Props> = ({
  connected,
  error,
  onRetry,
  variant = "player",
  children,
}) => {
  if (connected) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#070b14",
        flexDirection: "column",
        gap: "1rem",
        padding: "1.5rem",
        textAlign: "center",
      }}
    >
      {!error ? (
        <>
          <div
            style={{
              width: "3rem",
              height: "3rem",
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.1)",
              borderTopColor: "#3b82f6",
              animation: "spin 1s linear infinite",
            }}
          />
          <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(1) }}>正在连接服务器...</div>
        </>
      ) : (
        <>
          <div style={{ color: "#f87171", fontSize: uiRem(1.05), fontWeight: 700, maxWidth: "28rem" }}>
            {error}
          </div>
          {variant === "admin" && (
            <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85), maxWidth: "32rem", lineHeight: 1.6 }}>
              管理后台与玩家站需反代到<strong style={{ color: "var(--color-text-secondary)" }}>同一</strong> Node 进程。
              宝塔请在 admin 站点配置与主站相同的 <code style={{ fontFamily: "var(--font-mono)" }}>/socket.io/</code> 与{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>/api/</code>。
            </p>
          )}
          <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
            重试连接
          </button>
        </>
      )}
    </div>
  );
};
