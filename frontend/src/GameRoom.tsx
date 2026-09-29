import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import { uiRem } from "./utils/typography";
import { GameState } from "./types";
import { EraIntro } from "./views/EraIntro";
import { Investment } from "./views/Investment";
import { Settlement } from "./views/Settlement";
import { CommunityNaming } from "./views/CommunityNaming";
import { TutorialView } from "./views/TutorialView";
import { BuffUsage } from "./views/BuffUsage";
import { AuctionView } from "./views/AuctionView";
import { RoomWaiting } from "./views/RoomWaiting";
import { socket } from "./socket";
import { PlayerChatSystem } from "./components/playerChat/PlayerChatSystem";
import { AuctionConfirmModal } from "./components/AuctionConfirmModal";
import { LotteryConfirmModal } from "./components/LotteryConfirmModal";
import { PlayerGameHelp } from "./components/PlayerGameHelp";
import { LeaveGameButton } from "./components/LeaveGameButton";
import { useMediaQuery } from "./hooks/useMediaQuery";

const GameOver = lazy(() =>
  import("./views/GameOver").then((m) => ({ default: m.GameOver }))
);

interface Props {
  game: GameState;
  myPlayerId: string;
  onExit?: () => void;
  projectImages?: Record<number, number>;
  eraImages?: Record<string, number>;
  buffImages?: Record<string, number>;
  personaImages?: Record<string, number>;
}

// ——— 主 GameRoom ———
export default function GameRoom({ game, myPlayerId, onExit, projectImages = {}, eraImages = {}, buffImages = {}, personaImages = {} }: Props) {
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
        {onExit && <LeaveGameButton phase={game.phase} onExit={onExit} />}
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
          onEnterDiscussion={flushPrefillAndEnterDiscussion}
        />
      );
    }
    switch (game.phase) {
      case "ROOM_WAITING":  return <RoomWaiting game={game} me={me} />;
      case "ERA_INTRO":       return <EraIntro game={game} me={me} eraImages={eraImages} />;
      case "TUTORIAL":        return <TutorialView game={game} me={me} />;
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
      case "GAME_OVER":       return (
        <Suspense fallback={<div className="page-center" style={{ minHeight: "40vh", color: "var(--color-text-muted)" }}>加载终局…</div>}>
          <GameOver game={game} me={me} personaImages={personaImages} />
        </Suspense>
      );
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
      {onExit && <LeaveGameButton phase={game.phase} onExit={onExit} />}
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
        <AuctionConfirmModal phase={game.phase} />
        <LotteryConfirmModal pending={game.pendingLotteryOffer ?? null} wealth={me?.wealth ?? 0} />
      </div>
    </div>
  );
}
