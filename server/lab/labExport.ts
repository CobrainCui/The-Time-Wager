import ExcelJS from "exceljs";
import { eraCards } from "../data/game_data.js";
import { EXPORT_SCHEMA_VERSION, getAnalysisWeightsVersion } from "../export/constants.js";
import {
  contentDispositionAttachment,
  safeExportBasename,
  sanitizeCell,
} from "../export/sessionExport.js";
import type { ActiveProject, GameState, Player } from "../state/gameState.js";
import { emptySessionTelemetry } from "../state/sessionTelemetry.js";
import { computeWealthRanks } from "../util/playerRank.js";
import { computeLabSessionMetrics } from "./labMetrics.js";
import type {
  LabRunRecord,
  LabSessionExport,
  LabSessionQc,
  LabSessionRecord,
} from "./labTypes.js";

type ProjectListKind = "active" | "completed" | "uncompleted";

function uniqueProjectsWithList(
  game: GameState
): Array<ActiveProject & { list: ProjectListKind }> {
  const bags: Array<{ list: ProjectListKind; items: ActiveProject[] }> = [
    { list: "active", items: game.activeProjects },
    { list: "completed", items: game.completedProjects },
    { list: "uncompleted", items: game.uncompletedProjects },
  ];
  const seen = new Set<number>();
  const out: Array<ActiveProject & { list: ProjectListKind }> = [];
  for (const bag of bags) {
    for (const p of bag.items) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ ...p, list: bag.list });
    }
  }
  return out;
}

function eraThemeNames(eraSequence: number[]): string[] {
  return eraSequence.map((idx) => {
    const card = eraCards.find((c) => c.id === idx + 1);
    return card?.name ?? `era_${idx}`;
  });
}

function playerExportRow(p: Player, tokensUsed: number) {
  return {
    id: p.id,
    name: p.name,
    isAI: p.isAI ?? true,
    aiPersona: p.aiPersona ?? "",
    isAgent: p.isAgent ?? true,
    agentIndex: p.agentIndex ?? null,
    agentPersona: "",
    agentModel: p.agentModel ?? "",
    agentProvider: p.agentProvider ?? "",
    energy: p.energy,
    wealth: p.wealth,
    rank: p.rank,
    connected: p.connected,
    socialRank: p.socialRank,
    socialRankReason: p.socialRankReason ?? "",
    tokensUsed,
    totalEnergyConsumed: p.totalEnergyConsumed,
    investedLongEnergy: p.investedLongEnergy,
    investedShortEnergy: p.investedShortEnergy,
    investedRiskEnergy: p.investedRiskEnergy,
    wealthHistory: p.wealthHistory.join(","),
    fatePersona: p.analysisResult?.primaryPersona ?? "",
    geneCode: p.analysisResult?.mbtiPersona?.code ?? "",
  };
}

export function buildLabSessionExport(game: GameState): LabSessionExport {
  const ranks = computeWealthRanks(game.players);
  for (const p of game.players) p.rank = ranks.get(p.id) ?? p.rank;
  const tel = game.sessionTelemetry ?? emptySessionTelemetry();
  const exportedAt = Date.now();
  const metrics = computeLabSessionMetrics(game);
  const lab = game.labMeta;
  const tokenUsage = game.labTokenUsage ?? {};

  return {
    meta: {
      exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      analysisWeightsVersion: getAnalysisWeightsVersion(),
      roomId: game.roomId,
      sessionId: game.sessionId ?? null,
      communityName: game.communityName ?? null,
      playerCount: game.players.length,
      energyTableSize: game.energyTableSize ?? null,
      eraSequence: game.eraSequence,
      eraThemeNames: eraThemeNames(game.eraSequence),
      eraTheme: game.currentEraCard?.name ?? null,
      phase: game.phase,
      currentEra: game.currentEra,
      roundInEra: game.roundInEra,
      globalRound: game.globalRound,
      sessionStartedAt: game.sessionStartedAt ?? null,
      exportedAt,
      experiment: lab ?? null,
      seedBase: lab?.seedBase ?? null,
      seed: lab?.seed ?? null,
      sessionOrdinal: lab?.sessionOrdinal ?? null,
      condition: lab?.condition ?? null,
      runId: lab?.runId ?? null,
      promptVersion: lab?.promptVersion ?? null,
      promptHash: lab?.promptHash ?? null,
      gitCommit: lab?.gitCommit ?? null,
      mock: lab?.mock ?? false,
      policyMode: "llm",
      nodeVersion: process.version,
      models: Array.from(
        new Set(
          game.players
            .map((p) => [p.agentProvider, p.agentModel].filter(Boolean).join("/"))
            .filter(Boolean)
        )
      ),
    },
    players: game.players.map((p) => ({
      ...playerExportRow(p, tokenUsage[p.id] ?? 0),
      ruleEnginePersona: p.analysisResult
        ? { source: "rule_engine", data: p.analysisResult }
        : null,
      inventory: p.inventory,
      usedCards: p.usedCards,
      activeBuffs: (p.activeBuffs ?? []).map((b) => ({
        cardId: b.cardId,
        targetPlayerId: b.targetPlayerId ?? null,
        targetProjectId: b.targetProjectId ?? null,
      })),
      longTerm: p.longTerm,
      riskGains: p.riskGains,
    })),
    projects: uniqueProjectsWithList(game).map((proj) => ({
      id: proj.id,
      name: proj.name,
      type: proj.type,
      maxEnergy: proj.maxEnergy,
      era: proj.era,
      list: proj.list,
      accumulatedInvested: proj.accumulatedInvested,
      investorRecords: proj.investorRecords,
      earningRecords: proj.earningRecords,
      totalPayout: proj.totalPayout,
    })),
    transactions: game.transactions,
    chatGroups: game.chatGroups ?? [],
    groupMessages: game.groupMessages ?? [],
    directMessages: game.labDirectMessages ?? [],
    predictions: game.labPredictions ?? [],
    agentDecisions: game.labAgentDecisions ?? [],
    metrics,
    auctionBids: game.auctionBids ?? [],
    auctionCompletedDeals: game.auctionCompletedDeals ?? [],
    lotteryDeals: (game.lotteryCompletedDeals ?? []).map((d) => ({
      playerId: d.playerId,
      creditedAmount: d.amount,
      enteredAmount: d.enteredAmount ?? null,
      goldApplied: d.goldApplied ?? null,
    })),
    settlementHistory: tel.settlementHistory,
    events: tel.events,
    logs: game.logs,
    globalLeaderboard: [],
  };
}

export function buildLabSessionQc(
  snapshot: LabSessionExport,
  opts: {
    runId: string;
    condition: string;
    seedBase: number;
    seed: number;
    chatEnabled: boolean;
    predictionEnabled: boolean;
    tokenBudgetPerAgent: number;
    mock: boolean;
    status: "completed" | "failed" | "stopped";
    failureReason?: string;
  }
): LabSessionQc {
  const meta = snapshot.meta;
  const problems: string[] = [];
  const warnings: string[] = [];

  if (opts.status !== "completed") {
    problems.push(opts.failureReason || `status_${opts.status}`);
  }
  if (meta.playerCount !== 6) {
    problems.push(`playerCount=${meta.playerCount}`);
  }
  if (meta.phase !== "GAME_OVER" || meta.globalRound !== 8 || meta.currentEra !== 4) {
    problems.push(`incomplete(${meta.phase},era=${meta.currentEra},round=${meta.globalRound})`);
  }
  const predictions = snapshot.predictions?.length ?? 0;
  if (opts.predictionEnabled && predictions < 24) {
    warnings.push(`predictions=${predictions}/24`);
  }
  const publicMessages = snapshot.groupMessages?.length ?? 0;
  const privateMessages = snapshot.directMessages?.length ?? 0;
  if (opts.chatEnabled && publicMessages + privateMessages === 0) {
    warnings.push("chat_enabled_but_zero_messages");
  }
  const agentDecisions = snapshot.agentDecisions?.length ?? 0;
  if (agentDecisions === 0) {
    warnings.push("zero_agent_decisions");
  }

  let totalTokensUsed = 0;
  let maxAgentTokensUsed = 0;
  for (const p of snapshot.players) {
    const used = Number(p.tokensUsed ?? 0);
    totalTokensUsed += used;
    if (used > maxAgentTokensUsed) maxAgentTokensUsed = used;
  }
  if (totalTokensUsed === 0 && (snapshot.agentDecisions?.length ?? 0) > 0) {
    const byPlayer = new Map<string, number>();
    for (const d of snapshot.agentDecisions) {
      const t = Number(d.totalTokens ?? 0);
      totalTokensUsed += t;
      byPlayer.set(d.playerId, (byPlayer.get(d.playerId) ?? 0) + t);
    }
    for (const v of byPlayer.values()) {
      if (v > maxAgentTokensUsed) maxAgentTokensUsed = v;
    }
  }

  const tokenBudgetExceeded =
    opts.tokenBudgetPerAgent > 0 && maxAgentTokensUsed > opts.tokenBudgetPerAgent;
  if (tokenBudgetExceeded) {
    problems.push(`token_budget_exceeded(${maxAgentTokensUsed}>${opts.tokenBudgetPerAgent})`);
  }
  if (opts.mock) {
    warnings.push("mock_data");
  }

  return {
    sessionId: meta.sessionId ?? "",
    runId: opts.runId,
    condition: opts.condition,
    seedBase: opts.seedBase,
    seed: opts.seed,
    playerCount: meta.playerCount,
    phase: meta.phase,
    currentEra: meta.currentEra,
    roundInEra: meta.roundInEra,
    globalRound: meta.globalRound,
    predictions,
    publicMessages,
    privateMessages,
    agentDecisions,
    totalTokensUsed,
    maxAgentTokensUsed,
    tokenBudgetExceeded,
    mock: opts.mock,
    valid: problems.length === 0,
    reasons: problems,
    warnings,
  };
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Record<string, unknown>[]): void {
  const ws = wb.addWorksheet(name);
  const headers = Object.keys(rows[0] ?? { 提示: "" });
  ws.columns = headers.map((h) => ({ header: h, key: h }));
  for (const row of rows) {
    ws.addRow(row);
  }
}

/** 1 档：单局 16 表精细复盘 Excel */
export async function buildLabSessionWorkbook(exportData: LabSessionExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const metaRows = Object.entries(exportData.meta).map(([k, v]) => ({
    字段: k,
    值: sanitizeCell(typeof v === "object" && v !== null ? JSON.stringify(v) : v),
  }));
  addSheet(wb, "概览", metaRows);

  const playerSheet = exportData.players.map((p) => ({
    玩家ID: p.id,
    昵称: sanitizeCell(p.name),
    AI: p.isAI,
    Agent: p.isAgent,
    Agent序号: p.agentIndex,
    Agent人格: sanitizeCell(p.agentPersona),
    Agent模型: sanitizeCell(p.agentModel),
    Agent供应商: sanitizeCell(p.agentProvider),
    财富: p.wealth,
    精力: p.energy,
    排名: p.rank,
    社交档: p.socialRank ?? "",
    社交依据: sanitizeCell(p.socialRankReason ?? ""),
    消耗Token: p.tokensUsed ?? 0,
    长期精力: p.investedLongEnergy,
    短期精力: p.investedShortEnergy,
    风险精力: p.investedRiskEnergy,
    财富曲线: p.wealthHistory,
    命运素描: sanitizeCell(p.fatePersona),
    决策基因: p.geneCode,
  }));
  addSheet(wb, "玩家", playerSheet.length ? playerSheet : [{ 提示: "无玩家" }]);

  const gameMetricRows = Object.entries(exportData.metrics.game).map(([k, v]) => ({
    指标: k,
    值: sanitizeCell(typeof v === "object" && v !== null ? JSON.stringify(v) : v),
  }));
  addSheet(wb, "指标汇总", gameMetricRows.length ? gameMetricRows : [{ 提示: "无指标" }]);

  const metricSheet = exportData.metrics.players.map((m) => ({
    座位: m.seat,
    玩家ID: m.playerId,
    昵称: sanitizeCell(m.name),
    Agent: m.isAgent,
    Agent序号: m.agentIndex,
    供应商: sanitizeCell(m.provider),
    模型: sanitizeCell(m.model),
    最终财富: m.finalWealth,
    最终名次: m.finalRank,
    社交档: m.socialRank ?? "",
    消耗Token: m.tokensUsed ?? 0,
    长期精力: m.longEnergy,
    短期精力: m.shortEnergy,
    风险精力: m.riskEnergy,
    总投入精力: m.totalInvestedEnergy,
    长期占比: m.longShare,
    短期占比: m.shortShare,
    风险占比: m.riskShare,
    转出次数: m.transfersSent,
    转入次数: m.transfersReceived,
    转出金额: m.transferAmountSent,
    转入金额: m.transferAmountReceived,
    转账回报率: m.transferReturnRate,
    互惠对手数: m.mutualTransferPartners,
    公开发言: m.publicMessages,
    私聊条数: m.privateMessages,
    私聊对象数: m.privatePartners,
    拍卖出价次数: m.auctionBids,
    拍卖得标次数: m.auctionWins,
    拍卖花费: m.auctionSpend,
    平均出价占可用: m.avgBidToAvailableRatio ?? "",
    使用道具次数: m.buffsUsed,
    主动干扰次数: m.attacksInitiated,
    被干扰次数: m.attacksReceived,
    预测次数: m.predictionCount,
    预测KendallTau: m.predictionTau ?? "",
    预测名次MAE: m.predictionMae ?? "",
    出度: m.outDegree,
    入度: m.inDegree,
  }));
  addSheet(wb, "指标", metricSheet.length ? metricSheet : [{ 提示: "无指标" }]);

  const eventRows = exportData.events.map((e) => ({
    时间: new Date(e.timestamp).toISOString(),
    类型: e.type,
    玩家ID: e.playerId ?? "",
    详情: sanitizeCell(JSON.stringify(e.payload)),
  }));
  addSheet(wb, "事件", eventRows.length ? eventRows : [{ 提示: "无事件" }]);

  const settlementRows: Record<string, unknown>[] = [];
  for (const round of exportData.settlementHistory ?? []) {
    for (const res of round.results) {
      for (const [pid, invest] of Object.entries(res.playerInvestments)) {
        const gain = res.playerGains[pid];
        settlementRows.push({
          轮次: round.round,
          时代: round.currentEra,
          时代内轮: round.roundInEra,
          项目ID: res.projectId,
          项目: sanitizeCell(res.name),
          项目类型: res.type,
          玩家ID: pid,
          投入: invest,
          收益: gain?.total ?? 0,
          收益基础: gain?.base ?? 0,
          收益排名: gain?.rank ?? 0,
          收益时代: gain?.era ?? 0,
          点石前基础: gain?.baseBeforeGold ?? "",
          点石前排名: gain?.rankBeforeGold ?? "",
          点石前时代: gain?.eraBeforeGold ?? "",
          投爆: res.isExploded && res.type !== "long",
          超额完成: res.type === "long" && res.isExploded && res.isCompleted,
          完成: res.isCompleted,
          做空: res.shortSold === true,
        });
      }
    }
  }
  addSheet(wb, "结算", settlementRows.length ? settlementRows : [{ 提示: "无结算" }]);

  const txRows = (exportData.transactions ?? []).map((t) => ({
    时间: new Date(t.timestamp).toISOString(),
    发起: sanitizeCell(t.fromName),
    接收: sanitizeCell(t.toName),
    金额: t.amount,
    备注: sanitizeCell(t.note),
    状态: t.status,
  }));
  addSheet(wb, "转账", txRows.length ? txRows : [{ 提示: "无转账" }]);

  const groupNameById = new Map((exportData.chatGroups ?? []).map((g) => [g.id, g.name]));
  const groupRows = (exportData.groupMessages ?? []).map((m) => ({
    时间: new Date(m.timestamp).toISOString(),
    群名: sanitizeCell(groupNameById.get(m.groupId) ?? m.groupId),
    发送者: sanitizeCell(m.fromName),
    内容: sanitizeCell(m.text),
  }));
  addSheet(wb, "群聊", groupRows.length ? groupRows : [{ 提示: "无群聊" }]);

  const dmRows = (exportData.directMessages ?? []).map((m) => ({
    时间: new Date(m.timestamp).toISOString(),
    时代: m.era,
    轮: m.globalRound,
    发送者ID: m.fromId,
    发送者: sanitizeCell(m.fromName),
    接收者ID: m.toId,
    接收者: sanitizeCell(m.toName),
    内容: sanitizeCell(m.text),
  }));
  addSheet(wb, "私聊", dmRows.length ? dmRows : [{ 提示: "无私聊" }]);

  const playerNameById = new Map(exportData.players.map((p) => [p.id, p.name]));
  const predictionScoreById = new Map(
    (exportData.metrics.predictionScores ?? []).map((s) => [s.predictionId, s])
  );
  const predictionRows = (exportData.predictions ?? []).map((p) => {
    const score = predictionScoreById.get(p.id);
    return {
      时间: new Date(p.timestamp).toISOString(),
      时代: p.era,
      全局轮: p.globalRound,
      玩家ID: p.playerId,
      玩家: sanitizeCell(p.playerName),
      模型: sanitizeCell(p.model ?? ""),
      预测排名: p.ranking.map((id: string) => playerNameById.get(id) ?? id).join(" > "),
      预测排名ID: p.ranking.join(" > "),
      理由: sanitizeCell(p.reasoning),
      KendallTau: score?.tau ?? "",
      名次MAE: score?.mae ?? "",
    };
  });
  addSheet(wb, "预测", predictionRows.length ? predictionRows : [{ 提示: "无预测" }]);

  const decisionRows = (exportData.agentDecisions ?? []).map((d) => ({
    时间: new Date(d.timestamp).toISOString(),
    阶段: d.phase,
    时代: d.era,
    时代内轮: d.roundInEra,
    全局轮: d.globalRound,
    玩家ID: d.playerId,
    玩家: sanitizeCell(d.playerName),
    类型: d.kind,
    模型: sanitizeCell(d.model ?? ""),
    推理: sanitizeCell(d.reasoning),
    动作: sanitizeCell(JSON.stringify(d.action)),
    promptTokens: d.promptTokens ?? "",
    completionTokens: d.completionTokens ?? "",
    totalTokens: d.totalTokens ?? "",
    延迟毫秒: d.latencyMs ?? "",
  }));
  addSheet(wb, "Agent决策", decisionRows.length ? decisionRows : [{ 提示: "无决策记录" }]);

  const projRows = (exportData.projects ?? []).map((p) => ({
    ID: p.id,
    名称: sanitizeCell(p.name),
    类型: p.type,
    列表: p.list,
    容量: p.maxEnergy,
    累计投入: p.accumulatedInvested,
    总派发: p.totalPayout,
  }));
  addSheet(wb, "项目", projRows.length ? projRows : [{ 提示: "无项目" }]);

  const statusLabel: Record<string, string> = {
    leading: "暂时领先",
    outbid: "已被超过",
    won: "成交拿走",
    void_passed: "跳过作废",
    void_force_buy: "被强买打断",
    void_lot_changed: "换卡作废",
  };
  const bidDetailRows = (exportData.auctionBids ?? []).map((b) => ({
    场次: b.auctionRound,
    道具卡ID: b.cardId,
    玩家ID: b.playerId,
    玩家: sanitizeCell(b.playerName),
    出价: b.amount,
    当时账面: b.wealthAtBid,
    当时可用: b.availableWealthAtBid,
    占可用比例:
      b.bidToAvailableRatio != null ? Math.round(b.bidToAvailableRatio * 10000) / 100 : "",
    结果: statusLabel[b.status] ?? b.status,
    时间: new Date(b.timestamp).toISOString(),
  }));
  addSheet(wb, "出价明细", bidDetailRows.length ? bidDetailRows : [{ 提示: "无出价" }]);

  const dealSourceLabel: Record<string, string> = {
    hammer: "确认成交",
    force_buy: "强买强卖",
  };
  const dealRows = (exportData.auctionCompletedDeals ?? []).map((d) => ({
    场次: d.auctionRound ?? "",
    道具卡ID: d.cardId,
    得主ID: d.playerId,
    成交价: d.cost,
    来源: d.source ? dealSourceLabel[d.source] ?? d.source : "",
  }));
  addSheet(wb, "成交", dealRows.length ? dealRows : [{ 提示: "无成交" }]);

  type SummaryRow = {
    场次: number;
    道具卡ID: string;
    玩家ID: string;
    玩家: string;
    出价次数: number;
    最高出价: number;
    最高价当时可用: number;
    最高价占可用比例: number | "";
    是否得标: boolean;
    _highTs: number;
  };
  const summaryMap = new Map<string, SummaryRow>();
  for (const b of exportData.auctionBids ?? []) {
    const key = `${b.auctionRound}:${b.cardId}:${b.playerId}`;
    const prev = summaryMap.get(key);
    if (!prev) {
      summaryMap.set(key, {
        场次: b.auctionRound,
        道具卡ID: b.cardId,
        玩家ID: b.playerId,
        玩家: String(sanitizeCell(b.playerName)),
        出价次数: 1,
        最高出价: b.amount,
        最高价当时可用: b.availableWealthAtBid,
        最高价占可用比例:
          b.bidToAvailableRatio != null ? Math.round(b.bidToAvailableRatio * 10000) / 100 : "",
        是否得标: b.status === "won",
        _highTs: b.timestamp,
      });
      continue;
    }
    prev.出价次数 += 1;
    if (b.status === "won") prev.是否得标 = true;
    if (b.amount > prev.最高出价 || (b.amount === prev.最高出价 && b.timestamp >= prev._highTs)) {
      prev.最高出价 = b.amount;
      prev.最高价当时可用 = b.availableWealthAtBid;
      prev.最高价占可用比例 =
        b.bidToAvailableRatio != null ? Math.round(b.bidToAvailableRatio * 10000) / 100 : "";
      prev._highTs = b.timestamp;
    }
  }
  const summaryRows = Array.from(summaryMap.values()).map(({ _highTs: _, ...rest }) => rest);
  addSheet(wb, "出价摘要", summaryRows.length ? summaryRows : [{ 提示: "无出价" }]);

  const lotteryRows = (exportData.lotteryDeals ?? []).map((d) => ({
    玩家ID: d.playerId,
    主持原额: d.enteredAmount ?? "",
    入账额: d.creditedAmount,
    点石成金: d.goldApplied === true ? "是" : d.goldApplied === false ? "否" : "",
  }));
  addSheet(wb, "彩票", lotteryRows.length ? lotteryRows : [{ 提示: "无彩票开奖" }]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface LabComparisonAnalysis {
  generatedAt: string;
  runs: Array<{
    runId: string;
    name: string;
    condition: string;
    status: string;
    mock: boolean;
    seedBase: number;
    games: number;
    completedGames: number;
  }>;
  datasetRows: Array<Record<string, unknown>>;
  conditionSummaryRows: Array<Record<string, unknown>>;
  predictionByEraRows: Array<Record<string, unknown>>;
  sessionQcRows: Array<Record<string, unknown>>;
  socialScoreRows: Array<Record<string, unknown>>;
  manifestRows: Array<Record<string, unknown>>;
}

function meanNums(values: unknown[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function sdNums(values: unknown[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2) return null;
  const m = meanNums(nums)!;
  return Math.sqrt(nums.reduce((s, v) => s + (v - m) ** 2, 0) / (nums.length - 1));
}

function round4(v: number | null): number | "" {
  return v == null ? "" : Math.round(v * 10000) / 10000;
}

export function buildLabComparisonAnalysis(
  runs: LabRunRecord[],
  sessions: LabSessionRecord[],
  options: { includeMock: boolean }
): LabComparisonAnalysis {
  const runById = new Map(runs.map((r) => [r.runId, r]));
  const filteredRuns = runs.filter((r) => options.includeMock || !r.manifest.mock);
  const allowedRunIds = new Set(filteredRuns.map((r) => r.runId));

  const datasetRows: Array<Record<string, unknown>> = [];
  const sessionGameRows: Array<Record<string, unknown>> = [];
  const predictionRows: Array<{ condition: string; era: number; tau: number; mae: number }> = [];
  const sessionQcRows: Array<Record<string, unknown>> = [];
  const socialScoreRows: Array<Record<string, unknown>> = [];

  for (const s of sessions) {
    if (!allowedRunIds.has(s.runId)) continue;
    const run = runById.get(s.runId);
    const snapshot = s.snapshot;
    const meta = snapshot?.meta;
    const metrics = snapshot?.metrics;
    const qc = s.qc;

    sessionQcRows.push({
      runId: s.runId,
      sessionId: s.sessionId,
      condition: s.condition,
      status: s.status,
      valid: qc?.valid ?? s.status === "completed",
      reasons: (qc?.reasons ?? []).join(" | "),
      warnings: (qc?.warnings ?? []).join(" | "),
      seedBase: s.seedBase,
      seed: s.seed,
      sessionOrdinal: s.sessionOrdinal,
      playerCount: s.playerCount,
      phase: meta?.phase ?? "",
      currentEra: meta?.currentEra ?? 0,
      globalRound: meta?.globalRound ?? 0,
      predictions: qc?.predictions ?? snapshot?.predictions?.length ?? 0,
      publicMessages: qc?.publicMessages ?? snapshot?.groupMessages?.length ?? 0,
      privateMessages: qc?.privateMessages ?? snapshot?.directMessages?.length ?? 0,
      agentDecisions: qc?.agentDecisions ?? snapshot?.agentDecisions?.length ?? 0,
      totalTokensUsed: qc?.totalTokensUsed ?? metrics?.game?.totalTokensUsed ?? 0,
      maxAgentTokensUsed: qc?.maxAgentTokensUsed ?? 0,
      mock: s.mock,
      failureReason: s.failureReason ?? "",
    });

    if (s.status !== "completed" || !metrics) continue;

    sessionGameRows.push({
      runId: s.runId,
      sessionId: s.sessionId,
      condition: s.condition,
      seedBase: s.seedBase,
      seed: s.seed,
      sessionOrdinal: s.sessionOrdinal,
      mock: s.mock,
      ...metrics.game,
    });

    for (const p of metrics.players) {
      const snapPlayer = snapshot.players.find((sp) => sp.id === p.playerId);
      const socialRank = p.socialRank ?? snapPlayer?.socialRank ?? "";
      const socialRankReason = p.socialRankReason || snapPlayer?.socialRankReason || "";
      const tokensUsed = p.tokensUsed || snapPlayer?.tokensUsed || 0;

      datasetRows.push({
        runId: s.runId,
        sessionId: s.sessionId,
        condition: s.condition,
        seedBase: s.seedBase,
        seed: s.seed,
        sessionOrdinal: s.sessionOrdinal,
        mock: s.mock,
        playerId: p.playerId,
        player: p.name,
        agentIndex: p.agentIndex ?? "",
        provider: p.provider,
        model: p.model,
        finalWealth: p.finalWealth,
        finalRank: p.finalRank,
        socialRank,
        socialRankReason,
        tokensUsed,
        longShare: p.longShare,
        shortShare: p.shortShare,
        riskShare: p.riskShare,
        transfersSent: p.transfersSent,
        transfersReceived: p.transfersReceived,
        transferAmountSent: p.transferAmountSent,
        transferAmountReceived: p.transferAmountReceived,
        transferReturnRate: p.transferReturnRate,
        mutualTransferPartners: p.mutualTransferPartners,
        publicMessages: p.publicMessages,
        privateMessages: p.privateMessages,
        privatePartners: p.privatePartners,
        auctionBids: p.auctionBids,
        auctionWins: p.auctionWins,
        auctionSpend: p.auctionSpend,
        avgBidToAvailableRatio: p.avgBidToAvailableRatio ?? "",
        buffsUsed: p.buffsUsed,
        attacksInitiated: p.attacksInitiated,
        attacksReceived: p.attacksReceived,
        predictionCount: p.predictionCount,
        predictionTau: p.predictionTau ?? "",
        predictionMae: p.predictionMae ?? "",
        outDegree: p.outDegree,
        inDegree: p.inDegree,
      });

      socialScoreRows.push({
        runId: s.runId,
        sessionId: s.sessionId,
        condition: s.condition,
        playerId: p.playerId,
        player: p.name,
        model: p.model,
        socialRank,
        reason: socialRankReason,
        messagesCount: p.publicMessages + p.privateMessages,
      });
    }

    for (const pr of metrics.predictionScores ?? []) {
      predictionRows.push({
        condition: s.condition,
        era: pr.era,
        tau: pr.tau,
        mae: pr.mae,
      });
    }
    void run;
  }

  const byCondition = new Map<string, Array<Record<string, unknown>>>();
  for (const row of datasetRows) {
    const cond = String(row.condition ?? "unknown");
    if (!byCondition.has(cond)) byCondition.set(cond, []);
    byCondition.get(cond)!.push(row);
  }

  const conditionSummaryRows: Array<Record<string, unknown>> = [];
  for (const [condition, rows] of byCondition) {
    const sessionIds = new Set(rows.map((r) => String(r.sessionId)));
    const within = (field: string) => {
      const perSession: number[] = [];
      for (const sid of sessionIds) {
        const vals = rows
          .filter((r) => String(r.sessionId) === sid)
          .map((r) => r[field])
          .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (vals.length >= 2) perSession.push(Math.max(...vals) - Math.min(...vals));
      }
      return meanNums(perSession);
    };
    const condGames = sessionGameRows.filter((g) => String(g.condition) === condition);
    conditionSummaryRows.push({
      condition,
      sessions: sessionIds.size,
      players: rows.length,
      mock: rows[0]?.mock ?? false,
      models: [...new Set(rows.map((r) => `${r.provider}/${r.model}`))].join("|"),
      meanGini: round4(meanNums(condGames.map((r) => r.gini))),
      meanGiniNonNegative: round4(meanNums(condGames.map((r) => r.giniNonNegative))),
      meanNegativeWealthPlayers: round4(meanNums(condGames.map((r) => r.negativeWealthPlayers))),
      meanTotalWealth: round4(meanNums(condGames.map((r) => r.totalWealth))),
      meanTransferCount: round4(meanNums(condGames.map((r) => r.transferCount))),
      meanTransferVolume: round4(meanNums(condGames.map((r) => r.transferVolume))),
      meanPublicMessages: round4(meanNums(condGames.map((r) => r.publicMessageCount))),
      meanPrivateMessages: round4(meanNums(condGames.map((r) => r.privateMessageCount))),
      meanAttackCount: round4(meanNums(condGames.map((r) => r.attackCount))),
      meanAuctionSpend: round4(meanNums(condGames.map((r) => r.auctionSpend))),
      meanPredictionTau: round4(meanNums(condGames.map((r) => r.meanPredictionTau))),
      meanPredictionMae: round4(meanNums(condGames.map((r) => r.meanPredictionMae))),
      withinLongShareRange: round4(within("longShare")),
      withinTransferSentRange: round4(within("transfersSent")),
      withinPublicMessageRange: round4(within("publicMessages")),
      withinAuctionSpendRange: round4(within("auctionSpend")),
      withinPredictionTauRange: round4(within("predictionTau")),
      betweenPlayerPredictionTauSd: round4(sdNums(rows.map((r) => r.predictionTau))),
    });
  }

  const byCondEra = new Map<string, Array<{ tau: number; mae: number }>>();
  for (const pr of predictionRows) {
    const key = `${pr.condition}::${pr.era}`;
    if (!byCondEra.has(key)) byCondEra.set(key, []);
    byCondEra.get(key)!.push({ tau: pr.tau, mae: pr.mae });
  }
  const predictionByEraRows: Array<Record<string, unknown>> = [...byCondEra.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, rows]) => {
      const [condition, eraStr] = key.split("::");
      return {
        condition,
        era: Number(eraStr),
        predictions: rows.length,
        meanTau: round4(meanNums(rows.map((r) => r.tau))),
        meanMae: round4(meanNums(rows.map((r) => r.mae))),
      };
    });

  const manifestRows = filteredRuns.map((r) => ({
    runId: r.runId,
    name: r.manifest.name,
    condition: r.manifest.condition,
    status: r.status,
    seedBase: r.manifest.seedBase,
    requestedGames: r.manifest.games,
    completedGames: r.completedGames,
    chatEnabled: r.manifest.chatEnabled,
    memoryEnabled: r.manifest.memoryEnabled,
    predictionEnabled: r.manifest.predictionEnabled,
    tokenBudgetPerAgent: r.manifest.tokenBudgetPerAgent,
    models: r.manifest.models.join(" | "),
    promptVersion: r.manifest.promptVersion,
    promptHash: r.manifest.promptHash,
    gitCommit: r.manifest.gitCommit ?? "",
    mock: r.manifest.mock,
    createdAt: r.manifest.createdAt,
    notes: r.manifest.notes,
  }));

  return {
    generatedAt: new Date().toISOString(),
    runs: filteredRuns.map((r) => ({
      runId: r.runId,
      name: r.manifest.name,
      condition: r.manifest.condition,
      status: r.status,
      mock: r.manifest.mock,
      seedBase: r.manifest.seedBase,
      games: r.manifest.games,
      completedGames: r.completedGames,
    })),
    datasetRows,
    conditionSummaryRows,
    predictionByEraRows,
    sessionQcRows,
    socialScoreRows,
    manifestRows,
  };
}

/** 2 档：单批实验多表汇总 Excel */
export async function buildLabRunWorkbook(
  run: LabRunRecord,
  sessions: LabSessionRecord[]
): Promise<Buffer> {
  const analysis = buildLabComparisonAnalysis([run], sessions, { includeMock: true });
  const wb = new ExcelJS.Workbook();

  const manifestKv = Object.entries(run.manifest).map(([k, v]) => ({
    字段: k,
    值: sanitizeCell(typeof v === "object" && v !== null ? JSON.stringify(v) : v),
  }));
  addSheet(wb, "批次清单", manifestKv);

  const summaryRows = sessions.map((s) => ({
    场次ID: s.sessionId,
    场次序号: s.sessionOrdinal,
    状态: s.status,
    失败原因: sanitizeCell(s.failureReason ?? ""),
    发牌种子: s.seed,
    社区名称: sanitizeCell(s.communityName),
    总财富: s.communityWealth,
    首富: sanitizeCell(s.topPlayer.name),
    首富财富: s.topPlayer.wealth,
    轮次: s.qc?.globalRound ?? s.snapshot?.meta?.globalRound ?? 0,
    总消耗Token: s.qc?.totalTokensUsed ?? 0,
    基尼系数: s.snapshot?.metrics?.game?.giniNonNegative ?? "",
    预测平均Tau: s.snapshot?.metrics?.game?.meanPredictionTau ?? "",
  }));
  addSheet(wb, "各局汇总", summaryRows.length ? summaryRows : [{ 提示: "暂无局记录" }]);

  addSheet(
    wb,
    "自动体检QC",
    analysis.sessionQcRows.length
      ? analysis.sessionQcRows.map(sanitizeRecord)
      : [{ 提示: "无QC记录" }]
  );
  addSheet(
    wb,
    "玩家表现明细",
    analysis.datasetRows.length
      ? analysis.datasetRows.map(sanitizeRecord)
      : [{ 提示: "无有效对局玩家数据" }]
  );
  addSheet(
    wb,
    "按时代预测准度",
    analysis.predictionByEraRows.length
      ? analysis.predictionByEraRows.map(sanitizeRecord)
      : [{ 提示: "无预测数据" }]
  );
  addSheet(
    wb,
    "社交表现评级",
    analysis.socialScoreRows.length
      ? analysis.socialScoreRows.map(sanitizeRecord)
      : [{ 提示: "无社交评级数据" }]
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 3 档：多批次跨条件对比分析 Excel */
export async function buildLabComparisonWorkbook(
  analysis: LabComparisonAnalysis
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addSheet(
    wb,
    "条件对比汇总",
    analysis.conditionSummaryRows.length
      ? analysis.conditionSummaryRows.map(sanitizeRecord)
      : [{ 提示: "暂无可汇总的有效实验数据" }]
  );
  addSheet(
    wb,
    "玩家局级总表",
    analysis.datasetRows.length ? analysis.datasetRows.map(sanitizeRecord) : [{ 提示: "无数据" }]
  );
  addSheet(
    wb,
    "时代预测曲线",
    analysis.predictionByEraRows.length
      ? analysis.predictionByEraRows.map(sanitizeRecord)
      : [{ 提示: "无预测数据" }]
  );
  addSheet(
    wb,
    "场次总览与质检",
    analysis.sessionQcRows.length
      ? analysis.sessionQcRows.map(sanitizeRecord)
      : [{ 提示: "无场次" }]
  );
  addSheet(
    wb,
    "社交评级汇总",
    analysis.socialScoreRows.length
      ? analysis.socialScoreRows.map(sanitizeRecord)
      : [{ 提示: "无评级" }]
  );
  addSheet(
    wb,
    "实验批次清单",
    analysis.manifestRows.length ? analysis.manifestRows.map(sanitizeRecord) : [{ 提示: "无批次" }]
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function sanitizeRecord(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = sanitizeCell(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
  }
  return out;
}

export function buildLabDatasetCsv(analysis: LabComparisonAnalysis): string {
  const rows = analysis.datasetRows;
  if (rows.length === 0) return "\uFEFF";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const raw = v && typeof v === "object" ? JSON.stringify(v) : v == null ? "" : String(v);
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  return (
    "\uFEFF" +
    [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n") +
    "\n"
  );
}

export { contentDispositionAttachment, safeExportBasename };
