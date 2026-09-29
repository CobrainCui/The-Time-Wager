import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAuctionOffer,
  isAuctionCardAvailable,
  markAuctionCardDistributed,
  recordAuctionCompletedDeal,
  revokeAuctionGrant,
} from "./auctionCards.js";
import { createInitialGame, Player } from "../state/gameState.js";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    socketId: "sock",
    energy: 10,
    wealth: 100,
    connected: true,
    ready: false,
    rank: 1,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 0,
    wealthHistory: [100],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    ...overrides,
  };
}

describe("revokeAuctionGrant", () => {
  it("refunds wealth, removes card, and reopens pool when completed", () => {
    const game = createInitialGame("room", []);
    game.phase = "AUCTION";
    game.currentEra = 2;
    const p = player("p1", { wealth: 80, inventory: ["buff_gold"] });
    game.players = [p];
    markAuctionCardDistributed(game, "buff_gold");
    recordAuctionCompletedDeal(game, "buff_gold", "p1", 20);

    const result = revokeAuctionGrant(game, "buff_gold");
    assert.equal(result.ok, true);
    if (!result.ok || result.kind !== "completed") throw new Error("expected completed revoke");
    assert.equal(p.wealth, 100);
    assert.deepEqual(p.inventory, []);
    assert.equal(isAuctionCardAvailable(game, "buff_gold"), true);
    assert.equal(game.auctionCompletedDeals?.length, 0);
  });

  it("cancels pending offer and keeps card available", () => {
    const game = createInitialGame("room", []);
    game.phase = "AUCTION";
    game.currentEra = 2;
    game.players = [player("p1")];
    createAuctionOffer(game, "p1", "buff_gold", 15);
    assert.equal(game.pendingAuctionOffers?.length, 1);

    const result = revokeAuctionGrant(game, "buff_gold");
    assert.equal(result.ok, true);
    if (!result.ok || result.kind !== "pending") throw new Error("expected pending revoke");
    assert.equal(game.pendingAuctionOffers?.length, 0);
    assert.equal(isAuctionCardAvailable(game, "buff_gold"), true);

    createAuctionOffer(game, "p1", "buff_gold", 20);
    assert.equal(game.pendingAuctionOffers?.[0]?.cost, 20);
  });

  it("rejects outside auction phase", () => {
    const game = createInitialGame("room", []);
    game.phase = "INVESTMENT";
    game.currentEra = 2;
    markAuctionCardDistributed(game, "buff_gold");
    recordAuctionCompletedDeal(game, "buff_gold", "p1", 10);
    const result = revokeAuctionGrant(game, "buff_gold");
    assert.equal(result.ok, false);
  });
});
