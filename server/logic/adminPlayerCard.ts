import { buffCards } from "../data/game_data.js";
import { GameState, Player } from "../state/gameState.js";
import { isAiPlayer } from "../util/isAiPlayer.js";

export const ADMIN_GRANTABLE_CARD_IDS: readonly string[] = buffCards.map((c) => c.id);
const CARD_ID_SET = new Set(ADMIN_GRANTABLE_CARD_IDS);

export type AdminCardAdjustAction = "add" | "remove";

export function cardDisplayName(cardId: string): string {
  return buffCards.find((c) => c.id === cardId)?.name ?? cardId;
}

function parseInventoryIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

export function adminAdjustPlayerCard(
  game: GameState,
  playerId: string,
  cardId: unknown,
  action: unknown,
  inventoryIndex?: unknown
):
  | { ok: true; player: Player; cardId: string; action: AdminCardAdjustAction; cardName: string }
  | { ok: false; message: string } {
  if (action !== "add" && action !== "remove") {
    return { ok: false, message: "操作无效" };
  }
  const player = game.players.find((p) => p.id === playerId);
  if (!player || isAiPlayer(player)) {
    return { ok: false, message: "目标玩家无效" };
  }
  if (!player.inventory) player.inventory = [];

  if (action === "add") {
    if (typeof cardId !== "string" || !CARD_ID_SET.has(cardId)) {
      return { ok: false, message: "道具无效" };
    }
    player.inventory.push(cardId);
    return { ok: true, player, cardId, action, cardName: cardDisplayName(cardId) };
  }

  const idxFromClient = parseInventoryIndex(inventoryIndex);
  if (
    idxFromClient !== undefined &&
    idxFromClient >= 0 &&
    idxFromClient < player.inventory.length
  ) {
    if (typeof cardId === "string" && cardId && player.inventory[idxFromClient] !== cardId) {
      return { ok: false, message: "手牌已变化，请关闭后重试" };
    }
    const removedId = player.inventory[idxFromClient];
    player.inventory.splice(idxFromClient, 1);
    return {
      ok: true,
      player,
      cardId: removedId,
      action,
      cardName: cardDisplayName(removedId),
    };
  }

  if (typeof cardId !== "string" || !cardId) {
    return { ok: false, message: "道具无效" };
  }
  const idx = player.inventory.indexOf(cardId);
  if (idx === -1) {
    return { ok: false, message: "手牌中没有该道具，只能收回未使用的手牌" };
  }
  player.inventory.splice(idx, 1);
  return { ok: true, player, cardId, action, cardName: cardDisplayName(cardId) };
}
