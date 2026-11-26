import React, { useState } from "react";
import { uiRem } from "../../utils/typography";

interface HelpTooltipProps {
  title?: string;
  content: string;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ title, content }) => {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        verticalAlign: "middle",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={title ? `${title}说明` : "查看解释"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onBlur={() => {
          setPinned(false);
          setHovered(false);
        }}
        style={{
          width: "1.1rem",
          height: "1.1rem",
          borderRadius: "9999px",
          border: open ? "1px solid #fbbf24" : "1px solid rgba(148,163,184,0.55)",
          background: open ? "rgba(251,191,36,0.22)" : "rgba(30,41,59,0.85)",
          color: open ? "#fde68a" : "#cbd5e1",
          fontSize: uiRem(0.68),
          fontWeight: 800,
          lineHeight: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
        }}
      >
        ?
      </button>

      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.45rem)",
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(290px, 75vw)",
            padding: "0.65rem 0.75rem",
            borderRadius: "0.65rem",
            background: "#0f172a",
            border: "1px solid rgba(251,191,36,0.55)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.7)",
            color: "#e2e8f0",
            fontSize: uiRem(0.74),
            lineHeight: 1.55,
            whiteSpace: "pre-line",
            textAlign: "left",
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          {title && (
            <div style={{ fontWeight: 800, color: "#fbbf24", marginBottom: "0.25rem" }}>
              {title}
            </div>
          )}
          <div>{content}</div>
        </div>
      )}
    </span>
  );
};
