import React, { useCallback, useEffect, useRef, useState } from "react";
import { uiRem } from "../../utils/typography";
import {
  askRuleAgent,
  fetchRuleAgentHealth,
  type RuleAgentTurn,
} from "../../api/ruleAgent";

/**
 * 规则讲解员智能体聊天入口（内嵌自 郑先隽-PBL/GameInstruction，功能与原智能体一致）。
 * - 收起态：左下角悬浮按钮，与私信坞同一视觉体系（琥珀金点缀，区别于玩家私信的蓝色）
 * - 展开态：玻璃拟态对话面板，支持多轮追问，历史存 localStorage
 * 可在大厅（进房前）与房间内（进房后）通用挂载。
 */

const STORAGE_KEY = "ruleAgentChat.v1";
const MAX_STORED_TURNS = 40;

function loadStoredTurns(): RuleAgentTurn[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is RuleAgentTurn =>
          !!m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.length > 0
      )
      .slice(-MAX_STORED_TURNS);
  } catch {
    return [];
  }
}

const WELCOME_HINT =
  "你好，我是本游戏的规则助手。想了解玩法、项目、道具卡、结算……随时问我。";

export const RuleAgentChat: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<RuleAgentTurn[]>(() => loadStoredTurns());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  /** 服务端代码开关：known=false 表示还在查询；enabled=false 时完全不渲染入口 */
  const [gate, setGate] = useState<{ known: boolean; enabled: boolean; configured: boolean }>({
    known: false,
    enabled: false,
    configured: false,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(turns.slice(-MAX_STORED_TURNS)));
    } catch {
      /* 存储失败时静默忽略 */
    }
  }, [turns]);

  useEffect(() => {
    let alive = true;
    void fetchRuleAgentHealth().then((h) => {
      if (!alive) return;
      setGate({ known: true, enabled: h.enabled, configured: h.configured });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, open, loading]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;
    const history = turns;
    setTurns((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await askRuleAgent(history, question);
      setTurns((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: (e as Error).message || "规则助手暂时无法回答，请稍后再试。",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, turns]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
  };

  const clearConversation = () => {
    if (loading) return;
    setTurns([]);
  };

  // 代码开关关闭（或开关状态未知）时，完全不显示入口
  if (!gate.known || !gate.enabled) return null;

  return (
    <div className="rule-agent-dock" aria-label="游戏规则助手">
      {open ? (
        <div className="rule-agent-panel">
          <div className="rule-agent-panel-header">
            <div className="rule-agent-panel-title">
              <span className="rule-agent-panel-name">📖 规则助手</span>
              <span className="rule-agent-panel-sub">只答游戏相关问题</span>
            </div>
            <button
              type="button"
              className="rule-agent-icon-btn"
              title="清空对话"
              aria-label="清空对话"
              onClick={clearConversation}
              disabled={loading || turns.length === 0}
            >
              ⌫
            </button>
            <button
              type="button"
              className="rule-agent-icon-btn"
              title="收起"
              aria-label="收起规则助手"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          <div className="rule-agent-panel-body" ref={scrollRef}>
            {turns.length === 0 && (
              <div className="rule-agent-bubble rule-agent-bubble--assistant">
                {WELCOME_HINT}
              </div>
            )}
            {turns.map((m, i) => (
              <div
                key={i}
                className={`rule-agent-bubble ${
                  m.role === "user" ? "rule-agent-bubble--user" : "rule-agent-bubble--assistant"
                }`}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="rule-agent-bubble rule-agent-bubble--assistant rule-agent-bubble--typing">
                <span className="animate-spin" style={{ display: "inline-block", marginRight: "0.35rem" }}>⟳</span>
                规则助手正在翻阅规则…
              </div>
            )}
            {!gate.configured && (
              <div className="rule-agent-hint">
                服务端尚未配置 API 密钥，规则助手可能无法回答（.env 中的 DEEPSEEK_API_KEY）。
              </div>
            )}
          </div>

          <div className="rule-agent-panel-composer">
            <input
              ref={inputRef}
              className="rule-agent-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={loading ? "助手思考中…" : "问问没看懂的规则~"}
              aria-label="向规则助手提问"
              maxLength={500}
              disabled={loading}
              style={{ fontSize: uiRem(0.82) }}
            />
            <button
              type="button"
              className="rule-agent-send-btn"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              aria-label="发送"
            >
              {loading ? "…" : "发送"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="rule-agent-fab"
          onClick={() => setOpen(true)}
          title="规则助手"
          aria-label="打开规则助手"
        >
          <span className="rule-agent-fab-label">📖 规则助手</span>
        </button>
      )}
    </div>
  );
};
