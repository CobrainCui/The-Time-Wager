import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { TUTORIAL_SLIDES } from "../tutorialData";
import { TutorialDemoShell } from "../tutorial/TutorialDemoShell";
import { TUTORIAL_DEMO_BY_KEY } from "../tutorial/tutorialDemos";

interface Props {
  game: GameState;
  me: Player;
}

export const TutorialView: React.FC<Props> = ({ game, me }) => {
  const total = TUTORIAL_SLIDES.length;
  const rawStep = game.tutorialStep ?? 0;
  const step = Math.min(Math.max(rawStep, 0), total - 1);
  const slide = TUTORIAL_SLIDES[step];
  const progress = ((step + 1) / total) * 100;
  const [demoResetKey, setDemoResetKey] = useState(0);

  useEffect(() => {
    setDemoResetKey(0);
  }, [step]);

  const DemoComponent = slide.demoKey ? TUTORIAL_DEMO_BY_KEY[slide.demoKey] : undefined;

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
          maxWidth: "1000px",
          width: "100%",
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "1.5rem",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        }}
        className="animate-scaleIn"
      >
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

        <div style={{ padding: "2.5rem 2rem", textAlign: "center" }}>
          <div style={{ fontSize: "4rem", marginBottom: "1.25rem", animation: "float 3s ease-in-out infinite" }}>
            {slide.icon}
          </div>

          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 900,
              background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "1.5rem",
              lineHeight: 1.2,
            }}
          >
            {slide.title}
          </h1>

          <div
            style={{
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "1rem",
              padding: "1.25rem",
              textAlign: "left",
              marginBottom: "0.5rem",
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
                <span style={{ color: "var(--color-text-secondary)", fontSize: uiRem(1), lineHeight: 1.6 }}>{line}</span>
              </div>
            ))}
          </div>

          {DemoComponent && (
            <TutorialDemoShell onReset={() => setDemoResetKey((k) => k + 1)}>
              <div key={`${step}-${demoResetKey}`}>
                <DemoComponent playerName={me.name} />
              </div>
            </TutorialDemoShell>
          )}

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", marginTop: "1.5rem" }}>
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

          <div style={{ marginTop: "1rem", fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>
            请听主持人讲解 · {step + 1} / {total}
          </div>
        </div>
      </div>
    </div>
  );
};
