export type Phase =
  | "ROOM_WAITING"
  | "ERA_INTRO"
  | "TUTORIAL"
  | "AUCTION"
  | "BUFF_USAGE"
  | "INVESTMENT"
  | "SETTLEMENT"
  | "COMMUNITY_NAMING"
  | "GAME_OVER";

export interface Transaction {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amount: number;
  note: string;
  status: "pending" | "accepted" | "rejected";
  timestamp: number;
  /** 客户端乐观发送 id，用于一对一对账去重 */
  clientTempId?: string;
}

export interface ActiveProject {
  id: number;
  name: string;
  type: "short" | "long" | "risk";
  color?: string; 
  maxEnergy: number;
  
  accumulatedInvested: number; 
  currentInvested: number; 

  rankRewards?: number[];
  overInvestPenalty?: number[];
  rate?: number;
  roundsNoInvestment: number; 
  investedThisRound: boolean;
  era?: string;

  investorRecords: Record<string, number>;
  earningRecords: Record<string, number>;
  totalPayout: number;
}

export interface BuffCard {
  id: string;
  name: string;
  type: 'gain' | 'interfere' | 'special';
  description: string;
  auctionRound: number;
}

export interface ActiveBuff {
  cardId: string;
  targetPlayerId?: string;
  targetProjectId?: number;
  extraData?: any;
}

export interface LongTermProgress {
  projectId: number;
  totalInvested: number;
  status: "active" | "completed" | "abandoned";
  reward?: number;
}

export interface PersonaAnalysis {
  scores: {
    longTermism: number;
    shortTermism: number;
    riskTaking: number;
    ruleIntervention: number;
    socialConnection: number;
    resourceConversion: number;
  };
  personaScores: {
    compass: number;
    gardener: number;
    trigger: number;
    alchemist: number;
  };
  primaryPersona: string;   // 命运素描
  primaryPersonaDesc: string;
  mbtiPersona?: {
    code: string; // e.g., "LADV"
    label: string; // e.g., "长线激进·创业者"
    desc: string;
    axes: {
      Time: { code: string; percent: number }; // code 'L' or 'Q'
      Risk: { code: string; percent: number }; // code 'A' or 'G'
      Disruption: { code: string; percent: number }; // code 'D' or 'C'
      Motivation: { code: string; percent: number }; // code 'V' or 'R'
    };
    axisScores: { longShort: number; riskConserv: number; disruptFollow: number; profitSocial: number };
  };
}

export interface Player {
  id: string;
  name: string;
  energy: number;
  wealth: number; 
  connected: boolean;
  ready: boolean; 
  rank: number;
  investment: Record<number, number>;
  investmentDraft?: Record<number, number>;
  longTerm: Record<number, LongTermProgress>;

  inventory: string[]; 
  usedCards: string[];
  activeBuffs: ActiveBuff[];
  
  // ✅ 新增：记录本轮被谁使用了摸鱼传染，用于反弹琵琶的回溯判定
  slackedBy: string[];

  /** 本轮已购咖啡杯数（服务端权威） */
  coffeePurchasesThisRound?: number;

  totalEnergyConsumed: number; 
  wealthHistory: number[];     
  investedRiskEnergy: number;  
  investedLongEnergy: number;  
  socialRank: 'A' | 'B' | 'C' | 'D' | 'E' | null; 
  
  analysisResult?: PersonaAnalysis; 

  isAI?: boolean;
  aiPersona?: string;
}

export interface EventOption {
  energyChange: number;
  wealthChange: number;
  description: string;
}

export interface EventCard {
  id: number;
  name: string;
  description: string;
  optionA: EventOption;
  optionB: EventOption;
}

export interface EraCard {
  id: number;
  name: string;
  era: string;
  description: string;
  themeColor: string;
}

export interface GainBreakdown {
  total: number;
  base: number;
  rank: number;
  era: number;
}

export interface SettlementProjectResult {
  projectId: number;
  name: string;
  type: "short" | "long" | "risk";
  maxEnergy: number;
  totalInvested: number;
  isExploded: boolean;
  isCompleted: boolean;
  playerInvestments: Record<string, number>; 
  playerGains: Record<string, GainBreakdown>;
}

export interface GameState {
  roomId: string;
  players: Player[];
  phase: Phase;

  readyPlayers: string[]; 
  phaseFinished: string[];

  transactions: Transaction[];

  currentEra: number;
  roundInEra: number;
  globalRound: number;
  /** 开局锁定的人数；第 1 轮消耗前可能随座位重锁 */
  energyTableSize?: number;
  /** 服务端按锁定人数算出的下一轮精力；终局为 null */
  nextRoundEnergy?: number | null;

  discussionEndsAt?: number;
  investmentEndsAt?: number;
  buffPhaseEndsAt?: number;
  /** 与 investmentEndsAt 同包下发，用于校正倒计时 */
  serverNow?: number;
  tutorialStep?: number;

  activeProjects: ActiveProject[];
  uncompletedProjects: ActiveProject[];
  completedProjects: ActiveProject[];
  /** 本局曾抽出的项目 id（含已离场） */
  drawnProjects?: number[];

  totalRiskEnergyAvailable: number;

  currentEraCard?: EraCard;
  pendingEvents?: Record<string, EventCard>; 

  logs: string[];

  lastSettlement?: {
    round: number;
    results: SettlementProjectResult[];
  };
  
  communityName?: string;
  globalLeaderboard?: { name: string; score: number; recordedAt?: number }[];
  /** 本轮拍卖已成功成交的道具卡 id */
  auctionDistributedCardIds?: string[];
  /** 本场拍卖成交明细（主持撤销发放用） */
  auctionCompletedDeals?: { cardId: string; playerId: string; cost: number }[];
  /** 仅管理端上帝视图：待玩家确认的拍卖报价 */
  pendingAuctionOffers?: { offerId: string; playerId: string; cardId: string; cost: number }[];
  /** 仅管理端：待玩家确认的彩票开奖 */
  pendingLotteryOffers?: { offerId: string; playerId: string; amount: number }[];
  /** 仅本人：待确认的彩票开奖（刷新/重连后仍显示弹窗） */
  pendingLotteryOffer?: { offerId: string; playerId: string; amount: number };
  /** 仅管理端：已确认彩票开奖 */
  lotteryCompletedDeals?: { playerId: string; amount: number }[];
}