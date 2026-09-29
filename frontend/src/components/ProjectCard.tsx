import React, { useEffect, useState } from "react";
import { uiRem } from "../utils/typography";
import { LONG_CONTINUE_MIN_ENERGY } from "../config/longTermRules";
import { CatalogProjectType, SETTLEMENT_TIMING_SHORT } from "../config/projectCatalog";
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
  onOpenDetail?: (projectId: number, trigger?: HTMLElement) => void;
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
  onOpenDetail,
}) => {
  const tc = TYPE_COLORS[project.type] || TYPE_COLORS.short;
  const isEraMatch = eraTheme && project.era === eraTheme && project.type !== "risk";
  const myLongStatus = me.longTerm[project.id];
  const isAbandoned = myLongStatus?.status === "abandoned";
  const isLongCompleted = myLongStatus?.status === "completed";
  const isLongActive = myLongStatus?.status === "active";
  const isDisabled = disabled || isAbandoned || isLongCompleted;
  const progress = Math.min((project.accumulatedInvested / project.maxEnergy) * 100, 100);
  const myContrib = (myInvest / project.maxEnergy) * 100;
  const typeName = tc.label;
  const settlementHint =
    SETTLEMENT_TIMING_SHORT[project.type as CatalogProjectType] ?? SETTLEMENT_TIMING_SHORT.short;

  const [coverBroken, setCoverBroken] = useState(false);
  useEffect(() => {
    setCoverBroken(false);
  }, [project.id, uploadedVersion]);

  const display = getProjectImageDisplay(project.id, project.name, {}, uploadedVersion);
  const imageUrl =
    coverBroken && display.source === "custom"
      ? getProjectImageDisplay(project.id, project.name, {}, 0).src
      : display.src;

  const showRedLongHint =
    project.type === "long" && isLongActive && myInvest < LONG_CONTINUE_MIN_ENERGY && !isDisabled;
  const showYellowLongHint =
    project.type === "long" && !isLongActive && !isAbandoned && !isLongCompleted;
  const showLongHint = showRedLongHint || showYellowLongHint;
  const longHintUrgent = showRedLongHint;
  const reserveLongHint = balanceHeights || project.type === "long";

  const myCumulativeOnProject =
    project.type === "long" && isLongActive && myLongStatus
      ? myLongStatus.totalInvested
      : project.type !== "long"
        ? project.investorRecords?.[me.id] ?? 0
        : 0;
  const showMyCumulative = myCumulativeOnProject > 0;

  const openDetailFrom = (trigger: HTMLElement) => onOpenDetail?.(project.id, trigger);

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
      {onOpenDetail ? (
        <button
          type="button"
          className="project-card-detail-hit project-card-cover"
          aria-label={`查看${project.name}详情`}
          onClick={(e) => openDetailFrom(e.currentTarget)}
        >
          <img
            src={imageUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
        </button>
      ) : (
        <div className="project-card-cover" style={{ width: "100%", height: "160px", position: "relative", overflow: "hidden" }}>
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
      )}

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
          className={onOpenDetail ? "project-card-title-detail" : undefined}
          onClick={
            onOpenDetail
              ? (e) => {
                  e.stopPropagation();
                  openDetailFrom(e.currentTarget);
                }
              : undefined
          }
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

        <div
          style={{
            fontSize: uiRem(0.72),
            color: "var(--color-text-muted)",
            marginBottom: "0.5rem",
            lineHeight: 1.35,
          }}
        >
          <span style={{ color: tc.text, fontWeight: 600 }}>结算</span>
          <span style={{ margin: "0 0.35rem" }}>·</span>
          {settlementHint}
        </div>

        {reserveLongHint && (
          <div
            style={{
              fontSize: longHintUrgent ? uiRem(0.75) : uiRem(0.7),
              fontWeight: longHintUrgent ? 700 : 400,
              color: longHintUrgent ? "#fca5a5" : "#fbbf24",
              marginBottom: "0.5rem",
              padding: longHintUrgent ? "0.375rem 0.75rem" : "0.2rem 0.4rem",
              background: showLongHint
                ? longHintUrgent
                  ? "rgba(239,68,68,0.1)"
                  : "rgba(251,191,36,0.1)"
                : "transparent",
              border: showLongHint
                ? longHintUrgent
                  ? "1px solid rgba(239,68,68,0.35)"
                  : "1px solid rgba(251,191,36,0.3)"
                : "1px solid transparent",
              borderRadius: longHintUrgent ? "0.5rem" : "0.25rem",
              lineHeight: 1.45,
              // 侧栏拉开导致卡片变窄时完整换行显示，不截断
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              height: "auto",
              minHeight: showLongHint ? undefined : "2.65rem",
              visibility: showLongHint ? "visible" : "hidden",
              animation: longHintUrgent ? "pulse 1.5s infinite" : undefined,
            }}
            aria-hidden={!showLongHint}
          >
            {longHintUrgent
              ? `已参投，本轮需投入>=${LONG_CONTINUE_MIN_ENERGY}精力，否则将1：1结算该项目且不能再参投和分红`
              : `⚠️ 提示：长期项目参投后，必须每轮至少投入 ${LONG_CONTINUE_MIN_ENERGY} 精力，否则视为放弃`}
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
          {showMyCumulative && (
            <>
              <span>·</span>
              <span>
                我的累计{" "}
                <span style={{ color: "#fbbf24", fontWeight: 700, fontFamily: "var(--font-mono)" }}>
                  {myCumulativeOnProject}
                </span>
              </span>
            </>
          )}
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
            🚫 已放弃
          </div>
        )}

        {isLongCompleted && (
          <div
            style={{
              background: "rgba(16,185,129,0.12)",
              borderRadius: "0.5rem",
              padding: "0.5rem",
              textAlign: "center",
              fontSize: uiRem(0.8),
              color: "#6ee7b7",
              marginBottom: "0.75rem",
            }}
          >
            {project.accumulatedInvested > project.maxEnergy
              ? `超额完成（${project.accumulatedInvested}/${project.maxEnergy}）`
              : `恰好完成（${project.accumulatedInvested}/${project.maxEnergy}）`}
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
            className="project-card-invest-controls"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
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
