export type Phase =
  | "ERA_INTRO"
  | "TUTORIAL"
  | "AUCTION"
  | "BUFF_USAGE"
  | "PROJECT_SETUP"
  | "DRAFTING"
  | "INVESTMENT"
  | "SETTLEMENT"
  | "ERA_TRANSITION"
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
  draftOrder?: number; 
  investment: Record<number, number>;
  longTerm: Record<number, LongTermProgress>;

  inventory: string[]; 
  usedCards: string[];
  activeBuffs: ActiveBuff[];
  
  // ✅ 新增：记录本轮被谁使用了摸鱼传染，用于反弹琵琶的回溯判定
  slackedBy: string[];

  totalEnergyConsumed: number; 
  wealthHistory: number[];     
  investedRiskEnergy: number;  
  investedLongEnergy: number;  
  socialRank: 'A' | 'B' | 'C' | 'D' | 'E' | null; 
  
  analysisResult?: PersonaAnalysis; 
  personaVote?: "fate" | "gene" | "neither" | null;
  longTermStatus?: Record<number, 'investing' | 'abandoned'>;
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

  draftingState: {
    queue: string[];
    currentIndex: number;
    availableSlots: number[];
  };

  currentEra: number;
  roundInEra: number;
  globalRound: number;

  discussionEndsAt?: number;
  investmentEndsAt?: number;
  buffPhaseEndsAt?: number;
  tutorialStep?: number;

  activeProjects: ActiveProject[];
  uncompletedProjects: ActiveProject[];
  completedProjects: ActiveProject[];
  
  totalRiskEnergyAvailable: number;

  currentEraCard?: EraCard;
  pendingEvents?: Record<string, EventCard>; 

  logs: string[];

  lastSettlement?: {
    round: number;
    results: SettlementProjectResult[];
  };
  
  communityName?: string;
  globalLeaderboard?: { name: string; score: number }[];
}