import * as XLSX from "xlsx";
import { GameState, ActiveProject, Player } from "../state/gameState.js";
import { EXPORT_SCHEMA_VERSION, getAnalysisWeightsVersion } from "./constants.js";
import { emptySessionTelemetry } from "../state/sessionTelemetry.js";
import { getCommunityLeaderboard } from "../state/communityLeaderboard.js";

function uniqueProjects(game: GameState): ActiveProject[] {
  const all = [...game.activeProjects, ...game.completedProjects, ...game.uncompletedProjects];
  const seen = new Set<number>();
  return all.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function playerExportRow(p: Player) {
  return {
    id: p.id,
    name: p.name,
    isAI: p.isAI ?? false,
    aiPersona: p.aiPersona ?? "",
    draftOrder: p.draftOrder ?? null,
    energy: p.energy,
    wealth: p.wealth,
    socialRank: p.socialRank,
    personaVote: p.personaVote ?? "",
    totalEnergyConsumed: p.totalEnergyConsumed,
    investedLongEnergy: p.investedLongEnergy,
    investedRiskEnergy: p.investedRiskEnergy,
    wealthHistory: p.wealthHistory.join(","),
    fatePersona: p.analysisResult?.primaryPersona ?? "",
    geneCode: p.analysisResult?.mbtiPersona?.code ?? "",
  };
}

export function buildSessionExport(game: GameState) {
  const tel = game.sessionTelemetry ?? emptySessionTelemetry();
  const exportedAt = Date.now();

  return {
    meta: {
      exportSchemaVersion: EXPORT_SCHEMA_VERSION,
      analysisWeightsVersion: getAnalysisWeightsVersion(),
      roomId: game.roomId,
      communityName: game.communityName ?? null,
      playerCount: game.players.length,
      eraSequence: game.eraSequence,
      eraTheme: game.currentEraCard?.name ?? null,
      phase: game.phase,
      currentEra: game.currentEra,
      roundInEra: game.roundInEra,
      globalRound: game.globalRound,
      sessionStartedAt: game.sessionStartedAt ?? null,
      exportedAt,
    },
    players: game.players.map((p) => ({
      ...playerExportRow(p),
      ruleEnginePersona: p.analysisResult
        ? { source: "rule_engine", data: p.analysisResult }
        : null,
      inventory: p.inventory,
      usedCards: p.usedCards,
      longTerm: p.longTerm,
      riskGains: p.riskGains,
    })),
    projects: uniqueProjects(game).map((proj) => ({
      id: proj.id,
      name: proj.name,
      type: proj.type,
      maxEnergy: proj.maxEnergy,
      era: proj.era,
      accumulatedInvested: proj.accumulatedInvested,
      investorRecords: proj.investorRecords,
      earningRecords: proj.earningRecords,
      totalPayout: proj.totalPayout,
    })),
    transactions: game.transactions,
    settlementHistory: tel.settlementHistory,
    events: tel.events,
    logs: game.logs,
    globalLeaderboard: getCommunityLeaderboard(),
    eventChoices: game.eventChoices,
  };
}

export function buildSessionWorkbook(exportData: ReturnType<typeof buildSessionExport>): Buffer {
  const wb = XLSX.utils.book_new();

  const metaRows = Object.entries(exportData.meta).map(([k, v]) => ({
    字段: k,
    值: typeof v === "object" ? JSON.stringify(v) : v,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(metaRows), "概览");

  const playerSheet = exportData.players.map((p) => ({
    玩家ID: p.id,
    昵称: p.name,
    AI: p.isAI,
    顺位: p.draftOrder,
    财富: p.wealth,
    精力: p.energy,
    社交档: p.socialRank,
    终局投票: p.personaVote,
    命运素描: p.fatePersona,
    决策基因: p.geneCode,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(playerSheet.length ? playerSheet : [{ 提示: "无玩家" }]),
    "玩家"
  );

  const eventRows = exportData.events.map((e) => ({
    时间: new Date(e.timestamp).toISOString(),
    类型: e.type,
    玩家ID: e.playerId ?? "",
    详情: JSON.stringify(e.payload),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(eventRows.length ? eventRows : [{ 提示: "无事件" }]), "事件");

  const settlementRows: Record<string, unknown>[] = [];
  for (const round of exportData.settlementHistory) {
    for (const res of round.results) {
      for (const [pid, invest] of Object.entries(res.playerInvestments)) {
        const gain = res.playerGains[pid];
        settlementRows.push({
          轮次: round.round,
          时代: round.currentEra,
          时代内轮: round.roundInEra,
          项目: res.name,
          项目类型: res.type,
          玩家ID: pid,
          投入: invest,
          收益: gain?.total ?? 0,
          收益基础: gain?.base ?? 0,
          收益排名: gain?.rank ?? 0,
          收益时代: gain?.era ?? 0,
          爆雷: res.isExploded,
          完成: res.isCompleted,
        });
      }
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(settlementRows.length ? settlementRows : [{ 提示: "无结算" }]),
    "结算"
  );

  const txRows = exportData.transactions.map((t) => ({
    时间: new Date(t.timestamp).toISOString(),
    发起: t.fromName,
    接收: t.toName,
    金额: t.amount,
    备注: t.note,
    状态: t.status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows.length ? txRows : [{ 提示: "无转账" }]), "转账");

  const projRows = exportData.projects.map((p) => ({
    ID: p.id,
    名称: p.name,
    类型: p.type,
    容量: p.maxEnergy,
    累计投入: p.accumulatedInvested,
    总派发: p.totalPayout,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projRows.length ? projRows : [{ 提示: "无项目" }]), "项目");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function safeExportBasename(roomId: string): string {
  return roomId.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 64) || "room";
}

/** RFC 5987：兼容中文等非 ASCII 下载文件名 */
export function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
