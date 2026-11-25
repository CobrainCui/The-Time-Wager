import type { GameState } from "../state/gameState.js";
import { isAiPlayer } from "./isAiPlayer.js";

/** 房间里是否还有在线真人。自动主持只在没有在线真人时才允许自动推进阶段。 */
export function hasConnectedHuman(game: GameState): boolean {
  return game.players.some((p) => p.connected && !isAiPlayer(p));
}
