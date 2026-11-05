import type { ActiveProject, GameState, Player } from "../state/gameState.js";
import { COFFEE_ENERGY_GAIN, COFFEE_WEALTH_COST } from "../logic/coffeeLogic.js";
import { spendableEnergy } from "../logic/investmentLogic.js";
import { sanitizeLongContribution } from "../logic/longTermLogic.js";
import {
  getLotCurrentBid,
  getMinimumNextBid,
  playerAvailableWealth,
} from "../logic/auctionCards.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import { AI_CONFIG } from "./aiConfig.js";
import { profileForPlayer, type AiProfile } from "./aiPersona.js";
import type {
  AiAuctionPlan,
  AiBuffPlan,
  AiInvestmentPlan,
  AiTransferDecision,
  AiTransferPlan,
} from "./aiTypes.js";

const SHORT_BASE_RATE = 10;
const LONG_BASE_RATE = 15;
const RISK_BASE_RATE = 20;
const RISK_HIGH_RATE = 25;
const AUCTION_CARD_VALUE: Record<string, number> = {
  buff_gold: 48,
  buff_lottery: 34,
  buff_force_buy: 36,
  buff_slack: 24,
  buff_short: 22,
  buff_work_rest: 18,
  buff_insurance: 16,
  buff_lighter: 15,
};

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deterministicPick<T>(items: T[], seed: string): T | undefined {
  if (items.length === 0) return undefined;
  return items[hash(seed) % items.length];
}

function headroom(project: ActiveProject): number {
  return Math.max(0, Math.floor(project.maxEnergy - project.accumulatedInvested));
}

function eraMatches(game: GameState, project: ActiveProject): boolean {
  return !!project.era && project.era === game.currentEraCard?.era;
}

function roundsLeft(game: GameState): number {
  return Math.max(1, (4 - game.currentEra) * 2 + (2 - game.roundInEra) + 1);
}

function riskRate(project: ActiveProject): number {
  return project.name.includes("成瘾") ||
    project.name.includes("完美") ||
    project.name.includes("幸福")
    ? RISK_HIGH_RATE
    : RISK_BASE_RATE;
}

/** 短期项目：排名奖 + 基础 10 倍；恰好完成才有排名奖，投爆会吃惩罚。 */
function shortScore(game: GameState, project: ActiveProject): number {
  const room = headroom(project);
  if (room <= 0) return -1;
  const rank0 = project.rankRewards?.[0] ?? 0;
  const completionUrgency = room <= 6 ? 0.6 : 0;
  return rank0 / Math.max(1, project.maxEnergy) + (eraMatches(game, project) ? 0.35 : 0) + completionUrgency;
}

/** 长期项目：完成时 15 倍 + 排名奖；越接近完成越值得补最后一刀。 */
function longScore(game: GameState, project: ActiveProject): number {
  const room = headroom(project);
  if (room <= 0) return -1;
  const progress = project.maxEnergy > 0 ? project.accumulatedInvested / project.maxEnergy : 0;
  const lateBonus = roundsLeft(game) <= 3 ? progress * 0.9 : 0;
  return progress * 1.1 + (eraMatches(game, project) ? 0.25 : 0) + lateBonus;
}

/** 风险项目：20/25 倍，但全场累计超上限会投爆并追回历史收益。 */
function riskScore(game: GameState, project: ActiveProject): number {
  const room = headroom(project);
  if (room < 2) return -1;
  const base = riskRate(project) / RISK_BASE_RATE;
  const safety = room >= 4 ? 0.35 : 0;
  return base + safety + (eraMatches(game, project) ? 0.15 : 0);
}

function bestProject(
  game: GameState,
  projects: ActiveProject[],
  scorer: (game: GameState, p: ActiveProject) => number,
  seed: string
): ActiveProject | undefined {
  const scored = projects
    .map((p) => ({ p, score: scorer(game, p) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return undefined;
  // 同等分数时给一点确定性变化，避免所有 AI 每轮都挤同一个项目
  const top = scored.filter((x) => x.score >= scored[0].score - 0.05);
  return deterministicPick(top.map((x) => x.p), seed) ?? scored[0].p;
}

function allocate(
  out: Record<number, number>,
  project: ActiveProject,
  amount: number,
  maxPerProject: number,
  budgetLeft: number
): number {
  const room = headroom(project);
  const take = Math.min(
    Math.max(0, Math.floor(amount)),
    room,
    Math.max(1, maxPerProject),
    Math.max(0, Math.floor(budgetLeft))
  );
  if (take <= 0) return 0;
  out[project.id] = (out[project.id] ?? 0) + take;
  return take;
}

/**
 * 生成一组合法投资。纯启发式：不调用模型，永远能返回可提交的方案。
 * `budgetEnergy` 是买咖啡之后的精力上限。
 */
export function chooseInvestment(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  budgetEnergy: number
): Record<number, number> {
  const projects = game.activeProjects ?? [];
  if (projects.length === 0 || budgetEnergy <= 0) return {};

  const shorts = projects.filter((p) => p.type === "short");
  const longs = projects.filter((p) => p.type === "long");
  const risks = projects.filter((p) => p.type === "risk");

  const weights = [
    { type: "short" as const, weight: profile.shortBias },
    { type: "long" as const, weight: profile.longBias },
    { type: "risk" as const, weight: profile.riskBias },
  ];
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0) || 1;

  const out: Record<number, number> = {};
  let remaining = Math.floor(budgetEnergy);

  for (const { type, weight } of weights) {
    if (remaining <= 0) break;
    const share = Math.max(0, Math.floor((budgetEnergy * weight) / totalWeight));
    if (share <= 0) continue;

    if (type === "short") {
      const first = bestProject(game, shorts, shortScore, `${ai.id}:short:${game.globalRound}`);
      if (first) {
        // 短期集中一点更容易吃到排名奖；但留一点给第二选择，避免全押
        const take = allocate(out, first, share, Math.max(1, share), remaining);
        remaining -= take;
        if (remaining > 0 && share >= 6) {
          const second = bestProject(
            game,
            shorts.filter((p) => p.id !== first.id),
            shortScore,
            `${ai.id}:short2:${game.globalRound}`
          );
          if (second) remaining -= allocate(out, second, Math.floor(share / 3), 3, remaining);
        }
      }
    } else if (type === "long") {
      // 已经参与中的长期项目优先续投，避免因为转投新项目而被判定「放弃」
      const activeLong = longs.filter(
        (p) => ai.longTerm?.[p.id]?.status === "active" && headroom(p) > 0
      );
      const first =
        bestProject(game, activeLong, longScore, `${ai.id}:long-active:${game.globalRound}`) ??
        bestProject(game, longs, longScore, `${ai.id}:long:${game.globalRound}`);
      if (first) {
        const room = headroom(first);
        // 能补完就补完；已有 active 长期至少续 3 点，避免被判定放弃
        const minContinue = activeLong.length > 0 ? 3 : 0;
        const target = room <= share ? room : Math.min(6, Math.max(share, minContinue));
        const cap = Math.min(target, room);
        remaining -= allocate(out, first, cap, cap, remaining);
      }
    } else {
      if (profile.riskBias < 0.12) continue;
      const first = bestProject(game, risks, riskScore, `${ai.id}:risk:${game.globalRound}`);
      if (first) {
        const cap = Math.min(3, share);
        remaining -= allocate(out, first, cap, cap, remaining);
      }
    }
  }

  // 长期追加规则：已有 active 记录时本轮至少 3 点，否则视为放弃。
  // 被规则裁掉的精力改投短期，避免浪费。
  for (const [idStr, amount] of Object.entries(out)) {
    const project = projects.find((p) => p.id === Number(idStr));
    if (project?.type !== "long") continue;
    const allowed = sanitizeLongContribution(ai.longTerm?.[project.id]?.status, amount);
    if (allowed === amount) continue;
    remaining += amount - allowed;
    if (allowed > 0) out[project.id] = allowed;
    else delete out[project.id];
  }

  // 还有精力：按人格权重优先补仓（长期主义先补长期，短线先补短期）
  if (remaining > 0) {
    const poolOrder = [
      { pool: shorts, weight: profile.shortBias },
      { pool: longs, weight: profile.longBias },
      ...(profile.riskBias >= 0.12
        ? [{ pool: risks, weight: profile.riskBias }]
        : []),
    ].sort((a, b) => b.weight - a.weight);
    for (const { pool } of poolOrder) {
      if (remaining <= 0) break;
      const candidate = bestProject(game, pool, (g, p) =>
        p.type === "short" ? shortScore(g, p) : p.type === "long" ? longScore(g, p) : riskScore(g, p),
        `${ai.id}:fill:${pool[0]?.type ?? "x"}:${game.globalRound}`
      );
      if (!candidate) continue;
      const room = headroom(candidate);
      let take = Math.min(remaining, room);
      if (candidate.type === "long") {
        take = Math.min(take, sanitizeLongContribution(ai.longTerm?.[candidate.id]?.status, take));
      }
      if (take > 0) remaining -= allocate(out, candidate, take, take, remaining);
    }
  }

  return out;
}

/** 买咖啡：只在精力见底且财富宽裕时买，最多 2 杯。 */
export function chooseCoffee(game: GameState, ai: Player, profile: AiProfile): number {
  if (!AI_CONFIG.coffeeEnabled) return 0;
  const available = playerAvailableWealth(game, ai);
  const maxCups = Math.floor(available / COFFEE_WEALTH_COST);
  if (maxCups <= 0) return 0;
  if (profile.difficulty === "easy") return 0;

  const energy = spendableEnergy(ai);
  const wantsEnergy =
    energy <= 5 ||
    (!profile.freeform && profile.persona === "瞬刻炼金士" && energy <= 8) ||
    (!profile.freeform &&
      profile.persona === "涌机触发者" &&
      energy <= 7 &&
      firstRiskProject(game));
  if (!wantsEnergy) return 0;

  const cap = profile.difficulty === "hard" ? 2 : 1;
  return Math.min(cap, maxCups);
}

function firstRiskProject(game: GameState): ActiveProject | undefined {
  return (game.activeProjects ?? []).find((p) => p.type === "risk");
}

function richestOpponent(game: GameState, ai: Player): Player | undefined {
  return [...game.players]
    .filter((p) => p.id !== ai.id && p.connected)
    .sort((a, b) => b.wealth - a.wealth)[0];
}

function mostInvestedShort(
  game: GameState,
  ai: Player,
  excludeProjectIds?: Set<number>
): ActiveProject | undefined {
  const isEligible = (p: ActiveProject) =>
    p.type !== "long" && !excludeProjectIds?.has(p.id);
  const candidates = [...(game.activeProjects ?? [])].filter(
    (p) => isEligible(p) && (p.investorRecords?.[ai.id] ?? 0) === 0
  );
  const pool = candidates.length > 0
    ? candidates
    : [...(game.activeProjects ?? [])].filter(isEligible);
  return pool.sort((a, b) => b.accumulatedInvested - a.accumulatedInvested)[0];
}

/** 道具：先出被动收益卡；有压力时才干扰。每轮只出一张。 */
export function chooseBuff(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  excludeProjectIds?: Set<number>
): AiBuffPlan | null {
  if (!AI_CONFIG.buffEnabled) return null;
  const inv = ai.inventory ?? [];
  if (inv.length === 0) return null;

  for (const passive of ["buff_gold", "buff_insurance", "buff_lottery"]) {
    if (inv.includes(passive)) return { cardId: passive };
  }
  if (inv.includes("buff_work_rest")) {
    return { cardId: "buff_work_rest", targetPlayerId: ai.id };
  }
  if (profile.aggression < 0.5) return null;

  const targetPlayer = richestOpponent(game, ai);
  if (inv.includes("buff_slack") && targetPlayer) {
    return { cardId: "buff_slack", targetPlayerId: targetPlayer.id };
  }
  if (inv.includes("buff_short")) {
    const project = mostInvestedShort(game, ai, excludeProjectIds);
    if (project) return { cardId: "buff_short", targetProjectId: project.id };
  }
  if (inv.includes("buff_lighter") && targetPlayer) {
    return { cardId: "buff_lighter", targetPlayerId: targetPlayer.id, burnCardId: "buff_gold" };
  }
  return null;
}

/** 社交转账：低频、小额，不能超过可用财富。 */
export function chooseTransfer(game: GameState, ai: Player, profile: AiProfile): AiTransferPlan | null {
  if (!AI_CONFIG.transferEnabled) return null;
  if (profile.socialBias < 0.55) return null;
  if (game.globalRound % 3 !== 0) return null;

  const available = playerAvailableWealth(game, ai);
  if (available < 12) return null;

  const targets = game.players.filter(
    (p) => p.id !== ai.id && p.connected && !isAiPlayer(p)
  );
  const target = deterministicPick(targets, `${ai.id}:tx:${game.globalRound}`);
  if (!target) return null;

  const amount = Math.min(5, Math.floor(available / 4));
  if (amount < 1) return null;
  return {
    toPlayerId: target.id,
    amount,
    note: "合作愉快，下轮一起把项目做满。",
  };
}

const CHAT_TEMPLATES: Record<string, string[]> = {
  罗盘精算师: ["这轮先拿稳的短期，回报看得见。", "我算了下，短期项目的排名奖更划算。"],
  时荫植者: ["长期项目再攒一轮，后面才是收成。", "前期慢一点没关系，长期会回来。"],
  涌机触发者: ["风险项目这轮可以试一手。", "有胆子的跟我一起冲风险。"],
  瞬刻炼金士: ["短期快打，先把现钱落袋。", "这一轮就要见收益，别等。"],
  // 自由发挥：不暴露固定人设，只做正常社交试探
  自由发挥: [
    "这轮大家怎么分配？我先看看局面。",
    "有合作机会可以聊，我这边还有余力。",
    "现在的排名还不算数，后面两轮才是关键。",
    "风险项目我还在犹豫，有人想一起吗？",
  ],
};

/** 公开发言：低频、短句、不含攻击性内容。 */
export function chooseChat(game: GameState, ai: Player, profile: AiProfile): string[] {
  if (!AI_CONFIG.chatEnabled || !GROUP_CHAT_ENABLED) return [];
  if (game.globalRound % 2 !== 0) return [];
  const templates = profile.freeform
    ? CHAT_TEMPLATES["自由发挥"]
    : CHAT_TEMPLATES[profile.persona ?? ""] ?? CHAT_TEMPLATES["自由发挥"];
  const text = deterministicPick(templates, `${ai.id}:chat:${game.globalRound}`);
  if (!text) return [];
  // 领跑时换一句，避免机械重复
  if (ai.rank === 1 && (ai.wealth ?? 0) > 0) {
    return ["我先领跑，各位这轮加油。"];
  }
  return [text];
}

/** 拍卖出价：只在自己出得起、且卡牌价值高于下一口时出价。 */
export function chooseAuctionAction(
  game: GameState,
  ai: Player,
  profile: AiProfile,
  decisionsThisLot: number
): AiAuctionPlan {
  if (!AI_CONFIG.auctionEnabled) {
    return { action: "pass", reasoning: "拍卖已关闭" };
  }
  const focusId = game.auctionFocusCardId;
  if (!focusId) return { action: "pass", reasoning: "当前没有正在拍的卡" };
  if ((ai.inventory ?? []).includes(focusId)) {
    return { action: "pass", reasoning: "这张卡我已经有了" };
  }
  if (decisionsThisLot >= AI_CONFIG.auctionMaxDecisions) {
    return { action: "pass", reasoning: "本张卡决策次数已到上限" };
  }

  const value = AUCTION_CARD_VALUE[focusId] ?? 10;
  const available = playerAvailableWealth(game, ai);
  const maxBid = Math.floor(available * profile.bidRatio);
  const current = getLotCurrentBid(game);
  const minNext = getMinimumNextBid(game);
  const canForceBuy =
    (ai.inventory ?? []).includes("buff_force_buy") &&
    !(game.forceBuyUsedPlayerIds ?? []).includes(ai.id) &&
    focusId !== "buff_force_buy";

  // 高价值卡：高难度 AI 会用强买强卖
  if (canForceBuy && value >= 30 && profile.aggression >= 0.55) {
    return { action: "force_buy", reasoning: "这张卡值这个价，直接拿走" };
  }

  if (maxBid < minNext) {
    return { action: "pass", reasoning: "可用财富不足以下一口" };
  }

  if (current === 0) {
    if (value >= 14 || profile.difficulty === "hard") {
      return { action: "bid", amount: minNext, reasoning: "起拍价拿一张有用的卡" };
    }
    return { action: "pass", reasoning: "这张卡对我价值不高" };
  }

  // 已有人出价：只有卡牌价值明显高于下一口才继续加
  if (value >= minNext * 1.25) {
    return { action: "bid", amount: minNext, reasoning: "卡牌价值仍高于下一口" };
  }
  return { action: "pass", reasoning: "加价不划算了" };
}

/** 收到转账：默认接受；0 元私信也接受。 */
export function decideIncomingTransfer(
  _game: GameState,
  _ai: Player,
  tx: { amount: number; note?: string }
): AiTransferDecision {
  if (tx.amount === 0) {
    return { accept: true, reasoning: "私信没有财富代价，先收下信息" };
  }
  if (tx.amount < 0) {
    return { accept: false, reasoning: "金额异常" };
  }
  return { accept: true, reasoning: "白给的财富没有理由拒绝" };
}

const COMMUNITY_NAMES = [
  "光阴合作社",
  "复利小镇",
  "长期主义者联盟",
  "风险与玫瑰",
  "第八轮之后",
  "决策者社区",
];

export function chooseCommunityName(game: GameState, ai: Player): string {
  return deterministicPick(COMMUNITY_NAMES, `${ai.id}:name:${game.globalRound}`) ?? "光阴社区";
}

/** 组装一份完整的启发式方案。 */
export function buildFallbackInvestmentPlan(
  game: GameState,
  ai: Player,
  profile: AiProfile = profileForPlayer(ai)
): AiInvestmentPlan {
  const coffee = chooseCoffee(game, ai, profile);
  const budget = spendableEnergy(ai) + coffee * COFFEE_ENERGY_GAIN;
  const investment = chooseInvestment(game, ai, profile, budget);
  // 做空不要选自己本轮要投的项目
  const ownProjects = new Set(Object.keys(investment).map(Number));
  const useCard = chooseBuff(game, ai, profile, ownProjects);
  const transfer = chooseTransfer(game, ai, profile);
  const messages = chooseChat(game, ai, profile);
  return {
    reasoning: `${profile.personaLabel}（${profile.difficulty}）本地策略：${coffee ? `买 ${coffee} 杯咖啡；` : ""}按 ROI 分配精力。`,
    messages,
    transfer,
    coffee,
    useCard,
    investment,
  };
}

/**
 * 裁剪模型或策略给出的方案，保证：
 * - 投资只用当前牌桌上的项目，且不超过精力预算；
 * - 长期投入遵守追加规则；
 * - 道具/转账目标合法；
 * - 咖啡不超过可用财富。
 */
export function sanitizeInvestmentPlan(
  game: GameState,
  ai: Player,
  raw: Partial<AiInvestmentPlan> | null | undefined,
  profile: AiProfile = profileForPlayer(ai)
): AiInvestmentPlan {
  const coffee = Math.max(
    0,
    Math.min(
      Math.floor(Number(raw?.coffee) || 0),
      Math.floor(playerAvailableWealth(game, ai) / COFFEE_WEALTH_COST),
      profile.difficulty === "easy" ? 0 : 2
    )
  );
  const budget = spendableEnergy(ai) + coffee * COFFEE_ENERGY_GAIN;

  const investment: Record<number, number> = {};
  let remaining = budget;
  for (const [key, value] of Object.entries(raw?.investment ?? {})) {
    const id = Number(key);
    const amount = Math.floor(Number(value) || 0);
    if (!Number.isSafeInteger(id) || amount <= 0) continue;
    const project = game.activeProjects.find((p) => p.id === id);
    if (!project) continue;
    let take = Math.min(amount, remaining, headroom(project));
    if (project.type === "long") {
      take = Math.min(take, sanitizeLongContribution(ai.longTerm?.[project.id]?.status, take));
    }
    if (take <= 0) continue;
    investment[id] = (investment[id] ?? 0) + take;
    remaining -= take;
  }

  let useCard: AiBuffPlan | null = null;
  const rawCard = raw?.useCard;
  if (rawCard && typeof rawCard.cardId === "string" && (ai.inventory ?? []).includes(rawCard.cardId)) {
    const cardId = rawCard.cardId;
    const targetPlayerId =
      typeof rawCard.targetPlayerId === "string" &&
      game.players.some((p) => p.id === rawCard.targetPlayerId)
        ? rawCard.targetPlayerId
        : undefined;
    const targetProjectId =
      Number.isSafeInteger(Number(rawCard.targetProjectId)) &&
      game.activeProjects.some((p) => p.id === Number(rawCard.targetProjectId))
        ? Number(rawCard.targetProjectId)
        : undefined;
    const burnCardId =
      typeof rawCard.burnCardId === "string" ? rawCard.burnCardId : undefined;
    const valid =
      cardId !== "buff_force_buy" &&
      (["buff_gold", "buff_insurance", "buff_lottery"].includes(cardId) || !!targetPlayerId || !!targetProjectId) &&
      (cardId !== "buff_slack" || (!!targetPlayerId && targetPlayerId !== ai.id)) &&
      (cardId !== "buff_work_rest" || !!targetPlayerId) &&
      (cardId !== "buff_short" || !!targetProjectId) &&
      (cardId !== "buff_lighter" || (!!targetPlayerId && !!burnCardId && targetPlayerId !== ai.id));
    useCard = valid
      ? { cardId, ...(targetPlayerId ? { targetPlayerId } : {}), ...(targetProjectId ? { targetProjectId } : {}), ...(burnCardId ? { burnCardId } : {}) }
      : null;
  }

  let transfer: AiTransferPlan | null = null;
  const rawTx = raw?.transfer;
  if (rawTx && typeof rawTx.toPlayerId === "string") {
    const target = game.players.find((p) => p.id === rawTx.toPlayerId);
    const amount = Math.floor(Number(rawTx.amount) || 0);
    if (
      target &&
      target.id !== ai.id &&
      amount > 0 &&
      amount <= playerAvailableWealth(game, ai)
    ) {
      transfer = {
        toPlayerId: target.id,
        amount,
        note: String(rawTx.note ?? "").slice(0, 60),
      };
    }
  }

  const messages = (Array.isArray(raw?.messages) ? raw.messages : [])
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 2);

  return {
    reasoning:
      typeof raw?.reasoning === "string" ? raw.reasoning.slice(0, 600) : "",
    messages: AI_CONFIG.chatEnabled && GROUP_CHAT_ENABLED ? messages : [],
    transfer,
    coffee,
    useCard,
    investment,
  };
}
