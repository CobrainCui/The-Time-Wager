import ExcelJS from "exceljs";
import type { AdminFeedbackEntry } from "../state/feedbackStore.js";
import type { IssueFeedbackEntry } from "../state/issueFeedbackStore.js";

const SOURCE_TEXT: Record<string, string> = {
  lobby: "首页",
  game_over: "对局结束",
  unknown: "未知",
};

const PHASE_TEXT: Record<string, string> = {
  ROOM_WAITING: "等待开局",
  ERA_INTRO: "时代介绍",
  TUTORIAL: "新手教程",
  BUFF_USAGE: "使用道具",
  INVESTMENT: "投资阶段",
  SETTLEMENT: "本轮结算",
  AUCTION: "拍卖阶段",
  COMMUNITY_NAMING: "社区命名",
  GAME_OVER: "对局结束",
};

const DEVICE_TEXT: Record<string, string> = {
  mobile: "手机",
  tablet: "平板",
  desktop: "电脑",
};

function formatTimestamp(ts?: number): string {
  if (!ts || !Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 防止电子表格公式注入（以 = + - @ 开头的文本前缀单引号） */
function safeCellText(value: string | undefined): string {
  if (!value) return "";
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export async function buildFeedbackWorkbook(items: AdminFeedbackEntry[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("玩家评价");

  ws.columns = [
    { header: "编号", key: "id", width: 22 },
    { header: "评分", key: "rating", width: 8 },
    { header: "状态", key: "status", width: 10 },
    { header: "精选置顶", key: "pinned", width: 10 },
    { header: "已完局认证", key: "verified", width: 12 },
    { header: "来源", key: "source", width: 12 },
    { header: "本局模式", key: "mode", width: 16 },
    { header: "本局人格", key: "persona", width: 14 },
    { header: "标签", key: "tags", width: 28 },
    { header: "有帮助赞数", key: "helpful", width: 12 },
    { header: "评价内容", key: "content", width: 48 },
    { header: "官方回复", key: "reply", width: 42 },
    { header: "提交时间", key: "createdAt", width: 20 },
    { header: "修改时间", key: "updatedAt", width: 20 },
  ];

  ws.getRow(1).font = { bold: true };
  for (const item of items) {
    ws.addRow({
      id: item.id,
      rating: item.rating,
      status: item.status === "visible" ? "公开中" : "已隐藏",
      pinned: item.pinned ? "是" : "否",
      verified: item.verifiedGameOver ? "是" : "否",
      source: SOURCE_TEXT[item.source] ?? "未知",
      mode: safeCellText(item.gameContext?.modeLabel),
      persona: safeCellText(item.gameContext?.personaName),
      tags: safeCellText(item.tags.join("、")),
      helpful: item.helpfulCount,
      content: safeCellText(item.content),
      reply: safeCellText(item.officialReply?.content),
      createdAt: formatTimestamp(item.createdAt),
      updatedAt: formatTimestamp(item.updatedAt),
    });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

export async function buildIssuesWorkbook(items: IssueFeedbackEntry[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("局中问题反馈");

  ws.columns = [
    { header: "编号", key: "id", width: 22 },
    { header: "问题分类", key: "category", width: 16 },
    { header: "处理状态", key: "status", width: 12 },
    { header: "问题描述", key: "content", width: 50 },
    { header: "当前阶段", key: "phase", width: 14 },
    { header: "时代/轮次", key: "eraRound", width: 14 },
    { header: "房间人数", key: "seats", width: 14 },
    { header: "房间号", key: "roomId", width: 12 },
    { header: "设备与屏幕", key: "device", width: 18 },
    { header: "处理备注", key: "adminNote", width: 34 },
    { header: "提交时间", key: "createdAt", width: 20 },
    { header: "处理时间", key: "resolvedAt", width: 20 },
  ];

  ws.getRow(1).font = { bold: true };
  for (const item of items) {
    const ctx = item.context;
    const eraRound =
      ctx.era != null || ctx.round != null
        ? `第${ctx.era ?? "-"}时代 第${ctx.round ?? "-"}轮`
        : "";
    const seats =
      ctx.humanCount != null || ctx.aiCount != null
        ? `${ctx.humanCount ?? 0}真人 + ${ctx.aiCount ?? 0}AI`
        : "";
    const device = [
      ctx.deviceType ? DEVICE_TEXT[ctx.deviceType] ?? ctx.deviceType : "",
      ctx.viewport ?? "",
    ]
      .filter(Boolean)
      .join(" ");

    ws.addRow({
      id: item.id,
      category: item.category,
      status: item.status === "resolved" ? "已处理" : "待处理",
      content: safeCellText(item.content),
      phase: ctx.phase ? PHASE_TEXT[ctx.phase] ?? ctx.phase : "",
      eraRound,
      seats,
      roomId: safeCellText(ctx.roomId),
      device,
      adminNote: safeCellText(item.adminNote),
      createdAt: formatTimestamp(item.createdAt),
      resolvedAt: formatTimestamp(item.resolvedAt),
    });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
