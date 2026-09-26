import React, { useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import { EraThemeBanner } from "../../components/EraThemeBanner";
import { ProjectCard } from "../../components/ProjectCard";
import { TUTORIAL_ERA_OPTIONS, TUTORIAL_ERA_SAMPLE_PROJECT, createTutorialPlayer } from "../tutorialMock";

const DEMO_ERA = TUTORIAL_ERA_OPTIONS.find((e) => e.era === "气候") ?? TUTORIAL_ERA_OPTIONS[0];

export const DemoEraTheme: React.FC = () => {
  const [invest, setInvest] = useState(0);
  const me = useMemo(() => createTutorialPlayer({ energy: 10 }), []);

  return (
    <div>
      <EraThemeBanner eraCard={DEMO_ERA} currentEra={1} compact />

      <div style={{ marginTop: "1rem", maxWidth: "320px", marginLeft: "auto", marginRight: "auto" }}>
        <ProjectCard
          project={{ ...TUTORIAL_ERA_SAMPLE_PROJECT, era: "气候" }}
          myInvest={invest}
          onChange={(_, v) => setInvest(v)}
          disabled={false}
          remainingEnergy={me.energy - invest}
          eraTheme={DEMO_ERA.era}
          me={me}
        />
      </div>
      <p
        style={{
          marginTop: "0.75rem",
          fontSize: uiRem(0.8),
          color: "var(--color-text-muted)",
          lineHeight: 1.55,
          textAlign: "center",
        }}
      >
        主题一致显示「时代 UP」（短期/长期）。短期恰好满额或长期满/超：历史第 1 名获加成；短期爆掉与风险无。
      </p>
    </div>
  );
};
