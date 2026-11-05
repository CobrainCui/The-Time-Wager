/**
 * 产品级 AI 玩家配置。
 *
 * 设计原则：
 * - 所有 Key 只在服务端读取，绝不下发给客户端。
 * - 严格模式（默认）下，AI 必须全程由模型决策；未配置/未连通模型时拒绝添加与开局，不退回本地启发式策略。
 * - 单次决策有硬超时；超过宽限时间由看门狗强制 ready。
 */

function envBool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function envInt(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.trunc(n));
}

function envNumber(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

export interface AiModelConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  /** 供应商标识，仅用于日志与导出 */
  provider: string;
  /** 配置来源：shared / player-1..5；仅用于管理端展示，不含 Key */
  source: string;
  /** 该配置对应的 AI 座位号（1..5）；共享配置时为空 */
  slot?: number;
}

/** 产品版最多 5 个 AI 座位，与 AI_MAX_PER_ROOM 的默认值一致。 */
export const MAX_AI_PLAYER_SLOTS = 5;

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    const s = (v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function isPlaceholderKey(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return true;
  return (
    k.includes("placeholder") ||
    k.includes("your_api_key") ||
    k.includes("your-key") ||
    k === "sk-xxx" ||
    k === "changeme"
  );
}

/**
 * 共享模型配置优先级：
 *   AI_API_KEY / AI_BASE_URL / AI_MODEL
 *   → OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
 *   → DEEPSEEK_API_KEY（无 AI/OPENAI Key 时）
 */
function resolveSharedModelConfig(): AiModelConfig | null {
  const explicitKey = firstNonEmpty(process.env.AI_API_KEY);
  const openaiKey = firstNonEmpty(process.env.OPENAI_API_KEY);
  const deepseekKey = firstNonEmpty(process.env.DEEPSEEK_API_KEY, process.env.RULE_AGENT_API_KEY);

  if (explicitKey && !isPlaceholderKey(explicitKey)) {
    return {
      apiKey: explicitKey,
      baseURL: firstNonEmpty(process.env.AI_BASE_URL, process.env.OPENAI_BASE_URL) || undefined,
      model: firstNonEmpty(process.env.AI_MODEL, process.env.OPENAI_MODEL, "gpt-4o"),
      provider: firstNonEmpty(process.env.AI_PROVIDER, "custom"),
      source: "shared",
    };
  }

  if (openaiKey && !isPlaceholderKey(openaiKey)) {
    return {
      apiKey: openaiKey,
      baseURL: firstNonEmpty(process.env.OPENAI_BASE_URL) || undefined,
      model: firstNonEmpty(process.env.AI_MODEL, process.env.OPENAI_MODEL, "gpt-4o"),
      provider: "openai",
      source: "shared",
    };
  }

  if (deepseekKey && !isPlaceholderKey(deepseekKey)) {
    return {
      apiKey: deepseekKey,
      baseURL:
        firstNonEmpty(process.env.AI_BASE_URL, process.env.DEEPSEEK_BASE_URL, "https://api.deepseek.com") ||
        undefined,
      model: firstNonEmpty(process.env.AI_MODEL, process.env.DEEPSEEK_MODEL, "deepseek-chat"),
      provider: "deepseek",
      source: "shared",
    };
  }

  return null;
}

function slotEnv(slot: number, field: string): string {
  return firstNonEmpty(process.env[`AI_PLAYER_${slot}_${field}`]);
}

/**
 * 解析指定 AI 座位的模型配置。
 *
 * 每个座位可用 `AI_PLAYER_<n>_API_KEY / _BASE_URL / _MODEL / _PROVIDER` 独立配置
 * （n = 1..5，对应添加 AI 的顺序）。座位未填 Key 时回退到共享配置；
 * 只填 `AI_PLAYER_<n>_MODEL` 可以在共享 Key 上换模型。
 *
 * 这样研究者可以给 5 个 AI 分别接不同供应商/模型，同时保留「不填 Key 也能跑」的降级能力。
 */
export function resolveAiModelConfigForSlot(slot?: number): AiModelConfig | null {
  const shared = resolveSharedModelConfig();
  const normalizedSlot =
    typeof slot === "number" && Number.isInteger(slot) && slot >= 1 && slot <= MAX_AI_PLAYER_SLOTS
      ? slot
      : undefined;
  if (!normalizedSlot) return shared;

  const slotKey = slotEnv(normalizedSlot, "API_KEY");
  const slotBaseURL = slotEnv(normalizedSlot, "BASE_URL");
  const slotModel = slotEnv(normalizedSlot, "MODEL");
  const slotProvider = slotEnv(normalizedSlot, "PROVIDER");

  if (slotKey && !isPlaceholderKey(slotKey)) {
    return {
      apiKey: slotKey,
      baseURL: slotBaseURL || shared?.baseURL,
      model: slotModel || shared?.model || "gpt-4o",
      provider: slotProvider || shared?.provider || "custom",
      source: `player-${normalizedSlot}`,
      slot: normalizedSlot,
    };
  }

  if (!shared) return null;
  if (!slotBaseURL && !slotModel && !slotProvider) return shared;

  // 座位只覆盖了模型/地址/供应商标识时，沿用共享 Key。
  return {
    ...shared,
    baseURL: slotBaseURL || shared.baseURL,
    model: slotModel || shared.model,
    provider: slotProvider || shared.provider,
    source: `player-${normalizedSlot}`,
    slot: normalizedSlot,
  };
}

/** 共享配置（不区分座位）；保留旧调用。 */
export function resolveAiModelConfig(): AiModelConfig | null {
  return resolveSharedModelConfig();
}

export function isAiModelConfigured(slot?: number): boolean {
  return resolveAiModelConfigForSlot(slot) !== null;
}

export const AI_CONFIG = {
  /**
   * 严格 Agent 模式（产品默认开启）：
   * - AI 必须全程由模型决策，不再用本地启发式策略兜底；
   * - 开局前必须通过模型连通性检测，否则拒绝开局；
   * - 运行中模型失败会暂停本局并通知管理端，由人工重试/移除/接管。
   * 只有明确接受「规则 AI」时才设为 false。
   * 用 getter 读取，便于测试按用例切换。
   */
  get strictAgent(): boolean {
    return envBool("AI_STRICT_AGENT", true);
  },
  /** 开局前单次连通性检测超时 */
  preflightTimeoutMs: envInt("AI_PREFLIGHT_TIMEOUT_MS", 12_000, 2_000),
  /** 连通性检测成功缓存时长；避免每次开局都重复消耗 token */
  preflightCacheMs: envInt("AI_PREFLIGHT_CACHE_MS", 5 * 60_000, 10_000),
  /** 连续失败达到该次数后停止自动重试，等待管理员处理 */
  maxConsecutiveFailures: envInt("AI_MAX_CONSECUTIVE_FAILURES", 2, 1),
  /** 采样温度；产品默认 0.7，实验版请用 agent-edition 的统一温度 */
  temperature: envNumber("AI_TEMPERATURE", 0.7, 0),
  /** 单次模型调用超时 */
  decisionTimeoutMs: envInt("AI_DECISION_TIMEOUT_MS", 8_000, 1_000),
  /** 允许模型重试次数（不含首次） */
  maxRetries: envInt("AI_MAX_RETRIES", 2, 0),
  /** 单次输出上限 */
  maxOutputTokens: envInt("AI_MAX_OUTPUT_TOKENS", 700, 100),
  /** 每名 AI 每局 token 上限；超出后本局只走启发式 */
  tokenBudgetPerGame: envInt("AI_TOKEN_BUDGET_PER_GAME", 120_000, 0),
  /** 看门狗：阶段开始后多久仍未 ready，强制用启发式落子 */
  maxTurnMs: envInt("AI_MAX_TURN_MS", 15_000, 2_000),
  /** 同一房间同时进行的模型调用数 */
  maxConcurrentPerRoom: envInt("AI_MAX_CONCURRENT", 3, 1),
  /** 房间 AI 上限（6 人局最多 5 个 AI，至少留 1 个真人） */
  maxAiPerRoom: envInt("AI_MAX_PER_ROOM", 5, 1),
  /** 是否允许 AI 公开发言 */
  chatEnabled: envBool("AI_CHAT_ENABLED", true),
  /** 是否允许 AI 主动转账 */
  transferEnabled: envBool("AI_TRANSFER_ENABLED", true),
  /** 是否允许 AI 买咖啡 */
  coffeeEnabled: envBool("AI_COFFEE_ENABLED", true),
  /** 是否允许 AI 使用道具 / 干扰 */
  buffEnabled: envBool("AI_BUFF_ENABLED", true),
  /** 拍卖 AI 是否启用 */
  auctionEnabled: envBool("AI_AUCTION_ENABLED", true),
  /** 行动前的拟人延迟 */
  actionDelayMinMs: envInt("AI_ACTION_DELAY_MIN_MS", 250, 0),
  actionDelayMaxMs: envInt("AI_ACTION_DELAY_MAX_MS", 900, 0),
  /** 拍卖单张卡最多决策次数 */
  auctionMaxDecisions: envInt("AI_AUCTION_MAX_DECISIONS", 3, 1),
  /** AI 自动补位目标人数 */
  autoFillTarget: envInt("AI_AUTOFILL_TARGET", 6, 2),
  /** 日志级别：quiet 只记错误 */
  verboseLogging: envBool("AI_VERBOSE_LOG", false),
} as const;
