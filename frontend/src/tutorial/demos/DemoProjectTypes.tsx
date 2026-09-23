import React, { useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import { ProjectCard } from "../../components/ProjectCard";
import {
  TUTORIAL_LONG_PROJECT,
  TUTORIAL_RISK_PROJECT,
  TUTORIAL_SHORT_PROJECT,
  createTutorialPlayer,
} from "../tutorialMock";

export const DemoProjectTypes: React.FC = () => {
  const [investments, setInvestments] = useState<Record<number, number>>({});
  const riskPool = TUTORIAL_RISK_PROJECT.accumulatedInvested;

  const me = useMemo(
    () =>
      createTutorialPlayer({
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
    setInvestments((prev) => ({ ...prev, [id]: val }));
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: "1rem",
          overflowX: "auto",
          paddingBottom: "0.5rem",
          scrollSnapType: "x mandatory",
        }}
      >
        {projects.map((proj) => (
          <div key={proj.id} style={{ minWidth: "min(290px, 85vw)", flexShrink: 0, scrollSnapAlign: "start" }}>
            <ProjectCard
              project={proj}
              myInvest={investments[proj.id] || 0}
              onChange={handleChange}
              disabled={false}
              remainingEnergy={remainingEnergy + (investments[proj.id] || 0)}
              me={me}
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

      <p style={{ marginTop: "0.75rem", fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>
        长期项目已模拟为「参投中」：投入 1～2 精力会看到放弃警告；滑块会自动跳到 0 或 ≥3。
      </p>
    </div>
  );
};
