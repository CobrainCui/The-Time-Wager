import React, { useState } from "react";
import { uiRem } from "../../utils/typography";
import { TUTORIAL_NPCS, TUTORIAL_PLAYER_WEALTH } from "../tutorialMock";

export const DemoDrafting: React.FC<{ playerName?: string }> = ({ playerName }) => {
  const [mySeat, setMySeat] = useState<number | undefined>(undefined);
  const displayName = playerName || "你";

  const seats = [1, 2, 3, 4, 5, 6];

  const pickSeat = (seat: number) => {
    const npc = TUTORIAL_NPCS.find((n) => n.draftOrder === seat);
    if (npc || mySeat !== undefined) return;
    setMySeat(seat);
  };

  const queueLine = [
    ...TUTORIAL_NPCS.map((n) => `${n.name}(💰${n.wealth})`),
    `${displayName}(💰${TUTORIAL_PLAYER_WEALTH})`,
  ]
    .sort((a, b) => {
      const wealthOf = (s: string) => Number(s.match(/💰(\d+)/)?.[1] ?? 0);
      return wealthOf(a) - wealthOf(b);
    })
    .join(" → ");

  return (
    <div>
      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
        财富越少越先选座。NPC 已占 #1、#2，{displayName} 可点选剩余顺位：
      </p>
      <div className="grid grid-cols-3 gap-4 mb-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {seats.map((seatNum) => {
          const npc = TUTORIAL_NPCS.find((n) => n.draftOrder === seatNum);
          const isMe = mySeat === seatNum;
          const ownerName = isMe ? displayName : npc?.name;
          const isAvailable = !ownerName && mySeat === undefined;

          return (
            <button
              key={seatNum}
              type="button"
              disabled={!isAvailable}
              onClick={() => pickSeat(seatNum)}
              className={`seat-btn ${isAvailable ? "available" : "occupied"} ${isMe ? "my-seat" : ""}`}
              style={{
                border: "2px solid",
                borderColor: isMe ? "#f59e0b" : isAvailable ? "#10b981" : "rgba(59,130,246,0.35)",
                background: isMe ? "rgba(245,158,11,0.08)" : isAvailable ? "rgba(16,185,129,0.06)" : "rgba(59,130,246,0.06)",
                cursor: isAvailable ? "pointer" : "default",
                height: "7rem",
                borderRadius: "1rem",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.35rem",
              }}
            >
              <span style={{ fontSize: "1.75rem", fontWeight: 900, opacity: 0.5, fontFamily: "var(--font-mono)" }}>
                #{seatNum}
              </span>
              <span style={{ fontSize: uiRem(0.8), fontWeight: 700, color: isMe ? "#fbbf24" : "#93c5fd" }}>
                {ownerName ? (isMe ? "👈 你" : ownerName) : "点击选择"}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: uiRem(0.8), color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
        选座队列（财富升序）：{queueLine}
        {mySeat ? ` · 你选择了 #${mySeat}` : ""}
      </div>

      <div
        style={{
          padding: "0.75rem",
          borderRadius: "0.75rem",
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.25)",
          fontSize: uiRem(0.85),
          color: "#fcd34d",
        }}
      >
        💡 长期项目满额时，顺位 <strong>#1</strong> 先占坑，靠后顺位可能「投了也没收益」。
      </div>

    </div>
  );
};
