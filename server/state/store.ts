import { GameState } from "./gameState.js";

// Store all active rooms
export const rooms: Record<string, GameState> = {};

// Store uploaded project images timestamps (to bust cache and indicate custom image exists)
export const customImagesVersions: Record<number, number> = {};

// ✅ 全局排行榜存储 (简单内存版，重启服务器会清空)
// 格式: { name: "社区名", score: 12345 }
export const globalLeaderboard: { name: string; score: number }[] = [];