import React, { useState, useEffect, useRef } from "react";
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
import { RoomWaiting } from "./views/RoomWaiting";
import { socket } from "./socket";
import { PlayerChatSystem } from "./components/playerChat/PlayerChatSystem";
import { PlayerGameHelp } from "./components/PlayerGameHelp";
import { useMediaQuery } from "./hooks/useMediaQuery";

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [investmentPrefill, setInvestmentPrefill] = useState<Record<number, number>>({});
  const prefillRoundRef = useRef(game.globalRound);
  const prevInvestmentReadyRef = useRef(false);
  const me = game.players.find((p) => p.id === myPlayerId);

  useEffect(() => {
    if (game.phase !== "BUFF_USAGE") setBuffPrefillOpen(false);
  }, [game.phase]);

  useEffect(() => {
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") {
      setInvestmentPrefill({});
    }
  }, [game.phase]);

  useEffect(() => {
    if (prefillRoundRef.current !== game.globalRound) {
      prefillRoundRef.current = game.globalRound;
      const player = game.players.find((p) => p.id === myPlayerId);
      setInvestmentPrefill(player?.investmentDraft ? { ...player.investmentDraft } : {});
      return;
    }
    const player = game.players.find((p) => p.id === myPlayerId);
    if (!player?.investmentDraft || Object.keys(player.investmentDraft).length === 0) return;
    setInvestmentPrefill((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { ...player.investmentDraft! };
    });
  }, [game.globalRound, game.players, myPlayerId]);

  useEffect(() => {
    const wasReady = prevInvestmentReadyRef.current;
    prevInvestmentReadyRef.current = me?.ready ?? false;
    if (game.phase !== "INVESTMENT" || !wasReady || me?.ready) return;
    const draft = game.players.find((p) => p.id === myPlayerId)?.investmentDraft;
    setInvestmentPrefill(draft ? { ...draft } : {});
  }, [game.phase, me?.ready, game.players, myPlayerId]);

  useEffect(() => {
    if (game.phase !== "INVESTMENT" || me?.ready) return;
    const draft = game.players.find((p) => p.id === myPlayerId)?.investmentDraft;
    if (!draft || Object.keys(draft).length === 0) return;
    setInvestmentPrefill((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { ...draft };
    });
  }, [game.phase, me?.ready, game.players, myPlayerId]);

  const isDesktopLayout = useMediaQuery("(min-width: 768px)", true);
  const isTutorialFitDesktop = useMediaQuery("(min-width: 1024px)", true);

  if (!me) {
    return (
      <div className="page-center" style={{ flexDirection: "column", gap: "1rem" }}>
        <div style={{ fontSize: "3rem" }}>❌</div>
        <div style={{ color: "#f87171", fontWeight: 700 }}>未识别玩家身份，请刷新重试</div>
      </div>
    );
  }

  const isIntro = game.phase === "ERA_INTRO";
  const isTutorial = game.phase === "TUTORIAL";
  const viewportLocked = isIntro || (isTutorial && isTutorialFitDesktop);
  const isRoomWaiting = game.phase === "ROOM_WAITING";
  const showTransactionOverlay = !isIntro && !isRoomWaiting && game.phase !== "TUTORIAL";

  const flushPrefillAndEnterDiscussion = () => {
    socket.emit("syncInvestmentDraft", { investment: investmentPrefill });
    socket.emit("playerReady");
  };

  const renderMainView = () => {
    if (game.phase === "BUFF_USAGE" && (me.ready || buffPrefillOpen)) {
      return (
        <Investment
          game={game}
          me={me}
          mode={me.ready ? "investment" : "discussion"}
          projectImages={projectImages}
          draft={investmentPrefill}
          onDraftChange={setInvestmentPrefill}
          onBackToBuff={() => setBuffPrefillOpen(false)}
        />
      );
    }
    switch (game.phase) {
      case "ROOM_WAITING":  return <RoomWaiting game={game} me={me} onExit={onExit} />;
      case "ERA_INTRO":       return <EraIntro game={game} me={me} eraImages={eraImages} />;
      case "TUTORIAL":        return <TutorialView game={game} me={me} />;
      case "DRAFTING":        return <Drafting game={game} me={me} />;
      case "BUFF_USAGE":      return (
        <BuffUsage
          game={game}
          me={me}
          buffImages={buffImages}
          onOpenInvestmentPrefill={() => setBuffPrefillOpen(true)}
          onEnterDiscussion={flushPrefillAndEnterDiscussion}
        />
      );
      case "INVESTMENT":      return (
        <Investment
          game={game}
          me={me}
          mode="investment"
          projectImages={projectImages}
          draft={investmentPrefill}
          onDraftChange={setInvestmentPrefill}
        />
      );
      case "SETTLEMENT":      return <Settlement game={game} me={me} />;
      case "AUCTION":         return <AuctionView game={game} me={me} buffImages={buffImages} />;
      case "COMMUNITY_NAMING":return <CommunityNaming game={game} me={me} />;
      case "GAME_OVER":       return <GameOver game={game} me={me} />;
      default:
        return (
          <div className="page-center" style={{ minHeight: "100vh", color: "var(--color-text-muted)" }}>
            未知阶段：{game.phase}，请刷新或联系主持
          </div>
        );
    }
  };

  const showHelpSidebar = game.phase !== "TUTORIAL" && game.phase !== "ROOM_WAITING";
  const helpOverlayOnOpen = isIntro && isDesktopLayout;

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        width: "100%",
      }}
    >
      {showHelpSidebar && (
        <PlayerGameHelp
          open={helpOpen}
          onOpenChange={setHelpOpen}
          game={game}
          me={me}
          overlayWhenOpen={helpOverlayOnOpen}
        />
      )}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          position: "relative",
          ...(viewportLocked
            ? { height: "100dvh", maxHeight: "100dvh", overflow: "hidden" }
            : { minHeight: "100vh" }),
        }}
      >
        {renderMainView()}
        {showTransactionOverlay && <PlayerChatSystem game={game} me={me} />}
        <AuctionConfirmModal />
      </div>
    </div>
  );
}
