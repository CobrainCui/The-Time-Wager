import { Server } from "socket.io";
import { GameState } from "../state/gameState.js";

export function broadcastUpdate(io: Server, game: GameState) {
  // 将 GameState 发送给前端
  // Set 类型 (readyPlayers, phaseFinished) 必须转为 Array，否则 JSON 无法传输
  io.to(game.roomId).emit("gameUpdate", {
    ...game,
    readyPlayers: Array.from(game.readyPlayers),
    phaseFinished: Array.from(game.phaseFinished),
    // 过滤掉后端专用的 socketId，保护隐私
    players: game.players.map(p => {
      const { socketId, ...rest } = p;
      return rest;
    })
  });
}