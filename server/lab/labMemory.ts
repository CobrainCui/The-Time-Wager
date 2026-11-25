import fs from "node:fs";
import path from "node:path";

export type LabMemoryEntryType =
  | "action"
  | "chat"
  | "transfer"
  | "prediction"
  | "outcome"
  | "notice";

export interface LabMemoryEntry {
  ts: number;
  sessionId: string;
  globalRound: number;
  era: number;
  roundInEra: number;
  type: LabMemoryEntryType;
  text: string;
  data?: Record<string, unknown>;
}

function safeName(value: string): string {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 80) || "session";
}

/**
 * 每名实验 Agent 的结构化滚动记忆。
 * 按轮次整理并同步落盘为 JSONL，方便赛后核查 Agent 当时到底记住了什么。
 */
export class LabAgentMemory {
  private readonly agentIndex: number;
  private readonly dir: string;
  private readonly enabled: boolean;
  private entries: LabMemoryEntry[] = [];
  private sessionId = "";
  private filePath: string | null = null;

  constructor(agentIndex: number, dir: string, enabled: boolean) {
    this.agentIndex = agentIndex;
    this.dir = dir;
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  beginSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.entries = [];
    this.filePath = null;
    if (!this.enabled) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.filePath = path.join(
        this.dir,
        `agent-${this.agentIndex}-${safeName(sessionId)}.jsonl`
      );
      fs.writeFileSync(this.filePath, "", "utf8");
    } catch {
      this.filePath = null;
    }
  }

  record(
    type: LabMemoryEntryType,
    text: string,
    context: { globalRound: number; era: number; roundInEra: number; data?: Record<string, unknown> }
  ): void {
    if (!this.enabled) return;
    const entry: LabMemoryEntry = {
      ts: Date.now(),
      sessionId: this.sessionId,
      globalRound: context.globalRound,
      era: context.era,
      roundInEra: context.roundInEra,
      type,
      text: text.slice(0, 800),
      ...(context.data ? { data: context.data } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > 400) this.entries = this.entries.slice(-400);
    if (!this.filePath) return;
    try {
      fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* 记忆落盘失败不中断实验运行 */
    }
  }

  digest(maxChars = 5000): string {
    if (!this.enabled || this.entries.length === 0) return "（本局暂无历史记忆）";
    const byRound = new Map<number, LabMemoryEntry[]>();
    for (const e of this.entries) {
      const list = byRound.get(e.globalRound) ?? [];
      list.push(e);
      byRound.set(e.globalRound, list);
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    const sections: string[] = [];
    for (const round of rounds) {
      const entries = byRound.get(round)!;
      const lines = entries.slice(-12).map((e) => `  · [${e.type}] ${e.text}`);
      sections.push(`第 ${round} 轮：\n${lines.join("\n")}`);
    }
    let text = sections.join("\n");
    if (text.length > maxChars) text = `…（更早记忆已省略）\n${text.slice(-maxChars)}`;
    return text;
  }

  snapshot(): LabMemoryEntry[] {
    return [...this.entries];
  }
}
