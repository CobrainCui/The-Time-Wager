import React, { useState } from "react";
import { GameState, Player } from "../types";
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale
} from "chart.js";
import { Radar, Line } from "react-chartjs-2";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend, CategoryScale, LinearScale);

interface Props { game: GameState; me?: Player; }

const PERSONA_COLORS: Record<string, string> = {
  "罗盘精算师": "#3b82f6", "时荫植者": "#10b981", "涌机触发者": "#f97316", "瞬刻炼金士": "#a855f7", "桥梁架构师": "#ec4899",
};

export const GameOver: React.FC<Props> = ({ game, me }) => {
  const [showDetails, setShowDetails] = useState(false);
  const sortedPlayers = [...game.players].sort((a, b) => b.wealth - a.wealth);
  const totalWealth = game.players.reduce((s, p) => s + p.wealth, 0);
  const myResult = me?.analysisResult;
  const personaColor = myResult ? (PERSONA_COLORS[myResult.primaryPersona] || "#60a5fa") : "#60a5fa";

  const radarData = {
    labels: ["长期主义", "风险倾向", "规则干预", "社交连接", "资源转化"],
    datasets: [{
      label: "决策五维",
      data: myResult
        ? [myResult.scores.longTermism, myResult.scores.riskTaking, myResult.scores.ruleIntervention, myResult.scores.socialConnection, myResult.scores.resourceConversion]
        : [0, 0, 0, 0, 0],
      backgroundColor: `${personaColor}30`,
      borderColor: personaColor,
      borderWidth: 3,
      pointBackgroundColor: personaColor,
      pointRadius: 5,
    }],
  };

  const lineData = {
    labels: me?.wealthHistory.map((_, i) => `R${i}`) || [],
    datasets: [{
      label: "财富曲线",
      data: me?.wealthHistory || [],
      borderColor: "#60a5fa",
      backgroundColor: "rgba(96,165,250,0.1)",
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.4,
      fill: true,
    }],
  };

  const rankBadge = (i: number) => {
    if (i === 0) return { bg: "#f59e0b", color: "#000", text: "🥇" };
    if (i === 1) return { bg: "#94a3b8", color: "#000", text: "🥈" };
    if (i === 2) return { bg: "#cd7c32", color: "#fff", text: "🥉" };
    return { bg: "#1f2937", color: "#6b7280", text: `${i + 1}` };
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "2rem 1rem", overflowY: "auto" }}>
      {/* 背景粒子 */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 30% 20%, rgba(245,158,11,0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(168,85,247,0.06) 0%, transparent 50%)" }} />

      <div style={{ maxWidth: "800px", margin: "0 auto", position: "relative" }}>
        {/* 标题 */}
        <div style={{ textAlign: "center", marginBottom: "3rem" }} className="animate-slideDown">
          <h1
            style={{
              fontSize: "4.5rem",
              fontWeight: 900,
              background: "linear-gradient(135deg, #f59e0b, #ef4444, #a855f7)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              lineHeight: 1,
              marginBottom: "0.75rem",
              letterSpacing: "-0.03em",
            }}
          >
            GAME OVER
          </h1>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "white" }}>
            社区：{game.communityName || "未命名"}
          </h2>
        </div>

        {/* 社区总财富 */}
        <div
          style={{
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.25)",
            borderRadius: "1.25rem",
            padding: "2rem",
            textAlign: "center",
            marginBottom: "2rem",
            boxShadow: "0 0 40px rgba(245,158,11,0.1)",
          }}
        >
          <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
            本社区总财富
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "4rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
            {totalWealth}
          </div>
        </div>

        {/* 全球排行榜 */}
        {game.globalLeaderboard && game.globalLeaderboard.length > 0 && (
          <div
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid rgba(168,85,247,0.25)",
              borderRadius: "1.25rem",
              overflow: "hidden",
              marginBottom: "2rem",
            }}
          >
            <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid rgba(168,85,247,0.15)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h3 style={{ fontWeight: 700, color: "#c084fc", fontSize: "1rem" }}>🌍 社区排行榜</h3>
            </div>
            <div style={{ padding: "0.75rem 1rem" }}>
              {game.globalLeaderboard.map((rec, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.75rem 0.5rem",
                    borderRadius: "0.625rem",
                    background: rec.name === game.communityName ? "rgba(168,85,247,0.08)" : "transparent",
                    border: rec.name === game.communityName ? "1px solid rgba(168,85,247,0.25)" : "1px solid transparent",
                    marginBottom: "0.375rem",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span
                      style={{
                        width: "1.5rem",
                        height: "1.5rem",
                        borderRadius: "50%",
                        background: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7c32" : "#1f2937",
                        color: i < 3 ? (i === 0 ? "#000" : "#fff") : "#6b7280",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.65rem",
                        fontWeight: 800,
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ color: "var(--color-text-primary)", fontWeight: rec.name === game.communityName ? 700 : 400, fontSize: "0.9rem" }}>
                      {rec.name === game.communityName ? "▶ " : ""}【{rec.name}】
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "#fbbf24", fontSize: "0.95rem" }}>
                    {rec.score}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 个人排行榜 */}
        <div
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "1.25rem",
            overflow: "hidden",
            marginBottom: "2rem",
          }}
        >
          <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ fontWeight: 700, color: "white", fontSize: "1rem" }}>🏆 个人排行榜</h3>
          </div>
          {sortedPlayers.map((p, i) => {
            const badge = rankBadge(i);
            const isMe = p.id === me?.id;
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "1rem 1.5rem",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: isMe ? "rgba(245,158,11,0.04)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ width: "2rem", height: "2rem", borderRadius: "50%", background: badge.bg, color: badge.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.85rem", fontWeight: 800, flexShrink: 0 }}>
                    {badge.text}
                  </span>
                  <span style={{ fontWeight: isMe ? 700 : 500, fontSize: "1rem", color: isMe ? "#fbbf24" : "white" }}>
                    {p.name}
                  </span>
                  {p.analysisResult && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        padding: "0.2rem 0.6rem",
                        borderRadius: "9999px",
                        background: `${PERSONA_COLORS[p.analysisResult.primaryPersona] || "#3b82f6"}20`,
                        color: PERSONA_COLORS[p.analysisResult.primaryPersona] || "#60a5fa",
                        border: `1px solid ${PERSONA_COLORS[p.analysisResult.primaryPersona] || "#3b82f6"}40`,
                      }}
                    >
                      {p.analysisResult.primaryPersona}
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "1.25rem", color: isMe ? "#fbbf24" : "var(--color-text-secondary)" }}>
                  {p.wealth}
                </span>
              </div>
            );
          })}
        </div>

        {/* 我的分析图表 */}
        {me && myResult && (
          <div
            style={{
              background: "var(--color-bg-card)",
              border: `1px solid ${personaColor}33`,
              borderRadius: "1.25rem",
              padding: "1.5rem",
              marginBottom: "2rem",
              boxShadow: `0 0 30px ${personaColor}12`,
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.375rem" }}>
                你的决策人格
              </div>
              <div style={{ fontSize: "1.75rem", fontWeight: 900, color: personaColor }}>
                {myResult.primaryPersona}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
              <div style={{ height: "220px" }}>
                <Radar
                  data={radarData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      r: {
                        min: 0, max: 100,
                        ticks: { display: false },
                        pointLabels: { font: { size: 11 }, color: "#94a3b8" },
                        grid: { color: "rgba(255,255,255,0.06)" },
                        angleLines: { color: "rgba(255,255,255,0.06)" },
                      },
                    },
                  }}
                />
              </div>
              <div style={{ height: "220px" }}>
                <Line
                  data={lineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { color: "#6b7280", font: { size: 10 } }, grid: { display: false } },
                      y: { ticks: { color: "#6b7280", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
          <button onClick={() => setShowDetails(true)} className="btn btn-ghost">
            📊 查看评分细则
          </button>
        </div>
      </div>

      {/* 评分细则 Modal */}
      {showDetails && myResult && (
        <div className="modal-overlay" onClick={() => setShowDetails(false)}>
          <div className="modal-box" style={{ maxWidth: "600px", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontWeight: 700, color: "white", fontSize: "1.1rem" }}>🧐 人格判定数据</h3>
              <button onClick={() => setShowDetails(false)} style={{ background: "none", border: "none", color: "var(--color-text-muted)", fontSize: "1.25rem", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ background: `${personaColor}15`, border: `1px solid ${personaColor}33`, borderRadius: "0.875rem", padding: "1rem", marginBottom: "1rem", textAlign: "center" }}>
              <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem", marginBottom: "0.25rem" }}>你的判定结果</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: personaColor }}>{myResult.primaryPersona}</div>
            </div>
            {[
              { label: "🌱 长期主义", value: myResult.scores.longTermism, desc: "55% 长期项目投入比 + 35% 延迟满足 + 10% 精神老伙卡" },
              { label: "🎲 风险倾向", value: myResult.scores.riskTaking, desc: "60% 风险项目投入比 + 20% 彩票 + 20% 做空" },
              { label: "🛠️ 规则干预", value: myResult.scores.ruleIntervention, desc: "每使用一张道具卡 +12.5 分" },
              { label: "💰 资源转化", value: myResult.scores.resourceConversion, desc: "超额回报加权 / 总精力" },
              { label: "🤝 社交连接", value: myResult.scores.socialConnection, desc: "上帝评分 A=100, B=80, C=60, D=40, E=20" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", background: "rgba(255,255,255,0.02)", borderRadius: "0.625rem", border: "1px solid var(--color-border)", marginBottom: "0.5rem" }}>
                <div>
                  <div style={{ fontWeight: 600, color: "var(--color-text-primary)", fontSize: "0.875rem" }}>{item.label}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>{item.desc}</div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, color: "#fbbf24", fontSize: "1.1rem", marginLeft: "1rem" }}>
                  {item.value.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 隐藏 PDF 绘图区 */}
      <div id="pdf-charts-hidden-container" style={{ position: "fixed", left: "-9999px", top: 0, width: "1100px", height: "1500px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "transparent", padding: "40px", gap: "200px" }}>
        <div style={{ width: "900px", height: "600px" }}>
          <Radar data={radarData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false }, pointLabels: { font: { size: 32 }, color: "black" }, grid: { color: "rgba(0,0,0,0.3)", lineWidth: 2 } } } } as any} />
        </div>
        <div style={{ width: "1000px", height: "800px" }}>
          <Line data={lineData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: "black", font: { size: 24 } }, grid: { display: false } }, y: { ticks: { color: "black", font: { size: 24 } }, grid: { color: "rgba(0,0,0,0.1)" } } } } as any} />
        </div>
      </div>
    </div>
  );
};
