import { uiRem } from "../utils/typography";
import React, { useState } from "react";
import { GameState, Player } from "../types";
import { socket } from "../socket";
import { adminApiUrl, adminAuthHeaders } from "../admin/adminFetch";
import {
  getAuctionCardsForEra,
  getAuctionRound,
  BUFF_CARD_DEFS,
} from "../config/buffCards";
import { FATE_SKETCH_PERSONA_COLORS } from "../config/personaConfig";
import { AdminTutorialHostSection } from "../components/admin/AdminTutorialHostSection";
import { isAiPlayer } from "../utils/isAiPlayer";
import { useActionCountdown } from "../hooks/useActionCountdown";

const CARD_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(BUFF_CARD_DEFS).map(([id, d]) => [id, d.name])
);

interface Props {
  game: GameState;
  onExit?: () => void;
}

const PHASE_NAMES: Record<string, string> = {
  ROOM_WAITING: "等候开局",
  ERA_INTRO: "时代介绍", TUTORIAL: "新手教程", DRAFTING: "选座阶段",
  INVESTMENT: "投资决策", BUFF_USAGE: "道具使用", SETTLEMENT: "本轮结算",
  AUCTION: "拍卖会", GAME_OVER: "游戏结束", COMMUNITY_NAMING: "社区命名",
};

export const AdminView: React.FC<Props> = ({ game, onExit }) => {
  const showAdminTimer = game.phase === "INVESTMENT" && !!game.investmentEndsAt;
  const timeLeft = useActionCountdown(showAdminTimer, game.investmentEndsAt, game.serverNow);
  const [cardAuctionCosts, setCardAuctionCosts] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);

  const emit = (event: string, extra?: object) => socket.emit(event, { roomId: game.roomId, ...extra });

  const handleProposeBuff = (playerId: string, cardId: string, cost: number) => {
    if (game.phase !== "AUCTION") { alert("只能在拍卖阶段发卡"); return; }
    emit("adminProposeBuff", { playerId, cardId, cost: Math.floor(Number(cost) || 0) });
    alert("已发送交易请求");
  };

  const handleSocialRate = (playerId: string, rank: string) => {
    if (!rank) return;
    emit("adminRateSocial", { targetPlayerId: playerId, rank });
  };

  const handleSettleLottery = (playerId: string) => {
    const amount = prompt("请输入彩票中奖金额（可负）:", "0");
    if (amount !== null) emit("adminSettleLottery", { targetPlayerId: playerId, amount: Number(amount) });
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportData = async () => {
    if (exporting) return;
    if (
      game.phase !== "GAME_OVER" &&
      game.phase !== "COMMUNITY_NAMING" &&
      !window.confirm("本局尚未结束，导出数据可能不完整。是否继续？")
    ) {
      return;
    }
    setExporting(true);
    const base = game.roomId.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 64) || "room";
    const q = `roomId=${encodeURIComponent(game.roomId)}`;
    try {
      const expectedType =
        (format: "json" | "xlsx") =>
          format === "json"
            ? "application/json"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

      for (const [format, ext] of [["json", "json"], ["xlsx", "xlsx"]] as const) {
        const res = await fetch(adminApiUrl(`/api/session-export?${q}&format=${format}`), {
          headers: adminAuthHeaders(),
        });
        if (res.status === 401) {
          alert("未授权：请重新登录管理后台");
          return;
        }
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(`导出失败 (${format}): ${(err as { error?: string }).error ?? res.statusText}`);
          return;
        }
        const ct = res.headers.get("Content-Type") ?? "";
        if (!ct.includes(expectedType(format))) {
          alert(`导出失败 (${format})：服务器返回了非预期类型，请检查登录状态或房间是否仍存在`);
          return;
        }
        const blob = await res.blob();
        downloadBlob(blob, `${base}_session.${ext}`);
        if (format === "json") await sleep(400);
      }
    } catch (e) {
      console.error(e);
      alert("导出出错，请检查网络与服务器状态");
    } finally {
      setExporting(false);
    }
  };

  const humanPlayers = [...game.players]
    .filter((p) => !isAiPlayer(p))
    .sort((a, b) => b.wealth - a.wealth);
  const auctionRound = getAuctionRound(game.currentEra);
  const currentAuctionCards = getAuctionCardsForEra(game.currentEra);
  const distributedSet = new Set(game.auctionDistributedCardIds || []);

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60 && timeLeft > 0;

  return (
    <div className="admin-view" style={{ minHeight: "100vh", background: "#070b14", color: "white", fontFamily: "var(--font-sans)" }}>
      {/* 顶部控制栏 */}
      <div
        style={{
          background: "rgba(245,158,11,0.06)",
          borderBottom: "1px solid rgba(245,158,11,0.2)",
          padding: "1rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "1rem",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(16px)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#fbbf24" }}>👑 上帝控制台</h1>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>
              Room: {game.roomId}
            </span>
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginTop: "0.25rem", flexWrap: "wrap", fontSize: uiRem(0.8) }}>
            <span>
              阶段:{" "}
              <span style={{ color: "#60a5fa", fontWeight: 700 }}>
                {PHASE_NAMES[game.phase] || game.phase}
              </span>
              {game.phase === "TUTORIAL" && (
                <span style={{ color: "var(--color-text-muted)", fontWeight: 500, marginLeft: "0.5rem" }}>
                  · 请在下方同步面板控场
                </span>
              )}
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>Era {game.currentEra} · R{game.roundInEra}</span>
            {timeLeft > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 700,
                  color: isUrgent ? "#ef4444" : "#34d399",
                  background: isUrgent ? "rgba(239,68,68,0.15)" : "rgba(52,211,153,0.1)",
                  padding: "0.15rem 0.6rem",
                  borderRadius: "0.375rem",
                  animation: isUrgent ? "pulse 1s infinite" : undefined,
                }}
              >
                ⏱ {mins}:{secs}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {(game.phase === "ROOM_WAITING" || game.phase === "ERA_INTRO") && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => emit("adminStartTutorial")}>🎓 教程</button>
              <button
                className="btn btn-success btn-sm"
                onClick={() => {
                  if (confirm(game.phase === "ROOM_WAITING" ? "确认开局并进入第 1 时代？" : "确认强制进入投资阶段？")) {
                    emit("adminStartGame");
                  }
                }}
              >
                ▶ 开局
              </button>
            </>
          )}
          {game.phase === "AUCTION" ? (
            <button className="btn btn-purple btn-sm animate-pulse" onClick={() => { if (confirm("结束拍卖并进入下一阶段？")) emit("adminEndAuction"); }}>🏁 结束拍卖</button>
          ) : (
            <button className="btn btn-sm" style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }} onClick={() => { if (confirm("开启拍卖阶段？")) emit("adminSkipPhase", { targetPhase: "AUCTION" }); }}>🔨 拍卖</button>
          )}
          {game.phase !== "ERA_INTRO" && game.phase !== "TUTORIAL" && game.phase !== "ROOM_WAITING" && (
            <button className="btn btn-sm" style={{ background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.35)", color: "#fb923c" }} onClick={() => { if (confirm(`跳过 [${game.phase}]？`)) emit("adminSkipPhase"); }}>⏭ 跳过</button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd" }}
            onClick={handleExportData}
            disabled={exporting}
          >
            {exporting ? "导出中…" : "📥 导出数据"}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm("警告：解散房间？")) emit("adminDissolveRoom"); }}>💣 解散</button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>← 返回</button>
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>

        {game.phase === "TUTORIAL" && (
          <AdminTutorialHostSection
            game={game}
            onPrev={() => emit("adminTutorialPrev")}
            onNext={() => emit("adminTutorialNext")}
            onFinish={() => emit("adminEndTutorial")}
          />
        )}

        {/* 拍卖面板 */}
        {game.phase === "AUCTION" && (
          <div
            style={{
              background: "rgba(168,85,247,0.08)",
              border: "2px solid rgba(168,85,247,0.4)",
              borderRadius: "1.25rem",
              padding: "1.5rem",
              marginBottom: "1.5rem",
              boxShadow: "0 0 30px rgba(168,85,247,0.15)",
            }}
          >
            <h2 style={{ fontSize: "1.2rem", fontWeight: 800, color: "#c084fc", marginBottom: "1.25rem" }}>
              🔨 拍卖发卡控制台 · 第 {auctionRound} 场
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: "1rem",
              }}
            >
              {currentAuctionCards.map((card) => {
                const def = BUFF_CARD_DEFS[card.id];
                const sold = distributedSet.has(card.id);
                const cardCost = cardAuctionCosts[card.id] ?? 0;
                return (
                <div
                  key={card.id}
                  style={{
                    flex: "0 1 260px",
                    width: "min(100%, 260px)",
                    background: "rgba(0,0,0,0.3)",
                    border: `1px solid ${sold ? "rgba(100,100,100,0.3)" : "rgba(168,85,247,0.25)"}`,
                    borderRadius: "0.875rem",
                    padding: "1rem",
                    opacity: sold ? 0.55 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#d8b4fe", marginBottom: "0.35rem", fontSize: uiRem(0.95) }}>
                    {def?.name || card.name}
                    {sold && <span style={{ color: "var(--color-text-muted)", fontWeight: 600, marginLeft: "0.35rem" }}>(已成交)</span>}
                  </div>
                  <div style={{ fontSize: uiRem(0.75), color: "var(--color-text-secondary)", marginBottom: "0.875rem", lineHeight: 1.45 }}>
                    {def?.desc}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: uiRem(0.8) }}>
                      <span style={{ fontWeight: 700, color: "#fbbf24", whiteSpace: "nowrap" }}>成交价格</span>
                      <input
                        type="number"
                        min={0}
                        disabled={sold}
                        value={cardCost}
                        onChange={(e) =>
                          setCardAuctionCosts((prev) => ({
                            ...prev,
                            [card.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          }))
                        }
                        className="input"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          textAlign: "center",
                          fontFamily: "var(--font-mono)",
                          fontSize: uiRem(1),
                        }}
                      />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: uiRem(0.8) }}>
                      <span style={{ fontWeight: 700, color: "#c084fc" }}>得主</span>
                      <select
                        className="input"
                        disabled={sold}
                        onChange={(e) => {
                          if (e.target.value) {
                            handleProposeBuff(e.target.value, card.id, cardCost);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="">{sold ? "已成交" : "选择玩家…"}</option>
                        {!sold &&
                          humanPlayers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (💰{p.wealth})
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
              );})}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
          {/* 玩家监控表 */}
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "1.25rem",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)" }}>
              <h2 style={{ fontWeight: 700, fontSize: uiRem(1) }}>👥 玩家实时监控</h2>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: uiRem(0.8) }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.02)", color: "var(--color-text-muted)" }}>
                    {["#", "昵称", "状态", "社交", "人格", "手牌", "已用", "⚡", "💰", "操作"].map((h, i) => (
                      <th key={i} style={{ padding: "0.75rem 0.875rem", fontWeight: 700, fontSize: uiRem(0.7), textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "left", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {humanPlayers.map((p, idx) => {
                    const hasLottery = p.activeBuffs?.some((b) => b.cardId === "buff_lottery");
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "0.875rem", color: "var(--color-text-muted)" }}>{idx + 1}</td>
                        <td style={{ padding: "0.875rem", fontWeight: 700, color: "white" }}>{p.name}</td>
                        <td style={{ padding: "0.875rem" }}>
                          {game.phase === "ROOM_WAITING" ? (
                            p.connected ? (
                              <span style={{ color: "#34d399" }}>在线</span>
                            ) : (
                              <span style={{ color: "#f87171" }}>离线</span>
                            )
                          ) : p.connected ? (
                            p.ready ? (
                              <span style={{ color: "#34d399" }}>✅</span>
                            ) : (
                              <span style={{ color: "#fbbf24" }}>⏳</span>
                            )
                          ) : (
                            <span style={{ color: "#f87171" }}>❌</span>
                          )}
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <select
                            style={{
                              background: "rgba(15, 20, 60, 0.85)",
                              border: `1px solid ${p.socialRank === "A" ? "rgba(212,175,55,0.6)" : "rgba(212,175,55,0.2)"}`,
                              borderRadius: "0.375rem",
                              color: p.socialRank === "A" ? "#d4af37" : "var(--color-text-secondary)",
                              padding: "0.35rem 0.65rem",
                              fontSize: uiRem(0.875),
                              outline: "none",
                              cursor: "pointer",
                            }}
                            value={p.socialRank || ""}
                            onChange={(e) => handleSocialRate(p.id, e.target.value)}
                          >
                            <option value="">待评</option>
                            {["A", "B", "C", "D", "E"].map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          {p.analysisResult ? (
                            <span style={{ fontSize: uiRem(0.7), color: FATE_SKETCH_PERSONA_COLORS[p.analysisResult.primaryPersona] || "#60a5fa" }}>
                              {p.analysisResult.primaryPersona}
                            </span>
                          ) : (
                            <span style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.75) }}>尚未分析</span>
                          )}
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                            {(p.inventory || []).map((cid, i) => (
                              <span key={i} style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", borderRadius: "0.25rem", padding: "0.15rem 0.5rem", color: "#d8b4fe", fontSize: uiRem(0.7), whiteSpace: "nowrap" }}>
                                {CARD_NAME_MAP[cid] || cid}
                              </span>
                            ))}
                            {(!p.inventory || p.inventory.length === 0) && <span style={{ color: "var(--color-text-muted)" }}>—</span>}
                          </div>
                        </td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                            {(p.usedCards || []).map((cid, i) => (
                              <span key={i} style={{ color: "var(--color-text-muted)", textDecoration: "line-through", fontSize: uiRem(0.7) }}>
                                {CARD_NAME_MAP[cid] || cid}
                              </span>
                            ))}
                            {(!p.usedCards || p.usedCards.length === 0) && <span style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.7) }}>—</span>}
                          </div>
                        </td>
                        <td style={{ padding: "0.875rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#34d399" }}>{p.energy}</td>
                        <td style={{ padding: "0.875rem", fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fbbf24" }}>{p.wealth}</td>
                        <td style={{ padding: "0.875rem" }}>
                          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="admin-inline-btn"
                              onClick={() => { if (confirm(`踢出 ${p.name}？`)) emit("adminKickPlayer", { targetPlayerId: p.id }); }}
                              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#f87171" }}
                            >踢</button>
                            {p.ready && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                onClick={() => {
                                  const msg =
                                    game.phase === "INVESTMENT"
                                      ? `允许 ${p.name} 修改已提交的投资方案（退回已扣精力，保留原填写），确认？`
                                      : game.phase === "BUFF_USAGE"
                                        ? `取消 ${p.name} 的「进入讨论」确认，让其继续调整，确认？`
                                        : `解锁 ${p.name}？`;
                                  if (confirm(msg)) emit("adminUnlockPlayer", { targetPlayerId: p.id });
                                }}
                                style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", color: "#fbbf24" }}
                              >解</button>
                            )}
                            {hasLottery && (
                              <button
                                type="button"
                                onClick={() => handleSettleLottery(p.id)}
                                className="admin-inline-btn animate-pulse"
                                style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }}
                              >🎲</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 日志 */}
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "1.25rem",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              height: "600px",
            }}
          >
            <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
              <h2 style={{ fontWeight: 700, fontSize: uiRem(1) }}>📜 游戏日志</h2>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0.875rem" }}>
              {[...game.logs].reverse().map((log, i) => (
                <div
                  key={i}
                  style={{
                    borderLeft: "2px solid rgba(255,255,255,0.06)",
                    paddingLeft: "0.75rem",
                    paddingTop: "0.375rem",
                    paddingBottom: "0.375rem",
                    fontSize: uiRem(0.75),
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  {log}
                </div>
              ))}
            </div>
          </div>
          </div>
        </div>
    </div>
  );
};
