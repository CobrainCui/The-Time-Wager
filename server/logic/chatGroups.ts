import type { GameState, ChatGroup, GroupMessage } from "../state/gameState.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import {
  maskForbiddenText,
  normalizeNoteInput,
  sanitizeTransactionNote,
  truncateNotePreview,
} from "./forbiddenText.js";

export const PUBLIC_GROUP_ID = "__public__";
export const PUBLIC_GROUP_NAME = "全场";

export const MAX_CUSTOM_GROUPS_PER_PLAYER = 6;
export const MAX_CUSTOM_GROUPS_PER_ROOM = 24;
export const MAX_MESSAGES_PER_GROUP = 500;
/** 每次广播给单个玩家的历史上限：群聊是增量场景，避免 gameUpdate 体积随历史线性增长 */
export const MAX_MESSAGES_PER_VIEW = 200;

const BLOCKED_PHASES = new Set<GameState["phase"]>(["ROOM_WAITING", "ERA_INTRO", "TUTORIAL"]);

function ensureArrays(game: GameState): void {
  if (!game.chatGroups) game.chatGroups = [];
  if (!game.groupMessages) game.groupMessages = [];
}

function humanPlayers(game: GameState) {
  return game.players.filter((p) => !isAiPlayer(p));
}

function humanIds(game: GameState): string[] {
  return humanPlayers(game).map((p) => p.id);
}

function memberSetKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

function defaultCustomGroupName(game: GameState, memberIds: string[]): string {
  const names = memberIds
    .map((id) => game.players.find((p) => p.id === id)?.name ?? id)
    .slice(0, 4);
  const joined = names.join("、");
  return joined.length > 24 ? `${joined.slice(0, 24)}…` : joined;
}

/** 仅当房间已存在全场频道时，同步真人成员（不自动创建） */
export function syncPublicChatGroupMembers(game: GameState): void {
  ensureArrays(game);
  const pub = game.chatGroups!.find((g) => g.kind === "public");
  if (!pub) return;
  pub.memberIds = humanIds(game);
}

/** 显式创建或刷新全场频道（主持端等按需调用，进房不默认创建） */
export function ensurePublicChatGroup(game: GameState): void {
  ensureArrays(game);
  const members = humanIds(game);
  let pub = game.chatGroups!.find((g) => g.kind === "public");
  if (!pub) {
    pub = {
      id: PUBLIC_GROUP_ID,
      kind: "public",
      name: PUBLIC_GROUP_NAME,
      memberIds: members,
      createdAt: Date.now(),
    };
    game.chatGroups!.push(pub);
  } else {
    pub.memberIds = members;
  }
}

export function syncChatGroupsOnRosterChange(game: GameState): void {
  ensureArrays(game);
  // 产品版开放群聊时，房间里有真人就自动创建「全场」频道；
  // 关闭群聊时只同步已有频道成员，不产生隐藏状态。
  if (GROUP_CHAT_ENABLED && humanIds(game).length > 0) {
    ensurePublicChatGroup(game);
  } else {
    syncPublicChatGroupMembers(game);
  }
  const humans = new Set(humanIds(game));
  game.chatGroups = (game.chatGroups ?? []).filter((g) => {
    if (g.kind === "public") return true;
    g.memberIds = g.memberIds.filter((id) => humans.has(id));
    return g.memberIds.length >= 2;
  });
  const groupIds = new Set(game.chatGroups.map((g) => g.id));
  game.groupMessages = (game.groupMessages ?? []).filter((m) => groupIds.has(m.groupId));
}

function pruneGroupMessages(game: GameState): void {
  if (!game.groupMessages?.length) return;
  const byGroup = new Map<string, GroupMessage[]>();
  for (const m of game.groupMessages) {
    const list = byGroup.get(m.groupId) ?? [];
    list.push(m);
    byGroup.set(m.groupId, list);
  }
  const kept: GroupMessage[] = [];
  for (const list of byGroup.values()) {
    // 同一毫秒的消息按插入顺序保留，不能用随机 id 兜底排序
    list.sort((a, b) => a.timestamp - b.timestamp);
    kept.push(...list.slice(-MAX_MESSAGES_PER_GROUP));
  }
  kept.sort((a, b) => a.timestamp - b.timestamp);
  game.groupMessages = kept;
}

export function chatGroupsForViewer(
  game: GameState,
  viewerPlayerId: string | null | undefined,
  isGodView: boolean
): ChatGroup[] {
  const groups = game.chatGroups ?? [];
  if (isGodView) return groups.map((g) => ({ ...g, memberIds: [...g.memberIds] }));
  if (!viewerPlayerId) return [];
  return groups
    .filter((g) => g.memberIds.includes(viewerPlayerId))
    .map((g) => ({ ...g, memberIds: [...g.memberIds] }));
}

export function groupMessagesForViewer(
  game: GameState,
  viewerPlayerId: string | null | undefined,
  isGodView: boolean
): GroupMessage[] {
  const visibleIds = new Set(chatGroupsForViewer(game, viewerPlayerId, isGodView).map((g) => g.id));
  const byGroup = new Map<string, GroupMessage[]>();
  for (const m of game.groupMessages ?? []) {
    if (!visibleIds.has(m.groupId)) continue;
    const list = byGroup.get(m.groupId) ?? [];
    list.push(m);
    byGroup.set(m.groupId, list);
  }
  const kept: GroupMessage[] = [];
  for (const list of byGroup.values()) {
    kept.push(...list.slice(-MAX_MESSAGES_PER_VIEW));
  }
  // 稳定排序：同一毫秒内保持服务端插入顺序
  kept.sort((a, b) => a.timestamp - b.timestamp);
  return kept;
}

export type CreateGroupResult =
  | { ok: true; group: ChatGroup }
  | { ok: false; error: string };

export function createCustomChatGroup(
  game: GameState,
  creatorId: string,
  memberIds: string[],
  nameRaw?: string
): CreateGroupResult {
  if (BLOCKED_PHASES.has(game.phase)) {
    return { ok: false, error: "当前阶段无法建群" };
  }
  ensureArrays(game);

  const creator = game.players.find((p) => p.id === creatorId);
  if (!creator || isAiPlayer(creator)) {
    return { ok: false, error: "无法建群" };
  }

  const humans = new Set(humanIds(game));
  const unique = new Set<string>([creatorId, ...memberIds]);
  const members = [...unique].filter((id) => humans.has(id) && id !== creatorId);
  if (members.length < 2) {
    return { ok: false, error: "请至少再选择 2 名玩家" };
  }
  const allMembers = [creatorId, ...members];

  const customCount = game.chatGroups!.filter((g) => g.kind === "custom").length;
  if (customCount >= MAX_CUSTOM_GROUPS_PER_ROOM) {
    return { ok: false, error: "本房间群聊数量已达上限" };
  }

  const owned = game.chatGroups!.filter((g) => g.kind === "custom" && g.ownerId === creatorId).length;
  if (owned >= MAX_CUSTOM_GROUPS_PER_PLAYER) {
    return { ok: false, error: `你创建的群已达上限（${MAX_CUSTOM_GROUPS_PER_PLAYER} 个）` };
  }

  const setKey = memberSetKey(allMembers);
  const dup = game.chatGroups!.find(
    (g) => g.kind === "custom" && memberSetKey(g.memberIds) === setKey
  );
  if (dup) {
    return { ok: false, error: "已有相同成员的群聊" };
  }

  const trimmedName =
    typeof nameRaw === "string"
      ? nameRaw.replace(/\s+/g, " ").trim().slice(0, 32)
      : "";
  const safeName = trimmedName ? maskForbiddenText(trimmedName) : "";
  const group: ChatGroup = {
    id: `cg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "custom",
    name: safeName || defaultCustomGroupName(game, allMembers),
    memberIds: allMembers,
    ownerId: creatorId,
    createdById: creatorId,
    createdAt: Date.now(),
  };
  game.chatGroups!.push(group);
  return { ok: true, group };
}

export function addChatGroupMembers(
  game: GameState,
  actorId: string,
  groupId: string,
  newMemberIds: string[]
): { ok: true } | { ok: false; error: string } {
  if (BLOCKED_PHASES.has(game.phase)) {
    return { ok: false, error: "当前阶段无法操作群聊" };
  }
  ensureArrays(game);
  const group = game.chatGroups!.find((g) => g.id === groupId);
  if (!group || group.kind !== "custom") {
    return { ok: false, error: "群不存在" };
  }
  if (group.ownerId !== actorId) {
    return { ok: false, error: "只有群主可以拉人" };
  }
  const humans = new Set(humanIds(game));
  const toAdd = newMemberIds.filter((id) => humans.has(id) && !group.memberIds.includes(id));
  if (toAdd.length === 0) {
    return { ok: false, error: "没有可添加的成员" };
  }
  const nextMembers = [...group.memberIds, ...toAdd];
  const dup = game.chatGroups!.find(
    (g) =>
      g.id !== group.id &&
      g.kind === "custom" &&
      memberSetKey(g.memberIds) === memberSetKey(nextMembers)
  );
  if (dup) {
    return { ok: false, error: "已有相同成员的群聊" };
  }
  group.memberIds = nextMembers;
  return { ok: true };
}

export function leaveChatGroup(
  game: GameState,
  playerId: string,
  groupId: string
): { ok: true; dissolved: boolean } | { ok: false; error: string } {
  ensureArrays(game);
  const group = game.chatGroups!.find((g) => g.id === groupId);
  if (!group) return { ok: false, error: "群不存在" };
  if (group.kind === "public") {
    return { ok: false, error: "无法退出全场频道" };
  }
  if (!group.memberIds.includes(playerId)) {
    return { ok: false, error: "你不在该群中" };
  }
  group.memberIds = group.memberIds.filter((id) => id !== playerId);
  if (group.memberIds.length < 2) {
    game.chatGroups = game.chatGroups!.filter((g) => g.id !== groupId);
    game.groupMessages = game.groupMessages!.filter((m) => m.groupId !== groupId);
    return { ok: true, dissolved: true };
  }
  if (group.ownerId === playerId) {
    group.ownerId = group.memberIds[0];
  }
  return { ok: true, dissolved: false };
}

export type SendGroupMessageResult =
  | { ok: true; message: GroupMessage; notifyTargets: string[]; preview: string }
  | { ok: false; error: string };

export interface SendGroupMessageOptions {
  /**
   * 允许服务端托管的 AI 在「全场」频道发言。
   * AI 不在 memberIds 里（频道成员只列真人），因此需要显式放行；
   * 默认关闭，避免绕过真人入口。
   */
  allowAi?: boolean;
}

export function sendGroupChatMessage(
  game: GameState,
  senderId: string,
  groupId: string,
  rawText: unknown,
  clientTempId?: string,
  options: SendGroupMessageOptions = {}
): SendGroupMessageResult {
  if (BLOCKED_PHASES.has(game.phase)) {
    return { ok: false, error: "当前阶段无法发送群消息" };
  }
  ensureArrays(game);
  const sender = game.players.find((p) => p.id === senderId);
  const group = game.chatGroups!.find((g) => g.id === groupId);
  const senderIsAi = Boolean(sender && isAiPlayer(sender));
  if (!sender) return { ok: false, error: "无法发送" };
  if (senderIsAi && !options.allowAi) {
    return { ok: false, error: "无法发送" };
  }
  if (!group) {
    return { ok: false, error: "你不在该群中" };
  }
  const aiPublicPost = senderIsAi && options.allowAi && group.kind === "public";
  if (!group.memberIds.includes(senderId) && !aiPublicPost) {
    return { ok: false, error: "你不在该群中" };
  }
  const trimmed = normalizeNoteInput(rawText);
  if (!trimmed) {
    return { ok: false, error: "消息不能为空" };
  }
  const text = sanitizeTransactionNote(trimmed);
  const tempId =
    typeof clientTempId === "string" && clientTempId.length > 0 && clientTempId.length <= 64
      ? clientTempId
      : undefined;

  const message: GroupMessage = {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    groupId,
    fromId: sender.id,
    fromName: sender.name,
    text,
    timestamp: Date.now(),
    clientTempId: tempId,
  };
  game.groupMessages!.push(message);
  pruneGroupMessages(game);

  const notifyTargets = group.memberIds.filter((id) => id !== senderId);
  const preview = truncateNotePreview(text, 48);
  return { ok: true, message, notifyTargets, preview };
}
