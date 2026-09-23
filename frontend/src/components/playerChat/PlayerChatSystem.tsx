import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uiRem } from "../../utils/typography";
import { GameState, Player, Transaction } from "../../types";
import { socket } from "../../socket";
import type { ChatMessage, ChatThread } from "./types";
import {
  badgeCount,
  formatBadge,
  formatBubbleText,
  mergeThreadMessages,
  messageStatusMeta,
  msgFromTx,
  sortMessages,
} from "./chatMessageUtils";

const NOTE_MAX = 500;

function txInvolvesMe(tx: Transaction, myId: string): boolean {
  return tx.fromId === myId || tx.toId === myId;
}

function optimisticMessage(peerId: string, amount: number, note: string): ChatMessage {
  return {
    id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    direction: "out",
    amount,
    note: note.trim(),
    status: "pending",
    timestamp: Date.now(),
    peerId,
  };
}

const QuickComposer: React.FC<{
  peerId: string;
  peerName: string;
  maxWealth: number;
  compact?: boolean;
  onSend: (peerId: string, peerName: string, amount: number, note: string) => boolean;
}> = ({ peerId, peerName, maxWealth, compact, onSend }) => {
  const [amount, setAmount] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const trimmed = note.trim();
  const effectiveAmount = amount === "" ? 0 : amount;
  const isMsg = effectiveAmount === 0;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    if (isMsg && !trimmed) return;
    if (!isMsg && (effectiveAmount <= 0 || effectiveAmount > maxWealth)) return;
    setSending(true);
    const ok = onSend(peerId, peerName, effectiveAmount, note);
    if (ok) {
      setAmount("");
      setNote("");
    }
    window.setTimeout(() => setSending(false), 400);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="player-chat-composer"
      style={{
        marginTop: compact ? "0.5rem" : 0,
        padding: compact ? "0 0.5rem 0.5rem" : 0,
      }}
    >
      <div style={{ display: "flex", gap: "0.35rem" }}>
        <input
          type="number"
          min={0}
          max={maxWealth}
          className="input"
          placeholder="金额(可空)"
          value={amount}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              setAmount("");
              return;
            }
            const n = Math.floor(Number(raw));
            if (!Number.isFinite(n)) return;
            setAmount(Math.min(Math.max(0, n), maxWealth));
          }}
          style={{ width: "4.5rem", fontFamily: "var(--font-mono)", fontSize: uiRem(0.8), padding: "0.35rem" }}
        />
        <input
          className="input"
          placeholder={isMsg ? "私信…" : "备注"}
          value={note}
          maxLength={NOTE_MAX}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          style={{ flex: 1, fontSize: uiRem(0.8), padding: "0.35rem 0.5rem" }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={sending || (isMsg ? !trimmed : effectiveAmount <= 0 || effectiveAmount > maxWealth)}
          style={{ padding: "0.35rem 0.65rem" }}
        >
          {sending ? "…" : "发"}
        </button>
      </div>
      <div className="player-chat-composer-hint">
        一对一 · 不填金额为私信 · 仅 {peerName} 可见
      </div>
    </form>
  );
};

const IncomingRespondActions: React.FC<{
  txId: string;
  amount: number;
  disabled: boolean;
  onRespond: (txId: string, accept: boolean) => void;
}> = ({ txId, amount, disabled, onRespond }) => {
  const isMsg = amount === 0;
  return (
    <div className="player-chat-bubble-actions">
      <button
        type="button"
        className="btn btn-success btn-sm"
        disabled={disabled}
        onClick={() => onRespond(txId, true)}
      >
        {isMsg ? "知道了" : "接收"}
      </button>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={disabled}
        onClick={() => onRespond(txId, false)}
      >
        {isMsg ? "忽略" : "退回"}
      </button>
    </div>
  );
};

const ChatPanel: React.FC<{
  playerId: string;
  thread: ChatThread;
  peerWealth: number | undefined;
  displayMessages: ChatMessage[];
  respondingTxIds: Set<string>;
  maxWealth: number;
  onCollapse: () => void;
  onRespond: (txId: string, accept: boolean) => void;
  onSend: (peerId: string, peerName: string, amount: number, note: string) => boolean;
}> = ({
  playerId,
  thread,
  peerWealth,
  displayMessages,
  respondingTxIds,
  maxWealth,
  onCollapse,
  onRespond,
  onSend,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (displayMessages.length >= prevCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = displayMessages.length;
  }, [displayMessages]);

  return (
    <div className="player-chat-panel">
      <div className="player-chat-panel-header">
        <div className="player-chat-panel-title">
          <span style={{ fontWeight: 800, fontSize: uiRem(0.9) }}>{thread.playerName}</span>
          {peerWealth !== undefined && (
            <span className="player-chat-header-wealth">💰 {peerWealth}</span>
          )}
        </div>
        <button type="button" className="player-chat-icon-btn" onClick={onCollapse} aria-label="收起">
          ─
        </button>
      </div>
      <div ref={listRef} className="player-chat-messages">
        {displayMessages.length === 0 && (
          <div className="player-chat-empty">暂无记录，发一条试试吧</div>
        )}
        {displayMessages.map((m) => {
          const meta = messageStatusMeta(m);
          return (
            <div key={m.id} className={`player-chat-bubble ${m.direction === "out" ? "out" : "in"}`}>
              <div>{formatBubbleText(m)}</div>
              {m.status === "pending" && m.direction === "in" && m.txId && (
                <IncomingRespondActions
                  txId={m.txId}
                  amount={m.amount}
                  disabled={respondingTxIds.has(m.txId)}
                  onRespond={onRespond}
                />
              )}
              {meta && <div className="player-chat-bubble-meta">{meta}</div>}
            </div>
          );
        })}
      </div>
      <QuickComposer
        peerId={playerId}
        peerName={thread.playerName}
        maxWealth={maxWealth}
        compact
        onSend={onSend}
      />
    </div>
  );
};

export const PlayerChatSystem: React.FC<{ game: GameState; me: Player }> = ({ game, me }) => {
  const [threads, setThreads] = useState<Record<string, ChatThread>>({});
  const [threadOrder, setThreadOrder] = useState<string[]>([]);
  const [respondingTxIds, setRespondingTxIds] = useState<Set<string>>(() => new Set());
  const respondingTxRef = useRef<Set<string>>(new Set());

  const knownTxIdsRef = useRef<Set<string>>(new Set());
  const dockRef = useRef<HTMLDivElement>(null);

  const peerPlayers = useMemo(() => game.players.filter((p) => p.id !== me.id), [game.players, me.id]);

  const hasExpandedPanel = useMemo(() => Object.values(threads).some((t) => t.expanded), [threads]);

  const collapseAllExpanded = useCallback(() => {
    setThreads((prev) => {
      let changed = false;
      const next: Record<string, ChatThread> = { ...prev };
      for (const id of Object.keys(next)) {
        if (next[id].expanded) {
          changed = true;
          next[id] = { ...next[id], expanded: false };
        }
      }
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!hasExpandedPanel) return;

    const onPointerDown = (e: PointerEvent) => {
      const dock = dockRef.current;
      if (!dock || !(e.target instanceof Node)) return;
      if (dock.contains(e.target)) return;
      collapseAllExpanded();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [hasExpandedPanel, collapseAllExpanded]);

  const peerWealthById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of game.players) map[p.id] = p.wealth;
    return map;
  }, [game.players]);

  const myTransactions = useMemo(
    () => (game.transactions ?? []).filter((t) => txInvolvesMe(t, me.id)),
    [game.transactions, me.id]
  );

  const pendingTxs = myTransactions.filter((t) => t.toId === me.id && t.status === "pending");

  useEffect(() => {
    const peerIds = peerPlayers.map((p) => p.id);
    setThreads((prev) => {
      let next = prev;
      for (const p of peerPlayers) {
        const existing = next[p.id];
        if (!existing) {
          if (next === prev) next = { ...prev };
          next[p.id] = {
            playerId: p.id,
            playerName: p.name,
            messages: [],
            expanded: false,
            unread: 0,
          };
        } else if (existing.playerName !== p.name) {
          if (next === prev) next = { ...prev };
          next[p.id] = { ...existing, playerName: p.name };
        }
      }
      return next;
    });
    setThreadOrder((order) => {
      const kept = order.filter((id) => peerIds.includes(id));
      const missing = peerIds.filter((id) => !kept.includes(id));
      if (missing.length === 0) return order;
      return [...kept, ...missing];
    });
  }, [peerPlayers]);

  const displayOrder = useMemo(() => {
    const peerIds = peerPlayers.map((p) => p.id);
    const expandedIds = peerIds.filter((id) => threads[id]?.expanded);
    const collapsedIds = peerIds.filter((id) => !threads[id]?.expanded);

    const sortByThreadOrder = (ids: string[]) => {
      const sorted = threadOrder.filter((id) => ids.includes(id));
      for (const id of ids) {
        if (!sorted.includes(id)) sorted.push(id);
      }
      return sorted;
    };

    // threadOrder 最新在前；DOM 自底向上堆叠时，先打开的在上、后打开贴近右下角
    const expandedStack = [...sortByThreadOrder(expandedIds)].reverse();
    return [...expandedStack, ...sortByThreadOrder(collapsedIds)];
  }, [peerPlayers, threadOrder, threads]);

  const activateThread = useCallback(
    (
      playerId: string,
      playerName: string,
      patch: {
        messages?: ChatMessage[];
        expanded?: boolean;
        bumpUnread?: boolean;
      }
    ) => {
      setThreads((prev) => {
        const existing = prev[playerId];
        const expanded = patch.expanded ?? existing?.expanded ?? false;
        const bump = patch.bumpUnread ?? false;
        const unread = expanded ? 0 : (existing?.unread ?? 0) + (bump ? 1 : 0);

        return {
          ...prev,
          [playerId]: {
            playerId,
            playerName,
            messages: patch.messages ?? existing?.messages ?? [],
            expanded,
            unread,
          },
        };
      });

      setThreadOrder((order) => {
        const rest = order.filter((id) => id !== playerId);
        return [playerId, ...rest];
      });
    },
    []
  );

  const ingestServerTx = useCallback(
    (tx: Transaction) => {
      if (!txInvolvesMe(tx, me.id)) return;
      if (knownTxIdsRef.current.has(tx.id)) return;
      knownTxIdsRef.current.add(tx.id);

      const peerId = tx.fromId === me.id ? tx.toId : tx.fromId;
      const peerName = tx.fromId === me.id ? tx.toName : tx.fromName;
      const isIncoming = tx.toId === me.id;
      const serverMsg = msgFromTx(tx, me.id);

      setThreads((prev) => {
        const existing = prev[peerId];
        let messages = existing?.messages ?? [];

        if (tx.fromId === me.id) {
          messages = messages.filter(
            (m) =>
              m.txId ||
              !(
                m.direction === "out" &&
                m.status === "pending" &&
                (m.peerId === undefined || m.peerId === peerId) &&
                m.amount === tx.amount &&
                m.note === (tx.note || "")
              )
          );
        }

        if (messages.some((m) => m.txId === tx.id)) {
          return prev;
        }

        const wasExpanded = existing?.expanded ?? false;
        const expanded = isIncoming ? wasExpanded : true;
        const unread = isIncoming
          ? wasExpanded
            ? 0
            : (existing?.unread ?? 0) + 1
          : existing?.unread ?? 0;

        return {
          ...prev,
          [peerId]: {
            playerId: peerId,
            playerName: peerName,
            messages: sortMessages([...messages, serverMsg]),
            expanded,
            unread,
          },
        };
      });

      setThreadOrder((order) => {
        const rest = order.filter((id) => id !== peerId);
        return [peerId, ...rest];
      });
    },
    [me.id]
  );

  const appendOptimisticOut = useCallback((peerId: string, peerName: string, amount: number, note: string) => {
    const msg = optimisticMessage(peerId, amount, note);
    setThreads((prev) => {
      const existing = prev[peerId];
      return {
        ...prev,
        [peerId]: {
          playerId: peerId,
          playerName: peerName,
          messages: sortMessages([...(existing?.messages ?? []), msg]),
          expanded: true,
          unread: 0,
        },
      };
    });
    setThreadOrder((order) => {
      const rest = order.filter((id) => id !== peerId);
      return [peerId, ...rest];
    });
  }, []);

  useEffect(() => {
    for (const tx of myTransactions) {
      if (tx.status !== "pending" && respondingTxRef.current.has(tx.id)) {
        respondingTxRef.current.delete(tx.id);
        setRespondingTxIds(new Set(respondingTxRef.current));
      }

      if (!knownTxIdsRef.current.has(tx.id)) {
        ingestServerTx(tx);
        continue;
      }

      const peerId = tx.fromId === me.id ? tx.toId : tx.fromId;
      setThreads((prev) => {
        const thread = prev[peerId];
        if (!thread) return prev;

        let changed = false;
        const messages = thread.messages.map((m) => {
          if (m.txId === tx.id && m.status !== tx.status) {
            changed = true;
            return { ...m, status: tx.status };
          }
          if (
            !m.txId &&
            m.direction === "out" &&
            tx.fromId === me.id &&
            tx.toId === peerId &&
            (m.peerId === undefined || m.peerId === peerId) &&
            m.amount === tx.amount &&
            m.note === (tx.note || "")
          ) {
            changed = true;
            return { ...msgFromTx(tx, me.id), id: m.id };
          }
          return m;
        });

        if (!changed) return prev;
        return { ...prev, [peerId]: { ...thread, messages: sortMessages(messages) } };
      });
    }
  }, [myTransactions, ingestServerTx, me.id]);

  const handleRespond = useCallback(
    (txId: string, accept: boolean) => {
      if (respondingTxRef.current.has(txId)) return;
      const tx = myTransactions.find((t) => t.id === txId && t.status === "pending");
      if (!tx || tx.toId !== me.id) return;

      respondingTxRef.current.add(txId);
      setRespondingTxIds(new Set(respondingTxRef.current));

      const peerId = tx.fromId;
      setThreads((prev) => {
        const t = prev[peerId];
        if (!t) return prev;
        return {
          ...prev,
          [peerId]: {
            ...t,
            expanded: true,
            unread: 0,
            messages: sortMessages(
              t.messages.map((m) =>
                m.txId === txId ? { ...m, status: accept ? "accepted" : "rejected" } : m
              )
            ),
          },
        };
      });
      setThreadOrder((order) => [peerId, ...order.filter((id) => id !== peerId)]);
      socket.emit("respondTransaction", { txId, accept });
    },
    [me.id, myTransactions]
  );

  const sendToPeer = useCallback(
    (peerId: string, peerName: string, amount: number, note: string) => {
      const trimmed = note.trim().slice(0, NOTE_MAX);
      if (amount === 0) {
        if (!trimmed) return false;
        appendOptimisticOut(peerId, peerName, 0, trimmed);
        socket.emit("createTransaction", { toId: peerId, amount: 0, note: trimmed });
        return true;
      }
      if (amount <= 0 || amount > me.wealth) return false;
      appendOptimisticOut(peerId, peerName, amount, trimmed);
      socket.emit("createTransaction", { toId: peerId, amount, note: trimmed });
      return true;
    },
    [appendOptimisticOut, me.wealth]
  );

  const orphanTxsForPeer = useCallback(
    (playerId: string, thread: ChatThread) => {
      const inThread = new Set(thread.messages.filter((m) => m.txId).map((m) => m.txId!));
      return myTransactions.filter((t) => {
        const peer = t.fromId === me.id ? t.toId : t.fromId;
        return peer === playerId && !inThread.has(t.id);
      });
    },
    [me.id, myTransactions]
  );

  return (
    <div ref={dockRef} className="player-chat-dock" aria-label="玩家私信与转账">
      {displayOrder.map((playerId) => {
        const thread = threads[playerId];
        if (!thread) return null;

        if (thread.expanded) {
          const displayMessages = mergeThreadMessages(thread.messages, orphanTxsForPeer(playerId, thread), me.id);
          return (
            <ChatPanel
              key={playerId}
              playerId={playerId}
              thread={thread}
              peerWealth={peerWealthById[playerId]}
              displayMessages={displayMessages}
              respondingTxIds={respondingTxIds}
              maxWealth={me.wealth}
              onCollapse={() => activateThread(playerId, thread.playerName, { expanded: false })}
              onRespond={handleRespond}
              onSend={sendToPeer}
            />
          );
        }

        const pendingCount = pendingTxs.filter((t) => t.fromId === playerId).length;
        const badge = badgeCount(thread.unread, pendingCount);
        const badgeLabel = formatBadge(badge);

        return (
          <button
            key={playerId}
            type="button"
            className="player-chat-minibar"
            title={badge > 0 ? `${thread.playerName}（${badgeLabel} 条未读）` : thread.playerName}
            aria-label={badge > 0 ? `${thread.playerName}，${badgeLabel} 条未读` : thread.playerName}
            onClick={() =>
              activateThread(playerId, thread.playerName, { expanded: true, bumpUnread: false })
            }
          >
            <span className="player-chat-avatar player-chat-avatar--label">
              {thread.playerName.length <= 3 ? thread.playerName : thread.playerName.slice(0, 2)}
            </span>
            {badge > 0 && <span className="player-chat-badge player-chat-badge--minibar">{badgeLabel}</span>}
          </button>
        );
      })}
    </div>
  );
};
