import React from "react";
import { uiRem } from "../utils/typography";

interface Props {
  children: React.ReactNode;
  onReset?: () => void;
}

export const TutorialDemoShell: React.FC<Props> = ({ children, onReset }) => (
  <div
    style={{
      marginTop: "1.5rem",
      textAlign: "left",
      background: "rgba(59,130,246,0.06)",
      border: "1px solid rgba(59,130,246,0.2)",
      borderRadius: "1rem",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontWeight: 800, color: "#93c5fd", fontSize: uiRem(0.95) }}>🎮 动手试一试</div>
        <div style={{ fontSize: uiRem(0.75), color: "var(--color-text-muted)", marginTop: "0.15rem" }}>
          试玩数据不会上传或影响本局对局
        </div>
      </div>
      {onReset && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          重置试玩
        </button>
      )}
    </div>
    <div style={{ padding: "1rem", maxHeight: "min(52vh, 520px)", overflowY: "auto" }}>{children}</div>
  </div>
);
