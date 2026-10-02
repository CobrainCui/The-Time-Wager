import { Server } from "socket.io";

import { GameState, Transaction } from "../state/gameState.js";
import { getPublicCommunityLeaderboard } from "../state/communityLeaderboard.js";
import { peekNextRoundEnergy } from "../logic/energySchedule.js";
import { buildAuctionLotPublicView, publicSessionAuctionWins } from "../logic/auctionCards.js";
import { LIGHTER_CARD_ID, listLighterBurnTargets } from "../logic/buffLogic.js";
import { pendingDeviceClaimsForGodView } from "../logic/deviceClaim.js";

const HIDDEN_INVESTMENT_PHASES = new Set<GameState["phase"]>(["INVESTMENT", "BUFF_USAGE"]);

export function transactionsForViewer(
  transactions: Transaction[],
  viewerPlayerId: string | null | undefined,
  isGodView: boolean
): Transaction[] {
  if (isGodView) return transactions;
  if (!viewerPlayerId) return [];
  return transactions.filter((t) => t.fromId === viewerPlayerId || t.toId === viewerPlayerId);
}

/** 与 broadcastUpdate 一致，供观战首包等单独 emit 使用 */
export function serializeGameForClient(
  game: GameState,
  extra: Record<string, unknown> = {},
  viewerPlayerId?: string | null
) {
  const isGodView = extra.isGodView === true;
  const transactions = transactionsForViewer(game.transactions, viewerPlayerId ?? null, isGodView);
  const {
    sessionTelemetry,
    sessionStartedAt,
    pendingAuctionOffers,
    pendingLotteryOffers,
    lotteryCompletedDeals,
    pendingWealthAdjustments,
    auctionBids,
    auctionCompletedDeals: _auctionCompletedDeals,
    createdByIp: _createdByIp,
    ...gamePublic
  } = game;
  const hideInvestments = HIDDEN_INVESTMENT_PHASES.has(game.phase);
  const ownLotteryOffer =
    !isGodView && viewerPlayerId
      ? (pendingLotteryOffers ?? []).find((o) => o.playerId === viewerPlayerId)
      : undefined;
  const ownWealthAdjust =
    !isGodView && viewerPlayerId
      ? (pendingWealthAdjustments ?? []).find((o) => o.playerId === viewerPlayerId)
      : undefined;
  const lotView = buildAuctionLotPublicView(game);
  const viewerPlayer =
    viewerPlayerId != null ? game.players.find((p) => p.id === viewerPlayerId) : undefined;
  const viewerHasLighter =
    !isGodView && (viewerPlayer?.inventory ?? []).includes(LIGHTER_CARD_ID);

  return {
    ...gamePublic,
    ...lotView,
    auctionSessionWins: publicSessionAuctionWins(game),
    ...(isGodView
      ? {
          pendingAuctionOffers: pendingAuctionOffers ?? [],
          pendingLotteryOffers: pendingLotteryOffers ?? [],
          lotteryCompletedDeals: lotteryCompletedDeals ?? [],
          pendingWealthAdjustments: pendingWealthAdjustments ?? [],
          pendingDeviceClaims: pendingDeviceClaimsForGodView(game),
          auctionCompletedDeals: game.auctionCompletedDeals ?? [],
          auctionBids: auctionBids ?? [],
        }
      : {
          ...(ownLotteryOffer ? { pendingLotteryOffer: ownLotteryOffer } : {}),
          ...(ownWealthAdjust ? { pendingWealthAdjustment: ownWealthAdjust } : {}),
        }),
    readyPlayers: Array.from(game.readyPlayers),
    phaseFinished: Array.from(game.phaseFinished),
    drawnProjects: Array.from(game.drawnProjects),
    players: game.players.map((p) => {
      const {
        socketId: _socketId,
        reconnectToken: _reconnectToken,
        preSubmitInvestmentDraft: _preSubmit,
        receivedRoundEnergy: _receivedRoundEnergy,
        buffRoundNotes,
        pendingSlackHits,
        inventory,
        activeBuffs,
        usedCards,
        // 旧局内存可能仍带幽灵字段，避免漏进玩家 payload
        lighterBurnGhostIds: _lighterBurnGhostIds,
        ...rest
      } = p as typeof p & { lighterBurnGhostIds?: string[] };
      const visibleToViewer = isGodView || p.id === viewerPlayerId;
      if (visibleToViewer) {
        return {
          ...rest,
          inventory,
          activeBuffs,
          usedCards,
          // 本轮道具短记录仅本人（或上帝）可见
          buffRoundNotes: buffRoundNotes ?? [],
          pendingSlackHits: pendingSlackHits ?? [],
          investmentDraft: p.investmentDraft,
          investment: p.investment,
          coffeePurchasesThisRound: p.coffeePurchasesThisRound ?? 0,
        };
      }
      return {
        ...rest,
        // 他人手牌 / 已发动 / 已用对玩家隐藏；持打火机时仅下发拍卖成交卡种列表
        buffRoundNotes: undefined,
        pendingSlackHits: undefined,
        investmentDraft: undefined,
        investment: hideInvestments ? {} : p.investment,
        coffeePurchasesThisRound: p.coffeePurchasesThisRound ?? 0,
        ...(viewerHasLighter && p.id !== viewerPlayerId
          ? { burnableCardIds: listLighterBurnTargets(game, p.id) }
          : {}),
      };
    }),
    transactions,
    serverNow: Date.now(),
    nextRoundEnergy: peekNextRoundEnergy(game),
    // 倒计时控场：显式下发，避免后续序列化改动漏字段导致 Admin/玩家不同步
    investmentEndsAt: game.investmentEndsAt,
    investmentTimerPausedAt: game.investmentTimerPausedAt,
    ...extra,
    globalLeaderboard: getPublicCommunityLeaderboard(),
  };
}

export function broadcastUpdate(io: Server, game: GameState) {
  const memberIds = io.sockets.adapter.rooms.get(game.roomId);
  if (!memberIds) return;

  for (const socketId of memberIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;

    const player = game.players.find((p) => p.socketId === socket.id);
    const isGodView = socket.data.isSuperAdmin === true;

    socket.emit(
      "gameUpdate",
      serializeGameForClient(game, isGodView ? { isGodView: true } : {}, player?.id ?? null)
    );
  }
}
