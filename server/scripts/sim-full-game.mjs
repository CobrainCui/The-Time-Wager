/**
 * End-to-End 8-Round Live DeepSeek Full-Game Simulation
 * Tests:
 * - Full 8 rounds (4 Eras x 2 Rounds) + 3 Auctions + Community Naming + Game Over
 * - 1 Strong Heuristic Human vs 5 Live DeepSeek AIs (hard/normal/normal/hard/easy)
 * - Live DM, 1-yuan transfer, Public Chat, Custom Group Welcome & Chat, Slack Unlock
 * - Strategy, Token usage, Latency, Auction prices, Long >=3 & Risk clawback discipline
 *
 * Usage:
 *   node scripts/sim-full-game.mjs
 *   node scripts/sim-full-game.mjs --fast    # AI_DISABLE_THINKING=true A/B test
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(serverRoot, ".env"), quiet: true });

const fastMode = process.argv.includes("--fast");
process.env.AI_STRICT_AGENT = "true";
process.env.AI_DISABLE_THINKING = fastMode ? "true" : "false";
// Keep script brisk by trimming pure cosmetic chat/auction artificial sleeps slightly while keeping transfer delay testable
process.env.AI_ACTION_DELAY_MIN_MS = "100";
process.env.AI_ACTION_DELAY_MAX_MS = "250";
process.env.AI_AUCTION_DELAY_MIN_MS = "150";
process.env.AI_AUCTION_DELAY_MAX_MS = "350";

const { createInitialGame } = await import("../dist/state/gameState.js");
const { addAiPlayer } = await import("../dist/ai/aiRoster.js");
const { verifyAiAgents, applyAiPreflightToGame } = await import("../dist/ai/aiPreflight.js");
const { startGameNow } = await import("../dist/state/gameStart.js");
const { tryAdvancePhase } = await import("../dist/state/phaseController.js");
const { togglePlayerReady } = await import("../dist/state/gameActions.js");
const {
  handleAIPhase,
  ensureAiProgress,
  ensureAiCommunityNaming,
  handleAiDirectMessage,
  handleAiGroupMessage,
  handleAiGroupCreated,
  hasAiTurnInFlight,
  aiRoomDiagnostics,
  forgetAiRoom,
} = await import("../dist/ai/aiOrchestrator.js");
const {
  ensureAutoHost,
  syncAutoAuctionDeadline,
  resetAutoHostState,
} = await import("../dist/host/autoHost.js");
const {
  applyInvestments,
  sanitizeInvestments,
  spendableEnergy,
} = await import("../dist/logic/investmentLogic.js");
const { purchaseCoffee, COFFEE_WEALTH_COST } = await import("../dist/logic/coffeeLogic.js");
const { useBuffCard, useForceBuyCard } = await import("../dist/logic/buffLogic.js");
const { acceptLotteryOffer, createRandomLotteryOffer, hasLotteryDrawInFlight } = await import("../dist/logic/lotteryDraw.js");
const { placeAuctionBid, getMinimumNextBid, getLeadingBidOnFocus, playerAvailableWealth } = await import("../dist/logic/auctionCards.js");
const { createCustomChatGroup, sendGroupChatMessage, syncChatGroupsOnRosterChange } = await import("../dist/logic/chatGroups.js");
const { resolvePendingTransfer } = await import("../dist/logic/transferResolve.js");
const { resolveAiModelConfigForSlot } = await import("../dist/ai/aiConfig.js");
const { setGameIo } = await import("../dist/network/gameIo.js");

const cfg = resolveAiModelConfigForSlot(1);
if (!cfg) {
  console.error("❌ No AI model configured; aborting simulation.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(pred, timeoutMs = 180_000, pollMs = 200, onTick = null) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return Date.now() - start;
    if (onTick) onTick();
    await sleep(pollMs);
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

function makeMockIo() {
  const events = [];
  const io = {
    to(target) {
      return {
        emit(event, payload) {
          events.push({ target, event, payload, at: Date.now() });
        },
      };
    },
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
  };
  return { io, events };
}

/** Strong human heuristic operating strictly with human-visible information */
function runStrongHumanInvestment(game, human, io) {
  const availWealth = () => playerAvailableWealth(game, human);
  // Accept any incoming transfers from AI if >=0
  for (const tx of game.transactions) {
    if (tx.status === "pending" && tx.toId === human.id) {
      resolvePendingTransfer(game, tx.id, human.id, "accept");
    }
  }

  // Use buff cards strategically (e.g. lottery on Round 7/8 or paired w/ gold; insurance if risk exposure; slack on leader)
  const useCard = (cardId, extra = {}) => {
    if (!human.inventory.includes(cardId)) return false;
    const res = useBuffCard(game, human.id, cardId, extra);
    if (res.success) {
      if (!human.usedCards) human.usedCards = [];
      human.usedCards.push(cardId);
      if (cardId === "buff_lottery") {
        void createRandomLotteryOffer(game, human.id).then((r) => {
          if (r.ok) acceptLotteryOffer(game, human.id, r.offer.offerId);
        });
      }
      if (res.investmentAutoUnlocked && res.notifyTargetId) {
        const tgt = game.players.find((p) => p.id === res.notifyTargetId);
        if (tgt?.isAI) void handleAIPhase(game, io);
      }
      return true;
    }
    return false;
  };

  // Combo: work_rest(self) + slack(self) -> +8 energy
  if (human.inventory.includes("buff_work_rest") && human.inventory.includes("buff_slack")) {
    useCard("buff_work_rest", { targetPlayerId: human.id });
    useCard("buff_slack", { targetPlayerId: human.id });
  } else if (human.inventory.includes("buff_slack")) {
    // Slack highest-wealth opponent
    const leader = [...game.players]
      .filter((p) => p.id !== human.id)
      .sort((a, b) => b.wealth - a.wealth)[0];
    if (leader) useCard("buff_slack", { targetPlayerId: leader.id });
  }
  if (human.inventory.includes("buff_insurance")) {
    const expSum = Object.values(human.riskGains ?? {}).reduce((s, v) => s + v, 0);
    if (expSum >= 60 || game.globalRound >= 7) useCard("buff_insurance");
  }
  if (human.inventory.includes("buff_lottery") && (game.globalRound >= 7 || human.inventory.includes("buff_gold"))) {
    useCard("buff_gold");
    useCard("buff_lottery", { visibility: "private" });
  } else if (human.inventory.includes("buff_gold") && game.globalRound >= 6) {
    useCard("buff_gold");
  }

  // Buy coffee if safe high-ROI risk (>=20/energy) or big finishing long has headroom
  const roundsLeft = Math.max(0, 8 - game.globalRound);
  const safeRiskHeadroom = game.activeProjects
    .filter((p) => p.type === "risk")
    .reduce((s, p) => s + Math.max(0, p.maxEnergy - p.accumulatedInvested - 2), 0);
  if ((safeRiskHeadroom >= 2 || human.activeBuffs.some((b) => b.cardId === "buff_gold")) && availWealth() >= COFFEE_WEALTH_COST + 15) {
    purchaseCoffee(game, human);
    if (availWealth() >= COFFEE_WEALTH_COST + 25) purchaseCoffee(game, human);
  }

  let budget = spendableEnergy(human);
  const allocation = {};
  const addAlloc = (id, amt) => {
    const a = Math.min(budget, Math.max(0, Math.floor(amt)));
    if (a <= 0) return 0;
    allocation[id] = (allocation[id] ?? 0) + a;
    budget -= a;
    return a;
  };

  // 1) Mandatory active long >=3 continuation!
  for (const p of game.activeProjects) {
    if (p.type !== "long") continue;
    if (human.longTerm?.[p.id]?.status === "active" && budget >= 3) {
      const want = Math.max(3, Math.min(budget, Math.ceil((p.maxEnergy - p.accumulatedInvested) / Math.max(1, roundsLeft + 1))));
      addAlloc(p.id, want);
    }
  }

  // 2) Safe risk energy if ample headroom (avoid risk爆)
  for (const p of game.activeProjects) {
    if (p.type !== "risk" || budget <= 0) continue;
    const room = p.maxEnergy - p.accumulatedInvested;
    const myExp = human.riskGains?.[p.id] ?? 0;
    // Leave buffer for other bidders unless tiny exposure or last round of era
    const safeRoom = myExp > 0 ? Math.max(0, room - 3) : Math.max(0, room - 2);
    if (safeRoom >= 2) {
      addAlloc(p.id, Math.min(safeRoom, game.roundInEra === 2 ? 5 : 3));
    }
  }

  // 3) Early/mid matching-era long if feasible to complete by R8
  if (roundsLeft >= 3 && budget >= 4) {
    const goodLong = game.activeProjects
      .filter((p) => p.type === "long" && p.era && game.currentEraCard?.era === p.era && !human.longTerm?.[p.id])
      .sort((a, b) => (a.maxEnergy - a.accumulatedInvested) - (b.maxEnergy - b.accumulatedInvested))[0];
    if (goodLong) addAlloc(goodLong.id, Math.min(5, budget));
  }

  // 4) Best short project with good room (>=5) and matching era bonus
  const shorts = game.activeProjects
    .filter((p) => p.type === "short" && p.maxEnergy - p.accumulatedInvested >= 4)
    .sort((a, b) => {
      const aMatch = a.era === game.currentEraCard?.era ? 50 : 0;
      const bMatch = b.era === game.currentEraCard?.era ? 50 : 0;
      const aScore = (a.rankRewards?.[0] ?? 0) + aMatch + (a.maxEnergy - a.accumulatedInvested);
      const bScore = (b.rankRewards?.[0] ?? 0) + bMatch + (b.maxEnergy - b.accumulatedInvested);
      return bScore - aScore;
    });
  for (const s of shorts) {
    if (budget <= 0) break;
    const room = s.maxEnergy - s.accumulatedInvested;
    // Cap bet slightly below remaining headroom so AIs don't accidentally detonate us every round
    const maxSafe = room >= 12 ? budget : Math.max(2, Math.floor(room * 0.55));
    addAlloc(s.id, maxSafe);
  }

  // Dump any remaining energy into safest open long or short
  if (budget > 0) {
    const fallbackProj =
      game.activeProjects.find((p) => p.type === "long" && (human.longTerm?.[p.id]?.status === "active" || roundsLeft >= 2)) ??
      game.activeProjects
        .filter((p) => p.maxEnergy - p.accumulatedInvested > 0)
        .sort((a, b) => (b.maxEnergy - b.accumulatedInvested) - (a.maxEnergy - a.accumulatedInvested))[0];
    if (fallbackProj) addAlloc(fallbackProj.id, budget);
  }

  const sanitized = sanitizeInvestments(game, human, allocation);
  applyInvestments(game, human.id, sanitized, "player");
  if (!human.ready) togglePlayerReady(game, human.id);
}

function strongHumanAuctionBid(game, human) {
  const focus = game.auctionFocusCardId;
  if (!focus) return false;
  const leading = getLeadingBidOnFocus(game);
  if (leading?.playerId === human.id) return false;
  if (human.inventory.includes("buff_force_buy") && (focus === "buff_lottery" || focus === "buff_gold")) {
    return useForceBuyCard(game, human.id).success;
  }
  const hasGold = human.inventory.includes("buff_gold");
  const valuation = {
    buff_gold: 60,
    buff_lottery: hasGold ? 85 : 55,
    buff_force_buy: 65,
    buff_work_rest: 40,
    buff_slack: 40,
    buff_short: 45,
    buff_insurance: Object.keys(human.riskGains ?? {}).length > 0 ? 50 : 25,
    buff_lighter: 25,
  }[focus] ?? 30;
  const minNext = getMinimumNextBid(game);
  const avail = playerAvailableWealth(game, human, { exceptOwnLeading: true });
  if (minNext <= valuation && avail - minNext >= 15) {
    const res = placeAuctionBid(game, human.id, minNext);
    if (res.ok) {
      syncAutoAuctionDeadline(game);
      return true;
    }
  }
  return false;
}

const { io } = makeMockIo();
setGameIo(io);
const game = createInitialGame(`sim-${Date.now().toString(36)}`, []);
game.autoHostEnabled = true;

const human = {
  id: "human_strong",
  name: "强力真人",
  socketId: "sock-human",
  connected: true,
  ready: false,
  energy: 15,
  wealth: 100,
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
};
game.players.push(human);
addAiPlayer(game, { difficulty: "hard" });
addAiPlayer(game, { difficulty: "normal" });
addAiPlayer(game, { difficulty: "normal" });
addAiPlayer(game, { difficulty: "hard" });
addAiPlayer(game, { difficulty: "easy" });
for (const p of game.players) p.connected = true;
syncChatGroupsOnRosterChange(game);

const ais = game.players.filter((p) => p.isAI);
console.log(`\n🚀 Starting 8-Round Simulation | mode=${fastMode ? "FAST(disableThinking)" : "THINKING(low on invest)"} | model=${cfg.model}`);
console.log("Roster:", game.players.map((p) => `${p.name}(${p.isAI ? p.aiDifficulty : "HUMAN"})`).join(", "));

const preflight = await verifyAiAgents(game, { force: true });
applyAiPreflightToGame(game, preflight);
if (!preflight.ok) {
  console.error("❌ Preflight failed:", preflight);
  process.exit(1);
}

const startRes = startGameNow(io, game, "player");
if (!startRes.ok) {
  console.error("❌ startGameNow failed:", startRes.message);
  process.exit(1);
}

const metrics = {
  roundLatenciesMs: [],
  auctionLotPrices: [],
  shortExplosions: 0,
  riskExplosions: 0,
  longAbandons: 0,
  chatReplies: 0,
  chatSilences: 0,
  customGroupReplies: 0,
  socialTranscript: [],
};

let safetyLoops = 0;
const simStartAt = Date.now();

while (game.phase !== "GAME_OVER" && safetyLoops < 120) {
  safetyLoops += 1;

  if (game.phase === "ERA_INTRO") {
    if (!human.ready) togglePlayerReady(game, human.id);
    await handleAIPhase(game, io);
    await waitUntil(
      () => game.phase !== "ERA_INTRO" || ais.every((a) => a.ready),
      60_000,
      500,
      () => ensureAiProgress(game, io)
    );
    if (game.phase === "ERA_INTRO") tryAdvancePhase(game);
    continue;
  }

  if (game.phase === "INVESTMENT") {
    const rStart = Date.now();
    // Kick off AI turns and run human actions + test mid-game interactions!
    const aiPromise = handleAIPhase(game, io);

    if (game.globalRound === 2) {
      const gRes = createCustomChatGroup(game, human.id, [ais[0].id, ais[1].id], "中期小群");
      if (gRes.ok) {
        handleAiGroupCreated(game, gRes.group, human.id, io);
      }
    }
    if (game.globalRound === 3) {
      const tx1 = {
        id: "sim-tx-r3",
        fromId: human.id,
        fromName: human.name,
        toId: ais[0].id,
        toName: ais[0].name,
        amount: 1,
        note: "转你1块钱先聊聊，这轮咱们错峰投行吗？",
        status: "pending",
        timestamp: Date.now(),
      };
      game.transactions.push(tx1);
      human.wealth -= 1;

      const pub = game.chatGroups.find((g) => g.kind === "public");
      if (pub) {
        const sent = sendGroupChatMessage(game, human.id, pub.id, "这轮哪个项目比较稳？谁想分头拿第一呀？");
        if (sent.ok) {
          handleAiGroupMessage(game, pub.id, human.id, sent.message.text, io);
        }
      }
    }

    runStrongHumanInvestment(game, human, io);
    await aiPromise;
    await waitUntil(() => ais.every((a) => a.ready) && !hasAiTurnInFlight(game.roomId), 240_000);

    // Wait briefly in R2/R3 so live group/transfer async handlers settle for logging
    if (game.globalRound === 2 || game.globalRound === 3) {
      await sleep(7_000);
      if (!ais.every((a) => a.ready) || hasAiTurnInFlight(game.roomId)) {
        await waitUntil(() => ais.every((a) => a.ready) && !hasAiTurnInFlight(game.roomId), 120_000);
      }
    }

    const rMs = Date.now() - rStart;
    metrics.roundLatenciesMs.push({ round: game.globalRound, ms: rMs });
    console.log(`\n=== Round ${game.globalRound}/8 (Era ${game.currentEra}) took ${(rMs / 1000).toFixed(1)}s ===`);
    for (const p of game.players) {
      const invStr = Object.entries(p.investment ?? {})
        .map(([id, v]) => {
          const proj = game.activeProjects.find((pr) => pr.id === Number(id));
          return `${proj?.name ?? id}:${v}`;
        })
        .join(", ");
      console.log(`  ${p.name}(${p.isAI ? p.aiDifficulty : "HUMAN"}) wealth=${p.wealth} inv=[${invStr}] used=${JSON.stringify(p.usedCards)} leftCards=${JSON.stringify(p.inventory)}`);
    }

    // Wait for any online random.org lottery draw in flight before settling
    if (hasLotteryDrawInFlight(game.roomId)) {
      await waitUntil(() => !hasLotteryDrawInFlight(game.roomId), 20_000, 150);
    }
    game.investmentEndsAt = undefined; // Allow all-locked instant settlement just like post-4s grace
    tryAdvancePhase(game);
    continue;
  }

  if (game.phase === "SETTLEMENT") {
    const latestSettle = game.settlementHistory?.[game.settlementHistory.length - 1];
    if (latestSettle?.projects) {
      for (const pr of latestSettle.projects) {
        if (pr.isExploded && pr.type === "short") metrics.shortExplosions += 1;
        if (pr.isExploded && pr.type === "risk") metrics.riskExplosions += 1;
      }
    }
    const sorted = [...game.players].sort((a, b) => b.wealth - a.wealth);
    console.log(`  [After R${game.globalRound} Settle] Top3: ${sorted.slice(0, 3).map((p) => `${p.name}:${p.wealth}`).join(" | ")}`);
    if (!human.ready) togglePlayerReady(game, human.id);
    await handleAIPhase(game, io);
    await waitUntil(
      () => game.phase !== "SETTLEMENT" || ais.every((a) => a.ready),
      60_000,
      500,
      () => ensureAiProgress(game, io)
    );
    if (game.phase === "SETTLEMENT") tryAdvancePhase(game);
    continue;
  }

  if (game.phase === "AUCTION") {
    console.log(`\n🔨 Entering AUCTION (before Era ${game.currentEra})`);
    let aucLoops = 0;
    let simClock = Date.now();
    while (game.phase === "AUCTION" && aucLoops < 40) {
      aucLoops += 1;
      // Focus next lot if none focused yet
      if (!game.auctionFocusCardId) {
        simClock = Math.max(simClock, Date.now());
        ensureAutoHost(game, io, simClock);
        if (game.phase !== "AUCTION") break;
      }
      const focus = game.auctionFocusCardId;
      if (!focus) continue;

      // Bidding waves for this focused card (all AIs + strong human)
      for (let bidWave = 0; bidWave < 8 && game.phase === "AUCTION" && game.auctionFocusCardId === focus; bidWave++) {
        const prevC = (game.auctionBids ?? []).filter(
          (b) => b.cardId === focus && (b.status === "leading" || b.status === "outbid")
        ).length;
        await handleAIPhase(game, io);
        await waitUntil(
          () => !hasAiTurnInFlight(game.roomId),
          90_000,
          200,
          () => ensureAiProgress(game, io)
        );
        const hBid = strongHumanAuctionBid(game, human);
        if (hBid) {
          await handleAIPhase(game, io);
          await waitUntil(
            () => !hasAiTurnInFlight(game.roomId),
            90_000,
            200,
            () => ensureAiProgress(game, io)
          );
        }
        const nextC = (game.auctionBids ?? []).filter(
          (b) => b.cardId === focus && (b.status === "leading" || b.status === "outbid")
        ).length;
        if (!hBid && nextC === prevC) break;
      }

      // Ensure no AI auction turn is still running before hammering/advancing lot
      await waitUntil(() => !hasAiTurnInFlight(game.roomId), 60_000);
      simClock = Math.max(simClock, Date.now(), (game.autoHostNextActionAt ?? Date.now()) + 100);
      ensureAutoHost(game, io, simClock);
    }
    await waitUntil(() => !hasAiTurnInFlight(game.roomId), 60_000);
    const deals = (game.auctionCompletedDeals ?? []).filter((d) => d.auctionRound === game.currentEra - 1);
    for (const d of deals) {
      const winner = game.players.find((p) => p.id === d.playerId)?.name ?? d.playerId;
      metrics.auctionLotPrices.push({ card: d.cardId, winner, cost: d.cost, source: d.source });
      console.log(`  Lot sold: ${d.cardId} -> ${winner} for ${d.cost} (${d.source})`);
      if (d.cost <= 10) {
        const aucEvs = (game.sessionTelemetry?.events ?? [])
          .filter((e) => e.type === "ai_action" && e.payload?.kind === "auction" && e.payload?.cardId === d.cardId)
          .slice(-5);
        for (const ev of aucEvs) {
          const pName = game.players.find((p) => p.id === ev.playerId)?.name ?? ev.playerId;
          console.log(`    [<=10 debug] ${pName}: ${JSON.stringify(ev.payload)}`);
        }
      }
    }
    continue;
  }

  if (game.phase === "COMMUNITY_NAMING") {
    const rich = [...game.players].sort((a, b) => b.wealth - a.wealth)[0];
    if (rich.isAI) {
      await ensureAiCommunityNaming(game, io);
    } else {
      const { finalizeCommunityName } = await import("../dist/state/communityNaming.js");
      finalizeCommunityName(game, rich.id, "智弈新村");
    }
    continue;
  }

  await sleep(200);
}

// Tally abandoned long projects across all players
for (const p of game.players) {
  for (const rec of Object.values(p.longTerm ?? {})) {
    if (rec.status === "abandoned") metrics.longAbandons += 1;
  }
}

const totalSec = ((Date.now() - simStartAt) / 1000).toFixed(1);
const diag = aiRoomDiagnostics(game);
const sortedFinal = [...game.players].sort((a, b) => b.wealth - a.wealth);
const totalAiTokens = Object.values(diag.tokens).reduce((s, v) => s + v, 0);

console.log("\n================== FINAL SIMULATION REPORT ==================");
console.log(`Mode: ${fastMode ? "FAST (disableThinking=true)" : "THINKING (reasoningEffort=low on invest)"}`);
console.log(`Phase: ${game.phase} | Total Wall Time: ${totalSec}s | Failures: ${Object.keys(game.aiFailures ?? {}).length}`);
console.log(`Community Name: ${game.communityName}`);
console.log("\nLeaderboard:");
sortedFinal.forEach((p, idx) => {
  console.log(`  #${idx + 1} ${p.name} (${p.isAI ? p.aiDifficulty : "HUMAN"}) -> wealth=${p.wealth}, tokens=${diag.tokens[p.id] ?? 0}`);
});
console.log("\nRound Latencies:");
console.log(" ", metrics.roundLatenciesMs.map((r) => `R${r.round}:${(r.ms / 1000).toFixed(1)}s`).join(" | "));
console.log(`Total AI Tokens (5 AIs x 8 rounds + 3 auctions + chat): ${totalAiTokens} (avg ${(totalAiTokens / 5).toFixed(0)}/AI)`);
console.log(`ShortExplosions=${metrics.shortExplosions} RiskExplosions=${metrics.riskExplosions} LongAbandons=${metrics.longAbandons}`);
console.log("\nGroup Messages:");
for (const gm of game.groupMessages ?? []) {
  console.log(`  [${gm.groupId}] ${gm.fromName}: ${gm.text}`);
}
console.log("\nChat Statuses Residual:", JSON.stringify(game.aiChatStatuses ?? {}));
console.log("DM Transfers:", (game.transactions ?? []).map((t) => `${t.fromName}->${t.toName}[${t.amount},${t.status}]: ${t.note}`));

forgetAiRoom(game.roomId);
resetAutoHostState(game.roomId);

if (Object.keys(game.aiFailures ?? {}).length > 0) {
  console.error("❌ Simulation had AI failures:", game.aiFailures);
  process.exit(1);
}
if (game.phase !== "GAME_OVER") {
  console.error("❌ Did not reach GAME_OVER, ended at", game.phase);
  process.exit(1);
}
