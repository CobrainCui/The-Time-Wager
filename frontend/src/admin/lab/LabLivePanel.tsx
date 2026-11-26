import React, { useMemo, useState } from "react";
import type { GameState } from "../../types";
import { uiRem } from "../../utils/typography";

interface Props {
  game: GameState;
}

type LabLiveTab = "thoughts" | "predictions" | "chats";

function formatQuota(num: number): string {
  if (num === 0) return "不限";
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)} 万`;
  return num.toLocaleString();
}

const DECISION_KIND_LABELS: Record<string, string> = {
  prediction: "排名预测",
  investment: "拍板投资",
  auction: "拍卖出价",
  transaction: "转账表态",
  chat: "投资前沟通",
  community_name: "社区命名",
};

export const LabLivePanel: React.FC<Props> = ({ game }) => {
  const [tab, setTab] = useState<LabLiveTab>("thoughts");

  const meta = game.labMeta;
  const tokenUsage = useMemo(() => game.labTokenUsage ?? {}, [game.labTokenUsage]);
  const budget = meta?.tokenBudgetPerAgent ?? 5_000_000;
  const decisions = useMemo(() => game.labAgentDecisions ?? [], [game.labAgentDecisions]);
  const predictions = useMemo(() => game.labPredictions ?? [], [game.labPredictions]);
  const directMessages = useMemo(() => game.labDirectMessages ?? [], [game.labDirectMessages]);
  const groupMessages = useMemo(() => game.groupMessages ?? [], [game.groupMessages]);

  const latestPreChatByPlayer = useMemo(() => {
    const map = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) {
      if (d.kind === "chat" && d.globalRound === game.globalRound) {
        map.set(d.playerId, d);
      }
    }
    return map;
  }, [decisions, game.globalRound]);

  const latestThoughtByPlayer = useMemo(() => {
    const fallback = new Map<string, (typeof decisions)[number]>();
    const nonChat = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) {
      fallback.set(d.playerId, d);
      if (d.kind !== "chat") {
        nonChat.set(d.playerId, d);
      }
    }
    const map = new Map<string, (typeof decisions)[number]>();
    for (const [playerId, lastAny] of fallback) {
      map.set(playerId, nonChat.get(playerId) ?? lastAny);
    }
    return map;
  }, [decisions]);

  const latestSpeechByPlayer = useMemo(() => {
    const map = new Map<string, { channel: string; text: string; ts: number }>();
    const groupNames = new Map((game.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "全场" : g.name]));
    for (const m of groupMessages) {
      const prev = map.get(m.fromId);
      if (!prev || m.timestamp >= prev.ts) {
        map.set(m.fromId, {
          channel: groupNames.get(m.groupId) || "群聊",
          text: m.text,
          ts: m.timestamp,
        });
      }
    }
    for (const dm of directMessages) {
      const prev = map.get(dm.fromId);
      if (!prev || dm.timestamp >= prev.ts) {
        map.set(dm.fromId, {
          channel: `私聊→${dm.toName}`,
          text: dm.text,
          ts: dm.timestamp,
        });
      }
    }
    return map;
  }, [game.chatGroups, groupMessages, directMessages]);

  const mergedChatFeed = useMemo(() => {
    const groupNames = new Map((game.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "全场" : g.name]));
    const items = [
      ...groupMessages.map((m) => ({
        id: m.id,
        ts: m.timestamp,
        tag: groupNames.get(m.groupId) || "群聊",
        isPrivate: false,
        sender: m.fromName,
        text: m.text,
      })),
      ...directMessages.map((dm) => ({
        id: dm.id,
        ts: dm.timestamp,
        tag: `私聊 → ${dm.toName}`,
        isPrivate: true,
        sender: dm.fromName,
        text: dm.text,
      })),
    ];
    items.sort((a, b) => b.ts - a.ts);
    return items.slice(0, 80);
  }, [game.chatGroups, groupMessages, directMessages]);

  const playerNameById = useMemo(
    () => new Map(game.players.map((p) => [p.id, p.name])),
    [game.players]
  );

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "1rem 1.15rem",
        borderRadius: "1rem",
        background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(56,189,248,0.07))",
        border: "1px solid rgba(56,189,248,0.3)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 900, color: "#6ee7b7", fontSize: uiRem(0.95) }}>
            🧪 6AI 实验实时观察台
          </span>
          {meta && (
            <>
              <span
                style={{
                  fontSize: uiRem(0.75),
                  padding: "0.18rem 0.55rem",
                  borderRadius: "9999px",
                  background: "rgba(251,191,36,0.14)",
                  color: "#fcd34d",
                  border: "1px solid rgba(251,191,36,0.3)",
                }}
              >
                条件：{meta.condition} · 第 {meta.gameIndex + 1}/{meta.totalGames} 局
              </span>
              <span
                style={{
                  fontSize: uiRem(0.75),
                  padding: "0.18rem 0.55rem",
                  borderRadius: "9999px",
                  background: "rgba(56,189,248,0.12)",
                  color: "#bae6fd",
                  border: "1px solid rgba(56,189,248,0.28)",
                }}
              >
                发牌编号：{meta.seed}
              </span>
              {meta.mock && (
                <span
                  style={{
                    fontSize: uiRem(0.75),
                    padding: "0.18rem 0.55rem",
                    borderRadius: "9999px",
                    background: "rgba(148,163,184,0.2)",
                    color: "#e2e8f0",
                  }}
                >
                  假跑自检模式
                </span>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {(
            [
              ["thoughts", "🧠 实时内心戏 vs 发言"],
              ["predictions", `🎯 排名预测 (${predictions.length})`],
              ["chats", `💬 实验群聊与私聊 (${mergedChatFeed.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`btn btn-sm ${tab === key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "thoughts" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
            gap: "0.75rem",
          }}
        >
          {game.players.map((p) => {
            const preChat = latestPreChatByPlayer.get(p.id);
            const thought = latestThoughtByPlayer.get(p.id);
            const speech = latestSpeechByPlayer.get(p.id);
            const used = tokenUsage[p.id] ?? 0;
            const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
            const isThinking = game.aiTurnStatuses?.[p.id]?.state === "thinking";
            return (
              <div
                key={p.id}
                style={{
                  padding: "0.75rem 0.85rem",
                  borderRadius: "0.75rem",
                  background: "rgba(15,23,42,0.75)",
                  border: isThinking
                    ? "1px solid rgba(56,189,248,0.65)"
                    : "1px solid rgba(255,255,255,0.08)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.45rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem" }}>
                  <div style={{ fontWeight: 800, color: "#fbbf24", fontSize: uiRem(0.85) }}>
                    {p.name}
                    {p.agentModel ? (
                      <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: uiRem(0.72), marginLeft: "0.4rem" }}>
                        {p.agentModel}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: uiRem(0.72), color: isThinking ? "#38bdf8" : "#94a3b8" }}>
                    {isThinking ? "⏳ 思考中…" : `财富 ${p.wealth}`}
                  </div>
                </div>

                <div style={{ fontSize: uiRem(0.72), color: "#cbd5e1" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                    <span style={{ color: "#94a3b8" }}>本局消耗</span>
                    <span>
                      {used.toLocaleString()} {budget > 0 ? `/ ${formatQuota(budget)} (${pct}%)` : "/ 不限"}
                    </span>
                  </div>
                  <div style={{ height: "4px", borderRadius: "9999px", background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: pct > 85 ? "#f87171" : "#38bdf8",
                      }}
                    />
                  </div>
                </div>

                {preChat && thought?.id !== preChat.id && (
                  <div
                    style={{
                      fontSize: uiRem(0.74),
                      padding: "0.45rem 0.55rem",
                      borderRadius: "0.5rem",
                      background: "rgba(16,185,129,0.09)",
                      border: "1px solid rgba(16,185,129,0.24)",
                      color: "#d1fae5",
                      lineHeight: 1.45,
                    }}
                  >
                    <div style={{ fontSize: uiRem(0.68), color: "#6ee7b7", marginBottom: "0.15rem" }}>
                      🤝 本轮沟通盘算（第{preChat.globalRound}轮）
                    </div>
                    {preChat.reasoning || "暂无沟通想法记录"}
                  </div>
                )}

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
                  <div style={{ fontSize: uiRem(0.68), color: "#c084fc", marginBottom: "0.15rem" }}>
                    🧠 心里想的{thought ? `（${DECISION_KIND_LABELS[thought.kind] || thought.kind} · 第${thought.globalRound}轮）` : ""}
                  </div>
                  {thought?.reasoning || "尚未产生思考记录"}
                  {thought?.rawThinking && (
                    <details style={{ marginTop: "0.3rem" }}>
                      <summary style={{ cursor: "pointer", fontSize: uiRem(0.68), color: "#6ee7b7" }}>
                        💭 查看原始思考原文（{thought.rawThinking.length} 字）
                      </summary>
                      <div
                        style={{
                          marginTop: "0.25rem",
                          maxHeight: "140px",
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                          color: "#d1fae5",
                          fontSize: uiRem(0.69),
                        }}
                      >
                        {thought.rawThinking}
                      </div>
                    </details>
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
                  <div style={{ fontSize: uiRem(0.68), color: "#7dd3fc", marginBottom: "0.15rem" }}>
                    💬 嘴上说的{speech ? `（${speech.channel}）` : ""}
                  </div>
                  {speech?.text || "本局暂未公开发言或私聊"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "predictions" && (
        <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
          {predictions.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.8), padding: "0.75rem 0" }}>
              暂无排名预测记录（每个时代开始前自动提交）
            </div>
          ) : (
            [...predictions].reverse().map((pr) => (
              <div
                key={pr.id}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.55rem",
                  background: "rgba(15,23,42,0.72)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  fontSize: uiRem(0.76),
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span>
                    <strong style={{ color: "#fbbf24" }}>{pr.playerName}</strong>
                    <span style={{ color: "#94a3b8", marginLeft: "0.5rem" }}>第 {pr.era} 时代前预测：</span>
                    <span style={{ color: "#e2e8f0" }}>
                      {pr.ranking.map((id) => playerNameById.get(id) ?? id).join(" > ")}
                    </span>
                  </span>
                </div>
                {pr.reasoning && (
                  <div style={{ color: "#cbd5e1", marginTop: "0.2rem" }}>依据：{pr.reasoning}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "chats" && (
        <div style={{ maxHeight: "280px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {mergedChatFeed.length === 0 ? (
            <div style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.8), padding: "0.75rem 0" }}>
              暂无聊天消息
            </div>
          ) : (
            mergedChatFeed.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: "0.45rem 0.7rem",
                  borderRadius: "0.5rem",
                  background: item.isPrivate ? "rgba(245,158,11,0.08)" : "rgba(15,23,42,0.68)",
                  border: item.isPrivate
                    ? "1px solid rgba(245,158,11,0.22)"
                    : "1px solid rgba(255,255,255,0.07)",
                  fontSize: uiRem(0.76),
                }}
              >
                <span style={{ color: item.isPrivate ? "#fcd34d" : "#7dd3fc", marginRight: "0.45rem" }}>
                  [{item.tag}]
                </span>
                <strong style={{ color: "#f8fafc", marginRight: "0.45rem" }}>{item.sender}:</strong>
                <span style={{ color: "#cbd5e1" }}>{item.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
