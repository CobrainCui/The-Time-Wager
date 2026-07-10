import React, { useMemo } from "react";
import { GameState, Player, SettlementProjectResult } from "../types";
import { socket } from "../socket";

interface Props {
  game: GameState;
  me: Player;
}

const TYPE_COLORS: Record<string, string> = {
  short: "#3b82f6", long: "#10b981", risk: "#ef4444",
};

const GlobalCard: React.FC<{ result: SettlementProjectResult }> = ({ result }) => {
  const pct = Math.min((result.totalInvested / result.maxEnergy) * 100, 100);
  const color = TYPE_COLORS[result.type] || "#60a5fa";
  let statusText = "进行中";
  let statusColor = color;
  if (result.isExploded) { statusText = "💥 爆雷"; statusColor = "#ef4444"; }
  else if (result.isCompleted) { statusText = "✅ 完成"; statusColor = "#34d399"; }
  else if (result.type === "long") { statusText = `${Math.round(pct)}%`; }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: `1px solid ${color}25`,
        borderRadius: "0.875rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, color: "white", fontSize: "0.95rem" }}>{result.name}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: statusColor }}>{statusText}</span>
      </div>
      <div style={{ width: "100%", height: "5px", background: "rgba(255,255,255,0.06)", borderRadius: "9999px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: result.isExploded ? "#ef4444" : `linear-gradient(90deg, ${color}, ${color}bb)`,
            borderRadius: "9999px",
            transition: "width 1s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
        <span>{result.isExploded ? "---" : result.totalInvested} / {result.maxEnergy}</span>
        <span style={{ color }}>{result.type === "short" ? "短期" : result.type === "long" ? "长期" : "风险"}</span>
      </div>
    </div>
  );
};

export const Settlement: React.FC<Props> = ({ game, me }) => {
  const snapshot = game.lastSettlement;

  const myRoundIncome = useMemo(() => {
    if (!snapshot) return 0;
    return snapshot.results.reduce((sum, res) => {
      const g = res.playerGains[me.id];
      return sum + (g ? g.total : 0);
    }, 0);
  }, [snapshot, me.id]);

  const leaderboard = useMemo(
    () => [...game.players].sort((a, b) => b.wealth - a.wealth),
    [game.players]
  );

  const myProjects =
    snapshot?.results.filter(
      (r) => (r.playerInvestments[me.id] || 0) > 0 || (r.playerGains[me.id]?.total ?? 0) !== 0
    ) || [];

  const isNextNewEra = game.roundInEra === 2;
  const energyMap: Record<number, number> = { 1: 15, 2: 13, 3: 11, 4: 9 };
  const nextEra = isNextNewEra ? game.currentEra + 1 : game.currentEra;
  const nextEnergy = energyMap[nextEra] ?? 0;

  if (!snapshot) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", color: "#fbbf24", fontSize: "1.25rem", animation: "pulse 1.5s infinite" }}>
          📊 正在生成结算报告...
        </div>
      </div>
    );
  }

  const rankBadge = (i: number) => {
    const colors = ["#f59e0b", "#94a3b8", "#cd7c32"];
    return { background: colors[i] || "#1f2937", color: i < 3 ? (i === 0 ? "#000" : "#fff") : "#6b7280" };
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "1.5rem 1rem 8rem" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>

        {/* 标题 */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.25em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.375rem" }}>
            Round {snapshot.round} · 结算报告
          </div>
          <h1 style={{ fontSize: "2.25rem", fontWeight: 900, color: "white" }}>本轮战报</h1>
        </div>

        {/* 三格指标 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
          <div
            style={{
              background: myRoundIncome >= 0 ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
              border: `1px solid ${myRoundIncome >= 0 ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
              borderRadius: "1rem",
              padding: "1.5rem",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
              本轮净收益
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "2.75rem",
                fontWeight: 900,
                color: myRoundIncome >= 0 ? "#34d399" : "#f87171",
                lineHeight: 1,
              }}
            >
              {myRoundIncome > 0 ? "+" : ""}{myRoundIncome}
            </div>
          </div>
          <div
            style={{
              background: "rgba(251,191,36,0.06)",
              border: "1px solid rgba(251,191,36,0.2)",
              borderRadius: "1rem",
              padding: "1.5rem",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
              当前总财富
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "2.75rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
              {me.wealth}
            </div>
          </div>
          <div
            style={{
              background: "rgba(59,130,246,0.06)",
              border: "1px solid rgba(59,130,246,0.2)",
              borderRadius: "1rem",
              padding: "1.5rem",
            }}
          >
            <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
              🚀 下一轮预告
            </div>
            <div style={{ fontSize: "0.9rem", color: "var(--color-text-secondary)", lineHeight: 1.7 }}>
              <div>阶段：{isNextNewEra ? <span style={{ color: "#c084fc", fontWeight: 700 }}>拍卖 & 新时代</span> : "讨论轮"}</div>
              <div>精力重置：<span style={{ color: "white", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{nextEnergy}</span></div>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1.5rem" }}>
          {/* 左侧 */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* 个人投资结算单 */}
            <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "1rem", overflow: "hidden" }}>
              <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ fontWeight: 700, color: "white", fontSize: "1rem" }}>🧾 个人投资结算单</h3>
              </div>
              {myProjects.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)", color: "var(--color-text-muted)" }}>
                        {["项目名称", "投入", "基础+排名+时代", "总回报"].map((h, i) => (
                          <th key={i} style={{ padding: "0.75rem 1rem", fontWeight: 700, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: i > 0 ? "center" : "left", whiteSpace: "nowrap" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {myProjects.map((res) => {
                        const myInvest = res.playerInvestments[me.id] || 0;
                        const gains = res.playerGains[me.id] || { total: 0, base: 0, rank: 0, era: 0 };
                        let statusSuffix = "";
                        let rowColor = "var(--color-text-secondary)";
                        if (res.isExploded) { statusSuffix = " 💥"; rowColor = "#f87171"; }
                        else if (res.type === "long" && res.isCompleted) statusSuffix = " ✅";
                        else if (res.type === "long" && gains.total > 0) statusSuffix = " 🚫退";
                        else if (res.type === "long") statusSuffix = " ⏳";
                        return (
                          <tr key={res.projectId} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                            <td style={{ padding: "0.875rem 1rem", color: "white", fontWeight: 600 }}>
                              {res.name}
                              <span style={{ marginLeft: "0.375rem", fontSize: "0.7rem", color: "var(--color-text-muted)" }}>{statusSuffix}</span>
                            </td>
                            <td style={{ padding: "0.875rem 1rem", textAlign: "center", fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
                              {myInvest}
                            </td>
                            <td style={{ padding: "0.875rem 1rem", textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: rowColor }}>
                              {gains.base}+{gains.rank}+{gains.era}
                            </td>
                            <td
                              style={{
                                padding: "0.875rem 1rem",
                                textAlign: "center",
                                fontFamily: "var(--font-mono)",
                                fontWeight: 800,
                                fontSize: "1rem",
                                color: gains.total > 0 ? "#fbbf24" : gains.total < 0 ? "#f87171" : "var(--color-text-muted)",
                              }}
                            >
                              {gains.total > 0 ? "+" : ""}{gains.total}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "2.5rem", textAlign: "center", color: "var(--color-text-muted)" }}>
                  本轮未进行有效投资
                </div>
              )}
            </div>

            {/* 项目全览 */}
            <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "1rem", padding: "1.25rem" }}>
              <h3 style={{ fontWeight: 700, color: "white", marginBottom: "1rem", fontSize: "1rem" }}>🌍 本轮项目全览</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.875rem" }}>
                {snapshot.results.map((r) => <GlobalCard key={r.projectId} result={r} />)}
              </div>
            </div>
          </div>

          {/* 右侧：排行榜 */}
          <div>
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: "1rem",
                overflow: "hidden",
                position: "sticky",
                top: "5rem",
              }}
            >
              <div style={{ background: "rgba(245,158,11,0.06)", padding: "1rem", borderBottom: "1px solid rgba(245,158,11,0.15)", textAlign: "center" }}>
                <h3 style={{ fontWeight: 700, color: "#fbbf24", fontSize: "1rem" }}>🏆 财富排行</h3>
              </div>
              <div style={{ padding: "0.75rem" }}>
                {leaderboard.map((p, idx) => {
                  const isMe = p.id === me.id;
                  const badge = rankBadge(idx);
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.625rem",
                        padding: "0.625rem 0.5rem",
                        borderRadius: "0.5rem",
                        background: isMe ? "rgba(245,158,11,0.08)" : "transparent",
                        border: isMe ? "1px solid rgba(245,158,11,0.2)" : "1px solid transparent",
                        marginBottom: "0.375rem",
                      }}
                    >
                      <span
                        style={{
                          width: "1.5rem",
                          height: "1.5rem",
                          borderRadius: "50%",
                          background: badge.background,
                          color: badge.color,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "0.65rem",
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {idx + 1}
                      </span>
                      <span style={{ flex: 1, fontWeight: isMe ? 700 : 400, color: isMe ? "#fbbf24" : "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}>
                        {p.name}
                      </span>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: isMe ? "#fbbf24" : "var(--color-text-secondary)", fontSize: "0.95rem" }}>
                        {isMe ? p.wealth : "???"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 确认按钮 */}
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
        <button
          onClick={() => socket.emit("playerReady")}
          className="btn btn-primary btn-lg"
          style={{ padding: "0.875rem 3.5rem", fontSize: "1.05rem" }}
        >
          {me.ready ? "✅ 已确认，等待其他人..." : "确认战绩，继续 →"}
        </button>
      </div>
    </div>
  );
};
