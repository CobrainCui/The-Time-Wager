import type {
  ActiveProject,
  ChatGroup,
  GroupMessage,
  LabAgentDecision,
  LabDirectMessage,
  LabInteractionMode,
  LabPrediction,
  LabRoomMeta,
  LabThinkingMode,
  Transaction,
} from "../state/gameState.js";
import type { SessionTelemetry } from "../state/sessionTelemetry.js";

export type LabRunStatus = "running" | "completed" | "failed" | "stopped";
export type LabSessionStatus = "completed" | "failed" | "stopped";

export interface LabRunManifest {
  runId: string;
  name: string;
  condition: string;
  notes: string;
  seedBase: number;
  games: number;
  createdAt: string;
  gitCommit: string | null;
  promptVersion: string;
  promptHash: string;
  models: string[];
  providers: string[];
  temperature: number;
  tokenBudgetPerAgent: number;
  maxOutputTokens: number;
  maxRetries: number;
  chatEnabled: boolean;
  memoryEnabled: boolean;
  predictionEnabled: boolean;
  autoSocialScore: boolean;
  mock: boolean;
  roomId: string;
  interactionMode?: LabInteractionMode;
  thinkingMode?: LabThinkingMode;
  publicChatEnabled?: boolean;
  privateChatEnabled?: boolean;
  customGroupsEnabled?: boolean;
  transferEnabled?: boolean;
  auctionEnabled?: boolean;
  buffCardsEnabled?: boolean;
  coffeeEnabled?: boolean;
  customSystemPrompt?: string;
}

export interface LabSessionQc {
  sessionId: string;
  runId: string;
  condition: string;
  seedBase: number;
  seed: number;
  playerCount: number;
  phase: string;
  currentEra: number;
  roundInEra: number;
  globalRound: number;
  predictions: number;
  publicMessages: number;
  privateMessages: number;
  agentDecisions: number;
  totalTokensUsed: number;
  maxAgentTokensUsed: number;
  tokenBudgetExceeded: boolean;
  mock: boolean;
  valid: boolean;
  reasons: string[];
  warnings: string[];
}

export interface LabPlayerMetrics {
  playerId: string;
  name: string;
  seat: number;
  isAgent: boolean;
  agentIndex: number | null;
  model: string;
  provider: string;
  finalWealth: number;
  finalRank: number;
  socialRank: "A" | "B" | "C" | "D" | "E" | null;
  socialRankReason: string;
  tokensUsed: number;
  longEnergy: number;
  shortEnergy: number;
  riskEnergy: number;
  totalInvestedEnergy: number;
  longShare: number;
  shortShare: number;
  riskShare: number;
  transfersSent: number;
  transfersReceived: number;
  transferAmountSent: number;
  transferAmountReceived: number;
  transferReturnRate: number;
  mutualTransferPartners: number;
  publicMessages: number;
  privateMessages: number;
  privatePartners: number;
  auctionBids: number;
  auctionWins: number;
  auctionSpend: number;
  avgBidToAvailableRatio: number | null;
  buffsUsed: number;
  attacksInitiated: number;
  attacksReceived: number;
  predictionCount: number;
  predictionTau: number | null;
  predictionMae: number | null;
  outDegree: number;
  inDegree: number;
}

export interface LabGameMetrics {
  playerCount: number;
  finalized: boolean;
  totalWealth: number;
  minWealth: number;
  maxWealth: number;
  negativeWealthPlayers: number;
  wealthRange: number;
  wealthCv: number;
  gini: number;
  giniNonNegative: number;
  transferCount: number;
  transferVolume: number;
  transferReciprocity: number;
  publicMessageCount: number;
  privateMessageCount: number;
  attackCount: number;
  auctionBidCount: number;
  auctionSpend: number;
  predictionCount: number;
  meanPredictionTau: number | null;
  meanPredictionMae: number | null;
  totalTokensUsed: number;
  modelMix: Record<string, number>;
}

export interface LabSessionMetrics {
  generatedAt: number;
  game: LabGameMetrics;
  players: LabPlayerMetrics[];
  predictionScores: Array<{
    predictionId: string;
    playerId: string;
    playerName: string;
    era: number;
    globalRound: number;
    tau: number;
    mae: number;
  }>;
}

export interface LabSessionExport {
  meta: {
    exportSchemaVersion: string;
    analysisWeightsVersion: string;
    roomId: string;
    sessionId: string | null;
    communityName: string | null;
    playerCount: number;
    energyTableSize: number | null;
    eraSequence: number[];
    eraThemeNames: string[];
    eraTheme: string | null;
    phase: string;
    currentEra: number;
    roundInEra: number;
    globalRound: number;
    sessionStartedAt: number | null;
    exportedAt: number;
    experiment: LabRunManifest | LabRoomMeta | Record<string, unknown> | null;
    seedBase: number | null;
    seed: number | null;
    sessionOrdinal: number | null;
    condition: string | null;
    runId: string | null;
    promptVersion: string | null;
    promptHash: string | null;
    gitCommit: string | null;
    mock: boolean;
    policyMode: string;
    nodeVersion: string;
    models: string[];
  };
  players: Array<{
    id: string;
    name: string;
    isAI: boolean;
    aiPersona: string;
    isAgent: boolean;
    agentIndex: number | null;
    agentPersona: string;
    agentModel: string;
    agentProvider: string;
    energy: number;
    wealth: number;
    rank: number;
    connected: boolean;
    socialRank: "A" | "B" | "C" | "D" | "E" | null;
    socialRankReason?: string;
    tokensUsed?: number;
    totalEnergyConsumed: number;
    investedLongEnergy: number;
    investedShortEnergy: number;
    investedRiskEnergy: number;
    wealthHistory: string;
    fatePersona: string;
    geneCode: string;
    ruleEnginePersona: unknown;
    inventory: string[];
    usedCards: string[];
    activeBuffs: Array<{
      cardId: string;
      targetPlayerId: string | null;
      targetProjectId: number | null;
    }>;
    longTerm: Record<string, unknown>;
    riskGains: Record<string, unknown>;
  }>;
  projects: Array<{
    id: number;
    name: string;
    type: ActiveProject["type"];
    maxEnergy: number;
    era?: string;
    list: "active" | "completed" | "uncompleted";
    accumulatedInvested: number;
    investorRecords: Record<string, number>;
    earningRecords: Record<string, number>;
    totalPayout: number;
  }>;
  transactions: Transaction[];
  chatGroups: ChatGroup[];
  groupMessages: GroupMessage[];
  directMessages: LabDirectMessage[];
  predictions: LabPrediction[];
  agentDecisions: LabAgentDecision[];
  metrics: LabSessionMetrics;
  auctionBids: Array<{
    bidId: string;
    auctionRound: number;
    cardId: string;
    playerId: string;
    playerName: string;
    amount: number;
    wealthAtBid: number;
    availableWealthAtBid: number;
    bidToAvailableRatio: number | null;
    timestamp: number;
    status: string;
  }>;
  auctionCompletedDeals: Array<{
    cardId: string;
    playerId: string;
    cost: number;
    source?: string;
    auctionRound?: number;
  }>;
  lotteryDeals: Array<{
    playerId: string;
    creditedAmount: number;
    enteredAmount: number | null;
    goldApplied: boolean | null;
  }>;
  settlementHistory: SessionTelemetry["settlementHistory"];
  events: SessionTelemetry["events"];
  logs: string[];
  globalLeaderboard: unknown[];
}

export interface LabPlayerSummary {
  id?: string;
  name: string;
  wealth: number;
  agentIndex?: number | null;
  model?: string;
  provider?: string;
  socialRank?: "A" | "B" | "C" | "D" | "E" | null;
  socialRankReason?: string;
  tokensUsed?: number;
}

export interface LabSessionRecord {
  sessionId: string;
  runId: string;
  condition: string;
  seedBase: number;
  seed: number;
  sessionOrdinal: number;
  roomId: string;
  communityName: string;
  communityWealth: number;
  playerCount: number;
  sessionStartedAt: number | null;
  completedAt: number;
  eraTheme: string | null;
  topPlayer: { name: string; wealth: number };
  playersSummary: LabPlayerSummary[];
  status: LabSessionStatus;
  failureReason?: string;
  mock: boolean;
  qc: LabSessionQc;
  snapshot: LabSessionExport;
}

export interface LabRunRecord {
  runId: string;
  manifest: LabRunManifest;
  status: LabRunStatus;
  completedGames: number;
  failedGames: number;
  currentGameIndex: number;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  failureReason?: string;
  sessionIds: string[];
  migratedFromAgentEdition?: boolean;
}

export interface LabStartParams {
  condition: string;
  name?: string;
  notes?: string;
  games: number;
  seedBase?: number;
  chatEnabled: boolean;
  memoryEnabled: boolean;
  predictionEnabled: boolean;
  autoSocialScore: boolean;
  mock: boolean;
  tokenBudgetPerAgent: number;
  models: string[];
  interactionMode?: LabInteractionMode;
  thinkingMode?: LabThinkingMode;
  publicChatEnabled?: boolean;
  privateChatEnabled?: boolean;
  customGroupsEnabled?: boolean;
  transferEnabled?: boolean;
  auctionEnabled?: boolean;
  buffCardsEnabled?: boolean;
  coffeeEnabled?: boolean;
  customSystemPrompt?: string;
}

export interface LabLiveStatus {
  running: boolean;
  runId: string | null;
  condition: string | null;
  name: string | null;
  roomId: string | null;
  currentGameIndex: number;
  totalGames: number;
  completedGames: number;
  startedAt: number | null;
  elapsedMs: number;
  phase: string | null;
  currentEra: number;
  roundInEra: number;
  globalRound: number;
  mock: boolean;
  tokenBudgetPerAgent: number;
  seats: Array<{
    agentIndex: number;
    playerId: string;
    name: string;
    model: string;
    tokensUsed: number;
    wealth: number;
    thinking: boolean;
  }>;
  recentLogs: string[];
}
