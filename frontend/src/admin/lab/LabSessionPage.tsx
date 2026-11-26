import React, { useEffect, useMemo, useState } from "react";
import { BUFF_CARD_DEFS } from "../../config/buffCards";
import { uiRem } from "../../utils/typography";
import { downloadLabFile, fetchLabSessionDetail } from "./labApi";
import type { LabSessionDetail, LabSessionListItem } from "./LabTypes";

interface Props {
  session: LabSessionListItem;
  onBack: () => void;
}

type ArchiveTab = "overview" | "per_ai" | "chats";
type StepFilter = "all" | "prediction" | "chat" | "investment" | "auction" | "transaction" | "community_name";
type ChatChannelFilter = "all" | "public" | "custom" | "dm";

const DECISION_KIND_LABELS: Record<string, string> = {
  prediction: "排名预测",
  chat: "投资前沟通",
  investment: "拍板投资",
  auction: "拍卖出价",
  transaction: "转账表态",
  community_name: "社区命名",
};

const INTERACTION_MODE_LABELS: Record<string, string> = {
  guided_two_step: "温和协商 · 先聊后投",
  free_two_step: "自由语气 · 先聊后投",
  free_one_step: "彻底放手 · 一步直出",
};

const THINKING_MODE_LABELS: Record<string, string> = {
  fast: "极速直答（关长思考）",
  moderate: "适度思考（推荐）",
  deep: "深度长思考",
};

const CARD_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(BUFF_CARD_DEFS).map(([id, def]) => [id, def.name]),
);

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
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs} 秒`;
  const mins = Math.round(secs / 60);
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

function formatDecisionActionSummary(
  d: LabSessionDetail["snapshot"]["agentDecisions"][number],
  projectNameById: Map<string, string>,
  playerNameById: Map<string, string>,
  groupTagById: Map<string, string>,
  predictionScore?: { tau: number; mae: number },
): string[] {
  const lines: string[] = [];
  const act = (d.action && typeof d.action === "object" ? d.action : {}) as Record<string, unknown>;

  if (d.kind === "prediction" && Array.isArray(act.ranking)) {
    const names = (act.ranking as string[]).map((id) => playerNameById.get(id) ?? id).join(" > ");
    lines.push(`预测排名：${names}`);
    if (predictionScore) {
      lines.push(`预测准确度：排序相关 τ = ${predictionScore.tau} · 名次平均误差 MAE = ${predictionScore.mae}`);
    }
    return lines;
  }

  if (d.kind === "auction") {
    const cardLabel = typeof act.cardId === "string" ? CARD_NAMES[act.cardId] || act.cardId : "拍品";
    if (act.action === "bid") {
      lines.push(`拍卖【${cardLabel}】：出价 ${act.amount ?? "?"}`);
    } else if (act.action === "force_buy") {
      lines.push(`拍卖【${cardLabel}】：使用【强买强卖】直接拿下`);
    } else {
      lines.push(`拍卖【${cardLabel}】：放弃出价`);
    }
    return lines;
  }

  if (d.kind === "transaction") {
    const resText = act.decision === "accept" ? "同意收款" : "拒绝退款";
    lines.push(`${resText}：来自 ${String(act.fromName ?? "对方")} 的 ${String(act.amount ?? 0)} 财富`);
    return lines;
  }

  if (d.kind === "community_name") {
    lines.push(`社区命名：「${String(act.name ?? "")}」`);
    return lines;
  }

  if (act.createGroup && typeof act.createGroup === "object") {
    const cg = act.createGroup as { name?: string; memberIds?: string[] };
    const members = Array.isArray(cg.memberIds)
      ? cg.memberIds.map((id) => playerNameById.get(id) ?? id).join("、")
      : "";
    lines.push(`发起自定义小群「${cg.name || "小群"}」（成员：${members || "—"}）`);
  }

  if (Array.isArray(act.messages)) {
    for (const msg of act.messages as Array<{ channel?: string; toPlayerId?: string; text?: string }>) {
      if (!msg?.text) continue;
      if (msg.channel === "private" && msg.toPlayerId) {
        lines.push(`发私聊 → ${playerNameById.get(msg.toPlayerId) ?? msg.toPlayerId}：「${msg.text}」`);
      } else {
        lines.push(`公开发言：「${msg.text}」`);
      }
    }
  }

  if (Array.isArray(act.groupMessages)) {
    for (const gm of act.groupMessages as Array<{ groupId?: string; text?: string }>) {
      if (!gm?.text) continue;
      const gName = gm.groupId ? groupTagById.get(gm.groupId) || "小群" : "小群";
      lines.push(`群内发言 [${gName}]：「${gm.text}」`);
    }
  }

  if (d.kind === "investment") {
    const inv = (act.investment && typeof act.investment === "object" ? act.investment : {}) as Record<
      string,
      number
    >;
    const investParts = Object.entries(inv)
      .filter(([, val]) => Number(val) > 0)
      .map(([pid, val]) => `${projectNameById.get(pid) ?? `项目#${pid}`} ${val}点`);
    lines.push(`精力投入：${investParts.length > 0 ? investParts.join("，") : "0点（未投资）"}`);
    if (Number(act.coffee) > 0) {
      lines.push(`购买咖啡：${act.coffee} 杯`);
    }
    if (act.useCard && typeof act.useCard === "object" && (act.useCard as { cardId?: string }).cardId) {
      const uc = act.useCard as { cardId: string; targetPlayerId?: string; targetProjectId?: number };
      const cName = CARD_NAMES[uc.cardId] || uc.cardId;
      const extra = [
        uc.targetPlayerId ? `目标玩家 ${playerNameById.get(uc.targetPlayerId) ?? uc.targetPlayerId}` : "",
        uc.targetProjectId != null
          ? `目标项目 ${projectNameById.get(String(uc.targetProjectId)) ?? uc.targetProjectId}`
          : "",
      ]
        .filter(Boolean)
        .join(" / ");
      lines.push(`使用道具：【${cName}】${extra ? `（${extra}）` : ""}`);
    }
    if (act.transfer && typeof act.transfer === "object" && (act.transfer as { toPlayerId?: string }).toPlayerId) {
      const tf = act.transfer as { toPlayerId: string; amount?: number; note?: string };
      if (Number(tf.amount) > 0) {
        lines.push(
          `发起转账 → ${playerNameById.get(tf.toPlayerId) ?? tf.toPlayerId} ${tf.amount} 财富` +
            (tf.note ? `（备注：${tf.note}）` : ""),
        );
      }
    }
  }

  return lines;
}

export const LabSessionPage: React.FC<Props> = ({ session, onBack }) => {
  const [tab, setTab] = useState<ArchiveTab>("per_ai");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("all");
  const [stepFilter, setStepFilter] = useState<StepFilter>("all");
  const [eraFilter, setEraFilter] = useState<number>(0);
  const [expandAllThinking, setExpandAllThinking] = useState<boolean>(false);
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Record<string, boolean>>({});
  const [copiedNotice, setCopiedNotice] = useState(false);

  const [chatChannel, setChatChannel] = useState<ChatChannelFilter>("all");
  const [chatPlayerId, setChatPlayerId] = useState<string>("all");

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
            error: e instanceof Error ? e.message : "加载档案失败",
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

  const snap = detail?.snapshot;
  const metrics = snap?.metrics;
  const players = useMemo(() => snap?.players ?? [], [snap?.players]);
  const orderedSeats = useMemo(
    () =>
      [...players].sort((a, b) => (a.agentIndex ?? 99) - (b.agentIndex ?? 99)),
    [players],
  );
  const groupMsgs = useMemo(() => snap?.groupMessages ?? [], [snap?.groupMessages]);
  const directMsgs = useMemo(() => snap?.directMessages ?? [], [snap?.directMessages]);
  const decisions = useMemo(() => snap?.agentDecisions ?? [], [snap?.agentDecisions]);
  const predictions = useMemo(() => snap?.predictions ?? [], [snap?.predictions]);

  const playerNameById = useMemo(
    () => new Map(players.map((p) => [p.id, p.name])),
    [players],
  );
  const projectNameById = useMemo(
    () => new Map((snap?.projects ?? []).map((p) => [String(p.id), p.name])),
    [snap?.projects],
  );
  const groupKindById = useMemo(
    () => new Map((snap?.chatGroups ?? []).map((g) => [g.id, g.kind])),
    [snap?.chatGroups],
  );
  const groupTagById = useMemo(
    () => new Map((snap?.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "公开" : `小群·${g.name}`])),
    [snap?.chatGroups],
  );

  const predictionScoreLookup = useMemo(() => {
    const map = new Map<string, { tau: number; mae: number }>();
    for (const p of predictions) {
      const sc = metrics?.predictionScores.find((x) => x.predictionId === p.id);
      if (sc) {
        map.set(`${p.playerId}:${p.era}`, { tau: sc.tau, mae: sc.mae });
      }
    }
    return map;
  }, [predictions, metrics?.predictionScores]);

  const filteredDecisions = useMemo(() => {
    return decisions.filter((d) => {
      if (selectedPlayerId !== "all" && d.playerId !== selectedPlayerId) return false;
      if (stepFilter !== "all" && d.kind !== stepFilter) return false;
      if (eraFilter > 0 && d.era !== eraFilter) return false;
      return true;
    });
  }, [decisions, selectedPlayerId, stepFilter, eraFilter]);

  const filteredChats = useMemo(() => {
    const items = [
      ...groupMsgs.map((m) => {
        const gKind = groupKindById.get(m.groupId) ?? "public";
        return {
          id: m.id,
          ts: m.timestamp,
          channel: gKind === "custom" ? ("custom" as const) : ("public" as const),
          tag: groupTagById.get(m.groupId) || "公开",
          fromId: m.fromId,
          toId: null as string | null,
          text: `${m.fromName}：${m.text}`,
        };
      }),
      ...directMsgs.map((m) => ({
        id: m.id,
        ts: m.timestamp,
        channel: "dm" as const,
        tag: `私聊 · 第${m.globalRound}轮`,
        fromId: m.fromId,
        toId: m.toId,
        text: `${m.fromName} → ${m.toName}：${m.text}`,
      })),
    ];
    items.sort((a, b) => a.ts - b.ts);
    return items.filter((item) => {
      if (chatChannel !== "all" && item.channel !== chatChannel) return false;
      if (chatPlayerId !== "all" && item.fromId !== chatPlayerId && item.toId !== chatPlayerId) {
        return false;
      }
      return true;
    });
  }, [groupMsgs, directMsgs, groupKindById, groupTagById, chatChannel, chatPlayerId]);

  const experimentMeta = (snap?.meta?.experiment ?? null) as Record<string, unknown> | null;

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

  const handleCopyTimeline = async () => {
    const lines = filteredDecisions.map((d) => {
      const actionLines = formatDecisionActionSummary(
        d,
        projectNameById,
        playerNameById,
        groupTagById,
        d.kind === "prediction" ? predictionScoreLookup.get(`${d.playerId}:${d.era}`) : undefined,
      );
      return [
        `[时代${d.era}·第${d.globalRound}轮] ${d.playerName} (${d.model || "—"}) · ${DECISION_KIND_LABELS[d.kind] || d.kind}`,
        ...actionLines.map((l) => `  行动：${l}`),
        `  理由：${d.reasoning || "无"}`,
        d.rawThinking ? `  原始思考：\n${d.rawThinking}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n\n"));
      setCopiedNotice(true);
      window.setTimeout(() => setCopiedNotice(false), 2000);
    } catch {
      alert("浏览器未允许写入剪贴板，请直接下载 Excel 或 JSON 档案。");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "1.75rem 1.5rem", color: "#e2e8f0" }}>
      <div style={{ maxWidth: "1360px", margin: "0 auto" }}>
        {/* 顶栏 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "1rem",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: "0.55rem" }}>
              ← 返回 6AI 实验室
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 900, color: "#fbbf24" }}>
                {session.communityName}
              </h1>
              <span
                style={{
                  fontSize: uiRem(0.75),
                  padding: "0.2rem 0.6rem",
                  borderRadius: "9999px",
                  background: session.qc?.valid ? "rgba(16,185,129,0.16)" : "rgba(239,68,68,0.16)",
                  color: session.qc?.valid ? "#6ee7b7" : "#fca5a5",
                  border: session.qc?.valid ? "1px solid rgba(16,185,129,0.35)" : "1px solid rgba(239,68,68,0.35)",
                  fontWeight: 700,
                }}
              >
                {session.qc?.valid ? "✅ 体检通过 · 数据完整" : "❌ 未通过体检"}
              </span>
            </div>
            <div style={{ fontSize: uiRem(0.82), color: "var(--color-text-muted)", marginTop: "0.35rem" }}>
              条件：{session.condition} · 第 {session.sessionOrdinal + 1} 局 · 发牌号 {session.seed} · 时代主题：
              {session.eraTheme ?? "—"} · 时长：{formatDuration(session.sessionStartedAt, session.completedAt)} · 结束于{" "}
              {formatDateTime(session.completedAt)}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busyDownload !== null}
              onClick={() => void handleDownload("xlsx")}
            >
              {busyDownload === "xlsx" ? "生成中…" : "📊 下载 Excel 复盘"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busyDownload !== null}
              onClick={() => void handleDownload("json")}
            >
              {busyDownload === "json" ? "生成中…" : "📄 下载 JSON 原始档"}
            </button>
          </div>
        </div>

        {/* 主导航标签页 */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
            marginBottom: "1.25rem",
            paddingBottom: "0.75rem",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {(
            [
              ["per_ai", `🧠 分 AI 完整思考与预测档案 (${decisions.length} 步)`],
              ["overview", "📊 总览、配置与成绩表"],
              ["chats", `💬 完整聊天时间线 (${groupMsgs.length + directMsgs.length} 条)`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`}
              style={
                tab === key
                  ? {
                      border: "1.5px solid #fbbf24",
                      background: "rgba(251,191,36,0.22)",
                      color: "#fef08a",
                    }
                  : undefined
              }
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--color-text-muted)" }}>
            正在加载本局完整档案…
          </div>
        )}
        {error && (
          <div style={{ padding: "1.5rem", color: "#fca5a5", background: "rgba(239,68,68,0.1)", borderRadius: "0.75rem" }}>
            {error}
          </div>
        )}

        {/* 标签 2：分 AI 完整思考与预测档案（重点功能） */}
        {detail && !loading && tab === "per_ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* 6 名 AI 切换卡 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                gap: "0.6rem",
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedPlayerId("all")}
                style={{
                  textAlign: "left",
                  padding: "0.75rem 0.85rem",
                  borderRadius: "0.75rem",
                  background: selectedPlayerId === "all" ? "rgba(251,191,36,0.18)" : "var(--color-bg-card)",
                  border:
                    selectedPlayerId === "all"
                      ? "1.5px solid #fbbf24"
                      : "1px solid var(--color-border)",
                  color: "#e2e8f0",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 800, color: selectedPlayerId === "all" ? "#fde047" : "#fbbf24" }}>
                  👥 全部 6 位 AI
                </div>
                <div style={{ fontSize: uiRem(0.74), color: "#94a3b8", marginTop: "0.25rem" }}>
                  总步骤：{decisions.length} 步
                </div>
                <div style={{ fontSize: uiRem(0.72), color: "#cbd5e1", marginTop: "0.15rem" }}>
                  按第 1～8 轮完整时间线
                </div>
              </button>

              {orderedSeats.map((p) => {
                const isSel = selectedPlayerId === p.id;
                const count = decisions.filter((d) => d.playerId === p.id).length;
                const rawCount = decisions.filter((d) => d.playerId === p.id && Boolean(d.rawThinking)).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlayerId(p.id)}
                    style={{
                      textAlign: "left",
                      padding: "0.75rem 0.85rem",
                      borderRadius: "0.75rem",
                      background: isSel ? "rgba(251,191,36,0.18)" : "var(--color-bg-card)",
                      border: isSel ? "1.5px solid #fbbf24" : "1px solid var(--color-border)",
                      color: "#e2e8f0",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ color: isSel ? "#fde047" : "#fbbf24", fontSize: uiRem(0.88) }}>
                        {p.name}
                      </strong>
                      <span style={{ fontSize: uiRem(0.74), color: "#7dd3fc" }}>
                        #{p.rank} · 财富 {p.wealth}
                      </span>
                    </div>
                    <div style={{ fontSize: uiRem(0.7), color: "#94a3b8", marginTop: "0.2rem" }}>
                      {p.agentModel || "—"}
                    </div>
                    <div style={{ fontSize: uiRem(0.7), color: "#cbd5e1", marginTop: "0.2rem" }}>
                      社交档 {p.socialRank ?? "—"} · 记录 {count} 步
                      {rawCount > 0 ? `（含 ${rawCount} 条原始思考）` : ""}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* 步骤与时代筛选栏 */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.65rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "0.75rem",
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: uiRem(0.76), color: "#94a3b8", marginRight: "0.25rem" }}>步骤类型：</span>
                {(
                  [
                    ["all", "全部"],
                    ["prediction", "排名预测"],
                    ["chat", "投资前沟通"],
                    ["investment", "拍板投资"],
                    ["auction", "拍卖出价"],
                    ["transaction", "转账表态"],
                    ["community_name", "社区命名"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-sm ${stepFilter === k ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setStepFilter(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: uiRem(0.76), color: "#94a3b8" }}>时代：</span>
                {[0, 1, 2, 3, 4].map((era) => (
                  <button
                    key={era}
                    type="button"
                    className={`btn btn-sm ${eraFilter === era ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setEraFilter(era)}
                  >
                    {era === 0 ? "全部" : `第${era}代`}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpandAllThinking((v) => !v)}
                >
                  {expandAllThinking ? "🔽 收起全部原始思考" : "💭 展开全部原始思考"}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleCopyTimeline()}>
                  {copiedNotice ? "✅ 已复制当前档案" : "📋 复制当前档案文本"}
                </button>
              </div>
            </div>

            {/* 完整时间线（一条不截断） */}
            {filteredDecisions.length === 0 ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  color: "var(--color-text-muted)",
                  border: "1px dashed var(--color-border)",
                  borderRadius: "0.9rem",
                }}
              >
                当前筛选条件下暂无记录
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                {filteredDecisions.map((d) => {
                  const actionLines = formatDecisionActionSummary(
                    d,
                    projectNameById,
                    playerNameById,
                    groupTagById,
                    d.kind === "prediction" ? predictionScoreLookup.get(`${d.playerId}:${d.era}`) : undefined,
                  );
                  const isRawExpanded = expandAllThinking || Boolean(expandedThinkingIds[d.id]);
                  return (
                    <div
                      key={d.id}
                      style={{
                        padding: "0.9rem 1.05rem",
                        borderRadius: "0.85rem",
                        background: "var(--color-bg-card)",
                        border: "1px solid var(--color-border)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: "0.5rem",
                          marginBottom: "0.45rem",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: uiRem(0.72),
                              padding: "0.14rem 0.5rem",
                              borderRadius: "9999px",
                              background: "rgba(251,191,36,0.16)",
                              color: "#fde68a",
                              fontWeight: 700,
                            }}
                          >
                            时代 {d.era} · 第 {d.globalRound} 轮
                          </span>
                          <span
                            style={{
                              fontSize: uiRem(0.72),
                              padding: "0.14rem 0.5rem",
                              borderRadius: "9999px",
                              background: "rgba(56,189,248,0.14)",
                              color: "#7dd3fc",
                              fontWeight: 700,
                            }}
                          >
                            {DECISION_KIND_LABELS[d.kind] || d.kind}
                          </span>
                          <strong style={{ color: "#fbbf24", fontSize: uiRem(0.9) }}>{d.playerName}</strong>
                          {d.model && (
                            <span style={{ color: "#94a3b8", fontSize: uiRem(0.74) }}>{d.model}</span>
                          )}
                        </div>
                        <div style={{ fontSize: uiRem(0.72), color: "#94a3b8" }}>
                          {d.totalTokens ? `消耗 ${d.totalTokens.toLocaleString()}` : ""}
                          {d.latencyMs ? ` · 耗时 ${(d.latencyMs / 1000).toFixed(1)} 秒` : ""}
                        </div>
                      </div>

                      {actionLines.length > 0 && (
                        <div
                          style={{
                            padding: "0.5rem 0.7rem",
                            borderRadius: "0.55rem",
                            background: "rgba(15,23,42,0.72)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            fontSize: uiRem(0.78),
                            color: "#e2e8f0",
                            lineHeight: 1.55,
                            marginBottom: "0.45rem",
                          }}
                        >
                          {actionLines.map((line, idx) => (
                            <div key={idx}>• {line}</div>
                          ))}
                        </div>
                      )}

                      <div
                        style={{
                          padding: "0.5rem 0.7rem",
                          borderRadius: "0.55rem",
                          background: "rgba(168,85,247,0.1)",
                          border: "1px solid rgba(168,85,247,0.22)",
                          fontSize: uiRem(0.78),
                          color: "#f3e8ff",
                          lineHeight: 1.55,
                        }}
                      >
                        <strong style={{ color: "#d8b4fe" }}>🧠 决策理由：</strong>
                        {d.reasoning || "（无简短理由）"}
                      </div>

                      {d.rawThinking && (
                        <div style={{ marginTop: "0.45rem" }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: uiRem(0.74), color: "#6ee7b7" }}
                            onClick={() =>
                              setExpandedThinkingIds((prev) => ({
                                ...prev,
                                [d.id]: !isRawExpanded,
                              }))
                            }
                          >
                            {isRawExpanded
                              ? `🔽 收起原始内心思考过程（${d.rawThinking.length} 字）`
                              : `💭 展开原始内心思考过程（思维链原文 · ${d.rawThinking.length} 字）`}
                          </button>
                          {isRawExpanded && (
                            <pre
                              style={{
                                marginTop: "0.4rem",
                                padding: "0.75rem 0.85rem",
                                borderRadius: "0.55rem",
                                background: "rgba(2,6,23,0.92)",
                                border: "1px solid rgba(16,185,129,0.28)",
                                color: "#d1fae5",
                                fontSize: uiRem(0.75),
                                lineHeight: 1.6,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontFamily: "inherit",
                                maxHeight: "420px",
                                overflowY: "auto",
                              }}
                            >
                              {d.rawThinking}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 标签 1：总览、配置与成绩表 */}
        {detail && metrics && !loading && tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "1rem",
              }}
            >
              <div
                style={{
                  padding: "1rem 1.15rem",
                  borderRadius: "0.85rem",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <h3 style={{ margin: "0 0 0.6rem", fontSize: uiRem(0.95), color: "#fbbf24" }}>
                  本局实验配置快照
                </h3>
                <div style={{ fontSize: uiRem(0.78), lineHeight: 1.75, color: "#cbd5e1" }}>
                  <div>
                    交互流程：
                    {INTERACTION_MODE_LABELS[String(experimentMeta?.interactionMode ?? "guided_two_step")] ||
                      "温和协商 · 先聊后投"}
                  </div>
                  <div>
                    思考深度：
                    {THINKING_MODE_LABELS[String(experimentMeta?.thinkingMode ?? "moderate")] || "适度思考"}
                  </div>
                  <div>
                    沟通频道：公聊 {experimentMeta?.publicChatEnabled === false ? "关" : "开"} · 私聊{" "}
                    {experimentMeta?.privateChatEnabled === false ? "关" : "开"} · 小群{" "}
                    {experimentMeta?.customGroupsEnabled === false ? "关" : "开"}
                  </div>
                  <div>
                    玩法开关：转账 {experimentMeta?.transferEnabled === false ? "关" : "开"} · 拍卖{" "}
                    {experimentMeta?.auctionEnabled === false ? "关" : "开"} · 道具卡{" "}
                    {experimentMeta?.buffCardsEnabled === false ? "关" : "开"} · 咖啡{" "}
                    {experimentMeta?.coffeeEnabled === false ? "关" : "开"}
                  </div>
                  <div>
                    单局记忆：{experimentMeta?.memoryEnabled === false ? "关" : "开"} · 排名预测：
                    {experimentMeta?.predictionEnabled === false ? "关" : "开"} · 社交自动评档：
                    {experimentMeta?.autoSocialScore === false ? "关" : "开"}
                  </div>
                  {typeof experimentMeta?.customSystemPrompt === "string" &&
                    experimentMeta.customSystemPrompt.trim() && (
                      <details style={{ marginTop: "0.4rem" }}>
                        <summary style={{ cursor: "pointer", color: "#7dd3fc" }}>
                          查看本局自定义系统提示词（行为引导部分）
                        </summary>
                        <pre
                          style={{
                            marginTop: "0.4rem",
                            padding: "0.6rem",
                            borderRadius: "0.5rem",
                            background: "rgba(15,23,42,0.8)",
                            whiteSpace: "pre-wrap",
                            fontFamily: "inherit",
                            fontSize: uiRem(0.74),
                          }}
                        >
                          {experimentMeta.customSystemPrompt}
                        </pre>
                      </details>
                    )}
                </div>
              </div>

              <div
                style={{
                  padding: "1rem 1.15rem",
                  borderRadius: "0.85rem",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <h3 style={{ margin: "0 0 0.6rem", fontSize: uiRem(0.95), color: "#fbbf24" }}>
                  局级社会指标
                </h3>
                <table style={{ width: "100%", fontSize: uiRem(0.78) }}>
                  <tbody>
                    {[
                      ["最终财富合计", metrics.game.totalWealth],
                      ["贫富极差", metrics.game.wealthRange],
                      ["基尼系数（非负口径）", metrics.game.giniNonNegative],
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
                        <td style={{ padding: "0.28rem 0", color: "var(--color-text-muted)" }}>{String(label)}</td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{String(value ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                padding: "1rem 1.15rem",
                borderRadius: "0.85rem",
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                overflowX: "auto",
              }}
            >
              <h3 style={{ margin: "0 0 0.6rem", fontSize: uiRem(0.95), color: "#fbbf24" }}>
                6 名 AI 表现与社交评级
              </h3>
              <table style={{ width: "100%", fontSize: uiRem(0.76), borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "0.35rem" }}>玩家 / 模型</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>财富 / 名次</th>
                    <th style={{ padding: "0.35rem" }}>社交档与评定依据</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>长线占比</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>转出/入</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>公/私聊</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>预测准度</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>本局消耗</th>
                    <th style={{ padding: "0.35rem", textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.players.map((p) => (
                    <tr key={p.playerId} style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <td style={{ padding: "0.45rem 0.35rem" }}>
                        <div style={{ fontWeight: 700, color: "#f8fafc" }}>{p.name}</div>
                        <div style={{ color: "#94a3b8", fontSize: uiRem(0.68) }}>{p.model || "—"}</div>
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        <strong>{p.finalWealth}</strong> <span style={{ color: "#94a3b8" }}>#{p.finalRank}</span>
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem" }}>
                        <strong style={{ color: "#fbbf24", marginRight: "0.35rem" }}>{p.socialRank ?? "—"}</strong>
                        <span style={{ color: "#cbd5e1", fontSize: uiRem(0.72) }}>
                          {p.socialRankReason || "—"}
                        </span>
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        {Math.round(p.longShare * 100)}%
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        {p.transfersSent}/{p.transfersReceived}
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        {p.publicMessages}/{p.privateMessages}
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        {p.predictionTau ?? "—"}
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        {formatQuota(p.tokensUsed)}
                      </td>
                      <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setSelectedPlayerId(p.playerId);
                            setTab("per_ai");
                          }}
                        >
                          看 Ta 思考 →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 标签 3：完整聊天时间线（一条不截断） */}
        {detail && !loading && tab === "chats" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "0.65rem",
                padding: "0.75rem 0.9rem",
                borderRadius: "0.75rem",
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: uiRem(0.76), color: "#94a3b8" }}>频道：</span>
                {(
                  [
                    ["all", "全部"],
                    ["public", "公开群聊"],
                    ["custom", "自建小群"],
                    ["dm", "一对一私聊"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-sm ${chatChannel === k ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setChatChannel(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: uiRem(0.76), color: "#94a3b8" }}>玩家：</span>
                <button
                  type="button"
                  className={`btn btn-sm ${chatPlayerId === "all" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setChatPlayerId("all")}
                >
                  全部
                </button>
                {orderedSeats.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn btn-sm ${chatPlayerId === p.id ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setChatPlayerId(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {filteredChats.length === 0 ? (
              <div
                style={{
                  padding: "3rem",
                  textAlign: "center",
                  color: "var(--color-text-muted)",
                  border: "1px dashed var(--color-border)",
                  borderRadius: "0.85rem",
                }}
              >
                当前筛选下无聊天记录
              </div>
            ) : (
              <div
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "0.85rem",
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.45rem",
                }}
              >
                {filteredChats.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: "0.45rem 0.65rem",
                      borderRadius: "0.5rem",
                      background:
                        item.channel === "dm"
                          ? "rgba(245,158,11,0.08)"
                          : item.channel === "custom"
                            ? "rgba(16,185,129,0.08)"
                            : "rgba(15,23,42,0.7)",
                      border:
                        item.channel === "dm"
                          ? "1px solid rgba(245,158,11,0.2)"
                          : item.channel === "custom"
                            ? "1px solid rgba(16,185,129,0.22)"
                            : "1px solid rgba(255,255,255,0.06)",
                      fontSize: uiRem(0.8),
                      color: item.channel === "dm" ? "#fde68a" : "#e2e8f0",
                    }}
                  >
                    <span
                      style={{
                        color:
                          item.channel === "dm"
                            ? "#fbbf24"
                            : item.channel === "custom"
                              ? "#6ee7b7"
                              : "#7dd3fc",
                        marginRight: "0.5rem",
                        fontWeight: 700,
                      }}
                    >
                      [{item.tag}]
                    </span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
