import React, { useState, useEffect, useRef } from "react";
import { GameState, Player, ActiveProject } from "../types";
import { socket } from "../socket";

interface Props {
  game: GameState;
  me: Player;
  mode: "discussion" | "investment";
  projectImages?: Record<number, number>;
}

const ERA_COLORS: Record<string, string> = {
  green: "#10b981", blue: "#3b82f6", red: "#ef4444", orange: "#f97316", yellow: "#a855f7",
};

const TYPE_COLORS: Record<string, { border: string; text: string; bg: string; label: string }> = {
  short: { border: "#3b82f6", text: "#93c5fd", bg: "rgba(59,130,246,0.08)", label: "短期" },
  long:  { border: "#10b981", text: "#6ee7b7", bg: "rgba(16,185,129,0.08)", label: "长期" },
  risk:  { border: "#ef4444", text: "#fca5a5", bg: "rgba(239,68,68,0.08)",  label: "风险" },
};

// ——— 顶部状态栏 ———
const StatusBar: React.FC<{
  me: Player;
  remainingEnergy: number;
  investmentEndsAt?: number;
  buffPhaseEndsAt?: number;
  onCoffee: () => void;
  coffeeLoading: boolean;
}> = ({ me, remainingEnergy, investmentEndsAt, buffPhaseEndsAt, onCoffee, coffeeLoading }) => {
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
            <span style={{ fontSize: "1.1rem" }}>⚡</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: "1.2rem",
                color: remainingEnergy < 0 ? "#ef4444" : "#34d399",
              }}
            >
              {remainingEnergy}
            </span>
            <span style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>/ {me.energy}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.1rem" }}>💰</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "1.2rem", color: "#fbbf24" }}>
              {me.wealth}
            </span>
          </div>
          {me.draftOrder && (
            <div style={{ color: "#c084fc", fontSize: "0.85rem", fontWeight: 600 }}>
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
            disabled={coffeeLoading || me.wealth < 15}
            className="btn btn-sm"
            style={{
              background: "rgba(180,83,9,0.2)",
              border: "1px solid rgba(180,83,9,0.4)",
              color: me.wealth >= 15 ? "#fcd34d" : "var(--color-text-muted)",
            }}
            title="消耗15财富换1精力"
          >
            ☕ {coffeeLoading ? "..." : "咖啡 -15💰"}
          </button>
        </div>
      </div>
    </div>
  );
};

import { BACKEND_URL } from "../socket";

// ——— 项目卡片（含图片上传槽）———
const ProjectCard: React.FC<{
  project: ActiveProject;
  myInvest: number;
  onChange: (id: number, val: number) => void;
  disabled: boolean;
  remainingEnergy: number;
  eraTheme?: string;
  me: Player;
  uploadedVersion?: number;
}> = ({ project, myInvest, onChange, disabled, remainingEnergy, eraTheme, me, uploadedVersion }) => {
  const tc = TYPE_COLORS[project.type] || TYPE_COLORS.short;
  const isEraMatch = eraTheme && project.era === eraTheme && project.type !== "risk";
  const myLongStatus = me.longTerm[project.id];
  const isAbandoned = myLongStatus?.status === "abandoned";
  const isAtRisk = project.type === "long" && myLongStatus?.status === "active" && myInvest < 3;
  const isDisabled = disabled || isAbandoned;
  const progress = Math.min((project.accumulatedInvested / project.maxEnergy) * 100, 100);
  const myContrib = ((myInvest / project.maxEnergy) * 100);
  const typeName = tc.label;

  const imageUrl = uploadedVersion
    ? `${BACKEND_URL}/uploads/${project.id}.jpg?v=${uploadedVersion}`
    : `/images/projects/${project.name}.jpg?v=final2`;


  return (
    <div
      style={{
        background: "var(--color-bg-card)",
        border: `1px solid ${isEraMatch ? "rgba(245,158,11,0.45)" : tc.border + "44"}`,
        borderRadius: "1.25rem",
        overflow: "hidden",
        transition: "all 0.25s ease",
        opacity: isAbandoned ? 0.6 : 1,
        boxShadow: isEraMatch
          ? "0 0 20px rgba(245,158,11,0.15)"
          : `0 4px 20px rgba(0,0,0,0.3)`,
        position: "relative",
      }}
      onMouseEnter={(e) => {
        if (!isAbandoned) (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      {/* 图片区域 160px */}
      <div
        style={{
          width: "100%",
          height: "160px",
          position: "relative",
          overflow: "hidden",
          background: "transparent",
        }}
      >
        <img
          src={imageUrl}
          alt={project.name}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        {/* (移除悬停遮罩与 input) */}
        {/* 时代契合角标 */}
        {isEraMatch && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              background: "rgba(245,158,11,0.85)",
              borderRadius: "9999px",
              padding: "0.2rem 0.6rem",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: "#1a1000",
              boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
            }}
            className="animate-pulse"
          >
            🔥 时代UP
          </div>
        )}
        {/* 类型标签 */}
        <div
          style={{
            position: "absolute",
            top: "0.5rem",
            left: "0.5rem",
            background: tc.bg.replace("0.08", "0.85"),
            backdropFilter: "blur(4px)",
            border: `1px solid ${tc.border}66`,
            borderRadius: "9999px",
            padding: "0.2rem 0.6rem",
            fontSize: "0.65rem",
            fontWeight: 700,
            color: tc.text,
            letterSpacing: "0.05em",
          }}
        >
          {typeName}
        </div>
      </div>

      {/* 卡片内容 */}
      <div style={{ padding: "1rem" }}>
        <h3
          style={{
            fontWeight: 800,
            fontSize: "1.05rem",
            color: "white",
            marginBottom: "0.5rem",
            lineHeight: 1.3,
          }}
        >
          {project.name}
        </h3>

        {project.type === "long" && (
          <div style={{
            fontSize: "0.7rem",
            color: "#fbbf24",
            marginBottom: "0.5rem",
            padding: "0.2rem 0.4rem",
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.3)",
            borderRadius: "0.25rem",
            lineHeight: 1.2
          }}>
            ⚠️ 提示：长期项目参投后，必须每轮至少投入3格精力，不然视为“放弃”
          </div>
        )}

        {/* 投入信息 */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            fontSize: "0.8rem",
            color: "var(--color-text-muted)",
            marginBottom: "0.75rem",
          }}
        >
          <span>上限 <span style={{ color: "white", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{project.maxEnergy}</span></span>
          <span>·</span>
          <span>已有 <span style={{ color: tc.text, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{project.accumulatedInvested}</span></span>
        </div>

        {/* 放弃提示 */}
        {isAbandoned && (
          <div
            style={{
              background: "rgba(100,100,100,0.15)",
              borderRadius: "0.5rem",
              padding: "0.5rem",
              textAlign: "center",
              fontSize: "0.8rem",
              color: "var(--color-text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            🚫 已退出
          </div>
        )}

        {/* 风险提示 */}
        {isAtRisk && !isDisabled && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "0.5rem",
              padding: "0.375rem 0.75rem",
              fontSize: "0.75rem",
              color: "#fca5a5",
              fontWeight: 700,
              marginBottom: "0.75rem",
              animation: "pulse 1.5s infinite",
            }}
          >
            ⚠️ 已参投，须 ≥3 精力否则判放弃
          </div>
        )}

        {/* 进度条 */}
        <div
          style={{
            width: "100%",
            height: "6px",
            background: "rgba(255,255,255,0.06)",
            borderRadius: "9999px",
            marginBottom: "0.875rem",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${tc.border}, ${tc.text})`,
              borderRadius: "9999px",
              transition: "width 0.5s ease",
            }}
          />
          {!isDisabled && myInvest > 0 && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: `${progress}%`,
                height: "100%",
                width: `${Math.min(myContrib, 100 - progress)}%`,
                background: "rgba(255,255,255,0.35)",
                borderRadius: "9999px",
              }}
            />
          )}
        </div>

        {/* 投入控制 */}
        {!isAbandoned && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="range"
              min={0}
              max={myInvest + remainingEnergy}
              value={myInvest}
              disabled={isDisabled}
              onChange={(e) => {
                let val = parseInt(e.target.value) || 0;
                if (project.type === 'long' && myLongStatus?.status === 'active') {
                  if (val === 1 || val === 2) {
                    val = val > myInvest ? 3 : 0;
                  }
                }
                onChange(project.id, val);
              }}
              style={{
                flex: 1,
                height: "6px",
                accentColor: tc.border,
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.4 : 1,
              }}
            />
            <input
              type="number"
              min={0}
              max={myInvest + remainingEnergy}
              value={myInvest}
              disabled={isDisabled}
              onChange={(e) => {
                let val = parseInt(e.target.value) || 0;
                // Don't snap on number input so user can type, handleSubmit will validate
                onChange(project.id, val);
              }}
              style={{
                width: "3.5rem",
                background: "rgba(0,0,0,0.3)",
                border: `1px solid ${myInvest > 0 ? tc.border + "88" : "var(--color-border)"}`,
                borderRadius: "0.5rem",
                padding: "0.375rem",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: "1rem",
                fontWeight: 700,
                color: myInvest > 0 ? tc.text : "var(--color-text-muted)",
                outline: "none",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ——— 主组件 ———
export const Investment: React.FC<Props> = ({ game, me, mode, projectImages = {} }) => {
  const [investments, setInvestments] = useState<Record<number, number>>({});
  const [coffeeLoading, setCoffeeLoading] = useState(false);

  const currentAllocated = Object.values(investments).reduce((a, b) => a + b, 0);
  const remainingEnergy = me.energy - currentAllocated;

  const handleInputChange = (projectId: number, val: number) => {
    if (val < 0) return;
    setInvestments((prev) => ({ ...prev, [projectId]: val }));
  };

  const handleSubmit = () => {
    if (remainingEnergy < 0) { alert("精力分配超限！"); return; }

    const abandonWarnings: string[] = [];
    for (const proj of game.activeProjects) {
      if (proj.type === 'long') {
        const myLongStatus = me.longTerm[proj.id];
        if (myLongStatus?.status === 'active') {
           const val = investments[proj.id] || 0;
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

    socket.emit("submitInvestment", { investment: investments });
  };

  const handleCoffee = () => {
    if (coffeeLoading || me.wealth < 15) return;
    setCoffeeLoading(true);
    socket.emit("performCoffee");
    setTimeout(() => setCoffeeLoading(false), 1200);
  };

  const eraCard = game.currentEraCard;
  const eraColor = eraCard ? (ERA_COLORS[eraCard.themeColor] || "#60a5fa") : "#60a5fa";
  const isWaitingPhase = game.phase === "BUFF_USAGE";
  const isSubmitted = me.ready && !isWaitingPhase;

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
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: "1.5rem",
              animation: "pulse 2s infinite",
            }}
          >
            🔮 已完成道具使用，提前预览投资盘面
          </div>
        )}

        {/* 时代卡横幅 */}
        {eraCard && (
          <div
            style={{
              background: `linear-gradient(135deg, ${eraColor}18 0%, transparent 100%)`,
              border: `1px solid ${eraColor}33`,
              borderRadius: "1rem",
              padding: "1.25rem 1.75rem",
              marginBottom: "2rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                right: "-1rem",
                top: "-1rem",
                fontSize: "6rem",
                fontWeight: 900,
                opacity: 0.05,
                color: eraColor,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {eraCard.era}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "white" }}>
                  🌍 {eraCard.name}
                </h2>
                <span style={{ color: "var(--color-text-secondary)", fontSize: "1rem" }}>
                  — {eraCard.description}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: eraColor,
                  opacity: 0.8,
                  marginTop: "0.25rem",
                }}
              >
                Era {game.currentEra} · 当前时代主题
              </div>
            </div>
          </div>
        )}

        {/* 标题 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white" }}>
            📊 投资决策
          </h2>
          {remainingEnergy !== 0 && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.875rem",
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
                fontSize: "1.1rem",
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
              <span style={{ fontWeight: 700, color: "#34d399", fontSize: "1rem" }}>
                已提交，等待其他玩家...
              </span>
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={isWaitingPhase || remainingEnergy < 0}
              className="btn btn-success btn-lg"
              style={{
                padding: "1rem 4rem",
                fontSize: "1.15rem",
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
