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
  const signature = `${cfg.baseURL ?? "default"}|${cfg.apiKey.slice(0, 6)}|${cfg.apiKey.length}`;
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
  /** 用于日志；不要包含敏感信息 */
  label?: string;
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

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(stripJsonFence(text));
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|429|500|502|503|504|ECONNRESET|ETIMEDOUT|fetch failed|network/i.test(
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
  options: Required<Pick<AiLlmOptions, "timeoutMs" | "maxOutputTokens">> & { useJsonMode: boolean }
): Promise<{ raw: string; usage?: AiLlmUsage }> {
  const startedAt = Date.now();
  const request = getClient(cfg).chat.completions.create(
    {
      model: cfg.model,
      temperature: AI_CONFIG.temperature,
      max_tokens: options.maxOutputTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(options.useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
    },
    { timeout: options.timeoutMs }
  );

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout ${options.timeoutMs}ms`)),
      options.timeoutMs + 500
    );
  });

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
  const cfg = resolveAiModelConfig();
  if (!cfg) {
    return {
      ok: false,
      data: null,
      raw: "",
      latencyMs: 0,
      error: "AI 模型未配置",
    };
  }

  const timeoutMs = options.timeoutMs ?? AI_CONFIG.decisionTimeoutMs;
  const maxRetries = options.maxRetries ?? AI_CONFIG.maxRetries;
  const maxOutputTokens = options.maxOutputTokens ?? AI_CONFIG.maxOutputTokens;
  const label = options.label ?? "decision";
  const errors: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const useJsonMode = attempt === 0;
    try {
      const { raw, usage } = await requestOnce(cfg, system, user, {
        timeoutMs,
        maxOutputTokens,
        useJsonMode,
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
