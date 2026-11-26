import OpenAI from "openai";
import {
  AI_CONFIG,
  isAiModelConfigured,
  resolveAiModelConfig,
  type AiModelConfig,
} from "./aiConfig.js";

/**
 * 产品级模型调用封装。
 *
 * - Key 只在服务端读取，日志与错误信息里不出现 Key。
 * - 每次调用带硬超时；失败返回 null，由上层退回启发式策略。
 * - 不抛异常给玩家流程：AI 出错最多是「这轮打得普通」，不会让房间卡住。
 */

let client: OpenAI | null = null;
let clientSignature = "";

function getClient(cfg: AiModelConfig): OpenAI {
  // Key 参与签名（只在内存里比较）：不同座位即使前缀/长度相同，也不会复用错客户端。
  const signature = `${cfg.baseURL ?? "default"}|${cfg.apiKey}`;
  if (!client || signature !== clientSignature) {
    client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      maxRetries: 0,
    });
    clientSignature = signature;
  }
  return client;
}

export interface AiLlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiLlmResult {
  ok: boolean;
  data: unknown | null;
  raw: string;
  usage?: AiLlmUsage;
  latencyMs: number;
  error?: string;
}

export interface AiLlmOptions {
  timeoutMs?: number;
  maxRetries?: number;
  maxOutputTokens?: number;
  /** 指定模型配置（按 AI 座位）；不传则使用共享配置 */
  config?: AiModelConfig | null;
  /** 用于日志；不要包含敏感信息 */
  label?: string;
  /** 关闭推理链（DeepSeek v4 thinking / SiliconFlow enable_thinking）；默认取 AI_CONFIG.disableThinking */
  disableThinking?: boolean;
  /** 推理预算（SiliconFlow thinking_budget，范围 128..32768） */
  thinkingBudget?: number;
  /** 推理强度提示（开启思考且非 SiliconFlow DeepSeek 时透传 reasoning_effort: low / medium） */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** 外部取消信号（例如实验室单拍硬截止） */
  signal?: AbortSignal;
}

/**
 * 判断配置是否指向硅基流动（SiliconFlow）或托管于其上的国产模型。
 */
export function isSiliconFlowConfig(cfg: AiModelConfig): boolean {
  return (
    /siliconflow/i.test(cfg.provider) ||
    /siliconflow\./i.test(cfg.baseURL ?? "") ||
    /^(?:Pro\/)?(?:deepseek-ai|Qwen|zai-org|THUDM|moonshotai|MiniMaxAI|stepfun-ai|tencent)\//i.test(
      cfg.model
    )
  );
}

/**
 * 判断模型是否属于推理 / 思考链模型（开启思考时需流式保活，避免长推理断连）。
 */
export function isReasoningModel(cfg: AiModelConfig): boolean {
  return /deepseek|qwen3|qwq|glm-z1|glm-4\.5|glm-5|kimi-k2|kimi-k3|minimax-m|step-?3|hy[34]|hunyuan-a13b/i.test(
    cfg.model
  );
}

function stripJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
    } else if (ch === '"') {
      out += ch;
      inString = false;
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else {
      out += ch;
    }
  }
  return out;
}

function parseJson(text: string): unknown | null {
  const base = stripJsonFence(text);
  const noTrailingCommas = base.replace(/,\s*([}\]])/g, "$1");
  const candidates = [
    base,
    escapeControlCharsInStrings(base),
    noTrailingCommas,
    escapeControlCharsInStrings(noTrailingCommas),
    base.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // 推理模型偶发「只返回思维链、content 为空」或长思考期间 TCP 被对端断开（terminated）；必须重试。
  return /timeout|timed out|terminated|hang up|socket|aborted|ECONNABORTED|EPIPE|429|500|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed|network|empty response/i.test(
    message
  );
}

function isThinkingParamBadRequest(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 400) return true;
  return /\b400\b|invalid.*param|unknown.*field|extra_forbidden|unrecognized|thinking_budget|enable_thinking/i.test(
    message
  );
}

/** 只保留用户可读的错误摘要，避免把请求体/Key 写进日志。 */
function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 240);
}

async function requestOnce(
  cfg: AiModelConfig,
  system: string,
  user: string,
  options: Required<Pick<AiLlmOptions, "timeoutMs" | "maxOutputTokens">> & {
    useJsonMode: boolean;
    disableThinking: boolean;
    thinkingBudget?: number;
    reasoningEffort?: AiLlmOptions["reasoningEffort"];
    omitSiliconFlowThinkingParams?: boolean;
    externalSignal?: AbortSignal;
  }
): Promise<{ raw: string; usage?: AiLlmUsage }> {
  const startedAt = Date.now();
  if (options.externalSignal?.aborted) {
    throw new Error("aborted");
  }
  const isDeepSeek = /deepseek/i.test(`${cfg.provider} ${cfg.model}`);
  const isSiliconFlow = isSiliconFlowConfig(cfg);
  const isReasoning = isReasoningModel(cfg);
  // 开启思考链时使用流式接收，防止长推理期间静默连接被网关/undici 断开（terminated）。
  const useStreaming = !options.disableThinking && (isDeepSeek || isSiliconFlow || isReasoning);

  const clampedBudget =
    options.thinkingBudget != null
      ? Math.min(32_768, Math.max(128, Math.floor(options.thinkingBudget)))
      : undefined;

  const thinkingBody: Record<string, unknown> = {};
  if (isSiliconFlow) {
    if (!options.omitSiliconFlowThinkingParams) {
      if (options.disableThinking) {
        thinkingBody.enable_thinking = false;
      } else if (clampedBudget != null) {
        thinkingBody.enable_thinking = true;
        thinkingBody.thinking_budget = clampedBudget;
      }
    }
  } else if (isDeepSeek) {
    if (options.disableThinking) {
      thinkingBody.thinking = { type: "disabled" as const };
    } else if (options.reasoningEffort) {
      thinkingBody.reasoning_effort = options.reasoningEffort;
    }
  }

  const baseBody = {
    model: cfg.model,
    temperature: AI_CONFIG.temperature,
    max_tokens: options.maxOutputTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(options.useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...thinkingBody,
  };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onExternalAbort: (() => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout ${options.timeoutMs}ms`));
    }, options.timeoutMs + 500);
    if (options.externalSignal) {
      onExternalAbort = () => {
        controller.abort();
        reject(new Error("aborted"));
      };
      options.externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  });

  const cleanupHooks = () => {
    if (timer) clearTimeout(timer);
    if (options.externalSignal && onExternalAbort) {
      options.externalSignal.removeEventListener("abort", onExternalAbort);
    }
  };

  if (useStreaming) {
    const consumeStream = async (): Promise<{ raw: string; usage?: AiLlmUsage }> => {
      const stream = (await getClient(cfg).chat.completions.create(
        {
          ...baseBody,
          stream: true,
          stream_options: { include_usage: true },
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { timeout: options.timeoutMs, signal: controller.signal }
      )) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
      let raw = "";
      let usage: AiLlmUsage | undefined;
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        // 读取 reasoning_content 以确保长推理流在传输期保持活跃，不拼入最终 JSON。
        const reasoningPiece = delta?.reasoning_content ?? "";
        void reasoningPiece;
        const piece = delta?.content ?? "";
        if (piece) raw += piece;
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens: chunk.usage.total_tokens ?? 0,
          };
        }
      }
      if (!raw.trim()) throw new Error("empty response");
      return { raw, usage };
    };
    try {
      return await Promise.race([consumeStream(), timeout]);
    } finally {
      cleanupHooks();
    }
  }

  const request = getClient(cfg).chat.completions.create(
    baseBody as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    { timeout: options.timeoutMs, signal: controller.signal }
  );

  let response: OpenAI.Chat.ChatCompletion;
  try {
    response = (await Promise.race([request, timeout])) as OpenAI.Chat.ChatCompletion;
  } finally {
    cleanupHooks();
  }

  const raw = response.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("empty response");
  const usage = response.usage
    ? {
        promptTokens: response.usage.prompt_tokens ?? 0,
        completionTokens: response.usage.completion_tokens ?? 0,
        totalTokens: response.usage.total_tokens ?? 0,
      }
    : undefined;
  // latencyMs 由调用方用总耗时记录；这里不返回，避免误解
  void startedAt;
  return { raw, usage };
}

/**
 * 请求一个 JSON 对象。失败返回 ok=false，不抛出。
 */
export async function askAiJson(
  system: string,
  user: string,
  options: AiLlmOptions = {}
): Promise<AiLlmResult> {
  const startedAt = Date.now();
  const cfg = options.config !== undefined ? options.config : resolveAiModelConfig();
  if (!cfg) {
    return {
      ok: false,
      data: null,
      raw: "",
      latencyMs: 0,
      error: "AI 模型未配置",
    };
  }

  const requestedTimeoutMs = options.timeoutMs ?? AI_CONFIG.decisionTimeoutMs;
  const maxRetries = options.maxRetries ?? AI_CONFIG.maxRetries;
  const disableThinking = options.disableThinking ?? AI_CONFIG.disableThinking;
  const requestedMaxTokens = options.maxOutputTokens ?? AI_CONFIG.maxOutputTokens;
  const isDeepSeek = /deepseek/i.test(`${cfg.provider} ${cfg.model}`);
  const isSiliconFlow = isSiliconFlowConfig(cfg);
  // 调用方显式传入 timeoutMs 时严格尊重其紧预算（如实验室单拍/单轮限额），仅在未指定时为原生 DeepSeek 兜底。
  const timeoutMs =
    options.timeoutMs == null && !disableThinking && isDeepSeek && !isSiliconFlow
      ? Math.max(requestedTimeoutMs, 65_000)
      : requestedTimeoutMs;
  const clampedThinkingBudget =
    options.thinkingBudget != null
      ? Math.min(32_768, Math.max(128, Math.floor(options.thinkingBudget)))
      : undefined;
  const maxOutputTokens =
    !disableThinking && clampedThinkingBudget != null
      ? Math.max(requestedMaxTokens, clampedThinkingBudget + 500)
      : options.maxOutputTokens == null && !disableThinking && isDeepSeek && !isSiliconFlow
        ? Math.max(requestedMaxTokens, 16_000)
        : requestedMaxTokens;
  const reasoningEffort = options.reasoningEffort;
  const label = options.label ?? "decision";
  const errors: string[] = [];
  let omitSiliconFlowThinkingParams = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      errors.push("aborted");
      break;
    }
    const useJsonMode = attempt === 0;
    try {
      const { raw, usage } = await requestOnce(cfg, system, user, {
        timeoutMs,
        maxOutputTokens,
        useJsonMode,
        disableThinking,
        thinkingBudget: clampedThinkingBudget,
        reasoningEffort,
        omitSiliconFlowThinkingParams,
        externalSignal: options.signal,
      });
      const data = parseJson(raw);
      if (data == null) {
        errors.push(`attempt ${attempt + 1}: JSON 解析失败`);
        if (attempt < maxRetries && !options.signal?.aborted) await sleep(300 * (attempt + 1));
        continue;
      }
      return {
        ok: true,
        data,
        raw,
        usage,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = safeErrorMessage(error);
      errors.push(`attempt ${attempt + 1}: ${message}`);
      if (options.signal?.aborted) {
        break;
      }
      // SiliconFlow 个别模型不支持 enable_thinking/thinking_budget 时，自动去掉这两个参数立即重试一次。
      if (isSiliconFlow && !omitSiliconFlowThinkingParams && isThinkingParamBadRequest(error)) {
        omitSiliconFlowThinkingParams = true;
        attempt -= 1;
        continue;
      }
      if (attempt < maxRetries && isRetryable(error)) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    data: null,
    raw: "",
    latencyMs: Date.now() - startedAt,
    error: `${label}: ${errors.join(" | ")}`,
  };
}

/**
 * 兼容旧调用：返回解析后的数据，失败返回 null。
 * 产品流程请优先使用 askAiJson 以拿到 usage / latency。
 */
export async function askLLM(systemPrompt: string, userPrompt: string): Promise<any> {
  const result = await askAiJson(systemPrompt, userPrompt, { label: "legacy" });
  return result.ok ? result.data : null;
}

export { isAiModelConfigured, resolveAiModelConfig };
