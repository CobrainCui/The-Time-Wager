import React, { useEffect, useState, lazy, Suspense } from "react";
import { socket } from "../socket";
import { clearGameSession, loadGameSession, saveGameSession } from "../gameSession";
import { LobbyTutorial } from "./LobbyTutorial";
import { RuleAgentChat } from "../components/ruleAgent/RuleAgentChat";
const DevicePreviewShell = lazy(() =>
  import("../devicePreview/DevicePreviewShell").then((m) => ({ default: m.DevicePreviewShell }))
);

const NICKNAME_KEY = "gydd_nickname";

function loadNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) || "";
  } catch {
    return "";
  }
}

function saveNickname(value: string): void {
  try {
    localStorage.setItem(NICKNAME_KEY, value);
  } catch {
    /* ignore */
  }
}

function normalizeRoomCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
}

interface Props {
  /** 预留：大厅不再依赖对局状态 */
  game?: unknown;
}

/**
 * 首页（进入房间之前）。
 * 设计取舍：一名新玩家打开网页时只需要回答一个问题——「叫什么名字」，
 * 然后点一个按钮就能开局。房号 / 人数 / 难度全部后置。
 */
export const Lobby: React.FC<Props> = () => {
  const stored = loadGameSession();
  const invitedRoom = normalizeRoomCode(
    new URLSearchParams(window.location.search).get("room") || ""
  );
  const [name, setName] = useState(() => stored?.playerName || loadNickname());
  const [roomId, setRoomId] = useState(() => invitedRoom || stored?.roomId || "");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devicePreviewOpen, setDevicePreviewOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [hasStoredSession, setHasStoredSession] = useState(() => Boolean(stored));

  useEffect(() => {
    const clearBusy = () => setBusy(null);
    socket.on("playerJoined", clearBusy);
    socket.on("deviceClaimPending", clearBusy);
    socket.on("error", clearBusy);
    return () => {
      socket.off("playerJoined", clearBusy);
      socket.off("deviceClaimPending", clearBusy);
      socket.off("error", clearBusy);
    };
  }, []);

  useEffect(() => {
    const onError = (msg: string) => setError(String(msg || "加入失败，请重试"));
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  const cleanName = name.trim();

  const joinRoom = (targetRoom: string, playerName = cleanName) => {
    const room = normalizeRoomCode(targetRoom);
    if (!room || !playerName) return;
    setError(null);
    saveNickname(playerName);
    saveGameSession(room, playerName);
    const session = loadGameSession();
    const reconnectToken =
      session?.roomId === room && session?.playerName === playerName
        ? session.reconnectToken
        : undefined;
    socket.emit("joinGame", { roomId: room, name: playerName, reconnectToken });
  };

  /** 主操作：向服务端要一个未占用的房号，然后直接进房 */
  const startNewGame = () => {
    if (!cleanName) {
      setError("先填一个昵称，其他玩家会用它称呼你");
      return;
    }
    setBusy("create");
    setError(null);
    const onCode = (payload: { roomId?: string }) => {
      socket.off("roomCode", onCode);
      if (!payload?.roomId) {
        setBusy(null);
        setError("创建房间失败，请重试");
        return;
      }
      setBusy("join");
      joinRoom(payload.roomId);
    };
    socket.on("roomCode", onCode);
    socket.emit("requestRoomCode");
    window.setTimeout(() => {
      socket.off("roomCode", onCode);
      setBusy((b) => (b === "create" ? null : b));
    }, 6000);
  };

  const joinExisting = () => {
    if (!cleanName) {
      setError("先填一个昵称，其他玩家会用它称呼你");
      return;
    }
    if (!normalizeRoomCode(roomId)) {
      setError("请输入房间号");
      return;
    }
    setBusy("join");
    joinRoom(roomId);
  };

  const resumeSession = () => {
    if (!stored) return;
    setBusy("join");
    setName(stored.playerName);
    setRoomId(stored.roomId);
    joinRoom(stored.roomId, stored.playerName);
  };

  const clearLocalSession = () => {
    clearGameSession();
    setHasStoredSession(false);
    setRoomId("");
    setError(null);
  };

  return (
    <>
      {tutorialOpen && <LobbyTutorial playerName={name} onClose={() => setTutorialOpen(false)} />}
      {devicePreviewOpen && (
        <Suspense fallback={null}>
          <DevicePreviewShell onClose={() => setDevicePreviewOpen(false)} />
        </Suspense>
      )}
      <div className="lobby-page">
        <div className="lobby-glow" aria-hidden />
        <main className="lobby-shell">
          <section className="lobby-hero">
            <div className="lobby-eyebrow">多人实时决策桌游</div>
            <h1 className="lobby-title">光阴对弈</h1>
            <div className="lobby-subtitle">TIME GAMBIT</div>
            <p className="lobby-pitch">
              四个时代，八轮下注。
              <br />
              用有限的精力，押出你的一生。
            </p>
            <ul className="lobby-points">
              <li>
                <span className="lobby-point-icon" aria-hidden>🤖</span>
                <span>
                  <strong>不用等人，不用主持</strong>
                  <em>AI 自动补位并全程陪玩，一个人也能马上开局。</em>
                </span>
              </li>
              <li>
                <span className="lobby-point-icon" aria-hidden>👥</span>
                <span>
                  <strong>2–6 人同桌</strong>
                  <em>把房号发给朋友，空位自动补齐。</em>
                </span>
              </li>
              <li>
                <span className="lobby-point-icon" aria-hidden>⏱</span>
                <span>
                  <strong>约 30 分钟一局</strong>
                  <em>每轮只需拖动分配精力，其余交给系统推进。</em>
                </span>
              </li>
            </ul>
            <button type="button" className="lobby-tutorial-link" onClick={() => setTutorialOpen(true)}>
              📖 3 分钟看懂怎么玩
            </button>
          </section>

          <section className="lobby-card">
            <label className="lobby-field">
              <span>你的昵称</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 12))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startNewGame();
                }}
                placeholder="例如：阿弈"
                aria-label="昵称"
                maxLength={12}
                autoComplete="nickname"
              />
            </label>

            {hasStoredSession && stored && (
              <button type="button" className="lobby-resume" onClick={resumeSession} disabled={busy !== null}>
                <span>继续上次对局</span>
                <span className="lobby-resume-code">{stored.roomId}</span>
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary lobby-primary"
              onClick={startNewGame}
              disabled={busy !== null}
              title={cleanName ? undefined : "先填一个昵称再开始"}
            >
              {busy === "create" ? "正在创建房间…" : busy === "join" ? "正在进入…" : "开始一局"}
            </button>
            <p className="lobby-hint">
              默认 6 人局：你 + 5 名 AI。进房后可以改人数、难度，或等朋友进来。
            </p>

            <div className="lobby-divider" role="separator">
              <span>或加入朋友的房间</span>
            </div>

            <div className="lobby-join-row">
              <input
                className="input input-mono lobby-join-input"
                value={roomId}
                onChange={(e) => setRoomId(normalizeRoomCode(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") joinExisting();
                }}
                placeholder="房间号"
                aria-label="房间号"
                maxLength={6}
                autoCapitalize="characters"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn lobby-join-btn"
                onClick={joinExisting}
                disabled={!cleanName || !roomId || busy !== null}
              >
                加入
              </button>
            </div>

            {error && (
              <p className="lobby-error" role="alert">
                {error}
              </p>
            )}

            <div className="lobby-footer-links">
              <button type="button" onClick={() => setTutorialOpen(true)}>
                玩法说明
              </button>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => setDevicePreviewOpen(true)}>
                设备预览
              </button>
              {hasStoredSession && (
                <>
                  <span aria-hidden>·</span>
                  <button type="button" onClick={clearLocalSession}>
                    清除本机记录
                  </button>
                </>
              )}
            </div>
          </section>
        </main>
        <p className="lobby-footnote">无需下载 · 手机与电脑都能玩 · 无需主持人</p>
      </div>
      <RuleAgentChat />
    </>
  );
};
