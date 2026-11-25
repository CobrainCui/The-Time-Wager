import React, { memo, useEffect, useRef, useState } from "react";
import type { AiChatStatusEntry } from "../../types";
import type { ChatMessage, ChatThread } from "./types";
import { GroupTextComposer } from "./GroupTextComposer";
import type { ComposerDraft } from "./chatComposerDraft";

type Props = {
  thread: ChatThread;
  displayMessages: ChatMessage[];
  draftsRef: React.MutableRefObject<Record<string, ComposerDraft>>;
  onCollapse: () => void;
  onLeaveGroup?: () => void;
  onSend: (threadId: string, text: string) => boolean;
  onComposerFocus: (threadId: string) => void;
  onComposerBlur: (threadId: string) => void;
  aiChatStatuses?: Record<string, AiChatStatusEntry>;
  readOnly?: boolean;
};

export const GroupChatPanel = memo<Props>(function GroupChatPanel({
  thread,
  displayMessages,
  draftsRef,
  onCollapse,
  onLeaveGroup,
  onSend,
  onComposerFocus,
  onComposerBlur,
  aiChatStatuses,
  readOnly = false,
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickToBottom && displayMessages.length >= prevCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = displayMessages.length;
  }, [displayMessages, stickToBottom]);

  const statusEntries = Object.values(aiChatStatuses ?? {});
  const thinkingNames = statusEntries
    .filter((s) => s.state === "thinking")
    .map((s) => s.playerName);
  const silentNames = statusEntries
    .filter((s) => s.state === "silent")
    .map((s) => s.playerName);

  return (
    <div className="player-chat-panel player-chat-panel--group">
      <div className="player-chat-panel-header">
        <div className="player-chat-panel-title">
          <span className="player-chat-panel-name">{thread.playerName}</span>
          {thread.groupKind === "custom" && <span className="player-chat-group-tag">群聊</span>}
          {thread.groupKind === "public" && (
            <span className="player-chat-group-tag player-chat-group-tag--public">全场</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
          {thread.groupKind === "custom" && !readOnly && onLeaveGroup && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onLeaveGroup}>
              退群
            </button>
          )}
          <button type="button" className="player-chat-icon-btn" onClick={onCollapse} aria-label="收起">
            ─
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        className="player-chat-messages"
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          setStickToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
        }}
      >
        {displayMessages.length === 0 && <div className="player-chat-empty">暂无群消息</div>}
        {displayMessages.map((m) => (
          <div
            key={m.clientTempId || m.id}
            className={`player-chat-bubble player-chat-bubble--group ${m.direction === "out" ? "out" : "in"}${
              m.status === "failed" ? " failed" : ""
            }`}
          >
            {m.direction === "in" && m.senderLabel && (
              <div className="player-chat-group-sender-name">{m.senderLabel}</div>
            )}
            <div>{m.note || "（空）"}</div>
            {m.status === "failed" && <div className="player-chat-bubble-meta">发送失败</div>}
            {m.status === "pending" && m.direction === "out" && !m.txId && (
              <div className="player-chat-bubble-meta">发送中…</div>
            )}
          </div>
        ))}
      </div>
      {(thinkingNames.length > 0 || silentNames.length > 0) && (
        <div
          className="player-chat-ai-status"
          style={{
            padding: "0.28rem 0.65rem",
            fontSize: "0.74rem",
            color: thinkingNames.length > 0 ? "var(--gold, #eab308)" : "var(--text-muted, #94a3b8)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(15, 23, 42, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: "0.15rem",
          }}
        >
          {thinkingNames.length > 0 && <span>⏳ {thinkingNames.join("、")} 正在思考…</span>}
          {silentNames.length > 0 && <span>👀 {silentNames.join("、")} 已读，暂保持沉默</span>}
        </div>
      )}
      {!readOnly && (
        <GroupTextComposer
          threadId={thread.playerId}
          draftsRef={draftsRef}
          onComposerFocus={onComposerFocus}
          onComposerBlur={onComposerBlur}
          onSend={onSend}
        />
      )}
    </div>
  );
});
