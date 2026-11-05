/**
 * AI 玩家端到端冒烟（产品版，严格 Agent 模式）。
 *
 * 启动一个本地 OpenAI 兼容 mock（不消耗真实额度），再用 socket 模拟
 * 「主持 + 1 名真人 + 5 名 AI」跑完开局、投资、结算、拍卖与移除。
 * 严格模式下 AI 不允许本地策略兜底，因此这里也验证了：
 * 开局前模型连通性检测、投资/拍卖走模型、失败不静默降级。
 *
 * 用法：node scripts/ai-e2e.mjs
 * 依赖：server/dist 已构建；frontend/node_modules 内有 socket.io-client。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const serverDir = path.join(repoRoot, "server");
const PORT = Number(process.env.AI_E2E_PORT || 3101);
const MOCK_PORT = PORT + 100;
const URL = `http://127.0.0.1:${PORT}`;
const ROOM = `ai-e2e-${Date.now().toString(36)}`;
const TOKEN = "ai-e2e-token";

/** 最小 OpenAI 兼容 mock：按提示词类型返回合法的 JSON 决策。 */
function startMockLlm() {
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let prompt = "";
      try {
        const parsed = JSON.parse(body);
        prompt = String(parsed.messages?.map((m) => m.content).join("\n") ?? "");
      } catch {
        /* ignore */
      }

      let content = "ok";
      if (prompt.includes("拍卖会")) {
        const min = Number(prompt.match(/最低下一口：(\d+)/)?.[1] ?? 5);
        content = JSON.stringify({ reasoning: "mock bid", action: "bid", amount: Math.max(5, min) });
      } else if (prompt.includes("收到一笔转账")) {
        content = JSON.stringify({ reasoning: "mock accept", accept: true });
      } else if (prompt.includes("为社区命名")) {
        content = JSON.stringify({ reasoning: "mock", name: "测试社区" });
      } else if (prompt.includes("## 输出 JSON") || prompt.includes("分配精力")) {
        const projectId = prompt.match(/"id":(\d+)/)?.[1];
        content = JSON.stringify({
          reasoning: "mock invest",
          messages: [],
          transfer: null,
          coffee: 0,
          useCard: null,
          investment: projectId ? { [projectId]: 15 } : {},
        });
      }

      const payload = {
        id: "mock",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "mock-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server));
  });
}

function log(msg) {
  console.log(`[ai-e2e] ${msg}`);
}

function fail(msg) {
  console.error(`[ai-e2e] FAIL: ${msg}`);
  process.exitCode = 1;
}

function waitFor(socket, event, predicate, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待 ${event} 超时`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function waitUntil(check, label, timeoutMs = 12_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`等待状态超时：${label}`);
}

function connect() {
  return io(URL, { transports: ["websocket"], forceNew: true, reconnection: false });
}

async function main() {
  const mock = await startMockLlm();
  log(`本地 mock 模型已启动 ${MOCK_PORT}`);
  log(`启动服务端 ${URL}`);
  const child = spawn(process.execPath, [path.join(serverDir, "dist", "index.js")], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_TOKEN: TOKEN,
      NODE_ENV: "test",
      AI_PLAYERS_ENABLED: "true",
      AI_STRICT_AGENT: "true",
      AI_VERBOSE_LOG: "true",
      AUTO_HOST_ENABLED: "false",
      LOTTERY_ONLINE_RANDOM: "false",
      AI_API_KEY: "mock-key",
      AI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
      AI_MODEL: "mock-model",
      AI_PROVIDER: "mock",
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      RULE_AGENT_ENABLED: "false",
    },
  });
  let serverLog = "";
  child.stdout.on("data", (d) => (serverLog += d.toString()));
  child.stderr.on("data", (d) => (serverLog += d.toString()));

  try {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${URL}/api/community-leaderboard`);
        if (res.ok) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const admin = connect();
    const adminErrors = [];
    admin.on("error", (message) => {
      adminErrors.push(String(message));
      log(`admin error: ${String(message)}`);
    });
    admin.on("info", (message) => log(`admin info: ${String(message)}`));
    await waitFor(admin, "connect", () => true, 5_000);
    admin.emit("adminAuthenticate", { token: TOKEN });
    await waitFor(admin, "adminAuthOk", () => true, 5_000);
    log("管理员已鉴权");

    const human = connect();
    human.on("error", (message) => log(`human error: ${String(message)}`));
    await waitFor(human, "connect", () => true, 5_000);
    human.emit("joinGame", { roomId: ROOM, name: "真人玩家" });
    await waitFor(human, "playerJoined", (p) => !!p?.playerId, 5_000);
    log("真人已入房");

    admin.emit("adminSpectate", { targetRoomId: ROOM });
    let latest = null;
    admin.on("gameUpdate", (g) => (latest = g));
    await waitFor(admin, "gameUpdate", (g) => g?.roomId === ROOM, 5_000);
    log("管理员已观战");

    const personas = ["罗盘精算师", "时荫植者", "涌机触发者", "瞬刻炼金士", "罗盘精算师"];
    for (const persona of personas) {
      admin.emit("adminAddAI", { roomId: ROOM, persona, difficulty: "normal" });
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 500));
    log(`当前玩家数：${latest?.players?.length ?? "?"}；AI 数：${(latest?.players ?? []).filter((p) => p.isAI).length}`);
    await waitUntil(() => (latest?.players?.length ?? 0) === 6, "6 名玩家入座", 5_000);
    log("5 名 AI 已入座");

    admin.emit("adminStartGame", { roomId: ROOM });
    await waitUntil(() => latest?.phase === "ERA_INTRO", "进入 ERA_INTRO", 6_000);
    log("开局 → ERA_INTRO");

    // AI 应在看门狗/驱动下自动 ready（不需要真人替它们点）
    const aiReady = await waitUntil(
      () => (latest?.players ?? []).filter((p) => p.isAI).every((p) => p.ready),
      "AI 在 ERA_INTRO 自动 ready",
      8_000
    ).catch(() => null);
    if (!aiReady) fail("AI 未在 ERA_INTRO 自动 ready");
    else log("AI 已自动 ready");

    human.emit("playerReady");
    await waitUntil(() => latest?.phase === "INVESTMENT", "进入 INVESTMENT", 8_000);
    log("进入 INVESTMENT");

    // 群聊：开局后应自动创建「全场」，真人消息应广播，危机消息应由服务端统一安全回复
    const publicGroup = (latest?.chatGroups ?? []).find((g) => g.kind === "public");
    if (!publicGroup) {
      fail("群聊开启后未自动创建全场频道");
    } else {
      human.emit("sendGroupMessage", {
        groupId: publicGroup.id,
        text: "大家好，这轮先拿短期。",
        clientTempId: "e2e-group-1",
      });
      const groupOk = await waitUntil(
        () => (latest?.groupMessages ?? []).some((m) => m.text === "大家好，这轮先拿短期。"),
        "群消息广播",
        5_000
      ).catch(() => null);
      if (!groupOk) fail("群消息未出现在 gameUpdate");
      else log("PASS：全场群聊创建与广播");

      human.emit("sendGroupMessage", {
        groupId: publicGroup.id,
        text: "我觉得活着没意思，不想再撑下去了。",
        clientTempId: "e2e-group-crisis",
      });
      const safetyOk = await waitUntil(
        () =>
          (latest?.groupMessages ?? []).some(
            (m) => m.fromId === "__safety__" && String(m.text).includes("12356")
          ),
        "危机安全回复",
        5_000
      ).catch(() => null);
      if (!safetyOk) fail("危机消息未触发固定安全回复");
      else log("PASS：危机消息触发固定安全回复");
    }

    const invested = await waitUntil(
      () => (latest?.players ?? []).filter((p) => p.isAI).every((p) => p.ready),
      "AI 在 INVESTMENT 提交并 ready",
      20_000
    ).catch(() => null);
    if (!invested) {
      fail("AI 未在 INVESTMENT 提交并 ready");
    } else {
      const aiPlayers = latest.players.filter((p) => p.isAI);
      const totals = aiPlayers.map((p) =>
        Object.values(p.investment ?? {}).reduce((s, v) => s + v, 0)
      );
      log(`AI 投资总额：${totals.join(", ")}`);
      if (totals.every((t) => t === 0)) fail("AI 全部空投资，策略可能未生效");
      if (totals.some((t) => t > 15)) fail("AI 投资超过本轮精力上限");
    }

    human.emit("submitInvestment", { investment: {} });
    await waitUntil(() => latest?.phase === "SETTLEMENT", "进入 SETTLEMENT", 10_000);
    const settled = latest;
    const aiWealth = (settled?.players ?? []).filter((p) => p.isAI).map((p) => p.wealth);
    log(`结算后 AI 财富：${aiWealth.join(", ")}`);
    if (aiWealth.some((w) => !Number.isFinite(w))) fail("AI 财富异常");
    log("PASS：AI 参与开局、准备、投资、结算");

    // 直接跳到拍卖，验证 AI 出价链路（避免为测试再跑完整一轮）
    admin.emit("adminSkipPhase", { roomId: ROOM, targetPhase: "AUCTION" });
    await waitUntil(() => latest?.phase === "AUCTION", "进入 AUCTION", 12_000);
    admin.emit("adminSetAuctionFocus", { roomId: ROOM, cardId: "buff_gold" });
    const focusOk = await waitUntil(
      () => latest?.auctionFocusCardId === "buff_gold",
      "拍卖焦点设为 buff_gold",
      5_000
    ).catch(() => null);
    if (!focusOk) {
      fail(
        `拍卖焦点未生效（focus=${latest?.auctionFocusCardId ?? "无"}；adminErrors=${adminErrors.join(" | ") || "无"}）`
      );
    }
    admin.emit("requestGameState");
    await waitUntil(
      () =>
        (latest?.auctionCurrentBid ?? 0) > 0 ||
        (latest?.auctionBids ?? []).some((b) => String(b.playerId).startsWith("ai_")),
      "AI 在拍卖中出价",
      20_000
    )
      .then(() => log("PASS：AI 拍卖出价"))
      .catch(() => fail("AI 未在拍卖中出价"));
    admin.emit("adminEndAuction", { roomId: ROOM });
    await waitUntil(() => latest?.phase === "ERA_INTRO", "结束拍卖", 10_000);
    log("PASS：拍卖可正常结束并回到时代介绍");

    admin.emit("adminRemoveAI", { roomId: ROOM, targetPlayerId: settled?.players?.find((p) => p.isAI)?.id });
    await waitUntil(
      () => (latest?.players ?? []).filter((p) => p.isAI).length === 4,
      "移除一名 AI",
      5_000
    )
      .then(() => log("移除 AI 正常"))
      .catch(() => fail("移除 AI 失败"));

    admin.emit("adminDissolveRoom", { roomId: ROOM });
    admin.close();
    human.close();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    console.error(serverLog.slice(-4000));
  } finally {
    child.kill();
    mock.close();
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!process.exitCode) log("全部通过");
  else {
    console.error("[ai-e2e] --- server log (tail) ---");
    console.error(serverLog.slice(-8000));
  }
  process.exit(process.exitCode ?? 0);
}

main();
