import { GameState } from "./gameState.js";

// Store all active rooms
export const rooms: Record<string, GameState> = {};

// Store uploaded project images timestamps (to bust cache and indicate custom image exists)
export const customImagesVersions: Record<number, number> = {};
export const customEraImagesVersions: Record<string, number> = {};
export const customBuffImagesVersions: Record<string, number> = {};

/** 跨局社区总财富榜（内存；启动时从 data/community_leaderboard.json 加载） */
export const globalLeaderboard: {
  name: string;
  score: number;
  roomId: string;
  recordedAt: number;
}[] = [];