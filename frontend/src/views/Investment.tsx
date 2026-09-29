import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { socket } from "../socket";
import { ProjectCard } from "../components/ProjectCard";
import { EraThemeBanner } from "../components/EraThemeBanner";
import { useActionCountdown } from "../hooks/useActionCountdown";
import { useServerClockSkewRef } from "../hooks/useServerClockSkewRef";
import { getRemainingMs } from "../utils/actionCountdown";
import { LONG_CONTINUE_MIN_ENERGY, needsLongContinueWarn } from "../config/longTermRules";
import {
  resolveRankPlayerCountFromGame,
  resolveRankRewardTierCountFromGame,
} from "../config/projectCatalog";
import { CoffeeRoundIndicators } from "../components/CoffeeRoundIndicators";
import { CoffeeUnsubscribeModal } from "../components/CoffeeUnsubscribeModal";

const COFFEE_WEALTH_COST = 15;
const COFFEE_ENERGY_GAIN = 1;
import { ProjectDetailModal } from "../components/ProjectDetailModal";
import type { ActiveProject } from "../types";

function clampDraftToEnergy(
  draft: Record<number, number>,
  energy: number,
  projects: ActiveProject[]
): Record<number, number> {
  const out: Record<number, number> = {};
  let remaining = energy;
  for (const proj of projects) {
    let val = Math.max(0, Math.floor(Number(draft[proj.id] ?? 0)));
    val = Math.min(val, remaining);
    if (val > 0) {
      out[proj.id] = val;
      remaining -= val;
    }
  }
  return out;
}

interface Props {
  game: GameState;
  me: Player;
  mode: "discussion" | "investment";
  projectImages?: Record<number, number>;
  onBackToBuff?: () => void;
  /** 道具阶段预览内「进入讨论和投资」（与 BuffUsage 同源，不含人数计数） */
  onEnterDiscussion?: () => void;
  /** 跨预览/正式阶段保留的预填（由 GameRoom 持有） */
  draft: Record<number, number>;
  onDraftChange: React.Dispatch<React.SetStateAction<Record<number, number>>>;
}

// ——— 顶部状态栏 ———
const StatusBar: React.FC<{
  me: Player;
  remainingEnergy: number;
  showCountdown: boolean;
  investmentEndsAt?: number;
  serverNow?: number;
  onCoffee: () => void;
  coffeeLoading: boolean;
  coffeeLocked?: boolean;
  coffeePurchases: number;
  onOpenUnsubscribe: () => void;
}> = ({
  me,
  remainingEnergy,
  showCountdown,
  investmentEndsAt,
  serverNow,
  onCoffee,
  coffeeLoading,
  coffeeLocked,
  coffeePurchases,
  onOpenUnsubscribe,
}) => {
  const timeLeft = useActionCountdown(
    showCountdown && !!investmentEndsAt,
    investmentEndsAt,
    serverNow
  );

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60 && timeLeft > 0;
  const isDanger = timeLeft < 20 && timeLeft > 0;

  return (
    <div className="status-bar">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: "1100px", margin: "0 auto" }}>
        {/* 左侧：精力 + 财富 */}
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.15rem" }}>
            <CoffeeRoundIndicators
              count={coffeePurchases}
              disabled={!!coffeeLocked}
              onOpenUnsubscribe={onOpenUnsubscribe}
            />
            <span style={{ fontSize: uiRem(1.1) }}>⚡</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: uiRem(1.2),
                color: remainingEnergy < 0 ? "#ef4444" : "#34d399",
              }}
            >
              {remainingEnergy}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>/ {me.energy}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: uiRem(1.1) }}>💰</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: uiRem(1.2), color: "#fbbf24" }}>
              {me.wealth}
            </span>
          </div>
        </div>

        {/* 右侧：倒计时 + 咖啡 */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {showCountdown && investmentEndsAt && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: "1.4rem",
                color: isDanger ? "#ef4444" : isUrgent ? "#f97316" : "#60a5fa",
                animation: isDanger ? "pulse 0.5s infinite" : isUrgent ? "pulse 1s infinite" : undefined,
                background: isDanger
                  ? "rgba(239,68,68,0.1)"
                  : isUrgent
                  ? "rgba(249,115,22,0.1)"
                  : "rgba(59,130,246,0.1)",
                padding: "0.375rem 0.875rem",
                borderRadius: "0.5rem",
                border: `1px solid ${isDanger ? "rgba(239,68,68,0.3)" : isUrgent ? "rgba(249,115,22,0.3)" : "rgba(59,130,246,0.2)"}`,
              }}
            >
              ⏱ {mins}:{secs}
            </div>
          )}
          <button
            onClick={onCoffee}
            disabled={coffeeLoading || me.wealth < COFFEE_WEALTH_COST || coffeeLocked}
            className="btn btn-sm"
            style={{
              background: "rgba(180,83,9,0.2)",
              border: "1px solid rgba(180,83,9,0.4)",
              color: me.wealth >= COFFEE_WEALTH_COST ? "#fcd34d" : "var(--color-text-muted)",
            }}
            title="消耗15财富换1精力"
          >
            ☕ {coffeeLoading ? "..." : "来杯咖啡（-15💰+1⚡）"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ——— 主组件 ———
export const Investment: React.FC<Props> = ({
  game,
  me,
  mode,
  projectImages = {},
  onBackToBuff,
  onEnterDiscussion,
  draft: investments,
  onDraftChange: setInvestments,
}) => {
  const [coffeeLoading, setCoffeeLoading] = useState(false);
  /** 服务端未下发 coffeePurchasesThisRound 时，用资源变化推断杯数 */
  const [inferredCoffeeCups, setInferredCoffeeCups] = useState(0);
  const [unsubscribeOpen, setUnsubscribeOpen] = useState(false);
  const [detailProjectId, setDetailProjectId] = useState<number | null>(null);
  const detailReturnFocusRef = useRef<HTMLElement | null>(null);

  const handleOpenDetail = useCallback((id: number, trigger?: HTMLElement) => {
    detailReturnFocusRef.current = trigger ?? null;
    setDetailProjectId(id);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailProjectId(null);
    const el = detailReturnFocusRef.current;
    detailReturnFocusRef.current = null;
    requestAnimationFrame(() => el?.focus());
  }, []);
  const coffeePendingRef = useRef(0);
  const coffeeAttemptSnapRef = useRef<{ energy: number; wealth: number } | null>(null);
  const prevCoffeePurchasesRef = useRef(me.coffeePurchasesThisRound ?? 0);
  const prevCoffeeForDraftRef = useRef(me.coffeePurchasesThisRound ?? 0);
  const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmittedRef = useRef(false);
  const prevReadyRef = useRef(me.ready);
  const [reopenEditHint, setReopenEditHint] = useState(false);
  const isSubmittedRef = useRef(false);
  const investmentsRef = useRef(investments);
  investmentsRef.current = investments;
  const clockSkewRef = useServerClockSkewRef(game.serverNow);

  const currentAllocated = Object.values(investments).reduce((a, b) => a + b, 0);
  const remainingEnergy = me.energy - currentAllocated;
  const isWaitingPhase = game.phase === "BUFF_USAGE";
  const isSubmitted = me.ready && !isWaitingPhase;
  isSubmittedRef.current = isSubmitted;
  /** 道具阶段仅预览预填，尚未点「进入讨论和投资」 */
  const isPreviewOnly = isWaitingPhase && mode === "discussion";

  const flushDraftToServer = () => {
    if (draftSyncTimerRef.current) {
      clearTimeout(draftSyncTimerRef.current);
      draftSyncTimerRef.current = null;
    }
    if (isSubmittedRef.current) return;
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;
    socket.emit("syncInvestmentDraft", { investment: investmentsRef.current });
  };

  useEffect(() => {
    const wasReady = prevReadyRef.current;
    prevReadyRef.current = me.ready;
    if (game.phase !== "INVESTMENT" || !wasReady || me.ready) return;
    autoSubmittedRef.current = false;
    const nextDraft = me.investmentDraft ? { ...me.investmentDraft } : {};
    setInvestments(nextDraft);
    investmentsRef.current = nextDraft;
    setReopenEditHint(true);
    socket.emit("syncInvestmentDraft", { investment: nextDraft });
  }, [game.phase, me.ready, me.investmentDraft, me.id, setInvestments]);

  useEffect(() => {
    if (!reopenEditHint) return;
    const t = window.setTimeout(() => setReopenEditHint(false), 10_000);
    return () => window.clearTimeout(t);
  }, [reopenEditHint]);

  useEffect(() => {
    autoSubmittedRef.current = false;
  }, [game.investmentEndsAt, game.phase, game.globalRound]);

  useEffect(() => {
    if (isSubmitted) return;
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;

    if (draftSyncTimerRef.current) clearTimeout(draftSyncTimerRef.current);
    draftSyncTimerRef.current = setTimeout(() => {
      socket.emit("syncInvestmentDraft", { investment: investments });
    }, 400);

    return () => {
      if (draftSyncTimerRef.current) clearTimeout(draftSyncTimerRef.current);
    };
  }, [investments, isSubmitted, game.phase]);

  useEffect(() => {
    return () => {
      flushDraftToServer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phase]);

  const handleBackToBuff = () => {
    flushDraftToServer();
    onBackToBuff?.();
  };

  const handleEnterDiscussion = () => {
    flushDraftToServer();
    if (onEnterDiscussion) onEnterDiscussion();
    else socket.emit("playerReady");
  };

  const handleInputChange = (projectId: number, val: number) => {
    if (val < 0) return;
    setInvestments((prev) => ({ ...prev, [projectId]: val }));
  };

  const commitInvestment = (payload: Record<number, number>) => {
    socket.emit("syncInvestmentDraft", { investment: payload });
    socket.emit("submitInvestment", { investment: payload });
  };

  const handleSubmit = (auto = false) => {
    const payload = investmentsRef.current;

    if (auto) {
      commitInvestment(payload);
      return;
    }

    if (remainingEnergy < 0) {
      alert("精力分配超限！");
      return;
    }

    const abandonWarnings: string[] = [];
    for (const proj of game.activeProjects) {
      if (!needsLongContinueWarn(proj, me)) continue;
      const val = payload[proj.id] || 0;
      if (val > 0 && val < LONG_CONTINUE_MIN_ENERGY) {
        alert(
          `长期项目「${proj.name}」追加投资须至少 ${LONG_CONTINUE_MIN_ENERGY} 精力，或设为 0 以放弃参投。`
        );
        return;
      }
      if (val < LONG_CONTINUE_MIN_ENERGY) {
        abandonWarnings.push(`「${proj.name}」`);
      }
    }

    if (abandonWarnings.length > 0) {
      if (
        !window.confirm(
          `确认提交？注意：你对 ${abandonWarnings.join(", ")} 本轮投入不足 ${LONG_CONTINUE_MIN_ENERGY}，将视为放弃并退回累计投入，且不能再参投分红！`
        )
      ) {
        return;
      }
    } else {
      if (
        !window.confirm(
          "确认提交投资方案吗？提交后将锁定方案；如需修改请联系主持人解锁。"
        )
      ) {
        return;
      }
    }

    commitInvestment(payload);
  };

  useEffect(() => {
    const end = game.investmentEndsAt;
    if (!end || isSubmitted) return;
    if (game.phase !== "INVESTMENT") return;

    const tick = () => {
      const msLeft = getRemainingMs(end, clockSkewRef.current);
      if (msLeft <= 1500 && msLeft > 0) {
        socket.emit("syncInvestmentDraft", { investment: investmentsRef.current });
      }
      if (msLeft > 0) return;
      if (autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      commitInvestment(investmentsRef.current);
    };

    const id = setInterval(tick, 250);
    tick();
    return () => clearInterval(id);
  }, [game.investmentEndsAt, game.phase, game.serverNow, isSubmitted, clockSkewRef]);

  useEffect(() => {
    const cups = me.coffeePurchasesThisRound ?? 0;
    const prevCups = prevCoffeePurchasesRef.current;

    if (cups > prevCups) {
      setInferredCoffeeCups(0);
    } else if (cups < prevCups) {
      setInferredCoffeeCups((n) => Math.max(0, Math.min(n, cups)));
    }

    if (cups > prevCups && coffeePendingRef.current > 0) {
      const delta = Math.min(cups - prevCups, coffeePendingRef.current);
      coffeePendingRef.current -= delta;
      if (coffeePendingRef.current <= 0) {
        coffeeAttemptSnapRef.current = null;
        setCoffeeLoading(false);
      }
    }

    const snap = coffeeAttemptSnapRef.current;
    if (
      coffeePendingRef.current > 0 &&
      snap &&
      me.energy >= snap.energy + COFFEE_ENERGY_GAIN &&
      me.wealth <= snap.wealth - COFFEE_WEALTH_COST
    ) {
      coffeePendingRef.current = 0;
      coffeeAttemptSnapRef.current = null;
      setCoffeeLoading(false);
      if (cups <= prevCups) {
        setInferredCoffeeCups((n) => n + 1);
      }
    }

    prevCoffeePurchasesRef.current = cups;
  }, [me.coffeePurchasesThisRound, me.energy, me.wealth]);

  useEffect(() => {
    setInferredCoffeeCups(0);
    prevCoffeePurchasesRef.current = me.coffeePurchasesThisRound ?? 0;
  }, [game.globalRound, game.currentEra, game.roundInEra]);

  useEffect(() => {
    const curr = me.coffeePurchasesThisRound ?? 0;
    if (curr < prevCoffeeForDraftRef.current) {
      const serverDraft = me.investmentDraft;
      if (serverDraft && Object.keys(serverDraft).length > 0) {
        setInvestments({ ...serverDraft });
      } else {
        setInvestments((prev) => clampDraftToEnergy(prev, me.energy, game.activeProjects));
      }
    }
    prevCoffeeForDraftRef.current = curr;
  }, [me.coffeePurchasesThisRound, me.investmentDraft, me.energy, game.activeProjects, setInvestments]);

  useEffect(() => {
    if (isSubmitted) return;
    const allocated = Object.values(investments).reduce((a, b) => a + b, 0);
    if (allocated <= me.energy) return;
    setInvestments((prev) => clampDraftToEnergy(prev, me.energy, game.activeProjects));
  }, [me.energy, isSubmitted, game.activeProjects, investments, setInvestments]);

  useEffect(() => {
    if (isSubmitted) setUnsubscribeOpen(false);
  }, [isSubmitted]);

  useEffect(() => {
    if (!coffeeLoading) return;
    const t = window.setTimeout(() => {
      if (coffeePendingRef.current <= 0) return;
      coffeePendingRef.current = 0;
      coffeeAttemptSnapRef.current = null;
      setCoffeeLoading(false);
      alert("购买咖啡未确认。若财富已扣除仍无 ☕ 图标，请硬刷新页面；持续异常请联系主持检查服务端是否已部署最新版本。");
    }, 4_000);
    return () => window.clearTimeout(t);
  }, [coffeeLoading]);

  useEffect(() => {
    const onError = () => {
      coffeePendingRef.current = 0;
      coffeeAttemptSnapRef.current = null;
      setCoffeeLoading(false);
    };
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  const serverCoffeeCups = me.coffeePurchasesThisRound ?? 0;
  const effectiveCoffeeCups = Math.max(serverCoffeeCups, inferredCoffeeCups);

  const handleCoffee = () => {
    if (coffeeLoading || me.wealth < COFFEE_WEALTH_COST || isSubmitted) return;
    coffeeAttemptSnapRef.current = { energy: me.energy, wealth: me.wealth };
    coffeePendingRef.current += 1;
    setCoffeeLoading(true);
    socket.emit("performCoffee");
  };

  const eraCard = game.currentEraCard;
  const coffeePurchases = effectiveCoffeeCups;

  const investSecondsLeft = useActionCountdown(
    game.phase === "INVESTMENT" && !!game.investmentEndsAt && !isSubmitted,
    game.investmentEndsAt,
    game.serverNow
  );

  const longAbandonRiskNames = useMemo(() => {
    const names: string[] = [];
    for (const proj of game.activeProjects) {
      if (!needsLongContinueWarn(proj, me)) continue;
      const val = investments[proj.id] ?? 0;
      if (val < LONG_CONTINUE_MIN_ENERGY) names.push(proj.name);
    }
    return names;
  }, [game.activeProjects, me, investments]);

  const showLongAutoAbandonWarn =
    game.phase === "INVESTMENT" &&
    !isSubmitted &&
    investSecondsLeft > 0 &&
    investSecondsLeft <= 60 &&
    longAbandonRiskNames.length > 0;

  const detailProject = useMemo(
    () => (detailProjectId != null ? game.activeProjects.find((p) => p.id === detailProjectId) ?? null : null),
    [detailProjectId, game.activeProjects]
  );

  useEffect(() => {
    if (detailProjectId == null) return;
    if (!game.activeProjects.some((p) => p.id === detailProjectId)) {
      setDetailProjectId(null);
      detailReturnFocusRef.current = null;
    }
  }, [detailProjectId, game.activeProjects]);

  return (
    <div style={{ minHeight: "100vh", background: "#070b14" }}>
      <CoffeeUnsubscribeModal
        open={unsubscribeOpen}
        maxPurchased={coffeePurchases}
        onClose={() => setUnsubscribeOpen(false)}
        onRefunded={(count) =>
          setInferredCoffeeCups((n) => Math.max(0, n - count))
        }
      />
      <ProjectDetailModal
        project={detailProject}
        eraTheme={eraCard?.era}
        uploadedVersion={detailProject ? projectImages[detailProject.id] : undefined}
        playerCount={resolveRankRewardTierCountFromGame(game)}
        seatedPlayerCount={resolveRankPlayerCountFromGame(game)}
        onClose={handleCloseDetail}
      />
      {/* 顶部状态栏 */}
      <StatusBar
        me={me}
        remainingEnergy={remainingEnergy}
        showCountdown={game.phase === "INVESTMENT" && !!game.investmentEndsAt}
        investmentEndsAt={game.investmentEndsAt}
        serverNow={game.serverNow}
        onCoffee={handleCoffee}
        coffeeLoading={coffeeLoading}
        coffeeLocked={isSubmitted}
        coffeePurchases={coffeePurchases}
        onOpenUnsubscribe={() => {
          if (isSubmitted || coffeePurchases <= 0) return;
          setUnsubscribeOpen(true);
        }}
      />

      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          padding: isPreviewOnly ? "1.5rem 1rem 2rem" : "1.5rem 1rem 8rem",
        }}
      >
        {/* 等待提示 */}
        {isWaitingPhase && (
          <div
            className={me.ready ? "buff-phase-waiting-inline" : undefined}
            style={{
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.25)",
              borderRadius: "0.875rem",
              padding: "0.875rem 1.25rem",
              textAlign: "center",
              color: "#c084fc",
              fontSize: uiRem(0.9),
              fontWeight: 600,
              marginBottom: "1.5rem",
              ...(me.ready ? {} : { animation: "pulse 2s infinite" }),
            }}
          >
            {me.ready
              ? "已进入讨论队列，等待其他玩家进入讨论和投资；可继续调整预填"
              : "可预览并预填投资；全员点击「进入讨论和投资」后开始 10 分钟倒计时"}
            {onBackToBuff && (
              <div
                style={{
                  marginTop: "0.75rem",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.75rem",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={handleBackToBuff}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: "9999px",
                    color: "var(--color-text-secondary)",
                    cursor: "pointer",
                    fontSize: uiRem(1.05),
                    fontWeight: 600,
                    padding: "0.75rem 2rem",
                    letterSpacing: "0.03em",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.35)";
                    (e.currentTarget as HTMLButtonElement).style.color = "white";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.18)";
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                  }}
                >
                  ← 返回道具使用
                </button>
                {!me.ready && (
                  <button
                    type="button"
                    onClick={handleEnterDiscussion}
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
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,175,55,0.7)";
                      (e.currentTarget as HTMLButtonElement).style.color = "#d4af37";
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,175,55,0.14)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,175,55,0.35)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text-secondary)";
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,175,55,0.07)";
                    }}
                  >
                    进入讨论和投资 →
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {reopenEditHint && game.phase === "INVESTMENT" && !isSubmitted && (
          <div
            role="status"
            style={{
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.35)",
              borderRadius: "0.875rem",
              padding: "0.75rem 1.25rem",
              marginBottom: "1.25rem",
              color: "#93c5fd",
              fontSize: uiRem(0.9),
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            主持人已允许修改：请调整分配后重新提交。
          </div>
        )}

        {showLongAutoAbandonWarn && (
          <div
            role="alert"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: "0.875rem",
              padding: "0.75rem 1.25rem",
              marginBottom: "1.25rem",
              color: "#fecaca",
              fontSize: uiRem(0.9),
              fontWeight: 600,
              textAlign: "center",
              animation: investSecondsLeft <= 20 ? "pulse 0.8s infinite" : undefined,
            }}
          >
            倒计时结束将自动提交当前方案：{longAbandonRiskNames.join("、")} 未满 {LONG_CONTINUE_MIN_ENERGY}{" "}
            精力，将视为放弃并退回累计投入。
          </div>
        )}

        {eraCard && (
          <div style={{ marginBottom: "2rem" }}>
            <EraThemeBanner eraCard={eraCard} currentEra={game.currentEra} />
          </div>
        )}

        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white" }}>
            {mode === "discussion" || isWaitingPhase ? "📊 投资预览" : "📊 投资决策"}
          </h2>
          {remainingEnergy !== 0 && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: uiRem(0.875),
                color: remainingEnergy < 0 ? "#ef4444" : remainingEnergy > 0 ? "#fbbf24" : "#34d399",
                fontWeight: 700,
              }}
            >
              {remainingEnergy > 0 ? `剩余 ${remainingEnergy} 精力未分配` : remainingEnergy < 0 ? `超出 ${-remainingEnergy} 精力！` : "精力已全部分配"}
            </div>
          )}
        </div>

        {/* 项目网格 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "1.25rem",
            marginBottom: "2rem",
          }}
        >
          {game.activeProjects.map((proj) => (
            <ProjectCard
              key={proj.id}
              project={proj}
              myInvest={investments[proj.id] || 0}
              onChange={handleInputChange}
              disabled={isSubmitted}
              remainingEnergy={remainingEnergy}
              eraTheme={eraCard?.era}
              me={me}
              uploadedVersion={projectImages[proj.id]}
              onOpenDetail={handleOpenDetail}
            />
          ))}
          {game.activeProjects.length === 0 && (
            <div
              style={{
                gridColumn: "1 / -1",
                textAlign: "center",
                padding: "3rem",
                color: "var(--color-text-muted)",
                border: "1px dashed var(--color-border)",
                borderRadius: "1rem",
                fontSize: uiRem(1.1),
              }}
            >
              暂无可投资项目
            </div>
          )}
        </div>

        {/* 提交区域（预览预填时不显示底栏） */}
        {!isPreviewOnly && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(7,11,20,0.95)",
            borderTop: "1px solid var(--color-border)",
            backdropFilter: "blur(20px)",
            padding: "1rem",
            display: "flex",
            justifyContent: "center",
            zIndex: 50,
          }}
        >
          {isSubmitted ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                background: "rgba(16,185,129,0.1)",
                border: "1px solid rgba(16,185,129,0.3)",
                borderRadius: "9999px",
                padding: "0.875rem 2.5rem",
              }}
            >
              <span
                style={{
                  width: "0.625rem",
                  height: "0.625rem",
                  borderRadius: "50%",
                  background: "#34d399",
                  animation: "pulse 1.5s infinite",
                  display: "inline-block",
                }}
              />
              <span style={{ fontWeight: 700, color: "#34d399", fontSize: uiRem(1) }}>
                已提交，等待其他玩家...
              </span>
            </div>
          ) : isWaitingPhase && me.ready ? (
            <div className="buff-phase-waiting buff-phase-waiting--in-bar">
              等待其他玩家进入讨论和投资
            </div>
          ) : (
            <button
              onClick={() => handleSubmit(false)}
              disabled={isWaitingPhase || remainingEnergy < 0}
              className="btn btn-success btn-lg"
              style={{
                padding: "1rem 4rem",
                fontSize: uiRem(1.15),
                letterSpacing: "0.05em",
                minWidth: "280px",
              }}
            >
              {isWaitingPhase
                ? "⏳ 计时未开始，请先进入讨论和投资"
                : remainingEnergy < 0
                ? "⚠️ 精力超限"
                : "🔒 锁定并提交投资"}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
};
