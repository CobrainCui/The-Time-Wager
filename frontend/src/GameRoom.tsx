import React, { useState, useEffect } from "react";
import { uiRem } from "./utils/typography";
import { GameState } from "./types";
import { EraIntro } from "./views/EraIntro";
import { Drafting } from "./views/Drafting";
import { Investment } from "./views/Investment";
import { Settlement } from "./views/Settlement";
import { Lobby } from "./views/Lobby";
import { CommunityNaming } from "./views/CommunityNaming";
import { GameOver } from "./views/GameOver";
import { TutorialView } from "./views/TutorialView";
import { BuffUsage } from "./views/BuffUsage";
import { AuctionView } from "./views/AuctionView";
import { socket } from "./socket";
import { PlayerChatSystem } from "./components/playerChat/PlayerChatSystem";

const BUFF_NAME_MAP: Record<string, string> = {
  buff_gold: "点石成金", buff_short: "项目做空", buff_slack: "摸鱼传染",
  buff_rebound: "反弹琵琶", buff_insurance: "保险", buff_spirit: "精神老伙",
  buff_swap: "偷天换日", buff_lottery: "彩票",
};

interface Props {
  game: GameState;
  myPlayerId: string;
  onExit?: () => void;
  projectImages?: Record<number, number>;
  eraImages?: Record<string, number>;
  buffImages?: Record<string, number>;
}

// ——— 拍卖确认弹窗 ———
const AuctionConfirmModal: React.FC = () => {
  const [request, setRequest] = useState<{ cardId: string; cost: number } | null>(null);

  useEffect(() => {
    const handler = (data: { cardId: string; cost: number }) => setRequest(data);
    socket.on("auctionTradeRequest", handler);
    return () => { socket.off("auctionTradeRequest", handler); };
  }, []);

  const handleRespond = (accept: boolean) => {
    if (!request) return;
    socket.emit("playerRespondAuction", { cardId: request.cardId, cost: request.cost, accept });
    setRequest(null);
  };

  if (!request) return null;
  const cardName = BUFF_NAME_MAP[request.cardId] || request.cardId;

  return (
    <div className="modal-overlay">
      <div
        className="modal-box animate-bounce-in"
        style={{
          border: "2px solid rgba(168,85,247,0.6)",
          boxShadow: "0 0 60px rgba(168,85,247,0.35)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>🔨</div>
        <h3 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", marginBottom: "0.5rem" }}>
          竞拍成功！
        </h3>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
          你拍得了{" "}
          <span style={{ color: "#d8b4fe", fontWeight: 800, fontSize: uiRem(1.1) }}>{cardName}</span>
        </p>
        <div
          style={{
            background: "rgba(168,85,247,0.1)",
            border: "1px solid rgba(168,85,247,0.25)",
            borderRadius: "0.875rem",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ fontSize: uiRem(0.7), color: "var(--color-text-muted)", marginBottom: "0.25rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>需支付</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "3rem", fontWeight: 900, color: "#fbbf24", lineHeight: 1 }}>
            {request.cost}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            onClick={() => handleRespond(false)}
            className="btn btn-ghost"
            style={{ flex: 1 }}
          >
            金额有误
          </button>
          <button
            onClick={() => handleRespond(true)}
            className="btn btn-purple"
            style={{ flex: 1, fontSize: uiRem(1) }}
          >
            确认支付 ✓
          </button>
        </div>
      </div>
    </div>
  );
};

// ——— 主 GameRoom ———
export default function GameRoom({ game, myPlayerId, onExit, projectImages = {}, eraImages = {}, buffImages = {} }: Props) {
  const [buffPrefillOpen, setBuffPrefillOpen] = useState(false);
  const me = game.players.find((p) => p.id === myPlayerId);

  useEffect(() => {
    if (game.phase !== "BUFF_USAGE") setBuffPrefillOpen(false);
  }, [game.phase]);

  if (!me) {
    return (
      <div className="page-center" style={{ flexDirection: "column", gap: "1rem" }}>
        <div style={{ fontSize: "3rem" }}>❌</div>
        <div style={{ color: "#f87171", fontWeight: 700 }}>未识别玩家身份，请刷新重试</div>
      </div>
    );
  }

  const isIntro = game.phase === "ERA_INTRO";
  const showTransactionOverlay = !isIntro && game.phase !== "TUTORIAL";

  const renderMainView = () => {
    if (game.phase === "BUFF_USAGE" && (me.ready || buffPrefillOpen)) {
      return (
        <Investment
          game={game}
          me={me}
          mode={me.ready ? "investment" : "discussion"}
          projectImages={projectImages}
          onBackToBuff={me.ready ? undefined : () => setBuffPrefillOpen(false)}
        />
      );
    }
    switch (game.phase) {
      case "ERA_INTRO":       return <EraIntro game={game} me={me} eraImages={eraImages} />;
      case "TUTORIAL":        return <TutorialView game={game} me={me} />;
      case "DRAFTING":        return <Drafting game={game} me={me} />;
      case "BUFF_USAGE":      return (
        <BuffUsage
          game={game}
          me={me}
          buffImages={buffImages}
          onOpenInvestmentPrefill={() => setBuffPrefillOpen(true)}
        />
      );
      case "INVESTMENT":      return <Investment game={game} me={me} mode="investment" projectImages={projectImages} />;
      case "SETTLEMENT":      return <Settlement game={game} me={me} />;
      case "AUCTION":         return <AuctionView game={game} me={me} buffImages={buffImages} />;
      case "COMMUNITY_NAMING":return <CommunityNaming game={game} me={me} />;
      case "GAME_OVER":       return <GameOver game={game} me={me} />;
      default:                return <EraIntro game={game} me={me} eraImages={eraImages} />;
    }
  };

  return (
    <div
      style={{
        position: "relative",
        ...(isIntro
          ? { height: "100dvh", maxHeight: "100dvh", overflow: "hidden" }
          : { minHeight: "100vh" }),
      }}
    >
      {renderMainView()}
      {showTransactionOverlay && <PlayerChatSystem game={game} me={me} />}
      <AuctionConfirmModal />
    </div>
  );
}
