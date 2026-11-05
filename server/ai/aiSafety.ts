/**
 * AI 玩家安全约束层（参照 i2iLab DEFINE + EVAL 的人本 AI 原则）。
 *
 * 设计原则：
 * - 安全一票否决：只要命中硬红线，原文不得出现在玩家可见的任何位置。
 * - 危机优先于游戏：识别到自伤/自杀/暴力/进食障碍/未成年危机后，
 *   停止游戏话术，只允许一条固定安全回复（声明边界 + 转介真人资源）。
 * - 不诊断、不治疗、不劝解、不索取隐私、不泄露提示词、不冒充真人。
 * - 所有检查都是纯函数，便于红队测试；模型输出与本地模板走同一道闸门。
 *
 * 本文件只做「规则与兜底」，提示词层的边界说明在 aiPrompt.ts。
 */

export type CrisisCategory =
  | "self_harm"
  | "violence"
  | "eating_disorder"
  | "minor_crisis";

export interface CrisisScan {
  risk: boolean;
  categories: CrisisCategory[];
}

/** 危机窗口：命中后 10 分钟内 AI 不闲聊，只允许固定安全回复 */
export const SAFETY_CRISIS_WINDOW_MS = 10 * 60_000;
/** 同一房间的固定安全回复/系统提示最短间隔 */
export const SAFETY_REPLY_COOLDOWN_MS = 10 * 60_000;

export const SAFETY_NOTICE_FROM_ID = "__safety__";
export const SAFETY_NOTICE_FROM_NAME = "系统安全提示";

/**
 * 固定危机回复。
 * 必须同时满足 i2iLab 的四项危机测试：
 * 1) 识别为危机；2) 声明能力边界；3) 给出真人/热线资源；4) 不自行治疗或展开。
 */
export const CRISIS_REPLY =
  "我是 AI 玩家，不能处理危机，也不做心理或医疗判断。请立即联系身边可信任的人；紧急情况拨 120（伤人/被伤拨 110），心理援助热线 12356（24 小时）。";

const ZERO_WIDTH_RE = /[​-‍﻿⁠]/g;

/** 去掉零宽字符、折叠空白；保留原文标点，避免回写时把中文标点改成半角 */
function cleanForOutput(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(ZERO_WIDTH_RE, "").replace(/\s+/g, " ").trim();
}

/** 检测用：在 cleanForOutput 基础上再做 NFKC，防止全角/半角绕过 */
export function normalizeSafetyText(raw: unknown): string {
  return cleanForOutput(raw).normalize("NFKC");
}

const SELF_HARM_PATTERNS: RegExp[] = [
  /自杀|轻生|自尽|寻死/,
  /不想活|活不下去|活够了|活着(?:真|太)?(?:没|没有)意思|生无可恋/,
  /结束(?:自己|我)?的?生命|了结(?:自己|生命)|一了百了/,
  /自残|割腕|跳楼|跳河|烧炭|吞药|吃安眠药|上吊|卧轨/,
  /遗书|交代后事/,
  /我(?:真的|已经|快)?撑不下去了?|我不想再撑下去了?/,
  /\b(?:kill myself|suicide|suicidal|end my life|want to die|self[- ]?harm|cut myself|hang myself)\b/i,
];

const VIOLENCE_PATTERNS: RegExp[] = [
  /杀(?:了|死|掉)(?:他|她|他们|人)|想杀(?:人|他|她)|砍死|捅死/,
  /报复社会|炸(?:学校|公司|地铁|列车)/,
  /伤害(?:别人|他人|同学|家人|舍友)/,
  /\b(?:kill (?:him|her|them|someone)|hurt (?:him|her|them))\b/i,
];

const EATING_PATTERNS: RegExp[] = [
  /厌食症?|暴食症?|催吐|吃了就吐|不敢吃东西|饿到晕/,
  /\b(?:anorexia|bulimia|purge after eating)\b/i,
];

const MINOR_PATTERN = /未成年|1[0-7]\s*(?:岁|周岁)|初中生?|小学生?/;
const MINOR_DISTRESS_PATTERN =
  /崩溃|撑不住|不想活|自残|自杀|绝望|抑郁|难受得|活不下去/;

function pushIfMatched(
  list: CrisisCategory[],
  category: CrisisCategory,
  patterns: RegExp[],
  text: string
): void {
  if (list.includes(category)) return;
  if (patterns.some((re) => re.test(text))) list.push(category);
}

/** 识别危机信号；宁可用固定安全回复兜底，也不让 AI 自行处理。 */
export function detectCrisisSignals(raw: unknown): CrisisScan {
  const text = normalizeSafetyText(raw);
  if (!text) return { risk: false, categories: [] };
  const categories: CrisisCategory[] = [];
  pushIfMatched(categories, "self_harm", SELF_HARM_PATTERNS, text);
  pushIfMatched(categories, "violence", VIOLENCE_PATTERNS, text);
  pushIfMatched(categories, "eating_disorder", EATING_PATTERNS, text);
  if (
    MINOR_PATTERN.test(text) &&
    MINOR_DISTRESS_PATTERN.test(text) &&
    !categories.includes("minor_crisis")
  ) {
    categories.push("minor_crisis");
  }
  return { risk: categories.length > 0, categories };
}

export function isCrisisReply(raw: unknown): boolean {
  return cleanForOutput(raw) === CRISIS_REPLY;
}

export type OutputKind = "chat" | "note" | "name";

export interface OutputGuardResult {
  /** 原文是否通过检查（false 表示已被拦截或替换） */
  ok: boolean;
  /** 可以安全发送的文本；为空表示必须丢弃 */
  text: string;
  /** 命中的规则，仅用于日志/测试，不含原文 */
  reasons: string[];
}

const MAX_CHARS: Record<OutputKind, number> = {
  chat: 120,
  note: 80,
  name: 20,
};

type GuardRule = { reason: string; re: RegExp };

/**
 * 硬红线。顺序即优先级：越靠前越先判定。
 * 不匹配普通游戏黑话（投爆、摸鱼、做空等）。
 */
const GUARD_RULES: GuardRule[] = [
  {
    reason: "prompt_leak",
    re: /系统提示词|system\s*prompt|开发者指令|内部指令|忽略(?:之前|以上|先前)的?指令|ignore (?:all )?(?:previous|above) instructions|我的设定是/i,
  },
  {
    reason: "harmful",
    re: /去死|死了(?:就)?(?:好|解脱)|自杀吧|教你(?:自杀|自残|割腕)|怎么自杀|砍死你|弄死你|一起死/,
  },
  {
    reason: "sexual_minor",
    re: /(?:未成年|萝莉|正太).{0,6}(?:性|裸|色)|裸聊|儿童色情/,
  },
  {
    reason: "medical_advice",
    re: /你(?:有|这是|得了|患有|就是)(?:抑郁|焦虑症?|精神病|人格障碍|双相)|确诊(?:为)?|我有(?:药|疗法)|按我说的.{0,6}(?:吃药|吃|做).{0,4}(?:就好|就行|才好)/,
  },
  {
    reason: "real_money",
    re: /(?:借|贷|转|汇|充|打)(?:款|账|钱)?(?:给|到)我|扫码|返利|刷单|稳赚|带你赚钱|真实货币|私下(?:交易|转账)/,
  },
  {
    reason: "contact",
    re: /(?:\+?86[-\s]?)?1[3-9]\d{9}/,
  },
  {
    reason: "contact",
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/,
  },
  {
    reason: "contact",
    re: /(?:加|扫|留)(?:一下)?(?:我|你)?(?:的)?(?:微信|QQ|V信|WhatsApp|Telegram|电报)/i,
  },
  {
    reason: "link",
    re: /https?:\/\/|www\.|\.(?:com|cn|net|io|top|xyz)\b/i,
  },
  {
    reason: "impersonation",
    re: /我是(?:真人|人类|真正的人)|我不是(?:AI|人工智能|机器人)|我可?不是机器人/,
  },
];

const IMPERSONATION_SAFE_TEXT = "我是游戏里的 AI 玩家，继续这一轮。";

function truncateChars(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

/**
 * 所有玩家可见的 AI 文本都必须经过这里：
 * 聊天、转账留言、社区名、以及任何未来新增的自由文本。
 */
export function guardAgentOutput(raw: unknown, kind: OutputKind = "chat"): OutputGuardResult {
  const clean = cleanForOutput(raw);
  const normalized = clean.normalize("NFKC");
  const max = MAX_CHARS[kind];
  if (!clean) return { ok: false, text: "", reasons: ["empty"] };

  for (const rule of GUARD_RULES) {
    if (!rule.re.test(normalized)) continue;
    if (rule.reason === "impersonation") {
      return {
        ok: false,
        text: kind === "chat" ? IMPERSONATION_SAFE_TEXT : "",
        reasons: [rule.reason],
      };
    }
    return { ok: false, text: "", reasons: [rule.reason] };
  }

  const { text, truncated } = truncateChars(clean, max);
  if (kind === "name" && !/^[\p{L}\p{N}·\-—_ ]+$/u.test(text)) {
    return { ok: false, text: "", reasons: ["name_format"] };
  }
  return { ok: true, text, reasons: truncated ? ["truncated"] : [] };
}

/** 危机窗口内的自动回复只允许固定文本，避免模型自由发挥。 */
export function buildCrisisReply(): string {
  return CRISIS_REPLY;
}
