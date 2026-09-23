import React, { useState } from "react";
import { uiRem } from "../../utils/typography";
import { EraThemeBanner } from "../../components/EraThemeBanner";
import { ProjectCard } from "../../components/ProjectCard";
import { TUTORIAL_ERA_OPTIONS, TUTORIAL_ERA_SAMPLE_PROJECT, createTutorialPlayer } from "../tutorialMock";

export const DemoEraTheme: React.FC = () => {
  const [eraIdx, setEraIdx] = useState(0);
  const [invest, setInvest] = useState(0);
  const eraCard = TUTORIAL_ERA_OPTIONS[eraIdx];
  const me = createTutorialPlayer({ energy: 10 });

  return (
    <div>
      <label style={{ display: "block", fontSize: uiRem(0.8), color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
        切换时代主题看横幅与项目高亮：
      </label>
      <select
        className="input"
        value={eraIdx}
        onChange={(e) => setEraIdx(Number(e.target.value))}
        style={{ marginBottom: "1rem", maxWidth: "100%" }}
      >
        {TUTORIAL_ERA_OPTIONS.map((e, i) => (
          <option key={e.id} value={i}>
            {e.era} — {e.name}
          </option>
        ))}
      </select>

      <EraThemeBanner eraCard={eraCard} currentEra={eraIdx + 1} compact />

      <div style={{ marginTop: "1rem", maxWidth: "320px" }}>
        <ProjectCard
          project={{ ...TUTORIAL_ERA_SAMPLE_PROJECT, era: "气候" }}
          myInvest={invest}
          onChange={(_, v) => setInvest(v)}
          disabled={false}
          remainingEnergy={me.energy - invest}
          eraTheme={eraCard.era}
          me={me}
        />
      </div>
      <p style={{ marginTop: "0.75rem", fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>
        当项目主题与时代一致时出现「时代 UP」角标（风险项目不参与加成）。
      </p>
    </div>
  );
};
