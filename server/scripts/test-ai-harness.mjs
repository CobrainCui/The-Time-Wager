/**
 * Live DeepSeek (deepseek-v4-pro) Agent Harness Verification Script
 * Usage (from server/): node scripts/test-ai-harness.mjs
 *
 * Tests:
 * 1) 1-yuan incoming transfer -> delayed (3-5s) AI decision + natural DM memory
 * 2) Direct messages -> delayed reply vs silence + unlockToReinvest
 * 3) Group creation + Public/Custom group chat -> staggered natural replies & silent states
 * 4) Investment strategy (Era 2 & Era 4 with long >= 3 continuation, risk clawback avoidance,
 *    and buff_lottery public/private execution)
 * 5) Auction EV bidding (Era 2 buff_gold & Era 4 buff_lottery)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(serverRoot, ".env"), quiet: true });

// Force live strict agent mode + thinking enabled for real harness verification
process.env.AI_STRICT_AGENT = "true";
process.env.AI_DISABLE_THINKING = "false";

const { createInitialGame } = await import("../dist/state/gameState.js");
const { addAiPlayer, fillAiPlayers } = await import("../dist/ai/aiRoster.js");
const {
  handleAIPhase,
  handleAiDirectMessage,
  handleAiGroupMessage,
  handleAiGroupCreated,
  forgetAiRoom,
} = await import("../dist/ai/aiOrchestrator.js");
const { createCustomChatGroup, syncChatGroupsOnRosterChange } = await import("../dist/logic/chatGroups.js");
const { applyInvestments } = await import("../dist/logic/investmentLogic.js");
const { appendPublicFeed } = await import("../dist/util/publicFeed.js");
const { buildAuctionLotPublicView } = await import("../dist/logic/auctionCards.js");
const { shortTermProjects, longTermProjects, riskProjects, eraCards } = await import(
  "../dist/data/game_data.js"
);
const { resolveAiModelConfigForSlot } = await import("../dist/ai/aiConfig.js");

const cfg = resolveAiModelConfigForSlot(1);
if (!cfg) {
  console.error("❌ No AI model configured in .env; aborting live harness.");
  process.exit(1);
}
console.log(`🤖 Using model=${cfg.model} provider=${cfg.provider} baseURL=${cfg.baseURL ?? "default"} disableThinking=${process.env.AI_DISABLE_THINKING}`);

const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const enabledScenarios = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()))
  : new Set(["1", "2", "3", "4"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toActiveProject(card, overrides = {}) {
  return {
    id: card.id,
    name: card.name,
    type: card.type,
    maxEnergy: card.maxEnergy,
    era: card.era,
    rankRewards: card.rankRewards,
    overInvestPenalty: card.overInvestPenalty,
    accumulatedInvested: 0,
    currentInvested: 0,
    roundsNoInvestment: 0,
    investedThisRound: false,
    investorRecords: {},
    earningRecords: {},
    totalPayout: 0,
    ...overrides,
  };
}

function createHarnessGame() {
  const game = createInitialGame(`harness-${Date.now().toString(36)}`, []);
  const human = {
    id: "human_tester",
    name: "测试玩家",
    socketId: "sock-human",
    connected: true,
    ready: false,
    energy: 13,
    wealth: 120,
    rank: 2,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 30,
    wealthHistory: [100, 110, 120],
    investedRiskEnergy: 4,
    investedLongEnergy: 8,
    investedShortEnergy: 18,
    socialRank: null,
  };
  game.players.push(human);
  addAiPlayer(game, { difficulty: "normal" });
  addAiPlayer(game, { difficulty: "hard" });
  addAiPlayer(game, { difficulty: "normal" });
  addAiPlayer(game, { difficulty: "easy" });
  fillAiPlayers(game, 6);
  for (const p of game.players) p.connected = true;
  game.energyTableSize = 6;
  game.currentEra = 2;
  game.roundInEra = 1;
  game.globalRound = 3;
  game.currentEraCard = eraCards[1]; // 数字星河时代 (科技)
  game.phase = "INVESTMENT";
  game.investmentEndsAt = Date.now() + 8 * 60_000;
  syncChatGroupsOnRosterChange(game);
  return { game, human, ais: game.players.filter((p) => p.isAI) };
}

function setupStandardProjects(game, ais, human) {
  const s1 = toActiveProject(shortTermProjects[2], { accumulatedInvested: 13, investorRecords: { [ais[1].id]: 7, [human.id]: 6 } }); // maxEnergy 18 -> headroom 5
  const s2 = toActiveProject(shortTermProjects[3], { accumulatedInvested: 4, investorRecords: { [ais[2].id]: 4 } }); // 科技 25
  const l1 = toActiveProject(longTermProjects[2], { accumulatedInvested: 32, investorRecords: { [ais[0].id]: 12, [ais[1].id]: 10, [human.id]: 10 } }); // 数字图书馆 科技 max 90
  const r1 = toActiveProject(riskProjects[1], { accumulatedInvested: 6, investorRecords: { [ais[1].id]: 6 } }); // 成瘾算法 科技 max 8 (headroom 2!)
  game.activeProjects = [s1, s2, l1, r1];
  for (const p of game.players) {
    p.energy = 13;
    p.ready = false;
    p.investment = {};
    p.investmentDraft = {};
  }
  ais[0].longTerm = { [l1.id]: { projectId: l1.id, totalInvested: 12, status: "active" } };
  ais[1].longTerm = { [l1.id]: { projectId: l1.id, totalInvested: 10, status: "active" } };
  ais[1].riskGains = { [r1.id]: 80 };
  ais[1].investedRiskEnergy = 4;
}

async function waitUntil(pred, timeoutMs = 150_000, pollMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return Date.now() - start;
    await sleep(pollMs);
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

// Track emitted socket notifications cleanly
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

try {
  // =========================================================================
  // SCENARIO 1: 1-Yuan Transfer -> Delayed Accept + DM Memory + Silent + Unlock
  // =========================================================================
  if (enabledScenarios.has("1") || enabledScenarios.has("2")) {
  const { game, human, ais } = createHarnessGame();
  setupStandardProjects(game, ais, human);
  const ai1 = ais[0];
  const ai2 = ais[1];
  const { io, events } = makeMockIo();

  // Give all AIs locked investments first in Scenario 1/2
  for (const a of ais) {
    applyInvestments(game, a.id, { [game.activeProjects[1].id]: 8, [game.activeProjects[2].id]: 5 });
    a.ready = true;
    game.readyPlayers.add(a.id);
  }

  if (enabledScenarios.has("1")) {
  console.log("\n=== SCENARIO 1: Transfer Delay, DM Memory, Silence & UnlockToReinvest ===");

  const tx1 = {
    id: "tx-harness-1",
    fromId: human.id,
    fromName: human.name,
    toId: ai1.id,
    toName: ai1.name,
    amount: 1,
    note: "转你1块钱先聊聊，别着急",
    status: "pending",
    timestamp: Date.now(),
  };
  game.transactions.push(tx1);
  human.wealth -= 1;

  // Immediate trigger (<100ms): must NOT instant-accept, AND must set thinking + schedule timer!
  await handleAIPhase(game, io);
  console.log(`[t+0ms] tx1.status=${tx1.status}, aiChatStatus=${JSON.stringify(game.aiChatStatuses?.[`dm:${human.id}:${ai1.id}`])}`);
  if (tx1.status !== "pending") {
    throw new Error(`Expected delayed transfer resolution, got immediate status=${tx1.status}`);
  }
  if (game.aiChatStatuses?.[`dm:${human.id}:${ai1.id}`]?.[ai1.id]?.state !== "thinking") {
    throw new Error("Expected dm thinking status while waiting 3-5s transfer delay");
  }

  // Timer should fire automatically after 3-5s without manual polling!
  const tStartTransfer = Date.now();
  await waitUntil(() => tx1.status !== "pending", 120_000);
  const elapsedTransfer = Date.now() - tStartTransfer;
  if (elapsedTransfer < 2_500) {
    throw new Error(`Transfer resolved too quickly (${elapsedTransfer}ms), expected 3-5s delay!`);
  }
  console.log(`[t+${elapsedTransfer}ms] tx1 resolved automatically: status=${tx1.status}`);
  const afterTransferMsgs = game.transactions.filter(
    (t) => (t.fromId === ai1.id && t.toId === human.id) || (t.fromId === human.id && t.toId === ai1.id)
  );
  console.log("DM/Transfer history after resolve:", afterTransferMsgs.map((t) => `${t.fromName}->${t.toName} [amt=${t.amount},${t.status}]: ${t.note}`));

  // Follow-up question asking why it took/rejected 1 yuan + checking natural speech & unlockToReinvest
  const q1 = {
    id: "dm-q1",
    fromId: human.id,
    fromName: human.name,
    toId: ai1.id,
    toName: ai1.name,
    amount: 0,
    note: "你刚为啥收我那1块钱？另外那个短期差5点满额，你要不要解锁跟我分一下？",
    status: "accepted",
    timestamp: Date.now(),
  };
  game.transactions.push(q1);
  const tDm1 = Date.now();
  await handleAiDirectMessage(game, ai1, human.id, q1, io);
  await waitUntil(
    () => {
      const st = game.aiChatStatuses?.[`dm:${human.id}:${ai1.id}`]?.[ai1.id];
      return !st || st.state !== "thinking";
    },
    120_000
  );
  const replyMsgs = game.transactions.filter((t) => t.fromId === ai1.id && t.toId === human.id && t.timestamp >= tDm1);
  const dmSt = game.aiChatStatuses?.[`dm:${human.id}:${ai1.id}`]?.[ai1.id];
  console.log(`[${Date.now() - tDm1}ms] AI1 DM status=${dmSt?.state ?? "replied"}, ready=${ai1.ready}, replies=${JSON.stringify(replyMsgs.map((m) => m.note))}`);

  // Ignorable closure DM to AI2 to check silence/natural end
  const q2 = {
    id: "dm-q2",
    fromId: human.id,
    fromName: human.name,
    toId: ai2.id,
    toName: ai2.name,
    amount: 0,
    note: "行，我知道了，不打扰你算牌",
    status: "accepted",
    timestamp: Date.now(),
  };
  game.transactions.push(q2);
  const tDm2 = Date.now();
  await handleAiDirectMessage(game, ai2, human.id, q2, io);
  await waitUntil(
    () => {
      const st = game.aiChatStatuses?.[`dm:${human.id}:${ai2.id}`]?.[ai2.id];
      return !st || st.state !== "thinking";
    },
    120_000
  );
  const reply2 = game.transactions.filter((t) => t.fromId === ai2.id && t.toId === human.id && t.timestamp >= tDm2);
  const dmSt2 = game.aiChatStatuses?.[`dm:${human.id}:${ai2.id}`]?.[ai2.id];
  console.log(`[${Date.now() - tDm2}ms] AI2 (closure DM) status=${dmSt2?.state ?? "replied"}, replies=${JSON.stringify(reply2.map((m) => m.note))}`);
  } // end scenario 1

  // =========================================================================
  // SCENARIO 2: Public Chat + Custom Group Creation & Group Chat
  // =========================================================================
  if (enabledScenarios.has("2")) {
  console.log("\n=== SCENARIO 2: Public Chat & Custom Group Creation ===");
  const pubGroup = game.chatGroups.find((g) => g.kind === "public");
  const pubMsg = {
    id: "gm-pub-1",
    groupId: pubGroup.id,
    fromId: human.id,
    fromName: human.name,
    text: "短期只剩5格了谁别一起撞爆啊！有人开点石或彩票吗？",
    timestamp: Date.now(),
  };
  game.groupMessages.push(pubMsg);
  const tPub = Date.now();
  handleAiGroupMessage(game, pubGroup.id, human.id, pubMsg.text, io);
  await waitUntil(
    () => {
      const ch = game.aiChatStatuses?.[`group:${pubGroup.id}`] ?? {};
      return !Object.values(ch).some((s) => s.state === "thinking");
    },
    240_000
  );
  const pubReplies = game.groupMessages.filter((m) => m.groupId === pubGroup.id && m.id !== pubMsg.id);
  console.log(`[${Date.now() - tPub}ms] Public group replies (${pubReplies.length}):`);
  for (const r of pubReplies) console.log(`  - ${r.fromName}: ${r.text}`);
  console.log("  Public group final chatStatuses:", game.aiChatStatuses?.[`group:${pubGroup.id}`]);

  const created = createCustomChatGroup(game, human.id, [ai1.id, ai2.id], "风投小分队");
  if (!created.ok) throw new Error(created.error);
  const tGrpCreate = Date.now();
  handleAiGroupCreated(game, created.group, human.id, io);
  await waitUntil(
    () => {
      const ch = game.aiChatStatuses?.[`group:${created.group.id}`] ?? {};
      return !Object.values(ch).some((s) => s.state === "thinking");
    },
    240_000
  );
  const grpWelcomes = game.groupMessages.filter((m) => m.groupId === created.group.id);
  console.log(`[${Date.now() - tGrpCreate}ms] Custom group welcome (${grpWelcomes.length}):`);
  for (const w of grpWelcomes) console.log(`  - ${w.fromName}: ${w.text}`);
  console.log("  Custom group final chatStatuses:", game.aiChatStatuses?.[`group:${created.group.id}`]);
  } // end scenario 2

  forgetAiRoom(game.roomId);
  } // end scenarios 1/2

  // =========================================================================
  // SCENARIO 3: Strategy - Era 4 Long >=3 + Risk Clawback + Buff Lottery (Public/Private)
  // =========================================================================
  if (enabledScenarios.has("3")) {
  console.log("\n=== SCENARIO 3: Era 4 Rational Math & Lottery Visibility ===");
  const g3 = createHarnessGame();
  const h3 = g3.human;
  const a3 = g3.ais;
  g3.game.currentEra = 4;
  g3.game.roundInEra = 1;
  g3.game.globalRound = 7;
  g3.game.currentEraCard = eraCards[3]; // 生命活力运动 (健康)
  const pShort = toActiveProject(shortTermProjects[6], { accumulatedInvested: 18 }); // max 23, headroom 5 (健康)
  const pLongActive = toActiveProject(longTermProjects[5], {
    accumulatedInvested: 55,
    investorRecords: { [a3[1].id]: 22, [h3.id]: 18, [a3[0].id]: 15 },
  }); // 健康 max 90
  const pRiskHot = toActiveProject(riskProjects[5], {
    accumulatedInvested: 7, // max 8! headroom=1!
    investorRecords: { [a3[1].id]: 7 },
  });
  g3.game.activeProjects = [pShort, pLongActive, pRiskHot];
  for (const p of g3.game.players) {
    p.energy = 9;
    p.ready = false;
    p.investment = {};
  }
  // a3[0] (normal) holds buff_lottery + buff_gold, and has active longTerm needing >=3!
  a3[0].inventory = ["buff_lottery", "buff_gold"];
  a3[0].longTerm = { [pLongActive.id]: { projectId: pLongActive.id, totalInvested: 15, status: "active" } };
  // a3[1] (hard) holds buff_insurance, has riskGains=125 at risk in pRiskHot (headroom 1) + active longTerm!
  a3[1].inventory = ["buff_insurance"];
  a3[1].riskGains = { [pRiskHot.id]: 125 };
  a3[1].investedRiskEnergy = 5;
  a3[1].longTerm = { [pLongActive.id]: { projectId: pLongActive.id, totalInvested: 22, status: "active" } };
  h3.ready = true;
  g3.game.readyPlayers.add(h3.id);
  appendPublicFeed(g3.game, "era", "进入第 4 时代第 1 轮（生命活力运动·健康）");

  const { io: io3 } = makeMockIo();
  const tStrat = Date.now();
  await handleAIPhase(g3.game, io3);
  await waitUntil(() => a3.every((a) => a.ready), 180_000);
  // Allow async random.org lottery settlement microtasks to settle
  await sleep(1_500);
  console.log(`[${Date.now() - tStrat}ms] All 5 AIs completed Round 7 investment:`);
  for (const a of a3) {
    console.log(
      `  - ${a.name}(${a.aiDifficulty ?? "normal"}): inv=${JSON.stringify(a.investment)} wealth=${a.wealth} used=${JSON.stringify(a.usedCards)} activeBuffs=${JSON.stringify(a.activeBuffs)} invLeft=${JSON.stringify(a.inventory)}`
    );
  }
  // Print Round 7 reasoning from session telemetry
  const r7Events = (g3.game.sessionTelemetry?.events ?? []).filter((e) => e.type === "ai_action");
  for (const ev of r7Events) {
    console.log(`  [R7 reasoning] ${ev.playerId}: ${JSON.stringify(ev.payload)}`);
  }
  console.log("  Round 7 publicFeed:", g3.game.publicFeed);
  console.log("  Round 7 lotteryCompletedDeals:", g3.game.lotteryCompletedDeals);

  // Also test Round 8 (final round, roundsRemainingAfterThis = 0):
  console.log("\n--- SCENARIO 3B: Round 8 Final Round (Must Spend Remaining Buff Cards / Lottery) ---");
  g3.game.roundInEra = 2;
  g3.game.globalRound = 8;
  g3.game.readyPlayers.clear();
  g3.game.readyPlayers.add(h3.id);
  for (const a of a3) {
    a.ready = false;
    a.energy = 9;
    a.investment = {};
    a.activeBuffs = [];
  }
  // Ensure a3[0] still tests buff_lottery + buff_gold combo if it saved them, and a3[2] tests buff_lottery alone
  if (!a3[0].inventory.includes("buff_lottery")) a3[0].inventory.push("buff_lottery");
  if (!a3[0].inventory.includes("buff_gold")) a3[0].inventory.push("buff_gold");
  a3[2].inventory = ["buff_lottery"];

  const tR8 = Date.now();
  await handleAIPhase(g3.game, io3);
  await waitUntil(() => a3.every((a) => a.ready), 180_000);
  await sleep(1_500);
  console.log(`[${Date.now() - tR8}ms] Round 8 done:`);
  for (const a of a3) {
    console.log(
      `  - ${a.name}(${a.aiDifficulty ?? "normal"}): inv=${JSON.stringify(a.investment)} wealth=${a.wealth} used=${JSON.stringify(a.usedCards)} activeBuffs=${JSON.stringify(a.activeBuffs)} invLeft=${JSON.stringify(a.inventory)}`
    );
  }
  console.log("  Round 8 publicFeed:", g3.game.publicFeed);
  console.log("  Round 8 lotteryCompletedDeals:", g3.game.lotteryCompletedDeals);
  forgetAiRoom(g3.game.roomId);
  } // end scenario 3

  // =========================================================================
  // SCENARIO 4: Auction Bidding Rationality (Era 2 buff_gold)
  // =========================================================================
  if (enabledScenarios.has("4")) {
  console.log("\n=== SCENARIO 4: Auction EV Bidding (Era 2 buff_gold) ===");
  const g4 = createHarnessGame();
  g4.game.phase = "AUCTION";
  g4.game.currentEra = 2;
  g4.game.auctionFocusCardId = "buff_gold";
  g4.game.auctionBids = [];
  g4.game.auctionSoldLots = [];
  const { io: io4 } = makeMockIo();
  const tAuc = Date.now();
  for (let tick = 0; tick < 6; tick++) {
    const prevCount = g4.game.auctionBids?.length ?? 0;
    await handleAIPhase(g4.game, io4);
    console.log(`  [tick=${tick}] bids=${g4.game.auctionBids?.length ?? 0}, failures=${JSON.stringify(g4.game.aiFailures ?? {})}`);
    if (tick > 0 && (g4.game.auctionBids?.length ?? 0) === prevCount) break;
  }
  const aucView = buildAuctionLotPublicView(g4.game);
  console.log(`[${Date.now() - tAuc}ms] Auction highBid=${aucView.auctionCurrentBid} by ${aucView.auctionHighBidderName}`);
  console.log("  Bid sequence:", (g4.game.auctionBids ?? []).map((b) => `${b.playerName}:${b.amount}`).join(" -> "));
  console.log("  Logs:", g4.game.logs);
  const aucEvents = (g4.game.sessionTelemetry?.events ?? []).filter((e) => e.type === "ai_action");
  for (const ev of aucEvents) {
    const pName = g4.game.players.find((p) => p.id === ev.playerId)?.name ?? ev.playerId;
    console.log(`  [Auction decision] ${pName}: ${JSON.stringify(ev.payload)}`);
  }
  forgetAiRoom(g4.game.roomId);
  } // end scenario 4

  console.log("\n✅ Harness run completed cleanly.");
} catch (err) {
  console.error("❌ Harness error:", err);
  process.exit(1);
}
