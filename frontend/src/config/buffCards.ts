export const LIGHTER_CARD_ID = "buff_lighter";

export function formatBuffBullets(bullets: readonly string[]): string {
  return bullets.map((b) => `· ${b}`).join("\n");
}

/**
 * 卡面文案原则：最多 3–4 条、每条一句、保留关键数字。
 * 例外流程（打火机）才允许 4 条以上；完整规则在「指南 → 道具卡」里。
 */
export const LIGHTER_CARD_BULLETS: readonly string[] = [
  "投资阶段、锁定前使用；最后 2 分钟不能再用",
  "指定一名玩家 + 一种道具；**看不到对方手牌，也不知道有没有烧中**",
  "结算页判定：**先作废生效期间已打出的一张**；没有就烧手牌，同种类只处理一张",
  "**没烧中仍然消耗**；只有被指定者会收到提示",
];

export const GOLD_CARD_BULLETS: readonly string[] = [
  "项目、彩票、保险的**正收益 ×1.5**（向下取整）",
  "排名奖、时代加成、终局进度奖同样放大",
  "**惩罚不放大**；转账与放弃结算的返还也不放大",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const GOLD_CARD_DESCRIPTION = formatBuffBullets(GOLD_CARD_BULLETS);

export const WORK_REST_CARD_BULLETS: readonly string[] = [
  "指定一名玩家",
  "他被摸鱼时改为 **+8 精力**",
  "发动时**追溯**生效期间已发生的摸鱼；多张不叠加",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const WORK_REST_CARD_DESCRIPTION = formatBuffBullets(WORK_REST_CARD_BULLETS);

export const SHORT_CARD_BULLETS: readonly string[] = [
  "投资阶段、锁定前指定一个项目",
  "结算时该项目**全场累计精力清零**（含自己）",
  "**已入账的财富不追回**",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const SHORT_CARD_DESCRIPTION = formatBuffBullets(SHORT_CARD_BULLETS);

export const SLACK_CARD_BULLETS: readonly string[] = [
  "指定一名玩家（可以选自己）",
  "精力 **-8**，可以低于 0；已锁定的投资会自动解锁",
  "对方生效期间有【劳逸结合】时改为 **+8 精力**",
];

export const SLACK_CARD_DESCRIPTION = formatBuffBullets(SLACK_CARD_BULLETS);

export const INSURANCE_CARD_BULLETS: readonly string[] = [
  "只保风险项目；整局投过就能赔",
  "该项目爆掉 → **赔 100 财富**",
  "点石成金可把赔付放大 1.5 倍",
];

export const INSURANCE_CARD_DESCRIPTION = formatBuffBullets(INSURANCE_CARD_BULLETS);

export const FORCE_BUY_CARD_BULLETS: readonly string[] = [
  "**仅拍卖阶段**可用，每张一次",
  "**免费**拿走当前拍品",
  "默认整局只有一张（补发除外）",
];

export const FORCE_BUY_CARD_DESCRIPTION = formatBuffBullets(FORCE_BUY_CARD_BULLETS);

export const LOTTERY_CARD_BULLETS: readonly string[] = [
  "打出后系统掷 1 颗骰子开奖",
  "1–6 点 → **0 / 30 / 60 / 90 / 120 / 200** 财富",
  "点石成金可放大奖金",
];

export const LOTTERY_CARD_DESCRIPTION = formatBuffBullets(LOTTERY_CARD_BULLETS);

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const LIGHTER_CARD_DESCRIPTION = formatBuffBullets(LIGHTER_CARD_BULLETS);

/** L3 情境提示（确认框等），禁止整段复制 L1 desc */
export const BUFF_UI_SNIPPETS = {
  lighterUseConfirm: (targetName: string, cardName: string) =>
    `对【${targetName}】指定烧毁【${cardName}】？\n你看不到对方手牌，也不会知道是否烧中。\n结算页判定：**先作废已打出的一张；没有再烧手牌一张**；同种类多张也只处理一张；没烧中则**无效仍消耗**，被指定者会收到未烧中提示。`,
  workRestUseConfirm: (targetName: string) =>
    `为【${targetName}】发动劳逸结合？\n在本卡生效轮次内被摸鱼传染时**不减精力，反而增加 8 点精力**。`,
  buffHelpLinkLabel: "在指南中查看全部道具",
  goldSettlementFootnote: () => `道具「点石成金」：${stripGoldFootnote(GOLD_CARD_DESCRIPTION)}`,
} as const;

function stripGoldFootnote(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, "$1");
}

export type BuffCardDef = { name: string; desc: string; icon: string; color: string };

export const BUFF_CARD_DEFS: Record<string, BuffCardDef> = {
  buff_slack: {
    name: "摸鱼传染",
    desc: SLACK_CARD_DESCRIPTION,
    icon: "😴",
    color: "#ef4444",
  },
  buff_insurance: {
    name: "保险",
    desc: INSURANCE_CARD_DESCRIPTION,
    icon: "🛡️",
    color: "#6366f1",
  },
  buff_gold: {
    name: "点石成金",
    desc: GOLD_CARD_DESCRIPTION,
    icon: "💰",
    color: "#f59e0b",
  },
  buff_force_buy: {
    name: "强买强卖",
    desc: FORCE_BUY_CARD_DESCRIPTION,
    icon: "🤝",
    color: "#a855f7",
  },
  buff_short: {
    name: "项目做空",
    desc: SHORT_CARD_DESCRIPTION,
    icon: "📉",
    color: "#3b82f6",
  },
  buff_work_rest: {
    name: "劳逸结合",
    desc: WORK_REST_CARD_DESCRIPTION,
    icon: "⚖️",
    color: "#10b981",
  },
  buff_lighter: {
    name: "打火机",
    desc: LIGHTER_CARD_DESCRIPTION,
    icon: "🔥",
    color: "#f97316",
  },
  buff_lottery: {
    name: "彩票",
    desc: LOTTERY_CARD_DESCRIPTION,
    icon: "🎲",
    color: "#ec4899",
  },
};

/** 拍卖参考价（仅 UI 示意，不含规则正文） */
export const BUFF_AUCTION_REFERENCE_PRICE: Record<string, number> = {
  buff_slack: 70,
  buff_insurance: 90,
  buff_gold: 80,
  buff_force_buy: 75,
  buff_short: 60,
  buff_work_rest: 65,
  buff_lighter: 55,
  buff_lottery: 50,
};

export function getBuffDef(cardId: string): BuffCardDef & { price?: number } {
  const base = BUFF_CARD_DEFS[cardId] ?? {
    name: cardId,
    desc: "",
    icon: "❓",
    color: "#6b7280",
  };
  const price = BUFF_AUCTION_REFERENCE_PRICE[cardId];
  return price != null ? { ...base, price } : base;
}

/** 打火机可指定的卡种（全道具池除打火机本身） */
export const LIGHTER_BURN_TARGET_OPTIONS = Object.entries(BUFF_CARD_DEFS)
  .filter(([id]) => id !== LIGHTER_CARD_ID)
  .map(([id, def]) => ({ id, label: def.name }))
  .sort((a, b) => a.label.localeCompare(b.label, "zh"));

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
