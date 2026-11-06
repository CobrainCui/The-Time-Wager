import { Server } from "socket.io";

import { GameState, Transaction } from "../state/gameState.js";
import { getPublicCommunityLeaderboard } from "../state/communityLeaderboard.js";
import { peekNextRoundEnergy } from "../logic/energySchedule.js";
import { buildAuctionLotPublicView, publicSessionAuctionWins } from "../logic/auctionCards.js";
import { pendingDeviceClaimsForGodView } from "../logic/deviceClaim.js";
import { transactionsForViewerPayload, visibleTransactionsForViewer } from "../util/transactionHistory.js";
import { chatGroupsForViewer, groupMessagesForViewer } from "../logic/chatGroups.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { serializationForMemberSocket } from "./adminPerspective.js";
import type { SettlementBaseline } from "../logic/settlementBaseline.js";
import { computeWealthRanks } from "../util/playerRank.js";
import type { Socket } from "socket.io";

const HIDDEN_INVESTMENT_PHASES = new Set<GameState["phase"]>(["INVESTMENT", "BUFF_USAGE"]);

/** 他人精力不对玩家 payload 暴露（仅本人或上帝可见） */
function energyVisibleToViewer(
  isGodView: boolean,
  visibleToViewer: boolean
): boolean {
  return isGodView || visibleToViewer;
}

/**
 * 项目牌面只保留查看者自己的投入记录；他人的逐人投入、逐轮切片、
 * 历史收益都不下发，避免从 payload 反推对手投资。
 * 全场累计（accumulatedInvested）与总派彩（totalPayout）仍公开。
 */
function projectsForViewer(
  projects: GameState["activeProjects"],
  viewerPlayerId: string | null,
  isGodView: boolean
): GameState["activeProjects"] {
  if (isGodView) return projects;
  return projects.map((project) => {
    const ownRecord = viewerPlayerId
      ? project.investorRecords?.[viewerPlayerId]
      : undefined;
    const ownSlices = viewerPlayerId
      ? project.investorRoundSlices?.[viewerPlayerId]
      : undefined;
    return {
      ...project,
      investorRecords:
        viewerPlayerId && ownRecord != null
          ? { [viewerPlayerId]: ownRecord }
          : {},
      investorRoundSlices:
        viewerPlayerId && ownSlices
          ? { [viewerPlayerId]: ownSlices }
          : {},
      earningRecords: {},
    };
  });
}

export function transactionsForViewer(
  transactions: Transaction[],
  viewerPlayerId: string | null | undefined,
  isGodView: boolean
): Transaction[] {
  return visibleTransactionsForViewer(transactions, viewerPlayerId, isGodView);
}

/** 与 broadcastUpdate 一致，供观战首包等单独 emit 使用 */
export function serializeGameForClient(
  game: GameState,
  extra: Record<string, unknown> = {},
  viewerPlayerId?: string | null
) {
  const isGodView = extra.isGodView === true;
  const { transactions, transactionLog } = transactionsForViewerPayload(
    game.transactions,
    viewerPlayerId ?? null,
    isGodView
  );
  const {
    sessionTelemetry,
    sessionStartedAt,
    pendingAuctionOffers,
    pendingLotteryOffers,
    lotteryCompletedDeals,
    pendingWealthAdjustments,
    auctionBids,
    auctionCompletedDeals: _auctionCompletedDeals,
    createdByIp: _createdByIp,
    settlementBaseline: _settlementBaseline,
    adminProjectAdjustments: _adminProjectAdjustments,
    hostRevision: _hostRevision,
    aiFailures: _aiFailures,
    logs: _logs,
    // 道具/打火机内部流水只供服务端结算，不下发玩家
    lighterBurnDeclarations: _lighterBurnDeclarations,
    roundBuffPlays: _roundBuffPlays,
    playerLogs: _playerLogs,
    ...gamePublic
  } = game;
  const hideInvestments = HIDDEN_INVESTMENT_PHASES.has(game.phase);
  const wealthRanks = computeWealthRanks(game.players);
  const ownLotteryOffer =
    !isGodView && viewerPlayerId
      ? (pendingLotteryOffers ?? []).find((o) => o.playerId === viewerPlayerId)
      : undefined;
  const ownWealthAdjust =
    !isGodView && viewerPlayerId
      ? (pendingWealthAdjustments ?? []).find((o) => o.playerId === viewerPlayerId)
      : undefined;
  const lotView = buildAuctionLotPublicView(game);
  // 打火机命中/未命中摘要只给上帝视图；玩家不能据此判断自己的打火机是否成功
  const lastSettlementForViewer = game.lastSettlement
    ? isGodView
      ? game.lastSettlement
      : (() => {
          const { lighterResolve: _lighterResolve, ...rest } = game.lastSettlement;
          return rest;
        })()
    : undefined;

  const chatGroups = GROUP_CHAT_ENABLED
    ? chatGroupsForViewer(game, viewerPlayerId ?? null, isGodView)
    : [];
  const groupMessages = GROUP_CHAT_ENABLED
    ? groupMessagesForViewer(game, viewerPlayerId ?? null, isGodView)
    : [];

  return {
    ...gamePublic,
    ...(game.lastSettlement ? { lastSettlement: lastSettlementForViewer } : {}),
    activeProjects: projectsForViewer(game.activeProjects, viewerPlayerId ?? null, isGodView),
    uncompletedProjects: projectsForViewer(
      game.uncompletedProjects,
      viewerPlayerId ?? null,
      isGodView
    ),
    completedProjects: projectsForViewer(
      game.completedProjects,
      viewerPlayerId ?? null,
      isGodView
    ),
    chatGroups,
    groupMessages,
    ...lotView,
    auctionSessionWins: publicSessionAuctionWins(game),
    ...(isGodView
      ? {
          hostRevision: game.hostRevision ?? 0,
          ...(game.settlementBaseline
            ? {
                settlementBaselineActiveProjects: (
                  game.settlementBaseline as SettlementBaseline
                ).activeProjects,
              }
            : {}),
          pendingAuctionOffers: pendingAuctionOffers ?? [],
          pendingLotteryOffers: pendingLotteryOffers ?? [],
          lotteryCompletedDeals: lotteryCompletedDeals ?? [],
          pendingWealthAdjustments: pendingWealthAdjustments ?? [],
          pendingDeviceClaims: pendingDeviceClaimsForGodView(game),
          auctionCompletedDeals: game.auctionCompletedDeals ?? [],
          auctionBids: auctionBids ?? [],
          aiFailures: game.aiFailures ?? {},
          aiDeadlinePaused: game.aiDeadlinePaused ?? false,
          logs: game.logs,
          roundBuffPlays: game.roundBuffPlays ?? [],
          lighterBurnDeclarations: game.lighterBurnDeclarations ?? [],
          playerLogs: game.playerLogs,
        }
      : {
          ...(ownLotteryOffer ? { pendingLotteryOffer: ownLotteryOffer } : {}),
          ...(ownWealthAdjust ? { pendingWealthAdjustment: ownWealthAdjust } : {}),
        }),
    readyPlayers: Array.from(game.readyPlayers),
    phaseFinished: Array.from(game.phaseFinished),
    drawnProjects: Array.from(game.drawnProjects),
    players: game.players.map((p) => {
      const {
        socketId: _socketId,
        reconnectToken: _reconnectToken,
        preSubmitInvestmentDraft: _preSubmit,
        receivedRoundEnergy: _receivedRoundEnergy,
        buffRoundNotes,
        pendingSlackHits,
        pendingLighterBurnNotices,
        slackedBy: _slackedBy,
        slackEnergyLost: _slackEnergyLost,
        inventory,
        activeBuffs,
        usedCards,
        // 旧局内存可能仍带幽灵字段，避免漏进玩家 payload
        lighterBurnGhostIds: _lighterBurnGhostIds,
        ...rest
      } = p as typeof p & { lighterBurnGhostIds?: string[] };
      const slackAttribution =
        isGodView
          ? { slackedBy: p.slackedBy ?? [], slackEnergyLost: p.slackEnergyLost ?? [] }
          : { slackedBy: [] as string[], slackEnergyLost: [] as number[] };
      const visibleToViewer = isGodView || p.id === viewerPlayerId;
      const { energy, ...restWithoutEnergy } = rest;
      const energyField = energyVisibleToViewer(isGodView, visibleToViewer)
        ? { energy }
        : {};
      if (visibleToViewer) {
        return {
          ...restWithoutEnergy,
          ...energyField,
          rank: wealthRanks.get(p.id) ?? p.rank,
          ...slackAttribution,
          inventory,
          activeBuffs,
          usedCards,
          // 本轮道具短记录仅本人（或上帝）可见
          buffRoundNotes: buffRoundNotes ?? [],
          pendingSlackHits: pendingSlackHits ?? [],
          pendingLighterBurnNotices: pendingLighterBurnNotices ?? [],
          investmentDraft: p.investmentDraft,
          investment: p.investment,
          coffeePurchasesThisRound: p.coffeePurchasesThisRound ?? 0,
        };
      }
      return {
        ...restWithoutEnergy,
        ...energyField,
        rank: wealthRanks.get(p.id) ?? p.rank,
        ...slackAttribution,
        // 他人手牌 / 已发动 / 已用对玩家隐藏
        buffRoundNotes: undefined,
        pendingSlackHits: undefined,
        pendingLighterBurnNotices: undefined,
        investmentDraft: undefined,
        investment: hideInvestments ? {} : p.investment,
        // 咖啡杯数会间接暴露本轮精力操作，只给本人
        coffeePurchasesThisRound: undefined,
        // 决策阶段不暴露他人的长期投入、精力去向与风险收益
        ...(hideInvestments
          ? {
              longTerm: {},
              riskGains: {},
              totalEnergyConsumed: undefined,
              investedRiskEnergy: undefined,
              investedLongEnergy: undefined,
              investedShortEnergy: undefined,
            }
          : {}),
      };
    }),
    transactions,
    transactionLog,
    serverNow: Date.now(),
    nextRoundEnergy: peekNextRoundEnergy(game),
    // 倒计时控场：显式下发，避免后续序列化改动漏字段导致 Admin/玩家不同步
    investmentEndsAt: game.investmentEndsAt,
    investmentTimerPausedAt: game.investmentTimerPausedAt,
    settlementHistory: sessionTelemetry?.settlementHistory ?? [],
    ...extra,
    globalLeaderboard: getPublicCommunityLeaderboard(),
  };
}

export function emitSerializedGameUpdate(
  socket: Socket,
  game: GameState
): void {
  const player = game.players.find((p) => p.socketId === socket.id);
  const isSuperAdmin = socket.data.isSuperAdmin === true;
  if (isSuperAdmin) {
    socket.emit("gameUpdate", serializeGameForClient(game, { isGodView: true }, null));
    return;
  }
  const { extra, viewerPlayerId } = serializationForMemberSocket(
    game,
    false,
    undefined,
    player?.id ?? null
  );
  socket.emit("gameUpdate", serializeGameForClient(game, extra, viewerPlayerId));
}

export function broadcastUpdate(io: Server, game: GameState) {
  const memberIds = io.sockets.adapter.rooms.get(game.roomId);
  if (!memberIds) return;

  for (const socketId of memberIds) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    emitSerializedGameUpdate(socket, game);
  }
}
