import { uiRem } from "../utils/typography";
import React, { useState, useEffect } from "react";
import { GameState, Player } from "../types";
import { socket, BACKEND_URL } from "../socket";
import { adminApiUrl, adminAuthHeaders } from "../admin/adminFetch";
import { TUTORIAL_SLIDES } from "../tutorialData";
import { ALL_PROJECTS } from "../config/projects";
import {
  AUCTION_CARDS_BY_ROUND,
  getAuctionCardsForEra,
  getAuctionRound,
  BUFF_CARD_DEFS,
} from "../config/buffCards";
import { FATE_SKETCH_PERSONA_COLORS } from "../config/personaConfig";

const CARD_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(BUFF_CARD_DEFS).map(([id, d]) => [id, d.name])
);

const ALL_AUCTION_BUFF_IDS = Array.from(
  new Set(Object.values(AUCTION_CARDS_BY_ROUND).flat().map((c) => c.id))
);

interface Props {
  game: GameState;
  onExit?: () => void;
  projectImages?: Record<number, number>;
  eraImages?: Record<string, number>;
  buffImages?: Record<string, number>;
  onProjectImageVersion?: (id: number, version: number) => void;
  onEraImageVersion?: (eraName: string, version: number) => void;
  onBuffImageVersion?: (cardId: string, version: number) => void;
}

function isAiPlayer(p: Player): boolean {
  if (p.isAI) return true;
  if (p.name.startsWith("🤖") || p.name.startsWith("AI_")) return true;
  if (p.id.startsWith("ai_")) return true;
  if (/^AI\d+$/i.test(p.id) || /^AI\d+$/i.test(p.name)) return true;
  return false;
}

const PHASE_NAMES: Record<string, string> = {
  ERA_INTRO: "时代介绍", TUTORIAL: "新手教程", DRAFTING: "选座阶段",
  INVESTMENT: "投资决策", BUFF_USAGE: "道具使用", SETTLEMENT: "本轮结算",
  AUCTION: "拍卖会", GAME_OVER: "游戏结束", COMMUNITY_NAMING: "社区命名",
};

export const AdminView: React.FC<Props> = ({
  game,
  onExit,
  projectImages = {},
  eraImages = {},
  buffImages = {},
  onProjectImageVersion,
  onEraImageVersion,
  onBuffImageVersion,
}) => {
  const [timeLeft, setTimeLeft] = useState(0);
  const [cardAuctionCosts, setCardAuctionCosts] = useState<Record<string, number>>({});
  const [isImagePanelOpen, setIsImagePanelOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const target = game.investmentEndsAt || game.buffPhaseEndsAt;
    if (!target) { setTimeLeft(0); return; }
    const t = setInterval(() => setTimeLeft(Math.max(0, Math.floor((target - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [game.investmentEndsAt, game.buffPhaseEndsAt]);

  const emit = (event: string, extra?: object) => socket.emit(event, { roomId: game.roomId, ...extra });

  const handleDeleteImage = async (id: number | string, type: 'project' | 'era' | 'buff', event: React.MouseEvent) => {
    event.preventDefault();
    if (!window.confirm("确定要删除这张图片吗？")) return;
    const path =
      type === "era" ? "delete-era-image" : type === "buff" ? "delete-buff-image" : "delete-image";
    try {
      const res = await fetch(adminApiUrl(`/api/${path}`), {
        method: "POST",
        headers: { ...adminAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(id) }),
      });
      if (res.status === 401) alert("未授权：请重新登录管理后台");
      else if (!res.ok) alert("删除失败");
      else {
        const data = (await res.json().catch(() => null)) as { timestamp?: number } | null;
        const ts = data?.timestamp ?? 0;
        if (type === "buff" && onBuffImageVersion) onBuffImageVersion(String(id), ts);
        if (type === "era" && onEraImageVersion) onEraImageVersion(String(id), ts);
        if (type === "project" && onProjectImageVersion) onProjectImageVersion(Number(id), ts);
      }
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

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
  const currentStep = game.tutorialStep || 0;
  const isLastStep = currentStep >= TUTORIAL_SLIDES.length - 1;
  const auctionRound = getAuctionRound(game.currentEra);
  const currentAuctionCards = getAuctionCardsForEra(game.currentEra);
  const distributedSet = new Set(game.auctionDistributedCardIds || []);

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60 && timeLeft > 0;

  const handleImageUpload = (id: string | number, type: 'project' | 'era' | 'buff', e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (typeof ev.target?.result === 'string') {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob(async (blob) => {
            if (!blob) return;
            const formData = new FormData();
            formData.append("id", id.toString());
            formData.append("image", blob, `${id}.jpg`);
            
            try {
              const res = await fetch(adminApiUrl(
                `/api/${type === "era" ? "upload-era-image" : type === "buff" ? "upload-buff-image" : "upload-image"}`
              ), {
                method: "POST",
                headers: adminAuthHeaders(),
                body: formData,
              });
              if (res.status === 401) alert("未授权：请重新登录管理后台");
              else if (!res.ok) alert("上传失败！");
              else {
                const data = (await res.json().catch(() => null)) as { timestamp?: number } | null;
                const ts = data?.timestamp ?? Date.now();
                if (type === "buff" && onBuffImageVersion) onBuffImageVersion(String(id), ts);
                if (type === "era" && onEraImageVersion) onEraImageVersion(String(id), ts);
                if (type === "project" && onProjectImageVersion) onProjectImageVersion(Number(id), ts);
              }
            } catch (err) {
              console.error(err);
              alert("上传出错：" + err);
            } finally {
              input.value = "";
            }
          }, 'image/jpeg', 0.6);
        };
        img.src = ev.target.result;
      }
    };
    reader.readAsDataURL(file);
  };

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
          {game.phase === "ERA_INTRO" && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => emit("adminStartTutorial")}>🎓 教程</button>
              <button className="btn btn-success btn-sm" onClick={() => { if (confirm("确认开局？")) emit("adminStartGame"); }}>▶ 开局</button>
            </>
          )}
          {game.phase === "TUTORIAL" && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => emit("adminTutorialPrev")} disabled={currentStep === 0}>←</button>
              <span style={{ padding: "0.3rem 0.5rem", fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>{currentStep + 1}/{TUTORIAL_SLIDES.length}</span>
              {isLastStep
                ? <button className="btn btn-success btn-sm" onClick={() => emit("adminEndTutorial")}>✓ 完成</button>
                : <button className="btn btn-primary btn-sm" onClick={() => emit("adminTutorialNext")}>→</button>
              }
            </>
          )}
          {game.phase === "AUCTION" ? (
            <button className="btn btn-purple btn-sm animate-pulse" onClick={() => { if (confirm("结束拍卖并进入下一阶段？")) emit("adminEndAuction"); }}>🏁 结束拍卖</button>
          ) : (
            <button className="btn btn-sm" style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }} onClick={() => { if (confirm("开启拍卖阶段？")) emit("adminSkipPhase", { targetPhase: "AUCTION" }); }}>🔨 拍卖</button>
          )}
          {game.phase !== "ERA_INTRO" && game.phase !== "TUTORIAL" && (
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
                          {p.connected ? (p.ready ? <span style={{ color: "#34d399" }}>✅</span> : <span style={{ color: "#fbbf24" }}>⏳</span>) : <span style={{ color: "#f87171" }}>❌</span>}
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
                                      ? `解锁 ${p.name} 并将退回本轮已提交的投资与精力，确认？`
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

        {/* 底部：图片上传折叠面板 */}
        <div style={{ marginTop: "2rem", marginBottom: "2rem", background: "var(--color-bg-card)", borderRadius: "1.25rem", border: "1px solid var(--color-border)", overflow: "hidden" }}>
          <button
            type="button"
            aria-expanded={isImagePanelOpen}
            onClick={() => setIsImagePanelOpen(!isImagePanelOpen)}
            style={{ width: "100%", padding: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", color: "white", cursor: "pointer", fontWeight: 700 }}
          >
            <span className="admin-panel-toggle">🖼 图片上传管理 {isImagePanelOpen ? "▼" : "▶"}</span>
            <span className="admin-panel-toggle-hint" style={{ color: "var(--color-text-muted)", fontWeight: "normal" }}>点击展开</span>
          </button>
          
          {isImagePanelOpen && (
            <div style={{ padding: "1.5rem", borderTop: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: "2.5rem" }}>
              
              {/* 时代图片上传区域 */}
              <div>
                <h3 style={{ fontSize: uiRem(1), color: "#60a5fa", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>⏳</span> 时代图片上传 (竖版 2:3)
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem" }}>
                  {["气候", "科技", "文化", "健康", "心理"].map(eraName => {
                    const version = eraImages[eraName] || "";
                    const imgUrl = `${BACKEND_URL}/uploads_eras/${eraName}.jpg${version ? "?v=" + version : ""}`;
                    return (
                      <div key={eraName} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "0.75rem", padding: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: uiRem(0.8), fontWeight: 700 }}>{eraName}</div>
                        <label style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                          <div style={{ width: "100%", aspectRatio: "2/3", background: "rgba(0,0,0,0.3)", borderRadius: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed rgba(255,255,255,0.2)", color: "var(--color-text-muted)", fontSize: uiRem(0.75), overflow: "hidden", position: "relative" }}>
                            {version ? <img src={imgUrl} alt={eraName} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "上传"}
                          </div>
                          <input type="file" accept="image/*" onChange={(e) => handleImageUpload(eraName, 'era', e)} style={{ display: "none" }} />
                        </label>
                        {version ? (
                          <button type="button" onClick={(e) => handleDeleteImage(eraName, 'era', e)} className="admin-delete-btn">删除图片</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 拍卖道具卡面（与对局 BuffCardArt / uploads_buffs 一致） */}
              <div>
                <h3 style={{ fontSize: uiRem(1), color: "#c084fc", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>🔨</span> 拍卖道具卡面 (竖版 3:4)
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem" }}>
                  {ALL_AUCTION_BUFF_IDS.map((cardId) => {
                    const def = BUFF_CARD_DEFS[cardId];
                    const version = buffImages[cardId] || 0;
                    const hasImage = version > 0;
                    const imgUrl = `${BACKEND_URL}/uploads_buffs/${cardId}.jpg${hasImage ? `?v=${version}` : ""}`;
                    return (
                      <div
                        key={cardId}
                        style={{
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: "0.75rem",
                          padding: "0.75rem",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "0.5rem",
                          border: "1px solid rgba(168,85,247,0.2)",
                        }}
                      >
                        <div
                          style={{ fontSize: uiRem(0.75), fontWeight: 700, textAlign: "center", color: def?.color || "#d8b4fe" }}
                          title={cardId}
                        >
                          {def?.name || cardId}
                        </div>
                        <label style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                          <div
                            style={{
                              width: "100%",
                              aspectRatio: "3/4",
                              background: "rgba(0,0,0,0.3)",
                              borderRadius: "0.5rem",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1px dashed rgba(168,85,247,0.35)",
                              color: "var(--color-text-muted)",
                              fontSize: uiRem(0.75),
                              overflow: "hidden",
                            }}
                          >
                            {hasImage ? (
                              <img src={imgUrl} alt={def?.name || cardId} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                              "上传"
                            )}
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleImageUpload(cardId, "buff", e)}
                            style={{ display: "none" }}
                          />
                        </label>
                        {hasImage ? (
                          <button type="button" onClick={(e) => handleDeleteImage(cardId, "buff", e)} className="admin-delete-btn">
                            删除图片
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 项目图片上传区域 */}
              <div>
                <h3 style={{ fontSize: uiRem(1), color: "#fbbf24", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>🏢</span> 项目图片上传 (横版 16:9)
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem" }}>
                  {ALL_PROJECTS.map(p => {
                    const version = projectImages[p.id] || "";
                    const imgUrl = `${BACKEND_URL}/uploads/${p.id}.jpg${version ? "?v=" + version : ""}`;
                    return (
                      <div key={p.id} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "0.75rem", padding: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: uiRem(0.75), color: "var(--color-text-secondary)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }} title={p.name}>[{p.era}] {p.name}</div>
                        <label style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
                          <div style={{ width: "100%", aspectRatio: "16/9", background: "rgba(0,0,0,0.3)", borderRadius: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", border: "1px dashed rgba(255,255,255,0.2)", color: "var(--color-text-muted)", fontSize: uiRem(0.75), overflow: "hidden", position: "relative" }}>
                            {version ? <img src={imgUrl} alt={p.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "上传"}
                          </div>
                          <input type="file" accept="image/*" onChange={(e) => handleImageUpload(p.id, 'project', e)} style={{ display: "none" }} />
                        </label>
                        {version ? (
                          <button type="button" onClick={(e) => handleDeleteImage(p.id, 'project', e)} className="admin-delete-btn">删除图片</button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
      </div>
    </div>
  );
};
