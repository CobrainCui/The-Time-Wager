/**
 * AI 座位配置自检。
 *
 * 用法（在 server 目录）：
 *   npm run build
 *   npm run check-ai            # 只打印每个座位会用什么模型，不调用网络
 *   npm run check-ai -- --ping  # 额外发一条极短请求，确认 Key 真的可用
 *   npm run check-ai -- --ping --slot 1
 *
 * 不会打印完整 Key，只会显示尾号；不会把 Key 写入任何文件。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import OpenAI from "openai";
import {
  MAX_AI_PLAYER_SLOTS,
  resolveAiModelConfigForSlot,
} from "../dist/ai/aiConfig.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
dotenv.config({ path: path.join(serverRoot, ".env"), quiet: true });

const args = process.argv.slice(2);
const ping = args.includes("--ping");
const slotArgIndex = args.indexOf("--slot");
const requestedSlot = slotArgIndex >= 0 ? Number(args[slotArgIndex + 1]) : null;

function maskKey(key) {
  if (!key) return "（空）";
  const tail = key.slice(-4);
  return `${key.slice(0, 3)}***${tail}（长度 ${key.length}）`;
}

function slotsToCheck() {
  if (Number.isInteger(requestedSlot) && requestedSlot >= 1) return [requestedSlot];
  return Array.from({ length: MAX_AI_PLAYER_SLOTS }, (_, i) => i + 1);
}

async function pingConfig(slot, cfg) {
  const startedAt = Date.now();
  try {
    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      maxRetries: 0,
    });
    const res = await client.chat.completions.create(
      {
        model: cfg.model,
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: "system", content: "只回复两个字符：ok" },
          { role: "user", content: "ping" },
        ],
      },
      { timeout: 20_000 }
    );
    const text = (res.choices?.[0]?.message?.content ?? "").trim().slice(0, 40);
    console.log(
      `  座位 ${slot}: ✅ 调用成功（${Date.now() - startedAt}ms）返回：${text || "（空）"}`
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  座位 ${slot}: ❌ 调用失败：${message.slice(0, 200)}`);
    return false;
  }
}

async function main() {
  const slots = slotsToCheck();
  const rows = slots.map((slot) => ({ slot, cfg: resolveAiModelConfigForSlot(slot) }));

  console.log("");
  console.log("AI 座位配置（Key 只显示尾号，可安全截图给同伴排查）");
  console.log("─".repeat(72));
  for (const { slot, cfg } of rows) {
    if (!cfg) {
      console.log(`座位 ${slot}: 未配置 → 该 AI 会使用本地策略（不调用模型）`);
      continue;
    }
    console.log(`座位 ${slot}: ${cfg.source} / ${cfg.provider} / ${cfg.model}`);
    console.log(`  Key   : ${maskKey(cfg.apiKey)}`);
    console.log(`  BaseURL: ${cfg.baseURL ?? "（OpenAI 官方默认）"}`);
  }
  console.log("─".repeat(72));

  const configured = rows.filter((r) => r.cfg);
  if (configured.length === 0) {
    console.log("没有任何座位配置了 Key：游戏仍可运行，但 AI 全部走本地策略。");
    console.log("请在 server/.env 填写 AI_API_KEY（共享）或 AI_PLAYER_1_API_KEY … AI_PLAYER_5_API_KEY。");
    return;
  }

  if (!ping) {
    console.log("提示：加 --ping 可实际调用一次模型，确认 Key / 模型名 / 网络都可用。");
    return;
  }

  console.log("");
  console.log("开始实际调用（每个座位一次，消耗极少量 token）...");
  let failed = 0;
  for (const { slot, cfg } of configured) {
    if (!(await pingConfig(slot, cfg))) failed += 1;
  }
  console.log("");
  if (failed > 0) {
    console.log(`有 ${failed} 个座位调用失败：先检查 Key、模型名、BASE_URL 与网络。`);
    process.exitCode = 1;
  } else {
    console.log("全部配置可用。");
  }
}

main().catch((error) => {
  console.error("自检脚本异常：", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
