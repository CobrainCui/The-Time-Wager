import { randomUUID } from "node:crypto";
import type { GameState, PublicFeedItem, PublicFeedKind } from "../state/gameState.js";

const MAX_PUBLIC_FEED_ITEMS = 120;

/**
 * 向全局公开信息流追加一条记录。
 * 仅记录桌面上所有玩家本就可见的公开事件（时代、拍卖成交、公开开奖、项目结算结果等），
 * 严禁写入私密开奖、私信、暗手牌或打火机命中详情。
 */
export function appendPublicFeed(
  game: GameState,
  kind: PublicFeedKind,
  text: string
): PublicFeedItem | null {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (!game.publicFeed) game.publicFeed = [];
  const item: PublicFeedItem = {
    id: randomUUID(),
    round: game.globalRound,
    era: game.currentEra,
    phase: game.phase,
    kind,
    text: clean,
    timestamp: Date.now(),
  };
  game.publicFeed.push(item);
  if (game.publicFeed.length > MAX_PUBLIC_FEED_ITEMS) {
    game.publicFeed = game.publicFeed.slice(-MAX_PUBLIC_FEED_ITEMS);
  }
  return item;
}
