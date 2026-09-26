import React, { useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import { ProjectCard } from "../../components/ProjectCard";
import {
  TUTORIAL_LONG_PROJECT,
  TUTORIAL_RISK_PROJECT,
  TUTORIAL_SHORT_PROJECT,
  createTutorialPlayer,
} from "../tutorialMock";

/** 与教程文案一致：试玩总精力池 */
const DEMO_ENERGY_POOL = 20;

export const DemoProjectTypes: React.FC = () => {
  const [investments, setInvestments] = useState<Record<number, number>>({});
  const riskPool = TUTORIAL_RISK_PROJECT.accumulatedInvested;

  const me = useMemo(
    () =>
      createTutorialPlayer({
        energy: DEMO_ENERGY_POOL,
        longTerm: {
          [TUTORIAL_LONG_PROJECT.id]: {
            projectId: TUTORIAL_LONG_PROJECT.id,
            totalInvested: 6,
            status: "active",
          },
        },
      }),
    []
  );

  const projects = [TUTORIAL_SHORT_PROJECT, TUTORIAL_LONG_PROJECT, TUTORIAL_RISK_PROJECT];
  const allocated = Object.values(investments).reduce((a, b) => a + b, 0);
  const remainingEnergy = me.energy - allocated;

  const riskInvest = investments[TUTORIAL_RISK_PROJECT.id] || 0;
  const riskTotal = riskPool + riskInvest;
  const riskOver = riskTotal > TUTORIAL_RISK_PROJECT.maxEnergy;

  const handleChange = (id: number, val: number) => {
    const next = Math.max(0, Math.floor(Number(val) || 0));
    setInvestments((prev) => {
      const otherSum = Object.entries(prev).reduce(
        (sum, [pid, amt]) => (Number(pid) === id ? sum : sum + (Number(amt) || 0)),
        0
      );
      const capped = Math.min(next, DEMO_ENERGY_POOL - otherSum);
      return { ...prev, [id]: capped };
    });
  };

  return (
    <div>
      <div
        className="status-bar"
        style={{ borderRadius: "0.75rem", marginBottom: "0.75rem", padding: "0.75rem 1rem" }}
      >
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: uiRem(1.1) }}>⚡</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: uiRem(1.2),
                color: remainingEnergy < 0 ? "#ef4444" : "#34d399",
              }}
            >
              {remainingEnergy}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>/ {me.energy}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: uiRem(1.1) }}>💰</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: uiRem(1.2), color: "#fbbf24" }}>
              {me.wealth}
            </span>
          </div>
        </div>
      </div>
      <div
        className="tutorial-project-types-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "1rem",
          alignItems: "stretch",
        }}
      >
        {projects.map((proj) => (
          <div key={proj.id} style={{ minWidth: 0, display: "flex" }}>
            <ProjectCard
              project={proj}
              myInvest={investments[proj.id] || 0}
              onChange={handleChange}
              disabled={false}
              remainingEnergy={remainingEnergy}
              me={me}
              balanceHeights
            />
          </div>
        ))}
      </div>

      {riskInvest > 0 && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            fontSize: uiRem(0.85),
            border: `1px solid ${riskOver ? "rgba(239,68,68,0.4)" : "rgba(59,130,246,0.25)"}`,
            background: riskOver ? "rgba(239,68,68,0.1)" : "rgba(59,130,246,0.08)",
            color: riskOver ? "#fca5a5" : "var(--color-text-secondary)",
          }}
        >
          风险项目试算：全场已有 {riskPool} + 你投入 {riskInvest} = {riskTotal} / 上限{" "}
          {TUTORIAL_RISK_PROJECT.maxEnergy}
          {riskOver ? " — 超过上限将触发倒扣历史收益！" : " — 尚未爆线。"}
        </div>
      )}

    </div>
  );
};
