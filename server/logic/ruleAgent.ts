/**
 * ruleAgent.ts — 「游戏规则讲解员」智能体（移植自 郑先隽-PBL/GameInstruction 的 main.py + game_skills.py）
 *
 * 架构与原 Python 智能体完全一致：
 *   LLM(DeepSeek) + Harness(本文件) + 记忆(由前端携带的对话历史) + 检索技能(知识库文件)
 *
 *   第 1 步：相关性闸门（带上下文）——语义理解 + 实体核实，无关则礼貌拒绝
 *   第 2 步：按需检索——索引/读文件/读章节/讲解方法 精准取规则，再生成完整讲解
 *
 * 知识库文件位于 server/gameInstruction/（与原 GameInstruction 目录同源）。
 * 原有游戏功能不受影响：本模块只读知识库文件，不触碰任何游戏状态。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RULE_AGENT_GAME_NAME = "光阴对弈（The Time Gambit）";

/** 知识库目录：dist/logic/ruleAgent.js → ../../gameInstruction；可用环境变量覆盖 */
function resolveKnowledgeDir(): string {
  const fromEnv = process.env.RULE_AGENT_KB_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, "..", "..", "gameInstruction");
}

/** ============================ LLM 客户端配置 ============================
 * 默认与原智能体一致：DeepSeek 官方接口 + deepseek-flash。
 * 未配置 DeepSeek 密钥时，回退到本服务端自身的 OpenAI 兼容配置
 * （OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL，与 ai/llmClient.ts 同源）。
 */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-flash";

const deepseekKey = process.env.RULE_AGENT_API_KEY?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "";
const siteKey = process.env.OPENAI_API_KEY?.trim() || "";

const useDeepSeek = deepseekKey.length > 0;
const apiKey = useDeepSeek ? deepseekKey : siteKey;
const baseURL = useDeepSeek
  ? process.env.RULE_AGENT_BASE_URL?.trim() || DEEPSEEK_BASE_URL
  : process.env.OPENAI_BASE_URL?.trim() || undefined;
const MODEL = useDeepSeek
  ? process.env.RULE_AGENT_MODEL?.trim() || DEEPSEEK_MODEL
  : process.env.OPENAI_MODEL?.trim() || "gpt-4o";

export function isRuleAgentConfigured(): boolean {
  return apiKey.length > 0;
}

/** 代码开关：RULE_AGENT_ENABLED=false/0/off 时，前端完全不显示规则助手入口，接口也拒绝 */
export function isRuleAgentEnabled(): boolean {
  const v = (process.env.RULE_AGENT_ENABLED ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0" && v !== "off";
}

/** 把 LLM 回复中的 markdown 加粗/斜体标记（**x**、*x*、***x***）转换为中文引号 */
function prettifyReply(text: string): string {
  return text
    .replace(/(\*{1,3})([^*\n]+?)\1/g, "「$2」")
    // 折叠转换后可能出现的同向嵌套引号（如 **「x」** → 「「x」」）
    .replace(/「「/g, "「")
    .replace(/」」/g, "」");
}

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!isRuleAgentConfigured()) return null;
  if (!client) {
    client = new OpenAI({ apiKey, baseURL });
  }
  return client;
}

/** ============================ 检索技能（game_skills.py 移植） ============================ */

/** 知识库注册表：文件名 → 用途说明（与原智能体一致的白名单） */
const KNOWLEDGE: Record<string, string> = {
  "game_skills.md": "总览：游戏目标/阶段流程/精力财富/项目/结算/道具/拍卖/人格/主持/速查表",
  "rules_framework.md": "规则框架：阶段流程、精力财富、项目类型、结算流程、排名奖励",
  "rules_special_details.md":
    "规则细节：8张道具卡逐项、结算特例、拍卖、咖啡/彩票、聊天、主持、AI、开关",
  "data_projects.md": "项目卡数据：25张项目卡完整数值与回报",
  "data_buff_cards.md": "道具卡数据：8张道具卡完整描述与拍卖场次",
  "data_eras_bonuses.md": "时代卡数据：5张时代卡与时代加成",
  "data_numeric_config.md": "数值常量：财富/精力/咖啡/倒计时/拍卖/排名缩放",
  "data_persona_genes.md": "人格数据：命运素描、决策基因16型、MBTI四轴",
};

const AGENT_PROMPT_FILE = "agent.md";
const GUIDE_FILE = "rule_skill.md";

function kbPath(name: string): string {
  return path.join(resolveKnowledgeDir(), name);
}

function readKnowledge(name: string): string {
  if (!(name in KNOWLEDGE) && name !== AGENT_PROMPT_FILE && name !== GUIDE_FILE) return "";
  try {
    return fs.readFileSync(kbPath(name), "utf-8");
  } catch {
    return "";
  }
}

interface Heading {
  title: string;
  level: number;
}

function extractHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  for (const ln of text.split("\n")) {
    const s = ln.trim();
    if (s.startsWith("#")) {
      const level = ln.length - ln.replace(/^#+/, "").length;
      out.push({ title: s.replace(/^#+/, "").trim(), level });
    }
  }
  return out;
}

/** 命令:索引 —— 列出全部文件及其章节目录 */
function listIndex(): string {
  const lines = ["【知识库索引】文件名 — 用途（其下为章节）："];
  for (const [name, desc] of Object.entries(KNOWLEDGE)) {
    lines.push(`\n■ ${name} — ${desc}`);
    const text = readKnowledge(name);
    if (!text) {
      lines.push("   （文件不存在）");
      continue;
    }
    for (const h of extractHeadings(text)) {
      if (h.level === 2) lines.push(`   - ${h.title}`);
      else if (h.level === 3) lines.push(`     · ${h.title}`);
    }
  }
  return lines.join("\n");
}

/** 命令:读文件|文件名 */
function readFileSkill(name: string): string {
  if (!(name in KNOWLEDGE)) {
    return `错误：未知文件『${name}』。可用文件：${Object.keys(KNOWLEDGE).join("、")}`;
  }
  const text = readKnowledge(name);
  if (!text) return `错误：文件 ${name} 不存在`;
  return text;
}

/** 命令:读章节|文件名|关键词 —— 只读标题含关键词的那一小节 */
function readSectionSkill(name: string, keyword: string): string {
  if (!(name in KNOWLEDGE)) {
    return `错误：未知文件『${name}』。可用文件：${Object.keys(KNOWLEDGE).join("、")}`;
  }
  const text = readKnowledge(name);
  if (!text) return `错误：文件 ${name} 不存在`;

  const lines = text.split("\n");
  const kw = (keyword || "").trim();
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim();
    if (s.startsWith("#") && kw && s.includes(kw)) {
      start = i;
      break;
    }
  }
  if (start === null) {
    const heads = lines.filter((l) => l.trim().startsWith("#")).map((l) => l.trim());
    return `未在 ${name} 中找到含『${kw}』的章节。可选章节：\n${heads.join("\n")}`;
  }
  const level = lines[start].length - lines[start].replace(/^#+/, "").length;
  const out: string[] = [lines[start]];
  for (const ln of lines.slice(start + 1)) {
    const s = ln.trim();
    if (s.startsWith("#")) {
      const lvl = ln.length - ln.replace(/^#+/, "").length;
      if (lvl <= level) break;
    }
    out.push(ln);
  }
  return out.join("\n");
}

/** 命令:讲解方法 —— 加载讲解方法专家指南 */
function loadExplainGuide(): string {
  const md = readKnowledge(GUIDE_FILE);
  if (!md) return "错误：未找到 rule_skill.md";
  return `请先学习以下讲解方法，再组织你的回答：\n${md}`;
}

/** ============================ 游戏实体清单（相关性闸门用） ============================ */

const ENTITY_DATA_FILES = [
  "data_eras_bonuses.md",
  "data_buff_cards.md",
  "data_projects.md",
  "data_persona_genes.md",
];

interface ParsedTable {
  header: string[];
  rows: string[][];
}

function parseTables(text: string): ParsedTable[] {
  const lines = text.split("\n");
  const out: ParsedTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const s = lines[i].trim();
    if (s.startsWith("|") && s.slice(1).includes("|")) {
      const header = s.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const rows: string[][] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith("|")) {
        const cells = lines[j]
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
        // 跳过 |---|---| 分隔行
        if (!cells.every((c) => !c || [...c].every((ch) => "-: ".includes(ch)))) {
          rows.push(cells);
        }
        j++;
      }
      out.push({ header, rows });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

function tableColumn(text: string, colname: string): string[] {
  const vals: string[] = [];
  for (const { header, rows } of parseTables(text)) {
    if (!header.includes(colname)) continue;
    const idx = header.indexOf(colname);
    for (const r of rows) {
      const v = idx < r.length ? r[idx] : "";
      if (v && !vals.includes(v)) vals.push(v);
    }
  }
  return vals;
}

const entityCache = new Map<string, string[]>();

function entityNames(): string[] {
  const cached = entityCache.get("names");
  if (cached) return cached;
  const names: string[] = [];
  for (const fname of ENTITY_DATA_FILES) {
    for (const n of tableColumn(readKnowledge(fname), "名称")) {
      if (n && !names.includes(n)) names.push(n);
    }
  }
  entityCache.set("names", names);
  return names;
}

function eraThemes(): string[] {
  const cached = entityCache.get("themes");
  if (cached) return cached;
  const themes: string[] = [];
  for (const { header, rows } of parseTables(readKnowledge("data_eras_bonuses.md"))) {
    const idx = header.findIndex((h) => h.startsWith("主题") && !h.includes("色"));
    if (idx === -1) continue;
    for (const r of rows) {
      const v = idx < r.length ? r[idx] : "";
      if (v && !themes.includes(v)) themes.push(v);
    }
  }
  entityCache.set("themes", themes);
  return themes;
}

function entityHint(): string {
  const names = entityNames();
  const themes = eraThemes();
  return (
    `时代主题只有 ${themes.length} 个：${themes.join("")}。\n` +
    `游戏内实体（共 ${names.length} 个，只有这些才是游戏内容）：${names.join("")}`
  );
}

/** ============================ 相关性闸门（main.py 移植） ============================ */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const CONTEXT_TURNS = 6;
const CONTEXT_CHARS = 150;

function buildContext(history: ChatTurn[], turns = CONTEXT_TURNS, limit = CONTEXT_CHARS): string {
  const lines: string[] = [];
  for (const m of history) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const c = (m.content || "").trim();
    if (!c || c.startsWith("系统返回：") || c.startsWith("[上下文提示]")) continue;
    const clipped = c.length > limit ? c.slice(0, limit) + "…" : c;
    lines.push((m.role === "user" ? "玩家：" : "讲解员：") + clipped);
  }
  return lines.slice(-turns).join("\n");
}

const TIME_THEMES = eraThemes().join("、");
const THEME_COUNT = eraThemes().length;

const JUDGE_PROMPT =
  `你是「${RULE_AGENT_GAME_NAME}」这款桌游助手的提问分类器。\n` +
  "任务分两步，都必须做完才能给结论：\n" +
  "【第一步 · 语义理解】结合【对话上下文】，弄清当前这句话真正在问什么（指代词指向谁、有没有省略主语）。\n" +
  "【第二步 · 实体核实】把问题指向的对象，逐一对照下面的游戏实体清单，确认它是否真的存在于本游戏中。\n\n" +
  `【游戏的真实范围】\n${entityHint()}\n` +
  "机制类内容同样算游戏内容：开局与回合流程、精力与财富、项目投资与回报、超投惩罚、结算与排名奖励、" +
  "拍卖与竞价、道具使用与拍卖场次、主持与 AI、人格分析、咖啡与彩票玩法、时代加成、人数与时长、获胜条件。\n\n" +
  "【判定规则】\n" +
  "1. 问题指向的对象在清单内，或问的是上列机制 → 相关。\n" +
  "2. 承接上文的追问（用「它/这个/第二个」指代，或省略主语），且上下文能唯一确定指代对象 → 相关。\n" +
  "3. 词对上了但实体不存在 → **无关**。典型：「80年代时代」——" +
  `本游戏的「时代」只是 ${TIME_THEMES} 这 ${THEME_COUNT} 张主题卡，不分历史年代，游戏里没有「80年代」，故无关。\n` +
  "4. 借用了同名词的现实话题 → 无关。如「现实里的彩票/保险/咖啡怎么买」「某只股票值不值得投资」" +
  "「新能源汽车行业前景」「帮我写个抽奖程序」。\n" +
  "5. 与游戏无关的通用话题（天气、编程、历史、其他游戏、影视、闲聊问候）→ 无关。\n" +
  "6. 只要无法确认问题指向清单中的任一实体或上列机制，就判「无关」，不要替用户脑补成游戏内容。\n\n" +
  "只回答「相关」或「无关」两个词之一，不要任何解释。";

async function judgeByModel(question: string, context: string): Promise<string> {
  const openai = getClient();
  if (!openai) throw new Error("LLM not configured");
  const userBlock =
    `【对话上下文】\n${context || "（暂无，这是本局第一句）"}\n\n【当前问题】\n${question}`;
  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      { role: "user", content: userBlock },
    ],
    temperature: 0, // 判定要稳定，不要发挥
  });
  return (resp.choices[0]?.message?.content || "").trim();
}

function politeRefuse(): string {
  return (
    `抱歉，我是一个专门讲解「${RULE_AGENT_GAME_NAME}」游戏规则的助手，\n` +
    "您的问题似乎与游戏内容无关，我暂时无法为您解答。\n" +
    "如果您想了解本游戏的玩法、回合流程、项目投资或道具卡，欢迎随时提问！\n" +
    `（提示：本游戏的「时代」指 ${TIME_THEMES} 这 ${THEME_COUNT} 张主题卡，并不对应历史年代。）`
  );
}

/** ============================ 命令分发与内层循环 ============================ */

const MAX_INNER_STEPS = 20;

function extractAction(reply: string): string {
  const text = reply.trim().replace(/命令：/g, "命令:").replace(/完成：/g, "完成:");
  if (text.startsWith("完成:")) return text; // 「完成」保留完整讲解（多行）
  if (text.startsWith("命令:")) return text.split("\n")[0].trim(); // 「命令」只取第一行
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s.startsWith("命令:") || s.startsWith("完成:")) return s;
  }
  return "";
}

function dispatch(commandLine: string): string {
  const raw = commandLine.slice("命令:".length).trim();
  const parts = raw.split("|").map((p) => p.trim()).filter((p) => p !== "");
  const skillName = parts[0] ?? "";
  const args = parts.slice(1);

  if (skillName === "索引") return listIndex();
  if (skillName === "读文件") {
    if (!args.length) return "错误：读文件需要文件名参数。格式：命令:读文件|文件名";
    return readFileSkill(args[0]);
  }
  if (skillName === "读章节") {
    if (args.length < 2) return "错误：读章节需要两个参数。格式：命令:读章节|文件名|关键词";
    return readSectionSkill(args[0], args[1]);
  }
  if (skillName === "讲解方法") return loadExplainGuide();
  return "错误：未知技能。可用：索引 / 读文件 / 读章节 / 讲解方法";
}

/** 系统提示词：agent.md 原文（与原智能体一致，勿改动其内容） */
let cachedSystemPrompt: string | null = null;
function loadSystemPrompt(): string {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt;
  const md = readKnowledge(AGENT_PROMPT_FILE);
  cachedSystemPrompt = md || "你是「光阴对弈（The Time Gambit）」的规则助手。";
  return cachedSystemPrompt;
}

export interface RuleAgentResult {
  relevant: boolean;
  reply: string;
}

/**
 * 跑一轮完整的智能体问答（相关性闸门 + 追问消歧 + 检索内层循环）。
 * history 为前端携带的可见对话（user/assistant 交替），等价于原 CLI 的 messages 记忆。
 */
export async function runRuleAgentTurn(history: ChatTurn[], question: string): Promise<RuleAgentResult> {
  const openai = getClient();
  if (!openai) {
    return {
      relevant: false,
      reply: "规则助手暂未配置 API 密钥，请联系管理员在服务端 .env 中配置 DEEPSEEK_API_KEY。",
    };
  }

  // ---- 第 1 步：相关性闸门（语义理解 + 游戏实体核实，无关键词捷径）----
  let relevant = false;
  try {
    const answer = await judgeByModel(question, buildContext(history));
    relevant = answer.includes("相关") && !answer.includes("无关");
  } catch (e) {
    console.warn(`[ruleAgent] 相关性判定接口异常（${(e as Error).name}），本轮按无关处理。`);
    return { relevant: false, reply: politeRefuse() };
  }
  if (!relevant) {
    return { relevant: false, reply: politeRefuse() };
  }

  // ---- 追问消歧：把上一问一并写进本轮消息，帮助讲解员理解指代词 ----
  const lastUserQuestion = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const stored = lastUserQuestion
    ? question +
      "\n" +
      `[上下文提示] 上一问是「${lastUserQuestion.slice(0, 40)}」。` +
      "若本句是在指代上一问的内容，请先结合对话历史确定指代对象，再用命令检索对应规则作答。"
    : question;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: loadSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: stored },
  ];

  // ---- 第 2 步：按需检索 + 生成完整回复（内层循环）----
  const usedCmds = new Set<string>();
  for (let steps = 0; steps < MAX_INNER_STEPS; steps++) {
    const response = await openai.chat.completions.create({ model: MODEL, messages });
    const reply = (response.choices[0]?.message?.content || "").trim();
    messages.push({ role: "assistant", content: reply });

    const action = extractAction(reply);

    if (action.startsWith("完成:")) {
      return { relevant: true, reply: prettifyReply(action.slice("完成:".length).trim() || reply) };
    }

    if (action.startsWith("命令:")) {
      if (usedCmds.has(action)) {
        messages.push({
          role: "user",
          content:
            "系统返回：该检索本次已执行过，结果同上。不要重复同一条命令，请换关键词，或直接输出 完成:你的讲解。",
        });
        continue;
      }
      usedCmds.add(action);
      messages.push({ role: "user", content: `系统返回：${dispatch(action)}` });
      continue;
    }

    // 既不是「完成」也不是「命令」：提醒 LLM 遵守格式，避免死循环
    messages.push({
      role: "user",
      content: "请严格按格式回复：要么 命令:…（每次只写一条）要么 完成:…",
    });
  }

  return { relevant: true, reply: "规则助手本轮检索步数达到上限，请换个问法再试一次。" };
}
