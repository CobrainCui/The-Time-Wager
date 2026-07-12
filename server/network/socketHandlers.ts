import { Server, Socket } from "socket.io";
import { GameState, createInitialGame, Player } from "../state/gameState.js";
import { togglePlayerReady } from "../state/gameActions.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { applyInvestments } from "../logic/investmentLogic.js"; 
import { broadcastUpdate } from "./broadcast.js"; 
import { rooms, customImagesVersions, globalLeaderboard } from "../state/store.js"; 
import { drawProjectsForEra } from "../state/gameEra.js";
import { shuffleArray } from "../utils/shuffle.js";
import { useBuffCard } from "../logic/buffLogic.js";
import { analyzeGamePersona } from "../logic/analysisLogic.js";

function broadcastRoomList(io: Server, socket: Socket) {
  const roomList = Object.keys(rooms).map(rid => ({
    roomId: rid,
    playerCount: rooms[rid].players.length,
    phase: rooms[rid].phase
  }));
  socket.emit("adminRoomList", roomList);
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  console.log(`🔌 Socket connected: ${socket.id}`);
  
  // 发送自定义图片版本号
  socket.emit("syncProjectImages", customImagesVersions);


  // 1. 加入房间
  socket.on("joinGame", ({ roomId, name }: { roomId: string, name: string }) => {
    roomId = String(roomId).trim();
    const playerName = String(name).trim();

    if (roomId === "999999") {
      socket.data.isSuperAdmin = true;
      socket.join("super_admin_room");
      broadcastRoomList(io, socket);
      return;
    }

    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = createInitialGame(roomId, []);
    }
    const game = rooms[roomId];

    let player = game.players.find(p => p.name === playerName);
    
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    } else {
      if (game.players.length >= 6) {
        socket.emit("error", "房间已满 (Max 6)");
        return;
      }
      const newPlayer: Player = {
        id: socket.id,
        name: playerName,
        socketId: socket.id,
        connected: true,
        ready: false,
        energy: 15, 
        wealth: 0, 
        rank: 0,
        investment: {},
        longTerm: {},
        riskGains: {},
        inventory: [],
        usedCards: [],
        activeBuffs: [],
        slackedBy: [], // ✅ 初始化新增字段
        totalEnergyConsumed: 15,
        wealthHistory: [0], 
        investedRiskEnergy: 0,
        investedLongEnergy: 0,
        socialRank: null
      };
      game.players.push(newPlayer);
      player = newPlayer;
      game.logs.push(`👤 玩家 ${player.name} 加入游戏`);
    }

    socket.emit("playerJoined", { playerId: player.id });
    broadcastUpdate(io, game);
    
    io.to("super_admin_room").emit("adminRoomList", Object.keys(rooms).map(rid => ({
        roomId: rid,
        playerCount: rooms[rid].players.length,
        phase: rooms[rid].phase
    })));
  });

  // === Admin ===
  socket.on("adminSpectate", ({ targetRoomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[targetRoomId];
    if (game) {
      socket.join(targetRoomId); 
      socket.emit("gameUpdate", {
        ...game,
        readyPlayers: Array.from(game.readyPlayers),
        phaseFinished: Array.from(game.phaseFinished),
        isGodView: true 
      });
    }
  });

  socket.on("adminLeaveRoom", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    socket.leave(roomId);
    broadcastRoomList(io, socket);
  });

  socket.on("adminStartTutorial", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game) {
          game.phase = "TUTORIAL";
          game.tutorialStep = 0;
          game.logs.push("🎓 上帝开启了新手教程");
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminTutorialNext", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "TUTORIAL") {
          game.tutorialStep = (game.tutorialStep || 0) + 1;
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminTutorialPrev", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "TUTORIAL") {
          game.tutorialStep = Math.max(0, (game.tutorialStep || 0) - 1);
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminEndTutorial", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game) {
          game.phase = "ERA_INTRO"; 
          game.tutorialStep = 0;
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminStartGame", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    if (game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
      const shuffledIds = shuffleArray(game.players.map(p => p.id));
      game.players.forEach(p => { p.draftOrder = shuffledIds.indexOf(p.id) + 1; });
      game.logs.push(`🎲 初始随机座次已分配`);

      if (game.activeProjects.length === 0) {
          drawProjectsForEra(game);
      }

      game.phase = "INVESTMENT";
      game.investmentEndsAt = Date.now() + 10 * 60 * 1000; 

      game.logs.push("👑 游戏开始！进入投资阶段");
      broadcastUpdate(io, game);
    }
  });

  socket.on("adminKickPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const playerIndex = game.players.findIndex(p => p.id === targetPlayerId);
    if (playerIndex !== -1) {
      game.players.splice(playerIndex, 1);
      broadcastUpdate(io, game);
    }
  });

  socket.on("adminUnlockPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const player = game.players.find(p => p.id === targetPlayerId);
    if (player) { player.ready = false; game.readyPlayers.delete(targetPlayerId); broadcastUpdate(io, game); }
  });

  socket.on("adminDissolveRoom", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    if (rooms[roomId]) {
        io.to(roomId).emit("roomDissolved");
        delete rooms[roomId];
        io.to("super_admin_room").emit("adminRoomList", Object.keys(rooms).map(rid => ({
            roomId: rid,
            playerCount: rooms[rid].players.length,
            phase: rooms[rid].phase
        })));
    }
  });

  socket.on("adminSkipPhase", ({ roomId, targetPhase }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    if (targetPhase) {
        game.phase = targetPhase;
        game.logs.push(`⏭️ 上帝强制跳转至 [${targetPhase}]`);
        broadcastUpdate(io, game);
        return;
    }

    if (game.phase === "DRAFTING") {
        const { draftingState } = game;
        game.players.forEach(p => {
            if (p.draftOrder === undefined) {
                const slot = draftingState.availableSlots.shift();
                if (slot) p.draftOrder = slot;
            }
        });
    }
    if (game.phase === "BUFF_USAGE") { game.buffPhaseEndsAt = undefined; }
    if (game.phase === "INVESTMENT") { game.investmentEndsAt = undefined; }

    game.players.forEach(p => { p.ready = true; game.readyPlayers.add(p.id); });
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
  });

  socket.on("adminForceSettle", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (game && game.phase === "INVESTMENT") {
       game.investmentEndsAt = undefined;
       game.players.forEach(p => { p.ready = true; game.readyPlayers.add(p.id); });
       tryAdvancePhase(game);
       broadcastUpdate(io, game);
    }
  });

  // 拍卖交易请求
  socket.on("adminProposeBuff", ({ roomId, playerId, cardId, cost }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game || game.phase !== "AUCTION") return;

      const player = game.players.find(p => p.id === playerId);
      if (player && player.socketId) {
          io.to(player.socketId).emit("auctionTradeRequest", { cardId, cost });
          game.logs.push(`🔨 上帝向 ${player.name} 发起拍卖确认：[${cardId}] 价格 ${cost}`);
          broadcastUpdate(io, game);
      }
  });

  socket.on("playerRespondAuction", ({ cardId, cost, accept }) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId]) return;
      const game = rooms[roomId];
      const player = game.players.find(p => p.socketId === socket.id);
      
      if (!player) return;

      if (accept) {
          if (player.wealth >= cost) {
              player.wealth -= cost;
              player.inventory.push(cardId);
              game.logs.push(`✅ ${player.name} 支付 ${cost} 财富，拍得 [${cardId}]`);
          } else {
              game.logs.push(`❌ ${player.name} 试图购买 [${cardId}] 但财富不足 (${player.wealth}/${cost})`);
              socket.emit("error", "财富不足，交易失败");
          }
      } else {
          game.logs.push(`🚫 ${player.name} 拒绝了拍卖交易 [${cardId}]`);
      }
      broadcastUpdate(io, game);
  });

  socket.on("adminEndAuction", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "AUCTION") {
          game.phase = "ERA_INTRO";
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminRateSocial", ({ roomId, targetPlayerId, rank }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      const player = game.players.find(p => p.id === targetPlayerId);
      if (player) {
          player.socialRank = rank; 
          game.logs.push(`📝 上帝给 ${player.name} 社交评分: ${rank}`);
          broadcastUpdate(io, game);
      }
  });

  // ✅ 新增：上帝手动结算彩票
  socket.on("adminSettleLottery", ({ roomId, targetPlayerId, amount }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      
      const player = game.players.find(p => p.id === targetPlayerId);
      if (player) {
          player.wealth += amount;
          game.logs.push(`🎲 彩票开奖！上帝给 ${player.name} 发放了 ${amount} 财富`);
          broadcastUpdate(io, game);
      }
  });

  // === AI 与自动调优 ===
  socket.on("adminAddAI", ({ roomId, persona }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      
      if (game.players.length >= 6) {
          socket.emit("error", "房间已满 (Max 6)");
          return;
      }
      
      const aiId = `ai_${Math.random().toString(36).substring(2, 8)}`;
      game.players.push({
          id: aiId,
          name: `🤖${persona}`,
          isAI: true,
          aiPersona: persona,
          connected: true,
          ready: false,
          energy: 15,
          wealth: 0,
          rank: 0,
          investment: {},
          longTerm: {},
          riskGains: {},
          inventory: [],
          usedCards: [],
          activeBuffs: [],
          slackedBy: [],
          totalEnergyConsumed: 15,
          wealthHistory: [0],
          investedRiskEnergy: 0,
          investedLongEnergy: 0,
          socialRank: null
      });
      game.logs.push(`🤖 AI 玩家 [${persona}] 加入游戏`);
      broadcastUpdate(io, game);
  });

  socket.on("adminStartAutoPlay", async ({ roomId, iterations }) => {
      if (!socket.data.isSuperAdmin) return;
      // Start headless session in background
      // Note: In real app, this should probably broadcast progress back
      socket.emit("info", `开始全自动调优 (迭代 ${iterations} 次)，请查看后端控制台日志`);
      import("../ai/autoTuner.js").then(module => {
          module.runAutoTuningSession(iterations || 5);
      });
  });

  // === Player ===
  socket.on("playerReady", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) { togglePlayerReady(game, player.id); tryAdvancePhase(game); broadcastUpdate(io, game); }
  });

  socket.on("submitInvestment", ({ investment }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) { applyInvestments(game, player.id, investment); togglePlayerReady(game, player.id); tryAdvancePhase(game); broadcastUpdate(io, game); }
  });

  socket.on("draftSeat", ({ seatIndex }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase !== 'DRAFTING') return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && game.draftingState.availableSlots.includes(seatIndex)) {
        player.draftOrder = seatIndex;
        game.draftingState.availableSlots = game.draftingState.availableSlots.filter(s => s !== seatIndex);
        game.draftingState.currentIndex++;
        if (game.draftingState.currentIndex >= game.draftingState.queue.length) { game.players.forEach(p => p.ready = true); tryAdvancePhase(game); }
        broadcastUpdate(io, game);
    }
  });

  socket.on("createTransaction", ({ toId, amount, note }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const sender = game.players.find(p => p.socketId === socket.id);
    const receiver = game.players.find(p => p.id === toId);
    if (sender && receiver && sender.wealth >= amount && amount > 0) {
      game.transactions.push({ id: Math.random().toString(), fromId: sender.id, fromName: sender.name, toId: receiver.id, toName: receiver.name, amount, note, status: "pending", timestamp: Date.now() });
      broadcastUpdate(io, game);
    }
  });

  socket.on("respondTransaction", ({ txId, accept }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const tx = game.transactions.find(t => t.id === txId);
    const player = game.players.find(p => p.socketId === socket.id);
    if (tx && player && tx.toId === player.id && tx.status === "pending") {
      if (accept) {
          const sender = game.players.find(p => p.id === tx.fromId);
          if (sender && sender.wealth >= tx.amount) { sender.wealth -= tx.amount; player.wealth += tx.amount; tx.status = "accepted"; } else { tx.status = "rejected"; }
      } else { tx.status = "rejected"; }
      broadcastUpdate(io, game);
    }
  });

  socket.on("performCoffee", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    if (player && player.wealth >= 15) { 
        player.wealth -= 15; 
        player.energy += 1; 
        player.totalEnergyConsumed += 1;
        game.logs.push(`☕ ${player.name} 购买了咖啡 (精力+1)`);
        broadcastUpdate(io, game); 
    }
  });

  socket.on("useBuffCard", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    
    if (player && game.phase === "BUFF_USAGE") {
        const result = useBuffCard(game, player.id, data.cardId, data);
        if (result.success) {
            if (!player.usedCards) player.usedCards = [];
            player.usedCards.push(data.cardId);
            if (data.cardId === 'buff_spirit') {
                player.totalEnergyConsumed += 5;
            }
            broadcastUpdate(io, game);
        } else {
            socket.emit("error", result.msg);
        }
    }
  });

  socket.on("submitCommunityName", ({ name }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    game.communityName = name;
    game.phase = "GAME_OVER";
    
    const totalScore = game.players.reduce((sum, p) => sum + p.wealth, 0);
    globalLeaderboard.push({ name: name, score: totalScore });
    globalLeaderboard.sort((a, b) => b.score - a.score);
    if(globalLeaderboard.length > 10) globalLeaderboard.pop();
    game.globalLeaderboard = globalLeaderboard;

    analyzeGamePersona(game);

    broadcastUpdate(io, game);
  });

  socket.on("disconnect", () => {
    for (const game of Object.values(rooms)) {
      const player = game.players.find(p => p.socketId === socket.id);
      if (player) player.connected = false;
    }
  });
}

function getRoomId(socket: Socket): string | undefined {
  for (const room of socket.rooms) {
    if (room !== socket.id && room !== "super_admin_room") return room;
  }
  return undefined;
}