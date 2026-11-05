import { Player } from "../types";

/** 与 server/util/isAiPlayer 规则一致 */
export function isAiPlayer(p: Player): boolean {
  if (p.isAI) return true;
  if (p.name.startsWith("🤖") || p.name.startsWith("AI_")) return true;
  if (p.id.startsWith("ai_")) return true;
  if (/^AI\d+$/i.test(p.id) || /^AI\d+$/i.test(p.name)) return true;
  return false;
}

export const AI_DIFFICULTY_LABEL: Record<"easy" | "normal" | "hard", string> = {
  easy: "简单",
  normal: "普通",
  hard: "困难",
};

export function aiDifficultyLabel(value: string | undefined): string {
  if (value === "easy" || value === "hard" || value === "normal") {
    return AI_DIFFICULTY_LABEL[value];
  }
  return AI_DIFFICULTY_LABEL.normal;
}
