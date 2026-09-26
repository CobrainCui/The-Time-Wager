import { Server, Socket } from "socket.io";
import {
  createInitialGame,
  Player,
  resetGameSession,
  needsSessionReset,
  finishTutorialExit,
  getWealthiestPlayer,
} from "../state/gameState.js";
import { togglePlayerReady, forceSubmitPendingInvestments, adminUnlockPlayer, resetAllReady } from "../state/gameActions.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { clearActionDeadline, startInvestmentDeadline } from "../state/actionDeadline.js";
import { applyInvestments, sanitizeInvestments } from "../logic/investmentLogic.js"; 
import { broadcastUpdate, serializeGameForClient } from "./broadcast.js"; 
import { AI_BOT_ENABLED } from "../config/features.js";
import { TUTORIAL_MAX_STEP } from "../config/tutorial.js";
import { rooms, customImagesVersions, customEraImagesVersions, customBuffImagesVersions } from "../state/store.js";
import {
  recordCommunityScore,
  broadcastLeaderboardToAllRooms,
  sanitizeCommunityName,
} from "../state/communityLeaderboard.js"; 
import { drawProjectsForEra } from "../state/gameEra.js";
import { shuffleArray } from "../utils/shuffle.js";
import { useBuffCard } from "../logic/buffLogic.js";
import { analyzeGamePersona } from "../logic/analysisLogic.js";
import { verifyAdminToken } from "../config/adminAuth.js";
import { beginAuctionSession, isAuctionCardAvailable, markAuctionCardDistributed } from "../logic/auctionCards.js";
import { pruneSettledTransactions } from "../util/pruneTransactions.js";
import {
  appendSessionEvent,
  ensureSessionStarted,
  recordPhaseChange,
} from "../state/sessionTelemetry.js";

function buildAdminRoomList() {
  return Object.keys(rooms).map((rid) => ({
    roomId: rid,
    playerCount: rooms[rid].players.length,
    phase: rooms[rid].phase,
  }));
}

/** 向所有已登录管理员广播房间列表；若传入 socket 则同时给该连接发一份 */
function broadcastRoomList(io: Server, socket?: Socket) {
  const roomList = buildAdminRoomList();
  io.to("super_admin_room").emit("adminRoomList", roomList);
  if (socket) socket.emit("adminRoomList", roomList);
}

const MAX_ROOM_ID_LENGTH = 48;
const MAX_PLAYER_NAME_LENGTH = 24;

/** 离开所有游戏房间频道，保留 super_admin_room */
function leaveAllGameRooms(socket: Socket) {
  for (const room of socket.rooms) {
    if (room !== socket.id && room !== "super_admin_room") {
      socket.leave(room);
    }
  }
  delete socket.data.gameRoomId;
}

function detachKickedPlayerSocket(io: Server, roomId: string, socketId: string | undefined) {
  if (!socketId) return;
  const kickedSocket = io.sockets.sockets.get(socketId);
  if (!kickedSocket) return;
  kickedSocket.leave(roomId);
  delete kickedSocket.data.gameRoomId;
  kickedSocket.emit("playerKicked", { message: "你已被主持人移出房间" });
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  console.log(`🔌 Socket connected: ${socket.id}`);
  
  // 发送自定义图片版本号
  socket.emit("syncProjectImages", customImagesVersions);
  socket.emit("syncEraImages", customEraImagesVersions);
  socket.emit("syncBuffImages", customBuffImagesVersions);


  // 1. 加入房间
  socket.on("joinGame", ({ roomId, name }: { roomId: string, name: string }) => {
    roomId = String(roomId).trim().slice(0, MAX_ROOM_ID_LENGTH);
    const playerName = String(name).trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    if (!roomId || !playerName) return;

    if (!rooms[roomId]) {
      rooms[roomId] = createInitialGame(roomId, []);
    }
    const game = rooms[roomId];

    let player = game.players.find(p => p.name === playerName);

    if (!player && game.players.length >= 6) {
      socket.emit("error", "房间已满 (Max 6)");
      return;
    }

    if (
      player &&
      player.connected &&
      player.socketId &&
      player.socketId !== socket.id
    ) {
      socket.emit("error", "该昵称已在房间中在线，请更换昵称或等待对方离线");
      return;
    }

    leaveAllGameRooms(socket);
    socket.join(roomId);
    socket.data.gameRoomId = roomId;

    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      if (game.phase === "ROOM_WAITING") {
        player.ready = false;
        game.readyPlayers.delete(player.id);
      }
    } else {
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
    
    broadcastRoomList(io);
  });

  socket.on("leaveGame", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) {
      leaveAllGameRooms(socket);
      return;
    }
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (player) {
      player.connected = false;
      player.ready = false;
      game.readyPlayers.delete(player.id);
    }
    leaveAllGameRooms(socket);
    broadcastUpdate(io, game);
    broadcastRoomList(io);
  });

  /** 已入房但未收到状态时拉取全量（与 joinGame 后 gameUpdate 一致） */
  socket.on("requestGameState", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    const isGodView = socket.data.isSuperAdmin === true && !player;
    socket.emit(
      "gameUpdate",
      serializeGameForClient(game, isGodView ? { isGodView: true } : {}, player?.id ?? null)
    );
  });

  // === Admin ===
  socket.on("adminAuthenticate", ({ token }: { token?: string }) => {
    if (!verifyAdminToken(token)) {
      socket.data.isSuperAdmin = false;
      socket.leave("super_admin_room");
      socket.emit("adminAuthFailed", { message: "密钥无效" });
      return;
    }
    socket.data.isSuperAdmin = true;
    socket.join("super_admin_room");
    socket.emit("adminAuthOk");
    broadcastRoomList(io, socket);
  });

  socket.on("adminSpectate", ({ targetRoomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const rid = String(targetRoomId ?? "").trim().slice(0, MAX_ROOM_ID_LENGTH);
    const game = rooms[rid];
    if (!game) {
      socket.emit("error", "房间不存在或已解散");
      return;
    }
    leaveAllGameRooms(socket);
    socket.join(rid);
    socket.emit("gameUpdate", serializeGameForClient(game, { isGodView: true }));
  });

  socket.on("adminLeaveRoom", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    socket.leave(roomId);
    broadcastRoomList(io, socket);
  });

  socket.on("adminStartTutorial", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && (game.phase === "ERA_INTRO" || game.phase === "ROOM_WAITING")) {
          game.tutorialEntryPhase = game.phase;
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
          const next = Math.min((game.tutorialStep || 0) + 1, TUTORIAL_MAX_STEP);
          if (next === game.tutorialStep) return;
          game.tutorialStep = next;
          game.logs.push(`🎓 教程进度：第 ${next + 1} 页`);
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminTutorialPrev", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "TUTORIAL") {
          const prev = Math.max(0, (game.tutorialStep || 0) - 1);
          if (prev === game.tutorialStep) return;
          game.tutorialStep = prev;
          game.logs.push(`🎓 教程进度：第 ${prev + 1} 页`);
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminEndTutorial", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "TUTORIAL") {
          finishTutorialExit(game);
          game.logs.push("🎓 上帝结束了新手教程");
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminStartGame", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    if (game.phase === "ROOM_WAITING") {
      if (needsSessionReset(game)) {
        resetGameSession(game);
      }
      const online = game.players.filter((p) => p.connected);
      if (online.length === 0) {
        socket.emit("error", "暂无在线玩家，无法开局");
        return;
      }
      resetAllReady(game);
      const prevPhase = game.phase;
      ensureSessionStarted(game);
      game.phase = "ERA_INTRO";
      game.logs.push("👑 主持开局，进入第 1 时代");
      recordPhaseChange(game, prevPhase, game.phase, "adminStartGame");
      broadcastUpdate(io, game);
      return;
    }

    if (game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
      if (game.phase === "TUTORIAL") {
        finishTutorialExit(game);
      }
      if (needsSessionReset(game)) {
        resetGameSession(game);
      }

      const shuffledIds = shuffleArray(game.players.map(p => p.id));
      game.players.forEach(p => { p.draftOrder = shuffledIds.indexOf(p.id) + 1; });
      appendSessionEvent(game, "draft_seat_chosen", {
        mode: "random",
        orders: Object.fromEntries(game.players.map((p) => [p.id, p.draftOrder])),
      });
      game.logs.push(`🎲 初始随机座次已分配`);

      if (game.currentEra === 1 && game.roundInEra === 1) {
        game.activeProjects = [];
        game.uncompletedProjects = [];
        game.completedProjects = [];
        game.drawnProjects = new Set();
        game.totalRiskEnergyAvailable = 0;
        drawProjectsForEra(game);
      } else if (game.activeProjects.length === 0) {
        drawProjectsForEra(game);
      }

      const prevPhase = game.phase;
      ensureSessionStarted(game);
      game.phase = "INVESTMENT";
      startInvestmentDeadline(game);

      game.logs.push("👑 游戏开始！进入投资阶段");
      recordPhaseChange(game, prevPhase, game.phase, "adminStartGame");
      broadcastUpdate(io, game);
    }
  });

  socket.on("adminKickPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const playerIndex = game.players.findIndex(p => p.id === targetPlayerId);
    if (playerIndex !== -1) {
      const [removed] = game.players.splice(playerIndex, 1);
      detachKickedPlayerSocket(io, roomId, removed.socketId);
      broadcastUpdate(io, game);
      broadcastRoomList(io);
    }
  });

  socket.on("adminUnlockPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    if (!adminUnlockPlayer(game, targetPlayerId)) {
      socket.emit("error", "解锁失败：该玩家未处于已确认状态");
      return;
    }

    const unlocked = game.players.find((p) => p.id === targetPlayerId);
    if (unlocked?.socketId) {
      io.to(unlocked.socketId).emit("playerNotify", {
        message:
          game.phase === "INVESTMENT"
            ? "主持人允许你修改已提交的投资方案，精力已退回，请调整后重新提交。"
            : game.phase === "BUFF_USAGE"
              ? "主持人已取消你的「进入讨论」确认，可继续调整。"
              : "主持人已解锁你的本阶段操作，请继续。",
      });
    }
    broadcastUpdate(io, game);
  });

  socket.on("adminDissolveRoom", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    if (rooms[roomId]) {
        const memberIds = io.sockets.adapter.rooms.get(roomId);
        if (memberIds) {
          for (const socketId of memberIds) {
            const s = io.sockets.sockets.get(socketId);
            if (s && s.data.gameRoomId === roomId) delete s.data.gameRoomId;
          }
        }
        io.to(roomId).emit("roomDissolved");
        delete rooms[roomId];
        broadcastRoomList(io);
    }
  });

  socket.on("adminSkipPhase", ({ roomId, targetPhase }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    if (targetPhase) {
        const prevPhase = game.phase;
        if (targetPhase === "ERA_INTRO" && needsSessionReset(game)) {
          resetGameSession(game);
          game.phase = "ERA_INTRO";
          resetAllReady(game);
          game.logs.push(`⏭️ 上帝强制跳转至 [${targetPhase}]（已重置局内状态）`);
        } else if (targetPhase === "ROOM_WAITING") {
          resetGameSession(game);
          resetAllReady(game);
          game.logs.push(`⏭️ 上帝强制跳转至 [${targetPhase}]（已重置局内状态）`);
        } else {
          game.phase = targetPhase;
          if (targetPhase === "AUCTION") beginAuctionSession(game);
          if (targetPhase === "INVESTMENT") {
            clearActionDeadline(game);
            startInvestmentDeadline(game);
          }
          if (targetPhase === "BUFF_USAGE") {
            clearActionDeadline(game);
            resetAllReady(game);
          }
          game.logs.push(`⏭️ 上帝强制跳转至 [${targetPhase}]`);
        }
        recordPhaseChange(game, prevPhase, game.phase, "adminSkipPhase");
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
    if (game.phase === "BUFF_USAGE") {
      clearActionDeadline(game);
    }
    if (game.phase === "INVESTMENT") {
      clearActionDeadline(game);
      forceSubmitPendingInvestments(game);
    } else {
      game.players.forEach((p) => {
        p.ready = true;
        game.readyPlayers.add(p.id);
      });
    }
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
  });

  socket.on("adminForceSettle", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (game && game.phase === "INVESTMENT") {
       clearActionDeadline(game);
       forceSubmitPendingInvestments(game);
       tryAdvancePhase(game);
       broadcastUpdate(io, game);
    }
  });

  // 拍卖交易请求
  socket.on("adminProposeBuff", ({ roomId, playerId, cardId, cost }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game || game.phase !== "AUCTION") return;
      if (!isAuctionCardAvailable(game, cardId)) {
          socket.emit("error", "该道具已成交或不在本轮拍卖池");
          return;
      }

      const player = game.players.find(p => p.id === playerId);
      if (player && player.socketId) {
          io.to(player.socketId).emit("auctionTradeRequest", { cardId, cost });
          game.logs.push(`🔨 上帝向 ${player.name} 发起拍卖确认：[${cardId}] 价格 ${cost}`);
          appendSessionEvent(game, "auction_offered", {
            targetPlayerId: playerId,
            cardId,
            cost,
          });
          broadcastUpdate(io, game);
      }
  });

  socket.on("playerRespondAuction", ({ cardId, cost, accept }) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId]) return;
      const game = rooms[roomId];
      const player = game.players.find(p => p.socketId === socket.id);
      
      if (!player) return;

      let accepted = false;
      let costPaid = 0;
      let cardEnteredInventory = false;

      if (accept) {
          if (player.wealth >= cost) {
              player.wealth -= cost;
              player.inventory.push(cardId);
              markAuctionCardDistributed(game, cardId);
              accepted = true;
              costPaid = cost;
              cardEnteredInventory = true;
              game.logs.push(`✅ ${player.name} 支付 ${cost} 财富，拍得 [${cardId}]`);
          } else {
              game.logs.push(`❌ ${player.name} 试图购买 [${cardId}] 但财富不足 (${player.wealth}/${cost})`);
              socket.emit("error", "财富不足，交易失败");
          }
      } else {
          game.logs.push(`🚫 ${player.name} 拒绝了拍卖交易 [${cardId}]`);
      }

      appendSessionEvent(
        game,
        "auction_resolved",
        { cardId, cost, accepted, costPaid, cardEnteredInventory },
        player.id
      );
      broadcastUpdate(io, game);
  });

  socket.on("adminEndAuction", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "AUCTION") {
          const prevPhase = game.phase;
          game.phase = "ERA_INTRO";
          recordPhaseChange(game, prevPhase, game.phase, "adminEndAuction");
          broadcastUpdate(io, game);
      }
  });

  socket.on("adminRateSocial", ({ roomId, targetPlayerId, rank }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      const player = game.players.find(p => p.id === targetPlayerId);
      if (player) {
          const ratedAt = Date.now();
          player.socialRank = rank;
          game.logs.push(`📝 上帝给 ${player.name} 社交评分: ${rank}`);
          appendSessionEvent(game, "social_rated", {
            targetPlayerId,
            rank,
            ratedAt,
          });
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
          appendSessionEvent(game, "lottery_settled", {
            targetPlayerId,
            amount,
          });
          broadcastUpdate(io, game);
      }
  });

  // === AI 与自动调优 ===
  socket.on("adminAddAI", ({ roomId, persona }) => {
      if (!AI_BOT_ENABLED) {
          socket.emit("error", "AI Bot 功能已关闭");
          return;
      }
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
      if (!AI_BOT_ENABLED) {
          socket.emit("error", "AI Bot 功能已关闭");
          return;
      }
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
    if (game.phase === "ROOM_WAITING") return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (!togglePlayerReady(game, player.id)) return;
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
  });

  socket.on("syncInvestmentDraft", ({ investment }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (game.phase === "INVESTMENT" && player.ready) return;
    player.investmentDraft = sanitizeInvestments(game, player, investment ?? {});
  });

  socket.on("submitInvestment", ({ investment }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase !== "INVESTMENT") return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player || player.ready) return;
    const sanitized = sanitizeInvestments(game, player, investment ?? {});
    if (!applyInvestments(game, player.id, sanitized)) {
      socket.emit("error", "投资方案无效（精力不足或超出限制）");
      return;
    }
    togglePlayerReady(game, player.id);
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
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
        appendSessionEvent(game, "draft_seat_chosen", { seatIndex }, player.id);
        if (game.draftingState.currentIndex >= game.draftingState.queue.length) { game.players.forEach(p => p.ready = true); tryAdvancePhase(game); }
        broadcastUpdate(io, game);
    }
  });

  socket.on("createTransaction", ({ toId, amount, note }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase === "ROOM_WAITING" || game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") return;
    const sender = game.players.find(p => p.socketId === socket.id);
    const receiver = game.players.find(p => p.id === toId);
    // 严格一对一：单条记录仅绑定发送方与唯一接收方
    if (!sender || !receiver || sender.id === receiver.id) return;

    const amt = Math.floor(Number(amount) || 0);
    const message = (typeof note === "string" ? note.trim() : "").slice(0, 500);

    if (amt === 0) {
      if (!message) return;
      const tx = {
        id: Math.random().toString(),
        fromId: sender.id,
        fromName: sender.name,
        toId: receiver.id,
        toName: receiver.name,
        amount: 0,
        note: message,
        status: "accepted" as const,
        timestamp: Date.now(),
      };
      game.transactions.push(tx);
      appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
      pruneSettledTransactions(game);
      broadcastUpdate(io, game);
      return;
    }

    if (amt > 0 && sender.wealth >= amt) {
      const tx = {
        id: Math.random().toString(),
        fromId: sender.id,
        fromName: sender.name,
        toId: receiver.id,
        toName: receiver.name,
        amount: amt,
        note: message,
        status: "pending" as const,
        timestamp: Date.now(),
      };
      game.transactions.push(tx);
      appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
      pruneSettledTransactions(game);
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
        if (tx.amount === 0) {
          tx.status = "accepted";
        } else {
          const sender = game.players.find(p => p.id === tx.fromId);
          if (sender && sender.wealth >= tx.amount) {
            sender.wealth -= tx.amount;
            player.wealth += tx.amount;
            tx.status = "accepted";
          } else {
            tx.status = "rejected";
          }
        }
      } else {
        tx.status = "rejected";
      }
      appendSessionEvent(
        game,
        "transaction_resolved",
        { txId: tx.id, accept, status: tx.status, amount: tx.amount },
        player.id
      );
      pruneSettledTransactions(game);
      broadcastUpdate(io, game);
    }
  });

  socket.on("performCoffee", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return;
    if (player.ready && game.phase === "INVESTMENT") return;
    if (player && player.wealth >= 15) { 
        player.wealth -= 15; 
        player.energy += 1; 
        player.totalEnergyConsumed += 1;
        game.logs.push(`☕ ${player.name} 购买了咖啡 (精力+1)`);
        appendSessionEvent(
          game,
          "coffee_purchased",
          { wealthCost: 15, energyGain: 1 },
          player.id
        );
        broadcastUpdate(io, game);
    }
  });

  socket.on("useBuffCard", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    
    if (player && game.phase === "BUFF_USAGE") {
        if (player.ready) {
          socket.emit("error", "已进入讨论队列，无法再使用道具卡");
          return;
        }
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

  socket.on("submitPersonaVote", ({ vote }: { vote: "fate" | "gene" | "neither" }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase !== "GAME_OVER") return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (player) {
      player.personaVote = vote;
      const voteLabel = vote === "fate" ? "命运素描" : vote === "gene" ? "决策基因" : "都不准";
      game.logs.push(`🗳️ ${player.name} 投票：${voteLabel}`);
      appendSessionEvent(game, "persona_voted", { vote }, player.id);
      broadcastUpdate(io, game);
    }
  });

  socket.on("submitCommunityName", ({ name }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];

    if (game.phase !== "COMMUNITY_NAMING") {
      socket.emit("error", "当前阶段不能为社区命名");
      return;
    }
    if (game.communityName) {
      socket.emit("error", "社区已命名，请勿重复提交");
      return;
    }

    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const richest = getWealthiestPlayer(game);
    if (!richest || player.id !== richest.id) {
      socket.emit("error", "仅首富可为社区命名");
      return;
    }

    const communityName = sanitizeCommunityName(name);
    if (!communityName) {
      socket.emit("error", "请输入有效的社区名称");
      return;
    }

    game.communityName = communityName;
    game.phase = "GAME_OVER";

    const totalScore = game.players.reduce((sum, p) => sum + p.wealth, 0);
    recordCommunityScore(communityName, totalScore, roomId);

    analyzeGamePersona(game);

    appendSessionEvent(game, "community_named", { communityName });
    broadcastLeaderboardToAllRooms(io);
  });

  socket.on("disconnect", () => {
    const boundRoom = socket.data.gameRoomId as string | undefined;
    if (boundRoom && rooms[boundRoom]) {
      const player = rooms[boundRoom].players.find((p) => p.socketId === socket.id);
      if (player) player.connected = false;
      return;
    }
    for (const game of Object.values(rooms)) {
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) player.connected = false;
    }
  });
}

function getRoomId(socket: Socket): string | undefined {
  const bound = socket.data.gameRoomId;
  if (typeof bound === "string" && bound) return bound;
  return undefined;
}