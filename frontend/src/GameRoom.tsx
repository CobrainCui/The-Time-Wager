import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
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
import { SlackHitConfirmModal } from "./components/SlackHitConfirmModal";
import { PlayerGameHelp } from "./components/PlayerGameHelp";
import { LeaveGameButton } from "./components/LeaveGameButton";
import { BuffInvestmentSplit } from "./components/BuffInvestmentSplit";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { PERSONA_IMAGE_SLUGS } from "./config/personaConfig";
import {
  getPersonaDefaultImageSrc,
  getPersonaImageDisplay,
} from "./utils/gameImageDisplay";

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

export default function GameRoom({ game, myPlayerId, onExit, projectImages = {}, eraImages = {}, buffImages = {}, personaImages = {} }: Props) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [investmentPrefill, setInvestmentPrefill] = useState<Record<number, number>>({});
  const prefillRoundRef = useRef(game.globalRound);
  const prevInvestmentReadyRef = useRef(false);
  const me = game.players.find((p) => p.id === myPlayerId);

  /** 命名/终局前提前预热立绘，避免 lazy 终局首屏才请求被中断 */
  useEffect(() => {
    if (game.phase !== "COMMUNITY_NAMING" && game.phase !== "GAME_OVER") return;
    if (game.phase === "COMMUNITY_NAMING") {
      void import("./views/GameOver");
    }
    for (const slug of PERSONA_IMAGE_SLUGS) {
      const img = new Image();
      img.src = getPersonaDefaultImageSrc(slug);
    }
    const persona = me?.analysisResult?.primaryPersona;
    if (persona) {
      const display = getPersonaImageDisplay(persona, personaImages);
      const img = new Image();
      img.src = display.src;
    }
  }, [game.phase, me?.analysisResult?.primaryPersona, personaImages]);

  /** 第二时代起：投资阶段内分段切换道具 / 投资（默认投资） */
  const useSplit =
    game.currentEra >= 2 &&
    (game.phase === "INVESTMENT" || game.phase === "BUFF_USAGE");

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

  const isDesktopLayout = useMediaQuery("(min-width: 1024px)", true);
  const isTutorialFitDesktop = useMediaQuery("(min-width: 1024px)", false);

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
  // 仅教程锁单视口；时代介绍内容超出时需整页滚动
  const viewportLocked = isTutorialFitDesktop && isTutorial;
  const isRoomWaiting = game.phase === "ROOM_WAITING";
  const showTransactionOverlay = !isIntro && !isRoomWaiting && game.phase !== "TUTORIAL";

  const renderSplitView = () => (
    <BuffInvestmentSplit
      game={game}
      left={
        <BuffUsage
          game={game}
          me={me}
          buffImages={buffImages}
          hideDock
          readOnly={!!me.ready}
        />
      }
      right={
        <Investment
          game={game}
          me={me}
          mode="investment"
          projectImages={projectImages}
          draft={investmentPrefill}
          onDraftChange={setInvestmentPrefill}
          hideCountdown
        />
      }
    />
  );

  const renderMainView = () => {
    if (useSplit) return renderSplitView();

    switch (game.phase) {
      case "ROOM_WAITING":  return <RoomWaiting game={game} me={me} />;
      case "ERA_INTRO":       return <EraIntro game={game} me={me} eraImages={eraImages} />;
      case "TUTORIAL":        return <TutorialView game={game} me={me} />;
      case "BUFF_USAGE":
        // 遗留阶段：无分屏时仍给投资页，避免卡在旧闸门
        return (
          <Investment
            game={game}
            me={me}
            mode="investment"
            projectImages={projectImages}
            draft={investmentPrefill}
            onDraftChange={setInvestmentPrefill}
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
        <AuctionConfirmModal
          phase={game.phase}
          pending={game.pendingAuctionOffer ?? null}
          pendingOffers={game.myPendingAuctionOffers ?? null}
          wealth={me?.wealth ?? 0}
        />
        <LotteryConfirmModal
          pending={game.pendingLotteryOffer ?? null}
          wealth={me?.wealth ?? 0}
          hasGoldBuff={!!me?.activeBuffs?.some((b) => b.cardId === "buff_gold")}
        />
        <SlackHitConfirmModal hits={me.pendingSlackHits} />
      </div>
    </div>
  );
}
