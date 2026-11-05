/** 规则讲解员智能体 API 客户端（后端：server/logic/ruleAgent.ts，/api/rule-agent/*） */

export interface RuleAgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface RuleAgentChatResponse {
  relevant: boolean;
  reply: string;
}

export interface RuleAgentHealth {
  configured: boolean;
  /** 服务端代码开关：false 时入口应完全不显示 */
  enabled: boolean;
}

/** 每次携带的可见对话上限（等价于原 CLI 智能体的记忆窗口，防止提示词过长） */
const MAX_HISTORY_TURNS = 20;

/** 仅用于界面展示、不作为对话历史发给智能体的错误文案前缀（含旧版「讲解员」措辞） */
const LOCAL_ERROR_PREFIXES = [
  "规则助手请求失败",
  "规则助手暂时无法回答",
  "讲解员请求失败",
  "讲解员暂时无法回答",
];

export async function askRuleAgent(
  history: RuleAgentTurn[],
  question: string
): Promise<RuleAgentChatResponse> {
  const res = await fetch("/api/rule-agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      history: history
        .filter(
          (m) =>
            !(m.role === "assistant" && LOCAL_ERROR_PREFIXES.some((p) => m.content.startsWith(p)))
        )
        .slice(-MAX_HISTORY_TURNS),
      question,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = (await res.json()) as { error?: string };
      detail = data?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `规则助手请求失败（${res.status}）`);
  }
  return (await res.json()) as RuleAgentChatResponse;
}

export async function fetchRuleAgentHealth(): Promise<RuleAgentHealth> {
  try {
    const res = await fetch("/api/rule-agent/health");
    if (!res.ok) return { configured: false, enabled: false };
    const data = (await res.json()) as Partial<RuleAgentHealth>;
    return { configured: !!data.configured, enabled: data.enabled !== false };
  } catch {
    return { configured: false, enabled: false };
  }
}
