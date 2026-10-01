import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { BUFF_CARD_DEFS, getAuctionCardsForEra } from "../config/buffCards";
import { BuffCardArt } from "../components/BuffCardArt";
import { GavelIcon } from "../components/icons/GavelIcon";
import { socket } from "../socket";
import {
  formatWealthHoldNote,
  playerAvailableWealth,
  playerLeadingBidReservedWealth,
  playerPendingTransferOutWealth,
} from "../utils/availableWealth";
import {
  normalizeDigitsNonNegativeInt,
  parseNormalizedNonNegativeInt,
} from "../utils/nonNegativeIntInput";

interface Props {
  game: GameState;
  me: Player;
  buffImages?: Record<string, number>;
  /** 主持公共预览：只展示牌面与出价记录，隐藏个人出价 */
  embed?: boolean;
}

function formatBidTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export const AuctionView: React.FC<Props> = ({ game, me, buffImages = {}, embed = false }) => {
  const distributed = new Set(game.auctionDistributedCardIds || []);
  const focusId = game.auctionFocusCardId;
  const hasForceBuy = me.inventory.includes("buff_force_buy");
  const forceBuyUsed = (game.forceBuyUsedPlayerIds ?? []).includes(me.id);
  const availableForBid = playerAvailableWealth(game, me, { exceptOwnLeading: true });
  const availableShown = playerAvailableWealth(game, me);
  const holdShown = formatWealthHoldNote(
    playerLeadingBidReservedWealth(game, me.id),
    playerPendingTransferOutWealth(game, me.id)
  );
  const holdForBid = formatWealthHoldNote(
    0,
    playerPendingTransferOutWealth(game, me.id)
  );

  const startingBid = game.auctionStartingBid ?? 5;
  const currentBid = game.auctionCurrentBid ?? 0;
  const minNext = game.auctionMinimumNextBid ?? 5;
  const highBidderId = game.auctionHighBidderId ?? null;
  const highBidderName = game.auctionHighBidderName ?? null;
  const history = game.auctionBidHistory ?? [];
  const soldLots = game.auctionSoldLots ?? [];
  const forceBuyTargetsSelf = focusId === "buff_force_buy";

  const [amountText, setAmountText] = useState("");
  const [sending, setSending] = useState(false);
  const lastAutoMinRef = useRef<number | null>(null);
  const focusIdRef = useRef(focusId);

  useEffect(() => {
    const focusChanged = focusIdRef.current !== focusId;
    focusIdRef.current = focusId;

    setAmountText((prev) => {
      const prevNum = parseNormalizedNonNegativeInt(prev, -1);
      // 换拍品 / 空输入：回到当前最低价
      if (focusChanged || lastAutoMinRef.current === null || prev === "") {
        lastAutoMinRef.current = minNext;
        return String(minNext);
      }
      // 别人抬价后，当前输入已不够：抬到最低价
      if (prevNum < minNext) {
        lastAutoMinRef.current = minNext;
        return String(minNext);
      }
      // 仍是上一档自动填的「至少要出到」：跟着涨，不打断更高的自定义加价
      if (prevNum === lastAutoMinRef.current) {
        lastAutoMinRef.current = minNext;
        return String(minNext);
      }
      lastAutoMinRef.current = minNext;
      return prev;
    });
  }, [minNext, focusId]);

  useEffect(() => {
    const onError = () => setSending(false);
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  // 自己的出价已出现在记录里：解除提交中状态
  useEffect(() => {
    if (!sending) return;
    if (highBidderId === me.id) setSending(false);
  }, [sending, highBidderId, me.id]);

  const amount = parseNormalizedNonNegativeInt(amountText, 0);
  const iAmLeading = highBidderId === me.id;
  const submitBlockReason = !focusId
    ? "现在没有正在拍的卡"
    : iAmLeading
      ? "你已暂时领先，无需再出"
      : sending
        ? "正在提交…"
        : !Number.isSafeInteger(amount) || amountText === ""
          ? "请输入出价金额"
          : amount < minNext
            ? `至少要出到 ${minNext}`
            : amount > availableForBid
              ? `可用财富不够（可用 ${availableForBid}${holdForBid ? `，${holdForBid}` : ""}）`
              : null;
  const canSubmit = submitBlockReason == null;

  const myStatus = useMemo(() => {
    if (!focusId) return "none" as const;
    const mineOnCard = history.some((b) => b.playerId === me.id);
    if (highBidderId === me.id) return "leading" as const;
    if (mineOnCard) return "outbid" as const;
    return "none" as const;
  }, [focusId, history, highBidderId, me.id]);

  const pendingCards = useMemo(() => {
    return getAuctionCardsForEra(game.currentEra).filter((c) => !distributed.has(c.id));
  }, [game.currentEra, game.auctionDistributedCardIds]);

  const upcoming = pendingCards.filter((c) => c.id !== focusId);
  const focusDef = focusId ? BUFF_CARD_DEFS[focusId] : null;

  const placeBid = (value: number) => {
    if (submitBlockReason) {
      window.alert(submitBlockReason);
      return;
    }
    if (!focusId || sending) return;
    setSending(true);
    socket.emit("playerPlaceAuctionBid", { amount: value });
    window.setTimeout(() => setSending(false), 400);
  };

  return (
    <div
      className="auction-page"
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.14) 0%, transparent 55%), #070b14`,
        padding: "2.5rem 1rem 3rem",
        paddingTop: "3.25rem",
        paddingBottom: "calc(3rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div style={{ maxWidth: "1120px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
          <div
            role="img"
            aria-label="拍卖"
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "0.75rem",
              animation: "float 3s ease-in-out infinite",
              filter: "drop-shadow(0 0 14px rgba(168,85,247,0.5))",
            }}
          >
            <GavelIcon size={56} color="#c084fc" />
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, color: "#c084fc", margin: 0 }}>拍卖会</h1>
        </div>

        {!focusId ? (
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
            {pendingCards.length === 0
              ? "本轮待拍道具已全部成交，请等待主持人结束拍卖。"
              : "暂时没有正在拍的卡，请等待主持人选择。"}
          </div>
        ) : (
          <div
            className="auction-lot-layout"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.15fr)",
              gap: "1.25rem",
              alignItems: "start",
            }}
          >
            {/* 左侧：正在拍 */}
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid rgba(251,191,36,0.45)",
                boxShadow: "0 0 22px rgba(251,191,36,0.15)",
                borderRadius: "1.125rem",
                padding: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.875rem",
              }}
            >
              <div style={{ fontSize: uiRem(0.75), fontWeight: 800, color: "#fbbf24", letterSpacing: "0.06em" }}>
                正在拍
              </div>
              <BuffCardArt cardId={focusId} buffImages={buffImages} />
              <div>
                <div
                  style={{
                    fontWeight: 800,
                    color: focusDef?.color || "#d8b4fe",
                    fontSize: uiRem(1.2),
                    marginBottom: "0.5rem",
                    lineHeight: 1.3,
                  }}
                >
                  {focusDef?.name || focusId}
                </div>
                <div
                  style={{
                    fontSize: uiRem(0.88),
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.55,
                  }}
                >
                  {focusDef?.desc || "—"}
                </div>
              </div>
              {!embed && hasForceBuy && (
                <button
                  type="button"
                  className="btn btn-purple btn-sm"
                  disabled={forceBuyUsed || forceBuyTargetsSelf}
                  onClick={() => {
                    if (forceBuyUsed || forceBuyTargetsSelf) return;
                    const name = focusDef?.name || focusId;
                    if (
                      !window.confirm(
                        `使用强买强卖？\n将免费拿走正在拍的【${name}】（本场拍卖只能用一次）。`
                      )
                    ) {
                      return;
                    }
                    socket.emit("useBuffCard", { cardId: "buff_force_buy" });
                  }}
                >
                  {forceBuyUsed
                    ? "本场已用过强买强卖"
                    : forceBuyTargetsSelf
                      ? "不能强买正在拍的强买强卖"
                      : "强买强卖：免费拿走正在拍的这张"}
                </button>
              )}
            </div>

            {/* 右侧：加价过程 */}
            <div
              style={{
                background: "rgba(168,85,247,0.06)",
                border: "1px solid rgba(168,85,247,0.3)",
                borderRadius: "1.125rem",
                padding: "1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                minHeight: "320px",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "0.65rem",
                  fontSize: uiRem(0.82),
                }}
              >
                <PriceCell label="起拍价" value={String(startingBid)} />
                <PriceCell
                  label="现在最高价"
                  value={currentBid > 0 ? String(currentBid) : "—"}
                  hint={currentBid <= 0 ? "还没有人出价" : undefined}
                  accent
                />
                <PriceCell
                  label="出价最高的人"
                  value={highBidderName || "还没有人出价"}
                />
                <PriceCell label="至少要出到" value={String(minNext)} accent />
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem 1rem",
                  alignItems: "center",
                  fontSize: uiRem(0.8),
                  color: "var(--color-text-secondary)",
                }}
              >
                {!embed && (
                  <>
                    <span>
                      我的可用财富{" "}
                      <strong style={{ color: "#86efac", fontFamily: "var(--font-mono)" }}>
                        {availableShown}
                      </strong>
                      {holdShown && (
                        <span style={{ color: "var(--color-text-muted)" }}> · {holdShown}</span>
                      )}
                    </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color:
                          myStatus === "leading"
                            ? "#86efac"
                            : myStatus === "outbid"
                              ? "#fca5a5"
                              : "var(--color-text-muted)",
                      }}
                    >
                      {myStatus === "leading"
                        ? "你暂时领先"
                        : myStatus === "outbid"
                          ? "有人出得比你高"
                          : "你还没出过价"}
                    </span>
                  </>
                )}
                <span style={{ color: "var(--color-text-muted)" }}>
                  每次至少多加 {Math.max(1, minNext - currentBid)}
                </span>
              </div>

              <div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: uiRem(0.85),
                    color: "#d8b4fe",
                    marginBottom: "0.5rem",
                  }}
                >
                  出价记录
                </div>
                <div
                  style={{
                    maxHeight: "220px",
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.4rem",
                  }}
                >
                  {history.length === 0 ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.8) }}>
                      还没有出价。起拍价是 {startingBid}，第一手至少出 {startingBid}。
                    </div>
                  ) : (
                    history.map((row, idx) => (
                      <div
                        key={row.bidId}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "0.35rem 0.75rem",
                          alignItems: "center",
                          padding: "0.45rem 0.65rem",
                          borderRadius: "0.65rem",
                          background:
                            row.status === "leading"
                              ? "rgba(251,191,36,0.12)"
                              : "rgba(0,0,0,0.25)",
                          border:
                            row.status === "leading"
                              ? "1px solid rgba(251,191,36,0.4)"
                              : "1px solid transparent",
                          fontSize: uiRem(0.78),
                        }}
                      >
                        <span style={{ color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                          {formatBidTime(row.timestamp)}
                        </span>
                        <span style={{ fontWeight: 700, color: "white" }}>{row.playerName}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: "#fbbf24" }}>
                          {row.amount}
                        </span>
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {idx === history.length - 1
                            ? row.amount === startingBid
                              ? "按起拍价出"
                              : `比起拍价多了 ${row.amount - startingBid}`
                            : `比上一手多了 ${row.incrementFromPrevious}`}
                        </span>
                        {row.status === "leading" ? (
                          <span style={{ color: "#fbbf24", fontWeight: 800 }}>暂时领先</span>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>已被超过</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {!embed && (
              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {iAmLeading ? (
                  <div
                    style={{
                      padding: "0.75rem 1rem",
                      borderRadius: "0.75rem",
                      background: "rgba(134,239,172,0.12)",
                      border: "1px solid rgba(134,239,172,0.35)",
                      color: "#86efac",
                      fontWeight: 700,
                      fontSize: uiRem(0.88),
                      textAlign: "center",
                    }}
                  >
                    你已暂时领先，无需再出。等主持人确认成交，或等有人出得比你高。
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setAmountText(String(minNext))}
                      >
                        出最低这一手
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const base = amountText === "" ? minNext : Math.max(amount, minNext);
                          setAmountText(String(base + 5));
                        }}
                      >
                        再加 5
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const base = amountText === "" ? minNext : Math.max(amount, minNext);
                          setAmountText(String(base + 10));
                        }}
                      >
                        再加 10
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "stretch" }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        className="input"
                        value={amountText}
                        onChange={(e) =>
                          setAmountText(normalizeDigitsNonNegativeInt(e.target.value))
                        }
                        aria-label="出价金额"
                        style={{
                          flex: 1,
                          textAlign: "center",
                          fontFamily: "var(--font-mono)",
                          fontSize: uiRem(1.1),
                          fontWeight: 800,
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-purple"
                        aria-disabled={!canSubmit}
                        title={submitBlockReason ?? "出价"}
                        onClick={() => placeBid(amount)}
                        style={{
                          minWidth: "5.5rem",
                          opacity: canSubmit ? 1 : 0.55,
                          cursor: canSubmit ? "pointer" : "not-allowed",
                        }}
                      >
                        {sending ? "…" : "出价"}
                      </button>
                    </div>
                    {submitBlockReason && !iAmLeading && (
                      <div style={{ color: "#fca5a5", fontSize: uiRem(0.75), fontWeight: 700 }}>
                        {submitBlockReason}
                      </div>
                    )}
                  </>
                )}
              </div>
              )}
              {embed && (
                <div
                  style={{
                    marginTop: "auto",
                    padding: "0.75rem 1rem",
                    borderRadius: "0.75rem",
                    background: "rgba(255,255,255,0.04)",
                    color: "var(--color-text-muted)",
                    fontWeight: 600,
                    fontSize: uiRem(0.85),
                    textAlign: "center",
                  }}
                >
                  观战预览 · 仅展示出价记录
                </div>
              )}
            </div>
          </div>
        )}

        {soldLots.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <div
              style={{
                fontWeight: 800,
                color: "var(--color-text-secondary)",
                marginBottom: "0.65rem",
                fontSize: uiRem(0.9),
              }}
            >
              已成交
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {soldLots.map((lot) => {
                const def = BUFF_CARD_DEFS[lot.cardId];
                return (
                  <div
                    key={lot.cardId}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.35rem 0.85rem",
                      alignItems: "center",
                      padding: "0.55rem 0.8rem",
                      borderRadius: "0.75rem",
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      fontSize: uiRem(0.82),
                    }}
                  >
                    <span style={{ fontWeight: 800, color: def?.color || "#d8b4fe" }}>
                      {def?.name || lot.cardId}
                    </span>
                    <span style={{ color: "white", fontWeight: 700 }}>{lot.playerName}</span>
                    <span style={{ fontFamily: "var(--font-mono)", color: "#fbbf24", fontWeight: 800 }}>
                      {lot.cost > 0 ? `${lot.cost}` : "强买 · 免费"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {upcoming.length > 0 && (
          <div style={{ marginTop: "2rem" }}>
            <div
              style={{
                fontWeight: 800,
                color: "var(--color-text-secondary)",
                marginBottom: "0.85rem",
                fontSize: uiRem(0.9),
              }}
            >
              待拍
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "1rem",
                justifyContent: "center",
              }}
            >
              {upcoming.map((card) => {
                const def = BUFF_CARD_DEFS[card.id];
                return (
                  <div
                    key={card.id}
                    style={{
                      flex: "0 1 220px",
                      width: "min(100%, 220px)",
                      background: "var(--color-bg-card)",
                      border: "1px solid rgba(168,85,247,0.22)",
                      borderRadius: "1rem",
                      padding: "1rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.65rem",
                      opacity: 0.92,
                    }}
                  >
                    <BuffCardArt cardId={card.id} buffImages={buffImages} />
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: uiRem(1),
                        color: def?.color || "#d8b4fe",
                        lineHeight: 1.3,
                      }}
                    >
                      {def?.name || card.name}
                    </div>
                    <div
                      style={{
                        fontSize: uiRem(0.82),
                        color: "var(--color-text-secondary)",
                        lineHeight: 1.55,
                      }}
                    >
                      {def?.desc || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <style>{`
        .auction-page {
          padding-right: max(1rem, min(18rem, 30vw));
        }
        @media (max-width: 820px) {
          .auction-page {
            padding-right: 1rem;
          }
          .auction-lot-layout {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
};

const PriceCell: React.FC<{
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}> = ({ label, value, hint, accent }) => (
  <div
    style={{
      background: "rgba(0,0,0,0.28)",
      borderRadius: "0.75rem",
      padding: "0.55rem 0.7rem",
      border: "1px solid rgba(168,85,247,0.18)",
    }}
  >
    <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.7), marginBottom: "0.2rem" }}>
      {label}
    </div>
    <div
      style={{
        fontWeight: 800,
        fontFamily: accent ? "var(--font-mono)" : undefined,
        color: accent ? "#fbbf24" : "white",
        fontSize: uiRem(1),
        lineHeight: 1.2,
      }}
    >
      {value}
    </div>
    {hint && (
      <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.68), marginTop: "0.15rem" }}>
        {hint}
      </div>
    )}
  </div>
);
