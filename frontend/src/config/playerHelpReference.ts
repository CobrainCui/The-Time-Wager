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
  { id: "projects_rules", icon: "📋", title: "项目规则" },
  { id: "flow", icon: "🔄", title: "阶段流程" },
  { id: "misc", icon: "🤝", title: "社交与其它" },
];

export const HELP_RESOURCES: HelpLineDef[] = [
  { icon: "⚡", text: "精力每轮重置，用于投资项目" },
  { icon: "💰", text: "财富决定排名，最高者可命名社区" },
  { icon: "🗓️", text: "共 4 时代，每时代 2 轮" },
  { icon: "🏆", text: "终局按财富决胜负" },
];

export const HELP_PROJECT_RULES: HelpLineDef[] = [
  { icon: "🟦", text: "短期：当轮投、当轮结，×10/⚡" },
  { icon: "🟩", text: "长期：每轮至少 3⚡，否则放弃；完成奖 15/有效精力" },
  { icon: "🟥", text: "风险：超上限爆，追回历史收益" },
  { icon: "💺", text: "超限时顺位靠前者先占坑" },
  { icon: "✨", text: "时代加成：短期恰好满额 +30、长期满/超 +50（契合主题、历史第 1）；短期爆与风险无" },
];

export const HELP_FLOW: HelpLineDef[] = [
  { icon: "🌍", text: "时代介绍 → 拍卖 → 选座" },
  { icon: "🃏", text: "道具不限时；全员「进入讨论和投资」后开始 10 分钟并进入投资" },
  { icon: "💸", text: "选座：财富越少越先选顺位" },
];

export const HELP_MISC: HelpLineDef[] = [
  { icon: "💰", text: "填金额发送 = 转账，对方收/退" },
  { icon: "💬", text: "不填金额留言 = 私信" },
  { icon: "🅰️", text: "社交档 A–E 由现场评分" },
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
