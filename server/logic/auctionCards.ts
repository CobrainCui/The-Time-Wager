import { GameState } from "../state/gameState.js";

export const AUCTION_CARD_IDS_BY_ROUND: Record<number, string[]> = {
  1: ["buff_gold", "buff_short"],
  2: ["buff_slack", "buff_rebound", "buff_insurance"],
  3: ["buff_spirit", "buff_swap", "buff_lottery"],
};

export function getAuctionRound(game: GameState): number {
  return Math.max(1, Math.min(game.currentEra - 1, 3));
}

export function getAuctionCardIdsForGame(game: GameState): string[] {
  const round = getAuctionRound(game);
  return AUCTION_CARD_IDS_BY_ROUND[round] || AUCTION_CARD_IDS_BY_ROUND[1];
}

export function beginAuctionSession(game: GameState): void {
  game.auctionDistributedCardIds = [];
}

export function markAuctionCardDistributed(game: GameState, cardId: string): void {
  if (!game.auctionDistributedCardIds) game.auctionDistributedCardIds = [];
  if (!game.auctionDistributedCardIds.includes(cardId)) {
    game.auctionDistributedCardIds.push(cardId);
  }
}

export function isAuctionCardAvailable(game: GameState, cardId: string): boolean {
  const pool = getAuctionCardIdsForGame(game);
  if (!pool.includes(cardId)) return false;
  return !(game.auctionDistributedCardIds || []).includes(cardId);
}
