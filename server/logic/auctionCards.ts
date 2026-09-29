import { randomUUID } from "node:crypto";
import { AuctionOffer, GameState } from "../state/gameState.js";

export const AUCTION_CARD_IDS_BY_ROUND: Record<number, string[]> = {
  1: ["buff_gold", "buff_short"],
  2: ["buff_slack", "buff_rebound", "buff_insurance"],
  3: ["buff_spirit", "buff_lottery"],
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
  game.auctionCompletedDeals = [];
  game.pendingAuctionOffers = [];
}

export function recordAuctionCompletedDeal(
  game: GameState,
  cardId: string,
  playerId: string,
  cost: number
): void {
  if (!game.auctionCompletedDeals) game.auctionCompletedDeals = [];
  game.auctionCompletedDeals = game.auctionCompletedDeals.filter((d) => d.cardId !== cardId);
  game.auctionCompletedDeals.push({ cardId, playerId, cost });
}

export function unmarkAuctionCardDistributed(game: GameState, cardId: string): void {
  game.auctionDistributedCardIds = (game.auctionDistributedCardIds || []).filter((id) => id !== cardId);
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

export function isValidAuctionCost(cost: unknown): cost is number {
  return typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0;
}

/** 同一张卡同一时间只保留一条待确认报价，新报价覆盖旧报价 */
export function createAuctionOffer(
  game: GameState,
  playerId: string,
  cardId: string,
  cost: number
): { offer: AuctionOffer; replaced?: AuctionOffer } {
  const pending = game.pendingAuctionOffers ?? [];
  const replaced = pending.find((o) => o.cardId === cardId);
  const offer: AuctionOffer = { offerId: randomUUID(), playerId, cardId, cost };
  game.pendingAuctionOffers = pending.filter((o) => o.cardId !== cardId);
  game.pendingAuctionOffers.push(offer);
  return { offer, replaced };
}

/**
 * 玩家回应前的拒绝原因。通过时取出报价；拒绝时不改动待确认列表（阶段不对除外：报价已结束则一并清空）。
 */
export function claimAuctionResponse(
  game: GameState,
  playerId: string,
  offerId: unknown,
  accept: boolean
): { ok: true; cardId: string; cost: number } | { ok: false; message: string } {
  if (game.phase !== "AUCTION") {
    return { ok: false, message: "拍卖已结束，交易失效" };
  }
  const offer = takeAuctionOffer(game, offerId, playerId);
  if (!offer) {
    return { ok: false, message: "拍卖报价已失效" };
  }
  if (accept && !isAuctionCardAvailable(game, offer.cardId)) {
    return { ok: false, message: "该道具已被拍走，交易失效" };
  }
  if (accept && !isValidAuctionCost(offer.cost)) {
    return { ok: false, message: "拍卖价格无效" };
  }
  return { ok: true, cardId: offer.cardId, cost: offer.cost };
}

/** 取出并作废属于该玩家的报价；不匹配时返回 undefined */
export function takeAuctionOffer(
  game: GameState,
  offerId: unknown,
  playerId: string
): AuctionOffer | undefined {
  if (typeof offerId !== "string" || !offerId) return undefined;
  const offers = game.pendingAuctionOffers ?? [];
  const idx = offers.findIndex((o) => o.offerId === offerId && o.playerId === playerId);
  if (idx === -1) return undefined;
  const [offer] = offers.splice(idx, 1);
  return offer;
}

export function clearAuctionOffers(game: GameState): void {
  game.pendingAuctionOffers = [];
}

export type RevokeAuctionGrantResult =
  | { ok: true; kind: "pending"; playerId: string; offerId: string }
  | { ok: true; kind: "completed"; playerId: string; cost: number }
  | { ok: false; message: string };

function revokeCompletedAuctionGrant(
  game: GameState,
  cardId: string
): { ok: true; playerId: string; cost: number } | { ok: false; message: string } {
  if (!(game.auctionDistributedCardIds || []).includes(cardId)) {
    return { ok: false, message: "该道具没有待确认或已成交记录" };
  }
  const deal = (game.auctionCompletedDeals ?? []).find((d) => d.cardId === cardId);
  if (!deal) {
    return { ok: false, message: "找不到成交记录，无法撤销" };
  }
  const player = game.players.find((p) => p.id === deal.playerId);
  if (!player) {
    return { ok: false, message: "得主不存在" };
  }
  const invIdx = player.inventory.indexOf(cardId);
  if (invIdx === -1) {
    return { ok: false, message: "玩家手牌中已无该道具，无法撤销" };
  }
  player.inventory.splice(invIdx, 1);
  player.wealth += deal.cost;
  unmarkAuctionCardDistributed(game, cardId);
  game.auctionCompletedDeals = (game.auctionCompletedDeals ?? []).filter((d) => d.cardId !== cardId);
  game.pendingAuctionOffers = (game.pendingAuctionOffers ?? []).filter((o) => o.cardId !== cardId);
  return { ok: true, playerId: deal.playerId, cost: deal.cost };
}

/**
 * 撤回发放：待确认则取消报价；已成交则退款并收手牌。仅拍卖阶段有效。
 */
export function revokeAuctionGrant(game: GameState, cardId: string): RevokeAuctionGrantResult {
  if (game.phase !== "AUCTION") {
    return { ok: false, message: "仅拍卖阶段可撤销发放" };
  }
  const pool = getAuctionCardIdsForGame(game);
  if (!pool.includes(cardId)) {
    return { ok: false, message: "该道具不在本场拍卖池" };
  }

  const offers = game.pendingAuctionOffers ?? [];
  const pendingIdx = offers.findIndex((o) => o.cardId === cardId);
  if (pendingIdx >= 0) {
    const [offer] = offers.splice(pendingIdx, 1);
    game.pendingAuctionOffers = offers;
    return { ok: true, kind: "pending", playerId: offer.playerId, offerId: offer.offerId };
  }

  const completed = revokeCompletedAuctionGrant(game, cardId);
  if (!completed.ok) return completed;
  return { ok: true, kind: "completed", playerId: completed.playerId, cost: completed.cost };
}

/** @deprecated 使用 revokeAuctionGrant */
export function revokeAuctionDistribution(
  game: GameState,
  cardId: string
): { ok: true; playerId: string; cost: number } | { ok: false; message: string } {
  const result = revokeAuctionGrant(game, cardId);
  if (!result.ok) return result;
  if (result.kind === "pending") {
    return { ok: false, message: "该道具尚未成交" };
  }
  return { ok: true, playerId: result.playerId, cost: result.cost };
}
