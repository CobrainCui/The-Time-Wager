import React, { useEffect, useState } from "react";
import { uiRem } from "../../utils/typography";
import { downloadLabFile, fetchLabSessionDetail } from "./labApi";
import type { LabSessionDetail, LabSessionListItem } from "./LabTypes";

interface Props {
  session: LabSessionListItem;
  onClose: () => void;
}

function formatDateTime(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(start: number | null, end: number): string {
  if (!start || !end || end <= start) return "—";
  const mins = Math.round((end - start) / 60_000);
  if (mins < 1) return "不足 1 分钟";
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

function formatQuota(n: number | undefined): string {
  const num = Number(n ?? 0);
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)} 万`;
  return num.toLocaleString();
}

const DECISION_KIND_LABELS: Record<string, string> = {
  prediction: "排名预测",
  chat: "投资前沟通",
  investment: "拍板投资",
  auction: "拍卖出价",
  transaction: "转账表态",
  community_name: "社区命名",
};

export const LabSessionDrawer: React.FC<Props> = ({ session, onClose }) => {
  const [fetched, setFetched] = useState<{
    sessionId: string;
    data: LabSessionDetail | null;
    error: string | null;
  } | null>(null);
  const [busyDownload, setBusyDownload] = useState<"xlsx" | "json" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchLabSessionDetail(session.sessionId)
      .then((d) => {
        if (!cancelled) setFetched({ sessionId: session.sessionId, data: d, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setFetched({
            sessionId: session.sessionId,
            data: null,
            error: e instanceof Error ? e.message : "加载详情失败",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session.sessionId]);

  const loading = fetched?.sessionId !== session.sessionId;
  const detail = fetched?.sessionId === session.sessionId ? fetched.data : null;
  const error = fetched?.sessionId === session.sessionId ? fetched.error : null;

  const handleDownload = async (format: "xlsx" | "json") => {
    setBusyDownload(format);
    try {
      await downloadLabFile(
        `/api/admin/lab/sessions/${encodeURIComponent(session.sessionId)}/export?format=${format}`,
        `${session.condition}_${session.sessionId.slice(0, 8)}.${format}`,
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusyDownload(null);
    }
  };

  const snap = detail?.snapshot;
  const metrics = snap?.metrics;
  const players = snap?.players ?? [];
  const predictions = snap?.predictions ?? [];
  const groupMsgs = snap?.groupMessages ?? [];
  const directMsgs = snap?.directMessages ?? [];
  const decisions = snap?.agentDecisions ?? [];
  const groupTagById = new Map(
    (snap?.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "公开" : `小群·${g.name}`]),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(640px, 100%)",
          height: "100%",
          background: "#0f172a",
          borderLeft: "1px solid var(--color-border)",
          padding: "1.5rem",
          overflow: "auto",
          color: "#e2e8f0",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "#fbbf24", fontSize: uiRem(1.15) }}>
              {session.communityName}
            </h2>
            <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.78), marginTop: "0.25rem" }}>
              条件：{session.condition} · 第 {session.sessionOrdinal + 1} 局 · 社区总财富{" "}
              {session.communityWealth.toLocaleString()}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busyDownload !== null}
            onClick={() => handleDownload("xlsx")}
          >
            {busyDownload === "xlsx" ? "导出中…" : "📊 下载 Excel 复盘 (16 表)"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busyDownload !== null}
            onClick={() => handleDownload("json")}
          >
            {busyDownload === "json" ? "导出中…" : "📄 下载 JSON 原始档"}
          </button>
        </div>

        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 0.9rem",
            borderRadius: "0.65rem",
            background: session.qc?.valid ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)",
            border: session.qc?.valid
              ? "1px solid rgba(16,185,129,0.3)"
              : "1px solid rgba(239,68,68,0.35)",
            fontSize: uiRem(0.78),
            lineHeight: 1.65,
          }}
        >
          <div style={{ fontWeight: 700, color: session.qc?.valid ? "#6ee7b7" : "#fca5a5" }}>
            {session.qc?.valid ? "✅ 自动体检通过（数据完整可用）" : "❌ 本局已作废 / 未通过体检"}
          </div>
          {session.failureReason && <div style={{ color: "#fecaca" }}>失败原因：{session.failureReason}</div>}
          {(session.qc?.reasons?.length ?? 0) > 0 && (
            <div style={{ color: "#fecaca" }}>异常项：{session.qc.reasons.join("；")}</div>
          )}
          {(session.qc?.warnings?.length ?? 0) > 0 && (
            <div style={{ color: "#fde68a" }}>提示：{session.qc.warnings.join("；")}</div>
          )}
          <div>
            对局时长：{formatDuration(session.sessionStartedAt, session.completedAt)} · 结束于{" "}
            {formatDateTime(session.completedAt)}
          </div>
          <div>
            发牌编号：{session.seed}（基准 {session.seedBase}）· 时代主题：{session.eraTheme ?? "—"} ·
            总消耗：{formatQuota(session.qc?.totalTokensUsed)}
          </div>
        </div>

        {loading && (
          <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85), marginTop: "1.25rem" }}>
            正在加载完整对局分析…
          </p>
        )}
        {error && (
          <p style={{ color: "#f87171", fontSize: uiRem(0.85), marginTop: "1.25rem" }}>{error}</p>
        )}

        {detail && metrics && (
          <>
            <h3 style={{ fontSize: uiRem(0.92), marginTop: "1.25rem", color: "#fbbf24" }}>局级社会指标</h3>
            <table style={{ width: "100%", fontSize: uiRem(0.78), marginTop: "0.35rem" }}>
              <tbody>
                {[
                  ["最终财富合计", metrics.game.totalWealth],
                  ["贫富极差", metrics.game.wealthRange],
                  ["基尼系数（非负主分析口径）", metrics.game.giniNonNegative],
                  ["转账笔数 / 金额", `${metrics.game.transferCount} / ${metrics.game.transferVolume}`],
                  ["关系互惠率", metrics.game.transferReciprocity],
                  ["公开 / 私聊条数", `${metrics.game.publicMessageCount} / ${metrics.game.privateMessageCount}`],
                  ["主动干扰次数", metrics.game.attackCount],
                  ["拍卖总花费", metrics.game.auctionSpend],
                  [
                    "预测平均准度 (τ / 误差)",
                    `${metrics.game.meanPredictionTau ?? "—"} / ${metrics.game.meanPredictionMae ?? "—"}`,
                  ],
                ].map(([label, value]) => (
                  <tr key={String(label)} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "0.3rem 0", color: "var(--color-text-muted)" }}>{String(label)}</td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{String(value ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ fontSize: uiRem(0.92), marginTop: "1.25rem", color: "#fbbf24" }}>
              6 名 AI 表现与社交评级
            </h3>
            <div style={{ overflowX: "auto", marginTop: "0.35rem" }}>
              <table style={{ width: "100%", fontSize: uiRem(0.72), borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "0.3rem" }}>玩家 / 模型</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>财富</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>名次</th>
                    <th style={{ padding: "0.3rem", textAlign: "center" }}>社交档</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>长线%</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>转出/入</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>公/私聊</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>预测准度</th>
                    <th style={{ padding: "0.3rem", textAlign: "right" }}>消耗</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.players.map((p) => (
                    <tr key={p.playerId} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <td style={{ padding: "0.3rem" }}>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: uiRem(0.65) }}>{p.model || "—"}</div>
                      </td>
                      <td style={{ padding: "0.3rem", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                        {p.finalWealth}
                      </td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>#{p.finalRank}</td>
                      <td
                        style={{ padding: "0.3rem", textAlign: "center", fontWeight: 800, color: "#fbbf24" }}
                        title={p.socialRankReason || ""}
                      >
                        {p.socialRank ?? "—"}
                      </td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>{Math.round(p.longShare * 100)}%</td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>
                        {p.transfersSent}/{p.transfersReceived}
                      </td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>
                        {p.publicMessages}/{p.privateMessages}
                      </td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>{p.predictionTau ?? "—"}</td>
                      <td style={{ padding: "0.3rem", textAlign: "right" }}>{formatQuota(p.tokensUsed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: uiRem(0.92), marginTop: "1.25rem", color: "#fbbf24" }}>
              各时代排名预测 ({predictions.length})
            </h3>
            <div style={{ maxHeight: "200px", overflowY: "auto", marginTop: "0.35rem" }}>
              {predictions.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.75) }}>无预测记录</div>
              ) : (
                predictions.map((p) => {
                  const sc = metrics.predictionScores.find((x) => x.predictionId === p.id);
                  return (
                    <div
                      key={p.id}
                      style={{
                        fontSize: uiRem(0.72),
                        padding: "0.35rem 0",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <strong style={{ color: "#fbbf24" }}>{p.playerName}</strong>
                      <span style={{ color: "#94a3b8" }}> 时代 {p.era} · </span>
                      <span>
                        {p.ranking.map((id) => players.find((x) => x.id === id)?.name ?? id).join(" > ")}
                      </span>
                      <span style={{ color: "#7dd3fc", marginLeft: "0.4rem" }}>
                        准度={sc?.tau ?? "—"} 误差={sc?.mae ?? "—"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <h3 style={{ fontSize: uiRem(0.92), marginTop: "1.25rem", color: "#fbbf24" }}>
              公开群聊与一对一私聊 ({groupMsgs.length + directMsgs.length})
            </h3>
            <div style={{ maxHeight: "220px", overflowY: "auto", marginTop: "0.35rem" }}>
              {groupMsgs.length + directMsgs.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.75) }}>无通信记录</div>
              ) : (
                [
                  ...groupMsgs.map((m) => ({
                    id: m.id,
                    ts: m.timestamp,
                    text: `[${groupTagById.get(m.groupId) || "公开"}] ${m.fromName}：${m.text}`,
                    isDm: false,
                  })),
                  ...directMsgs.map((m) => ({
                    id: m.id,
                    ts: m.timestamp,
                    text: `[私聊 · 第${m.globalRound}轮] ${m.fromName} → ${m.toName}：${m.text}`,
                    isDm: true,
                  })),
                ]
                  .sort((a, b) => a.ts - b.ts)
                  .slice(-120)
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{
                        fontSize: uiRem(0.72),
                        padding: "0.28rem 0",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        color: item.isDm ? "#fde68a" : "#cbd5e1",
                      }}
                    >
                      {item.text}
                    </div>
                  ))
              )}
            </div>

            <h3 style={{ fontSize: uiRem(0.92), marginTop: "1.25rem", color: "#fbbf24" }}>
              AI 每步思考与推理日志 (最近 100 条)
            </h3>
            <div style={{ maxHeight: "260px", overflowY: "auto", marginTop: "0.35rem" }}>
              {decisions.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.75) }}>无决策思考记录</div>
              ) : (
                decisions
                  .slice(-100)
                  .reverse()
                  .map((d) => (
                    <div
                      key={d.id}
                      style={{
                        fontSize: uiRem(0.72),
                        padding: "0.35rem 0",
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <div>
                        <strong style={{ color: "#60a5fa" }}>{d.playerName}</strong>
                        <span style={{ color: "#94a3b8", marginLeft: "0.4rem" }}>
                          第{d.globalRound}轮 · {DECISION_KIND_LABELS[d.kind] || d.kind}
                          {d.totalTokens ? ` · 消耗 ${d.totalTokens}` : ""}
                          {d.latencyMs ? ` · ${d.latencyMs}ms` : ""}
                        </span>
                      </div>
                      <div style={{ color: "#cbd5e1", marginTop: "0.15rem" }}>{d.reasoning}</div>
                    </div>
                  ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
