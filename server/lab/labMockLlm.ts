import type { AiLlmResult } from "../ai/llmClient.js";

interface ParsedPromptPlayer {
  id: string;
  name: string;
  wealth: number;
  isMe: boolean;
}

interface ParsedPromptProject {
  id: number;
  name: string;
}

function sectionBetween(text: string, header: string): string {
  const idx = text.indexOf(header);
  if (idx < 0) return "";
  const rest = text.slice(idx + header.length);
  const nextIdx = rest.search(/\n##\s/);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

function parsePlayers(text: string): ParsedPromptPlayer[] {
  const sec = sectionBetween(text, "## 同桌玩家");
  const list: ParsedPromptPlayer[] = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = /^-\s*([^|]+?)\s*\|\s*ID=([^\s|]+)\s*\|\s*财富\s*(-?\d+)/.exec(line.trim());
    if (!m) continue;
    const rawName = m[1].trim();
    const isMe = rawName.endsWith("（你）");
    list.push({
      name: rawName.replace(/（你）$/, "").trim(),
      id: m[2].trim(),
      wealth: Number(m[3]) || 0,
      isMe,
    });
  }
  return list;
}

function parseProjects(text: string): ParsedPromptProject[] {
  const sec = sectionBetween(text, "## 当前项目");
  const list: ParsedPromptProject[] = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = /^-\s*ID\s*(\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line.trim());
    if (!m) continue;
    list.push({ id: Number(m[1]), name: m[2].trim() });
  }
  return list;
}

function parseGroupIds(text: string): string[] {
  const sec = sectionBetween(text, "## 你所在的自定义群聊");
  const ids: string[] = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = /^-\s*群ID=([^\s|]+)/.exec(line.trim());
    if (m) ids.push(m[1].trim());
  }
  return ids;
}

function parseRecentPrivateSenders(
  text: string,
  round: number,
  myName?: string
): Array<{ fromName: string; text: string }> {
  const sec = sectionBetween(text, "## 你收到的私聊");
  const list: Array<{ fromName: string; text: string }> = [];
  for (const line of sec.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const m = /^-\s*\[第\s*(\d+)\s*轮\]\s*([^→\n]+?)\s*→\s*([^:：\n]+?)[:：]\s*(.+)$/.exec(trimmed);
    if (!m || Number(m[1]) !== round) continue;
    const fromName = m[2].trim();
    const toName = m[3].trim();
    if (myName && fromName === myName) continue;
    if (myName && toName !== myName && toName !== "你") continue;
    list.push({ fromName, text: m[4].trim() });
  }
  return list;
}

function parseIntField(text: string, regex: RegExp, fallback = 0): number {
  const m = regex.exec(text);
  return m ? Number(m[1]) || fallback : fallback;
}

function agentIndexFrom(system: string): number {
  const m = /第\s*(\d+)\s*号座位/.exec(system || "");
  return m ? Number(m[1]) : 1;
}

function prediction(user: string, agentIndex: number) {
  const round = parseIntField(user, /第\s*(\d+)\s*全局轮/, 1);
  const players = parsePlayers(user);
  players.sort((a, b) => b.wealth - a.wealth || a.id.localeCompare(b.id));
  if (agentIndex % 2 === 0 && players.length >= 3) {
    [players[1], players[2]] = [players[2], players[1]];
  }
  return {
    reasoning: `按当前财富与第 ${round} 轮表现排序。`,
    ranking: players.map((p) => p.id),
  };
}

function preInvestmentChat(user: string, agentIndex: number) {
  const round = parseIntField(user, /第\s*(\d+)\s*全局轮/, 1);
  const projects = parseProjects(user);
  const players = parsePlayers(user);
  const others = players.filter((p) => !p.isMe);
  const groupIds = parseGroupIds(user);

  const messages: Array<Record<string, unknown>> = [];
  if (projects[0]) {
    messages.push({
      channel: "public",
      text: `第 ${round} 轮我想先看看大家对 ${projects[0].name} 的想法，咱们可以温和错峰投，尽量别挤爆同一个项目。`,
    });
  }
  if (others.length > 0) {
    const target = others[(agentIndex - 1) % others.length];
    messages.push({
      channel: "private",
      toPlayerId: target.id,
      text: `这轮我倾向关注 ${projects[agentIndex % Math.max(1, projects.length)]?.name ?? "稳健项目"}，你怎么看？方便的话咱们错开一点。`,
    });
  }

  const createGroup =
    round === 1 && agentIndex === 1 && others.length >= 2 && groupIds.length === 0
      ? { name: "协商小群", memberIds: others.slice(0, 2).map((p) => p.id) }
      : null;
  const groupMessages =
    groupIds.length > 0
      ? [
          {
            groupId: groupIds[0],
            text: `群里商量一下：第 ${round} 轮大家各自主要想投哪个？`,
          },
        ]
      : [];

  return {
    reasoning: `第 ${round} 轮投资前先温和沟通意向并试探同桌分工。`,
    messages,
    groupMessages,
    createGroup,
  };
}

function investment(user: string, agentIndex: number) {
  const round = parseIntField(user, /第\s*(\d+)\s*全局轮/, 1);
  const energy = Math.max(0, Math.floor(parseIntField(user, /精力[：:]\s*(\d+)/, 0)));
  const projects = parseProjects(user);
  const players = parsePlayers(user);
  const others = players.filter((p) => !p.isMe);
  const groupIds = parseGroupIds(user);

  const investmentMap: Record<string, number> = {};
  if (projects.length > 0 && energy > 0) {
    const ordered = projects
      .slice()
      .sort((a, b) => a.id - b.id)
      .sort((a, b) => ((a.id + agentIndex) % projects.length) - ((b.id + agentIndex) % projects.length));
    const first = ordered[0];
    const second = ordered[1] ?? ordered[0];
    const firstAmount = Math.max(1, Math.floor(energy * 0.6));
    investmentMap[String(first.id)] = firstAmount;
    const rest = energy - firstAmount;
    if (rest > 0 && second) {
      investmentMap[String(second.id)] = (investmentMap[String(second.id)] ?? 0) + rest;
    }
  }

  const mePlayer = players.find((p) => p.isMe);
  const hasPreChat = user.includes("本轮投资前沟通刚刚结束");
  const recentPrivate = parseRecentPrivateSenders(user, round, mePlayer?.name);
  const messages: Array<Record<string, unknown>> = [];
  if (hasPreChat && recentPrivate.length > 0) {
    const firstSenderName = recentPrivate[0].fromName;
    const senderPlayer = others.find((p) => p.name === firstSenderName) ?? others[0];
    if (senderPlayer) {
      messages.push({
        channel: "private",
        toPlayerId: senderPlayer.id,
        text: "收到，这轮我按咱们刚聊的节奏错开投，合作愉快。",
      });
    }
  } else if (!hasPreChat && projects[0]) {
    messages.push({
      channel: "public",
      text: `第 ${round} 轮我重点关注 ${projects[0].name}，欢迎一起分散布局。`,
    });
  }
  if (!hasPreChat && round % 2 === 0 && others.length > 0) {
    const target = others[(agentIndex - 1) % others.length];
    messages.push({
      channel: "private",
      toPlayerId: target.id,
      text: `这轮我打算投 ${projects[0]?.name ?? "长期项目"}，你如果错峰搭配会更稳妥。`,
    });
  }

  const transfer =
    round === 3 && agentIndex <= 2 && others.length > 0
      ? { toPlayerId: others[agentIndex % others.length].id, amount: 5, note: "合作诚意" }
      : null;

  const createGroup =
    !hasPreChat && round === 1 && agentIndex === 1 && others.length >= 2 && groupIds.length === 0
      ? { name: "协商小群", memberIds: others.slice(0, 2).map((p) => p.id) }
      : null;
  const groupMessages =
    !hasPreChat && groupIds.length > 0
      ? [
          {
            groupId: groupIds[0],
            text: `群内同步：第 ${round} 轮我准备投 ${projects[0]?.name ?? "当前项目"}。`,
          },
        ]
      : [];

  const senderNames = Array.from(new Set(recentPrivate.map((r) => r.fromName))).slice(0, 2).join("、");
  const reasoning =
    hasPreChat && senderNames
      ? `收到 ${senderNames} 的沟通意向，第 ${round} 轮按错峰协商分配精力。`
      : `结合第 ${round} 轮沟通反馈、项目容量与精力做分配。`;

  return {
    reasoning,
    messages,
    groupMessages,
    createGroup,
    transfer,
    coffee: 0,
    useCard: null,
    investment: investmentMap,
    ready: true,
  };
}

function auction(userText: string, agentIndex: number) {
  const maxBidMatch = /即\s*(\d+)/.exec(userText);
  const maxBid = maxBidMatch ? Number(maxBidMatch[1]) : 0;
  const minMatch = /最低下一口[：:]\s*(\d+)/.exec(userText);
  const minNext = minMatch ? Number(minMatch[1]) : 5;
  if (agentIndex % 3 !== 0 && minNext <= maxBid) {
    return { reasoning: `出到 ${minNext}，仍在上限内。`, action: "bid", amount: minNext };
  }
  return { reasoning: "价格或卡牌价值不匹配，放弃。", action: "pass" };
}

/**
 * 进程内 Mock LLM 响应器：仅用于免费自检链路，不调用外部接口，也不代表真实模型行为。
 */
export function askMockLabLlm(system: string, user: string): AiLlmResult {
  const agentIndex = agentIndexFrom(system);

  let payload: unknown;
  if (user.includes("任务：预测本局结束时")) {
    payload = prediction(user, agentIndex);
  } else if (user.includes("阶段：投资前沟通")) {
    payload = preInvestmentChat(user, agentIndex);
  } else if (user.includes("阶段：拍卖会")) {
    payload = auction(user, agentIndex);
  } else if (user.includes("向你发起转账")) {
    payload = { reasoning: "接受这笔转账，保留合作可能。", decision: "accept" };
  } else if (user.includes("需要为这个社区命名")) {
    payload = { reasoning: "取一个中性的实验社区名。", name: `实验社区${agentIndex}` };
  } else {
    payload = investment(user, agentIndex);
  }

  const raw = JSON.stringify(payload);
  const promptTokens = Math.ceil((system.length + user.length) / 4);
  const completionTokens = Math.ceil(raw.length / 4);
  const reasoningSummary =
    payload && typeof payload === "object" && "reasoning" in payload
      ? String((payload as { reasoning?: unknown }).reasoning ?? "")
      : "";
  return {
    ok: true,
    data: payload,
    raw,
    rawThinking: `【模拟推演 · ${agentIndex}号位】先评估当前场内各项目容量与对手公开发言，再权衡本轮最优出牌与稳健分配方案。${reasoningSummary ? `（结论：${reasoningSummary}）` : ""}`,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    latencyMs: 5,
  };
}
