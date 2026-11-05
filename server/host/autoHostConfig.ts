/**
 * 系统自动主持的时间参数。
 *
 * 这些值只影响「主持动作」的节奏，不改变任何游戏规则。
 * 管理端仍可随时手动开局 / 跳转 / 落槌，手动操作优先于自动主持。
 */

function envInt(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

export const AUTO_HOST_CONFIG = {
  /** 等待房凑够人后，多少毫秒自动开局 */
  startDelayMs: envInt("AUTO_START_DELAY_MS", 30_000, 5_000),
  /** 自动开局至少需要的在线座位数（AI 计入；开启 AI 自动补位时按补位后计算） */
  minPlayersToStart: envInt("AUTO_START_MIN_PLAYERS", 2, 1),
  /** 时代介绍停留时间 */
  introMs: envInt("AUTO_INTRO_MS", 12_000, 3_000),
  /** 结算页停留时间 */
  settlementMs: envInt("AUTO_SETTLEMENT_MS", 15_000, 3_000),
  /** 拍卖：最后一次出价后多久自动落槌 / 跳过 */
  auctionIdleMs: envInt("AUTO_AUCTION_IDLE_MS", 12_000, 4_000),
  /** 拍卖：单张卡最长停留时间（无人出价也会结束） */
  auctionLotMaxMs: envInt("AUTO_AUCTION_LOT_MS", 45_000, 15_000),
  /** 社区命名：真人首富超时未命名则系统兜底 */
  namingMs: envInt("AUTO_NAMING_MS", 45_000, 10_000),
  /** 彩票开奖确认：超时自动领取，避免漏发 */
  lotteryConfirmMs: envInt("AUTO_LOTTERY_CONFIRM_MS", 30_000, 5_000),
} as const;
