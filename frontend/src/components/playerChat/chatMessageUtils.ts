import { Transaction } from "../../types";
import type { ChatMessage } from "./types";

export function msgFromTx(tx: Transaction, myId: string): ChatMessage {
  return {
    id: tx.id,
    txId: tx.id,
    peerId: tx.fromId === myId ? tx.toId : tx.fromId,
    direction: tx.fromId === myId ? "out" : "in",
    amount: tx.amount,
    note: tx.note || "",
    status: tx.status,
    timestamp: tx.timestamp,
  };
}

export function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => a.timestamp - b.timestamp);
}

/** 合并本地会话与尚未写入 thread 的服务端记录，按时间排序、按 txId 去重 */
export function mergeThreadMessages(
  threadMessages: ChatMessage[],
  orphanTxs: Transaction[],
  myId: string
): ChatMessage[] {
  const seenTx = new Set(threadMessages.filter((m) => m.txId).map((m) => m.txId!));
  const merged = [...threadMessages];
  for (const tx of orphanTxs) {
    if (seenTx.has(tx.id)) continue;
    merged.push(msgFromTx(tx, myId));
    seenTx.add(tx.id);
  }
  return sortMessages(merged);
}

export function formatBubbleText(m: ChatMessage): string {
  if (m.amount === 0) return m.note || "（私信）";
  const prefix = m.amount > 0 ? `💰 ${m.amount}` : "";
  return m.note ? `${prefix} · ${m.note}` : prefix;
}

/** 微信式状态：收发方向区分文案 */
export function messageStatusMeta(m: ChatMessage): string | null {
  if (m.status === "pending") {
    if (m.direction === "out" && !m.txId) return "发送中…";
    if (m.direction === "out") return "等待对方确认";
    return null;
  }
  const isMsg = m.amount === 0;
  if (m.direction === "out") {
    if (m.status === "accepted") return isMsg ? "对方已读" : "对方已收款";
    return isMsg ? "对方已忽略" : "对方已退回";
  }
  if (m.status === "accepted") return isMsg ? "已知晓" : "已收款";
  return isMsg ? "已忽略" : "已退回";
}

export function badgeCount(unread: number, pending: number): number {
  return Math.max(unread, pending);
}

export function formatBadge(n: number): string {
  if (n <= 0) return "";
  return n > 99 ? "99+" : String(n);
}
