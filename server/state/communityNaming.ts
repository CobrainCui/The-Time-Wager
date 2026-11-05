import type { Server } from "socket.io";
import type { GameState } from "./gameState.js";
import { analyzeGamePersona } from "../logic/analysisLogic.js";
import { appendSessionEvent, recordPhaseChange } from "./sessionTelemetry.js";
import { archiveCompletedSession } from "./sessionArchive.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { broadcastLeaderboardToAllRooms } from "./communityLeaderboard.js";

/**
 * 社区命名的唯一收口：玩家提交、主持代命名、AI 首富命名、自动主持兜底都走这里。
 * io 允许为 null，便于单测在没有 Socket.IO 的情况下验证状态流转。
 */
export function finalizeCommunityName(
  io: Server | null,
  game: GameState,
  communityName: string,
  source: string
): void {
  if (game.communityName) return;
  const prevPhase = game.phase;
  game.communityName = communityName;
  game.phase = "GAME_OVER";
  game.autoHostNextActionAt = undefined;
  analyzeGamePersona(game);
  appendSessionEvent(game, "community_named", { communityName, source });
  recordPhaseChange(game, prevPhase, game.phase, source);
  archiveCompletedSession(game);
  if (io) {
    broadcastUpdate(io, game);
    broadcastLeaderboardToAllRooms(io);
  }
}
