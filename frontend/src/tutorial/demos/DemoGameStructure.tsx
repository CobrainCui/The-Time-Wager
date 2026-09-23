import React, { useState } from "react";
import { uiRem } from "../../utils/typography";

const ERA_LABELS = ["青年", "壮年", "中年", "老年"];

const CELL_HINTS: Record<string, string> = {
  "0-0": "新时代开场：主持人介绍时代主题，玩家了解本时代加成。",
  "0-1": "第 1 轮：讨论 → 道具 → 投资 → 结算。",
  "1-0": "第 2 轮：精力重置，重新分配投资。",
  "1-1": "时代末轮结算后，可能进入拍卖与 Buff 获取。",
  "2-0": "财富较少者优先选座，决定长期项目占位顺序。",
  "2-1": "重复讨论、投资循环，财富排名不断变化。",
  "3-0": "后期时代风险项目与长期断供压力更大。",
  "3-1": "四轮结束后首富为社区命名，游戏收官。",
};

export const DemoGameStructure: React.FC = () => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div>
      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "1rem" }}>
        点击格子查看该阶段大致流程（4 时代 × 每时代 2 轮）：
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
        {ERA_LABELS.map((era, eraIdx) => (
          <div key={era} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            <div
              style={{
                textAlign: "center",
                fontSize: uiRem(0.7),
                fontWeight: 700,
                color: "#a78bfa",
                marginBottom: "0.25rem",
              }}
            >
              {era}
            </div>
            {[0, 1].map((round) => {
              const key = `${eraIdx}-${round}`;
              const active = selected === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  style={{
                    padding: "0.65rem 0.25rem",
                    borderRadius: "0.5rem",
                    border: `1px solid ${active ? "#60a5fa" : "var(--color-border)"}`,
                    background: active ? "rgba(59,130,246,0.15)" : "var(--color-bg-card)",
                    color: active ? "#93c5fd" : "var(--color-text-secondary)",
                    fontSize: uiRem(0.75),
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  第 {round + 1} 轮
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: "1rem",
          padding: "0.875rem",
          borderRadius: "0.75rem",
          background: "rgba(0,0,0,0.25)",
          border: "1px solid rgba(255,255,255,0.06)",
          fontSize: uiRem(0.85),
          color: "var(--color-text-secondary)",
          lineHeight: 1.55,
          minHeight: "3.5rem",
        }}
      >
        {selected ? CELL_HINTS[selected] : "👆 选一个格子开始探索游戏节奏"}
      </div>
    </div>
  );
};
