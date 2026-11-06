import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Server, Socket } from "socket.io";
import {
  createInitialGame,
  Player,
  resetGameSession,
  needsSessionReset,
  finishTutorialExit,
  getCommunityNamer,
  GameState,
  GroupMessage,
  Phase,
} from "../state/gameState.js";
import {
  togglePlayerReady,
  forceSubmitPendingInvestments,
  adminUnlockPlayer,
  unlockSubmittedInvestment,
  resetAllReady,
} from "../state/gameActions.js";
import { tryAdvancePhase } from "../state/phaseController.js";
import {
  clearActionDeadline,
  formatActionDeadlineClock,
  startInvestmentDeadline,
  pauseInvestmentDeadline,
  resumeInvestmentDeadline,
  getInvestmentRemainingMs,
  isInvestmentBuffLockoutActive,
} from "../state/actionDeadline.js";
import { applyInvestments, sanitizeInvestments } from "../logic/investmentLogic.js"; 
import {
  COFFEE_ENERGY_GAIN,
  COFFEE_WEALTH_COST,
  purchaseCoffee,
  refundCoffee,
} from "../logic/coffeeLogic.js";
import { broadcastUpdate, emitSerializedGameUpdate } from "./broadcast.js";
import { AI_BOT_ENABLED, AI_SAFETY_ENABLED } from "../config/features.js";
import { addAiPlayer, removeAiPlayer, fillAiPlayers, aiRosterSummary } from "../ai/aiRoster.js";
import { handleAIPhase, forgetAiRoom, forgetAiPlayer, clearAiFailure } from "../ai/aiOrchestrator.js";
import { applyAiPreflightToGame, verifyAiAgents } from "../ai/aiPreflight.js";
import { AI_CONFIG } from "../ai/aiConfig.js";
import {
  CRISIS_REPLY,
  SAFETY_CRISIS_WINDOW_MS,
  SAFETY_NOTICE_FROM_ID,
  SAFETY_NOTICE_FROM_NAME,
  SAFETY_REPLY_COOLDOWN_MS,
  detectCrisisSignals,
} from "../ai/aiSafety.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { STARTING_WEALTH } from "../config/startingWealth.js";
import { TUTORIAL_MAX_STEP } from "../config/tutorial.js";
import { rooms, customImagesVersions, customEraImagesVersions, customBuffImagesVersions, customPersonaImagesVersions } from "../state/store.js";
import { sanitizeCommunityName } from "../state/communityLeaderboard.js";
import { finalizeCommunityName } from "../state/communityNaming.js";
import { ensureAiSeatsFilled, startGameNow } from "../state/gameStart.js";
import { armAutoHostStart, resetAutoHostState } from "../host/autoHost.js";
import { ensureProjectsDrawnForEra } from "../state/gameEra.js";
import { applyRoundEnergy, syncEnergyAfterRosterChange } from "../logic/energySchedule.js";
import { useBuffCard, useForceBuyCard, ackSlackHit, FORCE_BUY_CARD_ID } from "../logic/buffLogic.js";
import { ackLighterBurnNotice } from "../logic/roundBuffResolve.js";
import { verifyAdminToken } from "../config/adminAuth.js";
import {
  CLIENT_UPDATE_MESSAGE,
  isClientBuildStale,
} from "../config/clientBuild.js";
import {
  beginAuctionSession,
  buildAuctionLotPublicView,
  clearAuctionOffers,
  endAuctionSession,
  formatAuctionSoldMessage,
  hammerAuctionLot,
  passAuctionLot,
  placeAuctionBid,
  playerAvailableWealth,
  formatPlayerHoldSuffix,
  revokeAuctionGrant,
  setAuctionFocusCard,
  voidAllOpenAuctionBids,
} from "../logic/auctionCards.js";
import {
  findPendingLotteryOffer,
  proposeLotterySettle,
  revokeLotteryGrant,
} from "../logic/lotterySettle.js";
import {
  acceptLotteryOffer,
  createRandomLotteryOffer,
} from "../logic/lotteryDraw.js";
import {
  claimWealthAdjustResponse,
  proposeWealthAdjust,
  revokeWealthAdjustOffer,
} from "../logic/wealthAdjust.js";
import { adminAdjustPlayerCard } from "../logic/adminPlayerCard.js";
import {
  findDeviceClaimByPlayer,
  removeDeviceClaimByPlayer,
  removeDeviceClaimBySocket,
  takeDeviceClaimForPlayer,
  upsertDeviceClaim,
} from "../logic/deviceClaim.js";
import { pruneSettledTransactions, pendingCountFrom, MAX_PENDING_PER_SENDER } from "../util/pruneTransactions.js";
import {
  clampHistoryPageLimit,
  fetchTransactionHistoryPage,
  visibleTransactionsForViewer,
} from "../util/transactionHistory.js";
import { isValidHumanPerspectiveTarget } from "./adminPerspective.js";
import {
  commitAdminProjectAdjust,
  previewAdminProjectAdjust,
  undoAdminProjectAdjust,
  notifyMessageForAdjust,
  type ProjectAdjustAction,
} from "../logic/adminProjectAdjust.js";
import { resolvePendingTransfer } from "../logic/transferResolve.js";
import { sanitizeTransactionNote, normalizeNoteInput, truncateNotePreview } from "../logic/forbiddenText.js";
import {
  addChatGroupMembers,
  createCustomChatGroup,
  leaveChatGroup,
  sendGroupChatMessage,
  syncChatGroupsOnRosterChange,
} from "../logic/chatGroups.js";
import { GROUP_CHAT_DISABLED_MESSAGE, GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { allow } from "../util/rateLimit.js";
import { canCreateRoom } from "../logic/roomCreatePolicy.js";
import {
  appendSessionEvent,
  ensureSessionStarted,
  recordPhaseChange,
} from "../state/sessionTelemetry.js";

function presencePayload(game: GameState, action: string, playerId: string) {
  return {
    action,
    playerId,
    phase: game.phase,
    globalRound: game.globalRound,
    currentEra: game.currentEra,
    roundInEra: game.roundInEra,
  };
}
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
    if (game.phase === "ROOM_WAITING") {
      // 等待房换昵称/换房间：移除旧座位，避免留下幽灵
      const idx = game.players.findIndex((p) => p.id === player.id);
      if (idx >= 0) game.players.splice(idx, 1);
      game.readyPlayers.delete(player.id);
    } else {
      player.connected = false;
      player.ready = false;
      game.readyPlayers.delete(player.id);
      player.socketId = undefined;
    }
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

function clearPendingDeviceClaimOnSocket(
  io: Server,
  socket: Socket,
  game: GameState | undefined
): boolean {
  const pending = socket.data.pendingDeviceClaim as
    | { roomId: string; playerId: string }
    | undefined;
  delete socket.data.pendingDeviceClaim;
  if (!pending) return false;
  const g = game ?? rooms[pending.roomId];
  if (!g) return false;
  return removeDeviceClaimBySocket(g, socket.id);
}

function emitPlayerJoinSideEffects(socket: Socket, game: GameState, player: Player) {
  socket.emit("playerJoined", { playerId: player.id, reconnectToken: player.reconnectToken });
  const pendingLottery = findPendingLotteryOffer(game, player.id);
  if (pendingLottery) {
    socket.emit("lotterySettleRequest", {
      offerId: pendingLottery.offerId,
      amount: pendingLottery.amount,
    });
  }
}

function bindPlayerSocket(
  io: Server,
  game: GameState,
  player: Player,
  socket: Socket,
  options?: { rejoining?: boolean }
) {
  const rejoining = options?.rejoining ?? !player.connected;
  if (!player.reconnectToken) player.reconnectToken = issueReconnectToken();
  player.socketId = socket.id;
  player.connected = true;
  if (game.phase === "ROOM_WAITING") {
    player.ready = false;
    game.readyPlayers.delete(player.id);
  }
  if (rejoining) syncEnergyAfterRosterChange(game, player);
}

function detachKickedPlayerSocket(io: Server, roomId: string, socketId: string | undefined) {
  if (!socketId) return;
  const kickedSocket = io.sockets.sockets.get(socketId);
  if (!kickedSocket) return;
  kickedSocket.leave(roomId);
  delete kickedSocket.data.gameRoomId;
  kickedSocket.emit("playerKicked", { message: "你已被主持人移出房间" });
}

function markClientBuildFromHandshake(socket: Socket): void {
  if (isClientBuildStale(socket.handshake.auth?.clientBuildId)) {
    socket.data.clientBuildStale = true;
    socket.emit("clientUpdateRequired", { message: CLIENT_UPDATE_MESSAGE });
  }
}

function rejectStaleClient(socket: Socket): boolean {
  if (!socket.data.clientBuildStale) return false;
  socket.emit("error", CLIENT_UPDATE_MESSAGE);
  return true;
}

export function registerSocketHandlers(io: Server, socket: Socket) {
  console.log(`🔌 Socket connected: ${socket.id}`);
  markClientBuildFromHandshake(socket);

  // 发送自定义图片版本号
  socket.emit("syncProjectImages", customImagesVersions);
  socket.emit("syncEraImages", customEraImagesVersions);
  socket.emit("syncBuffImages", customBuffImagesVersions);
  socket.emit("syncPersonaImages", customPersonaImagesVersions);


  // 1. 加入房间
  socket.on("joinGame", ({ roomId, name, reconnectToken }: { roomId: string, name: string, reconnectToken?: string }) => {
    if (rejectStaleClient(socket)) return;
    if (!allow(`join:${socket.id}`, 10, 60_000)) {
      socket.emit("error", "加入过于频繁，请稍后再试");
      return;
    }
    roomId = String(roomId).trim().slice(0, MAX_ROOM_ID_LENGTH);
    const playerName = String(name).trim().slice(0, MAX_PLAYER_NAME_LENGTH);
    if (!roomId || !playerName) return;
    // AI 昵称前缀由服务端保留，避免真人被误判为 AI 或被脚本冒名
    if (playerName.startsWith("🤖") || /^AI[_-]/i.test(playerName) || /^AI\d+$/i.test(playerName)) {
      socket.emit("error", "该昵称使用 AI 保留前缀，请更换昵称");
      return;
    }
    // 系统安全提示是服务端身份，禁止真人冒名
    if (playerName === SAFETY_NOTICE_FROM_NAME) {
      socket.emit("error", "该昵称由系统保留，请更换昵称");
      return;
    }

    const existingGame = rooms[roomId];
    // 同一 socket 可能刚从别的房间退出；先解绑旧座位，避免再次入房时产生重复 id
    // （旧实现用 socket.id 当玩家 id，同名重进会制造两个 id 相同的玩家并卡死阶段）。
    if (socket.data.gameRoomId) {
      detachClaimedPlayer(socket);
    }
    let player = existingGame?.players.find(p => p.name === playerName);

    if (!player && existingGame && existingGame.players.length >= 6) {
      socket.emit("error", "房间已满 (Max 6)");
      return;
    }
    // 开局后不再接受新座位：中途加入会打乱精力桌、排名奖档位与社区财富。
    // 已有座位的重连不受影响。
    if (
      !player &&
      existingGame &&
      existingGame.phase !== "ROOM_WAITING" &&
      existingGame.phase !== "TUTORIAL"
    ) {
      socket.emit("error", "本局已开始，不再接受新玩家；请等待下一局");
      return;
    }
    if (
      !player &&
      existingGame &&
      (existingGame.phase === "GAME_OVER" || existingGame.phase === "COMMUNITY_NAMING")
    ) {
      socket.emit("error", "本局已进入收尾阶段，不再接受新玩家");
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
          if (!existingGame) {
            socket.emit("error", "房间不存在或已解散");
            return;
          }
          const replaced = upsertDeviceClaim(existingGame, player.id, socket.id);
          if (replaced && replaced.socketId !== socket.id) {
            const superseded = io.sockets.sockets.get(replaced.socketId);
            if (superseded) {
              clearPendingDeviceClaimOnSocket(io, superseded, existingGame);
              superseded.emit("deviceClaimSuperseded", {
                message: "已有更新的认领请求，请重新加入",
              });
            }
          }
          socket.data.pendingDeviceClaim = { roomId, playerId: player.id };
          socket.emit("deviceClaimPending", {
            roomId,
            playerId: player.id,
            playerName: player.name,
          });
          appendSessionEvent(
            existingGame,
            "presence",
            presencePayload(existingGame, "device_claim_pending", player.id),
            player.id
          );
          broadcastUpdate(io, existingGame);
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
      bindPlayerSocket(io, game, player, socket, { rejoining });
      appendSessionEvent(
        game,
        "presence",
        presencePayload(game, rejoining ? "rejoin" : "reconnect", player.id),
        player.id
      );
    } else {
      const newPlayer: Player = {
        id: randomUUID(),
        name: playerName,
        socketId: socket.id,
        reconnectToken: issueReconnectToken(),
        connected: true,
        ready: false,
        energy: 15, 
        wealth: STARTING_WEALTH,
        rank: 0,
        investment: {},
        longTerm: {},
        riskGains: {},
        inventory: [],
        usedCards: [],
        activeBuffs: [],
        slackedBy: [], // ✅ 初始化新增字段
        coffeePurchasesThisRound: 0,
        totalEnergyConsumed: 0,
        wealthHistory: [STARTING_WEALTH],
        investedRiskEnergy: 0,
        investedLongEnergy: 0,
        investedShortEnergy: 0,
        socialRank: null
      };
      game.players.push(newPlayer);
      syncEnergyAfterRosterChange(game, newPlayer);
      player = newPlayer;
      game.logs.push(`👤 玩家 ${player.name} 加入游戏`);
      appendSessionEvent(
        game,
        "presence",
        presencePayload(game, "join", player.id),
        player.id
      );
    }

    syncChatGroupsOnRosterChange(game);
    emitPlayerJoinSideEffects(socket, game, player);
    armAutoHostStart(game);
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
      if (game.phase === "ROOM_WAITING") {
        // 等待房里主动退出 = 直接释放座位，避免留下白拿 100 财富的幽灵座位
        const idx = game.players.findIndex((p) => p.id === player.id);
        if (idx >= 0) game.players.splice(idx, 1);
        game.readyPlayers.delete(player.id);
      } else {
        player.connected = false;
        player.ready = false;
        player.socketId = undefined;
        player.reconnectToken = undefined;
        game.readyPlayers.delete(player.id);
      }
      syncEnergyAfterRosterChange(game);
      appendSessionEvent(
        game,
        "presence",
        presencePayload(game, "leave", player.id),
        player.id
      );
      syncChatGroupsOnRosterChange(game);
      // 最后一名未准备玩家退出后，阶段可能已经可以推进
      tryAdvancePhase(game);
    }
    leaveAllGameRooms(socket);
    armAutoHostStart(game);
    broadcastUpdate(io, game);
    broadcastRoomList(io);
  });

  /** 已入房但未收到状态时拉取全量（与 joinGame 后 gameUpdate 一致） */
  socket.on("requestGameState", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    emitSerializedGameUpdate(socket, game);
  });

  // === Admin ===
  socket.on("adminAuthenticate", ({ token }: { token?: string }) => {
    console.log("[admin] authenticate request socket=%s", socket.id);
    if (rejectStaleClient(socket)) return;
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
    socket.emit("adminFeatures", {
      aiPlayers: AI_BOT_ENABLED,
      // 产品版开局固定补满 6 席；保留字段兼容旧管理端
      aiAutofill: AI_BOT_ENABLED,
      groupChat: GROUP_CHAT_ENABLED,
    });
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
    emitSerializedGameUpdate(socket, game);
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

  socket.on("adminStartGame", async ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;

    if (
      game.phase === "ROOM_WAITING" ||
      game.phase === "ERA_INTRO" ||
      game.phase === "TUTORIAL"
    ) {
      // 等待房先补满 6 席，再检测模型；否则预检会漏掉刚补入的 AI
      if (game.phase === "ROOM_WAITING") {
        const filled = ensureAiSeatsFilled(game);
        if (!filled.ok) {
          socket.emit("error", filled.message);
          broadcastUpdate(io, game);
          return;
        }
        if (filled.added > 0) broadcastUpdate(io, game);
      }
      if (AI_CONFIG.strictAgent) {
        const preflight = await verifyAiAgents(game);
        applyAiPreflightToGame(game, preflight);
        broadcastUpdate(io, game);
        socket.emit("adminAiPreflight", preflight);
        if (!preflight.ok) {
          socket.emit(
            "error",
            `严格 Agent 模式：${preflight.failures
              .map((f) => `${f.name}（${f.message}）`)
              .join("；")}`
          );
          return;
        }
      }
      // await 预检期间阶段可能已被自动主持推进，必须重新校验，避免把 ERA_INTRO 当成开局
      if (
        !rooms[roomId] ||
        (game.phase !== "ROOM_WAITING" &&
          game.phase !== "ERA_INTRO" &&
          game.phase !== "TUTORIAL")
      ) {
        return;
      }
      const result = startGameNow(io, game, "admin");
      if (!result.ok) {
        socket.emit("error", result.message);
      }
    } else {
      socket.emit("error", "当前阶段不能开局；本局已结束时请先重置房间");
    }
  });

  socket.on("adminSetAutoHost", ({ roomId, enabled } = {} as {
    roomId?: string;
    enabled?: boolean;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[String(roomId ?? "")];
    if (!game) return;
    game.autoHostEnabled = enabled === true;
    resetAutoHostState(game.roomId);
    if (!game.autoHostEnabled) {
      game.autoStartAt = undefined;
      game.autoHostNextActionAt = undefined;
    } else {
      armAutoHostStart(game);
    }
    game.logs.push(
      game.autoHostEnabled ? "🤖 系统自动主持已开启" : "🖐 系统自动主持已关闭（主持手动控场）"
    );
    broadcastUpdate(io, game);
  });

  socket.on("adminKickPlayer", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const playerIndex = game.players.findIndex(p => p.id === targetPlayerId);
    if (playerIndex !== -1) {
      const [removed] = game.players.splice(playerIndex, 1);
      appendSessionEvent(
        game,
        "presence",
        presencePayload(game, "kick", removed.id),
        removed.id
      );
      detachKickedPlayerSocket(io, roomId, removed.socketId);
      if (removed.isAI) {
        clearAiFailure(game, removed.id, io);
        forgetAiPlayer(game.roomId, removed.id);
      }
      syncEnergyAfterRosterChange(game);
      syncChatGroupsOnRosterChange(game);
      tryAdvancePhase(game);
      broadcastUpdate(io, game);
      broadcastRoomList(io);
      void handleAIPhase(game, io);
    }
  });

  socket.on("cancelDeviceClaim", () => {
    const pending = socket.data.pendingDeviceClaim as { roomId: string } | undefined;
    if (!pending) return;
    const game = rooms[pending.roomId];
    if (game && removeDeviceClaimBySocket(game, socket.id)) {
      broadcastUpdate(io, game);
    }
    delete socket.data.pendingDeviceClaim;
    socket.emit("deviceClaimCancelled");
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
    const claim = findDeviceClaimByPlayer(game, targetPlayerId);
    if (!claim) {
      socket.emit("error", "没有待认领的新设备");
      return;
    }
    const waitSocket = io.sockets.sockets.get(claim.socketId);
    if (!waitSocket) {
      removeDeviceClaimByPlayer(game, targetPlayerId);
      broadcastUpdate(io, game);
      socket.emit("error", "待认领连接已断开，请让玩家重新加入");
      return;
    }

    if (player.socketId && player.socketId !== claim.socketId) {
      const oldSocket = io.sockets.sockets.get(player.socketId);
      if (oldSocket) {
        oldSocket.leave(roomId);
        delete oldSocket.data.gameRoomId;
        oldSocket.emit("sessionReplaced", { message: "你的身份已在其他设备登录" });
      }
    }

    const rejoining = !player.connected;
    leaveAllGameRooms(waitSocket);
    waitSocket.join(roomId);
    waitSocket.data.gameRoomId = roomId;
    delete waitSocket.data.pendingDeviceClaim;
    player.reconnectToken = issueReconnectToken();
    bindPlayerSocket(io, game, player, waitSocket, { rejoining });
    takeDeviceClaimForPlayer(game, targetPlayerId, claim.socketId);

    appendSessionEvent(
      game,
      "presence",
      presencePayload(game, "rejoin", player.id),
      player.id
    );
    game.logs.push(`🔑 主持已允许 ${player.name} 用新设备进入`);
    emitPlayerJoinSideEffects(waitSocket, game, player);
    broadcastUpdate(io, game);
    broadcastRoomList(io);
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

  function parseProjectAdjustAction(body: {
    kind?: string;
    projectId?: unknown;
    playerId?: string;
    delta?: unknown;
  }): ProjectAdjustAction | null {
    const projectId = Number(body.projectId);
    if (!Number.isFinite(projectId)) return null;
    if (body.kind === "withdraw") return { kind: "withdraw", projectId };
    if (body.kind === "stake") {
      const delta = Number(body.delta);
      const playerId = typeof body.playerId === "string" ? body.playerId.trim() : "";
      if (!playerId || !Number.isSafeInteger(delta) || delta === 0) return null;
      return { kind: "stake", projectId, playerId, delta };
    }
    return null;
  }

  socket.on("adminPreviewProjectAdjust", (body) => {
    if (!socket.data.isSuperAdmin) return;
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const action = parseProjectAdjustAction(body ?? {});
    if (!action) {
      socket.emit("error", "无效的调整参数");
      return;
    }
    const preview = previewAdminProjectAdjust(game, action);
    socket.emit("adminProjectAdjustPreview", {
      roomId,
      hostRevision: game.hostRevision ?? 0,
      ...preview,
    });
  });

  socket.on("adminCommitProjectAdjust", (body) => {
    if (!socket.data.isSuperAdmin) return;
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const action = parseProjectAdjustAction(body ?? {});
    const expectedRevision = Number(body?.expectedRevision);
    if (!action || !Number.isFinite(expectedRevision)) {
      socket.emit("error", "无效的调整参数");
      return;
    }
    const result = commitAdminProjectAdjust(game, action, expectedRevision);
    if (!result.ok) {
      socket.emit("error", result.message ?? "提交失败");
      return;
    }
    const entry = game.adminProjectAdjustments?.[game.adminProjectAdjustments.length - 1];
    if (entry && result.preview) {
      const msg = notifyMessageForAdjust(game, entry, result.preview);
      if (entry.kind === "stake" && msg) {
        const target = game.players.find((p) => p.id === entry.playerId);
        if (target?.socketId) {
          io.to(target.socketId).emit("playerNotify", { message: msg });
        }
      } else if (entry.kind === "withdraw" && result.preview.refundsEnergy) {
        for (const [pid, refund] of Object.entries(result.preview.refundsEnergy)) {
          if (refund <= 0) continue;
          const target = game.players.find((p) => p.id === pid);
          const proj = result.preview.projectName ?? String(entry.projectId);
          if (target?.socketId) {
            io.to(target.socketId).emit("playerNotify", {
              message: `主持已将「${proj}」撤场，本轮 ${refund} 精力已退回`,
            });
          }
        }
      }
    }
    broadcastUpdate(io, game);
  });

  socket.on("adminUndoProjectAdjust", (body) => {
    if (!socket.data.isSuperAdmin) return;
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const expectedRevision = Number(body?.expectedRevision);
    if (!Number.isFinite(expectedRevision)) {
      socket.emit("error", "无效参数");
      return;
    }
    const result = undoAdminProjectAdjust(game, expectedRevision);
    if (!result.ok) {
      socket.emit("error", result.message ?? "撤销失败");
      return;
    }
    broadcastUpdate(io, game);
  });

  socket.on("adminInvestmentTimer", ({ roomId, action }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    if (game.phase !== "INVESTMENT") {
      socket.emit("error", "仅投资阶段可控制倒计时");
      return;
    }
    if (action === "pause") {
      const result = pauseInvestmentDeadline(game);
      if (!result.ok) {
        socket.emit("error", result.message);
        return;
      }
      game.logs.push("⏸ 主持人暂停了投资倒计时");
      appendSessionEvent(game, "investment_timer", {
        action: "pause",
        remainingMs: getInvestmentRemainingMs(game),
        globalRound: game.globalRound,
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
      });
    } else if (action === "resume") {
      const result = resumeInvestmentDeadline(game);
      if (!result.ok) {
        socket.emit("error", result.message);
        return;
      }
      game.logs.push("▶️ 主持人继续了投资倒计时");
      appendSessionEvent(game, "investment_timer", {
        action: "resume",
        remainingMs: getInvestmentRemainingMs(game),
        globalRound: game.globalRound,
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
      });
    } else if (action === "reset") {
      startInvestmentDeadline(game);
      game.logs.push(
        `🔄 主持人重置了投资倒计时（${formatActionDeadlineClock(game)}）`
      );
      appendSessionEvent(game, "investment_timer", {
        action: "reset",
        remainingMs: getInvestmentRemainingMs(game),
        globalRound: game.globalRound,
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
      });
    } else {
      socket.emit("error", "无效的倒计时操作");
      return;
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
        forgetAiRoom(roomId);
        resetAutoHostState(roomId);
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
        // 结算只能在投资阶段收口，避免跳过/重复派发财富
        if (nextPhase === "SETTLEMENT") {
          if (game.phase !== "INVESTMENT") {
            socket.emit("error", "只能从投资阶段进入结算；需要重算请使用「强制结算」");
            return;
          }
          clearActionDeadline(game);
          forceSubmitPendingInvestments(game, "admin_force");
          tryAdvancePhase(game);
          resetAutoHostState(game.roomId);
          game.autoHostNextActionAt = undefined;
          broadcastUpdate(io, game);
          void handleAIPhase(game, io);
          return;
        }
        // 不允许从结算/拍卖退回投资，否则会带着旧 baseline 重复结算
        if (
          nextPhase === "INVESTMENT" &&
          game.phase !== "ERA_INTRO" &&
          game.phase !== "TUTORIAL" &&
          game.phase !== "ROOM_WAITING" &&
          game.phase !== "INVESTMENT"
        ) {
          socket.emit("error", "不能从当前阶段退回投资；请先重置本局");
          return;
        }
        // 已结束/已命名的局必须先开新局，否则会带着旧 communityName 回到命名阶段永久卡死
        if (game.phase === "GAME_OVER" || (game.phase === "COMMUNITY_NAMING" && game.communityName)) {
          resetGameSession(game);
          resetAllReady(game);
          game.logs.push("⏭️ 已结束的本局已重置，准备进入新阶段");
        }
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
          if (nextPhase === "INVESTMENT" || nextPhase === "BUFF_USAGE") {
            // 道具已并入投资阶段；旧「道具使用」跳转一并落到 INVESTMENT
            game.phase = "INVESTMENT";
            ensureProjectsDrawnForEra(game);
            clearActionDeadline(game);
            startInvestmentDeadline(game);
            resetAllReady(game);
            game.logs.push(
              nextPhase === "BUFF_USAGE"
                ? "⏭️ 上帝强制跳转至 [INVESTMENT]（道具已并入投资）"
                : "⏭️ 上帝强制跳转至 [INVESTMENT]"
            );
          } else {
            game.phase = nextPhase;
            if (nextPhase === "AUCTION") beginAuctionSession(game);
            if (nextPhase === "ERA_INTRO" && game.energyTableSize == null) {
              applyRoundEnergy(game, { relock: true });
            }
            game.logs.push(`⏭️ 上帝强制跳转至 [${nextPhase}]`);
          }
        }
        resetAutoHostState(game.roomId);
        game.autoHostNextActionAt = undefined;
        recordPhaseChange(game, prevPhase, game.phase, "adminSkipPhase");
        broadcastUpdate(io, game);
        void handleAIPhase(game, io);
        return;
    }

    if (game.phase === "GAME_OVER") {
      socket.emit("error", "本局已结束，请先开始新一局");
      return;
    }
    if (game.phase === "AUCTION") {
      if (!endAuctionSession(game)) {
        socket.emit("error", "当前没有可结束的拍卖");
        return;
      }
      resetAutoHostState(game.roomId);
      game.autoHostNextActionAt = undefined;
      broadcastUpdate(io, game);
      return;
    }
    if (game.phase === "COMMUNITY_NAMING") {
      const fallback = sanitizeCommunityName(`社区-${game.roomId}`) || "未命名社区";
      void finalizeCommunityName(io, game, fallback, "adminSkipPhase");
      return;
    }

    if (game.phase === "BUFF_USAGE") {
      clearActionDeadline(game);
    }
    if (game.phase === "INVESTMENT") {
      clearActionDeadline(game);
      forceSubmitPendingInvestments(game, "admin_force");
    } else {
      game.players.forEach((p) => {
        p.ready = true;
        game.readyPlayers.add(p.id);
      });
    }
    tryAdvancePhase(game);
    resetAutoHostState(game.roomId);
    game.autoHostNextActionAt = undefined;
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
  });

  socket.on("adminForceSettle", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (game && game.phase === "INVESTMENT") {
       clearActionDeadline(game);
       forceSubmitPendingInvestments(game, "admin_force");
       tryAdvancePhase(game);
       resetAutoHostState(game.roomId);
       game.autoHostNextActionAt = undefined;
       broadcastUpdate(io, game);
       void handleAIPhase(game, io);
    }
  });

  // 拍卖：改正在拍的卡 / 确认成交 / 跳过 / 玩家出价
  socket.on("adminSetAuctionFocus", ({ roomId, cardId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game || game.phase !== "AUCTION") {
      socket.emit("error", "现在不能改正在拍的卡");
      return;
    }
    const prev = game.auctionFocusCardId;
    const result = setAuctionFocusCard(game, cardId == null || cardId === "" ? null : cardId);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    if (game.auctionFocusCardId) {
      game.logs.push(`📌 改成正在拍：[${game.auctionFocusCardId}]`);
    } else {
      game.logs.push(`📌 已取消正在拍的卡`);
    }
    appendSessionEvent(game, "auction_lot_changed", {
      fromCardId: prev ?? null,
      toCardId: game.auctionFocusCardId ?? null,
    });
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
  });

  socket.on("adminHammerAuction", ({ roomId, expectedBidId, expectedAmount, expectedPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) {
      socket.emit("error", "房间不存在");
      return;
    }
    const result = hammerAuctionLot(game, {
      expectedBidId: typeof expectedBidId === "string" ? expectedBidId : undefined,
      expectedAmount: typeof expectedAmount === "number" ? expectedAmount : undefined,
      expectedPlayerId: typeof expectedPlayerId === "string" ? expectedPlayerId : undefined,
    });
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    appendSessionEvent(game, "auction_lot_sold", {
      cardId: result.cardId,
      playerId: result.playerId,
      cost: result.cost,
      nextFocusId: game.auctionFocusCardId ?? null,
    });
    broadcastUpdate(io, game);
    io.to(game.roomId).emit("playerNotify", {
      type: "auction_sold",
      message: formatAuctionSoldMessage(game, {
        cardId: result.cardId,
        playerId: result.playerId,
        cost: result.cost,
        source: "hammer",
      }),
    });
    void handleAIPhase(game, io);
  });

  socket.on("adminPassAuction", ({ roomId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) {
      socket.emit("error", "房间不存在");
      return;
    }
    const result = passAuctionLot(game);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    appendSessionEvent(game, "auction_lot_passed", {
      cardId: result.cardId,
      nextFocusId: result.nextFocusId ?? null,
    });
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
  });

  socket.on("adminProposeBuff", () => {
    socket.emit("error", "已改为玩家出价、主持确认成交，请使用「确认成交」");
  });

  socket.on("playerRespondAuction", () => {
    socket.emit("error", "已改为公开加价，无需再确认支付弹窗");
  });

  socket.on("playerPlaceAuctionBid", (payload?: { amount?: unknown }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) {
      socket.emit("error", "不在房间内，无法出价（请刷新后重新进入）");
      return;
    }
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) {
      socket.emit("error", "身份未绑定，无法出价（请刷新后重新进入）");
      return;
    }
    if (!allow(`auctionBid:${player.id}`, 30, 60_000)) {
      socket.emit("error", "出价过于频繁，请稍后再试");
      return;
    }
    const amount = payload?.amount;
    const result = placeAuctionBid(game, player.id, amount);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    appendSessionEvent(
      game,
      "auction_bid_placed",
      {
        bidId: result.bid.bidId,
        cardId: result.bid.cardId,
        amount: result.bid.amount,
        availableWealthAtBid: result.bid.availableWealthAtBid,
        bidToAvailableRatio: result.bid.bidToAvailableRatio,
      },
      player.id
    );
    if (result.outbidPlayerId) {
      const target = game.players.find((p) => p.id === result.outbidPlayerId);
      if (target?.socketId) {
        io.to(target.socketId).emit("playerNotify", {
          type: "auction",
          message: `有人出得比你高：现在最高价 ${result.bid.amount}`,
        });
      }
    }
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
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
          // 保留 auctionBids / auctionCompletedDeals 供导出；仅作废未落槌出价
          if (!endAuctionSession(game)) return;
          recordPhaseChange(game, prevPhase, game.phase, "adminEndAuction");
          io.to(game.roomId).emit("auctionOffersCleared");
          broadcastUpdate(io, game);
          void handleAIPhase(game, io);
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
          player.socialRankSource = "admin";
          player.socialRankReason = "管理员手动评定";
          game.logs.push(`📝 上帝给 ${player.name} 社交评分: ${rank}`);
          appendSessionEvent(game, "social_rated", {
            targetPlayerId,
            rank,
            ratedAt,
          });
          broadcastUpdate(io, game);
      }
  });

  // 上帝手动开奖（修正用；正常流程由线上随机自动开奖）
  socket.on("adminSettleLottery", ({ roomId, targetPlayerId, amount }) => {
      if (!socket.data.isSuperAdmin) return;
      const game = rooms[roomId];
      if (!game) return;
      if (game.phase !== "INVESTMENT" && game.phase !== "BUFF_USAGE") {
        socket.emit("error", "彩票只能在投资阶段开奖");
        return;
      }

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
          roll: offer.roll ?? null,
          source: offer.source ?? "manual",
          drawnAt: offer.drawnAt ?? null,
        });
      }
      game.logs.push(`🎲 上帝向 ${player.name} 发起彩票开奖确认：${offer.amount} 财富`);
      appendSessionEvent(game, "lottery_offered", {
        targetPlayerId,
        amount: offer.amount,
        offerId: offer.offerId,
        source: offer.source ?? "manual",
      });
      broadcastUpdate(io, game);
  });

  // 线上随机开奖：掷骰 → 玩家确认领取
  socket.on("adminDrawLottery", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    if (game.phase !== "INVESTMENT" && game.phase !== "BUFF_USAGE") {
      socket.emit("error", "彩票只能在投资阶段开奖");
      return;
    }
    void createRandomLotteryOffer(game, targetPlayerId)
      .then((result) => {
        if (!result.ok) {
          socket.emit("error", result.message);
          return;
        }
        const { offer, replaced, player, draw } = result;
        if (replaced && player.socketId) {
          io.to(player.socketId).emit("lotteryOfferCancelled", { offerId: replaced.offerId });
        }
        if (player.socketId) {
          io.to(player.socketId).emit("lotterySettleRequest", {
            offerId: offer.offerId,
            amount: offer.amount,
            roll: offer.roll ?? null,
            source: offer.source ?? draw.source,
            drawnAt: offer.drawnAt ?? draw.drawnAt,
          });
        }
        game.logs.push(
          `🎲 线上随机开奖：${player.name} 掷出 ${draw.roll} 点，奖金 ${offer.amount} 财富`
        );
        appendSessionEvent(game, "lottery_drawn", {
          targetPlayerId,
          amount: offer.amount,
          roll: offer.roll ?? null,
          source: offer.source ?? draw.source,
          actor: "admin",
        });
        broadcastUpdate(io, game);
        tryAdvancePhase(game);
      })
      .catch((error) => {
        console.error("[lottery] random draw failed:", error);
        socket.emit("error", "线上随机开奖失败，请稍后重试");
        tryAdvancePhase(game);
      });
  });

  socket.on("playerRespondLottery", (data) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId]) return;
      const game = rooms[roomId];
      const player = game.players.find(p => p.socketId === socket.id);
      if (!player) return;

      const accept = data?.accept === true;
      if (!accept) {
          // 线上随机结果不可拒绝，否则等于免费重摇；需要作废只能由主持撤回
          socket.emit("error", "线上随机开奖结果不可拒绝；如需作废请联系主持");
          return;
      }
      if (accept) {
          const settled = acceptLotteryOffer(game, player.id, data?.offerId);
          if (!settled.ok) {
              socket.emit("error", settled.message);
              return;
          }
          game.logs.push(
            `🎲 彩票开奖！${settled.player.name} 确认领取 ${settled.creditedAmount} 财富${
              settled.roll ? `（骰子 ${settled.roll}）` : ""
            }`
          );
          appendSessionEvent(
            game,
            "lottery_settled",
            {
              targetPlayerId: settled.player.id,
              enteredAmount: settled.enteredAmount,
              creditedAmount: settled.creditedAmount,
              goldApplied: settled.goldApplied,
              roll: settled.roll ?? null,
              source: settled.source ?? "server",
              accepted: true,
            },
            settled.player.id
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

  socket.on("adminAdjustWealth", ({ roomId, targetPlayerId, delta }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const proposed = proposeWealthAdjust(game, targetPlayerId, delta);
    if (!proposed.ok) {
      socket.emit("error", proposed.message);
      return;
    }
    const { offer, replaced, player } = proposed;
    if (replaced && player.socketId) {
      io.to(player.socketId).emit("wealthAdjustCancelled", { offerId: replaced.offerId });
    }
    const signed = offer.delta > 0 ? `+${offer.delta}` : String(offer.delta);
    game.logs.push(`💰 上帝向 ${player.name} 发起财富调整确认：${signed}`);
    appendSessionEvent(game, "admin_wealth_offered", {
      targetPlayerId: player.id,
      delta: offer.delta,
      offerId: offer.offerId,
    });
    broadcastUpdate(io, game);
  });

  socket.on("playerRespondWealthAdjust", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const accept = data?.accept === true;
    const claimed = claimWealthAdjustResponse(game, player.id, data?.offerId, accept);
    if (!claimed.ok) {
      socket.emit("error", claimed.message);
      return;
    }
    const signed = claimed.delta > 0 ? `+${claimed.delta}` : String(claimed.delta);
    if (accept) {
      game.logs.push(
        `💰 ${player.name} 确认财富调整 ${signed}（当前 ${claimed.wealthAfter}）`
      );
      appendSessionEvent(
        game,
        "admin_wealth_adjust",
        {
          playerId: player.id,
          delta: claimed.delta,
          wealthAfter: claimed.wealthAfter,
          accepted: true,
        },
        player.id
      );
    } else {
      game.logs.push(`🚫 ${player.name} 拒绝了财富调整 ${signed}`);
      appendSessionEvent(
        game,
        "admin_wealth_offer_cancelled",
        { playerId: player.id, delta: claimed.delta, declined: true },
        player.id
      );
    }
    broadcastUpdate(io, game);
  });

  socket.on("adminRevokeWealthAdjust", ({ roomId, targetPlayerId }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const result = revokeWealthAdjustOffer(game, targetPlayerId);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    const target = game.players.find((p) => p.id === result.playerId);
    if (target?.socketId) {
      io.to(target.socketId).emit("wealthAdjustCancelled", { offerId: result.offerId });
    }
    game.logs.push(
      `↩️ 上帝撤回了 ${target?.name ?? result.playerId} 的财富调整待确认`
    );
    appendSessionEvent(game, "admin_wealth_offer_cancelled", {
      playerId: result.playerId,
      offerId: result.offerId,
      delta: result.delta,
    });
    broadcastUpdate(io, game);
  });

  socket.on("adminAdjustPlayerCard", ({ roomId, targetPlayerId, cardId, action, inventoryIndex }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId];
    if (!game) return;
    const result = adminAdjustPlayerCard(
      game,
      targetPlayerId,
      cardId,
      action,
      inventoryIndex
    );
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    const { player, cardName, action: act, cardId: resolvedCardId } = result;
    if (act === "add") {
      game.logs.push(
        `🎴 上帝补发「${cardName}」给 ${player.name}（未经过拍卖，不扣财富）`
      );
    } else {
      game.logs.push(
        `🎴 上帝从 ${player.name} 手牌收回「${cardName}」（拍卖记录不变）`
      );
    }
    appendSessionEvent(game, "admin_card_adjust", {
      targetPlayerId: player.id,
      cardId: resolvedCardId,
      action: act,
    });
    broadcastUpdate(io, game);
  });

  // === AI 玩家（产品级） ===
  // 主持可添加/移除 AI、补满座位、查看当前 AI 列表。
  // AI 由服务端托管；严格模式下未配置/未连通模型会拒绝添加与开局，不会偷偷用本地策略。
  socket.on("adminAddAI", ({ roomId, persona, difficulty, name } = {} as {
    roomId?: string;
    persona?: string;
    difficulty?: string;
    name?: string;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    if (!AI_BOT_ENABLED) {
      socket.emit("error", "AI 玩家功能已关闭");
      return;
    }
    const game = rooms[roomId ?? ""];
    if (!game) {
      socket.emit("error", "房间不存在");
      return;
    }
    const result = addAiPlayer(game, { persona, difficulty, name });
    if (!result.ok) {
      socket.emit("error", result.error);
      return;
    }
    broadcastUpdate(io, game);
    if (AI_CONFIG.strictAgent) {
      void verifyAiAgents(game, { force: true }).then((preflight) => {
        applyAiPreflightToGame(game, preflight);
        broadcastUpdate(io, game);
        socket.emit("adminAiPreflight", preflight);
      });
    }
    void handleAIPhase(game, io);
  });

  socket.on("adminRemoveAI", ({ roomId, targetPlayerId } = {} as {
    roomId?: string;
    targetPlayerId?: string;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    const targetId = String(targetPlayerId ?? "");
    clearAiFailure(game, targetId, io);
    if (!removeAiPlayer(game, targetId)) {
      socket.emit("error", "找不到该 AI 玩家");
      return;
    }
    forgetAiPlayer(game.roomId, targetId);
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
  });

  socket.on("adminFillAI", ({ roomId, target, persona, difficulty } = {} as {
    roomId?: string;
    target?: number;
    persona?: string;
    difficulty?: string;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    if (!AI_BOT_ENABLED) {
      socket.emit("error", "AI 玩家功能已关闭");
      return;
    }
    const game = rooms[roomId ?? ""];
    if (!game) {
      socket.emit("error", "房间不存在");
      return;
    }
    const added = fillAiPlayers(game, Number(target) || 6, {
      persona,
      difficulty,
    });
    if (added === 0) {
      socket.emit(
        "error",
        AI_CONFIG.strictAgent
          ? "补位失败：没有空位 / AI 已达上限，或严格 Agent 模式下该座位未配置模型（先填 AI_PLAYER_n_API_KEY 并运行 npm run check-ai）"
          : "没有空位或 AI 已达上限"
      );
      return;
    }
    game.logs.push(`🤖 自动补入 ${added} 名 AI 玩家`);
    broadcastUpdate(io, game);
    if (AI_CONFIG.strictAgent) {
      void verifyAiAgents(game, { force: true }).then((preflight) => {
        applyAiPreflightToGame(game, preflight);
        broadcastUpdate(io, game);
        socket.emit("adminAiPreflight", preflight);
      });
    }
    void handleAIPhase(game, io);
  });

  socket.on("adminGetAiRoster", ({ roomId } = {} as { roomId?: string }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    socket.emit("adminAiRoster", aiRosterSummary(game));
  });

  // 严格 Agent 模式：开局前 / 修复配置后检测模型连通性
  socket.on("adminAiPreflight", async ({ roomId } = {} as { roomId?: string }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) {
      socket.emit("error", "房间不存在");
      return;
    }
    const result = await verifyAiAgents(game, { force: true });
    applyAiPreflightToGame(game, result);
    broadcastUpdate(io, game);
    socket.emit("adminAiPreflight", result);
    io.to(game.roomId).emit(
      "playerNotify",
      result.ok
        ? { type: "ai_preflight", message: "AI 模型连接检测通过" }
        : {
            type: "ai_preflight",
            message: `AI 模型连接异常：${result.failures
              .map((f) => f.name)
              .join("、")}`,
          }
    );
  });

  // 重试某个 AI（或全部）：清除故障标记并重新驱动该阶段
  socket.on("adminRetryAI", ({ roomId, targetPlayerId } = {} as {
    roomId?: string;
    targetPlayerId?: string;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    const targets = targetPlayerId
      ? [targetPlayerId]
      : Object.keys(game.aiFailures ?? {});
    if (targets.length === 0) {
      socket.emit("error", "当前没有需要重试的 AI");
      return;
    }
    for (const id of targets) clearAiFailure(game, id, io);
    broadcastUpdate(io, game);
    void handleAIPhase(game, io);
    socket.emit("adminAiRetry", { message: `已重新驱动 ${targets.length} 个 AI，请观察是否恢复` });
  });

  // 人工兜底：强制某 AI 准备（不替它做投资/出价，只解除阶段等待）
  socket.on("adminForceAiReady", ({ roomId, targetPlayerId } = {} as {
    roomId?: string;
    targetPlayerId?: string;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    const player = game.players.find(
      (p) => p.id === targetPlayerId && isAiPlayer(p)
    );
    if (!player) {
      socket.emit("error", "找不到该 AI 玩家");
      return;
    }
    clearAiFailure(game, player.id, io);
    if (!player.ready && togglePlayerReady(game, player.id)) {
      game.logs.push(`👑 主持强制 AI「${player.name}」准备`);
      tryAdvancePhase(game);
    }
    broadcastUpdate(io, game);
  });

  // 人工兜底：延长投资/道具倒计时（默认 2 分钟）
  socket.on("adminExtendDeadline", ({ roomId, minutes } = {} as {
    roomId?: string;
    minutes?: number;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    if (game.phase !== "INVESTMENT" && game.phase !== "BUFF_USAGE") {
      socket.emit("error", "仅在投资/道具阶段可延长倒计时");
      return;
    }
    if (typeof game.investmentEndsAt !== "number") {
      socket.emit("error", "当前没有进行中的倒计时");
      return;
    }
    const addMs =
      Math.min(10, Math.max(1, Number(minutes) || 2)) * 60_000;
    game.investmentEndsAt += addMs;
    game.logs.push(`⏱️ 主持延长倒计时 ${Math.round(addMs / 60_000)} 分钟`);
    broadcastUpdate(io, game);
  });

  // 人工兜底：一键移除全部 AI（保留真人继续）
  socket.on("adminRemoveAllAI", ({ roomId } = {} as { roomId?: string }) => {
    if (!socket.data.isSuperAdmin) return;
    const game = rooms[roomId ?? ""];
    if (!game) return;
    const aiIds = game.players.filter((p) => isAiPlayer(p)).map((p) => p.id);
    let removed = 0;
    for (const id of aiIds) {
      clearAiFailure(game, id, io);
      if (removeAiPlayer(game, id)) {
        forgetAiPlayer(game.roomId, id);
        removed += 1;
      }
    }
    if (removed === 0) {
      socket.emit("error", "当前没有 AI 玩家");
      return;
    }
    game.logs.push(`👑 主持移除了 ${removed} 名 AI 玩家`);
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
  });

  socket.on("adminStartAutoPlay", async ({ roomId: _roomId, iterations } = {} as {
    roomId?: string;
    iterations?: number;
  }) => {
    if (!socket.data.isSuperAdmin) return;
    if (!AI_BOT_ENABLED) {
      socket.emit("error", "AI 玩家功能已关闭");
      return;
    }
    // 无真人观战的离线调优：保留原有能力，结果只写后端日志
    socket.emit("info", `开始全自动调优 (迭代 ${iterations} 次)，请查看后端控制台日志`);
    import("../ai/autoTuner.js").then((module) => {
      module.runAutoTuningSession(iterations || 5);
    });
  });

  // === Player ===
  socket.on("playerReady", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    if (game.phase === "ROOM_WAITING") return;
    // 只有「时代介绍 / 结算」靠 ready 推进；投资阶段的 ready 由提交投资触发，
    // 不能允许客户端直接把自己标成已提交却不落投资。
    if (game.phase !== "ERA_INTRO" && game.phase !== "SETTLEMENT") return;
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (!togglePlayerReady(game, player.id)) return;
    appendSessionEvent(
      game,
      "player_ready",
      {
        phase: game.phase,
        globalRound: game.globalRound,
        currentEra: game.currentEra,
        roundInEra: game.roundInEra,
      },
      player.id
    );
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
    if (!applyInvestments(game, player.id, sanitized, "player")) {
      socket.emit("error", "投资方案无效（精力不足或超出限制）");
      return;
    }
    togglePlayerReady(game, player.id);
    tryAdvancePhase(game);
    broadcastUpdate(io, game);
  });

  socket.on("unlockOwnInvestment", () => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;

    const result = unlockSubmittedInvestment(game, player.id);
    if (!result.ok) {
      const messages: Record<typeof result.reason, string> = {
        not_found: "解锁失败：玩家不存在",
        not_ready: "你尚未锁定投资",
        wrong_phase: "当前阶段无法解锁",
        timer_closed: "倒计时已结束，无法解锁",
        ai_player: "无法解锁",
      };
      socket.emit("error", messages[result.reason]);
      return;
    }

    socket.emit("playerNotify", {
      type: "investment",
      message: "已解锁投资方案，精力已退回，请调整后重新提交。",
    });
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
    const trimmed = normalizeNoteInput(note);
    const message = sanitizeTransactionNote(note);
    // 人本 AI：私信/转账留言同样扫描危机信号。原文不投递给对方、不进入 AI 观察，
    // 只给发送者固定安全回复，并记录类别（不记录原文）。
    let outboundNote = message;
    if (AI_SAFETY_ENABLED && message) {
      const safetyScan = detectCrisisSignals(message);
      if (safetyScan.risk) {
        const at = Date.now();
        game.safetyCrisisUntil = Math.max(
          game.safetyCrisisUntil ?? 0,
          at + SAFETY_CRISIS_WINDOW_MS
        );
        appendSessionEvent(
          game,
          "safety_crisis_detected",
          {
            source: "private_message",
            categories: safetyScan.categories,
            messageId: typeof clientTempId === "string" ? clientTempId.slice(0, 64) : null,
          },
          sender.id
        );
        if (at - (game.lastSafetyNoticeAt ?? 0) >= SAFETY_REPLY_COOLDOWN_MS) {
          game.lastSafetyNoticeAt = at;
          game.lastAiSafetyReplyAt = at;
        }
        socket.emit("playerNotify", { type: "safety", message: CRISIS_REPLY });
        outboundNote = "（因安全原因，本条私信内容未发送）";
      }
    }
    const tempId =
      typeof clientTempId === "string" && clientTempId.length > 0 && clientTempId.length <= 64
        ? clientTempId
        : undefined;

    if (amt === 0) {
      if (!trimmed) {
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
        note: outboundNote,
        status: "accepted" as const,
        timestamp: Date.now(),
        clientTempId: tempId,
      };
      game.transactions.push(tx);
      appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
      pruneSettledTransactions(game);
      broadcastUpdate(io, game);
      if (receiver.socketId) {
        const preview = truncateNotePreview(outboundNote, 48);
        io.to(receiver.socketId).emit("playerNotify", {
          type: "chat",
          message: `${sender.name}：${preview}`,
        });
      }
      return;
    }

    if (amt <= 0) {
      socket.emit("error", "转账金额无效");
      return;
    }
    const available = playerAvailableWealth(game, sender);
    if (amt > available) {
      socket.emit(
        "error",
        `可用财富不足，无法转账（可用 ${available}${formatPlayerHoldSuffix(game, sender.id)}）`
      );
      return;
    }

    const tx = {
      id: Math.random().toString(),
      fromId: sender.id,
      fromName: sender.name,
      toId: receiver.id,
      toName: receiver.name,
      amount: amt,
      note: outboundNote,
      status: "pending" as const,
      timestamp: Date.now(),
      clientTempId: tempId,
    };
    game.transactions.push(tx);
    appendSessionEvent(game, "transaction_created", { txId: tx.id, ...tx }, sender.id);
    pruneSettledTransactions(game);
    broadcastUpdate(io, game);
    if (receiver.socketId) {
      io.to(receiver.socketId).emit("playerNotify", {
        type: "transfer",
        message: `${sender.name} 向你转账 ${amt}（待确认）`,
      });
    }
  });

  socket.on("createChatGroup", ({ memberIds, name }) => {
    if (!GROUP_CHAT_ENABLED) {
      socket.emit("error", GROUP_CHAT_DISABLED_MESSAGE);
      return;
    }
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (!allow(`cg:${player.id}`, 5, 60_000)) {
      socket.emit("error", "操作过于频繁，请稍后再试");
      return;
    }
    const ids = Array.isArray(memberIds) ? memberIds.filter((id) => typeof id === "string") : [];
    const result = createCustomChatGroup(game, player.id, ids, name);
    if (!result.ok) {
      socket.emit("error", result.error);
      return;
    }
    appendSessionEvent(game, "chat_group_created", { groupId: result.group.id, name: result.group.name }, player.id);
    broadcastUpdate(io, game);
  });

  socket.on("addChatGroupMembers", ({ groupId, memberIds }) => {
    if (!GROUP_CHAT_ENABLED) {
      socket.emit("error", GROUP_CHAT_DISABLED_MESSAGE);
      return;
    }
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (typeof groupId !== "string") return;
    if (!allow(`cg-add:${player.id}`, 10, 60_000)) {
      socket.emit("error", "操作过于频繁，请稍后再试");
      return;
    }
    const ids = Array.isArray(memberIds) ? memberIds.filter((id) => typeof id === "string") : [];
    const result = addChatGroupMembers(game, player.id, groupId, ids);
    if (!result.ok) {
      socket.emit("error", result.error);
      return;
    }
    broadcastUpdate(io, game);
  });

  socket.on("leaveChatGroup", ({ groupId }) => {
    if (!GROUP_CHAT_ENABLED) {
      socket.emit("error", GROUP_CHAT_DISABLED_MESSAGE);
      return;
    }
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player || typeof groupId !== "string") return;
    if (!allow(`cg-leave:${player.id}`, 10, 60_000)) {
      socket.emit("error", "操作过于频繁，请稍后再试");
      return;
    }
    const result = leaveChatGroup(game, player.id, groupId);
    if (!result.ok) {
      socket.emit("error", result.error);
      return;
    }
    broadcastUpdate(io, game);
  });

  socket.on("sendGroupMessage", ({ groupId, text, clientTempId }) => {
    if (!GROUP_CHAT_ENABLED) {
      socket.emit("error", GROUP_CHAT_DISABLED_MESSAGE);
      return;
    }
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const sender = game.players.find((p) => p.socketId === socket.id);
    if (!sender || typeof groupId !== "string") return;
    if (!allow(`grp:${sender.id}`, 20, 60_000)) {
      socket.emit("error", "发送过于频繁，请稍后再试");
      return;
    }
    const result = sendGroupChatMessage(game, sender.id, groupId, text, clientTempId);
    if (!result.ok) {
      socket.emit("error", result.error);
      return;
    }

    // 人本 AI：危机信号优先于游戏。由服务端统一发固定安全回复，
    // 不让任何模型（或无人值守房间）自由处理。
    if (AI_SAFETY_ENABLED) {
      const safetyScan = detectCrisisSignals(result.message.text);
      if (safetyScan.risk) {
        const at = Date.now();
        game.safetyCrisisUntil = Math.max(
          game.safetyCrisisUntil ?? 0,
          at + SAFETY_CRISIS_WINDOW_MS
        );
        // 只记录类别与消息 ID，不落原文，保护隐私
        appendSessionEvent(
          game,
          "safety_crisis_detected",
          {
            source: "player_chat",
            categories: safetyScan.categories,
            messageId: result.message.id,
          },
          sender.id
        );
        if (at - (game.lastSafetyNoticeAt ?? 0) >= SAFETY_REPLY_COOLDOWN_MS) {
          game.lastSafetyNoticeAt = at;
          // 系统提示已经给出固定回复，同一窗口内不让 AI 再重复一遍
          game.lastAiSafetyReplyAt = at;
          const notice: GroupMessage = {
            id: `safety-${at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
            groupId,
            fromId: SAFETY_NOTICE_FROM_ID,
            fromName: SAFETY_NOTICE_FROM_NAME,
            text: CRISIS_REPLY,
            timestamp: at,
          };
          (game.groupMessages ??= []).push(notice);
          game.logs.push(
            "⚠️ 安全提示：检测到危机信号，已发送求助资源；AI 暂停闲聊 10 分钟"
          );
        }
        if (sender.socketId) {
          io.to(sender.socketId).emit("playerNotify", {
            type: "safety",
            message: CRISIS_REPLY,
          });
        }
      }
    }

    const group = game.chatGroups?.find((g) => g.id === groupId);
    appendSessionEvent(
      game,
      "group_message",
      { groupId, messageId: result.message.id, fromId: sender.id },
      sender.id
    );
    broadcastUpdate(io, game);
    for (const targetId of result.notifyTargets) {
      const target = game.players.find((p) => p.id === targetId);
      if (!target?.socketId) continue;
      io.to(target.socketId).emit("playerNotify", {
        type: "chat",
        message: `${group?.name ?? "群聊"} · ${sender.name}：${result.preview}`,
      });
    }
  });

  socket.on("respondTransaction", ({ txId, accept }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const tx = game.transactions.find(t => t.id === txId);
    const player = game.players.find(p => p.socketId === socket.id);
    if (!tx || !player) return;
    const resolved = resolvePendingTransfer(game, txId, player.id, accept === true);
    if (!resolved.ok) return;
    appendSessionEvent(
      game,
      "transaction_resolved",
      { txId, accept, status: resolved.status, amount: resolved.amount },
      player.id
    );
    pruneSettledTransactions(game);
    broadcastUpdate(io, game);

    const sender = game.players.find((p) => p.id === tx.fromId);
    if (sender?.socketId && tx.amount > 0) {
      const verb =
        resolved.status === "accepted" ? "已接收你的转账" : "已退回你的转账";
      io.to(sender.socketId).emit("playerNotify", {
        type: "transfer",
        message: `${player.name} ${verb} ${resolved.amount}`,
      });
    }
  });

  socket.on(
    "fetchTransactionHistory",
    ({ roomId: reqRoomId, beforeTimestamp, beforeId, limit, viewAsPlayerId }) => {
      const roomId = getRoomId(socket);
      if (!roomId || !rooms[roomId] || reqRoomId !== roomId) return;
      const game = rooms[roomId];
      const isSuperAdmin = socket.data.isSuperAdmin === true;
      let viewerPlayerId: string | null = null;
      let isGodView = false;
      if (isSuperAdmin) {
        const raw =
          typeof viewAsPlayerId === "string" ? viewAsPlayerId.trim() : "";
        if (raw && isValidHumanPerspectiveTarget(game, raw)) {
          viewerPlayerId = raw;
          isGodView = false;
        } else {
          isGodView = true;
        }
      } else {
        const player = game.players.find((p) => p.socketId === socket.id);
        if (!player) return;
        viewerPlayerId = player.id;
      }

      const ts = Number(beforeTimestamp);
      const id = typeof beforeId === "string" ? beforeId : "";
      if (!Number.isFinite(ts) || !id) {
        socket.emit("error", "无效的历史游标");
        return;
      }

      const visible = visibleTransactionsForViewer(
        game.transactions,
        viewerPlayerId,
        isGodView
      );
      const pageLimit = clampHistoryPageLimit(limit);
      const { transactions, hasMore } = fetchTransactionHistoryPage(
        visible,
        { timestamp: ts, id },
        pageLimit
      );
      socket.emit("transactionHistoryPage", {
        roomId,
        transactions,
        hasMore,
        total: visible.length,
      });
    }
  );

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
    const cups = player.coffeePurchasesThisRound ?? 1;
    socket.emit("playerNotify", {
      type: "coffee",
      message: `咖啡购买成功（本轮第 ${cups} 杯） · -${COFFEE_WEALTH_COST}💰 +${COFFEE_ENERGY_GAIN}⚡`,
    });
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
    const n = Math.floor(Number(count));
    const result = refundCoffee(game, player, n);
    if (!result.ok) {
      socket.emit("error", result.message);
      return;
    }
    broadcastUpdate(io, game);
    const remaining = player.coffeePurchasesThisRound ?? 0;
    socket.emit("playerNotify", {
      type: "coffee",
      message: `咖啡退订成功（${n} 杯） · +${n * COFFEE_WEALTH_COST}💰 −${n * COFFEE_ENERGY_GAIN}⚡ · 本轮剩余 ${remaining} 杯`,
    });
  });

  socket.on("useBuffCard", (data) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find(p => p.socketId === socket.id);
    if (!player) return;

    const cardId = typeof data?.cardId === "string" ? data.cardId : "";
    if (!cardId) {
      socket.emit("error", "未指定道具卡");
      return;
    }

    // 强买强卖：仅拍卖阶段
    if (cardId === FORCE_BUY_CARD_ID) {
      if (game.phase !== "AUCTION") {
        socket.emit("error", "强买强卖仅可在拍卖阶段使用");
        return;
      }
      const result = useForceBuyCard(game, player.id);
      if (result.success) {
        for (const cancelled of result.cancelledOffers ?? []) {
          const target = game.players.find((p) => p.id === cancelled.playerId);
          if (target?.socketId) {
            io.to(target.socketId).emit("auctionOfferCancelled", {
              offerId: cancelled.offerId,
              cardId: cancelled.cardId,
            });
          }
        }
        broadcastUpdate(io, game);
        socket.emit("playerNotify", { type: "buff", message: result.msg });
        if (result.auctionSold) {
          socket.to(roomId).emit("playerNotify", {
            type: "auction_sold",
            message: formatAuctionSoldMessage(game, result.auctionSold),
          });
        }
      } else {
        socket.emit("error", result.msg);
      }
      return;
    }

    // 道具可在投资阶段使用（未锁定前）；兼容遗留 BUFF_USAGE
    if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") {
      socket.emit("error", "当前阶段不能使用道具卡");
      return;
    }
    if (player.ready) {
      socket.emit("error", "已锁定投资，无法再使用道具卡");
      return;
    }
    if (isInvestmentBuffLockoutActive(game)) {
      socket.emit("error", "最后 2 分钟不能使用道具卡");
      return;
    }
    const result = useBuffCard(game, player.id, cardId, data);
    if (result.success) {
      if (!player.usedCards) player.usedCards = [];
      player.usedCards.push(cardId);
      broadcastUpdate(io, game);
      socket.emit("playerNotify", { type: "buff", message: result.msg });
      // 彩票：打出后立刻线上随机掷骰，玩家看到骰子动画后确认领取
      if (cardId === "buff_lottery") {
        void createRandomLotteryOffer(game, player.id)
          .then((drawResult) => {
            if (!drawResult.ok) return;
            const { offer, draw } = drawResult;
            socket.emit("lotterySettleRequest", {
              offerId: offer.offerId,
              amount: offer.amount,
              roll: offer.roll ?? null,
              source: offer.source ?? draw.source,
              drawnAt: offer.drawnAt ?? draw.drawnAt,
            });
            game.logs.push(
              `🎲 线上随机开奖：${player.name} 掷出 ${draw.roll} 点，奖金 ${offer.amount} 财富`
            );
            appendSessionEvent(game, "lottery_drawn", {
              targetPlayerId: player.id,
              amount: offer.amount,
              roll: offer.roll ?? null,
              source: offer.source ?? draw.source,
              actor: "player",
            });
            broadcastUpdate(io, game);
            // 如果玩家已锁定、其他人都 ready，draw 完成后再推一次阶段
            tryAdvancePhase(game);
          })
          .catch((error) => {
            console.error("[lottery] random draw failed:", error);
            tryAdvancePhase(game);
          });
      }
      if (result.notifyTargetId && result.notifyTargetMsg) {
        const target = game.players.find((p) => p.id === result.notifyTargetId);
        if (target?.socketId && target.id !== player.id) {
          io.to(target.socketId).emit("playerNotify", {
            type: result.investmentAutoUnlocked ? "investment" : "buff_hit",
            message: result.notifyTargetMsg,
          });
        }
      }
    } else {
      socket.emit("error", result.msg);
    }
  });

  socket.on("ackSlackHit", (payload?: { hitId?: unknown }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (!ackSlackHit(game, player.id, payload?.hitId)) {
      socket.emit("error", "摸鱼提示已失效，请刷新后重试");
      return;
    }
    broadcastUpdate(io, game);
  });

  socket.on("ackLighterBurn", (payload?: { noticeId?: unknown }) => {
    const roomId = getRoomId(socket);
    if (!roomId || !rooms[roomId]) return;
    const game = rooms[roomId];
    const player = game.players.find((p) => p.socketId === socket.id);
    if (!player) return;
    if (!ackLighterBurnNotice(game, player.id, payload?.noticeId)) {
      socket.emit("error", "打火机烧毁提示已失效，请刷新后重试");
      return;
    }
    broadcastUpdate(io, game);
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

    void finalizeCommunityName(io, game, communityName, "player");
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
    void finalizeCommunityName(io, game, communityName, "admin");
  });

  socket.on("disconnect", () => {
    for (const game of Object.values(rooms)) {
      if (removeDeviceClaimBySocket(game, socket.id)) {
        delete socket.data.pendingDeviceClaim;
        broadcastUpdate(io, game);
      }
    }
    const boundRoom = socket.data.gameRoomId as string | undefined;
    if (boundRoom && rooms[boundRoom]) {
      const game = rooms[boundRoom];
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        syncEnergyAfterRosterChange(game);
        appendSessionEvent(
          game,
          "presence",
          presencePayload(game, "disconnect", player.id),
          player.id
        );
        tryAdvancePhase(game);
        broadcastUpdate(io, game);
      }
      return;
    }
    for (const game of Object.values(rooms)) {
      const player = game.players.find((p) => p.socketId === socket.id);
      if (player) {
        player.connected = false;
        syncEnergyAfterRosterChange(game);
        appendSessionEvent(
          game,
          "presence",
          presencePayload(game, "disconnect", player.id),
          player.id
        );
        tryAdvancePhase(game);
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