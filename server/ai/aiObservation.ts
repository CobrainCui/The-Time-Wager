import type { ActiveProject, GameState, Player } from "../state/gameState.js";
import {
  getAuctionCardIdsForGame,
  getLeadingBidOnFocus,
  getLotCurrentBid,
  getMinimumNextBid,
  isAuctionCardAvailable,
  playerAvailableWealth,
  publicSessionAuctionWins,
} from "../logic/auctionCards.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { SAFETY_NOTICE_FROM_ID, maskPiiText } from "./aiSafety.js";
import { spendableEnergy } from "../logic/investmentLogic.js";
import { computeWealthRanks } from "../util/playerRank.js";
import { buffCards } from "../data/game_data.js";
import { peekNextRoundEnergy } from "../logic/energySchedule.js";
import { resolveRankPlayerCount, scaleRankRewardsForPlayerCount } from "../logic/rankRewardSchedule.js";
import { ERA_BONUS_POOL_LONG, ERA_BONUS_POOL_SHORT } from "../config/eraBonus.js";

function buffMeta(cardId: string): { id: string; name: string; description: string } {
  const found = buffCards.find((c) => c.id === cardId);
  return {
    id: cardId,
    name: found?.name ?? cardId,
    description: found?.description.replace(/\*\*/g, "").replace(/\n/g, "；") ?? "",
  };
}

function projectRiskRate(p: ActiveProject): number | undefined {
  if (p.type !== "risk") return undefined;
  return p.name.includes("成瘾") || p.name.includes("完美") || p.name.includes("幸福")
    ? 25
    : 20;
}

/**
 * AI 视角观察：只包含玩家本来就能看到的信息。
 * 不读取他人精力、他人手牌、他人投资草稿、私密彩票结果、他人私聊或不在其中的小群。
 */
export interface AiObservation {
  phase: string;
  era: number;
  roundInEra: number;
  globalRound: number;
  roundsRemainingAfterThis: number;
  nextRoundEnergy: number | null;
  playerCount: number;
  me: {
    id: string;
    name: string;
    energy: number;
    wealth: number;
    availableWealth: number;
    reservedWealth: number;
    rank: number;
    ready: boolean;
    currentInvestment: Record<number, number>;
    inventory: string[];
    inventoryDetails: Array<{ id: string; name: string; description: string }>;
    activeBuffs: string[];
    usedCards: string[];
    coffeePurchases: number;
    slackedBy: number;
    activeLongTerm: Array<{
      projectId: number;
      name: string;
      totalInvested: number;
      status: "active" | "completed" | "abandoned";
    }>;
    riskExposure: Array<{
      projectId: number;
      name: string;
      historicalGainAtRisk: number;
    }>;
  };
  players: Array<{
    id: string;
    name: string;
    wealth: number;
    rank: number;
    connected: boolean;
    ready: boolean;
    isMe: boolean;
  }>;
  projects: Array<{
    id: number;
    name: string;
    type: "short" | "long" | "risk";
    maxEnergy: number;
    accumulated: number;
    headroom: number;
    myInvested: number;
    era?: string;
    matchesEraBonus: boolean;
    eraBonusPool: number;
    rankRewards?: number[];
    overInvestPenalty?: number[];
    riskRate?: number;
    expiresAfterThisRound: boolean;
  }>;
  eraCard: { name: string; era?: string } | null;
  auction: {
    focusCardId: string;
    focusCardName: string;
    focusCardDescription: string;
    currentBid: number;
    minimumNextBid: number;
    highBidderName: string | null;
    iAmLeading: boolean;
    bidHistory: Array<{ playerName: string; amount: number }>;
    remainingCards: Array<{ id: string; name: string; description: string }>;
    soldLotsThisAuction: Array<{ cardId: string; cardName: string; playerName: string; cost: number; source: string }>;
  } | null;
  /** 本局公开拍卖成交记录（不含个人出价比例） */
  auctionSessionWins: Array<{
    cardId: string;
    cardName: string;
    playerName: string;
    cost: number;
    auctionRound?: number;
    source: string;
  }>;
  /** 仅含收到的待确认转账或近期 0 元私信（保持旧字段兼容） */
  incoming: Array<{ id: string; fromName: string; amount: number; note: string }>;
  /** 与各玩家的近期 1v1 完整来往记录（含已收/已拒转账及本人发出记录，防止健忘/否认） */
  directHistory: Array<{
    id: string;
    fromId: string;
    fromName: string;
    toId: string;
    toName: string;
    direction: "in" | "out";
    amount: number;
    status: "pending" | "accepted" | "rejected";
    note: string;
    ageSec: number;
  }>;
  publicChat: Array<{ fromName: string; text: string }>;
  /** AI 被拉入的自定义群（仅成员可见） */
  groupChats: Array<{
    id: string;
    name: string;
    memberIds: string[];
    memberNames: string[];
    messages: Array<{ fromName: string; text: string }>;
  }>;
  /** 与真人共享的桌面公开动态（不含私密开奖/私信/打火机命中） */
  publicFeed: Array<{
    round: number;
    kind: string;
    text: string;
  }>;
  /** 最近几轮公开项目结算结果及本人收益 */
  recentSettlements: Array<{
    round: number;
    projects: Array<{
      name: string;
      type: string;
      totalInvested: number;
      maxEnergy: number;
      completed: boolean;
      exploded: boolean;
      shortSold: boolean;
      myInvested: number;
      myGain: number;
    }>;
  }>;
}

function projectView(game: GameState, ai: Player, p: ActiveProject, playerCount: number) {
  const matchesEraBonus = Boolean(p.era && game.currentEraCard?.era && p.era === game.currentEraCard.era);
  const eraBonusPool =
    matchesEraBonus && p.type === "short"
      ? ERA_BONUS_POOL_SHORT
      : matchesEraBonus && p.type === "long"
        ? ERA_BONUS_POOL_LONG
        : 0;
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    maxEnergy: p.maxEnergy,
    accumulated: p.accumulatedInvested,
    headroom: Math.max(0, p.maxEnergy - p.accumulatedInvested),
    myInvested: p.investorRecords?.[ai.id] ?? 0,
    era: p.era,
    matchesEraBonus,
    eraBonusPool,
    rankRewards: scaleRankRewardsForPlayerCount(p.rankRewards, playerCount),
    overInvestPenalty: p.overInvestPenalty,
    riskRate: projectRiskRate(p),
    expiresAfterThisRound: p.type === "risk" && game.roundInEra >= 2,
  };
}

export function buildAiObservation(game: GameState, ai: Player): AiObservation {
  const now = Date.now();
  const ranks = computeWealthRanks(game.players);
  // 同步写回，保证本地策略（如 chooseChat 的领跑判断）也拿到正确名次
  for (const p of game.players) p.rank = ranks.get(p.id) ?? p.rank;

  const dmSince = now - 5 * 60_000;
  const incoming = (game.transactions ?? [])
    .filter(
      (t) =>
        t.toId === ai.id &&
        (t.status === "pending" || (t.amount === 0 && t.status === "accepted" && t.timestamp >= dmSince))
    )
    .slice(-8)
    .map((t) => ({
      id: t.id,
      fromName: t.fromName,
      amount: t.amount,
      note: maskPiiText(t.note ?? ""),
    }));

  // 完整 1v1 往来（收/发、私信/转账、pending/accepted/rejected）保留最近 20 条，彻底避免收钱后否认
  const directHistory = (game.transactions ?? [])
    .filter((t) => t.toId === ai.id || t.fromId === ai.id)
    .slice(-20)
    .map((t) => ({
      id: t.id,
      fromId: t.fromId,
      fromName: t.fromName,
      toId: t.toId,
      toName: t.toName,
      direction: (t.toId === ai.id ? "in" : "out") as "in" | "out",
      amount: t.amount,
      status: t.status,
      note: maskPiiText(t.note ?? ""),
      ageSec: Math.max(0, Math.round((now - t.timestamp) / 1000)),
    }));

  const publicGroup = (game.chatGroups ?? []).find((g) => g.kind === "public");
  const publicChat = publicGroup
    ? (game.groupMessages ?? [])
        .filter((m) => m.groupId === publicGroup.id && m.fromId !== SAFETY_NOTICE_FROM_ID)
        .slice(-15)
        .map((m) => ({
          fromName: m.fromName,
          text: maskPiiText(String(m.text ?? "").replace(/\s+/g, " ")).slice(0, 160),
        }))
    : [];

  const focusId = game.auctionFocusCardId;
  const leading = getLeadingBidOnFocus(game);
  const auctionPool = getAuctionCardIdsForGame(game);
  const remainingCards = auctionPool
    .filter((id) => isAuctionCardAvailable(game, id))
    .map((id) => buffMeta(id));
  const sessionWins = publicSessionAuctionWins(game).map((w) => ({
    cardId: w.cardId,
    cardName: buffMeta(w.cardId).name,
    playerName: w.playerName,
    cost: w.cost,
    auctionRound: w.auctionRound,
    source: w.source,
  }));
  const currentAuctionRound = Math.max(1, Math.min(game.currentEra - 1, 3));
  const focusMeta = focusId ? buffMeta(focusId) : null;
  const auction = focusId && focusMeta
    ? {
        focusCardId: focusId,
        focusCardName: focusMeta.name,
        focusCardDescription: focusMeta.description,
        currentBid: getLotCurrentBid(game),
        minimumNextBid: getMinimumNextBid(game),
        highBidderName:
          game.players.find((p) => p.id === leading?.playerId)?.name ?? null,
        iAmLeading: leading?.playerId === ai.id,
        bidHistory: (game.auctionBids ?? [])
          .filter((b) => b.cardId === focusId)
          .slice(-10)
          .map((b) => ({ playerName: b.playerName, amount: b.amount })),
        remainingCards,
        soldLotsThisAuction: sessionWins.filter((w) => w.auctionRound === currentAuctionRound),
      }
    : null;

  const projectNameById = new Map<number, string>();
  for (const list of [game.activeProjects, game.completedProjects, game.uncompletedProjects]) {
    for (const proj of list ?? []) projectNameById.set(proj.id, proj.name);
  }

  const activeLongTerm = Object.entries(ai.longTerm ?? {}).map(([pidStr, rec]) => {
    const projectId = Number(pidStr);
    return {
      projectId,
      name: projectNameById.get(projectId) ?? `项目#${projectId}`,
      totalInvested: rec.totalInvested,
      status: rec.status,
    };
  });

  const riskExposure = Object.entries(ai.riskGains ?? {})
    .filter(([, gain]) => Number(gain) > 0)
    .map(([pidStr, gain]) => {
      const projectId = Number(pidStr);
      return {
        projectId,
        name: projectNameById.get(projectId) ?? `风险项目#${projectId}`,
        historicalGainAtRisk: Number(gain),
      };
    });

  const availableWealth = playerAvailableWealth(game, ai);
  const playerCount = resolveRankPlayerCount(game);
  const inv = ai.inventory ?? [];

  const recentSettlements = (game.sessionTelemetry?.settlementHistory ?? [])
    .slice(-2)
    .map((entry) => ({
      round: entry.round,
      projects: entry.results.map((r) => ({
        name: r.name,
        type: r.type,
        totalInvested: r.totalInvested,
        maxEnergy: r.maxEnergy,
        completed: r.isCompleted,
        exploded: r.isExploded,
        shortSold: Boolean(r.shortSold),
        myInvested: r.playerInvestments?.[ai.id] ?? 0,
        myGain: r.playerGains?.[ai.id]?.total ?? 0,
      })),
    }));

  const publicFeed = (game.publicFeed ?? []).slice(-20).map((item) => ({
    round: item.round,
    kind: item.kind,
    text: maskPiiText(item.text),
  }));

  return {
    phase: game.phase,
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    roundsRemainingAfterThis: Math.max(0, 8 - game.globalRound),
    nextRoundEnergy: peekNextRoundEnergy(game),
    playerCount,
    me: {
      id: ai.id,
      name: ai.name,
      energy: spendableEnergy(ai),
      wealth: ai.wealth,
      availableWealth,
      reservedWealth: Math.max(0, ai.wealth - availableWealth),
      rank: ranks.get(ai.id) ?? ai.rank,
      ready: ai.ready === true,
      currentInvestment: { ...(ai.investment ?? {}) },
      inventory: inv,
      inventoryDetails: inv.map((id) => buffMeta(id)),
      activeBuffs: (ai.activeBuffs ?? []).map((b) => b.cardId),
      usedCards: ai.usedCards ?? [],
      coffeePurchases: ai.coffeePurchasesThisRound ?? 0,
      slackedBy: ai.slackedBy?.length ?? 0,
      activeLongTerm,
      riskExposure,
    },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      wealth: p.wealth,
      rank: ranks.get(p.id) ?? p.rank,
      connected: p.connected,
      ready: p.ready === true,
      isMe: p.id === ai.id,
    })),
    projects: (game.activeProjects ?? []).map((p) => projectView(game, ai, p, playerCount)),
    eraCard: game.currentEraCard
      ? { name: game.currentEraCard.name, era: game.currentEraCard.era }
      : null,
    auction,
    auctionSessionWins: sessionWins,
    incoming,
    directHistory,
    publicChat: GROUP_CHAT_ENABLED ? publicChat : [],
    groupChats: GROUP_CHAT_ENABLED
      ? (game.chatGroups ?? [])
          .filter((g) => g.kind === "custom" && g.memberIds.includes(ai.id))
          .slice(-6)
          .map((g) => ({
            id: g.id,
            name: maskPiiText(g.name),
            memberIds: [...g.memberIds],
            memberNames: g.memberIds.map(
              (id) => game.players.find((p) => p.id === id)?.name ?? id
            ),
            messages: (game.groupMessages ?? [])
              .filter((m) => m.groupId === g.id && m.fromId !== SAFETY_NOTICE_FROM_ID)
              .slice(-12)
              .map((m) => ({ fromName: m.fromName, text: maskPiiText(m.text) })),
          }))
      : [],
    publicFeed,
    recentSettlements,
  };
}
