import { STARTING_WEALTH } from "../config/startingWealth.js";
import type { GameState, Player } from "../state/gameState.js";
import { syncEnergyAfterRosterChange } from "../logic/energySchedule.js";
import { syncChatGroupsOnRosterChange } from "../logic/chatGroups.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { AI_BOT_ENABLED } from "../config/features.js";
import { AI_CONFIG } from "./aiConfig.js";
import {
  aiPersonaCatalog,
  normalizeDifficulty,
  type AiDifficulty,
  type AiPersonaKey,
} from "./aiPersona.js";

export interface AddAiOptions {
  /** @deprecated 产品版不再预设人格；保留字段仅用于兼容旧调用 */
  persona?: AiPersonaKey | string;
  difficulty?: AiDifficulty | string;
  /** 指定展示名（仍需唯一） */
  name?: string;
}

/** 产品版 AI 不预设人格，用中性昵称；具体打法交给模型自由发挥 */
const FREEFORM_NAMES = [
  "🤖旅人",
  "🤖拾光者",
  "🤖旁观者",
  "🤖远行客",
  "🤖变量",
  "🤖无名氏",
];

export function countAiPlayers(game: GameState): number {
  return game.players.filter((p) => isAiPlayer(p)).length;
}

export function countHumanPlayers(game: GameState): number {
  return game.players.filter((p) => !isAiPlayer(p) && p.connected).length;
}

function uniqueAiName(game: GameState, base: string): string {
  const trimmed = base.trim().slice(0, 20) || "🤖AI";
  if (!game.players.some((p) => p.name === trimmed)) return trimmed;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${trimmed}${i}`;
    if (!game.players.some((p) => p.name === candidate)) return candidate;
  }
  return `${trimmed}${Date.now().toString(36).slice(-4)}`;
}

function newAiPlayer(id: string, name: string, difficulty: AiDifficulty): Player {
  return {
    id,
    name,
    socketId: undefined,
    connected: true,
    ready: false,
    energy: 15,
    wealth: STARTING_WEALTH,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    buffRoundNotes: [],
    slackedBy: [],
    coffeePurchasesThisRound: 0,
    totalEnergyConsumed: 15,
    wealthHistory: [STARTING_WEALTH],
    investedRiskEnergy: 0,
    investedLongEnergy: 0,
    investedShortEnergy: 0,
    socialRank: null,
    isAI: true,
    aiDifficulty: difficulty,
  };
}

export type AddAiResult =
  | { ok: true; player: Player }
  | { ok: false; error: string };

/**
 * 添加一名 AI 玩家。产品约束：
 * - 房间最多 6 人；
 * - 最多 5 名 AI，至少给真人留 1 个座位；
 * - 阶段进行中只允许加入未满的房间（由调用方决定是否允许）。
 */
export function addAiPlayer(game: GameState, options: AddAiOptions = {}): AddAiResult {
  if (!AI_BOT_ENABLED) return { ok: false, error: "AI 玩家功能已关闭" };
  if (game.phase === "GAME_OVER" || game.phase === "COMMUNITY_NAMING") {
    return { ok: false, error: "本局已结束，不能加入 AI" };
  }
  if (game.players.length >= 6) return { ok: false, error: "房间已满（最多 6 人）" };
  if (countAiPlayers(game) >= AI_CONFIG.maxAiPerRoom) {
    return { ok: false, error: `AI 玩家已达上限（${AI_CONFIG.maxAiPerRoom} 名）` };
  }

  const index = countAiPlayers(game);
  const difficulty = normalizeDifficulty(options.difficulty);
  const base = options.name?.trim()
    ? options.name.trim()
    : FREEFORM_NAMES[index % FREEFORM_NAMES.length];
  const name = uniqueAiName(game, base);
  const id = `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const player = newAiPlayer(id, name, difficulty);
  game.players.push(player);
  syncEnergyAfterRosterChange(game, player);
  syncChatGroupsOnRosterChange(game);
  game.logs.push(`🤖 AI 玩家「${name}」加入（自由发挥 · ${difficulty}）`);
  return { ok: true, player };
}

export function removeAiPlayer(game: GameState, playerId: string): boolean {
  const index = game.players.findIndex((p) => p.id === playerId && isAiPlayer(p));
  if (index < 0) return false;
  const [removed] = game.players.splice(index, 1);
  game.readyPlayers.delete(removed.id);
  game.phaseFinished.delete(removed.id);
  syncEnergyAfterRosterChange(game);
  syncChatGroupsOnRosterChange(game);
  game.logs.push(`🤖 AI 玩家「${removed.name}」已离开`);
  return true;
}

/**
 * 自动补位：默认补到 6 人。返回实际新增数量。
 * `humanReserved` 为 1 时，最多补到「6 - 1 = 5」名 AI。
 */
export function fillAiPlayers(
  game: GameState,
  target = AI_CONFIG.autoFillTarget,
  options: AddAiOptions = {}
): number {
  const desired = Math.max(2, Math.min(6, Math.floor(target)));
  let added = 0;
  while (game.players.length < desired) {
    const result = addAiPlayer(game, options);
    if (!result.ok) break;
    added += 1;
  }
  return added;
}

/** 给管理端用的目录：人格 + 难度 + 当前 AI 列表。产品版默认自由发挥。 */
export function aiRosterSummary(game: GameState) {
  return {
    enabled: AI_BOT_ENABLED,
    maxPerRoom: AI_CONFIG.maxAiPerRoom,
    freeform: true,
    /** 仅旧局 / 显式指定人格时使用 */
    personas: aiPersonaCatalog(),
    difficulties: ["easy", "normal", "hard"] as const,
    players: game.players
      .filter((p) => isAiPlayer(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        persona: p.aiPersona ?? null,
        freeform: !p.aiPersona,
        difficulty: p.aiDifficulty ?? "normal",
        wealth: p.wealth,
        ready: p.ready,
      })),
  };
}
