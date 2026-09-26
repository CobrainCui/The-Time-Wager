/** 与 server/data/game_data.ts 对齐；改 server 时需同步此处 */

export type CatalogProjectType = "short" | "long" | "risk";

export interface ProjectCatalogEntry {
  id: number;
  name: string;
  type: CatalogProjectType;
  era: string;
  maxEnergy: number;
  rankRewards?: number[];
  overInvestPenalty?: number[];
  /** 速查用一句话 */
  baseReturnHint: string;
}

function riskRate(name: string): number {
  if (name.includes("成瘾") || name.includes("完美") || name.includes("幸福")) return 25;
  return 20;
}

function riskHint(name: string): string {
  return `${riskRate(name)}/⚡/轮`;
}

const short: ProjectCatalogEntry[] = [
  { id: 1, name: "新能源汽车", type: "short", era: "气候", maxEnergy: 23, rankRewards: [45, 30, 20, 15, 10, 5], overInvestPenalty: [-35, -20, -15, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 2, name: "兴建巨型水坝", type: "short", era: "气候", maxEnergy: 30, rankRewards: [55, 35, 25, 20, 15, 5], overInvestPenalty: [-40, -25, -20, -15, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 3, name: "视频会议", type: "short", era: "科技", maxEnergy: 23, rankRewards: [45, 30, 20, 15, 10, 5], overInvestPenalty: [-35, -20, -15, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 4, name: "数字地图", type: "short", era: "科技", maxEnergy: 18, rankRewards: [30, 20, 15, 10, 5, 5], overInvestPenalty: [-25, -15, -10, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 5, name: "国际文化艺术节", type: "short", era: "文化", maxEnergy: 18, rankRewards: [30, 20, 15, 10, 5, 5], overInvestPenalty: [-25, -15, -10, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 6, name: "民俗主题公园", type: "short", era: "文化", maxEnergy: 30, rankRewards: [55, 35, 25, 20, 15, 5], overInvestPenalty: [-40, -25, -20, -15, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 7, name: "公共体育设施免费开放", type: "short", era: "健康", maxEnergy: 23, rankRewards: [45, 30, 20, 15, 10, 5], overInvestPenalty: [-35, -20, -15, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 8, name: "“全民健身日”嘉年华", type: "short", era: "健康", maxEnergy: 18, rankRewards: [30, 20, 15, 10, 5, 5], overInvestPenalty: [-25, -15, -10, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 9, name: "数字排毒", type: "short", era: "心理", maxEnergy: 23, rankRewards: [45, 30, 20, 15, 10, 5], overInvestPenalty: [-35, -20, -15, -10, -5, -5], baseReturnHint: "10/⚡/轮" },
  { id: 10, name: "EAP全面推行", type: "short", era: "心理", maxEnergy: 30, rankRewards: [55, 35, 25, 20, 15, 5], overInvestPenalty: [-40, -25, -20, -15, -5, -5], baseReturnHint: "10/⚡/轮" },
];

const long: ProjectCatalogEntry[] = [
  { id: 101, name: "植树造林", type: "long", era: "气候", maxEnergy: 70, rankRewards: [65, 45, 35, 25, 20, 10], baseReturnHint: "完成后15/有效精力" },
  { id: 102, name: "城市海绵体改造", type: "long", era: "气候", maxEnergy: 80, rankRewards: [70, 50, 40, 30, 23, 13], baseReturnHint: "完成后15/有效精力" },
  { id: 103, name: "数字图书馆", type: "long", era: "科技", maxEnergy: 70, rankRewards: [65, 45, 35, 25, 20, 10], baseReturnHint: "完成后15/有效精力" },
  { id: 104, name: "遗产保护基金", type: "long", era: "文化", maxEnergy: 70, rankRewards: [65, 45, 35, 25, 20, 10], baseReturnHint: "完成后15/有效精力" },
  { id: 105, name: "文化桥梁使者", type: "long", era: "文化", maxEnergy: 80, rankRewards: [70, 50, 40, 30, 23, 13], baseReturnHint: "完成后15/有效精力" },
  { id: 106, name: "建立体育俱乐部", type: "long", era: "健康", maxEnergy: 70, rankRewards: [65, 45, 35, 25, 20, 10], baseReturnHint: "完成后15/有效精力" },
  { id: 107, name: "心理学教育普及", type: "long", era: "心理", maxEnergy: 90, rankRewards: [75, 55, 45, 35, 25, 15], baseReturnHint: "完成后15/有效精力" },
];

const risk: ProjectCatalogEntry[] = [
  { id: 201, name: "开采化石能源", type: "risk", era: "气候", maxEnergy: 12, baseReturnHint: riskHint("开采化石能源") },
  { id: 202, name: "成瘾算法", type: "risk", era: "科技", maxEnergy: 8, baseReturnHint: riskHint("成瘾算法") },
  { id: 203, name: "数据监控", type: "risk", era: "科技", maxEnergy: 12, baseReturnHint: riskHint("数据监控") },
  { id: 204, name: "文化商品化", type: "risk", era: "文化", maxEnergy: 12, baseReturnHint: riskHint("文化商品化") },
  { id: 205, name: "营养代餐", type: "risk", era: "健康", maxEnergy: 12, baseReturnHint: riskHint("营养代餐") },
  { id: 206, name: "完美身材", type: "risk", era: "健康", maxEnergy: 8, baseReturnHint: riskHint("完美身材") },
  { id: 207, name: "幸福药丸", type: "risk", era: "心理", maxEnergy: 8, baseReturnHint: riskHint("幸福药丸") },
  { id: 208, name: "大师速成班", type: "risk", era: "心理", maxEnergy: 12, baseReturnHint: riskHint("大师速成班") },
];

export const PROJECT_CATALOG: ProjectCatalogEntry[] = [...short, ...long, ...risk];

export const PROJECT_CATALOG_BY_ID: Record<number, ProjectCatalogEntry> = Object.fromEntries(
  PROJECT_CATALOG.map((p) => [p.id, p])
);

export function formatTop3(nums?: number[]): string {
  if (!nums?.length) return "—";
  return nums.slice(0, 3).join("/");
}

/** 短期超投爆雷时，按历史投入排名前三的惩罚（与 server overInvestPenalty 一致） */
export function formatShortBurstPenaltyTop3(entry: ProjectCatalogEntry): string {
  if (entry.type !== "short" || !entry.overInvestPenalty?.length) return "—";
  return entry.overInvestPenalty.slice(0, 3).join("/");
}

export const TYPE_LABEL: Record<CatalogProjectType, string> = {
  short: "短期",
  long: "长期",
  risk: "风险",
};

/** 与 ProjectCard 类型色一致，用于速查等纯文字标注 */
export const TYPE_TEXT_COLOR: Record<CatalogProjectType, string> = {
  short: "#93c5fd",
  long: "#6ee7b7",
  risk: "#fca5a5",
};
