import React from "react";
import { GameState, Player } from "../types";
import { TUTORIAL_SLIDES } from "../tutorialData";

interface Props { game: GameState; me: Player; }

export const TutorialView: React.FC<Props> = ({ game }) => {
  const step = game.tutorialStep || 0;
  const slide = TUTORIAL_SLIDES[step] || TUTORIAL_SLIDES[0];
  const total = TUTORIAL_SLIDES.length;
  const progress = ((step + 1) / total) * 100;

  return (
    <div
      className="page-center"
      style={{
        background: `radial-gradient(ellipse at 50% 30%, rgba(59,130,246,0.1) 0%, transparent 60%), #070b14`,
        minHeight: "100vh",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: "760px",
          width: "100%",
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "1.5rem",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        }}
        className="animate-scaleIn"
      >
        {/* 进度条 */}
        <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.06)" }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, #3b82f6, #a855f7)",
              transition: "width 0.5s ease",
            }}
          />
        </div>

        <div style={{ padding: "3rem 2.5rem", textAlign: "center" }}>
          {/* 图标 */}
          <div style={{ fontSize: "4.5rem", marginBottom: "1.5rem", animation: "float 3s ease-in-out infinite" }}>
            {slide.icon}
          </div>

          {/* 标题 */}
          <h1
            style={{
              fontSize: "2.5rem",
              fontWeight: 900,
              background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "2rem",
              lineHeight: 1.2,
            }}
          >
            {slide.title}
          </h1>

          {/* 内容 */}
          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "1rem",
              padding: "1.5rem",
              textAlign: "left",
              marginBottom: "2rem",
            }}
          >
            {slide.content.map((line, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  padding: "0.5rem 0",
                  borderBottom: i < slide.content.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ color: "#60a5fa", fontWeight: 700, flexShrink: 0, marginTop: "0.1rem" }}>•</span>
                <span style={{ color: "var(--color-text-secondary)", fontSize: "1rem", lineHeight: 1.6 }}>{line}</span>
              </div>
            ))}
          </div>

          {/* 底部进度 */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
            {Array.from({ length: total }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: i === step ? "1.5rem" : "0.375rem",
                  height: "0.375rem",
                  borderRadius: "9999px",
                  background: i === step ? "#60a5fa" : "rgba(255,255,255,0.15)",
                  transition: "all 0.3s ease",
                }}
              />
            ))}
          </div>

          <div style={{ marginTop: "1rem", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
            请听主持人讲解 · {step + 1} / {total}
          </div>
        </div>
      </div>
    </div>
  );
};
