import { GameState, Player } from "../state/gameState.js";
import { appendSessionEvent, InvestmentSubmitSource } from "../state/sessionTelemetry.js";
import { sanitizeLongContribution } from "./longTermLogic.js";

/** 可用于分配的精力池：非有限或负数视为 0 */
export function spendableEnergy(player: { energy: number }): number {
  const e = player.energy;
  if (typeof e !== "number" || !Number.isFinite(e)) return 0;
  return Math.max(0, Math.floor(e));
}

/** 将预填投资裁剪为合法方案（精力上限、长期项目规则等） */
export function sanitizeInvestments(
  game: GameState,
  player: Player,
  investments: Record<number, number>
): Record<number, number> {
  const sanitized: Record<number, number> = {};
  let remaining = spendableEnergy(player);

  for (const proj of game.activeProjects) {
    let val = Math.max(0, Math.floor(Number(investments[proj.id] ?? 0)));
    if (proj.type === "long") {
      val = sanitizeLongContribution(player.longTerm[proj.id]?.status, val);
    }
    val = Math.min(val, remaining);
    if (val > 0) {
      sanitized[proj.id] = val;
      remaining -= val;
    }
  }
  return sanitized;
}

export function applyInvestments(
  game: GameState,
  playerId: string,
  investments: Record<number, number>,
  source: InvestmentSubmitSource = "player"
): boolean {
  const player = game.players.find(p => p.id === playerId);
  if (!player) return false;

  // 入口强制裁剪，不信任调用方（含 AI / 漏 sanitize 的路径）
  const sanitized = sanitizeInvestments(game, player, investments ?? {});

  let totalSpent = 0;
  for (const amount of Object.values(sanitized)) {
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
    totalSpent += amount;
  }

  const available = spendableEnergy(player);
  if (totalSpent > available) return false;

  // 扣除精力：用 available 扣减，保证结果 ≥ 0
  player.energy = available - totalSpent;
  player.totalEnergyConsumed += totalSpent;

  player.preSubmitInvestmentDraft = player.investmentDraft
    ? { ...player.investmentDraft }
    : { ...sanitized };
  player.investment = sanitized;
  player.investmentDraft = undefined;

  for (const [projIdStr, amount] of Object.entries(sanitized)) {
      const projId = Number(projIdStr);
      const project = game.activeProjects.find(p => p.id === projId);
      
      if (project && amount > 0) {
          if (project.type === 'risk') {
              player.investedRiskEnergy += amount;
          } else if (project.type === 'long') {
              player.investedLongEnergy += amount;
          } else if (project.type === 'short') {
              player.investedShortEnergy += amount;
          }
      }
  }
  
  game.logs.push(`📝 ${player.name} 完成了投资决策 (投入 ${totalSpent} 精力)`);

  appendSessionEvent(
    game,
    "investment_submitted",
    {
      globalRound: game.globalRound,
      currentEra: game.currentEra,
      roundInEra: game.roundInEra,
      investments: { ...sanitized },
      totalSpent,
      source,
    },
    playerId
  );

  return true;
}

/** 上帝解锁：回滚本轮已提交的投资（与 applyInvestments 对称） */
export function revertInvestments(game: GameState, playerId: string): boolean {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return false;

  const investments = { ...(player.investment ?? {}) };
  let totalSpent = 0;
  for (const amount of Object.values(investments)) {
    totalSpent += Number(amount) || 0;
  }

  if (totalSpent <= 0) {
    const backup = player.preSubmitInvestmentDraft;
    delete player.preSubmitInvestmentDraft;
    if (backup && Object.keys(backup).length > 0) {
      player.investmentDraft = sanitizeInvestments(game, player, backup);
      player.investment = {};
      game.logs.push(`🔓 上帝解锁 ${player.name}，已恢复提交前的投资预填`);
      appendSessionEvent(
        game,
        "admin_investment_reverted",
        {
          globalRound: game.globalRound,
          currentEra: game.currentEra,
          roundInEra: game.roundInEra,
          investments: { ...player.investmentDraft },
          totalSpent: 0,
          restoredFromBackup: true,
        },
        playerId
      );
      return true;
    }
    return false;
  }

  for (const [projIdStr, amount] of Object.entries(investments)) {
    const amt = Number(amount) || 0;
    if (amt <= 0) continue;
    const projId = Number(projIdStr);
    const project = game.activeProjects.find((p) => p.id === projId);
    if (project?.type === "risk") {
      player.investedRiskEnergy = Math.max(0, player.investedRiskEnergy - amt);
    } else if (project?.type === "long") {
      player.investedLongEnergy = Math.max(0, player.investedLongEnergy - amt);
    } else if (project?.type === "short") {
      player.investedShortEnergy = Math.max(0, player.investedShortEnergy - amt);
    }
  }

  player.energy += totalSpent;
  player.totalEnergyConsumed = Math.max(0, player.totalEnergyConsumed - totalSpent);
  player.investmentDraft = sanitizeInvestments(game, player, investments);
  player.investment = {};
  delete player.preSubmitInvestmentDraft;

  game.logs.push(`🔓 上帝解锁 ${player.name}，退回 ${totalSpent} 精力，可重新投资`);

  appendSessionEvent(
    game,
    "admin_investment_reverted",
    {
      globalRound: game.globalRound,
      currentEra: game.currentEra,
      roundInEra: game.roundInEra,
      investments: { ...investments },
      totalSpent,
    },
    playerId
  );

  return true;
}

/**
 * 主持解锁投资阶段：退回已扣精力并恢复可编辑 investmentDraft（与 applyInvestments 脱钩）。
 * revertInvestments 失败时仍尽量从 investment / preSubmit 恢复表单，禁止清空已有 draft。
 */
export function reopenSubmittedInvestment(game: GameState, playerId: string): boolean {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return false;

  if (revertInvestments(game, playerId)) {
    return true;
  }

  const investments = { ...(player.investment ?? {}) };
  let totalSpent = 0;
  for (const amount of Object.values(investments)) {
    totalSpent += Number(amount) || 0;
  }

  let restoredDraft: Record<number, number> | undefined;
  if (totalSpent > 0) {
    restoredDraft = sanitizeInvestments(game, player, investments);
  } else {
    const backup = player.preSubmitInvestmentDraft;
    if (backup && Object.keys(backup).length > 0) {
      restoredDraft = sanitizeInvestments(game, player, backup);
      delete player.preSubmitInvestmentDraft;
    }
  }

  if (restoredDraft !== undefined) {
    player.investmentDraft = restoredDraft;
  }

  player.investment = {};

  if (restoredDraft !== undefined) {
    game.logs.push(`🔓 上帝解锁 ${player.name}，已恢复投资方案可修改`);
    appendSessionEvent(
      game,
      "admin_investment_reverted",
      {
        globalRound: game.globalRound,
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
        investments: { ...restoredDraft },
        totalSpent: 0,
        restoredFromFallback: true,
      },
      playerId
    );
  } else if (!player.investmentDraft) {
    game.logs.push(`🔓 上帝解锁 ${player.name}，可重新填写投资`);
  }

  return true;
}