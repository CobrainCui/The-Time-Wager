import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { uiRem } from "../../utils/typography";
import type { Player } from "../../types";

type Props = {
  open: boolean;
  meId: string;
  players: Player[];
  onClose: () => void;
  onCreate: (memberIds: string[], name: string) => void;
};

export const CreateGroupModal = memo<Props>(function CreateGroupModal({
  open,
  meId,
  players,
  onClose,
  onCreate,
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [name, setName] = useState("");
  const creatingRef = useRef(false);

  useEffect(() => {
    if (open) creatingRef.current = false;
  }, [open]);

  const candidates = useMemo(
    () => players.filter((p) => p.id !== meId && p.connected),
    [players, meId]
  );

  // 私信坞在窄屏带 backdrop-filter，会成为 position:fixed 的包含块，
  // 若把弹层留在坞内会被裁成「窄窄一条」。用 portal 挂到 body 顶层。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSubmit = picked.size >= 2;

  return createPortal(
    <div className="player-chat-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="player-chat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="player-chat-modal-head">
          <h3 id="create-group-title" style={{ margin: 0, fontSize: uiRem(0.95) }}>
            建群聊
          </h3>
          <button
            type="button"
            className="player-chat-modal-close"
            onClick={onClose}
            aria-label="关闭建群"
            title="关闭"
          >
            ✕
          </button>
        </div>
        <p style={{ margin: "0 0 0.65rem", fontSize: uiRem(0.78), color: "var(--color-text-muted)" }}>
          至少再选 2 名玩家（真人或 AI；群内不可转账，仅文字）
        </p>
        <input
          className="input"
          placeholder="群名称（可选）"
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          style={{ marginBottom: "0.65rem", width: "100%" }}
        />
        <ul className="player-chat-modal-member-list">
          {candidates.map((p) => (
            <li key={p.id}>
              <label className="player-chat-modal-member-row">
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                <span>{p.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {candidates.length < 2 && (
          <p style={{ fontSize: uiRem(0.75), color: "var(--color-text-muted)" }}>
            至少需要 3 名在线玩家（真人或 AI）才能建群
          </p>
        )}
        <div className="player-chat-modal-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!canSubmit}
            onClick={() => {
              if (creatingRef.current || !canSubmit) return;
              creatingRef.current = true;
              onCreate([...picked], name.trim());
              setPicked(new Set());
              setName("");
              onClose();
            }}
          >
            创建
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
});
