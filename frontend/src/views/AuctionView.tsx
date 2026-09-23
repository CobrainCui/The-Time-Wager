import React, { useMemo } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { BUFF_CARD_DEFS, getAuctionCardsForEra } from "../config/buffCards";
import { BuffCardArt } from "../components/BuffCardArt";
import { GavelIcon } from "../components/icons/GavelIcon";

interface Props {
  game: GameState;
  me: Player;
  buffImages?: Record<string, number>;
}

export const AuctionView: React.FC<Props> = ({ game, me, buffImages = {} }) => {
  const distributed = new Set(game.auctionDistributedCardIds || []);

  const pendingCards = useMemo(() => {
    return getAuctionCardsForEra(game.currentEra).filter((c) => !distributed.has(c.id));
  }, [game.currentEra, game.auctionDistributedCardIds]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.14) 0%, transparent 55%), #070b14`,
        padding: "2.5rem 1rem 3rem",
        paddingTop: "3.25rem",
      }}
    >
      <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "2.25rem" }}>
          <div
            role="img"
            aria-label="拍卖"
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "1rem",
              animation: "float 3s ease-in-out infinite",
              filter: "drop-shadow(0 0 14px rgba(168,85,247,0.5))",
            }}
          >
            <GavelIcon size={64} color="#c084fc" />
          </div>
          <h1 style={{ fontSize: "2.25rem", fontWeight: 900, color: "#c084fc" }}>
            拍卖会
          </h1>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.625rem",
              background: "rgba(251,191,36,0.1)",
              border: "1px solid rgba(251,191,36,0.35)",
              borderRadius: "9999px",
              padding: "0.5rem 1.25rem",
            }}
          >
            <span style={{ fontSize: uiRem(1.1) }}>💰</span>
            <span style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>我的财富</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 800,
                fontSize: uiRem(1.25),
                color: "#fbbf24",
              }}
            >
              {me.wealth}
            </span>
          </div>
        </div>

        {pendingCards.length === 0 ? (
          <div
            style={{
              border: "2px dashed rgba(168,85,247,0.35)",
              borderRadius: "1rem",
              padding: "2.5rem 1rem",
              textAlign: "center",
              color: "var(--color-text-muted)",
              fontSize: uiRem(0.9),
            }}
          >
            本轮待拍道具已全部成交，请等待主持人结束拍卖。
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "1.5rem",
            }}
          >
            {pendingCards.map((card) => {
              const def = BUFF_CARD_DEFS[card.id];
              return (
                <div
                  key={card.id}
                  style={{
                    flex: "0 1 240px",
                    width: "min(100%, 240px)",
                    maxWidth: "100%",
                    background: "var(--color-bg-card)",
                    border: "1px solid rgba(168,85,247,0.3)",
                    borderRadius: "1.125rem",
                    padding: "1.125rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.875rem",
                  }}
                >
                  <BuffCardArt cardId={card.id} buffImages={buffImages} />
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        color: def?.color || "#d8b4fe",
                        fontSize: uiRem(1.1),
                        marginBottom: "0.5rem",
                        lineHeight: 1.3,
                      }}
                    >
                      {def?.name || card.name}
                    </div>
                    <div
                      style={{
                        fontSize: uiRem(0.88),
                        color: "var(--color-text-secondary)",
                        lineHeight: 1.55,
                      }}
                    >
                      {def?.desc || "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
