export const BUFF_CARD_DEFS: Record<string, { name: string; desc: string; icon: string; color: string }> = {
  buff_slack: {
    name: "摸鱼传染",
    desc: "指定一名在局玩家（含自己），使其精力 -8（不低于 0）。若对方发动【劳逸结合】，对方改为获得 8 精力。",
    icon: "😴",
    color: "#ef4444",
  },
  buff_insurance: {
    name: "保险",
    desc: "本轮你参与的风险项目投爆则赔付 100。点石成金可作用于保险赔付。",
    icon: "🛡️",
    color: "#6366f1",
  },
  buff_gold: {
    name: "点石成金",
    desc: "本轮你的项目基础回报、正的排名与时代加成，以及保险赔付与彩票入账，按 1.5 倍（向下取整）。惩罚不放大。",
    icon: "💰",
    color: "#f59e0b",
  },
  buff_force_buy: {
    name: "强买强卖",
    desc: "仅能在拍卖阶段使用一次，免费将当前正在拍卖的道具卡入手。",
    icon: "🤝",
    color: "#a855f7",
  },
  buff_short: {
    name: "项目做空",
    desc: "指定一个本轮可投入的项目。结算时该项目所有人已积累的精力清零（含长期累计）。已经入账的财富不追回，本轮不再发放回报。",
    icon: "📉",
    color: "#3b82f6",
  },
  buff_work_rest: {
    name: "劳逸结合",
    desc: "被使用【摸鱼传染】后获得 8 精力。单独使用无效。",
    icon: "⚖️",
    color: "#10b981",
  },
  buff_lighter: {
    name: "打火机",
    desc: "投资阶段指定其他玩家，从其本局拍卖所得且仍在手牌的道具中选一张烧毁。须早于对方发动该卡或锁定投资；是否命中不公开。",
    icon: "🔥",
    color: "#f97316",
  },
  buff_lottery: {
    name: "彩票",
    desc: "玩家通过实体骰子决定奖金。由主持人输入金额。若你本轮打出了点石成金，入账按 1.5 倍（向下取整）。",
    icon: "🎲",
    color: "#ec4899",
  },
};

export const AUCTION_CARDS_BY_ROUND: Record<number, { id: string; name: string }[]> = {
  1: [
    { id: "buff_insurance", name: "保险" },
    { id: "buff_gold", name: "点石成金" },
    { id: "buff_slack", name: "摸鱼传染" },
    { id: "buff_work_rest", name: "劳逸结合" },
  ],
  2: [
    { id: "buff_force_buy", name: "强买强卖" },
    { id: "buff_slack", name: "摸鱼传染" },
    { id: "buff_work_rest", name: "劳逸结合" },
    { id: "buff_short", name: "项目做空" },
  ],
  3: [
    { id: "buff_lighter", name: "打火机" },
    { id: "buff_lottery", name: "彩票" },
    { id: "buff_slack", name: "摸鱼传染" },
    { id: "buff_work_rest", name: "劳逸结合" },
  ],
};

export function getAuctionRound(currentEra: number): number {
  return Math.max(1, Math.min(currentEra - 1, 3));
}

export function getAuctionCardsForEra(currentEra: number) {
  const round = getAuctionRound(currentEra);
  return AUCTION_CARDS_BY_ROUND[round] || AUCTION_CARDS_BY_ROUND[1];
}

export type AuctionCompletedDealView = {
  cardId: string;
  playerId: string;
  cost: number;
  auctionRound?: number;
  source?: "hammer" | "force_buy";
};

/** 当前拍卖场次下的成交记录（同牌跨场不混淆） */
export function findAuctionDealForSession(
  deals: AuctionCompletedDealView[] | undefined,
  cardId: string,
  currentEra: number,
  distributedIds: readonly string[]
): AuctionCompletedDealView | undefined {
  const round = getAuctionRound(currentEra);
  const list = deals ?? [];
  const forRound = list.find((d) => d.cardId === cardId && d.auctionRound === round);
  if (forRound) return forRound;
  if (distributedIds.includes(cardId)) {
    return list.find((d) => d.cardId === cardId && d.auctionRound == null);
  }
  return undefined;
}
