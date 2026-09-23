import { Server } from "socket.io";

import { GameState, Transaction } from "../state/gameState.js";
import { getCommunityLeaderboard } from "../state/communityLeaderboard.js";



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

  const { sessionTelemetry, sessionStartedAt, ...gamePublic } = game;

  return {

    ...gamePublic,

    readyPlayers: Array.from(game.readyPlayers),

    phaseFinished: Array.from(game.phaseFinished),

    drawnProjects: Array.from(game.drawnProjects),

    players: game.players.map((p) => {

      const { socketId, ...rest } = p;

      return rest;

    }),

    transactions,

    ...extra,

    globalLeaderboard: getCommunityLeaderboard(),

  };

}



export function broadcastUpdate(io: Server, game: GameState) {

  for (const socket of io.sockets.sockets.values()) {

    if (!socket.rooms.has(game.roomId)) continue;

    const player = game.players.find((p) => p.socketId === socket.id);

    const isGodView = socket.data.isSuperAdmin === true && !player;

    socket.emit(
      "gameUpdate",
      serializeGameForClient(game, isGodView ? { isGodView: true } : {}, player?.id ?? null)
    );

  }

}


