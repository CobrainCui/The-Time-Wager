import React from "react";
import { uiRem } from "../../utils/typography";

/** 演示：投入并列时共享名次奖励 / 时代加成 */
export const DemoTiedRank: React.FC = () => {
  return (
    <div className="tutorial-tied-rank" style={{ fontSize: uiRem(1.05), color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
      <p style={{ marginBottom: "0.75rem" }}>
        假设排名奖励为 <strong style={{ color: "var(--color-text)" }}>[65, 45, 35]</strong>，时代加成长期 +50：
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.65rem",
          padding: "1rem 1.15rem",
          borderRadius: "0.75rem",
          border: "1px solid var(--color-border)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <div>
          玩家甲 · 玩家乙 各投 <strong style={{ color: "#86efac" }}>20</strong>（并列第 1）
          <div style={{ marginTop: "0.3rem", color: "#c4b5fd", fontSize: uiRem(0.98) }}>
            共享 (65+45)/2 → 各 +55；时代 (50)/2 → 各 +25
          </div>
        </div>
        <div>
          玩家丙 投 <strong style={{ color: "#86efac" }}>10</strong>（第 3 名档）
          <div style={{ marginTop: "0.3rem", color: "#94a3b8", fontSize: uiRem(0.98) }}>
            独享 35，无时代加成
          </div>
        </div>
      </div>
      <p style={{ marginTop: "0.75rem", fontSize: uiRem(0.95), color: "var(--color-text-muted)" }}>
        短期超上限投爆时，并列同样均分对应档位的惩罚池。
      </p>
    </div>
  );
};
