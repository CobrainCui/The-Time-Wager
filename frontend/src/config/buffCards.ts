export const BUFF_CARD_DEFS: Record<string, { name: string; desc: string; icon: string; color: string }> = {
  buff_gold: {
    name: "点石成金",
    desc: "在本轮结算时，你参与项目的收益按 1.5 倍计算。",
    icon: "💰",
    color: "#f59e0b",
  },
  buff_short: {
    name: "项目做空",
    desc: "指定一个项目并猜测其本轮结果；猜对可获得额外财富奖励。",
    icon: "📉",
    color: "#3b82f6",
  },
  buff_slack: {
    name: "摸鱼传染",
    desc: "指定一名对手，使其在本轮损失 5 点精力。",
    icon: "😴",
    color: "#ef4444",
  },
  buff_rebound: {
    name: "反弹琵琶",
    desc: "开启护盾后，可将针对你的负面效果反弹给攻击者。",
    icon: "🎸",
    color: "#10b981",
  },
  buff_insurance: {
    name: "保险",
    desc: "被动生效：当风险项目爆雷时，你获得 100 财富赔付。",
    icon: "🛡️",
    color: "#6366f1",
  },
  buff_spirit: {
    name: "精神老伙",
    desc: "使用后立即获得 5 点精力，便于追加投资或应对消耗。",
    icon: "🔥",
    color: "#f97316",
  },
  buff_swap: {
    name: "偷天换日",
    desc: "在选座阶段指定一名对手，与其交换座位顺位。",
    icon: "🔄",
    color: "#a855f7",
  },
  buff_lottery: {
    name: "彩票",
    desc: "支付成本后由主持人掷骰开奖，结果可大幅增减你的财富。",
    icon: "🎲",
    color: "#ec4899",
  },
};

export const AUCTION_CARDS_BY_ROUND: Record<number, { id: string; name: string }[]> = {
  1: [
    { id: "buff_gold", name: "点石成金" },
    { id: "buff_short", name: "项目做空" },
  ],
  2: [
    { id: "buff_slack", name: "摸鱼传染" },
    { id: "buff_rebound", name: "反弹琵琶" },
    { id: "buff_insurance", name: "保险" },
  ],
  3: [
    { id: "buff_spirit", name: "精神老伙" },
    { id: "buff_swap", name: "偷天换日" },
    { id: "buff_lottery", name: "彩票" },
  ],
};

export function getAuctionRound(currentEra: number): number {
  return Math.max(1, Math.min(currentEra - 1, 3));
}

export function getAuctionCardsForEra(currentEra: number) {
  const round = getAuctionRound(currentEra);
  return AUCTION_CARDS_BY_ROUND[round] || AUCTION_CARDS_BY_ROUND[1];
}
