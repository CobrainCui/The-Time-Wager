import { Server } from "socket.io";

import { GameState, Transaction } from "../state/gameState.js";
import { getPublicCommunityLeaderboard } from "../state/communityLeaderboard.js";
import { peekNextRoundEnergy } from "../logic/energySchedule.js";

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
    createdByIp: _createdByIp,
    ...gamePublic
  } = game;
  const hideInvestments = HIDDEN_INVESTMENT_PHASES.has(game.phase);
  const ownLotteryOffer =
    !isGodView && viewerPlayerId
      ? (pendingLotteryOffers ?? []).find((o) => o.playerId === viewerPlayerId)
      : undefined;

  return {
    ...gamePublic,
    ...(isGodView
      ? {
          pendingAuctionOffers: pendingAuctionOffers ?? [],
          pendingLotteryOffers: pendingLotteryOffers ?? [],
          lotteryCompletedDeals: lotteryCompletedDeals ?? [],
        }
      : ownLotteryOffer
        ? { pendingLotteryOffer: ownLotteryOffer }
        : {}),
    readyPlayers: Array.from(game.readyPlayers),
    phaseFinished: Array.from(game.phaseFinished),
    drawnProjects: Array.from(game.drawnProjects),
    players: game.players.map((p) => {
      const {
        socketId: _socketId,
        reconnectToken: _reconnectToken,
        preSubmitInvestmentDraft: _preSubmit,
        receivedRoundEnergy: _receivedRoundEnergy,
        ...rest
      } = p;
      const visibleToViewer = isGodView || p.id === viewerPlayerId;
      return {
        ...rest,
        investmentDraft: visibleToViewer ? p.investmentDraft : undefined,
        investment: visibleToViewer || !hideInvestments ? p.investment : {},
        coffeePurchasesThisRound: p.coffeePurchasesThisRound ?? 0,
      };
    }),
    transactions,
    serverNow: Date.now(),
    nextRoundEnergy: peekNextRoundEnergy(game),
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
