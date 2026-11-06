import type { Server } from "socket.io";
import type { GameState } from "./gameState.js";
import { needsSessionReset, resetGameSession, finishTutorialExit } from "./gameState.js";
import { resetAllReady } from "./gameActions.js";
import { ensureSessionStarted, recordPhaseChange } from "./sessionTelemetry.js";
import { applyRoundEnergy } from "../logic/energySchedule.js";
import { ensureProjectsDrawnForEra } from "./gameEra.js";
import { startInvestmentDeadline } from "./actionDeadline.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { fillAiPlayers, countHumanPlayers } from "../ai/aiRoster.js";
import { handleAIPhase } from "../ai/aiOrchestrator.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { canStartWithAi } from "../ai/aiPreflight.js";

export type StartGameResult = { ok: true } | { ok: false; message: string };

/** 正式开局的最少人数：四/五/六人都有平衡过的精力表 */
export const MIN_PLAYERS_TO_START = 4;
export const MAX_SEATS = 6;

/**
 * 目标总人数（含 AI）。
 * - 房主选过 AI 数量：真人座位 + AI 数量（上限 6）；
 * - 未选过（旧房间 / 管理端流程）：补满 6 席。
 */
export function resolveSeatTarget(game: GameState): number {
  if (game.aiSeats == null) return MAX_SEATS;
  const humanSeats = game.players.filter((p) => !isAiPlayer(p)).length;
  const aiSeats = Math.max(0, Math.min(5, Math.floor(game.aiSeats)));
  return Math.min(MAX_SEATS, humanSeats + aiSeats);
}

/**
 * 正式开局按目标人数补座：1–6 名真人，空位由 AI 补满到目标人数。
 * 必须在 AI 预检之前调用，确保预检覆盖补位后的全部 AI。
 */
export function ensureAiSeatsFilled(
  game: GameState
): { ok: true; added: number } | { ok: false; message: string } {
  const humans = countHumanPlayers(game);
  if (humans === 0) {
    return { ok: false, message: "至少需要 1 名在线真人玩家才能开局。" };
  }
  const target = resolveSeatTarget(game);
  let added = 0;
  if (game.players.length < target) {
    if (!AI_BOT_ENABLED) {
      return {
        ok: false,
        message: `开局需要 ${target} 席；AI 玩家已关闭，请补足真人，或开启 AI_PLAYERS_ENABLED。`,
      };
    }
    added = fillAiPlayers(game, target, { difficulty: game.aiDifficulty });
    if (added > 0) {
      game.logs.push(`🤖 开局自动补入 ${added} 名 AI 玩家（凑满 ${target} 人）`);
    }
  }
  // 管理端可能已手动加过 AI：以实际座位数为准判断能否开局
  const seated = game.players.length;
  if (seated < MIN_PLAYERS_TO_START) {
    return {
      ok: false,
      message:
        `至少 ${MIN_PLAYERS_TO_START} 人才能开局：当前 ${seated} 人（${humans} 名真人）。` +
        `请把 AI 玩家加到 ${Math.max(0, MIN_PLAYERS_TO_START - humans)} 名以上，或邀请更多朋友。`,
    };
  }
  if (seated < target) {
    return {
      ok: false,
      message:
        "AI 补位未完成：严格 Agent 模式下需要为所有空位配置模型 Key（AI_PLAYER_n_API_KEY 或共享 AI_API_KEY），且每房最多 5 名 AI。",
    };
  }
  return { ok: true, added };
}

/**
 * 开局/进入投资阶段的唯一收口：
 * - 管理端「开局」；
 * - 系统自动主持的等待房自动开局。
 *
 * 不在这里做权限判断，调用方负责鉴权。
 */
export function startGameNow(
  io: Server | null,
  game: GameState,
  source: "admin" | "auto_host" | "player"
): StartGameResult {
  if (game.phase === "ROOM_WAITING") {
    if (needsSessionReset(game)) {
      resetGameSession(game);
    }
    const filled = ensureAiSeatsFilled(game);
    if (!filled.ok) return { ok: false, message: filled.message };
    // 严格 Agent 模式：补位后的每个 AI 都必须通过模型连通性检测
    const aiGate = canStartWithAi(game);
    if (!aiGate.ok) return { ok: false, message: aiGate.message ?? "AI 未就绪，无法开局" };
    const online = game.players.filter((p) => p.connected);
    if (online.length === 0) {
      return { ok: false, message: "暂无在线玩家，无法开局" };
    }
    resetAllReady(game);
    const prevPhase = game.phase;
    ensureSessionStarted(game);
    applyRoundEnergy(game, { relock: true });
    game.phase = "ERA_INTRO";
    game.autoStartAt = undefined;
    game.autoHostNextActionAt = undefined;
    game.logs.push(
      source === "auto_host"
        ? "🤖 系统自动开局，进入第 1 时代"
        : source === "player"
          ? "👑 房主开局，进入第 1 时代"
          : "👑 主持开局，进入第 1 时代"
    );
    recordPhaseChange(game, prevPhase, game.phase, source);
    if (io) broadcastUpdate(io, game);
    void handleAIPhase(game, io);
    return { ok: true };
  }

  if (game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
    const aiGate = canStartWithAi(game);
    if (!aiGate.ok) return { ok: false, message: aiGate.message ?? "AI 未就绪，无法开局" };
    if (game.phase === "TUTORIAL") {
      finishTutorialExit(game);
    }
    if (needsSessionReset(game)) {
      resetGameSession(game);
    }

    const prevPhase = game.phase;
    ensureSessionStarted(game);
    if (game.energyTableSize == null) {
      applyRoundEnergy(game, { relock: true });
    }

    if (game.currentEra === 1 && game.roundInEra === 1) {
      game.activeProjects = [];
      game.uncompletedProjects = [];
      game.completedProjects = [];
      game.drawnProjects = new Set();
      game.projectDrawEra = undefined;
      game.totalRiskEnergyAvailable = 0;
    }
    ensureProjectsDrawnForEra(game);
    // 强制从时代介绍/教程进入投资时，必须清掉上一阶段的 ready 与草稿；
    // 否则已点过「准备好了」的玩家会被当成已提交，整轮零投入。
    resetAllReady(game);
    for (const p of game.players) {
      p.investment = {};
      p.investmentDraft = undefined;
      p.preSubmitInvestmentDraft = undefined;
      p.coffeePurchasesThisRound = 0;
    }
    game.phase = "INVESTMENT";
    game.autoHostNextActionAt = undefined;
    startInvestmentDeadline(game);

    game.logs.push(
      source === "auto_host" ? "🤖 系统自动进入投资阶段" : "👑 游戏开始！进入投资阶段"
    );
    recordPhaseChange(game, prevPhase, game.phase, source);
    if (io) broadcastUpdate(io, game);
    void handleAIPhase(game, io);
    return { ok: true };
  }

  return { ok: false, message: "当前阶段不能开局" };
}
