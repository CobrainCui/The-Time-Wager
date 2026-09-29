import React, { useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import { ProjectCard } from "../../components/ProjectCard";
import { ProjectDetailModal } from "../../components/ProjectDetailModal";
import { TUTORIAL_ERA_OPTIONS, TUTORIAL_ERA_SAMPLE_PROJECT, createTutorialPlayer } from "../tutorialMock";

const DEMO_ERA = TUTORIAL_ERA_OPTIONS.find((e) => e.era === "气候") ?? TUTORIAL_ERA_OPTIONS[0];

const sidePanelStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "0.75rem",
  padding: "0.9rem 1rem",
  borderRadius: "0.75rem",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(0,0,0,0.2)",
  fontSize: uiRem(0.95),
  lineHeight: 1.55,
  color: "var(--color-text-secondary)",
  textAlign: "left",
};

/** 与 ProjectCard 时代 UP 标签同款，教程讲解用不闪烁 */
const EraUpBadge: React.FC = () => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      background: "rgba(245,158,11,0.85)",
      borderRadius: "9999px",
      padding: "0.15rem 0.5rem",
      fontSize: uiRem(0.7),
      fontWeight: 700,
      color: "#1a1000",
      boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
      verticalAlign: "middle",
      lineHeight: 1.2,
    }}
  >
    🔥 时代UP
  </span>
);

export const DemoEraTheme: React.FC = () => {
  const [invest, setInvest] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const me = useMemo(() => createTutorialPlayer({ energy: 10 }), []);
  const sampleProject = { ...TUTORIAL_ERA_SAMPLE_PROJECT, era: "气候" as const };

  return (
    <div className="tutorial-era-theme-demo">
      <div className="tutorial-era-theme-demo__row">
        <aside className="tutorial-era-theme-demo__side" style={sidePanelStyle}>
          <div style={{ fontWeight: 800, color: "#6ee7b7", fontSize: uiRem(1.1) }}>
            🌍 {DEMO_ERA.name}
          </div>
          <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>
            第 1 时代 · 主题【{DEMO_ERA.era}】
          </div>
          <p style={{ margin: 0 }}>{DEMO_ERA.description}</p>
          <p style={{ margin: 0, color: "#93c5fd", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem" }}>
            <span>与主题契合的项目会显示</span>
            <EraUpBadge />
          </p>
        </aside>

        <div className="tutorial-era-theme-demo__card">
          <ProjectCard
            project={sampleProject}
            myInvest={invest}
            onChange={(_, v) => setInvest(v)}
            disabled={false}
            remainingEnergy={me.energy - invest}
            eraTheme={DEMO_ERA.era}
            me={me}
            onOpenDetail={() => setDetailOpen(true)}
          />
        </div>

        <aside className="tutorial-era-theme-demo__side" style={sidePanelStyle}>
          <div style={{ fontWeight: 800, color: "#fbbf24", fontSize: uiRem(1.1) }}>时代加成</div>
          <p style={{ margin: 0 }}>短期：恰好满额，该项目总投入第一 → +30 💰</p>
          <p style={{ margin: 0 }}>长期：满额或超填，该项目总投入第一 → +50 💰</p>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
            短期投爆、风险项目：无时代加成。并列第 1 则均分。
          </p>
        </aside>
      </div>

      <ProjectDetailModal
        project={detailOpen ? sampleProject : null}
        eraTheme={DEMO_ERA.era}
        playerCount={6}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
};
