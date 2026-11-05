/**
 * 产品版群聊端到端冒烟。
 *
 * 启动一个临时服务端（关闭自动主持与 AI），用 4 个 socket 模拟真人：
 * - 全员自动获得「全场」频道；
 * - A 拉 B/C 建群，D 不应看到该群或群消息；
 * - B、C 退群后群自动解散；
 * - 全场频道发危机消息，服务端统一发固定安全回复。
 *
 * 用法：node scripts/group-chat-e2e.mjs
 * 依赖：server/dist 已构建；frontend/node_modules 内有 socket.io-client。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const serverDir = path.join(repoRoot, "server");
const PORT = Number(process.env.GROUP_CHAT_E2E_PORT || 3102);
const URL = `http://127.0.0.1:${PORT}`;
const ROOM = `group-e2e-${Date.now().toString(36)}`;
const TOKEN = "group-e2e-token";

function log(msg) {
  console.log(`[group-e2e] ${msg}`);
}

function fail(msg) {
  console.error(`[group-e2e] FAIL: ${msg}`);
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
  log(`启动服务端 ${URL}`);
  const child = spawn(process.execPath, [path.join(serverDir, "dist", "index.js")], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      ADMIN_TOKEN: TOKEN,
      NODE_ENV: "test",
      AI_PLAYERS_ENABLED: "false",
      AUTO_HOST_ENABLED: "false",
      LOTTERY_ONLINE_RANDOM: "false",
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
    await waitFor(admin, "connect", () => true, 5_000);
    admin.emit("adminAuthenticate", { token: TOKEN });
    await waitFor(admin, "adminAuthOk", () => true, 5_000);
    log("管理员已鉴权");

    const humans = [];
    for (const name of ["甲", "乙", "丙", "丁"]) {
      const socket = connect();
      socket.on("error", (message) => log(`${name} error: ${String(message)}`));
      await waitFor(socket, "connect", () => true, 5_000);
      const joined = await new Promise((resolve) => {
        socket.once("playerJoined", resolve);
        socket.emit("joinGame", { roomId: ROOM, name });
      });
      const entry = { name, socket, playerId: joined?.playerId, latest: null };
      socket.on("gameUpdate", (g) => (entry.latest = g));
      humans.push(entry);
      await new Promise((r) => setTimeout(r, 80));
    }
    if (humans.some((h) => !h.playerId)) throw new Error("真人入房失败");
    log(`4 名真人已入房：${humans.map((h) => h.name).join("、")}`);

    admin.emit("adminSpectate", { targetRoomId: ROOM });
    let adminLatest = null;
    admin.on("gameUpdate", (g) => (adminLatest = g));
    await waitFor(admin, "gameUpdate", (g) => g?.roomId === ROOM, 5_000);

    admin.emit("adminStartGame", { roomId: ROOM });
    await waitUntil(() => adminLatest?.phase === "ERA_INTRO", "进入 ERA_INTRO", 6_000);
    for (const h of humans) h.socket.emit("playerReady");
    await waitUntil(() => adminLatest?.phase === "INVESTMENT", "进入 INVESTMENT", 8_000);
    log("进入 INVESTMENT");

    const publicGroup = (adminLatest?.chatGroups ?? []).find((g) => g.kind === "public");
    if (!publicGroup) fail("全场频道未自动创建");
    else {
      const allSeePublic = humans.every((h) =>
        (h.latest?.chatGroups ?? []).some((g) => g.id === publicGroup.id)
      );
      if (!allSeePublic) fail("并非所有真人都能看到全场频道");
      else log("PASS：全场频道自动创建并对全员可见");
    }

    const [a, b, c, d] = humans;
    a.socket.emit("createChatGroup", {
      memberIds: [b.playerId, c.playerId],
      name: "三人小队",
    });
    const custom = await waitUntil(
      () => (a.latest?.chatGroups ?? []).find((g) => g.kind === "custom"),
      "小群创建",
      5_000
    )
      .then(() => (a.latest?.chatGroups ?? []).find((g) => g.kind === "custom"))
      .catch(() => null);
    if (!custom) {
      fail("A 未能创建小群");
    } else {
      const bSees = (b.latest?.chatGroups ?? []).some((g) => g.id === custom.id);
      const cSees = (c.latest?.chatGroups ?? []).some((g) => g.id === custom.id);
      const dSees = (d.latest?.chatGroups ?? []).some((g) => g.id === custom.id);
      if (!bSees || !cSees) fail("B/C 未看到被拉入的小群");
      if (dSees) fail("非成员 D 看到了小群");
      if (bSees && cSees && !dSees) log("PASS：小群成员可见、非成员不可见");

      a.socket.emit("sendGroupMessage", {
        groupId: custom.id,
        text: "三人行动，先别外传。",
        clientTempId: "custom-1",
      });
      const bGot = await waitUntil(
        () => (b.latest?.groupMessages ?? []).some((m) => m.text === "三人行动，先别外传。"),
        "B 收到小群消息",
        5_000
      ).catch(() => null);
      const dGot = (d.latest?.groupMessages ?? []).some(
        (m) => m.text === "三人行动，先别外传。"
      );
      if (!bGot) fail("B 未收到小群消息");
      if (dGot) fail("非成员 D 收到了小群消息");
      if (bGot && !dGot) log("PASS：小群消息只对成员广播");

      b.socket.emit("leaveChatGroup", { groupId: custom.id });
      c.socket.emit("leaveChatGroup", { groupId: custom.id });
      const dissolved = await waitUntil(
        () =>
          !(a.latest?.chatGroups ?? []).some((g) => g.id === custom.id) &&
          !(b.latest?.chatGroups ?? []).some((g) => g.id === custom.id),
        "两人退群后解散",
        5_000
      ).catch(() => null);
      if (!dissolved) fail("成员退出后小群未解散");
      else log("PASS：少于 2 人自动解散");
    }

    if (publicGroup) {
      d.socket.emit("sendGroupMessage", {
        groupId: publicGroup.id,
        text: "我觉得活着没意思，不想再撑下去了。",
        clientTempId: "public-crisis",
      });
      const safety = await waitUntil(
        () =>
          (a.latest?.groupMessages ?? []).some(
            (m) => m.fromId === "__safety__" && String(m.text).includes("12356")
          ),
        "全场危机安全回复",
        5_000
      ).catch(() => null);
      if (!safety) fail("全场危机消息未触发固定安全回复");
      else log("PASS：全场危机消息触发固定安全回复");
    }

    admin.emit("adminDissolveRoom", { roomId: ROOM });
    admin.close();
    for (const h of humans) h.socket.close();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    console.error(serverLog.slice(-4000));
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!process.exitCode) log("全部通过");
  else {
    console.error("[group-e2e] --- server log (tail) ---");
    console.error(serverLog.slice(-8000));
  }
  process.exit(process.exitCode ?? 0);
}

main();
