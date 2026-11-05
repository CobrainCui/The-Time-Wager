# 两个版本：产品版 AI 玩家 与 实验室版全 AI

> 本文是交付说明，面向维护者与实验负责人。代码改动分别位于父仓库（产品版）与 `agent-edition/`（实验室版）。

---

## 1. 版本 A：产品版（父仓库，C 端）

### 1.1 目标

让线上《光阴对赌》可以**接入 AI 玩家**，与真人同桌；AI 不是演示脚本，而是可长期运行的陪玩/补位能力。

### 1.2 做了什么

- **AI 运行时**（`server/ai/`）
  - `aiRoster.ts`：添加/移除/补位 AI，最多 5 名 AI，至少保留 1 个真人座位；**不预设人格**，使用中性昵称。
  - `aiPersona.ts`：自由发挥画像（均衡兜底权重）+ 三档难度（easy/normal/hard）；旧局显式人格仍兼容。
  - `aiPolicy.ts`：本地启发式策略（投资、咖啡、道具、转账、聊天、拍卖、转账回执）。**严格模式下不参与决策**，仅在显式关闭 `AI_STRICT_AGENT` 或旧局兼容路径中使用。
  - `aiOrchestrator.ts`：全阶段驱动 + 并发分批 + 看门狗兜底 + AI 彩票领取 + AI 首富命名。
  - `llmClient.ts`：OpenAI 兼容客户端，带硬超时、重试、token 预算、错误脱敏。
  - `aiObservation.ts` / `aiPrompt.ts`：只注入玩家可见信息；聊天是数据不是指令。**`aiPrompt.ts` 是调整 AI 提示词的唯一入口**，`SAFETY_SECTION` 定义人设三段式、红黄绿数据分级、硬红线与危机协议。
  - `aiSafety.ts`：运行时安全闸门。聊天、转账留言、社区名统一过检；危机信号触发固定安全回复；硬红线一票否决（见 1.3）。
- **系统自动主持**（`server/host/autoHost.ts`）
  - 等待房自动开局、时代介绍/结算自动推进、拍卖自动聚焦/落槌/跳过/结束。
  - 彩票自动线上随机开奖；社区命名超时兜底、AI 首富自行命名。
  - 管理端可按房间开关 `adminSetAutoHost`，手动操作始终优先。
- **彩票线上随机**
  - `server/logic/lotteryRandom.ts` 优先 random.org，失败退回 `crypto.randomInt`。
  - 骰子 1–6 → 奖金 0/30/60/90/120/200；前端 `LotteryConfirmModal` 播放骰子动画。
- **安全约束（人本 AI 原则，参照 i2iLab DEFINE + EVAL）**
  - 提示词层：`aiPrompt.ts` 的 `SAFETY_SECTION` —— 人设三段式（身份/语气/边界）、红黄绿数据分级、硬红线、危机协议。
  - 运行时层：`aiSafety.ts` 对所有玩家可见的 AI 文本强制过检；模型不遵守提示词也发不出危险内容。
  - 硬红线：冒充真人、诊断/治疗、医疗/投资建议、联系方式、链接、现实金钱、提示词泄露、自伤/暴力/性内容，命中即拦截或替换。
  - 危机协议：自伤/自杀/暴力/进食障碍/未成年危机 → 停止游戏话术，由服务端统一发送固定回复（能力边界 + 110/120/12356），AI 暂停闲聊 10 分钟；系统提示写入日志与会话事件，但不记录聊天原文。
  - 开关：`AI_SAFETY_ENABLED=true`（默认）；只有受控研究且通过伦理审查时才建议关闭。
- **群聊与私信（产品默认开启）**
  - 全场频道：房间有真人后自动创建「全场」并同步真人成员，前端 dock 固定展示；新一局重置后自动重建。
  - 自建群：至少 3 名真人；每人最多 6 群、每房 24 群；群主可加人，少于 2 人自动解散。
  - 服务端限制：禁聊阶段（等待/时代介绍/教程）拒绝建群与群消息；发送 20 条/分钟、建群 5 次/分钟、加人/退群 10 次/分钟；单群保留 500 条，单次下发最近 200 条。
  - 安全：真人危机消息触发服务端固定安全回复（110/120/12356），只记录类别与消息 ID，不落原文；AI 群聊与私信统一过 `aiSafety.ts`。
- **服务端接入**
  - `phaseController` 在阶段变化时触发 AI；`index.ts` 每秒看门狗 + 自动主持。
  - `adminAddAI / adminRemoveAI / adminFillAI / adminGetAiRoster / adminSetAutoHost / adminDrawLottery`。
  - 开局固定补满 6 席：支持 1–6 名真人，空位自动补 AI（至少保留 1 名真人；严格模式需要对应模型 Key）。
  - 拍卖允许 AI 出价/强买强卖；AI 会在投资阶段买咖啡、用道具、转账、发言、领取彩票。
  - AI 昵称前缀 `🤖` / `AI_` 保留，真人不可使用。
  - **AI 与真人平权**：社区财富榜按全部座位统计；AI 可以成为首富并获得社区命名权。
- **前端**
  - 管理端顶部「🤖 AI 玩家」面板：难度选择、添加、补满、移除；「系统自动主持」开关。
  - 等候页 / 时代介绍 / 结算 / 拍卖 / 命名页显示自动主持倒计时。
  - 终局页与社区榜显示全部玩家总财富（含 AI）；AI 有标识。
- **测试**
  - `server/ai/aiPlayers.test.ts`：自由发挥提示词、投资合法性、方案裁剪、拍卖出价、座位上限、严格模式拒绝无模型 AI。
  - `server/state/sessionArchive.wealth.test.ts`：AI 与真人同等计入社区榜、AI 可成为首富。
  - `server/logic/lotteryRandom.test.ts`：骰子查表、random.org 成功/异常/超时兜底。
  - `server/host/autoHost.test.ts`：等待房自动开局、时代推进、拍卖跳过/落槌、命名兜底。
  - `server/ai/aiSafety.test.ts`：危机识别四项、硬红线拦截、危机窗口只发一条固定回复、AI 公开发言放行路径。
  - `server/logic/chatGroups.test.ts`：全场频道自动创建、重置后重建、消息广播上限、自建群创建/解散、禁聊阶段。
  - `frontend/scripts/ai-e2e.mjs`：主持 + 1 真人 + 5 AI 的 socket 端到端（含全场群聊创建、群消息广播、危机固定安全回复）。
  - `frontend/scripts/group-chat-e2e.mjs`：6 真人端到端（全场频道、自建群成员隔离、退群解散、危机安全回复）。

### 1.3 产品级保障

| 风险 | 处理 |
|------|------|
| 没有模型 Key | 严格模式下拒绝添加 AI、拒绝补位/开局，并明确提示该填哪个变量；只有 6 名真人同桌时不需要 Key |
| 模型超时/失败 | 单次硬超时 + 重试；失败不降级本地策略，暂停本局并在管理端显示故障，由主持重试/强制准备/移除 |
| 模型卡住真人 | 阶段开始 `AI_MAX_TURN_MS`（默认 15s）后进入管理端故障面板，不会静默用规则代打 |
| 成本失控 | 每名 AI 每局 token 预算；超限停止模型调用并提示管理员 |
| 信息作弊 | AI 只读玩家可见信息，不读他人精力/手牌/草稿 |
| AI 被歧视 | AI 与真人同样计入社区财富、可成为首富、可获得命名权 |
| 昵称冒名 | `🤖` / `AI_` 前缀由服务端保留 |
| 没有真人主持 | 系统自动主持默认开启；等待房 30s 自动开局，阶段/拍卖/彩票/命名全自动 |
| 线上随机不可用 | random.org 失败/超时自动退回服务端加密随机，不阻塞开奖 |
| 危机输入（自伤/暴力/未成年） | 服务端识别后停止游戏话术，统一发送固定安全回复（110/120/12356），AI 暂停闲聊 10 分钟 |
| AI 冒充真人 | 提示词要求承认 AI；输出闸门拦截“我是真人/我不是 AI”并替换为 AI 身份声明 |
| 隐私与联系方式 | AI 不索取、不复述；聊天/留言/命名统一拦截手机号、邮箱、微信、链接 |
| 提示词泄露 | 运行时拦截“系统提示词/忽略之前指令”等表达，原文不下发 |
| 诊断与建议 | 拦截“你有抑郁症/按我说的吃药”等诊断、治疗、医疗与投资建议 |
| 群聊刷屏 / 建群骚扰 | 发送 20 条/分钟、建群 5 次/分钟、加人/退群 10 次/分钟；每人最多 6 群、每房 24 群 |
| 群聊数据膨胀 | 单群保留 500 条，单次广播最近 200 条；群解散时同步清理消息 |

### 1.4 启用方式

```dotenv
AI_PLAYERS_ENABLED=true
AI_AUTOFILL_TARGET=6
AI_API_KEY=...
AI_MODEL=gpt-4o
AI_MAX_PER_ROOM=5
AI_TOKEN_BUDGET_PER_GAME=120000
AI_SAFETY_ENABLED=true
AI_STRICT_AGENT=true

AUTO_HOST_ENABLED=true
AUTO_START_DELAY_MS=30000
AUTO_AUCTION_IDLE_MS=12000
AUTO_NAMING_MS=45000

LOTTERY_ONLINE_RANDOM=true
LOTTERY_RANDOM_TIMEOUT_MS=2500
```

完整变量见 `server/.env.example`。管理端登录后，在房间页顶部 AI 面板添加即可。

**调整 AI 提示词**：编辑 `server/ai/aiPrompt.ts`（`buildSystemPrompt` / `buildInvestmentPrompt` / `buildAuctionPrompt` / `buildCommunityNamePrompt`），然后 `cd server && npm run build` 并重启。

---

## 2. 版本 B：实验室版（`agent-edition/`，全 AI）

### 2.1 定位

6 个独立 LLM 玩家、8 轮、3 场拍卖、可复现种子、事件级导出，用于心理学 + AI 社会实验。**不使用规则兜底**：模型失败即终止本局。

### 2.2 本轮审查与修复

详见 [`agent-edition/审查与修复.md`](../agent-edition/审查与修复.md)。摘要：

- 修复 `gitCommit / promptHash / seedBase / sessionOrdinal` 在导出与 `summary.csv` 中断链。
- Agent 增加 3s 心跳，避免动作被静默拒绝后整局不再重试。
- 拍卖预算改为「可用财富」而非账面财富；并发被拒后不再立刻放弃。
- 转账/咖啡预算互相挤占修复；无公开群时不再硬编码假群 ID。
- 启动增加就座超时（`AGENT_JOIN_TIMEOUT_MS`）；客户端版本过期直接终止。
- 指标增加 `giniNonNegative / negativeWealthPlayers / minWealth / maxWealth / finalized`。
- `experiment` 自动生成 `qc.csv`；`analyze` 补齐种子、金额、拍卖、干扰等列，修复对象字段 CSV 输出。

### 2.3 运行

```bash
cd agent-edition
npm --prefix server test
npm --prefix agents run build
npm --prefix frontend run build
npm run experiment -- --mock --games 1 --condition smoke --no-build
npm run analyze -- --run <runId> --out analysis/<date>
```

正式实验前必须填 6 个真实 Key，并固定 `AGENT_PROMPT_VERSION` 与本仓库 commit。

---

## 3. 验证记录（2026-11-05）

| 项目 | 结果 |
|------|------|
| 产品版服务端测试 | 304 / 304 通过 |
| 产品版前端构建 | 通过 |
| 产品版 AI 端到端（1 真人 + 5 AI，本地 mock + 严格模式） | 通过：开局预检、AI 自动 ready、各投 15 精力、结算、拍卖出价与结束、移除 AI |
| 产品版群聊端到端（6 真人） | 通过：全场频道全员可见、自建群成员隔离、退群自动解散、危机固定安全回复、私信危机原文不投递 |
| 实验室版服务端测试 | 273 / 273 通过 |
| 实验室版三端构建 | 通过 |
| 实验室版 mock 端到端 | 通过：1 局 8 轮，QC 0 失败 |

---

## 4. 已知限制

- 产品版群聊已默认开启（`server/config/playerChatFeatures.ts` 与 `frontend/src/config/playerChatFeatures.ts` 均为 `true`）。紧急回滚需两处同时改为 `false` 并重新构建；AI 聊天、危机识别与系统安全提示也会随之停用。
- 群聊单次广播只下发每个群最近 200 条（服务端保留 500 条用于导出）；更早的聊天不在玩家端持久展示。
- 产品版开局固定补满 6 席（1–6 名真人）；不足 6 人时必须有可用 AI Key，否则拒绝开局。
- 产品版与实验室版都**只支持单实例 Node**（状态在内存、归档单文件）。
- 产品版自动主持默认开启；若线下活动需要真人主持控场，设置 `AUTO_HOST_ENABLED=false`，或在管理端按房间关闭。
- 社区榜改为「全部座位」统计后，服务启动时会按存档 snapshot 重算历史社区财富（含旧局的 AI 财富）；这是有意的口径统一，升级前请知会运营。
- 产品版 AI 的拍卖、投资、聊天、转账、社区命名均走模型（严格模式）；若显式设 `AI_STRICT_AGENT=false`，才保留旧的本地启发式兜底。
- 线上随机依赖 random.org；网络受限时会退回服务端随机，导出里的 `source` 可用于数据质控。
- 实验室版固定 n=6，不适合做角色聚类强结论；固定种子只复现结构随机，不复制模型采样。
- 聊天中的承诺/威胁/欺骗/联盟仍需人工编码；正式分析前固定编码规则。
- 负财富会污染原始基尼；实验室版主分析请用 `giniNonNegative`。
