import React, { useState, useEffect } from "react";
import { GameState, Player } from "../types";
import { socket } from "../socket";

const BUFF_DEFS: Record<string, { name: string; desc: string; icon: string; color: string }> = {
  buff_gold:      { name: "点石成金", desc: "本轮回报 ×1.5",            icon: "💰", color: "#f59e0b" },
  buff_short:     { name: "项目做空", desc: "猜测项目状态赢取奖励",      icon: "📉", color: "#3b82f6" },
  buff_slack:     { name: "摸鱼传染", desc: "对手精力 -5",               icon: "😴", color: "#ef4444" },
  buff_rebound:   { name: "反弹琵琶", desc: "主动开启护盾，反弹攻击",     icon: "🎸", color: "#10b981" },
  buff_insurance: { name: "保险",     desc: "被动防爆，获赔 100",         icon: "🛡️", color: "#6366f1" },
  buff_spirit:    { name: "精神老伙", desc: "精力 +5",                   icon: "🔥", color: "#f97316" },
  buff_swap:      { name: "偷天换日", desc: "选座时与对手互换顺位",        icon: "🔄", color: "#a855f7" },
  buff_lottery:   { name: "彩票",     desc: "投 20 面骰子赌运气",         icon: "🎲", color: "#ec4899" },
};

interface Props { game: GameState; me: Player; }

export const BuffUsage: React.FC<Props> = ({ game, me }) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targetPlayer, setTargetPlayer] = useState("");
  const [targetProject, setTargetProject] = useState<number | undefined>(undefined);
  const [extraData, setExtraData] = useState("");

  useEffect(() => {
    const end = game.investmentEndsAt || game.buffPhaseEndsAt;
    if (!end) return;
    const t = setInterval(() => setTimeLeft(Math.max(0, Math.floor((end - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [game.investmentEndsAt, game.buffPhaseEndsAt]);

  const handleUse = () => {
    if (!selectedCard) return;
    if ((selectedCard === "buff_slack" || selectedCard === "buff_swap") && !targetPlayer) { alert("请选择目标玩家"); return; }
    if (selectedCard === "buff_short") {
      if (!targetProject) { alert("请选择目标项目"); return; }
      if (!extraData) { alert("请选择猜测结果"); return; }
    }
    socket.emit("useBuffCard", { cardId: selectedCard, targetPlayerId: targetPlayer, targetProjectId: targetProject, extraData });
    setSelectedCard(null); setTargetPlayer(""); setTargetProject(undefined); setExtraData("");
  };

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60;
  const isDanger = timeLeft < 20;

  const selectedDef = selectedCard ? BUFF_DEFS[selectedCard] : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.12) 0%, transparent 55%), #070b14`,
        padding: "1.5rem 1rem",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        {/* 头部 */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1
            style={{
              fontSize: "2.25rem",
              fontWeight: 900,
              background: "linear-gradient(135deg, #a855f7, #ec4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "0.375rem",
            }}
          >
            🔮 道具与策略
          </h1>
          <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
            合理使用手牌改变战局，或保留至下一轮
          </p>
          {/* 倒计时 */}
          <div
            style={{
              marginTop: "1rem",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: "3rem",
              color: isDanger ? "#ef4444" : isUrgent ? "#f97316" : "#60a5fa",
              animation: isDanger ? "pulse 0.5s infinite" : isUrgent ? "pulse 1s infinite" : undefined,
              lineHeight: 1,
            }}
          >
            {mins}:{secs}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem", alignItems: "start" }}>
          {/* 左：手牌 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 700, fontSize: "1rem", color: "white" }}>📦 我的手牌</h3>
              <span
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "0.125rem 0.625rem",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                }}
              >
                {me.inventory.length} 张
              </span>
            </div>

            {me.inventory.length === 0 ? (
              <div
                style={{
                  border: "2px dashed var(--color-border)",
                  borderRadius: "1rem",
                  height: "12rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-text-muted)",
                  gap: "0.5rem",
                }}
              >
                <span style={{ fontSize: "2.5rem" }}>🤷</span>
                <span>暂无可用卡牌</span>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.875rem" }}>
                {me.inventory.map((cardId, idx) => {
                  const def = BUFF_DEFS[cardId] || { name: cardId, desc: "", icon: "❓", color: "#6b7280" };
                  const isSelected = selectedCard === cardId;
                  const isUsed = me.usedCards?.includes(cardId);
                  return (
                    <button
                      key={idx}
                      onClick={() => !isUsed && setSelectedCard(isSelected ? null : cardId)}
                      disabled={!!isUsed}
                      style={{
                        border: `2px solid ${isSelected ? def.color : isUsed ? "rgba(255,255,255,0.04)" : "var(--color-border)"}`,
                        borderRadius: "1rem",
                        background: isSelected
                          ? `${def.color}18`
                          : isUsed
                          ? "rgba(255,255,255,0.02)"
                          : "var(--color-bg-card)",
                        padding: "1.1rem",
                        cursor: isUsed ? "not-allowed" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        height: "9.5rem",
                        justifyContent: "space-between",
                        transition: "all 0.2s ease",
                        transform: isSelected ? "scale(1.04)" : undefined,
                        boxShadow: isSelected ? `0 0 20px ${def.color}40` : undefined,
                        opacity: isUsed ? 0.4 : 1,
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "1.75rem" }}>{def.icon}</span>
                        {isSelected && <span style={{ color: def.color, fontSize: "1rem" }}>✓</span>}
                        {isUsed && <span style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>已用</span>}
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: "0.9rem", color: isSelected ? def.color : "white", marginBottom: "0.25rem" }}>
                          {def.name}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", lineHeight: 1.4 }}>
                          {def.desc}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 右：操作面板 */}
          <div>
            <div
              style={{
                background: "var(--color-bg-card)",
                border: `1px solid ${selectedDef ? selectedDef.color + "44" : "var(--color-border)"}`,
                borderRadius: "1rem",
                padding: "1.25rem",
                position: "sticky",
                top: "1rem",
                transition: "border-color 0.25s ease",
                boxShadow: selectedDef ? `0 0 20px ${selectedDef.color}18` : undefined,
              }}
            >
              <h4 style={{ fontWeight: 700, color: selectedDef ? selectedDef.color : "var(--color-text-muted)", marginBottom: "1rem", fontSize: "0.95rem" }}>
                {selectedDef ? `⚡ ${selectedDef.name}` : "请先选择卡牌"}
              </h4>

              {!selectedCard ? (
                <div
                  style={{
                    height: "8rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-text-muted)",
                    fontSize: "0.875rem",
                  }}
                >
                  👈 点击左侧卡牌激活
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* 目标玩家 */}
                  {(selectedCard === "buff_slack" || selectedCard === "buff_swap") && (
                    <div>
                      <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                        目标玩家
                      </label>
                      <select
                        className="input"
                        value={targetPlayer}
                        onChange={(e) => setTargetPlayer(e.target.value)}
                        style={{ fontSize: "0.9rem" }}
                      >
                        <option value="">-- 选择目标 --</option>
                        {game.players.filter((p) => p.id !== me.id).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} (⚡{p.energy})</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* 项目做空 */}
                  {selectedCard === "buff_short" && (
                    <>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>目标项目</label>
                        <select className="input" value={targetProject} onChange={(e) => setTargetProject(Number(e.target.value))} style={{ fontSize: "0.9rem" }}>
                          <option value="">-- 选择项目 --</option>
                          {game.activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>预测结果</label>
                        <select className="input" value={extraData} onChange={(e) => setExtraData(e.target.value)} style={{ fontSize: "0.9rem" }}>
                          <option value="">-- 选择预测 --</option>
                          <option value="empty">无人投资 (赢+200)</option>
                          <option value="full">恰好完成 (赢+150)</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* 反弹琵琶说明 */}
                  {selectedCard === "buff_rebound" && (
                    <div style={{ fontSize: "0.825rem", color: "var(--color-text-secondary)", lineHeight: 1.6, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "0.625rem", padding: "0.75rem" }}>
                      开启后，本轮受到【摸鱼传染】时自动反弹，精力+10而非-5。
                    </div>
                  )}

                  {/* 发动 */}
                  <button onClick={handleUse} className="btn btn-purple btn-full" style={{ background: selectedDef ? `linear-gradient(135deg, ${selectedDef.color}, ${selectedDef.color}bb)` : undefined }}>
                    ✨ 立即发动
                  </button>
                  <button onClick={() => setSelectedCard(null)} className="btn btn-ghost btn-full" style={{ fontSize: "0.85rem" }}>
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 底部 */}
        {me.ready ? (
          <div
            style={{
              position: "fixed",
              bottom: "2rem",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(16,185,129,0.15)",
              border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: "9999px",
              padding: "0.875rem 2rem",
              color: "#34d399",
              fontWeight: 700,
              backdropFilter: "blur(10px)",
              animation: "pulse 2s infinite",
            }}
          >
            ✅ 已准备，等待其他玩家...
          </div>
        ) : (
          <div
            style={{
              position: "fixed",
              bottom: "2.5rem",
              left: 0,
              right: 0,
              padding: "1.5rem",
              display: "flex",
              justifyContent: "center",
              background: "linear-gradient(to top, rgba(10,11,16,0.98) 60%, transparent)",
            }}
          >
            <button
              onClick={() => socket.emit("playerReady")}
              style={{
                background: "rgba(212,175,55,0.07)",
                border: "1px solid rgba(212,175,55,0.35)",
                borderRadius: "9999px",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                fontSize: "1.05rem",
                fontWeight: 600,
                padding: "0.75rem 2rem",
                letterSpacing: "0.03em",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,175,55,0.7)";
                (e.currentTarget as HTMLButtonElement).style.color = "#d4af37";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,175,55,0.14)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,175,55,0.35)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,175,55,0.07)";
              }}
            >
              无需操作，直接进入下一阶段 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
