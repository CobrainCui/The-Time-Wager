import React, { useState } from "react";
import { uiRem } from "../../utils/typography";

const INITIAL_ENERGY = 10;
const INITIAL_WEALTH = 100;

export const DemoResources: React.FC<{ playerName?: string }> = ({ playerName }) => {
  const [energyTotal, setEnergyTotal] = useState(INITIAL_ENERGY);
  const [spent, setSpent] = useState(0);
  const [wealth, setWealth] = useState(INITIAL_WEALTH);
  const [round, setRound] = useState(1);

  const remaining = energyTotal - spent;

  return (
    <div>
      <div
        className="status-bar"
        style={{ borderRadius: "0.75rem", marginBottom: "1rem", padding: "0.75rem 1rem" }}
      >
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: uiRem(0.85) }}>
            ⚡{" "}
            <span style={{ color: remaining < 0 ? "#ef4444" : "#34d399" }}>{remaining}</span>
            <span style={{ color: "var(--color-text-muted)", fontWeight: 600 }}> / </span>
            <span style={{ color: "var(--color-text-muted)", fontWeight: 700 }}>{energyTotal}</span>
          </span>
          <span>
            💰{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fbbf24" }}>{wealth}</span>
          </span>
          <span style={{ fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>试玩轮次 {round}</span>
        </div>
      </div>

      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
        {playerName ? `${playerName}，` : ""}拖动滑块模拟把精力投进项目（仅本地）：
      </p>
      <input
        type="range"
        min={0}
        max={energyTotal}
        value={spent}
        onChange={(e) => setSpent(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#3b82f6", marginBottom: "1rem" }}
      />

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={spent <= 0}
          onClick={() => {
            const gain = spent * 3;
            setWealth((w) => w + gain);
            setSpent(0);
          }}
        >
          模拟结算 (+{spent * 3} 💰)
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setRound((r) => r + 1);
            setSpent(0);
            setEnergyTotal(INITIAL_ENERGY);
          }}
        >
          进入下一轮（精力重置为 {INITIAL_ENERGY})
        </button>
      </div>
    </div>
  );
};
