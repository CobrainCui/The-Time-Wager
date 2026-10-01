import { AUCTION_CARDS_BY_ROUND, BUFF_CARD_DEFS } from "./buffCards";
import { COFFEE_ENERGY_GAIN, COFFEE_WEALTH_COST } from "./coffeeConfig";

export type HelpTabId =
  | "projects_table"
  | "buffs"
  | "resources"
  | "projects_rules"
  | "flow"
  | "misc";

export interface HelpTabDef {
  id: HelpTabId;
  icon: string;
  title: string;
}

export interface HelpLineDef {
  icon: string;
  text: string;
}

/** 分栏顺序（与产品一致） */
export const HELP_TABS: HelpTabDef[] = [
  { id: "projects_table", icon: "📊", title: "项目数据" },
  { id: "buffs", icon: "🃏", title: "道具卡" },
  { id: "resources", icon: "💎", title: "资源与胜负" },
  { id: "projects_rules", icon: "📋", title: "项目结算规则" },
  { id: "flow", icon: "🔄", title: "阶段流程" },
  { id: "misc", icon: "🤝", title: "转账与私信" },
];

export const HELP_RESOURCES: HelpLineDef[] = [
  { icon: "⚡", text: "精力每轮重置，用于投资项目" },
  { icon: "💰", text: "财富决定排名，最高者可命名社区" },
  { icon: "☕", text: `来杯咖啡：${COFFEE_WEALTH_COST} 财富换 ${COFFEE_ENERGY_GAIN} 精力（可退订）` },
  { icon: "🗓️", text: "共 4 时代，每时代 2 轮" },
  { icon: "🏆", text: "终局按财富决胜负" },
];

export interface HelpRuleSection {
  title: string;
  lines: HelpLineDef[];
}

/** 项目结算 = 基础收益 + 排名奖惩 + 时代奖励，三块分栏说明 */
export const HELP_PROJECT_RULE_SECTIONS: HelpRuleSection[] = [
  {
    title: "基础收益",
    lines: [
      { icon: "🟦", text: "短期：当轮投、当轮结，×10/⚡" },
      { icon: "🟩", text: "长期：完成后个人累计 ×15/⚡（满额或超填均可）；第四时代第二轮未完成按全场进度梯度（不足 1/3→1:1，达 1/3→1:5，达 2/3→1:10）；参投后每轮至少 3⚡，否则 1:1 结算累计并退出完成排名" },
      { icon: "🟥", text: "风险：当轮结算；超上限投爆，追回历史收益" },
    ],
  },
  {
    title: "排名奖惩",
    lines: [
      { icon: "📊", text: "按累计投入排名发放排名奖；短期超上限另有投爆罚（见项目数据表）" },
      { icon: "🤝", text: "投入相同则并列，共享占用名次的奖励/惩罚池并均分（向零取整）" },
    ],
  },
  {
    title: "时代奖励",
    lines: [
      {
        icon: "✨",
        text: "短期恰好满额 +30、长期满/超 +50（契合主题、历史第 1；并列共享）；短期投爆与风险无时代奖励",
      },
    ],
  },
];

export const HELP_FLOW_OVERVIEW = "时代介绍 → 发动道具卡 → 讨论与投资 → 结算 → 拍卖道具卡";

/** 阶段流程：综述 + 分阶段说明 */
export const HELP_FLOW_SECTIONS: HelpRuleSection[] = [
  {
    title: "时代介绍",
    lines: [
      { icon: "🗓️", text: "共4个时代，每时代两轮" },
      { icon: "🔨", text: "两个时代切换时进行拍卖，可使用财富购买道具卡" },
    ],
  },
  {
    title: "发动道具卡（第二时代开始）",
    lines: [
      { icon: "🃏", text: "不限时" },
      { icon: "➡️", text: "预览可投资项目并发动合适的道具卡" },
    ],
  },
  {
    title: "讨论与投资",
    lines: [
      {
        icon: "⏱",
        text: "全员进入后开始倒计时（第 1 时代第 1 轮 12 分钟，其余轮约 10 分钟），在时限内分配精力并提交",
      },
      { icon: "☕", text: `来杯咖啡：${COFFEE_WEALTH_COST} 财富换 ${COFFEE_ENERGY_GAIN} 精力；已提交后若想再改，需联系主持人解锁` },
    ],
  },
  {
    title: "结算",
    lines: [
      { icon: "📊", text: "按累计投入排名结算基础收益、排名奖/罚与时代奖励" },
      { icon: "🤝", text: "投入相同则并列，共享所占用名次档位的奖励/惩罚池并均分（向零取整）" },
    ],
  },
  {
    title: "拍卖道具卡",
    lines: [
      { icon: "🔨", text: "主持人先选定正在拍的卡，大家公开加价，再确认成交" },
      { icon: "🃏", text: "拍得道具卡可在讨论与投资阶段前使用" },
      { icon: "🤝", text: "拍卖期间仍可私信与转账；暂时领先的出价会占用可用财富" },
    ],
  },
];

export const HELP_MISC: HelpLineDef[] = [
  { icon: "💰", text: "转账：填金额发送，对方收/退；金额不得超过可用财富（总额减去领先出价占用与未完成转出）" },
  { icon: "💬", text: "私信：不填金额留言" },
];

const EVERY_AUCTION_BUFF_IDS = new Set(["buff_slack", "buff_work_rest"]);

const cardIdToAuctionRound: Record<string, number> = {};
for (const [round, cards] of Object.entries(AUCTION_CARDS_BY_ROUND)) {
  for (const c of cards) {
    if (!EVERY_AUCTION_BUFF_IDS.has(c.id)) {
      cardIdToAuctionRound[c.id] = Number(round);
    }
  }
}

export interface BuffHelpEntry {
  cardId: string;
  icon: string;
  name: string;
  desc: string;
  auctionRound: number;
  /** 三场拍卖各出现一次 */
  everyAuction?: boolean;
  color: string;
}

export function buildBuffHelpEntries(): BuffHelpEntry[] {
  return Object.entries(BUFF_CARD_DEFS).map(([cardId, def]) => ({
    cardId,
    icon: def.icon,
    name: def.name,
    desc: def.desc,
    color: def.color,
    everyAuction: EVERY_AUCTION_BUFF_IDS.has(cardId),
    auctionRound: cardIdToAuctionRound[cardId] ?? 0,
  }));
}
