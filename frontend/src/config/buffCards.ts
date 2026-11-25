export const LIGHTER_CARD_ID = "buff_lighter";

export function formatBuffBullets(bullets: readonly string[]): string {
  return bullets.map((b) => `· ${b}`).join("\n");
}

/** 卡面文案：最多 3 条、每条一句、只留关键数字；完整规则在「指南 → 道具卡」。 */
export const LIGHTER_CARD_BULLETS: readonly string[] = [
  "投资阶段、提交锁定前使用；倒计时最后 2 分钟不可用",
  "指定另一名玩家 + 一种道具；**不可指定自己或打火机**；使用时立即消耗",
  "你看不到对方手牌，也**不会知道是否烧中**；只有被指定者会看到结果",
  "**结算页判定**：先作废本卡生效轮次内已打出的一张该种类；若没有，再查手牌烧一张；**同种类只处理一张**",
  "手牌命中会私下提示对方，确认后移除一张；**没烧中仍消耗**",
];

export const GOLD_CARD_BULLETS: readonly string[] = [
  "项目结算、彩票、保险产生的**正向收益 ×1.5**（向下取整）",
  "放大范围：基础收益、排名奖、时代加成、第四时代未完成长期项目的进度奖、彩票奖金、保险赔付",
  "**惩罚、玩家间转账、放弃结算的返还都不放大**",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const GOLD_CARD_DESCRIPTION = formatBuffBullets(GOLD_CARD_BULLETS);

export const WORK_REST_CARD_BULLETS: readonly string[] = [
  "指定一名在局玩家（可含自己）",
  "他在本卡生效轮次内被【摸鱼传染】时，**不减精力，反而 +8**",
  "发动时**追溯改判**本卡生效轮次内已经发生的摸鱼",
  "同一玩家多个劳逸结合**不叠加**；打火机作废某次摸鱼时，对应改判一并撤销",
  "被撤销后卡不退回手牌，仍作为本卡生效轮次内的被动保留",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const WORK_REST_CARD_DESCRIPTION = formatBuffBullets(WORK_REST_CARD_BULLETS);

export const SHORT_CARD_BULLETS: readonly string[] = [
  "投资阶段、提交锁定前声明；结算页判定",
  "指定一个项目；**全员**在该项目**已积累的精力全部清零**（含长期进度、已投入精力，**含使用者自己**）",
  "**已经入账的财富不追回**",
  "本卡生效轮次内，该项目不再发放回报",
];

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const SHORT_CARD_DESCRIPTION = formatBuffBullets(SHORT_CARD_BULLETS);

export const SLACK_CARD_BULLETS: readonly string[] = [
  "指定一名在局玩家（可含自己），立即生效",
  "目标精力 **-8**（可低于 0）；若因此精力不足，他锁定的投资会自动解锁并可重新提交",
  "目标当前有【劳逸结合】时，改为 **+8 精力**（不减反增）",
  "摸鱼传染、劳逸结合在每场拍卖各可出现一张",
];

export const SLACK_CARD_DESCRIPTION = formatBuffBullets(SLACK_CARD_BULLETS);

export const INSURANCE_CARD_BULLETS: readonly string[] = [
  "只保风险项目；短期、长期项目不赔",
  "**整局曾经投入过**的风险项目，在本卡生效轮次内爆掉，即赔 **100 财富**（即使这轮没有再投）",
  "点石成金会把赔付按 **1.5 倍向下取整**，即 **150 财富**",
  "赔付只看整局历史投入，不要求当前手牌或再次投入",
];

export const INSURANCE_CARD_DESCRIPTION = formatBuffBullets(INSURANCE_CARD_BULLETS);

export const FORCE_BUY_CARD_BULLETS: readonly string[] = [
  "**仅拍卖阶段**可用，每张一次",
  "**免费**获得当前正在拍卖的那张道具卡",
  "默认整局只出现一张；管理端补发的卡也每张只能用一次",
];

export const FORCE_BUY_CARD_DESCRIPTION = formatBuffBullets(FORCE_BUY_CARD_BULLETS);

export const LOTTERY_CARD_BULLETS: readonly string[] = [
  "打出后由系统线上随机掷 1 颗六面骰",
  "1 点 0；2 点 30；3 点 60；4 点 90；5 点 120；6 点 200 财富",
  "本卡生效轮次内持有点石成金时，奖金按 **1.5 倍向下取整**",
];

export const LOTTERY_CARD_DESCRIPTION = formatBuffBullets(LOTTERY_CARD_BULLETS);

/** 与 BUFF_CARD_DEFS、服务端 game_data 一致 */
export const LIGHTER_CARD_DESCRIPTION = formatBuffBullets(LIGHTER_CARD_BULLETS);

/** L3 情境提示（确认框等），禁止整段复制 L1 desc */
export const BUFF_UI_SNIPPETS = {
  lighterUseConfirm: (targetName: string, cardName: string) =>
    `对【${targetName}】烧毁【${cardName}】？\n看不到对方手牌，也不知道是否烧中。\n结算页判定：先作废已打出的一张；没有则烧手牌一张（同种只处理一张）。没烧中仍消耗。`,
  workRestUseConfirm: (targetName: string) =>
    `为【${targetName}】发动劳逸结合？\n本卡生效轮次内被摸鱼时**不减精力，反而 +8**。`,
  buffHelpLinkLabel: "查看完整规则",
  goldSettlementFootnote: () => "点石成金：正收益 ×1.5（向下取整）；惩罚不放大",
} as const;

export type BuffCardDef = {
  name: string;
  desc: string;
  icon: string;
  color: string;
  /** 一句话说明这张卡解决什么问题（卡面标题下方的粗体提示） */
  tagline?: string;
};

export const BUFF_CARD_DEFS: Record<string, BuffCardDef> = {
  buff_slack: {
    name: "摸鱼传染",
    desc: SLACK_CARD_DESCRIPTION,
    icon: "😴",
    color: "#ef4444",
    tagline: "把对手的精力打下去",
  },
  buff_insurance: {
    name: "保险",
    desc: INSURANCE_CARD_DESCRIPTION,
    icon: "🛡️",
    color: "#6366f1",
    tagline: "风险项目爆掉时赔你 100",
  },
  buff_gold: {
    name: "点石成金",
    desc: GOLD_CARD_DESCRIPTION,
    icon: "💰",
    color: "#f59e0b",
    tagline: "让正收益变成 1.5 倍",
  },
  buff_force_buy: {
    name: "强买强卖",
    desc: FORCE_BUY_CARD_DESCRIPTION,
    icon: "🤝",
    color: "#a855f7",
    tagline: "拍卖时免费拿走一张",
  },
  buff_short: {
    name: "项目做空",
    desc: SHORT_CARD_DESCRIPTION,
    icon: "📉",
    color: "#3b82f6",
    tagline: "把一个项目的全场投入清零",
  },
  buff_work_rest: {
    name: "劳逸结合",
    desc: WORK_REST_CARD_DESCRIPTION,
    icon: "⚖️",
    color: "#10b981",
    tagline: "把针对你的摸鱼变成 +8 精力",
  },
  buff_lighter: {
    name: "打火机",
    desc: LIGHTER_CARD_DESCRIPTION,
    icon: "🔥",
    color: "#f97316",
    tagline: "猜一种道具，烧掉对手的一张",
  },
  buff_lottery: {
    name: "彩票",
    desc: LOTTERY_CARD_DESCRIPTION,
    icon: "🎲",
    color: "#ec4899",
    tagline: "掷骰子，最高 200 财富",
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
