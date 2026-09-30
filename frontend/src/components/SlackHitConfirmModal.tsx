import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { socket } from "../socket";
import { SlackHitNotice } from "../types";

type Props = {
  hits?: SlackHitNotice[];
};

export const SlackHitConfirmModal: React.FC<Props> = ({ hits }) => {
  const hit = hits?.[0];
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSubmitting(false);
  }, [hit?.id]);

  useEffect(() => {
    if (!hit) setSubmitting(false);
  }, [hit]);

  useEffect(() => {
    const onError = () => setSubmitting(false);
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  if (!hit) return null;
  const isGain = hit.energyDelta > 0;

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal-box animate-bounce-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slack-hit-title"
        style={{
          border: "2px solid rgba(239,68,68,0.6)",
          boxShadow: "0 0 60px rgba(239,68,68,0.3)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }} aria-hidden>
          😴
        </div>
        <h3
          id="slack-hit-title"
          style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", marginBottom: "0.5rem" }}
        >
          你被摸鱼传染了
        </h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
          {hit.fromName} 对你使用了【摸鱼传染】
          {isGain ? "，【劳逸结合】生效：获得 8 精力" : ""}
        </p>
        <div
          style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.25)",
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
            精力变化
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "3rem",
              fontWeight: 900,
              color: isGain ? "#86efac" : "#f87171",
              lineHeight: 1,
            }}
          >
            {hit.energyDelta > 0 ? `+${hit.energyDelta}` : hit.energyDelta}
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
          现在精力 {hit.energyAfter}
        </p>
        <button
          type="button"
          disabled={submitting}
          onClick={() => {
            if (submitting) return;
            setSubmitting(true);
            socket.emit("ackSlackHit", { hitId: hit.id });
          }}
          className="btn btn-purple btn-full"
          style={{ fontSize: uiRem(1) }}
        >
          {submitting ? "处理中…" : "确认"}
        </button>
      </div>
    </div>
  );
};
