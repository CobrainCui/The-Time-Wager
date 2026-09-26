import React, { useState, useEffect } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { socket } from "../socket";

import { BUFF_DEFS } from "../data/buffDefs";
import { BuffCardArt } from "../components/BuffCardArt";
import { isAiPlayer } from "../utils/isAiPlayer";

function playersNeedingBuffGate(game: GameState): Player[] {
  return game.players.filter((p) => p.connected && !isAiPlayer(p));
}

interface Props {
  game: GameState;
  me: Player;
  buffImages?: Record<string, number>;
  onOpenInvestmentPrefill?: () => void;
  /** 进入讨论队列前同步预填并 ready */
  onEnterDiscussion?: () => void;
}

export const BuffUsage: React.FC<Props> = ({
  game,
  me,
  buffImages = {},
  onOpenInvestmentPrefill,
  onEnterDiscussion,
}) => {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targetPlayer, setTargetPlayer] = useState("");
  const [targetProject, setTargetProject] = useState<number | undefined>(undefined);
  const [extraData, setExtraData] = useState("");

  useEffect(() => {
    if (me.ready) setSelectedCard(null);
  }, [me.ready]);

  const handleUse = () => {
    if (me.ready) return;
    if (!selectedCard) return;
    if ((selectedCard === "buff_slack" || selectedCard === "buff_swap") && !targetPlayer) { alert("请选择目标玩家"); return; }
    if (selectedCard === "buff_short") {
      if (!targetProject) { alert("请选择目标项目"); return; }
      if (!extraData) { alert("请选择猜测结果"); return; }
    }
    socket.emit("useBuffCard", { cardId: selectedCard, targetPlayerId: targetPlayer, targetProjectId: targetProject, extraData });
    setSelectedCard(null); setTargetPlayer(""); setTargetProject(undefined); setExtraData("");
  };

  const gateTotal = playersNeedingBuffGate(game).length;
  const gateReady = (game.readyPlayers ?? []).filter((id) =>
    playersNeedingBuffGate(game).some((p) => p.id === id)
  ).length;

  const selectedDef = selectedCard ? BUFF_DEFS[selectedCard] : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.12) 0%, transparent 55%), #070b14`,
        padding: "1.5rem 1rem",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto", opacity: me.ready ? 0.5 : 1, pointerEvents: me.ready ? "none" : "auto" }}>
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
          <p style={{ color: "var(--color-text-secondary)", fontSize: uiRem(0.9) }}>
            合理使用手牌改变战局，或保留至下一轮
          </p>
          {!me.ready && (
            <p style={{ marginTop: "0.5rem", color: "var(--color-text-muted)", fontSize: uiRem(0.8) }}>
              道具阶段不限时；全员点击「进入讨论和投资」后开始 10 分钟倒计时
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem", alignItems: "start" }}>
          {/* 左：手牌 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 700, fontSize: uiRem(1), color: "white" }}>📦 我的手牌</h3>
              <span
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "9999px",
                  padding: "0.125rem 0.625rem",
                  fontSize: uiRem(0.75),
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
                        padding: "0.65rem",
                        cursor: isUsed ? "not-allowed" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        transition: "all 0.2s ease",
                        transform: isSelected ? "scale(1.04)" : undefined,
                        boxShadow: isSelected ? `0 0 20px ${def.color}40` : undefined,
                        opacity: isUsed ? 0.4 : 1,
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: uiRem(0.65), color: "var(--color-text-muted)" }}>
                          {isUsed ? "已用" : isSelected ? "已选" : ""}
                        </span>
                        {isSelected && <span style={{ color: def.color, fontSize: uiRem(1) }}>✓</span>}
                      </div>
                      <BuffCardArt cardId={cardId} buffImages={buffImages} compact />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: uiRem(0.85), color: isSelected ? def.color : "white", marginBottom: "0.2rem" }}>
                          {def.name}
                        </div>
                        <div
                          style={{
                            fontSize: uiRem(0.72),
                            color: "var(--color-text-muted)",
                            lineHeight: 1.35,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
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
              <h4 style={{ fontWeight: 700, color: selectedDef ? selectedDef.color : "var(--color-text-muted)", marginBottom: "1rem", fontSize: uiRem(0.95) }}>
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
                    fontSize: uiRem(0.875),
                  }}
                >
                  👈 点击左侧卡牌激活
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {/* 目标玩家 */}
                  {(selectedCard === "buff_slack" || selectedCard === "buff_swap") && (
                    <div>
                      <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                        目标玩家
                      </label>
                      <select
                        className="input"
                        value={targetPlayer}
                        onChange={(e) => setTargetPlayer(e.target.value)}
                        style={{ fontSize: uiRem(0.9) }}
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
                        <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>目标项目</label>
                        <select className="input" value={targetProject} onChange={(e) => setTargetProject(Number(e.target.value))}>
                          <option value="">-- 选择项目 --</option>
                          {game.activeProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>预测结果</label>
                        <select className="input" value={extraData} onChange={(e) => setExtraData(e.target.value)}>
                          <option value="">-- 选择预测 --</option>
                          <option value="empty">无人投资 (赢+200)</option>
                          <option value="full">恰好完成 (赢+150)</option>
                        </select>
                      </div>
                    </>
                  )}

                  {/* 反弹琵琶说明 */}
                  {selectedCard === "buff_rebound" && (
                    <div style={{ fontSize: uiRem(0.825), color: "var(--color-text-secondary)", lineHeight: 1.6, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "0.625rem", padding: "0.75rem" }}>
                      开启后，本轮受到【摸鱼传染】时自动反弹，精力+10而非-5。
                    </div>
                  )}

                  {/* 发动 */}
                  <button onClick={handleUse} className="btn btn-purple btn-full" style={{ background: selectedDef ? `linear-gradient(135deg, ${selectedDef.color}, ${selectedDef.color}bb)` : undefined }}>
                    ✨ 立即发动
                  </button>
                  <button onClick={() => setSelectedCard(null)} className="btn btn-ghost btn-full">
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
              left: 0,
              right: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.75rem",
              zIndex: 40,
              pointerEvents: "none",
            }}
          >
            <div className="buff-phase-waiting" style={{ pointerEvents: "auto" }}>
              等待其他玩家进入讨论和投资
              {gateTotal > 0 && (
                <span style={{ marginLeft: "0.5rem", opacity: 0.85, fontWeight: 600 }}>
                  ({gateReady}/{gateTotal})
                </span>
              )}
            </div>
            {onOpenInvestmentPrefill && (
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  pointerEvents: "auto",
                  border: "1px solid rgba(59,130,246,0.45)",
                  color: "#93c5fd",
                  background: "rgba(59,130,246,0.12)",
                  padding: "0.5rem 1.25rem",
                  fontWeight: 600,
                }}
                onClick={onOpenInvestmentPrefill}
              >
                预览投资
              </button>
            )}
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
              gap: "0.75rem",
              flexWrap: "wrap",
              background: "linear-gradient(to top, rgba(10,11,16,0.98) 60%, transparent)",
            }}
          >
            {onOpenInvestmentPrefill && (
              <button
                type="button"
                onClick={onOpenInvestmentPrefill}
                className="btn btn-sm"
                style={{
                  border: "1px solid rgba(59,130,246,0.45)",
                  color: "#93c5fd",
                  background: "rgba(59,130,246,0.12)",
                  padding: "0.75rem 1.5rem",
                  fontWeight: 600,
                }}
              >
                预览投资
              </button>
            )}
            <button
              onClick={() => (onEnterDiscussion ? onEnterDiscussion() : socket.emit("playerReady"))}
              style={{
                background: "rgba(212,175,55,0.07)",
                border: "1px solid rgba(212,175,55,0.35)",
                borderRadius: "9999px",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
                fontSize: uiRem(1.05),
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
              进入讨论和投资 →
              {gateTotal > 0 && (
                <span style={{ marginLeft: "0.35rem", fontWeight: 700, opacity: 0.9 }}>
                  ({gateReady}/{gateTotal})
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
