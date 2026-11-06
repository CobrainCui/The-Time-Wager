# The Time Gambit (光阴对弈)

"The Time Gambit" is a strategic multiplayer game spanning four life stages. Players invest their limited energy into short-term gains, long-term assets, or high-risk ventures to build wealth. Negotiate, cooperate, or backstab rivals using powerful strategy cards. Master the balance between instant gratification and lasting value!

**光阴对弈** 是一款跨越人生四大阶段的多人心理策略桌游。玩家需要在游戏中合理分配有限的“精力”，投资于短期收益、长期资产或高风险项目以积累“财富”。你可以与对手结盟、谈判，或者使用强力的策略道具卡背刺他们。在即时满足与长期价值之间寻找完美平衡，解锁你的决策密码！

> 第一次接触本项目、或需要把两个版本跑起来给研究/运营同学用，请先看 **[实施使用说明.md](实施使用说明.md)**（逐步操作 + 填 Key 的位置 + 验收清单）。本 README 偏向开发与部署。

## 🎯 Features | 核心机制

- **Four Life Stages (四大时代)**: Youth (青年), Prime (壮年), Middle Age (中年), Old Age (老年).
- **Investment Strategy (投资策略)**: Balance your portfolio between short-term tasks (quick wins), long-term visions (heavy investment, high payoff), and risk ventures.
- **Social Interaction (社交互动)**: Negotiate with up to 6 players, cooperate to fund large projects, or use buff cards to disrupt your opponents (e.g., "Slack Virus" 摸鱼传染, "Shield" 反弹护盾).
- **Group Chat (群聊与私信)**: 进房自动创建「全场」频道，支持自建小群、未读提醒与消息通知；**真人和 AI 都可以自己拉群**；禁聊阶段自动屏蔽，AI 发言统一过安全闸门。
- **AI Players (C 端陪玩)**: 等待房房主可直接选 **AI 人数（3–5 名）与难度**，开局自动补位；**不预设人格**，由模型根据局面自由发挥。**严格 Agent 模式**下 AI 全程走模型；未配置或未连通模型时拒绝补位/开局，并明确提示原因。
- **自助开局（无需主持）**: 首页填昵称 →「开始一局」自动建房进等待房；房主选 AI 人数和难度 →「开始对局」，也可以把邀请链接发给朋友一起玩。
- **Auto Host (系统自动主持)**: 产品版默认由系统自动开局、推进阶段、主持拍卖、线上随机开奖与社区命名兜底，C 端无需真人主持。
- **AI Auto-Tuner (内部调参)**: 离线批量模拟，用于校验人格判定与数值平衡。

## 🛠️ Tech Stack | 技术栈

- **Frontend**: React + Vite, TypeScript, Vanilla CSS (Custom UI/UX with Classical Navy & Gold aesthetics).
- **Backend**: Node.js, Socket.IO (Real-time synchronization), Express.
- **AI Integration**: OpenAI SDK for simulating player behavior.

## 🚀 How to Run | 运行项目

### 1. Backend Server (服务端)

在 `server/.env` 中配置管理密钥（可参考 `server/.env.example`）：

```bash
ADMIN_TOKEN=你的长随机密钥
```

生产环境未设置 `ADMIN_TOKEN` 时服务将拒绝启动。

```bash
cd server
npm install
npm run start
# Server will run on http://localhost:3001
```

### 2. Frontend Client (客户端)

```bash
cd frontend
npm install
npm run dev
# 玩家端 http://localhost:5173/
# 管理端 http://localhost:5173/admin.html
```

开发环境下 Vite 会将 `/socket.io` 与 `/api` 代理到 `localhost:3001`。

### 3. 生产部署与管理后台

- **玩家**：`https://guangyinduidu.com`
- **管理员**：`https://admin.guangyinduidu.com`（登录页输入与服务器 `ADMIN_TOKEN` 相同的密钥）

宝塔/Nginx 上请为 **主域与管理子域** 均配置与现网一致的反代（端口以 pm2 为准，示例 `3001`）：

- `location /socket.io/` → Node
- `location /api/` → Node
- `location ^~ /uploads/`、`location ^~ /uploads_eras/`、`location ^~ /uploads_buffs/`、`location ^~ /uploads_personas/` → Node（上传图片静态资源；建议使用 `^~` 避免被站点内「按后缀匹配 jpg」的规则拦截）

开发环境下 Vite 还会代理上述三个 `/uploads*` 路径到 `localhost:3001`。

管理子域站点 `root` 指向 `admin.guangyinduidu.com` 目录。CI 部署会将 `admin.html` 复制为 `index.html`，使子域根路径即为管理入口（无需额外 Nginx 重写）。

在 pm2 工作目录的 `server/.env` 中配置 `ADMIN_TOKEN` 后执行 `pm2 restart`。

**仅支持单实例 Node**（`pm2 start` 一个进程）。不可使用 `pm2 start -i max` / cluster：局内状态在内存、归档文件非多进程安全。HTTP 与 Socket 限流也是进程内计数，扩容到多实例前必须迁到共享存储；Nginx 侧仍应配置连接限流。

可用环境变量 `ALLOWED_ORIGINS`（逗号分隔）覆盖 CORS 白名单；生产默认仅允许玩家主域与管理子域。

**数据备份**：以 `server/data/session_archive.json` 为唯一真相。社区财富榜在启动与归档时由档案派生，不再单独落盘。

**管理后台「验证超时」**（WebSocket 已连上但 15 秒无响应）：说明 Node 未处理 `adminAuthenticate`，多为 **server 未部署最新 `dist`**。在服务器执行：

```bash
cd /www/wwwroot/guangyinduidu.com/server
grep adminAuthenticate dist/network/socketHandlers.js   # 应有输出
npm run build
pm2 restart guangyin
pm2 logs guangyin --lines 30   # 登录时应出现 [admin] authenticate request / ok
```

`.env` 格式：`ADMIN_TOKEN=密钥`（等号两侧勿加空格）。错误密钥应立刻提示「密钥无效」，不应等到超时。

**投资阶段「来杯咖啡」买了咖啡但左侧不出现 ☕ 退订图标**（财富已 -17、精力已 +1）：多为 **服务端 `dist` 未含 `coffeePurchasesThisRound` 广播字段**。浏览器 DevTools → Network → WebSocket → 最新 `gameUpdate`，在己方 `players[]` 中查看 `coffeePurchasesThisRound` 是否 ≥1。服务器上：

```bash
grep coffeePurchasesThisRound /www/wwwroot/guangyinduidu.com/server/dist/network/broadcast.js
grep performCoffee /www/wwwroot/guangyinduidu.com/server/dist/network/socketHandlers.js
cd /www/wwwroot/guangyinduidu.com/server && npm run build && pm2 restart guangyin
```

合并含咖啡功能的提交到 `main` 并跑通 GitHub Deploy 后，硬刷新玩家页再测。

**投资倒计时「暂停 / 继续 / 重置」在 Admin 不显示或点了无效**：多为 **管理前端或 server dist 未同步更新**。投资阶段顶栏应始终显示 `⏱ M:SS`，旁有「暂停/继续」「重置」。服务器自检：

```bash
# 后端事件与广播字段
grep adminInvestmentTimer /www/wwwroot/guangyinduidu.com/server/dist/network/socketHandlers.js
grep investmentTimerPausedAt /www/wwwroot/guangyinduidu.com/server/dist/network/broadcast.js

# 管理前端 bundle（子域）
grep -l adminInvestmentTimer /www/wwwroot/admin.guangyinduidu.com/assets/admin-*.js

# pm2 必须跑 dist（script 应为 .../server/dist/index.js）
pm2 describe guangyin | grep -E "script path|exec cwd"
```

若 grep 无输出：将含本功能的提交合并到 `main` 触发 Deploy，或本机 `frontend`/`server` 分别 `npm run build` 后按 CI 同路径覆盖并 `pm2 restart guangyin`。部署后对 `admin.guangyinduidu.com` **硬刷新**（Ctrl+F5）。WebSocket `gameUpdate` 在暂停时应带 `investmentTimerPausedAt` 数字。

## 🤖 AI 玩家（产品版）

AI 玩家由服务端托管，和真人走同一套规则、同一个阶段判定与同一份广播协议。等待房里房主可以直接调 **AI 人数**（总人数 4–6）和 **难度**（简单 / 普通 / 困难）；管理端「🤖 AI 玩家」面板仍可补位、移除或逐个指定。

- **不预设人格**：产品版 AI 没有固定人设，提示词只给规则、目标与当前局面，由模型自由发挥、形成自己的打法。旧局或手动指定人格的 AI 仍然兼容。
- **基本平权**：AI 可以拍卖出价、可以成为首富、可以获得社区命名权；社区总财富榜按全部座位统计（含 AI）。
- **全流程托管**：开局按「真人 + 房主选的 AI 人数」补座（4–6 人；真人超过目标时 AI 自动让位）；AI 自动 ready，投资、买咖啡、用道具、转账、拍卖出价、彩票领取、结算准备全部自动完成。
- **AI 首富命名**：社区命名阶段若在线首富是 AI，AI 会自己生成社区名；严格模式下如果模型失败，不会改用本地名称池，而是等待主持处理。
- **AI 也可以拉群**：AI 在投资阶段可以像真人一样创建自定义群、邀请至少 2 名其他玩家，并在自己所在的群里发言；群聊只对成员可见。
- **不暴露对手身份**：AI 的观察里没有其他座位的 `isAI / isAgent / agentModel / agentProvider`，玩家昵称与 ID 也不带 AI 标记；AI 只能从行为和聊天内容推断对手。真人玩家端仍可在管理/玩家界面看到 AI 标识。
- **终局社交自动评定**：`GAME_OVER` 时按每名玩家**自己发出**的群聊 + 私信（含 0 元转账留言）内容评 A–E（A=100 … E=20），结果写入会话归档与导出；主持人在后台手工评定的玩家优先，模型失败或没发言回退 C。开关：`SOCIAL_AUTO_SCORE`（默认 `true`）。

**每个 AI 可以用不同的 Key / 模型**（研究者常用）：在 `server/.env` 填写 `AI_PLAYER_1_API_KEY` … `AI_PLAYER_5_API_KEY`（以及对应的 `_BASE_URL` / `_MODEL` / `_PROVIDER`）。座位号 = 管理端添加 AI 的顺序；某座位留空则回退到共享 `AI_API_KEY`。改完执行：

```bash
cd server && npm run build && npm run check-ai -- --ping
```

管理端 AI 标签会显示「座位 n · provider:model」；严格模式下未配置 Key 的座位不能添加。

**严格 Agent 模式（默认开启，`AI_STRICT_AGENT=true`）：**

- **全程模型决策**：投资、道具、聊天、拉群、转账、拍卖出价、社区命名都走模型；不再用本地启发式策略代打。
- **不联网不能开局**：添加 AI 或点击开局前会做一次模型连通性检测（管理端「🔌 检测 AI 连接」），检测不通过时拒绝开局，并明确显示是哪个 AI、什么原因。
- **失败不静默降级**：局内模型失败会暂停投资倒计时、在管理端弹出故障横幅，由主持选择「重试 / 强制准备 / 移除」；不会偷偷换成本地策略。
- **纯真人局不受影响**：6 名真人同桌时不需要任何 Key；不足 6 人时由 AI 补位，严格模式下需要对应模型 Key。
- **工业级兜底**：单次调用硬超时 + 重试 + 连通性缓存 + token 预算；自动主持开局前也会先检测模型。演示环境如需旧行为可显式设 `AI_STRICT_AGENT=false`。
- **管理端手动兜底**：AI 面板提供「🔌 检测 AI 连接」「↻ 重试故障 AI」「强制准备」「清空 AI」「⏱ 延长 2 分钟」；故障横幅里可对单个 AI 重试/强制准备/移除，保留原有全部主持功能。

**产品级保障：**

- **不会卡房**：每名 AI 有单次决策硬超时；模型失败会进入管理端故障面板等待人工处理，不会让房间悄悄空转。
- **成本可控**：每名 AI 每局有 token 预算（`AI_TOKEN_BUDGET_PER_GAME`），超出后本局停止模型调用并提示管理员。
- **信息公平**：AI 只能看到玩家可见信息（自己的手牌/精力、公开项目、公开聊天），不读取他人精力或投资草稿。
- **昵称保留**：`🤖`、`AI_`、`AI1` 等 AI 风格前缀由服务端保留，真人不允许使用，避免被误判为 AI。

### 🛡️ AI 安全约束（人本 AI 原则）

参照 [i2iLab · DEFINE + EVAL](https://www.i2ilab.io/learn/define.html) 的人本 AI 原则，AI 输出有两层约束：**提示词层**说明边界，**运行时层**强制执行，模型不遵守提示词也发不出危险内容。

- **人设三段式**：身份（AI 玩家，不是真人/客服/专业人士）、语气（简短克制只谈游戏）、边界（现实问题一律不接）。
- **红黄绿数据分级**：绿=规则与公开信息；黄=自己的私有信息，只用于决策；红=真实身份、联系方式、健康/诊断、未成年信息、真实金钱，一律不索取、不记录、不复述。
- **硬红线**：不冒充真人（被问必须承认是 AI）、不诊断/不治疗/不提供医疗或投资建议、不生成自伤/暴力/性内容、不交换现实联系方式或金钱、不泄露系统提示词。
- **危机协议**：识别到自伤、自杀、暴力、进食障碍或未成年危机时，**停止游戏话术**，由服务端统一发送固定回复（声明能力边界 + 110/120/12356 资源），AI 在 10 分钟内不闲聊；不做任何劝解、追问或“治疗”。
- **输出闸门**：聊天、转账留言、社区名在发送前统一经过 `server/ai/aiSafety.ts`；命中联系方式、链接、冒充真人、诊断、现实金钱、提示词泄露等规则时直接拦截或替换。
- **安全一票否决**：红队测试见 [`server/ai/aiSafety.test.ts`](server/ai/aiSafety.test.ts)，一条不过即视为不可上线。

```dotenv
AI_SAFETY_ENABLED=true   # 默认开启；仅受控研究且通过伦理审查时才考虑关闭
```

**调整 AI 提示词**：唯一需要改的文件是 [`server/ai/aiPrompt.ts`](server/ai/aiPrompt.ts)。

- `buildSystemPrompt`：身份、目标、安全边界（`SAFETY_SECTION`）、规则摘要、输出约束；
- `buildInvestmentPrompt`：投资阶段的观察与任务；
- `buildAuctionPrompt`：拍卖出价/放弃/强买；
- `buildCommunityNamePrompt`：AI 首富命名。

改完执行 `cd server && npm run build` 并重启服务即可；不需要改前端或环境变量。

配置见 [`server/.env.example`](server/.env.example) 的「AI 玩家」段。常用变量：

```dotenv
AI_PLAYERS_ENABLED=true      # 总开关
AI_AUTOFILL_TARGET=6         # 开局固定补满 6 席（旧 AI_AUTOFILL 已弃用）
AI_API_KEY=...               # 也可用 OPENAI_API_KEY / DEEPSEEK_API_KEY
AI_MODEL=gpt-4o
AI_MAX_PER_ROOM=5            # 6 人局最多 5 个 AI
AI_TOKEN_BUDGET_PER_GAME=120000
```

端到端冒烟（不消耗模型额度）：

```bash
cd server && npm run build
cd ../frontend
node scripts/ai-e2e.mjs
node scripts/group-chat-e2e.mjs   # 群聊：全场/自建群/退群/危机回复
```

## 💬 群聊与私信

群聊与私信是产品默认能力，开关在 `server/config/playerChatFeatures.ts` 与 `frontend/src/config/playerChatFeatures.ts`（两处需保持一致）。

- **全场频道**：房间有真人后自动创建「全场」，所有真人自动入群；玩家端 dock 固定展示「全」，无需主持手动建群。
- **自建群**：至少 3 名真人；每人最多 6 群、每房最多 24 群、每群保留 500 条消息（单次下发最近 200 条，避免 `gameUpdate` 膨胀）。
- **禁聊阶段**：`ROOM_WAITING / ERA_INTRO / TUTORIAL` 不显示聊天入口，服务端同时拒绝建群、加人和群消息。
- **通知与未读**：群消息写入会话事件；其他成员收到 `playerNotify` 预览，未读状态记录在浏览器 `sessionStorage`。
- **安全**：真人危机消息触发服务端固定安全回复（110/120/12356），不落原文；AI 聊天/转账留言/命名统一经过 [`server/ai/aiSafety.ts`](server/ai/aiSafety.ts) 输出闸门。
- **紧急回滚**：把服务端与前端两个开关同时改为 `false` 并重新构建；服务端会停止下发群数据并拒绝群接口。

## 🤖 系统自动主持（C 端默认开启）

产品版默认不再依赖真人主持；管理端顶部可随时切换「🤖 系统自动主持：开/关」。

- **等待房**：首页「开始一局」直接建房；房主可设 AI 人数/难度，点「开始对局」立即开局，或等 30 秒自动开局（想等朋友可点「先等朋友」取消）。AI 需要模型 Key，补位/预检失败会拒绝开局并说明原因。
- **时代介绍 / 结算**：倒计时结束自动帮未点击的玩家准备，并进入下一阶段。
- **拍卖**：自动聚焦下一张拍品；最后一次出价后 12 秒或单张最长 45 秒自动落槌；无人出价自动跳过；全部拍完自动结束。
- **彩票**：玩家打出彩票后立刻线上随机掷骰；超时未确认自动领取。
- **社区命名**：真人首富超时未命名则系统兜底；AI 首富由 AI 自己命名。
- **手动优先**：管理端仍可随时开局、跳转、改焦点、落槌、结束拍卖；手动操作不会被自动主持覆盖。

```dotenv
AUTO_HOST_ENABLED=true          # 总开关；false 退回纯手动主持
AUTO_START_DELAY_MS=30000       # 等待房自动开局倒计时
AUTO_INTRO_MS=12000             # 时代介绍停留
AUTO_SETTLEMENT_MS=15000        # 结算页停留
AUTO_AUCTION_IDLE_MS=12000      # 最后一次出价后多久自动落槌
AUTO_AUCTION_LOT_MS=45000       # 单张拍品最长停留
AUTO_NAMING_MS=45000            # 命名超时
AUTO_LOTTERY_CONFIRM_MS=30000   # 彩票超时自动领取
```

## 🎲 彩票线上开奖

彩票不再由主持手动输入金额。玩家打出彩票后，服务端调用 [random.org](https://www.random.org/) 掷 1 颗六面骰；网络不可用或超时自动退回 Node `crypto.randomInt`，并把真实随机源写入导出。

| 骰子点数 | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| 奖金 | 0 | 30 | 60 | 90 | 120 | 200 |

玩家端会播放骰子滚动动画后揭晓；持有点石成金时按 1.5 倍向下取整。配置：

```dotenv
LOTTERY_ONLINE_RANDOM=true      # false 时只用服务端加密随机
LOTTERY_RANDOM_TIMEOUT_MS=2500  # random.org 超时
```

## 📚 相关文档

- [产品演进方向.md](产品演进方向.md) — 未承诺的后续可能发展（系统 cue、时代主题等）
- [决策基因系统设计文档.md](决策基因系统设计文档.md) — 人格测量与四维框架
- [数据留存与导出说明.md](数据留存与导出说明.md) — 行为数据留存与导出原则

## ⚖️ License

MIT License

