import React, { useEffect, useState } from "react";
import { BACKEND_URL } from "../socket";
import { BUFF_CARD_DEFS } from "../config/buffCards";
import { uiRem } from "../utils/typography";

interface Props {
  cardId: string;
  buffImages?: Record<string, number>;
  compact?: boolean;
  onImageBroken?: () => void;
}

export const BuffCardArt: React.FC<Props> = ({ cardId, buffImages = {}, compact, onImageBroken }) => {
  const def = BUFF_CARD_DEFS[cardId] || { name: cardId, desc: "", icon: "🃏", color: "#a855f7" };
  const v = buffImages[cardId];
  const hasImage = v != null && v > 0;
  const [broken, setBroken] = useState(false);
  const showImage = hasImage && !broken;

  useEffect(() => {
    setBroken(false);
  }, [cardId, v]);

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "3 / 4",
        borderRadius: compact ? "0.625rem" : "0.875rem",
        overflow: "hidden",
        background: "rgba(0,0,0,0.35)",
        border: `1px solid ${def.color}44`,
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {showImage ? (
        <img
          src={`${BACKEND_URL}/uploads_buffs/${cardId}.jpg?v=${v}`}
          alt={def.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => {
            setBroken(true);
            onImageBroken?.();
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            padding: "0.75rem",
            color: "var(--color-text-muted)",
          }}
        >
          <span style={{ fontSize: compact ? "2rem" : "2.75rem" }}>{def.icon}</span>
          <span style={{ fontSize: uiRem(0.7), textAlign: "center" }}>暂无卡面</span>
        </div>
      )}
    </div>
  );
};
