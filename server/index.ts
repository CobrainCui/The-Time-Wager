import "dotenv/config";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import { registerSocketHandlers } from "./network/socketHandlers.js";
import { broadcastUpdate } from "./network/broadcast.js";
import { rooms } from "./state/store.js";
import { tryAdvancePhase } from "./state/phaseController.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = 3001;

io.on("connection", (socket) => {
  registerSocketHandlers(io, socket);
});

/**
 * 全局 Tick
 */
setInterval(() => {
  Object.values(rooms).forEach((game) => {
    if (
      game.phase === "INVESTMENT" &&
      game.investmentEndsAt &&
      Date.now() >= game.investmentEndsAt
    ) {
      console.log(`⏰ Room ${game.roomId}: Investment time is up! Force submitting.`);
      game.players.forEach(p => {
        p.ready = true;
        game.readyPlayers.add(p.id);
      });
      game.investmentEndsAt = undefined;
      tryAdvancePhase(game);
      broadcastUpdate(io, game);
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log(`✅ 光阴对赌新新新 Server running on port ${PORT}`);
});
