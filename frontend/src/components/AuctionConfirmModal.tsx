import React, { useCallback, useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { socket } from "../socket";

const BUFF_NAME_MAP: Record<string, string> = {
  buff_gold: "点石成金",
  buff_short: "项目做空",
  buff_slack: "摸鱼传染",
  buff_rebound: "反弹琵琶",
  buff_insurance: "保险",
  buff_spirit: "精神老伙",
  buff_lottery: "彩票",
};

export type AuctionTradeRequest = {
  offerId: string;
  cardId: string;
  cost: number;
};

function enqueueOffer(queue: AuctionTradeRequest[], incoming: AuctionTradeRequest): AuctionTradeRequest[] {
  const withoutCard = queue.filter((q) => q.cardId !== incoming.cardId);
  return [...withoutCard, incoming];
}

function removeOffer(queue: AuctionTradeRequest[], match: { offerId?: string; cardId?: string }): AuctionTradeRequest[] {
  if (match.offerId) {
    return queue.filter((q) => q.offerId !== match.offerId);
  }
  if (match.cardId) {
    return queue.filter((q) => q.cardId !== match.cardId);
  }
  return queue;
}

type Props = {
  /** 离开拍卖阶段时清空本地待确认队列（兜底，与 auctionOffersCleared 配合） */
  phase?: string;
};

export const AuctionConfirmModal: React.FC<Props> = ({ phase }) => {
  const [queue, setQueue] = useState<AuctionTradeRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const request = queue[0] ?? null;

  const enqueue = useCallback((data: AuctionTradeRequest) => {
    setQueue((prev) => enqueueOffer(prev, data));
  }, []);

  useEffect(() => {
    if (phase && phase !== "AUCTION") {
      setQueue([]);
      setSubmitting(false);
    }
  }, [phase]);

  useEffect(() => {
    setSubmitting(false);
  }, [request?.offerId]);

  useEffect(() => {
    const onTradeRequest = (data: AuctionTradeRequest) => enqueue(data);
    const onCancelled = (data: { offerId: string; cardId: string }) => {
      setQueue((prev) => {
        let next = removeOffer(prev, { offerId: data.offerId });
        if (next.length === prev.length) {
          next = removeOffer(prev, { cardId: data.cardId });
        }
        return next;
      });
    };
    const onCleared = () => {
      setQueue([]);
      setSubmitting(false);
    };

    socket.on("auctionTradeRequest", onTradeRequest);
    socket.on("auctionOfferCancelled", onCancelled);
    socket.on("auctionOffersCleared", onCleared);
    return () => {
      socket.off("auctionTradeRequest", onTradeRequest);
      socket.off("auctionOfferCancelled", onCancelled);
      socket.off("auctionOffersCleared", onCleared);
    };
  }, [enqueue]);

  const handleRespond = (accept: boolean) => {
    if (!request || submitting) return;
    setSubmitting(true);
    socket.emit("playerRespondAuction", { offerId: request.offerId, accept });
    setQueue((prev) => prev.slice(1));
  };

  if (!request) return null;
  const cardName = BUFF_NAME_MAP[request.cardId] || request.cardId;
  const moreCount = queue.length - 1;

  return (
    <div className="modal-overlay">
      <div
        className="modal-box animate-bounce-in"
        style={{
          border: "2px solid rgba(168,85,247,0.6)",
          boxShadow: "0 0 60px rgba(168,85,247,0.35)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>🔨</div>
        <h3 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", marginBottom: "0.5rem" }}>
          竞拍成功！
        </h3>
        {moreCount > 0 && (
          <p style={{ color: "#c084fc", fontSize: uiRem(0.8), fontWeight: 700, marginBottom: "0.5rem" }}>
            还有 {moreCount} 笔待确认
          </p>
        )}
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
          你拍得了{" "}
          <span style={{ color: "#d8b4fe", fontWeight: 800, fontSize: uiRem(1.1) }}>{cardName}</span>
        </p>
        <div
          style={{
            background: "rgba(168,85,247,0.1)",
            border: "1px solid rgba(168,85,247,0.25)",
            borderRadius: "0.875rem",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div
            style={{
              fontSize: uiRem(0.7),
              color: "var(--color-text-muted)",
              marginBottom: "0.25rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            需支付
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "3rem",
              fontWeight: 900,
              color: "#fbbf24",
              lineHeight: 1,
            }}
          >
            {request.cost}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleRespond(false)}
            className="btn btn-ghost"
            style={{ flex: 1 }}
          >
            金额有误
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => handleRespond(true)}
            className="btn btn-purple"
            style={{ flex: 1, fontSize: uiRem(1) }}
          >
            确认支付 ✓
          </button>
        </div>
      </div>
    </div>
  );
};
