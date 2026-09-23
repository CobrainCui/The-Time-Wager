import React, { useState } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { FATE_SKETCH_PERSONA_COLORS } from "../config/personaConfig";
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement,
  Filler, Tooltip, Legend, CategoryScale, LinearScale, Title
} from "chart.js";
import { Radar, Line } from "react-chartjs-2";
import { generateCollectionManual } from "../utils/pdfGenerator";
import { buildPdfUnfinishedProjects, PDF_LINE_CHART_ID, PDF_RADAR_CHART_ID } from "../utils/gameOverPdf";
import { CommunityLeaderboard } from "../components/CommunityLeaderboard";
import { PDF_LINE_CAPTURE, PDF_RADAR_CAPTURE } from "../utils/pdfLayout";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend, CategoryScale, LinearScale, Title);

interface Props { game: GameState; me?: Player; }

const pdfChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: { legend: { display: false } },
  scales: {
    r: {
      min: 0,
      max: 100,
      ticks: { display: false },
      pointLabels: { font: { size: 32 }, color: "black" },
      grid: { color: "rgba(0,0,0,0.3)", lineWidth: 2 },
      angleLines: { color: "rgba(0,0,0,0.25)" },
    },
  },
};

const pdfLineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  plugins: { legend: { display: false } },
  scales: {
    x: {
      ticks: { color: "#374151", font: { size: 22 } },
      grid: { display: false },
    },
    y: {
      ticks: { color: "#374151", font: { size: 22 } },
      grid: { color: "rgba(0,0,0,0.12)" },
    },
  },
};

export const GameOver: React.FC<Props> = ({ game, me }) => {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const sortedPlayers = [...game.players].sort((a, b) => b.wealth - a.wealth);
  const totalWealth = game.players.reduce((s, p) => s + p.wealth, 0);
  const myResult = me?.analysisResult;
  const personaColor = myResult
    ? (FATE_SKETCH_PERSONA_COLORS[myResult.primaryPersona] || "#60a5fa")
    : "#60a5fa";

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

  const pdfRadarData = {
    ...radarData,
    datasets: [{
      ...radarData.datasets[0],
      borderColor: "#111827",
      backgroundColor: "rgba(17,24,39,0.08)",
      pointBackgroundColor: "#111827",
      borderWidth: 2,
      pointRadius: 4,
    }],
  };

  const wealthHistory = me?.wealthHistory?.length ? me.wealthHistory : [me?.wealth ?? 0];

  const lineData = {
    labels: wealthHistory.map((_, i) => `R${i}`),
    datasets: [{
      label: "财富曲线",
      data: wealthHistory,
      borderColor: "#60a5fa",
      backgroundColor: "rgba(96,165,250,0.1)",
      borderWidth: 3,
      pointRadius: 0,
      tension: 0.4,
      fill: true,
    }],
  };

  const pdfLineData = {
    ...lineData,
    datasets: [{
      ...lineData.datasets[0],
      borderColor: "#111827",
      backgroundColor: "rgba(17,24,39,0.08)",
      borderWidth: 2,
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

  const handleExportPdf = async () => {
    if (!me || !myResult || isGeneratingPdf) return;
    setPdfFeedback(null);
    setIsGeneratingPdf(true);
    try {
      const result = await generateCollectionManual({
        playerName: me.name,
        persona: myResult.primaryPersona,
        remainingEnergy: me.energy,
        unfinishedProjects: buildPdfUnfinishedProjects(game, me),
        radarChartElementId: PDF_RADAR_CHART_ID,
        lineChartElementId: PDF_LINE_CHART_ID,
      });
      if (result.ok) {
        const warn =
          result.warnings?.length ? `（${result.warnings.join("；")}）` : "";
        setPdfFeedback({ type: "ok", text: `已下载：${result.fileName}${warn}` });
      } else {
        setPdfFeedback({ type: "err", text: result.message });
      }
    } catch {
      setPdfFeedback({ type: "err", text: "生成 PDF 失败，请稍后重试" });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "2rem 1rem", overflowY: "auto" }}>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 30% 20%, rgba(245,158,11,0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(168,85,247,0.06) 0%, transparent 50%)" }} />

      <div style={{ maxWidth: "800px", margin: "0 auto", position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: "3rem" }} className="animate-slideDown">
          <h1
            style={{
              fontSize: "clamp(2.5rem, 10vw, 4.5rem)",
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
          <h2 style={{ fontSize: uiRem(1.15), fontWeight: 700, color: "white" }}>
            社区：{game.communityName || "未命名"}
          </h2>
        </div>

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
          <div style={{ fontSize: uiRem(0.75), fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.2em", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
            本社区总财富
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(2.5rem, 12vw, 4rem)", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
            {totalWealth}
          </div>
        </div>

        <CommunityLeaderboard
          entries={game.globalLeaderboard ?? []}
          highlightName={game.communityName}
        />

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
            <h3 style={{ fontWeight: 700, color: "white", fontSize: uiRem(1) }}>🏆 个人排行榜</h3>
          </div>
          {sortedPlayers.map((p, i) => {
            const badge = rankBadge(i);
            const isMe = p.id === me?.id;
            const pColor = p.analysisResult
              ? (FATE_SKETCH_PERSONA_COLORS[p.analysisResult.primaryPersona] || "#60a5fa")
              : "#60a5fa";
            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "1rem 1.5rem",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: isMe ? "rgba(245,158,11,0.04)" : "transparent",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", minWidth: 0 }}>
                  <span style={{ width: "2rem", height: "2rem", borderRadius: "50%", background: badge.bg, color: badge.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: uiRem(0.85), fontWeight: 800, flexShrink: 0 }}>
                    {badge.text}
                  </span>
                  <span style={{ fontWeight: isMe ? 700 : 500, fontSize: uiRem(1), color: isMe ? "#fbbf24" : "white" }}>
                    {p.name}
                  </span>
                  {p.analysisResult && (
                    <span style={{ fontSize: uiRem(0.68), fontWeight: 700, padding: "0.2rem 0.55rem", borderRadius: "9999px", background: `${pColor}20`, color: pColor, border: `1px solid ${pColor}40` }}>
                      {p.analysisResult.primaryPersona}
                    </span>
                  )}
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: uiRem(1.25), color: isMe ? "#fbbf24" : "var(--color-text-secondary)", marginLeft: "auto" }}>
                  {p.wealth}
                </span>
              </div>
            );
          })}
        </div>

        {me && myResult && (
          <div style={{ marginBottom: "2rem" }}>
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ fontSize: uiRem(1.1), fontWeight: 800, color: "white", marginBottom: "0.35rem" }}>
                你的命运素描
              </h3>
              <p style={{ fontSize: uiRem(0.8), color: "var(--color-text-muted)", margin: 0 }}>
                根据本局决策行为生成的专属人格类型
              </p>
            </div>

            <div
              style={{
                background: "var(--color-bg-card)",
                border: `1px solid ${personaColor}44`,
                borderRadius: "1.25rem",
                padding: "1.5rem",
                boxShadow: `0 0 24px ${personaColor}10`,
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontSize: "clamp(1.5rem, 5vw, 1.75rem)", fontWeight: 900, color: personaColor, lineHeight: 1.2 }}>
                {myResult.primaryPersona}
              </div>
              {myResult.primaryPersonaDesc && (
                <div style={{ fontSize: uiRem(0.9), color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                  {myResult.primaryPersonaDesc}
                </div>
              )}
              <div style={{ height: "220px" }} aria-label="决策五维雷达图">
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
            </div>

            <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "1.25rem", padding: "1.25rem", marginBottom: "1rem" }}>
              <div style={{ fontSize: uiRem(0.7), fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--color-text-muted)", marginBottom: "0.75rem" }}>
                📈 财富曲线
              </div>
              <div style={{ height: "160px" }} aria-label="本局财富变化曲线">
                <Line
                  data={lineData}
                  options={{
                    responsive: true, maintainAspectRatio: false,
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

        {!myResult && me && (
          <p style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: uiRem(0.85), marginBottom: "1.5rem" }}>
            人格分析数据尚未就绪，请稍候刷新或联系管理员。
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap", width: "100%" }}>

            {myResult && me && (
              <button
                onClick={handleExportPdf}
                className="btn btn-primary"
                type="button"
                disabled={isGeneratingPdf}
                aria-busy={isGeneratingPdf}
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  border: "none",
                  color: "white",
                  minWidth: "12rem",
                }}
              >
                {isGeneratingPdf ? "正在生成 PDF…" : "📄 导出《人生决策手册》"}
              </button>
            )}
          </div>

          {pdfFeedback && (
            <p
              role="status"
              style={{
                margin: 0,
                fontSize: uiRem(0.82),
                color: pdfFeedback.type === "ok" ? "#6ee7b7" : "#fca5a5",
                textAlign: "center",
                maxWidth: "28rem",
              }}
            >
              {pdfFeedback.text}
            </p>
          )}
        </div>
      </div>

      {me && myResult && (
      <div
        id="pdf-charts-hidden-container"
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          transform: "translateX(-120vw)",
          width: `${PDF_RADAR_CAPTURE.width}px`,
          height: `${PDF_RADAR_CAPTURE.height + PDF_LINE_CAPTURE.height}px`,
          opacity: 1,
          pointerEvents: "none",
          zIndex: -1,
          overflow: "hidden",
        }}
      >
        <div
          id={PDF_RADAR_CHART_ID}
          style={{
            width: `${PDF_RADAR_CAPTURE.width}px`,
            height: `${PDF_RADAR_CAPTURE.height}px`,
            background: "#ffffff",
          }}
        >
          <Radar data={pdfRadarData} options={pdfChartOptions} />
        </div>
        <div
          id={PDF_LINE_CHART_ID}
          style={{
            width: `${PDF_LINE_CAPTURE.width}px`,
            height: `${PDF_LINE_CAPTURE.height}px`,
            background: "#ffffff",
          }}
        >
          <Line data={pdfLineData} options={pdfLineChartOptions} />
        </div>
      </div>
      )}
    </div>
  );
};
