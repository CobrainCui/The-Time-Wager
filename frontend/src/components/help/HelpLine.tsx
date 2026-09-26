import React from "react";
import { uiRem } from "../../utils/typography";

export const HelpLine: React.FC<{ icon: string; children: React.ReactNode }> = ({ icon, children }) => (
  <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", padding: "0.35rem 0" }}>
    <span aria-hidden style={{ flexShrink: 0, fontSize: uiRem(1.05) }}>
      {icon}
    </span>
    <span style={{ color: "var(--color-text-secondary)", fontSize: uiRem(0.88), lineHeight: 1.5 }}>{children}</span>
  </div>
);
