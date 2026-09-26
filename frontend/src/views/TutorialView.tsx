import React from "react";
import { GameState, Player } from "../types";
import { TutorialSlidePanel } from "../tutorial/TutorialSlidePanel";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface Props {
  game: GameState;
  me: Player;
}

export const TutorialView: React.FC<Props> = ({ game, me }) => {
  const step = game.tutorialStep ?? 0;
  const fitViewport = useMediaQuery("(min-width: 1024px)", true);

  return (
    <div
      className={`tutorial-view-shell${fitViewport ? " tutorial-view-shell--fit" : ""}`}
      style={{
        background: `radial-gradient(ellipse at 50% 30%, rgba(59,130,246,0.1) 0%, transparent 60%), #070b14`,
      }}
    >
      <div
        className="tutorial-view-card animate-scaleIn"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "1.5rem",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
        }}
      >
        <TutorialSlidePanel
          step={step}
          playerName={me.name}
          footerHint="请听主持人讲解"
          fitViewport={fitViewport}
        />
      </div>
    </div>
  );
};
