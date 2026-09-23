import { ActiveProject, EraCard, Player } from "../types";

const emptyProjectFields = {
  currentInvested: 0,
  roundsNoInvestment: 0,
  investedThisRound: false,
  investorRecords: {},
  earningRecords: {},
  totalPayout: 0,
};

export const TUTORIAL_PLAYER_WEALTH = 100;

export function createTutorialPlayer(overrides: Partial<Player> = {}): Player {
  const wealth = overrides.wealth ?? TUTORIAL_PLAYER_WEALTH;
  return {
    id: "tutorial-me",
    name: "你",
    energy: 10,
    wealth,
    connected: true,
    ready: false,
    rank: 3,
    investment: {},
    longTerm: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 0,
    wealthHistory: [wealth],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    socialRank: null,
    ...overrides,
  };
}

export const TUTORIAL_SHORT_PROJECT: ActiveProject = {
  id: 9001,
  name: "营养代餐",
  type: "short",
  maxEnergy: 20,
  accumulatedInvested: 8,
  era: "健康",
  ...emptyProjectFields,
};

export const TUTORIAL_LONG_PROJECT: ActiveProject = {
  id: 9002,
  name: "植树造林",
  type: "long",
  maxEnergy: 30,
  accumulatedInvested: 12,
  era: "气候",
  ...emptyProjectFields,
};

export const TUTORIAL_RISK_PROJECT: ActiveProject = {
  id: 9003,
  name: "成瘾算法",
  type: "risk",
  maxEnergy: 15,
  accumulatedInvested: 10,
  era: "科技",
  ...emptyProjectFields,
};

export const TUTORIAL_ERA_OPTIONS: EraCard[] = [
  {
    id: 1,
    name: "气候变迁",
    era: "气候",
    description: "绿色与可持续成为主旋律",
    themeColor: "green",
  },
  {
    id: 2,
    name: "数字星河",
    era: "科技",
    description: "技术重塑生活与产业",
    themeColor: "blue",
  },
  {
    id: 3,
    name: "心灵觉醒",
    era: "心理",
    description: "关注内在与社群连结",
    themeColor: "red",
  },
  {
    id: 4,
    name: "多元交响",
    era: "文化",
    description: "文明互鉴与创意繁荣",
    themeColor: "yellow",
  },
];

export const TUTORIAL_ERA_SAMPLE_PROJECT: ActiveProject = {
  id: 9004,
  name: "城市海绵体改造",
  type: "short",
  maxEnergy: 18,
  accumulatedInvested: 5,
  era: "气候",
  ...emptyProjectFields,
};

export interface TutorialNpc {
  id: string;
  name: string;
  wealth: number;
  draftOrder?: number;
}

export const TUTORIAL_NPCS: TutorialNpc[] = [
  { id: "npc-a", name: "小林", wealth: 60, draftOrder: 1 },
  { id: "npc-b", name: "阿杰", wealth: 120, draftOrder: 2 },
  { id: "npc-c", name: "美玲", wealth: 200 },
];

export const TUTORIAL_SHOP_CARDS = ["buff_gold", "buff_spirit", "buff_insurance", "buff_lottery"] as const;
