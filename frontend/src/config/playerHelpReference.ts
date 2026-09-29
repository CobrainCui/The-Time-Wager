import { AUCTION_CARDS_BY_ROUND, BUFF_CARD_DEFS } from "./buffCards";

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
      { icon: "🟩", text: "长期：完成后结算，×15/⚡；终局未完成按梯度（1:1 / 1:5 / 1:10）；每轮至少投入 3⚡" },
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
      { icon: "⏱", text: "全员进入后开始约 10 分钟倒计时，在时限内分配精力并提交" },
      { icon: "☕", text: "可消耗财富换取额外精力（来杯咖啡）；已提交后若想再改，需联系主持人解锁" },
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
      { icon: "🔨", text: "竞拍本场放出的道具卡，价高者得" },
      { icon: "🃏", text: "拍得道具卡可在讨论与投资阶段前使用" },
    ],
  },
];

export const HELP_MISC: HelpLineDef[] = [
  { icon: "💰", text: "转账：填金额发送，对方收/退" },
  { icon: "💬", text: "私信：不填金额留言" },
];

const cardIdToAuctionRound: Record<string, number> = {};
for (const [round, cards] of Object.entries(AUCTION_CARDS_BY_ROUND)) {
  for (const c of cards) {
    cardIdToAuctionRound[c.id] = Number(round);
  }
}

export interface BuffHelpEntry {
  cardId: string;
  icon: string;
  name: string;
  desc: string;
  auctionRound: number;
  color: string;
}

export function buildBuffHelpEntries(): BuffHelpEntry[] {
  return Object.entries(BUFF_CARD_DEFS).map(([cardId, def]) => ({
    cardId,
    icon: def.icon,
    name: def.name,
    desc: def.desc,
    color: def.color,
    auctionRound: cardIdToAuctionRound[cardId] ?? 0,
  }));
}
