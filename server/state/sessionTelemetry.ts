import crypto from "crypto";
import { GameState, SettlementProjectResult } from "./gameState.js";

export type SessionEventType =
  | "phase_changed"
  | "draft_seat_chosen"
  | "draft_order_swapped"
  | "investment_submitted"
  | "admin_investment_reverted"
  | "buff_used"
  | "coffee_purchased"
  | "transaction_created"
  | "transaction_resolved"
  | "auction_offered"
  | "auction_resolved"
  | "lottery_settled"
  | "social_rated"
  | "settlement_round"
  | "community_named"
  | "persona_voted";

export interface SessionEvent {
  id: string;
  type: SessionEventType;
  timestamp: number;
  playerId?: string;
  payload: Record<string, unknown>;
}

export interface SettlementHistoryEntry {
  round: number;
  currentEra: number;
  roundInEra: number;
  results: SettlementProjectResult[];
}

export interface SessionTelemetry {
  events: SessionEvent[];
  settlementHistory: SettlementHistoryEntry[];
}

export function emptySessionTelemetry(): SessionTelemetry {
  return { events: [], settlementHistory: [] };
}

function ensureTelemetry(game: GameState): SessionTelemetry {
  if (!game.sessionTelemetry) {
    game.sessionTelemetry = emptySessionTelemetry();
  }
  return game.sessionTelemetry;
}

export function ensureSessionStarted(game: GameState): void {
  if (!game.sessionStartedAt) {
    game.sessionStartedAt = Date.now();
  }
}

export function appendSessionEvent(
  game: GameState,
  type: SessionEventType,
  payload: Record<string, unknown>,
  playerId?: string
): void {
  const tel = ensureTelemetry(game);
  tel.events.push({
    id: crypto.randomUUID(),
    type,
    timestamp: Date.now(),
    playerId,
    payload,
  });
}

export function recordPhaseChange(
  game: GameState,
  from: string,
  to: string,
  reason?: string
): void {
  if (from === to) return;
  appendSessionEvent(game, "phase_changed", {
    from,
    to,
    currentEra: game.currentEra,
    roundInEra: game.roundInEra,
    globalRound: game.globalRound,
    reason: reason ?? null,
  });
}

export function appendSettlementRound(game: GameState, results: SettlementProjectResult[]): void {
  const tel = ensureTelemetry(game);
  const entry: SettlementHistoryEntry = {
    round: game.globalRound,
    currentEra: game.currentEra,
    roundInEra: game.roundInEra,
    results: JSON.parse(JSON.stringify(results)) as SettlementProjectResult[],
  };
  tel.settlementHistory.push(entry);
  appendSessionEvent(game, "settlement_round", {
    round: entry.round,
    currentEra: entry.currentEra,
    roundInEra: entry.roundInEra,
    projectCount: results.length,
  });
}
