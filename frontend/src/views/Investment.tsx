import React, { useState, useEffect, useRef } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { socket } from "../socket";
import { ProjectCard } from "../components/ProjectCard";
import { EraThemeBanner } from "../components/EraThemeBanner";

interface Props {
  game: GameState;
  me: Player;
  mode: "discussion" | "investment";
  projectImages?: Record<number, number>;
  onBackToBuff?: () => void;
}

// ——— 顶部状态栏 ———
const StatusBar: React.FC<{
  me: Player;
  remainingEnergy: number;
  investmentEndsAt?: number;
  buffPhaseEndsAt?: number;
  onCoffee: () => void;
  coffeeLoading: boolean;
  coffeeLocked?: boolean;
}> = ({ me, remainingEnergy, investmentEndsAt, buffPhaseEndsAt, onCoffee, coffeeLoading, coffeeLocked }) => {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const target = investmentEndsAt || buffPhaseEndsAt;
    if (!target) return;
    const timer = setInterval(() => {
      setTimeLeft(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(timer);
  }, [investmentEndsAt, buffPhaseEndsAt]);

  const mins = Math.floor(timeLeft / 60);
  const secs = (timeLeft % 60).toString().padStart(2, "0");
  const isUrgent = timeLeft < 60 && timeLeft > 0;
  const isDanger = timeLeft < 20 && timeLeft > 0;

  return (
    <div className="status-bar">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: "1100px", margin: "0 auto" }}>
        {/* 左侧：精力 + 财富 */}
        <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
          {me.draftOrder && (
            <div style={{ color: "#c084fc", fontSize: uiRem(0.85), fontWeight: 600 }}>
              💺 #{me.draftOrder}
            </div>
          )}
        </div>

        {/* 右侧：倒计时 + 咖啡 */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {(investmentEndsAt || buffPhaseEndsAt) && (
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
            disabled={coffeeLoading || me.wealth < 15 || coffeeLocked}
            className="btn btn-sm"
            style={{
              background: "rgba(180,83,9,0.2)",
              border: "1px solid rgba(180,83,9,0.4)",
              color: me.wealth >= 15 ? "#fcd34d" : "var(--color-text-muted)",
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
export const Investment: React.FC<Props> = ({ game, me, mode, projectImages = {}, onBackToBuff }) => {
  const [investments, setInvestments] = useState<Record<number, number>>({});
  const [coffeeLoading, setCoffeeLoading] = useState(false);
  const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmittedRef = useRef(false);
  const hydratedRoundRef = useRef<number | null>(null);
  const prevReadyRef = useRef(me.ready);
  const investmentsRef = useRef(investments);
  investmentsRef.current = investments;

  const currentAllocated = Object.values(investments).reduce((a, b) => a + b, 0);
  const remainingEnergy = me.energy - currentAllocated;
  const isWaitingPhase = game.phase === "BUFF_USAGE";
  const isSubmitted = me.ready && !isWaitingPhase;

  useEffect(() => {
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;
    if (hydratedRoundRef.current === game.globalRound) return;
    hydratedRoundRef.current = game.globalRound;
    if (me.investmentDraft && Object.keys(me.investmentDraft).length > 0) {
      setInvestments(me.investmentDraft);
    }
  }, [game.globalRound, game.phase, me.investmentDraft]);

  useEffect(() => {
    const wasReady = prevReadyRef.current;
    prevReadyRef.current = me.ready;
    if (game.phase !== "INVESTMENT" || !wasReady || me.ready) return;
    autoSubmittedRef.current = false;
    setInvestments(me.investmentDraft ? { ...me.investmentDraft } : {});
  }, [game.phase, me.ready, me.investmentDraft, me.id]);

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
      if (proj.type === 'long') {
        const myLongStatus = me.longTerm[proj.id];
        if (myLongStatus?.status === 'active') {
           const val = payload[proj.id] || 0;
           if (val > 0 && val < 3) {
             alert(`长期项目「${proj.name}」追加投资必须至少 3 格，或者设为 0 彻底放弃。`);
             return;
           } else if (val === 0) {
             abandonWarnings.push(`「${proj.name}」`);
           }
        }
      }
    }

    if (abandonWarnings.length > 0) {
      if (!window.confirm(`确认提交？注意：你对 ${abandonWarnings.join(", ")} 投入为 0，这将导致你永久退出该项目的分红排名！`)) {
        return;
      }
    } else {
      if (!window.confirm("确认提交投资方案吗？提交后本轮将无法修改。")) {
        return;
      }
    }

    commitInvestment(payload);
  };

  useEffect(() => {
    const end = game.investmentEndsAt;
    if (!end || isSubmitted) return;
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;

    const tick = () => {
      const msLeft = end - Date.now();
      if (msLeft <= 1500 && msLeft > 0) {
        socket.emit("syncInvestmentDraft", { investment: investmentsRef.current });
      }
      if (msLeft > 0) return;
      if (game.phase !== "INVESTMENT" || autoSubmittedRef.current) return;
      autoSubmittedRef.current = true;
      commitInvestment(investmentsRef.current);
    };

    const id = setInterval(tick, 250);
    tick();
    return () => clearInterval(id);
  }, [game.investmentEndsAt, game.phase, isSubmitted]);

  const handleCoffee = () => {
    if (coffeeLoading || me.wealth < 15) return;
    setCoffeeLoading(true);
    socket.emit("performCoffee");
    setTimeout(() => setCoffeeLoading(false), 1200);
  };

  const eraCard = game.currentEraCard;

  return (
    <div style={{ minHeight: "100vh", background: "#070b14" }}>
      {/* 顶部状态栏 */}
      <StatusBar
        me={me}
        remainingEnergy={remainingEnergy}
        investmentEndsAt={game.investmentEndsAt}
        buffPhaseEndsAt={game.buffPhaseEndsAt}
        onCoffee={handleCoffee}
        coffeeLoading={coffeeLoading}
        coffeeLocked={isSubmitted}
      />

      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "1.5rem 1rem 8rem" }}>
        {/* 等待提示 */}
        {isWaitingPhase && (
          <div
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
              animation: "pulse 2s infinite",
            }}
          >
            {me.ready
              ? "🔮 已完成道具使用，可预填投资；倒计时结束后将自动提交当前方案"
              : "🔮 讨论阶段可预填投资；进入投资阶段后可正式提交，倒计时结束也会自动提交"}
            {onBackToBuff && (
              <div style={{ marginTop: "0.75rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onBackToBuff}>
                  ← 返回道具使用
                </button>
              </div>
            )}
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
            {mode === "discussion" || isWaitingPhase ? "📊 讨论与预填" : "📊 投资决策"}
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: "1.25rem", marginBottom: "2rem" }}>
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

        {/* 提交区域 */}
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
                ? "⏳ 等待投资阶段..."
                : remainingEnergy < 0
                ? "⚠️ 精力超限"
                : "🔒 锁定并提交投资"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
