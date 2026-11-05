import type { Server } from "socket.io";
import type { GameState } from "./gameState.js";
import { needsSessionReset, resetGameSession, finishTutorialExit } from "./gameState.js";
import { resetAllReady } from "./gameActions.js";
import { ensureSessionStarted, recordPhaseChange } from "./sessionTelemetry.js";
import { applyRoundEnergy } from "../logic/energySchedule.js";
import { ensureProjectsDrawnForEra } from "./gameEra.js";
import { startInvestmentDeadline } from "./actionDeadline.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { AI_BOT_ENABLED, AI_AUTOFILL_ENABLED } from "../config/features.js";
import { fillAiPlayers } from "../ai/aiRoster.js";
import { handleAIPhase } from "../ai/aiOrchestrator.js";
import { isAiPlayer } from "../util/isAiPlayer.js";

export type StartGameResult = { ok: true } | { ok: false; message: string };

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
  source: "admin" | "auto_host"
): StartGameResult {
  if (game.phase === "ROOM_WAITING") {
    if (needsSessionReset(game)) {
      resetGameSession(game);
    }
    // 在线真人不足 6 人时自动补 AI（可选；至少保留 1 名真人）
    if (AI_AUTOFILL_ENABLED && AI_BOT_ENABLED) {
      const hasHuman = game.players.some((p) => p.connected && !isAiPlayer(p));
      if (hasHuman && game.players.length < 6) {
        const added = fillAiPlayers(game, 6);
        if (added > 0) {
          game.logs.push(`🤖 开局自动补入 ${added} 名 AI 玩家`);
        }
      }
    }
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
      source === "auto_host" ? "🤖 系统自动开局，进入第 1 时代" : "👑 主持开局，进入第 1 时代"
    );
    recordPhaseChange(game, prevPhase, game.phase, source);
    if (io) broadcastUpdate(io, game);
    void handleAIPhase(game, io);
    return { ok: true };
  }

  if (game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
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
