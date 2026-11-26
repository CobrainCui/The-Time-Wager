/**
 * 产品级 AI 玩家配置。
 *
 * 设计原则：
 * - 所有 Key 只在服务端读取，绝不下发给客户端。
 * - 严格模式（默认）下，AI 必须全程由模型决策；未配置/未连通模型时拒绝添加与开局，不退回本地启发式策略。
 * - 单次决策有硬超时；超过宽限时间由看门狗强制 ready。
 */
import {
  DEFAULT_LAB_SIX_SEAT_MODELS,
  SILICONFLOW_ALL_MODEL_IDS,
  SILICONFLOW_DEFAULT_BASE_URL,
  SILICONFLOW_MODEL_GROUPS,
  SILICONFLOW_PLACEHOLDER_KEY,
} from "../lab/siliconflowModels.js";

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
    k === SILICONFLOW_PLACEHOLDER_KEY ||
    k.includes("siliconflow-placeholder") ||
    k.includes("placeholder") ||
    k.includes("your_api_key") ||
    k.includes("your-key") ||
    k === "sk-xxx" ||
    k === "changeme"
  );
}

const LEGACY_UNVERIFIED_LAB_MODELS = new Set([
  "Qwen/Qwen3.5-397B-A17B",
  "zai-org/GLM-5.3-Flash",
  "moonshotai/Kimi-K3.1-Pro",
  "moonshotai/Kimi-K3",
  "MiniMaxAI/MiniMax-M3.1-Flash",
  "MiniMaxAI/MiniMax-M3",
  "stepfun-ai/Step-3.5-Flash",
  "stepfun-ai/step3",
  "tencent/Hy3",
]);

function isLegacyUnverifiedModel(model?: string): boolean {
  const trimmed = (model ?? "").trim();
  return Boolean(trimmed && LEGACY_UNVERIFIED_LAB_MODELS.has(trimmed));
}

function sanitizeSiliconFlowModel(model?: string): string | undefined {
  const trimmed = (model ?? "").trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "gpt-4o" || isLegacyUnverifiedModel(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * 共享模型配置优先级：
 *   AI_API_KEY / AI_BASE_URL / AI_MODEL
 *   → SILICONFLOW_API_KEY / SILICONFLOW_BASE_URL / SILICONFLOW_MODEL
 *   → OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
 *   → DEEPSEEK_API_KEY（无 AI/SILICONFLOW/OPENAI Key 时）
 */
function resolveSharedModelConfig(): AiModelConfig | null {
  const explicitKey = firstNonEmpty(process.env.AI_API_KEY);
  const siliconflowKey = firstNonEmpty(process.env.SILICONFLOW_API_KEY);
  const openaiKey = firstNonEmpty(process.env.OPENAI_API_KEY);
  const deepseekKey = firstNonEmpty(process.env.DEEPSEEK_API_KEY, process.env.RULE_AGENT_API_KEY);

  if (explicitKey && !isPlaceholderKey(explicitKey)) {
    const rawBaseUrl =
      firstNonEmpty(process.env.AI_BASE_URL, process.env.SILICONFLOW_BASE_URL, process.env.OPENAI_BASE_URL) ||
      undefined;
    const rawProvider = firstNonEmpty(process.env.AI_PROVIDER);
    const looksSiliconFlow =
      rawProvider.toLowerCase() === "siliconflow" ||
      (rawBaseUrl ?? "").toLowerCase().includes("siliconflow");
    return {
      apiKey: explicitKey,
      baseURL: rawBaseUrl || (looksSiliconFlow ? SILICONFLOW_DEFAULT_BASE_URL : undefined),
      model: looksSiliconFlow
        ? firstNonEmpty(
            sanitizeSiliconFlowModel(process.env.AI_MODEL),
            sanitizeSiliconFlowModel(process.env.SILICONFLOW_MODEL),
            DEFAULT_LAB_SIX_SEAT_MODELS[0]
          )
        : firstNonEmpty(
            process.env.AI_MODEL,
            process.env.SILICONFLOW_MODEL,
            process.env.OPENAI_MODEL,
            "gpt-4o"
          ),
      provider: rawProvider || (looksSiliconFlow ? "siliconflow" : "custom"),
      source: "shared",
    };
  }

  if (siliconflowKey && !isPlaceholderKey(siliconflowKey)) {
    return {
      apiKey: siliconflowKey,
      baseURL:
        firstNonEmpty(process.env.SILICONFLOW_BASE_URL, process.env.AI_BASE_URL, SILICONFLOW_DEFAULT_BASE_URL) ||
        SILICONFLOW_DEFAULT_BASE_URL,
      model: firstNonEmpty(
        sanitizeSiliconFlowModel(process.env.SILICONFLOW_MODEL),
        sanitizeSiliconFlowModel(process.env.AI_MODEL),
        DEFAULT_LAB_SIX_SEAT_MODELS[0]
      ),
      provider: firstNonEmpty(process.env.AI_PROVIDER, "siliconflow"),
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
      model: firstNonEmpty(process.env.AI_MODEL, process.env.DEEPSEEK_MODEL, "deepseek-v4-pro"),
      provider: "deepseek",
      source: "shared",
    };
  }

  return null;
}

/** 6AI 实验室 1～6 号座位默认模型列表（优先读取 LAB_PLAYER_<1..6>_MODEL，旧占位预设自动回退为实测可用国产阵容）。 */
export function resolveLabDefaultSeatModels(): string[] {
  return DEFAULT_LAB_SIX_SEAT_MODELS.map((fallback, idx) => {
    const envVal = firstNonEmpty(process.env[`LAB_PLAYER_${idx + 1}_MODEL`]);
    if (envVal && !LEGACY_UNVERIFIED_LAB_MODELS.has(envVal)) {
      return envVal;
    }
    return fallback;
  });
}

/** 产品版 1～5 号 AI 座位默认模型列表（优先读取 AI_PLAYER_<1..5>_MODEL，自动过滤未验证旧模型并沿用实验室实测可用阵容）。 */
export function resolveProductDefaultSeatModels(): string[] {
  return resolveLabDefaultSeatModels()
    .slice(0, MAX_AI_PLAYER_SLOTS)
    .map((fallback, idx) => {
      const envVal = sanitizeSiliconFlowModel(process.env[`AI_PLAYER_${idx + 1}_MODEL`]);
      return envVal || fallback;
    });
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
    const isSlotSiliconFlow =
      /siliconflow/i.test(slotProvider || shared?.provider || "") ||
      /siliconflow\./i.test(slotBaseURL || shared?.baseURL || "");
    const resolvedSlotModel = isSlotSiliconFlow
      ? sanitizeSiliconFlowModel(slotModel) || shared?.model || DEFAULT_LAB_SIX_SEAT_MODELS[0]
      : slotModel || shared?.model || "gpt-4o";
    return {
      apiKey: slotKey,
      baseURL: slotBaseURL || shared?.baseURL,
      model: resolvedSlotModel,
      provider: slotProvider || shared?.provider || "custom",
      source: `player-${normalizedSlot}`,
      slot: normalizedSlot,
    };
  }

  if (!shared) return null;
  const sharedIsSiliconFlow =
    /siliconflow/i.test(slotProvider || shared.provider) ||
    /siliconflow\./i.test(slotBaseURL || shared.baseURL || "");
  const effectiveSlotModel = sharedIsSiliconFlow ? sanitizeSiliconFlowModel(slotModel) : slotModel;
  if (!slotBaseURL && !effectiveSlotModel && !slotProvider) return shared;

  // 座位只覆盖了模型/地址/供应商标识时，沿用共享 Key。
  return {
    ...shared,
    baseURL: slotBaseURL || shared.baseURL,
    model: effectiveSlotModel || shared.model,
    provider: slotProvider || shared.provider,
    source: `player-${normalizedSlot}`,
    slot: normalizedSlot,
  };
}

/** 共享配置（不区分座位）；保留旧调用。 */
export function resolveAiModelConfig(): AiModelConfig | null {
  return resolveSharedModelConfig();
}

/**
 * 解析具体某名 AI 玩家的模型配置（支持管理员在网页端逐座切换 `aiModelOverride`）。
 */
export function resolveAiModelConfigForPlayer(ai: {
  aiSlot?: number;
  aiModelOverride?: string;
}): AiModelConfig | null {
  const base = resolveAiModelConfigForSlot(ai.aiSlot);
  if (!base) return null;
  const override = ai.aiModelOverride?.trim();
  if (!override) return base;
  return {
    ...base,
    model: override,
  };
}

/** 供产品版管理后台下拉选模型与测速使用（绝不含任何密钥）。 */
export function getProductAiModelCatalog() {
  const shared = resolveSharedModelConfig();
  const defaultSeatModels = resolveProductDefaultSeatModels();
  const isSiliconFlow = Boolean(
    shared &&
      (/siliconflow/i.test(shared.provider) ||
        /siliconflow\./i.test(shared.baseURL ?? ""))
  );
  const suggested = new Set<string>(SILICONFLOW_ALL_MODEL_IDS);
  if (shared?.model) suggested.add(shared.model);
  for (let slot = 1; slot <= MAX_AI_PLAYER_SLOTS; slot++) {
    const slotCfg = resolveAiModelConfigForSlot(slot);
    if (slotCfg?.model) suggested.add(slotCfg.model);
  }
  for (const m of defaultSeatModels) suggested.add(m);

  return {
    keyConfigured: shared !== null,
    provider: shared?.provider ?? "未配置",
    isSiliconFlow,
    defaultModel: shared?.model ?? defaultSeatModels[0],
    defaultSeatModels,
    modelPoolGroups: SILICONFLOW_MODEL_GROUPS,
    suggestedModels: Array.from(suggested),
    defaultTokenBudgetPerGame: AI_CONFIG.tokenBudgetPerGame,
  };
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
  preflightTimeoutMs: envInt("AI_PREFLIGHT_TIMEOUT_MS", 20_000, 2_000),
  /** 连通性检测成功缓存时长；避免每次开局都重复消耗 token */
  preflightCacheMs: envInt("AI_PREFLIGHT_CACHE_MS", 5 * 60_000, 10_000),
  /** 连续失败达到该次数后停止自动重试，等待管理员处理 */
  maxConsecutiveFailures: envInt("AI_MAX_CONSECUTIVE_FAILURES", 2, 1),
  /** 采样温度；产品默认 0.7，实验版请用 agent-edition 的统一温度 */
  temperature: envNumber("AI_TEMPERATURE", 0.7, 0),
  /**
   * 推理链开关（DeepSeek v4 系列支持 thinking 开关）。
   * 默认开启适度思考，让 AI 在复杂博弈/投资/竞拍时充分推算；需要极速模式时可设 AI_DISABLE_THINKING=true。
   */
  disableThinking: envBool("AI_DISABLE_THINKING", false),
  /** 单次模型调用超时 */
  decisionTimeoutMs: envInt("AI_DECISION_TIMEOUT_MS", 35_000, 1_000),
  /** 允许模型重试次数（不含首次） */
  maxRetries: envInt("AI_MAX_RETRIES", 2, 0),
  /**
   * 单次输出上限。
   * 推理模型（如 deepseek-flash）的思维链同样计入 completion_tokens，
   * 实测单次可到 1.8 万；上限过低会把 JSON 截断，默认给足余量。
   */
  maxOutputTokens: envInt("AI_MAX_OUTPUT_TOKENS", 32_000, 100),
  /** 每名 AI 每局 token 上限；0 表示不限制（旧 .env 遗留 1..999,999 小预算时自动视为不限，避免半局中断） */
  tokenBudgetPerGame: (() => {
    const raw = envInt("AI_TOKEN_BUDGET_PER_GAME", 0, 0);
    return raw > 0 && raw < 1_000_000 ? 0 : raw;
  })(),
  /**
   * 看门狗宽限：阶段开始后多久仍未 ready，才判定「模型没响应」。
   * 这只是下限；实际看门狗还会给正在进行中的调用留足「单次超时 ×（重试数 + 1）」的预算，
   * 不会在模型正常重试途中误判超时。
   */
  maxTurnMs: envInt("AI_MAX_TURN_MS", 60_000, 2_000),
  /** 同一房间同时进行的模型调用数（至少 5，确保 5 个 AI 单波次并行思考） */
  maxConcurrentPerRoom: envInt("AI_MAX_CONCURRENT", 5, 5),
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
  /** 私信拟人延迟与防抖窗口 */
  dmDebounceMs: envInt("AI_DM_DEBOUNCE_MS", 1_400, 0),
  dmDelayMinMs: envInt("AI_DM_DELAY_MIN_MS", 3_000, 0),
  dmDelayMaxMs: envInt("AI_DM_DELAY_MAX_MS", 5_500, 0),
  /** 群聊/全场发言拟人延迟与防抖窗口 */
  groupDebounceMs: envInt("AI_GROUP_DEBOUNCE_MS", 1_600, 0),
  groupChatDelayMinMs: envInt("AI_GROUP_CHAT_DELAY_MIN_MS", 2_500, 0),
  groupChatDelayMaxMs: envInt("AI_GROUP_CHAT_DELAY_MAX_MS", 5_500, 0),
  /** 收到转账后的拟人思考延迟（避免秒收） */
  transferDelayMinMs: envInt("AI_TRANSFER_DELAY_MIN_MS", 3_000, 0),
  transferDelayMaxMs: envInt("AI_TRANSFER_DELAY_MAX_MS", 5_000, 0),
  /** 拍卖出价节拍延迟（错峰避免同时抢最低价） */
  auctionDelayMinMs: envInt("AI_AUCTION_DELAY_MIN_MS", 250, 0),
  auctionDelayMaxMs: envInt("AI_AUCTION_DELAY_MAX_MS", 600, 0),
  /** 拍卖单张卡最多决策次数 */
  auctionMaxDecisions: envInt("AI_AUCTION_MAX_DECISIONS", 3, 1),
  /** AI 自动补位目标人数 */
  autoFillTarget: envInt("AI_AUTOFILL_TARGET", 6, 2),
  /** 投资阶段有未锁定真人时的开场谈判窗口（ms；0 关闭） */
  get investOpeningWindowMs(): number {
    return envInt("AI_INVEST_OPENING_WINDOW_MS", 12_000, 0);
  },
  /** 多名 AI 谈判结束后的错峰锁定最大延迟（ms） */
  get investStaggerMaxMs(): number {
    return envInt("AI_INVEST_STAGGER_MAX_MS", 4_500, 0);
  },
  /** 投资阶段开场是否允许 AI 主动冒泡一句话 */
  get openingChatEnabled(): boolean {
    return envBool("AI_OPENING_CHAT_ENABLED", true);
  },
  /** 日志级别：quiet 只记错误 */
  verboseLogging: envBool("AI_VERBOSE_LOG", false),
} as const;
