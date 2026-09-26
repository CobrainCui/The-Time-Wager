import { GameState } from "./gameState.js";

/** 投资阶段操作倒计时（10 分钟） */
export const ACTION_DEADLINE_MS = 10 * 60 * 1000;

export function clearActionDeadline(game: GameState): void {
  game.investmentEndsAt = undefined;
  game.buffPhaseEndsAt = undefined;
}

/** 仅在 INVESTMENT 阶段开表（全员离开道具阶段后） */
export function startInvestmentDeadline(game: GameState): void {
  if (game.phase !== "INVESTMENT") {
    console.warn(
      `startInvestmentDeadline ignored: expected INVESTMENT, got ${game.phase}`
    );
    return;
  }
  clearActionDeadline(game);
  game.investmentEndsAt = Date.now() + ACTION_DEADLINE_MS;
}
