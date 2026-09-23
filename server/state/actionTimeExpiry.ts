import { GameState } from "./gameState.js";
import {
  togglePlayerReady,
  forceSubmitPendingInvestments,
  playersRequiringAction,
} from "./gameActions.js";
import { tryAdvancePhase } from "./phaseController.js";

/** 讨论+道具+投资共用倒计时结束 */
export function handleActionTimeExpired(game: GameState): boolean {
  if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return false;
  if (!game.investmentEndsAt || Date.now() < game.investmentEndsAt) return false;

  game.investmentEndsAt = undefined;
  game.buffPhaseEndsAt = undefined;

  if (game.phase === "BUFF_USAGE") {
    for (const p of playersRequiringAction(game)) {
      if (!p.ready) togglePlayerReady(game, p.id);
    }
    tryAdvancePhase(game);
  }

  if (game.phase === "INVESTMENT") {
    forceSubmitPendingInvestments(game);
    tryAdvancePhase(game);
  }

  return true;
}
