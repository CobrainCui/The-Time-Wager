import React, { useEffect, useMemo, useState } from "react";
import type { GameState } from "../../types";
import { uiRem } from "../../utils/typography";
import { aiDifficultyLabel, isAiPlayer } from "../../utils/isAiPlayer";

interface Props {
  game: GameState;
}

type ObserverTab = "cards" | "timeline";

const DECISION_KIND_LABELS: Record<string, string> = {
  investment: "投资与道具",
  auction: "拍卖出价",
  transfer: "转账表态",
  dm_reply: "私信回复",
  group_chat: "群聊发言",
  group_welcome: "入群招呼",
  opening_chat: "开场冒泡",
  community_name: "社区命名",
  unlock_reinvest: "解锁重投",
};

function formatTokenCount(n: number | undefined): string {
  const num = Number(n ?? 0);
  if (num <= 0) return "0";
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)} 万`;
  return num.toLocaleString();
}

function formatBudgetLabel(budget: number | undefined): string {
  const num = Number(budget ?? 0);
  if (num <= 0) return "不限";
  if (num >= 10_000) return `${(num / 10_000).toFixed(0)} 万`;
  return num.toLocaleString();
}

export const AdminAiObserverPanel: React.FC<Props> = ({ game }) => {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<ObserverTab>("cards");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (game.phase !== "INVESTMENT" || typeof game.aiOpeningUntil !== "number") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [game.phase, game.aiOpeningUntil]);

  const aiPlayers = useMemo(
    () =>
      [...game.players]
        .filter((p) => isAiPlayer(p))
        .sort((a, b) => (a.aiSlot ?? 99) - (b.aiSlot ?? 99)),
    [game.players]
  );

  const decisions = useMemo(() => game.aiDecisions ?? [], [game.aiDecisions]);
  const tokenUsage = useMemo(() => game.aiTokenUsage ?? {}, [game.aiTokenUsage]);
  const budget = game.aiTokenBudgetPerGame ?? 0;

  const latestDecisionByPlayer = useMemo(() => {
    const map = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) {
      map.set(d.playerId, d);
    }
    return map;
  }, [decisions]);

  const latestSpeechByPlayer = useMemo(() => {
    const map = new Map<string, { channel: string; text: string; ts: number }>();
    const groupNames = new Map(
      (game.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "全场" : g.name])
    );
    for (const m of game.groupMessages ?? []) {
      const prev = map.get(m.fromId);
      if (!prev || m.timestamp >= prev.ts) {
        map.set(m.fromId, {
          channel: groupNames.get(m.groupId) || "群聊",
          text: m.text,
          ts: m.timestamp,
        });
      }
    }
    for (const tx of game.transactions ?? []) {
      const text = (tx.note ?? "").trim();
      if (!text) continue;
      const prev = map.get(tx.fromId);
      if (!prev || tx.timestamp >= prev.ts) {
        map.set(tx.fromId, {
          channel: tx.amount > 0 ? `转账→${tx.toName}` : `私信→${tx.toName}`,
          text,
          ts: tx.timestamp,
        });
      }
    }
    return map;
  }, [game.chatGroups, game.groupMessages, game.transactions]);

  if (game.isLabExperiment || aiPlayers.length === 0) return null;

  const thinkingCount = aiPlayers.filter(
    (p) => game.aiTurnStatuses?.[p.id]?.state === "thinking"
  ).length;
  const failureCount = aiPlayers.filter((p) => Boolean(game.aiFailures?.[p.id])).length;
  const totalTokens = aiPlayers.reduce((sum, p) => sum + (tokenUsage[p.id] ?? 0), 0);
  const inOpeningNegotiation =
    game.phase === "INVESTMENT" &&
    typeof game.aiOpeningUntil === "number" &&
    game.aiOpeningUntil > nowMs &&
    aiPlayers.some((p) => !p.ready);

  return (
    <div
      style={{
        marginBottom: "1.25rem",
        borderRadius: "1rem",
        background: "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(168,85,247,0.06))",
        border:
          failureCount > 0
            ? "1px solid rgba(248,113,113,0.45)"
            : "1px solid rgba(56,189,248,0.28)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "0.75rem 1.1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.65rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 800, color: "#7dd3fc", fontSize: uiRem(0.92) }}>
            🧠 AI 内心戏与消耗
          </span>
          <span style={{ fontSize: uiRem(0.76), color: "#cbd5e1" }}>
            在座 {aiPlayers.length} 名
            {inOpeningNegotiation ? " · 🤝 开场谈判中" : ""}
            {thinkingCount > 0 ? ` · 思考中 ${thinkingCount} 名` : ""}
            {` · 合计消耗 ${formatTokenCount(totalTokens)}`}
            {budget > 0 ? `（上限 ${formatBudgetLabel(budget)}/位）` : ""}
          </span>
          {failureCount > 0 && (
            <span
              style={{
                fontSize: uiRem(0.72),
                padding: "0.12rem 0.5rem",
                borderRadius: "9999px",
                background: "rgba(239,68,68,0.2)",
                color: "#fca5a5",
                fontWeight: 700,
              }}
            >
              {failureCount} 名异常
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
          {expanded && (
            <>
              <button
                type="button"
                className={`btn btn-sm ${tab === "cards" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTab("cards")}
              >
                内心戏 vs 发言
              </button>
              <button
                type="button"
                className={`btn btn-sm ${tab === "timeline" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setTab("timeline")}
              >
                决策流水 ({decisions.length})
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起观察 ▲" : "展开观察 ▼"}
          </button>
        </div>
      </div>

      {expanded && (
        <div
          style={{
            padding: "0 1.1rem 1rem",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            paddingTop: "0.85rem",
          }}
        >
          {tab === "cards" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {aiPlayers.map((p) => {
                const used = tokenUsage[p.id] ?? 0;
                const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
                const isThinking = game.aiTurnStatuses?.[p.id]?.state === "thinking";
                const failure = game.aiFailures?.[p.id];
                const latest = latestDecisionByPlayer.get(p.id);
                const speech = latestSpeechByPlayer.get(p.id);
                const modelShort = p.aiModelOverride
                  ? p.aiModelOverride.split("/").pop()
                  : p.aiModelLabel?.split("/").pop();

                return (
                  <div
                    key={p.id}
                    style={{
                      padding: "0.75rem 0.85rem",
                      borderRadius: "0.75rem",
                      background: "rgba(15,23,42,0.75)",
                      border: failure
                        ? "1px solid rgba(248,113,113,0.55)"
                        : isThinking
                          ? "1px solid rgba(56,189,248,0.65)"
                          : "1px solid rgba(255,255,255,0.08)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.45rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <div style={{ fontWeight: 800, color: "#7dd3fc", fontSize: uiRem(0.86) }}>
                        {p.name}
                        <span
                          style={{
                            color: "#94a3b8",
                            fontWeight: 500,
                            fontSize: uiRem(0.72),
                            marginLeft: "0.35rem",
                          }}
                        >
                          {aiDifficultyLabel(p.aiDifficulty)}
                          {modelShort ? ` · ${modelShort}` : ""}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: uiRem(0.72),
                          color: failure
                            ? "#fca5a5"
                            : isThinking
                              ? "#38bdf8"
                              : p.ready
                                ? "#34d399"
                                : "#fbbf24",
                        }}
                      >
                        {failure
                          ? "⚠️ 异常"
                          : isThinking
                            ? "⏳ 思考中…"
                            : p.ready
                              ? "✅ 已锁定"
                              : `💰 ${p.wealth}`}
                      </span>
                    </div>

                    <div style={{ fontSize: uiRem(0.72), color: "#cbd5e1" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: "0.2rem",
                        }}
                      >
                        <span style={{ color: "#94a3b8" }}>本局消耗</span>
                        <span>
                          {used.toLocaleString()}{" "}
                          {budget > 0 ? `/ ${formatBudgetLabel(budget)} (${pct}%)` : "/ 不限"}
                        </span>
                      </div>
                      {budget > 0 && (
                        <div
                          style={{
                            height: "4px",
                            borderRadius: "9999px",
                            background: "rgba(255,255,255,0.08)",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: pct > 85 ? "#f87171" : "#38bdf8",
                            }}
                          />
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: uiRem(0.74),
                        padding: "0.45rem 0.55rem",
                        borderRadius: "0.5rem",
                        background: "rgba(168,85,247,0.1)",
                        border: "1px solid rgba(168,85,247,0.22)",
                        color: "#e9d5ff",
                        lineHeight: 1.45,
                      }}
                    >
                      <div
                        style={{
                          fontSize: uiRem(0.68),
                          color: "#c084fc",
                          marginBottom: "0.15rem",
                        }}
                      >
                        🧠 心里想的
                        {latest
                          ? `（${DECISION_KIND_LABELS[latest.kind] || latest.kind} · 第${latest.globalRound}轮${latest.latencyMs ? ` · ${(latest.latencyMs / 1000).toFixed(1)}s` : ""}）`
                          : ""}
                      </div>
                      <div>{latest?.reasoning || latest?.summary || "尚未产生思考记录"}</div>
                      {latest?.summary && latest?.reasoning && (
                        <div style={{ color: "#cbd5e1", fontSize: uiRem(0.68), marginTop: "0.2rem" }}>
                          动作：{latest.summary}
                        </div>
                      )}
                    </div>

                    <div
                      style={{
                        fontSize: uiRem(0.74),
                        padding: "0.45rem 0.55rem",
                        borderRadius: "0.5rem",
                        background: "rgba(56,189,248,0.08)",
                        border: "1px solid rgba(56,189,248,0.2)",
                        color: "#e0f2fe",
                        lineHeight: 1.45,
                      }}
                    >
                      <div
                        style={{
                          fontSize: uiRem(0.68),
                          color: "#7dd3fc",
                          marginBottom: "0.15rem",
                        }}
                      >
                        💬 嘴上说的{speech ? `（${speech.channel}）` : ""}
                      </div>
                      {speech?.text || "本局暂未公开发言或私信"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "timeline" && (
            <div
              style={{
                maxHeight: "320px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "0.45rem",
              }}
            >
              {decisions.length === 0 ? (
                <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.8) }}>
                  暂无 AI 决策记录
                </div>
              ) : (
                [...decisions].reverse().map((d) => (
                  <div
                    key={d.id}
                    style={{
                      padding: "0.5rem 0.75rem",
                      borderRadius: "0.55rem",
                      background: "rgba(15,23,42,0.72)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontSize: uiRem(0.75),
                      lineHeight: 1.45,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        <strong style={{ color: "#7dd3fc" }}>{d.playerName}</strong>
                        <span style={{ color: "#94a3b8", marginLeft: "0.45rem" }}>
                          第{d.globalRound}轮 · {DECISION_KIND_LABELS[d.kind] || d.kind}
                          {d.summary ? ` · ${d.summary}` : ""}
                        </span>
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: uiRem(0.68) }}>
                        {d.latencyMs ? `${(d.latencyMs / 1000).toFixed(1)}s` : ""}
                        {d.totalTokens ? ` · ${d.totalTokens.toLocaleString()} tok` : ""}
                      </span>
                    </div>
                    {d.reasoning && (
                      <div style={{ color: "#e2e8f0", marginTop: "0.2rem" }}>{d.reasoning}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
