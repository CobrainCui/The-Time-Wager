import React from "react";
import { GameState, Player } from "../types";
import { socket } from "../socket";

interface Props {
  game: GameState;
  me: Player;
}

export const Drafting: React.FC<Props> = ({ game, me }) => {
  const { draftingState } = game;
  const { queue, currentIndex } = draftingState;
  const currentDrafterId = queue[currentIndex];
  const currentDrafter = game.players.find((p) => p.id === currentDrafterId);
  const isMyTurn = me.id === currentDrafterId;
  const haveISelected = me.draftOrder !== undefined;

  const handleSelectSeat = (seat: number) => {
    socket.emit("draftSeat", { seatIndex: seat });
  };

  return (
    <div
      className="page"
      style={{
        background: `
          radial-gradient(ellipse at 50% 0%, rgba(245,158,11,0.12) 0%, transparent 50%),
          #070b14
        `,
        minHeight: "100vh",
        padding: "2rem 1rem",
      }}
    >
      <div className="container-md animate-fadeIn">
        {/* 标题 */}
        <div className="text-center mb-8">
          <div style={{ fontSize: "0.8rem", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
            选座阶段
          </div>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 900, color: "#fbbf24" }}>
            🔢 行动位次甄选
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginTop: "0.5rem", fontSize: "0.95rem" }}>
            越靠前的顺位，越早选择长期项目的投资名额
          </p>
        </div>

        {/* 状态提示 */}
        <div
          className="text-center mb-8"
          style={{
            padding: "1.25rem",
            borderRadius: "1rem",
            border: "1px solid",
            ...(isMyTurn
              ? {
                  background: "rgba(16,185,129,0.08)",
                  borderColor: "rgba(16,185,129,0.3)",
                  boxShadow: "0 0 30px rgba(16,185,129,0.15)",
                }
              : haveISelected
              ? {
                  background: "rgba(59,130,246,0.08)",
                  borderColor: "rgba(59,130,246,0.25)",
                }
              : {
                  background: "rgba(245,158,11,0.06)",
                  borderColor: "rgba(245,158,11,0.2)",
                }),
          }}
        >
          {isMyTurn ? (
            <div className="animate-pulse">
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🔔</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#34d399" }}>
                轮到你了！请选择顺位
              </div>
            </div>
          ) : haveISelected ? (
            <div>
              <div style={{ fontSize: "1rem", color: "var(--color-text-secondary)", marginBottom: "0.25rem" }}>
                你已选择
              </div>
              <div style={{ fontSize: "2.5rem", fontWeight: 900, color: "#60a5fa" }}>
                第 {me.draftOrder} 顺位
              </div>
              <div style={{ color: "var(--color-text-muted)", fontSize: "0.875rem", marginTop: "0.5rem" }}>
                等待其他玩家完成选择...
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: "1rem", color: "#fbbf24", fontWeight: 700 }}>
                ⏳ 等待 {currentDrafter?.name} 选座...
              </div>
            </div>
          )}
        </div>

        {/* 座位网格 */}
        <div className="grid grid-cols-3 gap-4 mb-8" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {[1, 2, 3, 4, 5, 6].map((seatNum) => {
            const owner = game.players.find((p) => p.draftOrder === seatNum);
            const isAvailable = !owner;
            const isMe = owner?.id === me.id;

            return (
              <button
                key={seatNum}
                disabled={!isMyTurn || !isAvailable}
                onClick={() => handleSelectSeat(seatNum)}
                className={`seat-btn ${isAvailable ? "available" : "occupied"} ${isMe ? "my-seat" : ""}`}
                style={{
                  border: "2px solid",
                  borderColor: isMe
                    ? "#f59e0b"
                    : isAvailable
                    ? isMyTurn ? "#10b981" : "var(--color-border)"
                    : "rgba(59,130,246,0.35)",
                  background: isMe
                    ? "rgba(245,158,11,0.08)"
                    : isAvailable
                    ? isMyTurn ? "rgba(16,185,129,0.06)" : "var(--color-bg-card)"
                    : "rgba(59,130,246,0.06)",
                  cursor: isMyTurn && isAvailable ? "pointer" : "default",
                  height: "9rem",
                  borderRadius: "1rem",
                  transition: "all 0.2s ease",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "1rem",
                }}
              >
                <span
                  style={{
                    fontSize: "2.5rem",
                    fontWeight: 900,
                    opacity: 0.4,
                    fontFamily: "var(--font-mono)",
                    color: isMe ? "#f59e0b" : isAvailable ? (isMyTurn ? "#10b981" : "white") : "#60a5fa",
                  }}
                >
                  #{seatNum}
                </span>
                {owner ? (
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: "0.9rem",
                      color: isMe ? "#fbbf24" : "#93c5fd",
                      textAlign: "center",
                    }}
                  >
                    {isMe ? "👈 你" : owner.name}
                  </span>
                ) : (
                  <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                    {isMyTurn ? "点击选择" : "空闲"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 等待队列 */}
        <div
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "1rem",
            padding: "1.25rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--color-text-muted)",
              marginBottom: "0.875rem",
            }}
          >
            选座队列（按财富升序，穷者先选）
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {queue.map((pid, idx) => {
              const p = game.players.find((pl) => pl.id === pid);
              const isCurrent = idx === currentIndex;
              const isDone = idx < currentIndex || p?.draftOrder !== undefined;
              return (
                <div
                  key={pid}
                  style={{
                    padding: "0.375rem 0.875rem",
                    borderRadius: "9999px",
                    border: "1px solid",
                    fontSize: "0.875rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.375rem",
                    background: isCurrent
                      ? "rgba(245,158,11,0.1)"
                      : isDone
                      ? "rgba(255,255,255,0.02)"
                      : "transparent",
                    borderColor: isCurrent
                      ? "#f59e0b"
                      : isDone
                      ? "rgba(255,255,255,0.05)"
                      : "var(--color-border)",
                    color: isCurrent
                      ? "#fbbf24"
                      : isDone
                      ? "var(--color-text-muted)"
                      : "var(--color-text-secondary)",
                    fontWeight: isCurrent ? 700 : 400,
                    textDecoration: isDone && !isCurrent ? "line-through" : undefined,
                  }}
                >
                  {p?.name}
                  {p?.draftOrder && (
                    <span
                      style={{
                        background: "rgba(59,130,246,0.2)",
                        borderRadius: "4px",
                        padding: "0 0.375rem",
                        fontSize: "0.75rem",
                        color: "#93c5fd",
                      }}
                    >
                      #{p.draftOrder}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
