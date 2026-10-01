import React, { useMemo, useState, useEffect } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { socket } from "../socket";

import { BUFF_DEFS } from "../data/buffDefs";
import { BuffCardArt } from "../components/BuffCardArt";
import { BuffRoundChips } from "../components/BuffRoundChips";

interface Props {
  game: GameState;
  me: Player;
  buffImages?: Record<string, number>;
  /** 分屏嵌入时收紧标题区 */
  hideDock?: boolean;
  /** 已锁定投资时只读展示手牌 */
  readOnly?: boolean;
}

function canUseBuffs(game: GameState, me: Player, readOnly: boolean): boolean {
  if (readOnly || me.ready) return false;
  return game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE";
}

export const BuffUsage: React.FC<Props> = ({
  game,
  me,
  buffImages = {},
  hideDock = false,
  readOnly = false,
}) => {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [targetPlayer, setTargetPlayer] = useState("");
  const [targetProject, setTargetProject] = useState<number | undefined>(undefined);
  const [burnCardId, setBurnCardId] = useState("");

  const actionsEnabled = canUseBuffs(game, me, readOnly);
  const actionsLocked = !actionsEnabled;

  useEffect(() => {
    if (actionsLocked) setSelectedCard(null);
  }, [actionsLocked]);

  useEffect(() => {
    if (selectedCard === "buff_lighter" && targetPlayer === me.id) {
      setTargetPlayer("");
      setBurnCardId("");
    }
  }, [selectedCard, targetPlayer, me.id]);

  const burnTarget = useMemo(
    () => game.players.find((p) => p.id === targetPlayer),
    [game.players, targetPlayer]
  );
  const burnOptions = useMemo(() => {
    if (!burnTarget || burnTarget.id === me.id) return [];
    return (burnTarget.burnableCardIds ?? []).map((id) => ({
      id,
      ownerId: burnTarget.id,
      label: BUFF_DEFS[id]?.name || id,
    }));
  }, [burnTarget, me.id]);

  const lighterBurnBlocked =
    selectedCard === "buff_lighter" &&
    !!burnTarget &&
    burnTarget.id !== me.id &&
    burnOptions.length === 0;

  const handleUse = () => {
    if (actionsLocked) return;
    if (!selectedCard) return;
    if (selectedCard === "buff_force_buy") {
      alert("强买强卖请在拍卖阶段对主持标出的当前卡使用");
      return;
    }
    if ((selectedCard === "buff_slack" || selectedCard === "buff_lighter") && !targetPlayer) {
      alert("请选择目标玩家");
      return;
    }
    if (selectedCard === "buff_lighter" && targetPlayer === me.id) {
      alert("打火机不能烧毁自己的卡");
      return;
    }
    if (selectedCard === "buff_short" && !targetProject) {
      alert("请选择目标项目");
      return;
    }
    if (selectedCard === "buff_lighter" && !burnCardId) {
      alert("请选择目标卡牌");
      return;
    }
    socket.emit("useBuffCard", {
      cardId: selectedCard,
      targetPlayerId: targetPlayer || undefined,
      targetProjectId: targetProject,
      burnCardId: burnCardId || undefined,
    });
    setSelectedCard(null);
    setTargetPlayer("");
    setTargetProject(undefined);
    setBurnCardId("");
  };

  const selectedDef = selectedCard ? BUFF_DEFS[selectedCard] : null;

  return (
    <div
      className="buff-usage-page"
      style={{
        minHeight: hideDock ? "100%" : "100vh",
        background: `radial-gradient(ellipse at 50% 0%, rgba(168,85,247,0.12) 0%, transparent 55%), #070b14`,
        paddingTop: "1.5rem",
        paddingLeft: "1rem",
        paddingRight: "1rem",
        paddingBottom: "1.5rem",
      }}
    >
      <div
        style={{
          maxWidth: "1000px",
          margin: "0 auto",
          opacity: actionsLocked && !readOnly ? 0.55 : 1,
          pointerEvents: actionsLocked ? "none" : "auto",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
          <h1
            style={{
              fontSize: hideDock ? "1.5rem" : "2.25rem",
              fontWeight: 900,
              background: "linear-gradient(135deg, #a855f7, #ec4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              marginBottom: "0.375rem",
            }}
          >
            🔮 道具
          </h1>
          {!hideDock && (
            <p style={{ color: "var(--color-text-secondary)", fontSize: uiRem(0.9) }}>
              投资阶段内可使用手牌；锁定投资后不可再发动
            </p>
          )}
          {!hideDock && (
            <div style={{ marginTop: "0.75rem" }}>
              <BuffRoundChips
                me={me}
                actionsDisabled={actionsLocked}
                canAct={actionsEnabled}
              />
            </div>
          )}
        </div>

        <div className="player-responsive-split">
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
                  return (
                    <button
                      key={idx}
                      onClick={() => !actionsLocked && setSelectedCard(isSelected ? null : cardId)}
                      disabled={actionsLocked}
                      style={{
                        border: `2px solid ${isSelected ? def.color : "var(--color-border)"}`,
                        borderRadius: "1rem",
                        background: isSelected ? `${def.color}18` : "var(--color-bg-card)",
                        padding: "0.65rem",
                        cursor: actionsLocked ? "not-allowed" : "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        transition: "all 0.2s ease",
                        transform: isSelected ? "scale(1.04)" : undefined,
                        boxShadow: isSelected ? `0 0 20px ${def.color}40` : undefined,
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <span style={{ fontSize: uiRem(0.65), color: "var(--color-text-muted)" }}>
                          {isSelected ? "已选" : ""}
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

          {!readOnly && (
          <div>
            <div
              style={{
                background: "var(--color-bg-card)",
                border: `1px solid ${selectedDef ? selectedDef.color + "44" : "var(--color-border)"}`,
                borderRadius: "1rem",
                padding: "1.25rem",
                position: "sticky",
                top: "calc(var(--buff-invest-tab-h, 0px) + 1rem)",
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
                  👈 点击左侧卡牌发动
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {(selectedCard === "buff_slack" || selectedCard === "buff_lighter") && (
                    <div>
                      <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                        目标玩家
                      </label>
                      <select
                        className="input"
                        value={targetPlayer}
                        onChange={(e) => {
                          setTargetPlayer(e.target.value);
                          setBurnCardId("");
                        }}
                        style={{ fontSize: uiRem(0.9) }}
                      >
                        <option value="">-- 选择目标 --</option>
                        {(selectedCard === "buff_lighter"
                          ? game.players.filter((p) => p.id !== me.id)
                          : game.players
                        ).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.id === me.id ? "（自己）" : ""} (⚡{p.energy})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {selectedCard === "buff_lighter" && targetPlayer && (
                    <div>
                      <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
                        目标卡牌
                      </label>
                      {lighterBurnBlocked ? (
                        <p
                          style={{
                            fontSize: uiRem(0.85),
                            color: "var(--color-text-secondary)",
                            margin: 0,
                            lineHeight: 1.5,
                          }}
                        >
                          该玩家没有拍卖得到的道具
                        </p>
                      ) : (
                        <select
                          className="input"
                          value={burnCardId || ""}
                          onChange={(e) => setBurnCardId(e.target.value)}
                        >
                          <option value="">-- 选择卡牌 --</option>
                          {burnOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}

                  {selectedCard === "buff_short" && (
                    <div>
                      <label style={{ display: "block", fontSize: uiRem(0.7), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>目标项目</label>
                      <select
                        className="input"
                        value={targetProject ?? ""}
                        onChange={(e) => setTargetProject(e.target.value ? Number(e.target.value) : undefined)}
                      >
                        <option value="">-- 选择项目 --</option>
                        {game.activeProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {selectedCard === "buff_work_rest" && (
                    <div style={{ fontSize: uiRem(0.825), color: "var(--color-text-secondary)", lineHeight: 1.6, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "0.625rem", padding: "0.75rem" }}>
                      被使用【摸鱼传染】后获得 8 精力。单独使用无效。
                    </div>
                  )}

                  <button
                    onClick={handleUse}
                    disabled={lighterBurnBlocked}
                    className="btn btn-purple btn-full"
                    style={{
                      background: selectedDef
                        ? `linear-gradient(135deg, ${selectedDef.color}, ${selectedDef.color}bb)`
                        : undefined,
                      opacity: lighterBurnBlocked ? 0.45 : 1,
                    }}
                  >
                    ✨ 立即发动
                  </button>
                  <button onClick={() => setSelectedCard(null)} className="btn btn-ghost btn-full">
                    取消
                  </button>
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
};
