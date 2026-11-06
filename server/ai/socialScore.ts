/**
 * 终局社交评定：根据每名玩家自己发出的群聊 + 私信内容，给出 A–E。
 *
 * - 只读取该玩家**主动发出**的消息，不把其他玩家的私信内容发给模型；
 * - 管理员已手动评定的玩家跳过；
 * - 模型不可用 / 无发言时回退到中性 C，不阻塞终局。
 */
import type { Server } from "socket.io";
import type { GameState, Player } from "../state/gameState.js";
import { askAiJson } from "./llmClient.js";
import { resolveAiModelConfigForSlot } from "./aiConfig.js";
import { appendSessionEvent } from "../state/sessionTelemetry.js";
import { broadcastUpdate } from "../network/broadcast.js";
import { GROUP_CHAT_ENABLED } from "../config/playerChatFeatures.js";

export type SocialRank = "A" | "B" | "C" | "D" | "E";

interface ChatSample {
  channel: "群聊" | "私信" | "转账留言";
  text: string;
}

const MAX_SAMPLES = 40;
const MAX_SAMPLE_CHARS = 120;

function collectSamples(game: GameState, player: Player): ChatSample[] {
  const samples: ChatSample[] = [];

  if (GROUP_CHAT_ENABLED) {
    const groupName = new Map(
      (game.chatGroups ?? []).map((g) => [g.id, g.kind === "public" ? "全场" : g.name])
    );
    for (const m of game.groupMessages ?? []) {
      if (m.fromId !== player.id) continue;
      const text = String(m.text ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      samples.push({ channel: "群聊", text: `[${groupName.get(m.groupId) ?? "群"}] ${text}` });
      if (samples.length >= MAX_SAMPLES) return samples;
    }
  }

  for (const tx of game.transactions ?? []) {
    if (tx.fromId !== player.id) continue;
    const text = String(tx.note ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    samples.push({
      channel: tx.amount === 0 ? "私信" : "转账留言",
      text: tx.amount === 0 ? text : `转账 ${tx.amount}：${text}`,
    });
    if (samples.length >= MAX_SAMPLES) break;
  }

  return samples.slice(0, MAX_SAMPLES).map((s) => ({
    ...s,
    text: s.text.slice(0, MAX_SAMPLE_CHARS),
  }));
}

function parseRank(raw: unknown): { rank: SocialRank; reason: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { rank?: unknown; reason?: unknown };
  const rank = typeof data.rank === "string" ? data.rank.trim().toUpperCase() : "";
  if (!/^[A-E]$/.test(rank)) return null;
  const reason =
    typeof data.reason === "string"
      ? data.reason.replace(/\s+/g, " ").trim().slice(0, 60)
      : "";
  return { rank: rank as SocialRank, reason };
}

function buildPrompt(player: Player, samples: ChatSample[]): string {
  return [
    "你是桌游《光阴对赌》的社交行为评估器。",
    "只根据下列「该玩家自己发出」的群聊、私信和转账留言，评价其社交表现；不要评价投资水平、财富或胜负。",
    "",
    "评分标准：",
    "A 优秀：主动合作、信息透明、建设性谈判、尊重他人，能促成多方共赢。",
    "B 良好：有合作意愿和有效沟通，偶有博弈但不过界。",
    "C 中性：常规交流、信息量少，或没有明显正负社交行为。",
    "D 较差：以操纵、挑拨、施压、攻击或无效刷屏为主。",
    "E 很差：辱骂、威胁、恶意欺骗、骚扰或明显恶意针对。",
    "",
    `玩家：${player.name}`,
    `样本数：${samples.length}`,
    "发言记录：",
    samples.length
      ? samples.map((s, i) => `${i + 1}. [${s.channel}] ${s.text}`).join("\n")
      : "（本局没有发言）",
    "",
    '只输出 JSON：{"rank":"A|B|C|D|E","reason":"20 字以内的依据"}',
  ].join("\n");
}

async function scoreOne(game: GameState, player: Player): Promise<void> {
  if (player.socialRankSource === "admin") return;

  const samples = collectSamples(game, player);
  if (samples.length === 0) {
    player.socialRank = "C";
    player.socialRankSource = "auto";
    player.socialRankReason = "本局无发言，按中性档";
    appendSessionEvent(
      game,
      "social_rank_auto",
      { targetPlayerId: player.id, rank: "C", reason: "本局无发言", samples: 0 },
      player.id
    );
    return;
  }

  const config = resolveAiModelConfigForSlot(player.aiSlot);
  if (!config) {
    player.socialRank = "C";
    player.socialRankSource = "auto";
    player.socialRankReason = "未配置模型，按中性档";
    appendSessionEvent(
      game,
      "social_rank_auto",
      { targetPlayerId: player.id, rank: "C", reason: "未配置模型", samples: samples.length },
      player.id
    );
    return;
  }

  const result = await askAiJson(
    "你是社交行为评估器，只输出 JSON。",
    buildPrompt(player, samples),
    {
      config,
      label: "social-score",
      maxOutputTokens: 8_000,
      timeoutMs: 60_000,
    }
  );
  const parsed = result.ok ? parseRank(result.data) : null;
  if (!parsed) {
    player.socialRank = "C";
    player.socialRankSource = "auto";
    player.socialRankReason = "自动评估失败，按中性档";
    appendSessionEvent(
      game,
      "social_rank_auto",
      {
        targetPlayerId: player.id,
        rank: "C",
        reason: "自动评估失败",
        samples: samples.length,
        error: result.error ?? "invalid output",
      },
      player.id
    );
    return;
  }

  player.socialRank = parsed.rank;
  player.socialRankSource = "auto";
  player.socialRankReason = parsed.reason || "自动评估";
  game.logs.push(
    `🧠 社交评定：${player.name} → ${parsed.rank}${parsed.reason ? `（${parsed.reason}）` : ""}`
  );
  appendSessionEvent(
    game,
    "social_rank_auto",
    {
      targetPlayerId: player.id,
      rank: parsed.rank,
      reason: parsed.reason,
      samples: samples.length,
    },
    player.id
  );
}

/**
 * 终局自动评定。模型调用失败不会抛出，保证 GAME_OVER 不被阻塞。
 * 六名玩家并发请求，单次超时 60 秒。
 */
export async function autoRateSocialFromChats(
  game: GameState,
  io: Server | null = null
): Promise<void> {
  if (process.env.SOCIAL_AUTO_SCORE === "false") return;

  const targets = game.players.filter((p) => p.socialRankSource !== "admin");
  if (targets.length === 0) return;

  if (io) {
    game.logs.push("🧠 正在根据群聊与私信内容评定社交分…");
    broadcastUpdate(io, game);
  }

  await Promise.allSettled(targets.map((p) => scoreOne(game, p)));

  if (io) broadcastUpdate(io, game);
}
