import { randomUUID } from "node:crypto";
import { GameState, ActiveBuff, BuffRoundNote, Player } from "../state/gameState.js";
import { buffCards } from "../data/game_data.js";
import { appendSessionEvent } from "../state/sessionTelemetry.js";
import {
  afterForceBuyOnFocus,
  isAuctionCardAvailable,
  markAuctionCardDistributed,
  recordAuctionCompletedDeal,
} from "./auctionCards.js";

export const SLACK_ENERGY_DELTA = 8;
export const WORK_REST_CARD_ID = "buff_work_rest";
export const FORCE_BUY_CARD_ID = "buff_force_buy";
export const LIGHTER_CARD_ID = "buff_lighter";
export const SHORT_CARD_ID = "buff_short";
export const SLACK_CARD_ID = "buff_slack";
export const GOLD_CARD_ID = "buff_gold";

const RETIRED_CARD_IDS = new Set(["buff_spirit", "buff_rebound"]);

function pushNote(player: Player, note: BuffRoundNote): void {
  if (!player.buffRoundNotes) player.buffRoundNotes = [];
  player.buffRoundNotes.push(note);
}

function hasWorkRest(player: Player): boolean {
  return player.activeBuffs.some((b) => b.cardId === WORK_REST_CARD_ID);
}

export function applyGoldMultiplier(player: Player, amount: number): number {
  if (!player.activeBuffs.some((b) => b.cardId === GOLD_CARD_ID)) return amount;
  if (amount <= 0) return amount;
  return Math.floor(amount * 1.5);
}

export type UseBuffResult =
  | {
      success: true;
      msg: string;
      notifyTargetId?: string;
      notifyTargetMsg?: string;
      cancelledOffers?: { offerId: string; playerId: string; cardId: string }[];
    }
  | { success: false; msg: string };

/**
 * 玩家使用道具卡
 */
export function useBuffCard(
  game: GameState,
  playerId: string,
  cardId: string,
  params: {
    targetPlayerId?: string;
    targetProjectId?: number;
    burnFromInventory?: boolean;
    burnCardId?: string;
    extraData?: unknown;
  }
): UseBuffResult {
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { success: false, msg: "玩家不存在" };

  const cardIndex = player.inventory.indexOf(cardId);
  if (cardIndex === -1) return { success: false, msg: "你没有这张卡" };

  if (RETIRED_CARD_IDS.has(cardId)) {
    return { success: false, msg: "该道具已下线，无法使用" };
  }

  const cardDef = buffCards.find((c) => c.id === cardId);
  if (!cardDef) return { success: false, msg: "未知卡牌数据" };

  let notifyTargetId: string | undefined;
  let notifyTargetMsg: string | undefined;
  let usedText = `使用了【${cardDef.name}】`;
  let hitNote: BuffRoundNote | undefined;
  const effect: Record<string, unknown> = {};

  const buff: ActiveBuff = {
    cardId,
    targetPlayerId: params.targetPlayerId,
    targetProjectId: params.targetProjectId,
    extraData: params.extraData,
  };

  if (cardId === SLACK_CARD_ID) {
    const target = game.players.find((p) => p.id === params.targetPlayerId);
    if (!target) return { success: false, msg: "未指定目标" };

    const workRestActive = hasWorkRest(target);
    if (workRestActive) {
      target.energy += SLACK_ENERGY_DELTA;
      effect.energyDelta = SLACK_ENERGY_DELTA;
      effect.energyAfter = target.energy;
      effect.workRestTriggered = true;
      game.logs.push(
        `⚖️ ${player.name} 对 ${target.name} 使用【摸鱼传染】，触发【劳逸结合】！${target.name} 获得 ${SLACK_ENERGY_DELTA} 精力`
      );
      usedText = `对 ${target.name} 使用摸鱼传染（对方劳逸结合，对方获得 ${SLACK_ENERGY_DELTA} 精力）`;
      hitNote = {
        cardId,
        role: "hit",
        text: `${player.name} 对你使用摸鱼传染，劳逸结合生效：获得 ${SLACK_ENERGY_DELTA} 精力`,
      };
      notifyTargetMsg = hitNote.text;
    } else {
      const before = target.energy;
      target.energy = Math.max(0, target.energy - SLACK_ENERGY_DELTA);
      const deducted = before - target.energy;
      if (!target.slackedBy) target.slackedBy = [];
      if (!target.slackEnergyLost) target.slackEnergyLost = [];
      target.slackedBy.push(player.id);
      target.slackEnergyLost.push(deducted);
      effect.energyDelta = -deducted;
      effect.energyAfter = target.energy;
      effect.workRestTriggered = false;
      game.logs.push(
        `💤 ${player.name} 对 ${target.name} 使用【摸鱼传染】，${target.name} 精力 -${deducted}`
      );
      usedText = `对 ${target.name} 使用摸鱼传染（对方精力 -${deducted}）`;
      hitNote = {
        cardId,
        role: "hit",
        text: `${player.name} 对你使用摸鱼传染，精力 -${deducted}`,
      };
      notifyTargetMsg = hitNote.text;
    }
    if (!target.pendingSlackHits) target.pendingSlackHits = [];
    target.pendingSlackHits.push({
      id: randomUUID(),
      fromName: target.id === player.id ? "你自己" : player.name,
      energyDelta: workRestActive
        ? SLACK_ENERGY_DELTA
        : -(target.slackEnergyLost?.[target.slackEnergyLost.length - 1] ?? 0),
      energyAfter: target.energy,
    });
    notifyTargetId = target.id;
    // 打自己时只记「已用」，不重复「被用」
    if (target.id === player.id) {
      hitNote = undefined;
      notifyTargetId = undefined;
      notifyTargetMsg = undefined;
    }
  } else if (cardId === WORK_REST_CARD_ID) {
    const pending = Math.max(player.slackEnergyLost?.length ?? 0, player.slackedBy?.length ?? 0);
    if (pending <= 0) {
      return { success: false, msg: "单独使用无效；被摸鱼后再打出可获得精力" };
    }
    let restored = 0;
    const lost = player.slackEnergyLost ?? [];
    for (let i = 0; i < pending; i++) {
      const deducted = lost[i] ?? SLACK_ENERGY_DELTA;
      restored += deducted + SLACK_ENERGY_DELTA;
    }
    player.energy += restored;
    player.slackedBy = [];
    player.slackEnergyLost = [];
    // 事后改判后，旧的「扣精力」确认弹窗已过时
    player.pendingSlackHits = [];
    effect.restoredEnergy = restored;
    effect.slackHitsResolved = pending;
    effect.energyAfter = player.energy;
    game.logs.push(
      `⚖️ ${player.name} 打出【劳逸结合】，本轮已受到的 ${pending} 次摸鱼改为获得 ${SLACK_ENERGY_DELTA} 精力（精力 +${restored}）`
    );
    usedText = `打出劳逸结合（已受摸鱼，获得 ${SLACK_ENERGY_DELTA} 精力，合计 +${restored}）`;
  } else if (cardId === SHORT_CARD_ID) {
    const project = game.activeProjects.find((p) => p.id === params.targetProjectId);
    if (!project) return { success: false, msg: "请选择本轮项目" };
    game.logs.push(`📉 ${player.name} 对「${project.name}」使用【项目做空】，结算时已积累精力清零，已入账财富不追回`);
    usedText = `做空「${project.name}」（结算时已积累精力清零，已入账财富不追回）`;
  } else if (cardId === LIGHTER_CARD_ID) {
    const target = game.players.find((p) => p.id === params.targetPlayerId);
    if (!target) return { success: false, msg: "未指定烧毁目标玩家" };
    if (target.id === player.id) return { success: false, msg: "打火机不能烧毁自己的卡" };
    const burnId = typeof params.burnCardId === "string" ? params.burnCardId : "";
    if (!burnId) return { success: false, msg: "未指定要烧毁的卡" };
    const cardMeta = buffCards.find((c) => c.id === burnId);
    if (!cardMeta || RETIRED_CARD_IDS.has(burnId) || burnId === LIGHTER_CARD_ID) {
      return { success: false, msg: "未知或不可烧毁的卡" };
    }

    // 忽略客户端 burnFromInventory：先拆已发动，否则拆手牌；两边都没有也消耗打火机
    let burned = false;
    let burnSource: "inventory" | "active" | undefined;
    const abIdx = target.activeBuffs.findIndex((b) => b.cardId === burnId);
    if (abIdx !== -1) {
      target.activeBuffs.splice(abIdx, 1);
      burned = true;
      burnSource = "active";
    } else {
      const invIdx = target.inventory.indexOf(burnId);
      if (invIdx !== -1) {
        target.inventory.splice(invIdx, 1);
        burned = true;
        burnSource = "inventory";
      }
    }

    effect.burnCardId = burnId;
    effect.burnHit = burned;
    if (burnSource) {
      effect.burnSource = burnSource;
      effect.burnFromInventory = burnSource === "inventory";
    }

    const burnedName = cardMeta.name;
    usedText = `对${target.name}使用打火机，指定【${burnedName}】`;
    // 公开日志与持有者文案同形，避免 gameUpdate 泄露是否命中
    game.logs.push(`🔥 ${player.name} 对 ${target.name} 使用【打火机】，指定【${burnedName}】`);
    if (burned) {
      hitNote = {
        cardId,
        role: "hit",
        text: `${player.name} 烧毁了你的【${burnedName}】`,
      };
      notifyTargetId = target.id;
      notifyTargetMsg = hitNote.text;
    }
  } else if (cardId === FORCE_BUY_CARD_ID) {
    return { success: false, msg: "强买强卖请在拍卖阶段对当前焦点卡使用" };
  } else if (cardId === "buff_lottery" || cardId === "buff_gold" || cardId === "buff_insurance") {
    game.logs.push(`🃏 ${player.name} 使用了卡牌【${cardDef.name}】，将在结算或开奖时生效`);
    usedText = `使用【${cardDef.name}】（待结算/开奖生效）`;
  } else {
    return { success: false, msg: "未知或不可用的道具" };
  }

  player.inventory.splice(cardIndex, 1);
  if (cardId !== LIGHTER_CARD_ID) {
    player.activeBuffs.push(buff);
  }

  pushNote(player, { cardId, role: "used", text: usedText });
  if (hitNote && notifyTargetId) {
    const hitPlayer = game.players.find((p) => p.id === notifyTargetId);
    if (hitPlayer) pushNote(hitPlayer, hitNote);
  }

  appendSessionEvent(
    game,
    "buff_used",
    {
      cardId,
      targetPlayerId: params.targetPlayerId ?? null,
      targetProjectId: params.targetProjectId ?? null,
      success: true,
      ...effect,
    },
    playerId
  );

  return { success: true, msg: usedText, notifyTargetId, notifyTargetMsg };
}

/** 本人确认最早一条摸鱼提示 */
export function ackSlackHit(game: GameState, playerId: string, hitId: unknown): boolean {
  const player = game.players.find((p) => p.id === playerId);
  const hits = player?.pendingSlackHits;
  if (!player || !hits?.length) return false;
  const idx = typeof hitId === "string" ? hits.findIndex((h) => h.id === hitId) : 0;
  if (idx < 0) return false;
  hits.splice(idx, 1);
  return true;
}

/** 拍卖阶段：强买强卖 */
export function useForceBuyCard(
  game: GameState,
  playerId: string
): UseBuffResult {
  if (game.phase !== "AUCTION") {
    return { success: false, msg: "仅拍卖阶段可使用强买强卖" };
  }
  const player = game.players.find((p) => p.id === playerId);
  if (!player) return { success: false, msg: "玩家不存在" };

  const cardIndex = player.inventory.indexOf(FORCE_BUY_CARD_ID);
  if (cardIndex === -1) return { success: false, msg: "你没有强买强卖" };

  if ((game.forceBuyUsedPlayerIds ?? []).includes(playerId)) {
    return { success: false, msg: "本场拍卖已使用过强买强卖" };
  }

  const focusId = game.auctionFocusCardId;
  if (!focusId) return { success: false, msg: "现在没有正在拍的卡" };
  if (focusId === FORCE_BUY_CARD_ID) {
    return { success: false, msg: "不能强买强卖本身" };
  }
  if (!isAuctionCardAvailable(game, focusId)) {
    return { success: false, msg: "焦点卡已不在拍卖池中" };
  }

  player.inventory.splice(cardIndex, 1);
  player.inventory.push(focusId);
  markAuctionCardDistributed(game, focusId);
  recordAuctionCompletedDeal(game, focusId, player.id, 0, "force_buy");
  if (!game.forceBuyUsedPlayerIds) game.forceBuyUsedPlayerIds = [];
  game.forceBuyUsedPlayerIds.push(playerId);
  afterForceBuyOnFocus(game, focusId);

  const focusName = buffCards.find((c) => c.id === focusId)?.name || focusId;
  const text = `强买强卖：免费获得【${focusName}】`;
  game.logs.push(`🤝 ${player.name} 使用【强买强卖】，免费获得【${focusName}】`);
  pushNote(player, { cardId: FORCE_BUY_CARD_ID, role: "used", text });
  if (!player.usedCards) player.usedCards = [];
  player.usedCards.push(FORCE_BUY_CARD_ID);

  appendSessionEvent(
    game,
    "buff_used",
    { cardId: FORCE_BUY_CARD_ID, focusCardId: focusId, success: true },
    playerId
  );

  return {
    success: true,
    msg: text,
  };
}
