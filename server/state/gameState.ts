import { EventCard, EraCard } from "../data/game_data.js";
import { shuffleArray } from "../utils/shuffle.js"; 

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
  era?: string; 

  rankRewards?: number[];
  overInvestPenalty?: number[];
  rate?: number;

  accumulatedInvested: number; 
  currentInvested: number; 

  roundsNoInvestment: number;
  investedThisRound: boolean;

  startRound?: number; 
  eraBonus?: Record<number, number>; 
  
  // ✅ 埋点数据：投资记录、收益记录、总产出
  investorRecords: Record<string, number>;
  earningRecords: Record<string, number>;
  totalPayout: number;
}

export interface ActiveBuff {
  cardId: string;
  targetPlayerId?: string;
  targetProjectId?: number;
  extraData?: any;
}

// ✅ 人格分析详细数据
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
  primaryPersona: string;
}

export interface Player {
  id: string;
  name: string;
  socketId?: string; 

  energy: number;
  wealth: number; 

  connected: boolean;
  ready: boolean; 

  rank: number;
  draftOrder?: number; 

  investment: Record<number, number>;
  longTerm: Record<number, { 
    totalInvested: number; 
    status: "active"|"completed"|"abandoned";
    reward?: number;
  }>;

  riskGains: Record<number, number>;
  inventory: string[];
  usedCards: string[]; 
  activeBuffs: ActiveBuff[];
  
  // ✅ 新增：记录本轮被谁使用了摸鱼传染 (用于反弹琵琶回溯)
  slackedBy: string[];

  // === 数据埋点 ===
  totalEnergyConsumed: number;
  wealthHistory: number[];
  investedRiskEnergy: number;
  investedLongEnergy: number;
  socialRank: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  
  analysisResult?: PersonaAnalysis;

  // === AI 对弈相关 ===
  isAI?: boolean;
  aiPersona?: string; // e.g. "时荫植者", "瞬刻炼金士"
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

  phaseFinished: Set<string>; 
  readyPlayers: Set<string>;  
  discussionEndsAt?: number;
  investmentEndsAt?: number; 
  buffPhaseEndsAt?: number;  
  tutorialStep?: number;    

  draftingState: {
    queue: string[]; 
    currentIndex: number;
    availableSlots: number[];
  };

  transactions: Transaction[];

  currentEra: number;
  roundInEra: number;
  globalRound: number;
  
  eraSequence: number[]; 

  lastEraRanking?: string[]; 

  activeProjects: ActiveProject[];
  uncompletedProjects: ActiveProject[];
  completedProjects: ActiveProject[];
  
  drawnProjects: Set<number>; 
  
  totalRiskEnergyAvailable: number;

  currentEraCard?: EraCard;
  pendingEvents: Record<string, EventCard>; 
  eventCards: Record<string, EventCard>; 
  eventChoices: Record<string, "A" | "B">; 

  logs: string[];
  playerLogs: Record<string, string[]>; 
  lastSettlement?: {
    round: number;
    results: SettlementProjectResult[];
  };

  communityName?: string;
  globalLeaderboard?: { name: string; score: number }[];
}

export function createInitialGame(roomId: string, _playerNames: string[]): GameState {
  const initialEraSequence = shuffleArray([0, 1, 2, 3, 4]);

  return {
    roomId,
    players: [],
    phase: "ERA_INTRO",
    
    phaseFinished: new Set(),
    readyPlayers: new Set(),
    
    draftingState: {
      queue: [],
      currentIndex: 0,
      availableSlots: [1,2,3,4,5,6]
    },

    transactions: [],

    currentEra: 1,
    roundInEra: 1,
    globalRound: 1,
    
    eraSequence: initialEraSequence,

    activeProjects: [],
    uncompletedProjects: [],
    completedProjects: [],
    drawnProjects: new Set(),
    
    totalRiskEnergyAvailable: 0,

    pendingEvents: {},
    eventCards: {},
    eventChoices: {},
    
    logs: [],
    playerLogs: {},

    investmentEndsAt: undefined,
    tutorialStep: 0
  };
}