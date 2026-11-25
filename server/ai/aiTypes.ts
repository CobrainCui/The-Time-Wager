import type { AiDifficulty, AiPersonaKey } from "./aiPersona.js";

export interface AiBuffPlan {
  cardId: string;
  targetPlayerId?: string;
  targetProjectId?: number;
  burnCardId?: string;
  visibility?: "public" | "private";
}

export interface AiTransferPlan {
  toPlayerId: string;
  amount: number;
  note: string;
}

export interface AiGroupMessagePlan {
  groupId: string;
  text: string;
}

export interface AiGroupCreatePlan {
  /** 群名可省略；省略时按成员名自动生成 */
  name?: string;
  /** 至少 2 名其他玩家；创建者会自动加入 */
  memberIds: string[];
}

export interface AiInvestmentPlan {
  reasoning: string;
  messages: string[];
  groupMessages?: AiGroupMessagePlan[];
  createGroup?: AiGroupCreatePlan | null;
  transfer: AiTransferPlan | null;
  coffee: number;
  useCard: AiBuffPlan | null;
  useCards?: AiBuffPlan[];
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
  reply?: string;
  unlockToReinvest?: boolean;
}

export interface AiChatReplyPlan {
  reasoning: string;
  silent: boolean;
  reply: string;
  unlockToReinvest?: boolean;
  transfer?: { toPlayerId?: string; amount: number; note: string } | null;
}

export type { AiDifficulty, AiPersonaKey };
