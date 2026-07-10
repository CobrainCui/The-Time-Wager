// server/roomManager.ts
import { Server, Socket } from "socket.io";
import { createInitialGame, GameState, Player } from "./state/gameState.js";

// 房间信息：包含游戏状态和基础玩家列表
interface RoomInfo {
  game: GameState;
  players: string[]; // 昵称列表，用于房间显示
  isReady: Record<string, boolean>;
  hasAI: Record<string, boolean>;
  roomStatus: "WAITING" | "READY" | "IN_GAME";
}

export const rooms: Record<string, RoomInfo> = {};

/** 创建新房间 */
function createRoom(roomId: string, playerId: string) {
  const game = createInitialGame(roomId, [playerId]);
  rooms[roomId] = {
    game,
    players: [playerId],
    isReady: { [playerId]: false },
    hasAI: {},
    roomStatus: "WAITING",
  };
  return rooms[roomId];
}

/** 加入房间 */
export function joinRoom(io: Server, socket: Socket, playerId: string, roomId: string) {
  let room = rooms[roomId];
  if (!room) {
    room = createRoom(roomId, playerId);
  } else {
    if (!room.players.includes(playerId)) {
      room.players.push(playerId);
      room.isReady[playerId] = false;
      room.hasAI[playerId] = false;
      room.game.players.push({
        id: playerId,
        name: playerId,
        energy: 15,
        wealth: 0,
        connected: true,
        ready: false,
        inventory: [],
        activeBuffs: [],
        usedCards: [],
        longTerm: {},
        wealthHistory: [],
        draftOrder: 0,
      } as any);
    }
  }

  socket.join(roomId);
  broadcastRoomState(io, roomId);
}

/** 设置玩家准备状态 */
export function setPlayerReady(io: Server, roomId: string, playerId: string) {
  const room = rooms[roomId];
  if (!room) return;

  room.isReady[playerId] = true;

  // 检查是否所有人类玩家都准备完成
  const allReady = room.players.every(pid => room.isReady[pid] || room.hasAI[pid]);
  if (allReady && room.players.length === 6) {
    room.roomStatus = "IN_GAME";
    initializeGame(room);
  }

  broadcastRoomState(io, roomId);
}

/** 添加 AI 玩家 */
export function addAIPlayer(io: Server, roomId: string) {
  const room = rooms[roomId];
  if (!room || room.players.length >= 6) return;

  const aiId = `AI${room.players.length + 1}`;
  room.players.push(aiId);
  room.hasAI[aiId] = true;
  room.isReady[aiId] = true; // AI 默认准备
  room.game.players.push({
    id: aiId,
    name: aiId,
    energy: 15,
    wealth: 0,
    connected: true,
    ready: false,
    inventory: [],
    activeBuffs: [],
    usedCards: [],
    longTerm: {},
    wealthHistory: [],
    draftOrder: 0,
  } as any);

  // 检查是否可以开局
  const allReady = room.players.every(pid => room.isReady[pid] || room.hasAI[pid]);
  if (allReady && room.players.length === 6) {
    room.roomStatus = "IN_GAME";
    initializeGame(room);
  }

  broadcastRoomState(io, roomId);
}

/** 断线处理 */
export function handleDisconnect(io: Server, roomId: string, playerId: string) {
  const room = rooms[roomId];
  if (!room) return;

  const player = room.game.players.find((p: Player) => p.id === playerId);
  if (player) player.connected = false;

  broadcastRoomState(io, roomId);
}

/** 初始化游戏 */
function initializeGame(room: RoomInfo) {
  const game = room.game;
  game.phase = "ERA_INTRO";
  game.currentEra = 1;
  game.roundInEra = 1;
  game.globalRound = 1;
  game.phaseFinished.clear();
}

/** 广播房间状态 */
export function broadcastRoomState(io: Server, roomId: string) {
  const room = rooms[roomId];
  if (!room) return;

  io.to(roomId).emit("roomUpdate", {
    roomId,
    players: room.players.map(pid => ({
      id: pid,
      isReady: room.isReady[pid] || false,
      isAI: room.hasAI[pid] || false,
      connected: room.game.players.find((p: Player) => p.id === pid)?.connected ?? true,
    })),
    roomStatus: room.roomStatus,
  });
}
