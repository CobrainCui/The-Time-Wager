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
  /** 关闭推理链（DeepSeek v4 thinking 开关）；默认取 AI_CONFIG.disableThinking */
  disableThinking?: boolean;
  /** 推理强度提示（开启思考且 DeepSeek 时透传 reasoning_effort: low / medium） */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
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
    reasoningEffort?: AiLlmOptions["reasoningEffort"];
  }
): Promise<{ raw: string; usage?: AiLlmUsage }> {
  const startedAt = Date.now();
  const isDeepSeek = /deepseek/i.test(`${cfg.provider} ${cfg.model}`);
  // thinking 是 DeepSeek v4 系列的扩展字段，OpenAI SDK 类型里没有；用断言透传。
  // 只在 DeepSeek 供应商上发送，避免 OpenAI 等接口因未知字段直接 400。
  const useNoThinking = options.disableThinking && isDeepSeek;
  // DeepSeek 开启思考链时使用流式接收，防止长推理期间静默连接被网关/undici 断开（terminated）。
  const useStreaming = isDeepSeek && !options.disableThinking;

  const baseBody = {
    model: cfg.model,
    temperature: AI_CONFIG.temperature,
    max_tokens: options.maxOutputTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(options.useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    ...(useNoThinking ? { thinking: { type: "disabled" as const } } : {}),
    ...(!options.disableThinking && isDeepSeek && options.reasoningEffort
      ? { reasoning_effort: options.reasoningEffort }
      : {}),
  };

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timeout ${options.timeoutMs}ms`));
    }, options.timeoutMs + 500);
  });

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
        const piece = chunk.choices?.[0]?.delta?.content ?? "";
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
      if (timer) clearTimeout(timer);
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
    if (timer) clearTimeout(timer);
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
  // 防止线上 .env 遗留极小 AI_DECISION_TIMEOUT_MS / AI_MAX_OUTPUT_TOKENS 导致 DeepSeek 推理中途超时或截断
  const timeoutMs =
    !disableThinking && isDeepSeek ? Math.max(requestedTimeoutMs, 65_000) : requestedTimeoutMs;
  const maxOutputTokens =
    !disableThinking && isDeepSeek ? Math.max(requestedMaxTokens, 16_000) : requestedMaxTokens;
  const reasoningEffort = options.reasoningEffort;
  const label = options.label ?? "decision";
  const errors: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const useJsonMode = attempt === 0;
    try {
      const { raw, usage } = await requestOnce(cfg, system, user, {
        timeoutMs,
        maxOutputTokens,
        useJsonMode,
        disableThinking,
        reasoningEffort,
      });
      const data = parseJson(raw);
      if (data == null) {
        errors.push(`attempt ${attempt + 1}: JSON 解析失败`);
        if (attempt < maxRetries) await sleep(300 * (attempt + 1));
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
