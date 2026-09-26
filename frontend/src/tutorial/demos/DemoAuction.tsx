import React, { useState } from "react";
import { uiRem } from "../../utils/typography";
import { BUFF_CARD_DEFS } from "../../config/buffCards";
import { TUTORIAL_SHOP_CARDS } from "../tutorialMock";
import { BUFF_DEFS } from "../../data/buffDefs";

export const DemoAuction: React.FC = () => {
  const [wealth, setWealth] = useState(150);
  const [owned, setOwned] = useState<string[]>([]);
  const [toast, setToast] = useState("");

  const bid = (cardId: string) => {
    const price = BUFF_DEFS[cardId]?.price ?? 60;
    const def = BUFF_CARD_DEFS[cardId];
    if (owned.includes(cardId)) {
      setToast("你已持有该道具（试玩）");
      return;
    }
    if (wealth < price) {
      setToast("财富不足，无法竞拍（试玩）");
      return;
    }
    setWealth((w) => w - price);
    setOwned((o) => [...o, cardId]);
    setToast(`试玩拍得「${def?.name || cardId}」 · -${price} 💰`);
  };

  return (
    <div>
      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
        正式对局在 <strong>拍卖会</strong> 阶段由主持人发卡，玩家用财富成交后道具进入手牌。
      </p>
      <div style={{ marginBottom: "0.75rem", fontFamily: "var(--font-mono)", color: "#fbbf24", fontWeight: 700 }}>
        试玩财富：{wealth} 💰
      </div>
      {toast && (
        <div
          style={{
            marginBottom: "0.75rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.5rem",
            background: "rgba(168,85,247,0.15)",
            color: "#d8b4fe",
            fontSize: uiRem(0.85),
          }}
        >
          {toast}
        </div>
      )}
      <div
        className="tutorial-auction-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(240px, 1fr))",
          gap: "1rem",
          width: "100%",
          justifyContent: "center",
          alignItems: "stretch",
        }}
      >
        {TUTORIAL_SHOP_CARDS.map((cardId) => {
          const def = BUFF_CARD_DEFS[cardId];
          const price = BUFF_DEFS[cardId]?.price ?? 60;
          const has = owned.includes(cardId);
          return (
            <div
              key={cardId}
              style={{
                minWidth: 0,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                border: "1px solid rgba(168,85,247,0.35)",
                borderRadius: "0.875rem",
                padding: "1rem 1.125rem",
                background: "var(--color-bg-card)",
              }}
            >
              <div style={{ fontSize: "1.75rem", marginBottom: "0.35rem" }}>{def?.icon}</div>
              <div style={{ fontWeight: 800, color: def?.color || "#c084fc", marginBottom: "0.25rem" }}>{def?.name}</div>
              <div
                style={{
                  flex: 1,
                  fontSize: uiRem(0.75),
                  color: "var(--color-text-muted)",
                  marginBottom: "0.75rem",
                  lineHeight: 1.4,
                }}
              >
                {def?.desc}
              </div>
              <button type="button" className="btn btn-purple btn-sm btn-full" disabled={has} onClick={() => bid(cardId)}>
                {has ? "已成交" : `模拟竞拍 ${price} 💰`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};
