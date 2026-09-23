import React, { useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import { TUTORIAL_NPCS } from "../tutorialMock";

type DemoMsg = {
  id: string;
  direction: "in" | "out";
  amount: number;
  note: string;
  status: "pending" | "accepted" | "rejected";
};

type DemoThread = {
  playerId: string;
  playerName: string;
  messages: DemoMsg[];
  expanded: boolean;
  unread: number;
};

function formatBubble(m: DemoMsg): string {
  if (m.amount === 0) return m.note || "（私信）";
  const prefix = m.amount > 0 ? `💰 ${m.amount}` : "";
  return m.note ? `${prefix} · ${m.note}` : prefix;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export const DemoTransferAndMessage: React.FC<{ playerName?: string }> = () => {
  const [wealth, setWealth] = useState(150);
  const [threads, setThreads] = useState<Record<string, DemoThread>>(() => {
    const init: Record<string, DemoThread> = {};
    for (const n of TUTORIAL_NPCS) {
      init[n.id] = {
        playerId: n.id,
        playerName: n.name,
        messages: [],
        expanded: false,
        unread: 0,
      };
    }
    return init;
  });
  const [toast, setToast] = useState("");
  const [threadOrder, setThreadOrder] = useState<string[]>(() => TUTORIAL_NPCS.map((n) => n.id));

  const displayOrder = useMemo(() => {
    const ids = TUTORIAL_NPCS.map((n) => n.id);
    const expanded = ids.filter((id) => threads[id]?.expanded);
    const collapsed = ids.filter((id) => !threads[id]?.expanded);
    const sortByOrder = (list: string[]) => {
      const sorted = threadOrder.filter((id) => list.includes(id));
      for (const id of list) {
        if (!sorted.includes(id)) sorted.push(id);
      }
      return sorted;
    };
    return [...sortByOrder(expanded).reverse(), ...sortByOrder(collapsed)];
  }, [threads, threadOrder]);

  const setExpanded = (playerId: string, expanded: boolean) => {
    setThreads((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        expanded,
        unread: expanded ? 0 : prev[playerId].unread,
      },
    }));
    if (expanded) {
      setThreadOrder((order) => [playerId, ...order.filter((id) => id !== playerId)]);
    }
  };

  const appendMessage = (playerId: string, msg: DemoMsg) => {
    setThreads((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        messages: [...prev[playerId].messages, msg],
      },
    }));
  };

  const updateMessageStatus = (playerId: string, msgId: string, status: DemoMsg["status"]) => {
    setThreads((prev) => ({
      ...prev,
      [playerId]: {
        ...prev[playerId],
        messages: prev[playerId].messages.map((m) => (m.id === msgId ? { ...m, status } : m)),
      },
    }));
  };

  const sendToPeer = (peerId: string, amount: number, note: string) => {
    const trimmed = note.trim();
    if (amount === 0 && !trimmed) return;
    if (amount > 0 && (amount > wealth || amount <= 0)) return;

    if (amount > 0) setWealth((w) => w - amount);

    const outId = makeId();
    appendMessage(peerId, {
      id: outId,
      direction: "out",
      amount,
      note: trimmed,
      status: amount === 0 ? "accepted" : "pending",
    });
    setExpanded(peerId, true);
    setToast(amount === 0 ? "私信已发送（试玩）" : `已向对方发起转账 ${amount} 💰（试玩）`);

    if (amount === 0) return;

    window.setTimeout(() => {
      updateMessageStatus(peerId, outId, "accepted");
      if (amount > 0) {
        setToast(`对方已接收转账 ${amount} 💰（试玩模拟）`);
      }
    }, 1200);
  };

  const injectIncomingSample = (peerId: string) => {
    const msgId = makeId();
    setThreads((prev) => ({
      ...prev,
      [peerId]: {
        ...prev[peerId],
        expanded: true,
        unread: 0,
        messages: [
          ...prev[peerId].messages,
          {
            id: msgId,
            direction: "in",
            amount: 8,
            note: "试玩：请点接收或退回",
            status: "pending",
          },
        ],
      },
    }));
    setToast("已插入一条待处理转账，请在气泡内操作");
  };

  const respond = (peerId: string, msgId: string, accept: boolean) => {
    updateMessageStatus(peerId, msgId, accept ? "accepted" : "rejected");
    setToast(accept ? "你已接收（试玩）" : "你已退回（试玩）");
  };

  const DemoComposer: React.FC<{ peerId: string }> = ({ peerId }) => {
    const [amount, setAmount] = useState<number | "">("");
    const [note, setNote] = useState("");
    const trimmed = note.trim();
    const effectiveAmount = amount === "" ? 0 : amount;
    const isMsg = effectiveAmount === 0;

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (isMsg && !trimmed) return;
          if (!isMsg && (effectiveAmount <= 0 || effectiveAmount > wealth)) return;
          sendToPeer(peerId, effectiveAmount, note);
          setAmount("");
          setNote("");
        }}
        style={{ display: "flex", flexDirection: "column", gap: "0.35rem", padding: "0 0.5rem 0.5rem" }}
      >
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <input
            type="number"
            className="input"
            min={0}
            max={wealth}
            placeholder="金额"
            value={amount}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setAmount("");
                return;
              }
              const n = Math.floor(Number(raw));
              if (!Number.isFinite(n)) return;
              setAmount(Math.min(Math.max(0, n), wealth));
            }}
            style={{ width: "4.5rem", fontFamily: "var(--font-mono)", fontSize: uiRem(0.8), padding: "0.35rem" }}
          />
          <input
            className="input"
            placeholder={isMsg ? "私信…" : "备注"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1, fontSize: uiRem(0.8), padding: "0.35rem 0.5rem" }}
          />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={isMsg ? !trimmed : effectiveAmount <= 0 || effectiveAmount > wealth}
            style={{ padding: "0.35rem 0.65rem" }}
          >
            发
          </button>
        </div>
      </form>
    );
  };

  return (
    <div>
      <p style={{ fontSize: uiRem(0.85), color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
        对局时屏幕<strong>右侧</strong>每位玩家各有一个<strong>一对一</strong>对话框（默认折叠，可同时展开多个、自上而下排列）。消息只发给当前选中的那位；
        <strong>不填金额</strong>（或填 0）并留言即私信；对方仅在与你之间的会话里接收或退回。
      </p>
      <div style={{ marginBottom: "0.65rem", fontFamily: "var(--font-mono)", color: "#fbbf24", fontWeight: 700 }}>
        试玩财富：{wealth} 💰
      </div>
      {toast && (
        <div style={{ marginBottom: "0.65rem", fontSize: uiRem(0.8), color: "#6ee7b7" }}>{toast}</div>
      )}

      <div className="tutorial-chat-demo">
        <div className="player-chat-dock tutorial-chat-demo__dock" aria-label="试玩对话框">
          {displayOrder.map((playerId) => {
            const thread = threads[playerId];
            if (!thread) return null;

            if (thread.expanded) {
              return (
                <div key={playerId} className="player-chat-panel">
                  <div className="player-chat-panel-header">
                    <span style={{ fontWeight: 800, fontSize: uiRem(0.9) }}>{thread.playerName}</span>
                    <button
                      type="button"
                      className="player-chat-icon-btn"
                      onClick={() => setExpanded(playerId, false)}
                      aria-label="收起"
                    >
                      ─
                    </button>
                  </div>
                  <div className="player-chat-messages">
                    {thread.messages.length === 0 && (
                      <div
                        style={{
                          color: "var(--color-text-muted)",
                          fontSize: uiRem(0.75),
                          textAlign: "center",
                          padding: "0.75rem 0",
                        }}
                      >
                        暂无记录
                      </div>
                    )}
                    {thread.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`player-chat-bubble ${m.direction === "out" ? "out" : "in"}`}
                      >
                        <div>{formatBubble(m)}</div>
                        {m.status === "pending" && m.direction === "in" && m.amount > 0 && (
                          <div className="player-chat-bubble-actions">
                            <button
                              type="button"
                              className="btn btn-success btn-sm"
                              onClick={() => respond(playerId, m.id, true)}
                            >
                              接收
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => respond(playerId, m.id, false)}
                            >
                              退回
                            </button>
                          </div>
                        )}
                        {m.amount > 0 && m.status !== "pending" && (
                          <div className="player-chat-bubble-meta">
                            {m.status === "accepted" ? "已处理" : "已退回"}
                          </div>
                        )}
                        {m.amount > 0 && m.status === "pending" && m.direction === "out" && (
                          <div className="player-chat-bubble-meta">等待对方确认</div>
                        )}
                      </div>
                    ))}
                  </div>
                  <DemoComposer peerId={playerId} />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ margin: "0 0.5rem 0.65rem", width: "calc(100% - 1rem)" }}
                    onClick={() => injectIncomingSample(playerId)}
                  >
                    试玩：插入待收转账
                  </button>
                </div>
              );
            }

            const pendingIn = thread.messages.filter(
              (m) => m.direction === "in" && m.status === "pending" && m.amount > 0
            ).length;
            const badge = Math.max(thread.unread, pendingIn);

            return (
              <button
                key={playerId}
                type="button"
                className="player-chat-minibar"
                title={thread.playerName}
                onClick={() => setExpanded(playerId, true)}
              >
                <span className="player-chat-avatar player-chat-avatar--label">
                  {thread.playerName.length <= 3 ? thread.playerName : thread.playerName.slice(0, 2)}
                </span>
                {badge > 0 && <span className="player-chat-badge player-chat-badge--minibar">{badge}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
