export type LabRunStatus = "running" | "completed" | "failed" | "stopped";
export type LabSessionStatus = "completed" | "failed" | "stopped";
export type LabInteractionMode = "guided_two_step" | "free_two_step" | "free_one_step";
export type LabThinkingMode = "fast" | "moderate" | "deep";

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

export interface SiliconFlowModelOption {
  id: string;
  label: string;
  vendor: string;
}

export interface SiliconFlowModelGroup {
  vendor: string;
  models: SiliconFlowModelOption[];
}

export interface LabConfigSummary {
  keyConfigured: boolean;
  provider: string;
  siliconflowBaseUrl: string;
  defaultModel: string;
  defaultSeatModels: string[];
  modelPoolGroups: SiliconFlowModelGroup[];
  suggestedModels: string[];
  temperature: number;
  productTokenBudgetPerAgent: number;
  defaultLabTokenBudgetPerAgent: number;
  minTokenBudgetPerAgent: number;
  maxTokenBudgetPerAgent: number;
  promptVersion: string;
  promptHash: string;
  defaultBehaviorPrompts?: Record<LabInteractionMode, string>;
  activeRun: LabLiveStatus;
}

export interface LabPreflightResult {
  ok: boolean;
  error?: string;
  results: Array<{
    model: string;
    ok: boolean;
    latencyMs: number;
    error?: string;
  }>;
}

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

export interface LabSessionListItem {
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
}

export interface LabRunWithSessions {
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
  sessions: LabSessionListItem[];
}

export interface LabRunsResponse {
  runs: LabRunWithSessions[];
  stats: {
    totalRuns: number;
    completedRealSessions: number;
    failedOrStoppedSessions: number;
    mockSessions: number;
  };
}

export interface LabSessionDetail extends LabSessionListItem {
  snapshot: {
    meta: Record<string, unknown>;
    players: Array<{
      id: string;
      name: string;
      agentIndex?: number | null;
      agentModel?: string;
      agentProvider?: string;
      wealth: number;
      rank: number;
      socialRank?: string | null;
      socialRankReason?: string;
      tokensUsed?: number;
    }>;
    groupMessages: Array<{
      id: string;
      groupId: string;
      fromId: string;
      fromName: string;
      text: string;
      timestamp: number;
    }>;
    chatGroups?: Array<{
      id: string;
      name: string;
      kind: "public" | "custom";
      memberIds: string[];
    }>;
    directMessages: Array<{
      id: string;
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      text: string;
      timestamp: number;
      era: number;
      globalRound: number;
    }>;
    predictions: Array<{
      id: string;
      playerId: string;
      playerName: string;
      era: number;
      globalRound: number;
      ranking: string[];
      reasoning: string;
      model?: string;
      timestamp: number;
    }>;
    agentDecisions: Array<{
      id: string;
      timestamp: number;
      phase: string;
      era: number;
      roundInEra: number;
      globalRound: number;
      playerId: string;
      playerName: string;
      kind: string;
      model?: string;
      reasoning: string;
      rawThinking?: string;
      action: unknown;
      totalTokens?: number;
      latencyMs?: number;
    }>;
    projects?: Array<{
      id: number;
      name: string;
      type: string;
      maxEnergy?: number;
    }>;
    transactions?: Array<{
      id: string;
      fromId: string;
      fromName: string;
      toId: string;
      toName: string;
      amount: number;
      note: string;
      status: string;
      timestamp: number;
    }>;
    metrics?: {
      game: {
        totalWealth: number;
        wealthRange: number;
        gini: number;
        giniNonNegative: number;
        wealthCv: number;
        transferCount: number;
        transferVolume: number;
        transferReciprocity: number;
        publicMessageCount: number;
        privateMessageCount: number;
        attackCount: number;
        auctionSpend: number;
        meanPredictionTau: number | null;
        meanPredictionMae: number | null;
        totalTokensUsed?: number;
      };
      players: Array<{
        playerId: string;
        name: string;
        agentIndex: number | null;
        model: string;
        finalWealth: number;
        finalRank: number;
        socialRank?: string | null;
        socialRankReason?: string;
        tokensUsed?: number;
        longShare: number;
        riskShare: number;
        transfersSent: number;
        transfersReceived: number;
        publicMessages: number;
        privateMessages: number;
        predictionTau: number | null;
        predictionMae: number | null;
      }>;
      predictionScores: Array<{
        predictionId: string;
        playerId: string;
        playerName: string;
        era: number;
        tau: number;
        mae: number;
      }>;
    };
  };
}
