import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { uiRem } from "../utils/typography";
import { socket } from "../socket";

interface Props {
  open: boolean;
  maxPurchased: number;
  onClose: () => void;
  /** 退订成功（杯数减少）时通知父组件，用于无服务端计数字段时的本地兜底 */
  onRefunded?: (count: number) => void;
}

export const CoffeeUnsubscribeModal: React.FC<Props> = ({ open, maxPurchased, onClose, onRefunded }) => {
  const [countInput, setCountInput] = useState("1");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const prevPurchasedRef = useRef(maxPurchased);
  const wasOpenRef = useRef(false);

  const close = useCallback(() => {
    if (confirming) return;
    setInlineError(null);
    setCountInput("1");
    onClose();
  }, [confirming, onClose]);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setCountInput("1");
      setInlineError(null);
      setConfirming(false);
      prevPurchasedRef.current = maxPurchased;
    }
    if (!open) {
      setConfirming(false);
    }
    wasOpenRef.current = open;
  }, [open, maxPurchased]);

  useEffect(() => {
    if (!open || confirming) return;
    prevPurchasedRef.current = maxPurchased;
  }, [maxPurchased, open, confirming]);

  useEffect(() => {
    if (open && maxPurchased <= 0 && !confirming) {
      onClose();
    }
  }, [open, maxPurchased, confirming, onClose]);

  useEffect(() => {
    if (!open || !confirming) return;
    if (maxPurchased < prevPurchasedRef.current) {
      const refunded = prevPurchasedRef.current - maxPurchased;
      setConfirming(false);
      setInlineError(null);
      setCountInput("1");
      prevPurchasedRef.current = maxPurchased;
      if (refunded > 0) onRefunded?.(refunded);
      onClose();
    }
  }, [maxPurchased, open, confirming, onClose, onRefunded]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();

    const onFocusIn = (e: FocusEvent) => {
      const root = dialogRef.current;
      if (!root || root.contains(e.target as Node)) return;
      e.stopPropagation();
      cancelRef.current?.focus();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled), input:not(:disabled)"
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onError = () => {
      setConfirming(false);
    };
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, [open]);

  const handleConfirm = () => {
    if (confirming || maxPurchased <= 0) return;
    const count = Math.floor(Number(countInput));
    if (!Number.isFinite(count) || count < 1 || count > maxPurchased) {
      setInlineError("请输入有效的退订杯数");
      return;
    }
    setInlineError(null);
    setConfirming(true);
    prevPurchasedRef.current = maxPurchased;
    socket.emit("cancelCoffee", { count });
  };

  if (!open) return null;

  return (
    <div className="modal-overlay leave-game-modal" onClick={close}>
      <div
        ref={dialogRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        style={{ textAlign: "left" }}
      >
        <h3
          id={titleId}
          style={{
            margin: "0 0 0.75rem",
            fontSize: uiRem(1.25),
            fontWeight: 800,
            color: "white",
          }}
        >
          咖啡退订
        </h3>
        <p
          id={descId}
          style={{
            margin: "0 0 1rem",
            color: "var(--color-text-secondary)",
            fontSize: uiRem(0.95),
            lineHeight: 1.6,
          }}
        >
          退订将返还财富并减少精力。
        </p>
        <label style={{ display: "block", marginBottom: "0.5rem", fontSize: uiRem(0.9), color: "var(--color-text-muted)" }}>
          退订杯数
          <input
            type="number"
            min={1}
            max={maxPurchased}
            step={1}
            value={countInput}
            disabled={confirming}
            onChange={(e) => {
              setCountInput(e.target.value);
              setInlineError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
            style={{
              display: "block",
              width: "100%",
              marginTop: "0.35rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--color-border)",
              background: "rgba(0,0,0,0.25)",
              color: "white",
              fontSize: uiRem(1),
            }}
          />
        </label>
        {inlineError && (
          <p role="alert" style={{ margin: "0 0 1rem", color: "#f87171", fontSize: uiRem(0.9) }}>
            {inlineError}
          </p>
        )}
        <div className="leave-game-modal__actions">
          <button type="button" className="btn btn-danger" disabled={confirming} onClick={handleConfirm}>
            {confirming ? "处理中…" : "确认退订"}
          </button>
          <button ref={cancelRef} type="button" className="btn btn-gold" disabled={confirming} onClick={close}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
};
