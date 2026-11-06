import type { ActiveProject, GameState, Player } from "../state/gameState.js";
import { getLeadingBidOnFocus, getLotCurrentBid, getMinimumNextBid } from "../logic/auctionCards.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { SAFETY_NOTICE_FROM_ID } from "./aiSafety.js";
import { spendableEnergy } from "../logic/investmentLogic.js";
import { computeWealthRanks } from "../util/playerRank.js";

/**
 * AI 视角观察：只包含玩家本来就能看到的信息。
 * 不读取他人精力、手牌、本轮投资草稿；这些在 broadcast 里也从不公开。
 */
export interface AiObservation {
  phase: string;
  era: number;
  roundInEra: number;
  globalRound: number;
  me: {
    id: string;
    name: string;
    energy: number;
    wealth: number;
    rank: number;
    inventory: string[];
    coffeePurchases: number;
    slackedBy: number;
  };
  players: Array<{
    id: string;
    name: string;
    wealth: number;
    rank: number;
    connected: boolean;
  }>;
  projects: Array<{
    id: number;
    name: string;
    type: "short" | "long" | "risk";
    maxEnergy: number;
    accumulated: number;
    headroom: number;
    era?: string;
    rankRewards?: number[];
    overInvestPenalty?: number[];
    eraBonus?: Record<number, number>;
  }>;
  eraCard: { name: string; era?: string } | null;
  auction: {
    focusCardId: string;
    currentBid: number;
    minimumNextBid: number;
    highBidderName: string | null;
    bidHistory: Array<{ playerName: string; amount: number }>;
  } | null;
  incoming: Array<{ id: string; fromName: string; amount: number; note: string }>;
  publicChat: Array<{ fromName: string; text: string }>;
  /** AI 被拉进的自定义群（仅成员可见） */
  groupChats: Array<{
    id: string;
    name: string;
    memberNames: string[];
    messages: Array<{ fromName: string; text: string }>;
  }>;
}

function projectView(p: ActiveProject) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    maxEnergy: p.maxEnergy,
    accumulated: p.accumulatedInvested,
    headroom: Math.max(0, p.maxEnergy - p.accumulatedInvested),
    era: p.era,
    rankRewards: p.rankRewards,
    overInvestPenalty: p.overInvestPenalty,
    eraBonus: p.eraBonus,
  };
}

export function buildAiObservation(game: GameState, ai: Player): AiObservation {
  const ranks = computeWealthRanks(game.players);
  // 同步写回，保证本地策略（如 chooseChat 的领跑判断）也拿到正确名次
  for (const p of game.players) p.rank = ranks.get(p.id) ?? p.rank;
  const incoming = (game.transactions ?? [])
    .filter((t) => t.status === "pending" && t.toId === ai.id)
    .slice(-5)
    .map((t) => ({
      id: t.id,
      fromName: t.fromName,
      amount: t.amount,
      note: t.note ?? "",
    }));

  const publicGroup = (game.chatGroups ?? []).find((g) => g.kind === "public");
  const publicChat = publicGroup
    ? (game.groupMessages ?? [])
        .filter((m) => m.groupId === publicGroup.id && m.fromId !== SAFETY_NOTICE_FROM_ID)
        .slice(-10)
        .map((m) => ({
          fromName: m.fromName,
          text: String(m.text ?? "").replace(/\s+/g, " ").slice(0, 160),
        }))
    : [];

  const focusId = game.auctionFocusCardId;
  const leading = getLeadingBidOnFocus(game);
  const auction = focusId
    ? {
        focusCardId: focusId,
        currentBid: getLotCurrentBid(game),
        minimumNextBid: getMinimumNextBid(game),
        highBidderName:
          game.players.find((p) => p.id === leading?.playerId)?.name ?? null,
        bidHistory: (game.auctionBids ?? [])
          .filter((b) => b.cardId === focusId)
          .slice(-8)
          .map((b) => ({ playerName: b.playerName, amount: b.amount })),
      }
    : null;

  return {
    phase: game.phase,
    era: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    me: {
      id: ai.id,
      name: ai.name,
      energy: spendableEnergy(ai),
      wealth: ai.wealth,
      rank: ranks.get(ai.id) ?? ai.rank,
      inventory: ai.inventory ?? [],
      coffeePurchases: ai.coffeePurchasesThisRound ?? 0,
      slackedBy: ai.slackedBy?.length ?? 0,
    },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      wealth: p.wealth,
      rank: ranks.get(p.id) ?? p.rank,
      connected: p.connected,
    })),
    projects: (game.activeProjects ?? []).map(projectView),
    eraCard: game.currentEraCard
      ? { name: game.currentEraCard.name, era: game.currentEraCard.era }
      : null,
    auction,
    incoming,
    publicChat: GROUP_CHAT_ENABLED ? publicChat : [],
    groupChats: GROUP_CHAT_ENABLED
      ? (game.chatGroups ?? [])
          .filter((g) => g.kind === "custom" && g.memberIds.includes(ai.id))
          .slice(-4)
          .map((g) => ({
            id: g.id,
            name: g.name,
            memberNames: g.memberIds.map(
              (id) => game.players.find((p) => p.id === id)?.name ?? id
            ),
            messages: (game.groupMessages ?? [])
              .filter((m) => m.groupId === g.id)
              .slice(-8)
              .map((m) => ({ fromName: m.fromName, text: m.text })),
          }))
      : [],
  };
}
