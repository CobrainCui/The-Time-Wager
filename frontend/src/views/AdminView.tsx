import { uiRem } from "../utils/typography";
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GameState, Player } from "../types";
import type { GeneratePdfResult } from "../utils/pdfGenerator";
import { AdminPdfCaptureJob, freezeGameForPdfExport } from "../admin/adminPdfSnapshot";
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

const AdminPlayerPdfCapture = lazy(() =>
  import("../admin/AdminPlayerPdfCapture").then((m) => ({ default: m.AdminPlayerPdfCapture }))
);

const CARD_NAME_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(BUFF_CARD_DEFS).map(([id, d]) => [id, d.name])
);

interface Props {
  game: GameState;
  onExit?: () => void;
}

const PHASE_NAMES: Record<string, string> = {
  ROOM_WAITING: "等候开局",
  ERA_INTRO: "时代介绍", TUTORIAL: "新手教程",
  INVESTMENT: "投资决策", BUFF_USAGE: "道具使用", SETTLEMENT: "本轮结算",
  AUCTION: "拍卖会", GAME_OVER: "游戏结束", COMMUNITY_NAMING: "社区命名",
};

export const AdminView: React.FC<Props> = ({ game, onExit }) => {
  const showAdminTimer = game.phase === "INVESTMENT" && !!game.investmentEndsAt;
  const timeLeft = useActionCountdown(showAdminTimer, game.investmentEndsAt, game.serverNow);
  const [communityNameDraft, setCommunityNameDraft] = useState("");
  const [cardAuctionCosts, setCardAuctionCosts] = useState<Record<string, number>>({});
  const [cardAuctionWinners, setCardAuctionWinners] = useState<Record<string, string>>({});
  const [unlockingPlayerId, setUnlockingPlayerId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [pdfJob, setPdfJob] = useState<AdminPdfCaptureJob | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfBatchProgress, setPdfBatchProgress] = useState<string | null>(null);
  const [pdfFeedback, setPdfFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const pdfExportResolverRef = useRef<((result: GeneratePdfResult) => void) | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  const humanPlayers = [...game.players]
    .filter((p) => !isAiPlayer(p))
    .sort((a, b) => b.wealth - a.wealth);

  /** 投资倒计时仍在跑时，才允许对已锁定玩家显示「解」 */
  const investmentUnlockOpen = game.phase === "INVESTMENT" && timeLeft > 0;
  const lockedHumanCount = humanPlayers.filter((p) => p.ready).length;

  const canUnlockInvestmentNow = () =>
    game.phase === "INVESTMENT" &&
    typeof game.investmentEndsAt === "number" &&
    Date.now() < game.investmentEndsAt;

  useEffect(() => {
    if (!unlockingPlayerId) return;
    const target = game.players.find((p) => p.id === unlockingPlayerId);
    if (!target || !target.ready || game.phase !== "INVESTMENT") {
      setUnlockingPlayerId(null);
      return;
    }
    // 失败时玩家仍 ready，用超时解开按钮防抖
    const t = window.setTimeout(() => setUnlockingPlayerId(null), 4000);
    return () => window.clearTimeout(t);
  }, [game.players, game.phase, unlockingPlayerId]);

  const reportPlayers = [...game.players]
    .filter((p) => !!p.analysisResult)
    .sort((a, b) => b.wealth - a.wealth);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const reportsAvailable = game.phase === "GAME_OVER" && reportPlayers.length > 0;

  const handlePdfCaptureComplete = useCallback((result: GeneratePdfResult) => {
    setPdfJob(null);
    pdfExportResolverRef.current?.(result);
    pdfExportResolverRef.current = null;
  }, []);

  const runPlayerPdfExport = useCallback((player: Player): Promise<GeneratePdfResult> => {
    if (!player.analysisResult) {
      return Promise.resolve({ ok: false, message: "该玩家尚无人格分析数据" });
    }
    return new Promise((resolve) => {
      if (pdfExportResolverRef.current) {
        resolve({ ok: false, message: "正在生成其他报告，请稍候" });
        return;
      }
      pdfExportResolverRef.current = resolve;
      setPdfJob(freezeGameForPdfExport(gameRef.current, player));
    });
  }, []);

  const handleExportPlayerReport = async (player: Player) => {
    setPdfFeedback(null);
    setPdfExporting(true);
    try {
      const result = await runPlayerPdfExport(player);
      if (!result.ok) {
        setPdfFeedback({ type: "err", text: result.message });
      } else {
        const warn = result.warnings?.length ? `（${result.warnings.join("；")}）` : "";
        setPdfFeedback({ type: "ok", text: `已下载：${result.fileName}${warn}` });
      }
    } finally {
      setPdfExporting(false);
    }
  };

  const handleExportAllPlayerReports = async () => {
    const targets = [...game.players]
      .filter((p) => !!p.analysisResult)
      .sort((a, b) => b.wealth - a.wealth);
    if (targets.length === 0) {
      setPdfFeedback({
        type: "err",
        text: "暂无可导出的报告：请等待首富完成社区命名并进入「游戏结束」阶段。",
      });
      return;
    }
    if (!window.confirm(`将为 ${targets.length} 名玩家依次生成并下载《人生决策手册》PDF，是否继续？`)) {
      return;
    }
    setPdfFeedback(null);
    setPdfExporting(true);
    const failures: string[] = [];
    let success = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        const p = targets[i];
        setPdfBatchProgress(`正在生成 ${i + 1} / ${targets.length}：${p.name}`);
        const result = await runPlayerPdfExport(p);
        if (!result.ok) failures.push(`${p.name}: ${result.message}`);
        else {
          success += 1;
          await sleep(400);
        }
      }
      if (failures.length > 0) {
        setPdfFeedback({
          type: "err",
          text: `完成 ${success} 份，失败 ${failures.length} 份：${failures.join("；")}`,
        });
      } else {
        setPdfFeedback({ type: "ok", text: `已全部下载 ${success} 份玩家报告。` });
      }
    } finally {
      setPdfBatchProgress(null);
      setPdfExporting(false);
    }
  };

  const emit = (event: string, extra?: object) => socket.emit(event, { roomId: game.roomId, ...extra });

  const handleProposeBuff = (playerId: string, cardId: string, cost: number) => {
    if (game.phase !== "AUCTION") { alert("只能在拍卖阶段发卡"); return; }
    if (!playerId) {
      alert("请先选择得主");
      return;
    }
    emit("adminProposeBuff", { playerId, cardId, cost: Math.floor(Number(cost) || 0) });
    setCardAuctionWinners((prev) => {
      const next = { ...prev };
      delete next[cardId];
      return next;
    });
    alert("已发送交易请求");
  };

  const handleRevokeAuctionCard = (
    cardId: string,
    displayName: string,
    mode: "pending" | "completed"
  ) => {
    if (game.phase !== "AUCTION") {
      alert("仅本场拍卖环节可撤回");
      return;
    }
    const message =
      mode === "pending"
        ? `撤回「${displayName}」的待确认报价？\n玩家将不再看到该确认弹窗，可重新发放。`
        : `撤回「${displayName}」的成交？\n将收回玩家手牌、退还成交财富，之后可重新发放。`;
    if (!window.confirm(message)) return;
    emit("adminRevokeAuctionCard", { cardId });
  };

  const handleSocialRate = (playerId: string, rank: string) => {
    if (!rank) return;
    emit("adminRateSocial", { targetPlayerId: playerId, rank });
  };

  const handleSettleLottery = (playerId: string, playerName: string) => {
    const amount = prompt("请输入彩票中奖金额（可负）:", "0");
    if (amount === null) return;
    const parsed = Number(String(amount).trim());
    if (!Number.isSafeInteger(parsed)) {
      alert("开奖金额必须为整数");
      return;
    }
    if (!window.confirm(`向 ${playerName} 发送彩票开奖确认：${parsed} 财富？\n确认后才会入账。`)) return;
    emit("adminSettleLottery", { targetPlayerId: playerId, amount: parsed });
  };

  const handleRevokeLottery = (
    playerId: string,
    playerName: string,
    mode: "pending" | "completed"
  ) => {
    const message =
      mode === "pending"
        ? `撤回 ${playerName} 的彩票待确认开奖？\n玩家将不再看到该确认弹窗，可重新开奖。`
        : `撤回 ${playerName} 的彩票开奖？\n将回滚已发放的财富并恢复彩票状态，之后可重新开奖。`;
    if (!window.confirm(message)) return;
    emit("adminRevokeLottery", { targetPlayerId: playerId });
  };

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

  const auctionRound = getAuctionRound(game.currentEra);
  const currentAuctionCards = getAuctionCardsForEra(game.currentEra);
  const distributedSet = new Set(game.auctionDistributedCardIds || []);
  const auctionDealByCardId = new Map(
    (game.auctionCompletedDeals ?? []).map((d) => [d.cardId, d] as const)
  );
  const pendingOfferByCardId = new Map(
    (game.pendingAuctionOffers ?? []).map((o) => [o.cardId, o] as const)
  );
  const playerNameById = new Map(game.players.map((p) => [p.id, p.name] as const));

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
            {game.phase === "INVESTMENT" && humanPlayers.length > 0 && (
              <span style={{ color: lockedHumanCount === humanPlayers.length ? "#34d399" : "#fbbf24" }}>
                已锁定 {lockedHumanCount}/{humanPlayers.length}
              </span>
            )}
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
          {game.phase === "COMMUNITY_NAMING" && (
            <form
              style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}
              onSubmit={(e) => {
                e.preventDefault();
                const name = communityNameDraft.trim();
                if (!name) return;
                emit("adminSubmitCommunityName", { name });
                setCommunityNameDraft("");
              }}
            >
              <input
                className="input"
                value={communityNameDraft}
                maxLength={20}
                placeholder="代为命名"
                onChange={(e) => setCommunityNameDraft(e.target.value)}
                style={{ width: "9rem", padding: "0.35rem 0.6rem" }}
              />
              <button type="submit" className="btn btn-gold btn-sm" disabled={!communityNameDraft.trim()}>
                代命名
              </button>
            </form>
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
          {reportsAvailable && (
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: "rgba(245,158,11,0.15)",
                border: "1px solid rgba(245,158,11,0.45)",
                color: "#fcd34d",
              }}
              onClick={handleExportAllPlayerReports}
              disabled={pdfExporting}
            >
              {pdfBatchProgress ?? (pdfExporting ? "报告生成中…" : "📄 导出全部玩家报告")}
            </button>
          )}
          <button className="btn btn-danger btn-sm" onClick={() => { if (confirm("警告：解散房间？")) emit("adminDissolveRoom"); }}>💣 解散</button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>← 返回</button>
        </div>
      </div>

      <div style={{ padding: "1.5rem", maxWidth: "1400px", margin: "0 auto" }}>

        {reportsAvailable && (
          <div
            style={{
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: "1rem",
              padding: "1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: uiRem(1.05), fontWeight: 800, color: "#fbbf24" }}>
                  终局玩家报告
                </h2>
                <p
                  style={{
                    margin: "0.35rem 0 0",
                    fontSize: uiRem(0.8),
                    color: "var(--color-text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  与玩家端相同的《人生决策手册》PDF，可逐人或批量下载。
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleExportAllPlayerReports}
                disabled={pdfExporting}
              >
                {pdfBatchProgress ?? (pdfExporting ? "生成中…" : "导出全部")}
              </button>
            </div>
            {(pdfBatchProgress || pdfFeedback) && (
              <p
                style={{
                  margin: "0 0 0.75rem",
                  fontSize: uiRem(0.8),
                  color: pdfFeedback?.type === "err" ? "#fca5a5" : "#6ee7b7",
                  lineHeight: 1.5,
                }}
              >
                {pdfBatchProgress ?? pdfFeedback?.text}
              </p>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {reportPlayers.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(245,158,11,0.2)",
                    borderRadius: "0.75rem",
                    padding: "0.875rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: uiRem(0.9) }}>
                      {p.name}
                      {isAiPlayer(p) ? (
                        <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}> · AI</span>
                      ) : null}
                    </div>
                    {p.analysisResult && (
                      <div
                        style={{
                          fontSize: uiRem(0.72),
                          color: FATE_SKETCH_PERSONA_COLORS[p.analysisResult.primaryPersona] || "#60a5fa",
                          marginTop: "0.2rem",
                        }}
                      >
                        {p.analysisResult.primaryPersona}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={pdfExporting}
                    onClick={() => handleExportPlayerReport(p)}
                  >
                    PDF
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {game.phase === "GAME_OVER" && reportPlayers.length === 0 && (
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px dashed var(--color-border)",
              borderRadius: "1rem",
              padding: "1rem 1.25rem",
              marginBottom: "1.5rem",
              fontSize: uiRem(0.85),
              color: "var(--color-text-muted)",
            }}
          >
            终局报告将在首富完成社区命名、人格分析生成后可用。
          </div>
        )}

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
                const deal = auctionDealByCardId.get(card.id);
                const pendingOffer = pendingOfferByCardId.get(card.id);
                const cardStatus = sold ? "sold" : pendingOffer ? "pending" : "available";
                const canRevoke =
                  game.phase === "AUCTION" &&
                  (cardStatus === "pending" || (cardStatus === "sold" && !!deal));
                const cardCost =
                  cardAuctionCosts[card.id] ?? pendingOffer?.cost ?? deal?.cost ?? 0;
                const winnerId =
                  cardAuctionWinners[card.id] ?? pendingOffer?.playerId ?? deal?.playerId ?? "";
                const winnerName = playerNameById.get(
                  pendingOffer?.playerId ?? deal?.playerId ?? ""
                );
                return (
                <div
                  key={card.id}
                  style={{
                    flex: "0 1 260px",
                    width: "min(100%, 260px)",
                    background: "rgba(0,0,0,0.3)",
                    border: `1px solid ${
                      cardStatus === "sold"
                        ? "rgba(100,100,100,0.3)"
                        : cardStatus === "pending"
                          ? "rgba(251,191,36,0.35)"
                          : "rgba(168,85,247,0.25)"
                    }`,
                    borderRadius: "0.875rem",
                    padding: "1rem",
                    opacity: cardStatus === "sold" ? 0.55 : 1,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#d8b4fe", marginBottom: "0.35rem", fontSize: uiRem(0.95) }}>
                    {def?.name || card.name}
                    {cardStatus === "pending" && (
                      <span style={{ color: "#fbbf24", fontWeight: 600, marginLeft: "0.35rem" }}>
                        (待{winnerName ? `${winnerName}` : "玩家"}确认 · 💰{pendingOffer?.cost})
                      </span>
                    )}
                    {cardStatus === "sold" && (
                      <span style={{ color: "var(--color-text-muted)", fontWeight: 600, marginLeft: "0.35rem" }}>
                        (已成交{winnerName ? ` · ${winnerName}` : ""})
                      </span>
                    )}
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
                        disabled={cardStatus === "sold"}
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
                        disabled={cardStatus === "sold"}
                        value={winnerId}
                        onChange={(e) =>
                          setCardAuctionWinners((prev) => ({
                            ...prev,
                            [card.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {cardStatus === "sold" ? "已成交" : "选择玩家…"}
                        </option>
                        {cardStatus !== "sold" &&
                          humanPlayers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (💰{p.wealth})
                            </option>
                          ))}
                      </select>
                    </label>
                    {cardStatus !== "sold" && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm btn-full"
                        disabled={!winnerId}
                        onClick={() => handleProposeBuff(winnerId, card.id, cardCost)}
                      >
                        {cardStatus === "pending" ? "重新发放" : "确认发放"}
                      </button>
                    )}
                    {canRevoke && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-full"
                        style={{ color: "#fca5a5", borderColor: "rgba(248,113,113,0.35)" }}
                        onClick={() =>
                          handleRevokeAuctionCard(
                            card.id,
                            def?.name || card.name,
                            cardStatus === "pending" ? "pending" : "completed"
                          )
                        }
                      >
                        {cardStatus === "pending" ? "撤回待确认" : "撤回成交"}
                      </button>
                    )}
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
                    const pendingLottery = (game.pendingLotteryOffers ?? []).find((o) => o.playerId === p.id);
                    const completedLottery = (game.lotteryCompletedDeals ?? []).find((d) => d.playerId === p.id);
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
                            {!p.connected && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                title="主持接管该离线座位，直接进入房间"
                                onClick={() => {
                                  if (confirm(`认领离线玩家 ${p.name}？将直接以该身份进入房间。`)) {
                                    emit("adminReleasePlayerClaim", { targetPlayerId: p.id });
                                  }
                                }}
                                style={{ background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.35)", color: "#93c5fd" }}
                              >认领</button>
                            )}
                            <button
                              type="button"
                              className="admin-inline-btn"
                              onClick={() => { if (confirm(`踢出 ${p.name}？`)) emit("adminKickPlayer", { targetPlayerId: p.id }); }}
                              style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "#f87171" }}
                            >踢</button>
                            {investmentUnlockOpen && p.ready && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                disabled={unlockingPlayerId === p.id}
                                title="解锁后该玩家可修改投资并重新锁定（倒计时仍继续）"
                                onClick={() => {
                                  if (!canUnlockInvestmentNow()) {
                                    alert("倒计时已结束，无法解锁");
                                    return;
                                  }
                                  if (
                                    !confirm(
                                      `允许 ${p.name} 修改已提交的投资方案（退回已扣精力，保留原填写），确认？`
                                    )
                                  ) {
                                    return;
                                  }
                                  // confirm 阻塞期间倒计时可能已结束
                                  if (!canUnlockInvestmentNow()) {
                                    alert("倒计时已结束，无法解锁");
                                    return;
                                  }
                                  setUnlockingPlayerId(p.id);
                                  emit("adminUnlockPlayer", { targetPlayerId: p.id });
                                }}
                                style={{
                                  background: "rgba(245,158,11,0.15)",
                                  border: "1px solid rgba(245,158,11,0.35)",
                                  color: "#fbbf24",
                                  opacity: unlockingPlayerId === p.id ? 0.55 : 1,
                                }}
                              >
                                {unlockingPlayerId === p.id ? "…" : "解"}
                              </button>
                            )}
                            {hasLottery && (
                              <button
                                type="button"
                                onClick={() => handleSettleLottery(p.id, p.name)}
                                className={`admin-inline-btn${pendingLottery ? "" : " animate-pulse"}`}
                                title={
                                  pendingLottery
                                    ? `重新发送开奖确认（当前 ${pendingLottery.amount}）`
                                    : "开奖"
                                }
                                style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }}
                              >🎲</button>
                            )}
                            {pendingLottery && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                title={`撤回待确认开奖（${pendingLottery.amount}）`}
                                onClick={() => handleRevokeLottery(p.id, p.name, "pending")}
                                style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", color: "#fca5a5" }}
                              >撤回待确认</button>
                            )}
                            {completedLottery && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                title={`撤回已开奖（${completedLottery.amount}）`}
                                onClick={() => handleRevokeLottery(p.id, p.name, "completed")}
                                style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)", color: "#fca5a5" }}
                              >撤回开奖</button>
                            )}
                            {reportsAvailable && (
                              <button
                                type="button"
                                className="admin-inline-btn"
                                disabled={!p.analysisResult || pdfExporting}
                                title={
                                  p.analysisResult
                                    ? "导出《人生决策手册》PDF"
                                    : "需完成社区命名后生成分析"
                                }
                                onClick={() => handleExportPlayerReport(p)}
                                style={{
                                  background: "rgba(245,158,11,0.15)",
                                  border: "1px solid rgba(245,158,11,0.35)",
                                  color: p.analysisResult ? "#fcd34d" : "var(--color-text-muted)",
                                }}
                              >
                                报告
                              </button>
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

      <Suspense fallback={null}>
        <AdminPlayerPdfCapture job={pdfJob} onComplete={handlePdfCaptureComplete} />
      </Suspense>
    </div>
  );
};
