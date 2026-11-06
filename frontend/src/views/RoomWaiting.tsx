import React, { useEffect, useState } from "react";
import { GameState, Player } from "../types";
import { aiDifficultyLabel, isAiPlayer } from "../utils/isAiPlayer";
import { AutoHostCountdown } from "../components/AutoHostCountdown";
import { socket } from "../socket";

interface Props {
  game: GameState;
  me: Player;
  /** 主持公共预览：不高亮座位 */
  embed?: boolean;
}

const MIN_PLAYERS = 4;
const MAX_SEATS = 6;

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * 等待房（自助开局）。
 * 房主在这里决定「和几个 AI 打、多难」，然后直接开始，不需要主持人。
 */
export const RoomWaiting: React.FC<Props> = ({ game, me, embed = false }) => {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const humans = game.players.filter((p) => !isAiPlayer(p));
  const aiPlayers = game.players.filter((p) => isAiPlayer(p));
  const humanSeats = humans.length;
  const connectedHumans = humans.filter((p) => p.connected).length;
  const maxAi = Math.max(0, Math.min(5, MAX_SEATS - humanSeats));
  const minAi = Math.max(0, Math.min(maxAi, MIN_PLAYERS - humanSeats));
  const aiValue = Math.max(0, Math.min(game.aiSeats ?? MAX_SEATS - humanSeats, maxAi));
  const target = Math.min(MAX_SEATS, humanSeats + aiValue);
  const isOwner = !embed && game.roomOwnerId === me.id;
  const owner = game.players.find((p) => p.id === game.roomOwnerId);
  const canStart = target >= MIN_PLAYERS && connectedHumans >= 1;
  const difficulty = game.aiDifficulty ?? "normal";

  useEffect(() => {
    const onError = (msg: string) => {
      setStarting(false);
      setError(String(msg || "开局失败，请重试"));
    };
    socket.on("error", onError);
    return () => {
      socket.off("error", onError);
    };
  }, []);

  const startingNow = starting && game.phase === "ROOM_WAITING";

  const updateRoom = (patch: { aiSeats?: number; aiDifficulty?: string; autoStart?: boolean }) => {
    setError(null);
    socket.emit("playerUpdateRoom", patch);
  };

  const startGame = () => {
    setError(null);
    setStarting(true);
    socket.emit("playerStartGame");
    window.setTimeout(() => setStarting(false), 12000);
  };

  const inviteLink =
    typeof window !== "undefined" ? `${window.location.origin}/?room=${game.roomId}` : game.roomId;

  const handleCopy = async (kind: "code" | "link") => {
    const ok = await copyText(kind === "code" ? game.roomId : inviteLink);
    if (!ok) {
      setError(`复制失败，请手动记下房号：${game.roomId}`);
      return;
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const seats = [
    ...humans.map((p) => ({ key: p.id, kind: "human" as const, player: p })),
    ...aiPlayers.map((p) => ({ key: p.id, kind: "ai" as const, player: p })),
    ...Array.from({ length: Math.max(0, target - game.players.length) }, (_, i) => ({
      key: `empty-${i}`,
      kind: "empty" as const,
      player: null,
    })),
  ];

  return (
    <div className="waiting-page">
      <div className="waiting-shell">
        <header className="waiting-head">
          <div>
            <div className="waiting-kicker">房间号</div>
            <button
              type="button"
              className="waiting-code"
              onClick={() => void handleCopy("code")}
              title="点击复制房号"
            >
              {game.roomId}
              <span>{copied === "code" ? "已复制" : "复制"}</span>
            </button>
          </div>
          <div className="waiting-mode">
            {game.autoHostEnabled ? "系统主持 · 自动推进" : "等待主持人"}
          </div>
        </header>

        <p className="waiting-lead">
          {humanSeats <= 1 ? "一个人也能玩：AI 会补齐剩下的座位。" : "把房间号发给朋友，他们可以直接加入。"}
        </p>

        <div className="waiting-progress">
          <div className="waiting-progress-label">
            <strong>{humanSeats}</strong> 名真人 · <strong>{aiPlayers.length}</strong> 名 AI
            <span>目标 {target} 人</span>
          </div>
          <div className="waiting-progress-bar">
            <i style={{ width: `${Math.min(100, (game.players.length / target) * 100)}%` }} />
          </div>
        </div>

        <ul className="waiting-seats">
          {seats.map(({ key, kind, player }) => {
            if (kind === "empty" || !player) {
              return (
                <li key={key} className="waiting-seat waiting-seat--empty">
                  <span className="waiting-seat-avatar" aria-hidden>＋</span>
                  <span className="waiting-seat-body">
                    <strong>空座</strong>
                    <em>开局时补 AI，或等朋友加入</em>
                  </span>
                </li>
              );
            }
            const isMe = !embed && player.id === me.id;
            const isOwnerSeat = player.id === game.roomOwnerId;
            return (
              <li
                key={key}
                className={`waiting-seat${isMe ? " waiting-seat--me" : ""}${player.connected ? "" : " waiting-seat--off"}`}
              >
                <span className="waiting-seat-avatar" aria-hidden>
                  {player.name.slice(0, 1)}
                </span>
                <span className="waiting-seat-body">
                  <strong>
                    {player.name}
                    {isMe && <span className="waiting-tag waiting-tag--me">我</span>}
                    {isOwnerSeat && <span className="waiting-tag waiting-tag--owner">房主</span>}
                    {kind === "ai" && (
                      <span className="waiting-tag waiting-tag--ai">
                        AI · {aiDifficultyLabel(player.aiDifficulty)}
                      </span>
                    )}
                  </strong>
                  <em>{player.connected ? "已就位" : "离线"}</em>
                </span>
              </li>
            );
          })}
        </ul>

        {isOwner ? (
          <section className="waiting-owner" aria-label="对局设置">
            <div className="waiting-setting">
              <div className="waiting-setting-label">
                <strong>AI 对手</strong>
                <em>
                  {maxAi === 0
                    ? "房间已满 6 名真人"
                    : `可设 ${minAi}–${maxAi} 名；总人数至少 ${MIN_PLAYERS} 人`}
                </em>
              </div>
              <div className="waiting-stepper" role="group" aria-label="AI 对手数量">
                <button
                  type="button"
                  onClick={() => updateRoom({ aiSeats: aiValue - 1 })}
                  disabled={startingNow || aiValue <= minAi}
                  aria-label="减少 AI"
                >
                  −
                </button>
                <span aria-live="polite">{aiValue}</span>
                <button
                  type="button"
                  onClick={() => updateRoom({ aiSeats: aiValue + 1 })}
                  disabled={startingNow || aiValue >= maxAi}
                  aria-label="增加 AI"
                >
                  ＋
                </button>
              </div>
            </div>

            <div className="waiting-setting">
              <div className="waiting-setting-label">
                <strong>AI 难度</strong>
                <em>简单适合第一次玩</em>
              </div>
              <div className="waiting-segments" role="group" aria-label="AI 难度">
                {(["easy", "normal", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={difficulty === d ? "is-active" : ""}
                    onClick={() => updateRoom({ aiDifficulty: d })}
                    disabled={startingNow}
                  >
                    {aiDifficultyLabel(d)}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary waiting-start"
              onClick={startGame}
              disabled={startingNow || !canStart}
            >
              {startingNow ? "正在准备 AI…" : `开始对局（${target} 人）`}
            </button>
            {!canStart && (
              <p className="waiting-note">
                还差 {MIN_PLAYERS - target} 人：把 AI 加到 {Math.max(0, MIN_PLAYERS - humanSeats)} 名，或邀请朋友加入。
              </p>
            )}
            {error && <p className="waiting-error" role="alert">{error}</p>}
            <p className="waiting-note waiting-note--muted">
              房主是你：设置只影响本房间，开局后不能再改。
            </p>
          </section>
        ) : (
          <section className="waiting-wait" aria-live="polite">
            <span className="waiting-wait-icon" aria-hidden>⏳</span>
            <strong>{owner ? `等待房主 ${owner.name} 开始对局` : "等待房主开始对局"}</strong>
            <em>房主可以调整 AI 人数与难度并直接开局</em>
            {startingNow && <em>正在准备…</em>}
          </section>
        )}

        <div className="waiting-foot">
          {game.autoStartAt != null && <AutoHostCountdown at={game.autoStartAt} label="自动开局" />}
          {isOwner && (
            <button
              type="button"
              className="waiting-invite"
              onClick={() => updateRoom({ autoStart: game.autoStartCancelled === true })}
            >
              {game.autoStartCancelled ? "开启自动开局" : "先等朋友（取消自动开局）"}
            </button>
          )}
          <button type="button" className="waiting-invite" onClick={() => void handleCopy("link")}>
            {copied === "link" ? "✔ 邀请链接已复制" : "🔗 复制邀请链接"}
          </button>
        </div>
      </div>
    </div>
  );
};
