/**
 * AI 开局前连通性检测（严格 Agent 模式）。
 *
 * 目的：不联网 / Key 失效 / 模型名错误时，**不允许开局**，
 * 而不是让 AI 在局内悄悄退回本地策略。
 *
 * 检测只发一条极短请求（个位数 token），成功后缓存一段时间，
 * 避免每次点击开局都重复消耗额度。
 */
import OpenAI from "openai";
import type { GameState, Player } from "../state/gameState.js";
import { isAiPlayer } from "../util/isAiPlayer.js";
import {
  AI_CONFIG,
  resolveAiModelConfigForSlot,
  type AiModelConfig,
} from "./aiConfig.js";

export interface AiPreflightFailure {
  playerId: string;
  name: string;
  slot: number | null;
  model: string | null;
  kind: "preflight" | "not_configured";
  message: string;
}

export interface AiPreflightResult {
  ok: boolean;
  checked: number;
  failures: AiPreflightFailure[];
  at: number;
  /** 全部命中缓存时为 true（没有产生新请求） */
  cached: boolean;
}

interface CacheEntry {
  ok: boolean;
  at: number;
  message?: string;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<{ ok: boolean; message?: string }>>();

function aiPlayers(game: GameState): Player[] {
  return game.players.filter((p) => isAiPlayer(p) && p.connected);
}

function signature(ai: Player, cfg: AiModelConfig): string {
  // 相同 Key/模型/地址的座位共用一个检测结果；slot 只用于错误归属。
  void ai;
  return [cfg.baseURL ?? "default", cfg.model, cfg.apiKey].join("|");
}

function isFresh(entry: CacheEntry, now: number): boolean {
  const ttl = entry.ok ? AI_CONFIG.preflightCacheMs : 10_000;
  return now - entry.at < ttl;
}

async function pingConfig(cfg: AiModelConfig): Promise<{ ok: boolean; message?: string }> {
  try {
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      maxRetries: 0,
    });
    await client.chat.completions.create(
      {
        model: cfg.model,
        temperature: 0,
        max_tokens: 4,
        messages: [
          { role: "system", content: "只回复 ok" },
          { role: "user", content: "ping" },
        ],
      },
      { timeout: AI_CONFIG.preflightTimeoutMs }
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 200),
    };
  }
}

function failureFor(ai: Player, message: string, kind: AiPreflightFailure["kind"]): AiPreflightFailure {
  const cfg = resolveAiModelConfigForSlot(ai.aiSlot);
  return {
    playerId: ai.id,
    name: ai.name,
    slot: ai.aiSlot ?? null,
    model: cfg?.model ?? null,
    kind,
    message,
  };
}

/**
 * 只读缓存状态：不发起网络请求。
 * 有任何 AI 的配置未检测过 / 缓存过期，返回 null（状态未知）。
 */
export function cachedAiPreflight(game: GameState, now = Date.now()): AiPreflightResult | null {
  const ais = aiPlayers(game);
  if (ais.length === 0) return { ok: true, checked: 0, failures: [], at: now, cached: true };

  const failures: AiPreflightFailure[] = [];
  for (const ai of ais) {
    const cfg = resolveAiModelConfigForSlot(ai.aiSlot);
    if (!cfg) {
      failures.push(
        failureFor(
          ai,
          `座位 ${ai.aiSlot ?? "?"} 未配置模型 Key；严格模式不允许开局。`,
          "not_configured"
        )
      );
      continue;
    }
    const entry = cache.get(signature(ai, cfg));
    if (!entry || !isFresh(entry, now)) return null;
    if (!entry.ok) {
      failures.push(
        failureFor(ai, entry.message ?? "模型连接检测失败", "preflight")
      );
    }
  }
  return {
    ok: failures.length === 0,
    checked: ais.length,
    failures,
    at: now,
    cached: true,
  };
}

/** 是否允许开局：严格模式必须有新鲜的通过记录。 */
export function canStartWithAi(game: GameState): { ok: boolean; message?: string } {
  if (!AI_CONFIG.strictAgent) return { ok: true };
  const ais = aiPlayers(game);
  if (ais.length === 0) return { ok: true };
  const cached = cachedAiPreflight(game);
  if (!cached) {
    return {
      ok: false,
      message: "严格 Agent 模式：AI 模型连接尚未检测。请先在管理端点「检测 AI 连接」，检测通过后再开局。",
    };
  }
  if (!cached.ok) {
    const names = cached.failures.map((f) => `${f.name}（${f.message}）`).join("；");
    return {
      ok: false,
      message: `严格 Agent 模式：${names}。修复后请点「检测 AI 连接」再开局。`,
    };
  }
  return { ok: true };
}

/**
 * 实际检测所有 AI 座位。相同 Key/模型/地址只请求一次。
 * force=true 时忽略缓存（管理员点「重试」）。
 */
export async function verifyAiAgents(
  game: GameState,
  options: { force?: boolean } = {}
): Promise<AiPreflightResult> {
  const now = Date.now();
  if (!options.force) {
    const cached = cachedAiPreflight(game, now);
    if (cached) return cached;
  }

  const ais = aiPlayers(game);
  if (ais.length === 0) return { ok: true, checked: 0, failures: [], at: now, cached: false };

  const failures: AiPreflightFailure[] = [];
  const bySignature = new Map<string, { cfg: AiModelConfig; players: Player[] }>();

  for (const ai of ais) {
    const cfg = resolveAiModelConfigForSlot(ai.aiSlot);
    if (!cfg) {
      failures.push(
        failureFor(ai, `座位 ${ai.aiSlot ?? "?"} 未配置模型 Key；严格模式不允许开局。`, "not_configured")
      );
      continue;
    }
    const sig = signature(ai, cfg);
    const bucket = bySignature.get(sig);
    if (bucket) bucket.players.push(ai);
    else bySignature.set(sig, { cfg, players: [ai] });
  }

  const entries = [...bySignature.entries()];
  await Promise.all(
    entries.map(async ([sig, { cfg, players }]) => {
      let pending = inFlight.get(sig);
      if (!pending) {
        pending = pingConfig(cfg).finally(() => inFlight.delete(sig));
        inFlight.set(sig, pending);
      }
      const result = await pending;
      cache.set(sig, { ok: result.ok, at: Date.now(), message: result.message });
      if (!result.ok) {
        for (const ai of players) {
          failures.push(failureFor(ai, result.message ?? "模型连接检测失败", "preflight"));
        }
      }
    })
  );

  return {
    ok: failures.length === 0,
    checked: entries.length,
    failures,
    at: Date.now(),
    cached: false,
  };
}

/** 模型成功响应后写入通过缓存（避免重复检测）。 */
export function markAiPreflightOk(ai: Player): void {
  const cfg = resolveAiModelConfigForSlot(ai.aiSlot);
  if (!cfg) return;
  cache.set(signature(ai, cfg), { ok: true, at: Date.now() });
}

/** 把检测结果写入房间状态，供管理端故障横幅展示。 */
export function applyAiPreflightToGame(game: GameState, result: AiPreflightResult): void {
  const failures = (game.aiFailures ??= {});
  const failedIds = new Map(result.failures.map((f) => [f.playerId, f]));
  for (const ai of aiPlayers(game)) {
    const failure = failedIds.get(ai.id);
    if (failure) {
      failures[ai.id] = {
        playerId: ai.id,
        name: ai.name,
        phase: game.phase,
        at: result.at,
        message: failure.message,
        kind: failure.kind,
      };
    } else if (failures[ai.id]?.kind === "preflight" || failures[ai.id]?.kind === "not_configured") {
      delete failures[ai.id];
    }
  }
}

/** 管理端修复配置后清空缓存，强制重新检测。 */
export function clearAiPreflightCache(): void {
  cache.clear();
}
