import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { socket } from "../socket";

export type LotterySettleRequest = {
  offerId: string;
  amount: number;
};

type Props = {
  pending?: LotterySettleRequest | null;
  wealth: number;
};

export const LotteryConfirmModal: React.FC<Props> = ({ pending, wealth }) => {
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSubmitting(false);
  }, [pending?.offerId]);

  useEffect(() => {
    if (!pending) setSubmitting(false);
  }, [pending]);

  useEffect(() => {
    const onError = () => setSubmitting(false);
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  const handleRespond = (accept: boolean) => {
    if (!pending || submitting) return;
    setSubmitting(true);
    socket.emit("playerRespondLottery", { offerId: pending.offerId, accept });
  };

  if (!pending) return null;
  const payout = pending.amount;
  const isLoss = payout < 0;
  const isZero = payout === 0;
  const wealthAfter = wealth + payout;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-box animate-bounce-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lottery-confirm-title"
        style={{
          border: "2px solid rgba(236,72,153,0.6)",
          boxShadow: "0 0 60px rgba(236,72,153,0.35)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }} aria-hidden>
          🎲
        </div>
        <h3
          id="lottery-confirm-title"
          style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", marginBottom: "0.5rem" }}
        >
          彩票开奖！
        </h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
          {isZero ? "本局开奖金额为 0" : isLoss ? "本局开奖结果为扣减财富" : "你获得了彩票奖金"}
        </p>
        <div
          style={{
            background: "rgba(236,72,153,0.1)",
            border: "1px solid rgba(236,72,153,0.25)",
            borderRadius: "0.875rem",
            padding: "1rem",
            marginBottom: "0.75rem",
          }}
        >
          <div
            style={{
              fontSize: uiRem(0.7),
              color: "var(--color-text-muted)",
              marginBottom: "0.25rem",
              fontWeight: 700,
              letterSpacing: "0.1em",
            }}
          >
            {isLoss ? "扣除财富" : "获得财富"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "3rem",
              fontWeight: 900,
              color: isLoss ? "#f87171" : "#fbbf24",
              lineHeight: 1,
            }}
          >
            {payout > 0 ? `+${payout}` : payout}
          </div>
        </div>
        <p
          style={{
            margin: "0 0 1.25rem",
            color: "var(--color-text-muted)",
            fontSize: uiRem(0.8),
            fontFamily: "var(--font-mono)",
          }}
        >
          确认后财富 {wealth} → {wealthAfter}
        </p>
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
            {submitting ? "处理中…" : "确认领取 ✓"}
          </button>
        </div>
      </div>
    </div>
  );
};
