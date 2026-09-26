import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { TYPE_COLORS } from "../components/ProjectCard";
import { TUTORIAL_SLIDES } from "../tutorialData";
import { TutorialDemoShell } from "./TutorialDemoShell";
import { TUTORIAL_DEMO_BY_KEY } from "./tutorialDemos";

const PROJECT_TYPE_LINE_KEY: Record<string, keyof typeof TYPE_COLORS> = {
  短期项目: "short",
  长期项目: "long",
  风险项目: "risk",
};

function renderTutorialLine(line: string) {
  const match = line.match(/^(短期项目|长期项目|风险项目)：(.+)$/);
  if (!match) return { bullet: "•", body: line, accent: "#60a5fa" as const };

  const label = match[1];
  const typeKey = PROJECT_TYPE_LINE_KEY[label];
  const color = TYPE_COLORS[typeKey].border;
  return {
    swatch: color,
    body: (
      <>
        <strong style={{ color }}>{label}</strong>
        <span style={{ color: "var(--color-text-secondary)" }}>：{match[2]}</span>
      </>
    ),
  };
}

export interface TutorialSlidePanelProps {
  step: number;
  playerName?: string;
  /** 例如玩家端：「请听主持人讲解」；Admin 不传则只显示页码 */
  footerHint?: string;
  /** Admin inline 时略紧凑 */
  compact?: boolean;
  /** 玩家端桌面一屏：flex 分区 + 紧凑 demo */
  fitViewport?: boolean;
  /** 外层已有页码时隐藏底部 n/total */
  hidePageFooter?: boolean;
}

export const TutorialSlidePanel: React.FC<TutorialSlidePanelProps> = ({
  step: rawStep,
  playerName = "玩家",
  footerHint,
  compact = false,
  fitViewport = false,
  hidePageFooter = false,
}) => {
  const total = TUTORIAL_SLIDES.length;
  const step = Math.min(Math.max(rawStep, 0), total - 1);
  const slide = TUTORIAL_SLIDES[step];
  const progress = ((step + 1) / total) * 100;
  const [demoResetKey, setDemoResetKey] = useState(0);

  useEffect(() => {
    setDemoResetKey(0);
  }, [step]);

  const DemoComponent = slide.demoKey ? TUTORIAL_DEMO_BY_KEY[slide.demoKey] : undefined;
  const isFinale = Boolean(slide.finale);

  const iconSize = isFinale
    ? fitViewport
      ? "3.75rem"
      : compact
        ? "3.75rem"
        : "5rem"
    : fitViewport
      ? "2.5rem"
      : compact
        ? "3rem"
        : "4rem";
  const titleSize = isFinale
    ? fitViewport
      ? "2.05rem"
      : compact
        ? "2rem"
        : "2.75rem"
    : fitViewport
      ? "1.5rem"
      : compact
        ? "1.75rem"
        : "2.25rem";
  const contentPadding = isFinale
    ? fitViewport
      ? "1.75rem 1.5rem"
      : compact
        ? "1.75rem 1.5rem"
        : "3rem 2.5rem"
    : fitViewport
      ? "1.5rem 1.25rem"
      : compact
        ? "1.5rem 1.25rem"
        : "2.5rem 2rem";
  const iconMb = isFinale ? (fitViewport ? "0.85rem" : "1.35rem") : fitViewport ? "0.5rem" : compact ? "1rem" : "1.25rem";
  const titleMb = isFinale ? (fitViewport ? "1rem" : "1.5rem") : fitViewport ? "0.65rem" : compact ? "1rem" : "1.5rem";
  const lineFont = isFinale ? uiRem(fitViewport ? 1.1 : 1.15) : fitViewport ? uiRem(0.9) : uiRem(1);
  const linePad = isFinale ? "0.55rem 0" : fitViewport ? "0.35rem 0" : "0.5rem 0";
  const copyPadding = isFinale
    ? fitViewport
      ? "1.35rem 1.5rem"
      : "1.5rem 1.75rem"
    : fitViewport
      ? "0.75rem"
      : "1.25rem";
  const dotsMt = isFinale ? (fitViewport ? "1rem" : "1.75rem") : fitViewport ? "0.65rem" : "1.5rem";
  const footerMt = fitViewport ? "0.5rem" : "1rem";
  const footerFont = isFinale ? uiRem(0.9) : uiRem(0.8);
  const bulletFont = isFinale ? uiRem(1.05) : undefined;

  const copyBlock = (
    <div
      className={
        fitViewport
          ? `tutorial-slide-panel__copy${isFinale ? " tutorial-slide-panel__copy--finale" : ""}`
          : isFinale
            ? "tutorial-slide-panel__copy--finale"
            : undefined
      }
      style={{
        background: "rgba(0,0,0,0.25)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: fitViewport ? "0.75rem" : "1rem",
        padding: copyPadding,
        textAlign: "left",
        marginBottom: fitViewport ? 0 : "0.5rem",
      }}
    >
      {slide.content.map((line, i) => {
        const rendered = renderTutorialLine(line);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: fitViewport ? "0.5rem" : "0.75rem",
              padding: linePad,
              borderBottom: i < slide.content.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              alignItems: "flex-start",
            }}
          >
            {rendered.swatch ? (
              <span
                aria-hidden
                style={{
                  width: "0.75rem",
                  height: "0.75rem",
                  borderRadius: "0.2rem",
                  background: rendered.swatch,
                  flexShrink: 0,
                  marginTop: "0.35rem",
                  boxShadow: `0 0 0 1px ${rendered.swatch}55`,
                }}
              />
            ) : (
              <span
                style={{
                  color: rendered.accent,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: "0.1rem",
                  fontSize: bulletFont,
                }}
              >
                {rendered.bullet}
              </span>
            )}
            <span style={{ fontSize: lineFont, lineHeight: fitViewport ? 1.45 : 1.6 }}>
              {typeof rendered.body === "string" ? (
                <span style={{ color: "var(--color-text-secondary)" }}>{rendered.body}</span>
              ) : (
                rendered.body
              )}
            </span>
          </div>
        );
      })}
    </div>
  );

  const demoBlock =
    DemoComponent &&
    (fitViewport ? (
      <div className="tutorial-slide-panel__demo">
        <TutorialDemoShell dense onReset={() => setDemoResetKey((k) => k + 1)}>
          <div key={`${step}-${demoResetKey}`} className="tutorial-slide-panel__demo-inner">
            <DemoComponent playerName={playerName} />
          </div>
        </TutorialDemoShell>
      </div>
    ) : (
      <TutorialDemoShell onReset={() => setDemoResetKey((k) => k + 1)}>
        <div key={`${step}-${demoResetKey}`}>
          <DemoComponent playerName={playerName} />
        </div>
      </TutorialDemoShell>
    ));

  const footerBlock = (
    <>
      <div
        className={fitViewport ? "tutorial-slide-panel__dots" : undefined}
        style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", marginTop: dotsMt }}
      >
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

      {!hidePageFooter && (
        <div style={{ marginTop: footerMt, fontSize: footerFont, color: "var(--color-text-muted)" }}>
          {footerHint ? `${footerHint} · ${step + 1} / ${total}` : `${step + 1} / ${total}`}
        </div>
      )}
    </>
  );

  return (
    <>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        教程第 {step + 1} 页，共 {total} 页：{slide.title}
      </div>

      <div
        className={
          fitViewport
            ? `tutorial-slide-panel tutorial-slide-panel--fit${DemoComponent ? "" : " tutorial-slide-panel--no-demo"}${isFinale ? " tutorial-slide-panel--finale" : ""}`
            : `tutorial-slide-panel${isFinale ? " tutorial-slide-panel--finale" : ""}`
        }
        data-demo-key={slide.demoKey ?? "none"}
        style={
          fitViewport
            ? { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, maxHeight: "100%", width: "100%" }
            : undefined
        }
      >
        <div style={{ width: "100%", height: "3px", background: "rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: "linear-gradient(90deg, #3b82f6, #a855f7)",
              transition: "width 0.5s ease",
            }}
          />
        </div>

        {fitViewport ? (
          <div className="tutorial-slide-panel__body" style={{ textAlign: "center" }}>
            <div className="tutorial-slide-panel__header">
              <div
                style={{
                  fontSize: iconSize,
                  marginBottom: iconMb,
                  animation: "float 3s ease-in-out infinite",
                }}
              >
                {slide.icon}
              </div>
              <h1
                style={{
                  fontSize: titleSize,
                  fontWeight: 900,
                  background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                  marginBottom: titleMb,
                  lineHeight: 1.2,
                }}
              >
                {slide.title}
              </h1>
            </div>
            {copyBlock}
            {demoBlock}
            <div className="tutorial-slide-panel__footer">{footerBlock}</div>
          </div>
        ) : (
          <div style={{ padding: contentPadding, textAlign: "center" }}>
            <div
              style={{
                fontSize: iconSize,
                marginBottom: iconMb,
                animation: "float 3s ease-in-out infinite",
              }}
            >
              {slide.icon}
            </div>

            <h1
              style={{
                fontSize: titleSize,
                fontWeight: 900,
                background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                marginBottom: titleMb,
                lineHeight: 1.2,
              }}
            >
              {slide.title}
            </h1>

            {copyBlock}
            {demoBlock}
            {footerBlock}
          </div>
        )}
      </div>
    </>
  );
};
