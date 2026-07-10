import React from "react";
import { GameState, Player } from "../types";
import { socket } from "../socket";

interface Props {
  game: GameState;
  me: Player;
}

const ERA_NAMES: Record<number, string> = { 1: "青年", 2: "壮年", 3: "中年", 4: "老年" };
const ERA_ICONS: Record<number, string> = { 1: "🌱", 2: "⚡", 3: "🏔️", 4: "🌙" };

const ERA_GRADIENTS: Record<string, string> = {
  green:  "linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(5,150,105,0.08) 100%)",
  blue:   "linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(37,99,235,0.08) 100%)",
  red:    "linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(185,28,28,0.08) 100%)",
  orange: "linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(194,65,12,0.08) 100%)",
  yellow: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(109,40,217,0.08) 100%)",
};

const ERA_COLORS: Record<string, string> = {
  green: "#10b981", blue: "#3b82f6", red: "#ef4444", orange: "#f97316", yellow: "#a855f7",
};

export const EraIntro: React.FC<Props> = ({ game, me }) => {
  const card = game.currentEraCard;
  const eraColor = card ? (ERA_COLORS[card.themeColor] || "#60a5fa") : "#60a5fa";
  const eraGradient = card ? (ERA_GRADIENTS[card.themeColor] || ERA_GRADIENTS.blue) : ERA_GRADIENTS.blue;
  const eraNum = game.currentEra;
  const readyCount = game.readyPlayers?.length ?? 0;

  return (
    <div
      className="page-center flex-col"
      style={{
        background: `
          radial-gradient(ellipse at 50% 0%, ${eraColor}22 0%, transparent 60%),
          #070b14
        `,
        minHeight: "100vh",
        padding: "2rem 1rem",
        textAlign: "center",
      }}
    >
      {/* 时代标识 */}
      <div className="animate-slideDown" style={{ marginBottom: "2rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.5rem", animation: "float 3s ease-in-out infinite" }}>
          {ERA_ICONS[eraNum] || "⏳"}
        </div>
        <div style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
          第 {eraNum} 时代 · 第 {game.roundInEra} 轮
        </div>
        <div
          style={{
            fontSize: "4rem",
            fontWeight: 900,
            background: `linear-gradient(135deg, ${eraColor}, white)`,
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            lineHeight: 1.1,
          }}
        >
          {ERA_NAMES[eraNum] || "新时代"}
        </div>
      </div>

      {/* 时代卡展示 */}
      {card && (
        <div
          className="animate-scaleIn"
          style={{
            background: eraGradient,
            border: `1px solid ${eraColor}44`,
            borderRadius: "1.5rem",
            padding: "2rem",
            maxWidth: "600px",
            width: "100%",
            boxShadow: `0 0 40px ${eraColor}22`,
            marginBottom: "2.5rem",
          }}
        >
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 900,
              color: eraColor,
              marginBottom: "0.75rem",
            }}
          >
            {card.name}
          </div>
          <div
            style={{
              fontSize: "1.1rem",
              color: "var(--color-text-secondary)",
              fontStyle: "italic",
              marginBottom: "1.25rem",
              lineHeight: 1.6,
            }}
          >
            "{card.description}"
          </div>
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: "0.75rem",
              padding: "0.875rem 1.25rem",
              fontSize: "0.85rem",
              color: "var(--color-text-secondary)",
              lineHeight: 1.6,
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            📢 时代加成：本时代所有{" "}
            <span style={{ color: eraColor, fontWeight: 700 }}>【{card.era}】</span>{" "}
            主题的短期/长期项目，结算时第一名额外奖励财富。
          </div>
        </div>
      )}

      {/* 玩家状态 */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", justifyContent: "center" }}>
        <div
          style={{
            background: "rgba(52,211,153,0.1)",
            border: "1px solid rgba(52,211,153,0.25)",
            borderRadius: "9999px",
            padding: "0.5rem 1.25rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: "#34d399",
          }}
        >
          ⚡ 精力 {me.energy}
        </div>
        <div
          style={{
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.25)",
            borderRadius: "9999px",
            padding: "0.5rem 1.25rem",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            color: "#fbbf24",
          }}
        >
          💰 财富 {me.wealth}
        </div>
        {me.draftOrder && (
          <div
            style={{
              background: "rgba(168,85,247,0.1)",
              border: "1px solid rgba(168,85,247,0.25)",
              borderRadius: "9999px",
              padding: "0.5rem 1.25rem",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              color: "#c084fc",
            }}
          >
            💺 座次 #{me.draftOrder}
          </div>
        )}
      </div>

      {/* 准备按钮 */}
      {me.ready ? (
        <div
          className="animate-pulse"
          style={{
            color: "#4ade80",
            fontWeight: 700,
            fontSize: "1.1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ width: "0.75rem", height: "0.75rem", borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
          已准备，等待其他玩家...
        </div>
      ) : (
        <button
          onClick={() => socket.emit("playerReady")}
          className="btn btn-lg"
          style={{
            background: `linear-gradient(135deg, ${eraColor}, ${eraColor}aa)`,
            color: "white",
            padding: "1rem 3rem",
            fontSize: "1.1rem",
            boxShadow: `0 8px 30px ${eraColor}44`,
            border: "none",
          }}
        >
          我准备好了 ✓
        </button>
      )}

      {/* 等待进度 */}
      <div
        style={{
          marginTop: "1.5rem",
          fontSize: "0.8rem",
          color: "var(--color-text-muted)",
        }}
      >
        已准备 {readyCount} / {game.players.length} 人
      </div>
    </div>
  );
};
