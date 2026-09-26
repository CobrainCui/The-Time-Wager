import { EventCard, EraCard, eraCards } from "../data/game_data.js";
import { shuffleArray } from "../utils/shuffle.js";
import { emptySessionTelemetry, SessionTelemetry } from "./sessionTelemetry.js";

export type Phase =
  | "ROOM_WAITING"
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
export interface MbtiPersona {
  code: string; // e.g., "LADV"
  label: string; // e.g., "长线激进·创业者"
  desc: string;
  axes: {
    Time: { code: string; percent: number }; // code 'L' or 'Q'
    Risk: { code: string; percent: number }; // code 'A' or 'G'
    Disruption: { code: string; percent: number }; // code 'D' or 'C'
    Motivation: { code: string; percent: number }; // code 'V' or 'R'
  };
  axisScores: {
    longShort: number;      // 正=偏长期，负=偏短期
    riskConserv: number;    // 0~100，>50=激进
    disruptFollow: number;  // 0~100，>50=破坏
    profitSocial: number;   // 正=利益导向，负=社交导向
  };
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
  primaryPersona: string;  // 命运素描
  primaryPersonaDesc: string;
  mbtiPersona: MbtiPersona; // 决策基因
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
  /** 讨论/投资阶段本地预填，倒计时结束时服务端据此自动提交 */
  investmentDraft?: Record<number, number>;
  /** 提交投资前快照，供上帝解锁时恢复空提交前的预填 */
  preSubmitInvestmentDraft?: Record<number, number>;
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
  personaVote?: "fate" | "gene" | "neither" | null;
  longTermStatus?: Record<number, 'investing' | 'abandoned'>;

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
  globalLeaderboard?: { name: string; score: number; roomId?: string; recordedAt?: number }[];
  /** 本轮拍卖已成功成交的道具卡 id */
  auctionDistributedCardIds?: string[];
  /** 进入 TUTORIAL 前的阶段，用于教程结束后判断是否全量 reset */
  tutorialEntryPhase?: Phase;

  /** 本局开始时间（首次正式开局） */
  sessionStartedAt?: number;
  /** 行为流水与结算历史（不广播给玩家客户端） */
  sessionTelemetry?: SessionTelemetry;
}

export function createInitialGame(roomId: string, _playerNames: string[]): GameState {
  const initialEraSequence = shuffleArray([0, 1, 2, 3, 4]);

  return {
    roomId,
    players: [],
    phase: "ROOM_WAITING",
    
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
    currentEraCard: eraCards.find(c => c.id === (initialEraSequence[0] + 1)) || eraCards[0],

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
    tutorialStep: 0,

    sessionTelemetry: emptySessionTelemetry(),
  };
}

function freshPlayerFromIdentity(
  meta: Pick<Player, "id" | "name" | "socketId" | "connected" | "isAI" | "aiPersona">
): Player {
  return {
    id: meta.id,
    name: meta.name,
    socketId: meta.socketId,
    connected: meta.connected,
    isAI: meta.isAI,
    aiPersona: meta.aiPersona,
    ready: false,
    energy: 15,
    wealth: 0,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: 15,
    wealthHistory: [0],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    socialRank: null,
  };
}

/** 同一房间新开一局：保留玩家身份，其余对齐 createInitialGame */
export function resetGameSession(game: GameState): void {
  const preserved = game.players.map((p) => ({
    id: p.id,
    name: p.name,
    socketId: p.socketId,
    connected: p.connected,
    isAI: p.isAI,
    aiPersona: p.aiPersona,
  }));

  const fresh = createInitialGame(game.roomId, []);
  fresh.players = preserved.map(freshPlayerFromIdentity);
  fresh.logs.push("🔄 新一局已开始，状态已重置");

  game.players = fresh.players;
  game.phase = fresh.phase;
  game.phaseFinished = fresh.phaseFinished;
  game.readyPlayers = fresh.readyPlayers;
  game.draftingState = fresh.draftingState;
  game.transactions = fresh.transactions;
  game.currentEra = fresh.currentEra;
  game.roundInEra = fresh.roundInEra;
  game.globalRound = fresh.globalRound;
  game.eraSequence = fresh.eraSequence;
  game.lastEraRanking = undefined;
  game.activeProjects = fresh.activeProjects;
  game.uncompletedProjects = fresh.uncompletedProjects;
  game.completedProjects = fresh.completedProjects;
  game.drawnProjects = fresh.drawnProjects;
  game.totalRiskEnergyAvailable = fresh.totalRiskEnergyAvailable;
  game.currentEraCard = fresh.currentEraCard;
  game.pendingEvents = fresh.pendingEvents;
  game.eventCards = fresh.eventCards;
  game.eventChoices = fresh.eventChoices;
  game.logs = fresh.logs;
  game.playerLogs = fresh.playerLogs;
  game.investmentEndsAt = undefined;
  game.buffPhaseEndsAt = undefined;
  game.discussionEndsAt = undefined;
  game.tutorialStep = 0;
  game.tutorialEntryPhase = undefined;
  game.lastSettlement = undefined;
  game.communityName = undefined;
  game.globalLeaderboard = undefined;
  game.auctionDistributedCardIds = undefined;
  game.sessionStartedAt = undefined;
  game.sessionTelemetry = emptySessionTelemetry();
}

export function needsSessionReset(game: GameState): boolean {
  if (game.phase === "GAME_OVER" || game.phase === "COMMUNITY_NAMING") return true;
  if (game.communityName) return true;
  if (game.players.some((p) => p.analysisResult)) return true;
  return false;
}

/** 教程结束（或从教程直接开局）时：必要时全量 reset，否则回到开局前 ERA_INTRO */
export function finishTutorialExit(game: GameState): void {
  if (shouldResetAfterTutorial(game)) {
    resetGameSession(game);
  } else {
    game.phase = "ROOM_WAITING";
    game.tutorialStep = 0;
    game.tutorialEntryPhase = undefined;
  }
}

export function getWealthiestPlayer(game: GameState): Player | undefined {
  if (game.players.length === 0) return undefined;
  return game.players.reduce((best, p) => (p.wealth > best.wealth ? p : best), game.players[0]);
}

export function shouldResetAfterTutorial(game: GameState): boolean {
  const entry = game.tutorialEntryPhase;
  if (!entry) return false;
  if (entry !== "ERA_INTRO" && entry !== "TUTORIAL") return true;
  if (game.currentEra > 1 || game.roundInEra > 1 || game.globalRound > 1) return true;
  if (game.lastSettlement) return true;
  if (game.activeProjects.length > 0) return true;
  if (game.players.some((p) => p.wealth > 0 || (p.inventory?.length ?? 0) > 0)) return true;
  return false;
}