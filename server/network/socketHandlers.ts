import { randomBytes, timingSafeEqual } from "node:crypto";
import { Server, Socket } from "socket.io";
import {
  createInitialGame,
  Player,
  resetGameSession,
  needsSessionReset,
  finishTutorialExit,
  getCommunityNamer,
  GameState,
  Phase,
} from "../state/gameState.js";
import { togglePlayerReady, forceSubmitPendingInvestments, adminUnlockPlayer, resetAllReady } from "../state/gameActions.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import { clearActionDeadline, startInvestmentDeadline } from "../state/actionDeadline.js";
import { applyInvestments, sanitizeInvestments } from "../logic/investmentLogic.js"; 
import { purchaseCoffee, refundCoffee } from "../logic/coffeeLogic.js";
import { broadcastUpdate, serializeGameForClient } from "./broadcast.js"; 
import { AI_BOT_ENABLED } from "../config/features.js";
import { TUTORIAL_MAX_STEP } from "../config/tutorial.js";
import { rooms, customImagesVersions, customEraImagesVersions, customBuffImagesVersions, customPersonaImagesVersions } from "../state/store.js";
import {
  broadcastLeaderboardToAllRooms,
  sanitizeCommunityName,
} from "../state/communityLeaderboard.js";
import { archiveCompletedSession } from "../state/sessionArchive.js"; 
import { drawProjectsForEra } from "../state/gameEra.js";
import { applyRoundEnergy, syncEnergyAfterRosterChange } from "../logic/energySchedule.js";
import { useBuffCard } from "../logic/buffLogic.js";
import { analyzeGamePersona } from "../logic/analysisLogic.js";
import { verifyAdminToken } from "../config/adminAuth.js";
import {
  beginAuctionSession,
  clearAuctionOffers,
  claimAuctionResponse,
  createAuctionOffer,
  isAuctionCardAvailable,
  isValidAuctionCost,
  markAuctionCardDistributed,
  recordAuctionCompletedDeal,
  revokeAuctionGrant,
} from "../logic/auctionCards.js";
import {
  applyLotteryAccept,
  claimLotteryResponse,
  findPendingLotteryOffer,
  proposeLotterySettle,
  revokeLotteryGrant,
} from "../logic/lotterySettle.js";
import { pruneSettledTransactions, pendingCountFrom, MAX_PENDING_PER_SENDER } from "../util/pruneTransactions.js";
import { allow } from "../util/rateLimit.js";
import { canCreateRoom } from "../logic/roomCreatePolicy.js";
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
const MAX_ROOMS = 50;

const JUMPABLE_PHASES: ReadonlySet<string> = new Set([
  "ROOM_WAITING",
  "ERA_INTRO",
  "TUTORIAL",
  "AUCTION",
  "BUFF_USAGE",
  "INVESTMENT",
  "SETTLEMENT",
  "COMMUNITY_NAMING",
  "GAME_OVER",
]);

/** 离开所有游戏房间频道，保留 super_admin_room */
function leaveAllGameRooms(socket: Socket) {
  for (const room of socket.rooms) {
    if (room !== socket.id && room !== "super_admin_room") {
      socket.leave(room);
    }
  }
  delete socket.data.gameRoomId;
}

/** 主持认领座位后离房时，把该玩家标为离线并放开昵称 */
function detachClaimedPlayer(socket: Socket): GameState | null {
  for (const game of Object.values(rooms)) {
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) continue;
    player.connected = false;
    player.ready = false;
    game.readyPlayers.delete(player.id);
    player.socketId = undefined;
    syncEnergyAfterRosterChange(game);
    return game;
  }
  return null;
}

function clientIp(socket: Socket): string {
  const fwd = socket.handshake.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first ?? socket.handshake.address ?? "unknown").trim();
}

function issueReconnectToken(): string {
  return randomBytes(24).toString("base64url");
}

function reconnectTokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string" || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

function detachKickedPlayerSocket(io: Server, roomId: string, socketId: string | undefined) {
  if (!socketId) return;
  const kickedSocket = io.sockets.sockets.get(socketId);
  if (!kickedSocket) return;
  kickedSocket.leave(roomId);
  delete kickedSocket.data.gameRoomId;
  kickedSocket.emit("playerKicked", { message: "你已被主持人移出房间" });
}

function finalizeCommunityName(io: Server, game: GameState, communityName: string, source: string): void {
  const prevPhase = game.phase;
  game.communityName = communityName;
  game.phase = "GAME_OVER";
  analyzeGamePersona(game);
  appendSessionEvent(game, "community_named", { communityName, source });
  recordPhaseChange(game, prevPhase, game.phase, source);
  archiveCompletedSession(game);
  broadcastUpdate(io, game);
  broadcastLeaderboardToAllRooms(io);
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  console.log(`🔌 Socket connected: ${socket.id}`);
  
  // 发送自定义图片版本号
  socket.emit("syncProjectImages", customImagesVersions);
  socket.emit("syncEraImages", customEraImagesVersions);
  socket.emit("syncBuffImages", customBuffImagesVersions);
  socket.emit("syncPersonaImages", customPersonaImagesVersions);


  // 1. 加入房间
  socket.on("joinGame", ({ roomId, name, reconnectToken }: { roomId: string, name: string, reconnectToken?: string }) => {
    if (!allow(`join:${socket.id}`, 10, 60_000)) {
      socket.emit("error", "加入过于频繁，请稍后再试");
      return;
    }
    roomId = String(roomId).trim().slice(0, MAX_ROOM_ID_LENGTH);
    const playerName = String(name).trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    if (!roomId || !playerName) return;

    const existingGame = rooms[roomId];
    let player = existingGame?.players.find(p => p.name === playerName);

    if (!player && existingGame && existingGame.players.length >= 6) {
      socket.emit("error", "房间已满 (Max 6)");
      return;
    }

    let replacedSocketId: string | undefined;
    if (player) {
      if (player.isAI) {
        socket.emit("error", "该昵称已被占用，请更换昵称");
        return;
      }
      if (player.reconnectToken) {
        if (!reconnectTokenMatches(player.reconnectToken, reconnectToken)) {
          socket.emit("error", "该昵称已被占用，如需恢复身份请联系主持人");
          return;
        }
        if (player.connected && player.socketId && player.socketId !== socket.id) {
          replacedSocketId = player.socketId;
        }
      } else if (player.connected && player.socketId && player.socketId !== socket.id) {
        socket.emit("error", "该昵称已在房间中在线，请更换昵称或等待对方离线");
        return;
      }
    }

    if (!rooms[roomId]) {
      if (Object.keys(rooms).length >= MAX_ROOMS) {
        socket.emit("error", "服务器房间已满，请稍后再试");
        return;
      }
      const ip = clientIp(socket);
      const gate = canCreateRoom(rooms, ip);
      if (!gate.ok) {
        socket.emit("error", gate.message);
        return;
      }
      rooms[roomId] = createInitialGame(roomId, []);
      rooms[roomId].createdByIp = ip;
    }
    const game = rooms[roomId];

    if (replacedSocketId) {
      const oldSocket = io.sockets.sockets.get(replacedSocketId);
      if (oldSocket) {
        oldSocket.leave(roomId);
        delete oldSocket.data.gameRoomId;
        oldSocket.emit("sessionReplaced", { message: "你的身份已在其他页面登录" });
      }
    }

    leaveAllGameRooms(socket);
    socket.join(roomId);
    socket.data.gameRoomId = roomId;

    if (player) {
      const rejoining = !player.connected;
      if (!player.reconnectToken) player.reconnectToken = issueReconnectToken();
      player.socketId = socket.id;
      player.connected = true;
      if (game.phase === "ROOM_WAITING") {
        player.ready = false;
        game.readyPlayers.delete(player.id);
      }
      if (rejoining) syncEnergyAfterRosterChange(game, player);
    } else {
      const newPlayer: Player = {
        id: socket.id,
        name: playerName,
        socketId: socket.id,
        reconnectToken: issueReconnectToken(),
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
        coffeePurchasesThisRound: 0,
        totalEnergyConsumed: 15,
        wealthHistory: [0], 
        investedRiskEnergy: 0,
        investedLongEnergy: 0,
        investedShortEnergy: 0,
        socialRank: null
      };
      game.players.push(newPlayer);
      syncEnergyAfterRosterChange(game, newPlayer);
      player = newPlayer;
      game.logs.push(`👤 玩家 ${player.name} 加入游戏`);
    }

    socket.emit("playerJoined", { playerId: player.id, reconnectToken: player.reconnectToken });
    broadcastUpdate(io, game);
    const pendingLottery = findPendingLotteryOffer(game, player.id);
    if (pendingLottery) {
      socket.emit("lotterySettleRequest", {
        offerId: pendingLottery.offerId,
        amount: pendingLottery.amount,
      });
    }
    
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
      syncEnergyAfterRosterChange(game);
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
    const isGodView = socket.data.isSuperAdmin === true;
    socket.emit(
      "gameUpdate",
      serializeGameForClient(game, isGodView ? { isGodView: true } : {}, player?.id ?? null)
    );
  });

  // === Admin ===
  socket.on("adminAuthenticate", ({ token }: { token?: string }) => {
    console.log("[admin] authenticate request socket=%s", socket.id);
    if (!allow(`admin-auth:${socket.id}`, 5, 60_000)) {
      socket.emit("adminAuthFailed", { message: "尝试过于频繁，请稍后再试" });
      return;
    }
    if (!verifyAdminToken(token)) {
      console.log("[admin] authenticate rejected (invalid token)");
      socket.data.isSuperAdmin = false;
      socket.leave("super_admin_room");
      setTimeout(() => {
        socket.emit("adminAuthFailed", { message: "密钥无效" });
      }, 400);
      return;
    }
    console.log("[admin] authenticate ok socket=%s", socket.id);
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
    const detached = detachClaimedPlayer(socket);
    leaveAllGameRooms(socket);
    if (detached) broadcastUpdate(io, detached);
    socket.join(rid);
    socket.data.gameRoomId = rid;
    socket.emit("gameUpdate", serializeGameForClient(game, { isGodView: true }));
  });

  socket.on("adminLeaveRoom", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const detached = detachClaimedPlayer(socket);
    socket.leave(roomId);
    delete socket.data.gameRoomId;
    if (detached) broadcastUpdate(io, detached);
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
      applyRoundEnergy(game, { relock: true });
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

      const prevPhase = game.phase;
      ensureSessionStarted(game);
      if (game.energyTableSize == null) {
        applyRoundEnergy(game, { relock: true });
      }

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
      syncEnergyAfterRosterChange(game);
      broadcastUpdate(io, game);
      broadcastRoomList(io);
    }
  });

  socket.on("adminReleasePlayerClaim", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const player = game.players.find((p) => p.id === targetPlayerId);
    if (!player || player.isAI) {
      socket.emit("error", "找不到该玩家");
      return;
    }
    if (player.connected) {
      socket.emit("error", "玩家在线，无需重新认领");
      return;
    }

    const previous = detachClaimedPlayer(socket);
    if (previous && previous.roomId !== game.roomId) {
      broadcastUpdate(io, previous);
    }

    // 主持直接接管离线座位，无需再回大厅用同昵称进入
    player.reconnectToken = undefined;
    player.socketId = socket.id;
    player.connected = true;
    if (game.phase === "ROOM_WAITING") {
      player.ready = false;
      game.readyPlayers.delete(player.id);
    }
    socket.data.gameRoomId = game.roomId;
    syncEnergyAfterRosterChange(game, player);
    game.logs.push(`🔑 主持认领并进入玩家 ${player.name}`);
    broadcastUpdate(io, game);
  });

  socket.on("adminUnlockPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    const result = adminUnlockPlayer(game, targetPlayerId);
    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        not_found: "解锁失败：找不到该玩家",
        not_ready: "解锁失败：该玩家未处于已锁定状态",
        wrong_phase: "倒计时已结束或已进入结算，无法解锁",
        timer_closed: "倒计时已结束或已进入结算，无法解锁",
        ai_player: "无法解锁 AI 玩家",
      };
      socket.emit("error", messages[result.reason]);
      return;
    }

    const unlocked = game.players.find((p) => p.id === targetPlayerId);
    if (unlocked?.socketId) {
      io.to(unlocked.socketId).emit("playerNotify", {
        message: "主持人允许你修改已提交的投资方案，精力已退回，请调整后重新提交。",
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
        if (typeof targetPhase !== "string" || !JUMPABLE_PHASES.has(targetPhase)) {
          socket.emit("error", `阶段 ${targetPhase} 不可跳转`);
          return;
        }
        const nextPhase = targetPhase as Phase;
        const prevPhase = game.phase;
        if (nextPhase === "ERA_INTRO" && needsSessionReset(game)) {
          resetGameSession(game);
          game.phase = "ERA_INTRO";
          applyRoundEnergy(game, { relock: true });
          resetAllReady(game);
          game.logs.push(`⏭️ 上帝强制跳转至 [${nextPhase}]（已重置局内状态）`);
        } else if (nextPhase === "ROOM_WAITING") {
          resetGameSession(game);
          resetAllReady(game);
          game.logs.push(`⏭️ 上帝强制跳转至 [${nextPhase}]（已重置局内状态）`);
        } else {
          game.phase = nextPhase;
          if (nextPhase === "AUCTION") beginAuctionSession(game);
          if (
            (nextPhase === "ERA_INTRO" || nextPhase === "INVESTMENT") &&
            game.energyTableSize == null
          ) {
            applyRoundEnergy(game, { relock: true });
          }
          if (nextPhase === "INVESTMENT") {
            clearActionDeadline(game);
            startInvestmentDeadline(game);
          }
          if (nextPhase === "BUFF_USAGE") {
            clearActionDeadline(game);
            resetAllReady(game);
          }
          game.logs.push(`⏭️ 上帝强制跳转至 [${nextPhase}]`);
        }
        recordPhaseChange(game, prevPhase, game.phase, "adminSkipPhase");
        broadcastUpdate(io, game);
        return;
    }

    if (game.phase === "COMMUNITY_NAMING") {
      const fallback = sanitizeCommunityName(`社区-${game.roomId}`) || "未命名社区";
      finalizeCommunityName(io, game, fallback, "adminSkipPhase");
      return;
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
      if (typeof cardId !== "string" || !isAuctionCardAvailable(game, cardId)) {
          socket.emit("error", "该道具已成交或不在本轮拍卖池");
          return;
      }
      if (!isValidAuctionCost(cost)) {
          socket.emit("error", "拍卖价格必须为非负整数");
          return;
      }

      const player = game.players.find(p => p.id === playerId);
      if (!player || player.isAI) {
          socket.emit("error", "拍卖得主无效");
          return;
      }
      if (!player.socketId) {
          socket.emit("error", "玩家未在线，无法发送拍卖确认");
          return;
      }
      const { offer, replaced } = createAuctionOffer(game, player.id, cardId, cost);
      if (replaced && replaced.playerId !== player.id) {
        const previousTarget = game.players.find((p) => p.id === replaced.playerId);
        if (previousTarget?.socketId) {
          io.to(previousTarget.socketId).emit("auctionOfferCancelled", {
            offerId: replaced.offerId,
            cardId,
          });
        }
      }
      io.to(player.socketId).emit("auctionTradeRequest", { offerId: offer.offerId, cardId, cost });
      game.logs.push(`🔨 上帝向 ${player.name} 发起拍卖确认：[${cardId}] 价格 ${cost}`);
      appendSessionEvent(game, "auction_offered", {
        targetPlayerId: playerId,
        cardId,
        cost,
      });
      broadcastUpdate(io, game);
  });

  socket.on("playerRespondAuction", (data) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId]) return;
      const game = rooms[roomId];
      const player = game.players.find(p => p.socketId === socket.id);
      
      if (!player) return;
      const accept = data?.accept === true;
      const claimed = claimAuctionResponse(game, player.id, data?.offerId, accept);
      if (!claimed.ok) {
          socket.emit("error", claimed.message);
          return;
      }
      const { cardId, cost } = claimed;

      let accepted = false;
      let costPaid = 0;
      let cardEnteredInventory = false;

      if (accept) {
          if (player.wealth >= cost) {
              player.wealth -= cost;
              player.inventory.push(cardId);
              markAuctionCardDistributed(game, cardId);
              recordAuctionCompletedDeal(game, cardId, player.id, cost);
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

  socket.on("adminRevokeAuctionCard", ({ roomId, cardId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game || game.phase !== "AUCTION") {
      socket.emit("error", "仅拍卖阶段可撤销发放");
      return;
    }
    if (typeof cardId !== "string" || !cardId) {
      socket.emit("error", "道具无效");
      return;
    }
    const result = revokeAuctionGrant(game, cardId);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    const target = game.players.find((p) => p.id === result.playerId);
    if (result.kind === "pending") {
      if (target?.socketId) {
        io.to(target.socketId).emit("auctionOfferCancelled", {
          offerId: result.offerId,
          cardId,
        });
      }
      game.logs.push(
        `↩️ 上帝撤回了 [${cardId}] 的待确认报价（${target?.name ?? result.playerId}）`
      );
      appendSessionEvent(game, "auction_offer_cancelled", {
        cardId,
        playerId: result.playerId,
        offerId: result.offerId,
      });
    } else {
      game.logs.push(
        `↩️ 上帝撤销了 [${cardId}] 的成交（${target?.name ?? result.playerId}，退还 ${result.cost} 财富）`
      );
      appendSessionEvent(game, "auction_revoked", {
        cardId,
        playerId: result.playerId,
        costRefunded: result.cost,
      });
    }
    broadcastUpdate(io, game);
  });

  socket.on("adminEndAuction", ({ roomId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (game && game.phase === "AUCTION") {
          const prevPhase = game.phase;
          clearAuctionOffers(game);
          game.phase = "ERA_INTRO";
          recordPhaseChange(game, prevPhase, game.phase, "adminEndAuction");
          io.to(game.roomId).emit("auctionOffersCleared");
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

  // 上帝提议彩票开奖（待玩家确认后才入账）
  socket.on("adminSettleLottery", ({ roomId, targetPlayerId, amount }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;

      const proposed = proposeLotterySettle(game, targetPlayerId, amount);
      if (!proposed.ok) {
          socket.emit("error", proposed.message);
          return;
      }
      const { offer, replaced, player } = proposed;
      if (replaced && player.socketId) {
        io.to(player.socketId).emit("lotteryOfferCancelled", { offerId: replaced.offerId });
      }
      if (player.socketId) {
        io.to(player.socketId).emit("lotterySettleRequest", {
          offerId: offer.offerId,
          amount: offer.amount,
        });
      }
      game.logs.push(`🎲 上帝向 ${player.name} 发起彩票开奖确认：${offer.amount} 财富`);
      appendSessionEvent(game, "lottery_offered", {
        targetPlayerId,
        amount: offer.amount,
        offerId: offer.offerId,
      });
      broadcastUpdate(io, game);
  });

  socket.on("playerRespondLottery", (data) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId]) return;
      const game = rooms[roomId];
      const player = game.players.find(p => p.socketId === socket.id);
      if (!player) return;

      const accept = data?.accept === true;
      const claimed = claimLotteryResponse(game, player.id, data?.offerId, accept);
      if (!claimed.ok) {
          socket.emit("error", claimed.message);
          return;
      }

      if (accept) {
          applyLotteryAccept(game, player, claimed.amount);
          game.logs.push(`🎲 彩票开奖！${player.name} 确认领取 ${claimed.amount} 财富`);
          appendSessionEvent(
            game,
            "lottery_settled",
            { targetPlayerId: player.id, amount: claimed.amount, accepted: true },
            player.id
          );
      } else {
          game.logs.push(`🚫 ${player.name} 拒绝了彩票开奖金额 ${claimed.amount}`);
          appendSessionEvent(
            game,
            "lottery_offer_cancelled",
            { playerId: player.id, amount: claimed.amount, declined: true },
            player.id
          );
      }
      broadcastUpdate(io, game);
  });

  socket.on("adminRevokeLottery", ({ roomId, targetPlayerId }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      if (typeof targetPlayerId !== "string" || !targetPlayerId) {
          socket.emit("error", "玩家无效");
          return;
      }
      const result = revokeLotteryGrant(game, targetPlayerId);
      if (!result.ok) {
          socket.emit("error", result.message);
          return;
      }
      const target = game.players.find((p) => p.id === result.playerId);
      if (result.kind === "pending") {
          if (target?.socketId) {
              io.to(target.socketId).emit("lotteryOfferCancelled", { offerId: result.offerId });
          }
          game.logs.push(
            `↩️ 上帝撤回了 ${target?.name ?? result.playerId} 的彩票待确认开奖`
          );
          appendSessionEvent(game, "lottery_offer_cancelled", {
            playerId: result.playerId,
            offerId: result.offerId,
          });
      } else {
          game.logs.push(
            `↩️ 上帝撤回了 ${target?.name ?? result.playerId} 的彩票开奖（回滚 ${result.amount} 财富）`
          );
          appendSessionEvent(game, "lottery_revoked", {
            playerId: result.playerId,
            amountReversed: result.amount,
          });
      }
      broadcastUpdate(io, game);
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
          coffeePurchasesThisRound: 0,
          totalEnergyConsumed: 15,
          wealthHistory: [0],
          investedRiskEnergy: 0,
          investedLongEnergy: 0,
        investedShortEnergy: 0,
          socialRank: null
      });
      syncEnergyAfterRosterChange(game, game.players[game.players.length - 1]);
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

  socket.on("createTransaction", ({ toId, amount, note, clientTempId }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase === "ROOM_WAITING" || game.phase === "ERA_INTRO" || game.phase === "TUTORIAL") {
      socket.emit("error", "当前阶段无法发送私信或转账");
      return;
    }
    const sender = game.players.find(p => p.socketId === socket.id);
    const receiver = game.players.find(p => p.id === toId);
    // 严格一对一：单条记录仅绑定发送方与唯一接收方
    if (!sender || !receiver || sender.id === receiver.id) {
      socket.emit("error", "无法发送：目标玩家无效");
      return;
    }
    if (!allow(`tx:${sender.id}`, 20, 60_000)) {
      socket.emit("error", "发送过于频繁，请稍后再试");
      return;
    }
    pruneSettledTransactions(game);
    if (pendingCountFrom(game, sender.id) >= MAX_PENDING_PER_SENDER) {
      socket.emit("error", "未完成的转账过多，请等待对方确认");
      return;
    }

    const amt = Math.floor(Number(amount) || 0);
    const message = (typeof note === "string" ? note.trim() : "").slice(0, 500);
    const tempId =
      typeof clientTempId === "string" && clientTempId.length > 0 && clientTempId.length <= 64
        ? clientTempId
        : undefined;

    if (amt === 0) {
      if (!message) {
        socket.emit("error", "私信内容不能为空");
        return;
      }
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
        clientTempId: tempId,
      };
      game.transactions.push(tx);
      appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
      pruneSettledTransactions(game);
      broadcastUpdate(io, game);
      return;
    }

    if (amt <= 0) {
      socket.emit("error", "转账金额无效");
      return;
    }
    if (sender.wealth < amt) {
      socket.emit("error", "财富不足，无法转账");
      return;
    }

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
      clientTempId: tempId,
    };
    game.transactions.push(tx);
    appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
    pruneSettledTransactions(game);
    broadcastUpdate(io, game);
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
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") {
      socket.emit("error", "当前阶段无法购买咖啡");
      return;
    }
    if (player.ready && game.phase === "INVESTMENT") {
      socket.emit("error", "已提交投资，无法购买咖啡");
      return;
    }
    const result = purchaseCoffee(game, player);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    broadcastUpdate(io, game);
  });

  socket.on("cancelCoffee", ({ count }: { count?: number }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") {
      socket.emit("error", "当前阶段无法退订咖啡");
      return;
    }
    if (player.ready && game.phase === "INVESTMENT") {
      socket.emit("error", "已提交投资，无法退订咖啡");
      return;
    }
    const result = refundCoffee(game, player, Number(count));
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    broadcastUpdate(io, game);
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

    const namer = getCommunityNamer(game);
    if (!namer || player.id !== namer.id) {
      socket.emit("error", "仅当前在线的首富可为社区命名");
      return;
    }

    const communityName = sanitizeCommunityName(name);
    if (!communityName) {
      socket.emit("error", "请输入有效的社区名称");
      return;
    }

    finalizeCommunityName(io, game, communityName, "player");
  });

  socket.on("adminSubmitCommunityName", ({ roomId, name }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    if (game.phase !== "COMMUNITY_NAMING") {
      socket.emit("error", "当前阶段不能为社区命名");
      return;
    }
    if (game.communityName) {
      socket.emit("error", "社区已命名，请勿重复提交");
      return;
    }
    const communityName = sanitizeCommunityName(name);
    if (!communityName) {
      socket.emit("error", "请输入有效的社区名称");
      return;
    }
    finalizeCommunityName(io, game, communityName, "admin");
  });

  socket.on("disconnect", () => {
    const boundRoom = socket.data.gameRoomId as string | undefined;
    if (boundRoom && rooms[boundRoom]) {
      const game = rooms[boundRoom];
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        syncEnergyAfterRosterChange(game);
        broadcastUpdate(io, game);
      }
      return;
    }
    for (const game of Object.values(rooms)) {
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        syncEnergyAfterRosterChange(game);
        broadcastUpdate(io, game);
      }
    }
  });
}

function getRoomId(socket: Socket): string | undefined {
  const bound = socket.data.gameRoomId;
  if (typeof bound === "string" && bound) return bound;
  return undefined;
}