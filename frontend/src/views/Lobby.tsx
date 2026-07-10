import React, { useState } from "react";
import { GameState } from "../types";
import { socket } from "../socket";

interface Props {
  game: GameState;
}

export const Lobby: React.FC<Props> = ({ game }) => {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const isGodMode = roomId.trim() === "999999";

  const joinGame = () => {
    const cleanRoomId = roomId.trim();
    const cleanName = isGodMode ? "Admin" : name.trim();
    if (!cleanRoomId) return;
    if (!isGodMode && !cleanName) return;
    setIsJoining(true);
    socket.emit("joinGame", { roomId: cleanRoomId, name: cleanName });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") joinGame();
  };

  return (
    <div
      className="page-center"
      style={{
        background: `
          radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.15) 0%, transparent 60%),
          radial-gradient(ellipse at 80% 20%, rgba(168,85,247,0.12) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 90%, rgba(16,185,129,0.08) 0%, transparent 50%),
          #070b14
        `,
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 背景装饰粒子 */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(circle at 10% 20%, rgba(59,130,246,0.06) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(168,85,247,0.06) 0%, transparent 40%)
          `,
          pointerEvents: "none",
        }}
      />

      <div className="container-sm" style={{ width: "100%", padding: "2rem 1rem" }}>
        {/* Logo 区域 */}
        <div className="text-center mb-8 animate-fadeIn">
          <div
            style={{
              fontSize: "5rem",
              fontWeight: 900,
              lineHeight: 1,
              background: "linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "0.5rem",
              letterSpacing: "-0.02em",
            }}
          >
            光阴对赌
          </div>
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: "var(--color-text-muted)",
            }}
          >
            Time Stakes · 多人实时决策桌游
          </div>
        </div>

        {/* 登录卡片 */}
        <div
          className="glass animate-slideUp"
          style={{
            borderRadius: "1.5rem",
            padding: "2rem",
            border: isGodMode
              ? "1px solid rgba(245,158,11,0.4)"
              : "1px solid rgba(255,255,255,0.08)",
            boxShadow: isGodMode
              ? "0 0 40px rgba(245,158,11,0.15), 0 20px 60px rgba(0,0,0,0.5)"
              : "0 20px 60px rgba(0,0,0,0.5)",
            transition: "all 0.3s ease",
          }}
        >
          {/* 上帝模式提示 */}
          {isGodMode && (
            <div
              className="animate-slideDown mb-6"
              style={{
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.3)",
                borderRadius: "0.75rem",
                padding: "0.75rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span style={{ fontSize: "1.2rem" }}>👑</span>
              <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "0.9rem" }}>
                上帝视角 — 管理员控制台
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: "0.7rem",
                  color: "#d97706",
                  animation: "pulse 1.5s infinite",
                }}
              >
                ● ADMIN
              </span>
            </div>
          )}

          {/* 房间号输入 */}
          <div className="space-y-4">
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.5rem",
                }}
              >
                房间号
              </label>
              <input
                className="input input-mono"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入房间号"
                maxLength={6}
                style={{
                  borderColor: isGodMode ? "rgba(245,158,11,0.5)" : undefined,
                  color: isGodMode ? "#fbbf24" : undefined,
                  fontSize: "1.5rem",
                  padding: "1rem",
                }}
              />
            </div>

            {/* 昵称输入 */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.5rem",
                }}
              >
                你的昵称
              </label>
              <input
                className="input"
                value={isGodMode ? "管理员身份" : name}
                onChange={(e) => !isGodMode && setName(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isGodMode}
                placeholder="输入名字"
                style={{
                  textAlign: "center",
                  opacity: isGodMode ? 0.5 : 1,
                  cursor: isGodMode ? "not-allowed" : undefined,
                }}
              />
            </div>

            {/* 进入按钮 */}
            <button
              onClick={joinGame}
              disabled={(!isGodMode && !name.trim()) || !roomId.trim() || isJoining}
              className={`btn btn-lg btn-full ${isGodMode ? "btn-gold" : "btn-primary"}`}
              style={{ marginTop: "0.5rem", fontSize: "1.1rem", letterSpacing: "0.05em" }}
            >
              {isJoining ? (
                <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className="animate-spin" style={{ display: "inline-block" }}>⟳</span>
                  正在连接...
                </span>
              ) : isGodMode ? (
                "👑 进入后台监控"
              ) : (
                "🚀 进入游戏"
              )}
            </button>
          </div>

          {/* 在线玩家预览 */}
          {game?.players && game.players.length > 0 && !isGodMode && (
            <div
              className="animate-fadeIn"
              style={{
                marginTop: "1.5rem",
                paddingTop: "1.5rem",
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <div
                style={{
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                  marginBottom: "0.75rem",
                  textAlign: "center",
                }}
              >
                房间 <span style={{ color: "#60a5fa", fontFamily: "var(--font-mono)" }}>{roomId}</span> 已有{" "}
                <span style={{ color: "#34d399", fontWeight: 700 }}>{game.players.length}</span> 人在线
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  justifyContent: "center",
                }}
              >
                {game.players.map((p) => (
                  <span
                    key={p.id}
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "9999px",
                      padding: "0.25rem 0.75rem",
                      fontSize: "0.8rem",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div
          className="text-center animate-fadeIn"
          style={{
            marginTop: "2rem",
            fontSize: "0.75rem",
            color: "var(--color-text-muted)",
          }}
        >
          2-6 人 · 约 90 分钟 · 建议线下进行
        </div>
      </div>
    </div>
  );
};
