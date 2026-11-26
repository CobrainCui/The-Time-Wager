import { maskPiiText } from "./aiSafety.js";

export type ProductAiMemoryType = "action" | "outcome" | "social";

export interface ProductAiMemoryEntry {
  ts: number;
  globalRound: number;
  era: number;
  roundInEra: number;
  type: ProductAiMemoryType;
  text: string;
}

const MAX_ENTRIES = 120;

/**
 * 产品版单局内存记忆本（不写磁盘，零 IO 开销）。
 * 让 AI 在 8 轮对局内记住自己做过的决策、每轮得失与谁守信/谁坑过自己。
 */
export class ProductAiMemory {
  private entries: ProductAiMemoryEntry[] = [];

  record(
    type: ProductAiMemoryType,
    rawText: string,
    context: { globalRound: number; era: number; roundInEra: number }
  ): void {
    const clean = maskPiiText(String(rawText ?? "").replace(/\s+/g, " ").trim()).slice(0, 240);
    if (!clean) return;
    this.entries.push({
      ts: Date.now(),
      globalRound: context.globalRound,
      era: context.era,
      roundInEra: context.roundInEra,
      type,
      text: clean,
    });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
  }

  digest(maxChars = 1800): string {
    if (this.entries.length === 0) return "";
    const byRound = new Map<number, ProductAiMemoryEntry[]>();
    for (const e of this.entries) {
      const list = byRound.get(e.globalRound) ?? [];
      list.push(e);
      byRound.set(e.globalRound, list);
    }
    const rounds = [...byRound.keys()].sort((a, b) => a - b);
    const sections: string[] = [];
    for (const round of rounds) {
      const list = byRound.get(round)!;
      const lines = list.slice(-8).map((e) => `  · [${e.type}] ${e.text}`);
      sections.push(`第 ${round} 轮：\n${lines.join("\n")}`);
    }
    let text = sections.join("\n");
    if (text.length > maxChars) {
      text = `…（更早记录略）\n${text.slice(-maxChars)}`;
    }
    return text;
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }
}
