import React from "react";
import { uiRem } from "../utils/typography";

interface Props {
  count: number;
  disabled?: boolean;
  onOpenUnsubscribe: () => void;
}

export const CoffeeRoundIndicators: React.FC<Props> = ({ count, disabled, onOpenUnsubscribe }) => {
  if (count <= 0) return null;

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className="coffee-round-indicator"
          title="咖啡退订"
          aria-label="咖啡退订"
          disabled={disabled}
          onClick={onOpenUnsubscribe}
          style={{
            minHeight: "2.75rem",
            minWidth: "2.75rem",
            padding: "0.15rem 0.35rem",
            border: "none",
            background: "transparent",
            cursor: disabled ? "default" : "pointer",
            fontSize: uiRem(1.15),
            lineHeight: 1,
            opacity: disabled ? 0.45 : 1,
          }}
        >
          ☕
        </button>
      ))}
    </>
  );
};
