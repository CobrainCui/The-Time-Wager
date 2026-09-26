import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { ActiveProject, Player } from "../types";
import { getProjectImageDisplay } from "../utils/gameImageDisplay";

export const TYPE_COLORS: Record<string, { border: string; text: string; bg: string; label: string }> = {
  short: { border: "#3b82f6", text: "#93c5fd", bg: "rgba(59,130,246,0.08)", label: "短期" },
  long: { border: "#10b981", text: "#6ee7b7", bg: "rgba(16,185,129,0.08)", label: "长期" },
  risk: { border: "#ef4444", text: "#fca5a5", bg: "rgba(239,68,68,0.08)", label: "风险" },
};

export const ProjectCard: React.FC<{
  project: ActiveProject;
  myInvest: number;
  onChange: (id: number, val: number) => void;
  disabled: boolean;
  remainingEnergy: number;
  eraTheme?: string;
  me: Player;
  uploadedVersion?: number;
  /** 并排展示时预留长期提示/参投警告位，使卡片等高 */
  balanceHeights?: boolean;
}> = ({
  project,
  myInvest,
  onChange,
  disabled,
  remainingEnergy,
  eraTheme,
  me,
  uploadedVersion,
  balanceHeights = false,
}) => {
  const tc = TYPE_COLORS[project.type] || TYPE_COLORS.short;
  const isEraMatch = eraTheme && project.era === eraTheme && project.type !== "risk";
  const myLongStatus = me.longTerm[project.id];
  const isAbandoned = myLongStatus?.status === "abandoned";
  const isAtRisk = project.type === "long" && myLongStatus?.status === "active" && myInvest < 3;
  const isDisabled = disabled || isAbandoned;
  const progress = Math.min((project.accumulatedInvested / project.maxEnergy) * 100, 100);
  const myContrib = (myInvest / project.maxEnergy) * 100;
  const typeName = tc.label;

  const [coverBroken, setCoverBroken] = useState(false);
  useEffect(() => {
    setCoverBroken(false);
  }, [project.id, uploadedVersion]);

  const display = getProjectImageDisplay(project.id, project.name, {}, uploadedVersion);
  const imageUrl =
    coverBroken && display.source === "custom"
      ? getProjectImageDisplay(project.id, project.name, {}, 0).src
      : display.src;

  const showLongHint = project.type === "long";
  const showAtRiskBanner = isAtRisk && !isDisabled;
  const reserveLongHint = balanceHeights || showLongHint;
  const reserveAtRisk = balanceHeights || showAtRiskBanner;

  return (
    <div
      className="project-card"
      style={{
        background: "var(--color-bg-card)",
        border: `1px solid ${isEraMatch ? "rgba(245,158,11,0.45)" : tc.border + "44"}`,
        borderRadius: "1.25rem",
        overflow: "hidden",
        transition: "all 0.25s ease",
        opacity: isAbandoned ? 0.6 : 1,
        boxShadow: isEraMatch ? "0 0 20px rgba(245,158,11,0.15)" : `0 4px 20px rgba(0,0,0,0.3)`,
        position: "relative",
        height: balanceHeights ? "100%" : undefined,
        display: balanceHeights ? "flex" : undefined,
        flexDirection: balanceHeights ? "column" : undefined,
      }}
      onMouseEnter={(e) => {
        if (!isAbandoned) (e.currentTarget as HTMLDivElement).style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
      }}
    >
      <div
        className="project-card-cover"
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
          onError={() => setCoverBroken(true)}
        />
        {isEraMatch && (
          <div
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              background: "rgba(245,158,11,0.85)",
              borderRadius: "9999px",
              padding: "0.2rem 0.6rem",
              fontSize: uiRem(0.7),
              fontWeight: 700,
              color: "#1a1000",
              boxShadow: "0 2px 8px rgba(245,158,11,0.4)",
            }}
            className="animate-pulse"
          >
            🔥 时代UP
          </div>
        )}
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
            fontSize: uiRem(0.65),
            fontWeight: 700,
            color: tc.text,
            letterSpacing: "0.05em",
          }}
        >
          {typeName}
        </div>
      </div>

      <div
        className="project-card-body"
        style={{
          padding: "1rem",
          flex: balanceHeights ? 1 : undefined,
          display: balanceHeights ? "flex" : undefined,
          flexDirection: balanceHeights ? "column" : undefined,
        }}
      >
        <h3
          style={{
            fontWeight: 800,
            fontSize: uiRem(1.05),
            color: "white",
            marginBottom: "0.5rem",
            lineHeight: 1.3,
          }}
        >
          {project.name}
        </h3>

        {reserveLongHint && (
          <div
            style={{
              fontSize: uiRem(0.7),
              color: "#fbbf24",
              marginBottom: "0.5rem",
              padding: "0.2rem 0.4rem",
              background: showLongHint ? "rgba(251,191,36,0.1)" : "transparent",
              border: showLongHint ? "1px solid rgba(251,191,36,0.3)" : "1px solid transparent",
              borderRadius: "0.25rem",
              lineHeight: 1.2,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              minHeight: "2.65rem",
              visibility: showLongHint ? "visible" : "hidden",
            }}
            aria-hidden={!showLongHint}
          >
            ⚠️ 提示：长期项目参投后，必须每轮至少投入3精力，不然视为“放弃”
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            fontSize: uiRem(0.8),
            color: "var(--color-text-muted)",
            marginBottom: "0.75rem",
          }}
        >
          <span>
            上限{" "}
            <span style={{ color: "white", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{project.maxEnergy}</span>
          </span>
          <span>·</span>
          <span>
            已有{" "}
            <span style={{ color: tc.text, fontWeight: 700, fontFamily: "var(--font-mono)" }}>
              {project.accumulatedInvested}
            </span>
          </span>
        </div>

        {isAbandoned && (
          <div
            style={{
              background: "rgba(100,100,100,0.15)",
              borderRadius: "0.5rem",
              padding: "0.5rem",
              textAlign: "center",
              fontSize: uiRem(0.8),
              color: "var(--color-text-muted)",
              marginBottom: "0.75rem",
            }}
          >
            🚫 已退出
          </div>
        )}

        {reserveAtRisk && (
          <div
            style={{
              background: showAtRiskBanner ? "rgba(239,68,68,0.1)" : "transparent",
              border: showAtRiskBanner ? "1px solid rgba(239,68,68,0.3)" : "1px solid transparent",
              borderRadius: "0.5rem",
              padding: "0.375rem 0.75rem",
              fontSize: uiRem(0.75),
              color: "#fca5a5",
              fontWeight: 700,
              marginBottom: "0.75rem",
              minHeight: "2.1rem",
              display: "flex",
              alignItems: "center",
              animation: showAtRiskBanner ? "pulse 1.5s infinite" : undefined,
              visibility: showAtRiskBanner ? "visible" : "hidden",
            }}
            aria-hidden={!showAtRiskBanner}
          >
            ⚠️ 已参投，须 ≥3 精力否则判放弃
          </div>
        )}

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

        {!isAbandoned && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginTop: balanceHeights ? "auto" : undefined,
            }}
          >
            <input
              type="range"
              min={0}
              max={myInvest + remainingEnergy}
              value={myInvest}
              disabled={isDisabled}
              onChange={(e) => {
                let val = parseInt(e.target.value) || 0;
                if (project.type === "long" && myLongStatus?.status === "active") {
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
                const raw = parseInt(e.target.value, 10);
                const max = myInvest + remainingEnergy;
                const val = Math.min(Math.max(0, Number.isFinite(raw) ? raw : 0), max);
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
                fontSize: uiRem(1),
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
