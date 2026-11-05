import type { Player } from "../state/gameState.js";

export type AiDifficulty = "easy" | "normal" | "hard";

/** 与命运素描同名，便于玩家在终局人格报告里理解 AI 的行为倾向。 */
export type AiPersonaKey =
  | "罗盘精算师"
  | "时荫植者"
  | "涌机触发者"
  | "瞬刻炼金士";

export const AI_PERSONA_KEYS: AiPersonaKey[] = [
  "罗盘精算师",
  "时荫植者",
  "涌机触发者",
  "瞬刻炼金士",
];

export function isAiPersona(value: unknown): value is AiPersonaKey {
  return typeof value === "string" && (AI_PERSONA_KEYS as string[]).includes(value);
}

export function normalizeDifficulty(value: unknown): AiDifficulty {
  return value === "easy" || value === "hard" ? value : "normal";
}

/** 每名 AI 的稳定画像：人格只影响倾向，不改变可用信息。 */
export interface AiProfile {
  /** 旧局 / 显式指定人格时保留；自由发挥时为空 */
  persona: AiPersonaKey | null;
  /** 展示名：显式人格名，或「自由发挥」 */
  personaLabel: string;
  /** 产品版默认：不预设人格，由模型根据局面自由发挥 */
  freeform: boolean;
  difficulty: AiDifficulty;
  /** 长期 / 短期 / 风险 三类项目的初始权重（会按局面再校正） */
  longBias: number;
  shortBias: number;
  riskBias: number;
  /** 社交倾向：聊天、转账、接受陌生转账 */
  socialBias: number;
  /** 干扰倾向：摸鱼、做空、打火机 */
  aggression: number;
  /** 拍卖出价上限占可用财富比例 */
  bidRatio: number;
  /** 图标与提示语（产品展示用） */
  emoji: string;
  tagline: string;
}

const PROFILES: Record<AiPersonaKey, Omit<AiProfile, "difficulty" | "freeform" | "personaLabel">> = {
  罗盘精算师: {
    persona: "罗盘精算师",
    longBias: 0.2,
    shortBias: 0.72,
    riskBias: 0.08,
    socialBias: 0.35,
    aggression: 0.15,
    bidRatio: 0.3,
    emoji: "🧭",
    tagline: "算得清每一分回报",
  },
  时荫植者: {
    persona: "时荫植者",
    longBias: 0.68,
    shortBias: 0.24,
    riskBias: 0.08,
    socialBias: 0.45,
    aggression: 0.1,
    bidRatio: 0.28,
    emoji: "🌳",
    tagline: "把时间种成复利",
  },
  涌机触发者: {
    persona: "涌机触发者",
    longBias: 0.18,
    shortBias: 0.27,
    riskBias: 0.55,
    socialBias: 0.5,
    aggression: 0.8,
    bidRatio: 0.45,
    emoji: "⚡",
    tagline: "风险越大，机会越大",
  },
  瞬刻炼金士: {
    persona: "瞬刻炼金士",
    longBias: 0.12,
    shortBias: 0.58,
    riskBias: 0.3,
    socialBias: 0.55,
    aggression: 0.6,
    bidRatio: 0.38,
    emoji: "⏳",
    tagline: "只争这一轮的现钱",
  },
};

/**
 * 自由发挥：没有预设人格。保留一份均衡的本地兜底权重，
 * 只在模型不可用时使用；模型可用时提示词不会给它任何性格暗示。
 */
const FREEFORM_PROFILE: Omit<AiProfile, "difficulty" | "freeform" | "personaLabel"> = {
  persona: null,
  longBias: 0.34,
  shortBias: 0.46,
  riskBias: 0.2,
  socialBias: 0.5,
  aggression: 0.35,
  bidRatio: 0.32,
  emoji: "🤖",
  tagline: "不设剧本，随机应变",
};

const DIFFICULTY_SCALE: Record<
  AiDifficulty,
  {
    longBias: number;
    shortBias: number;
    riskBias: number;
    socialBias: number;
    aggression: number;
    bidRatio: number;
  }
> = {
  // easy：更保守、更少操作，给新手玩家留出空间
  easy: { longBias: 0.8, shortBias: 1.15, riskBias: 0.35, socialBias: 0.4, aggression: 0.25, bidRatio: 0.25 },
  normal: { longBias: 1, shortBias: 1, riskBias: 1, socialBias: 1, aggression: 1, bidRatio: 1 },
  // hard：更会算长期完成度、更敢出价、更常干扰
  hard: { longBias: 1.25, shortBias: 1.05, riskBias: 1.1, socialBias: 1.35, aggression: 1.5, bidRatio: 1.35 },
};

export function profileFor(persona: unknown, difficulty: unknown): AiProfile {
  const freeform = !isAiPersona(persona);
  const base = freeform ? FREEFORM_PROFILE : PROFILES[persona];
  const diff = normalizeDifficulty(difficulty);
  const scale = DIFFICULTY_SCALE[diff];
  const normalize = (v: number) => Math.max(0, Math.min(1, v));
  return {
    ...base,
    difficulty: diff,
    freeform,
    personaLabel: freeform || !base.persona ? "自由发挥" : base.persona,
    longBias: normalize(base.longBias * scale.longBias),
    shortBias: normalize(base.shortBias * scale.shortBias),
    riskBias: normalize(base.riskBias * scale.riskBias),
    socialBias: normalize(base.socialBias * scale.socialBias),
    aggression: normalize(base.aggression * scale.aggression),
    bidRatio: Math.max(0.1, Math.min(0.6, base.bidRatio * scale.bidRatio)),
  };
}

export function profileForPlayer(player: Player): AiProfile {
  return profileFor(player.aiPersona, player.aiDifficulty);
}

/** 供前端/管理端展示的人格说明。 */
export function aiPersonaCatalog() {
  return AI_PERSONA_KEYS.map((key) => ({
    key,
    emoji: PROFILES[key].emoji,
    tagline: PROFILES[key].tagline,
  }));
}
