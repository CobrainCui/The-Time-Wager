import type { AiDifficulty, AiPersonaKey } from "./aiPersona.js";

export interface AiBuffPlan {
  cardId: string;
  targetPlayerId?: string;
  targetProjectId?: number;
  burnCardId?: string;
}

export interface AiTransferPlan {
  toPlayerId: string;
  amount: number;
  note: string;
}

export interface AiInvestmentPlan {
  reasoning: string;
  messages: string[];
  transfer: AiTransferPlan | null;
  coffee: number;
  useCard: AiBuffPlan | null;
  investment: Record<number, number>;
}

export interface AiAuctionPlan {
  action: "bid" | "pass" | "force_buy";
  amount?: number;
  reasoning: string;
}

export interface AiTransferDecision {
  accept: boolean;
  reasoning: string;
}

export type { AiDifficulty, AiPersonaKey };
