# The Time Wager (光阴对赌)

"The Time Wager" is a strategic multiplayer game spanning four life stages. Players invest their limited energy into short-term gains, long-term assets, or high-risk ventures to build wealth. Negotiate, cooperate, or backstab rivals using powerful strategy cards. Master the balance between instant gratification and lasting value!

**光阴对赌** 是一款跨越人生四大阶段的多人心理策略桌游。玩家需要在游戏中合理分配有限的“精力”，投资于短期收益、长期资产或高风险项目以积累“财富”。你可以与对手结盟、谈判，或者使用强力的策略道具卡背刺他们。在即时满足与长期价值之间寻找完美平衡，解锁你的决策密码！

## 🎯 Features | 核心机制

- **Four Life Stages (四大时代)**: Youth (青年), Prime (壮年), Middle Age (中年), Old Age (老年).
- **Investment Strategy (投资策略)**: Balance your portfolio between short-term tasks (quick wins), long-term visions (heavy investment, high payoff), and risk ventures.
- **Social Interaction (社交互动)**: Negotiate with up to 6 players, cooperate to fund large projects, or use buff cards to disrupt your opponents (e.g., "Slack Virus" 摸鱼传染, "Shield" 反弹护盾).
- **AI Auto-Tuner (大模型支持)**: Built-in AI agents that simulate different player persona types (Long-termism, Risk-taking, Social connection) for gameplay parameter balancing.

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
- `location ^~ /uploads/`、`location ^~ /uploads_eras/`、`location ^~ /uploads_buffs/` → Node（上传图片静态资源；建议使用 `^~` 避免被站点内「按后缀匹配 jpg」的规则拦截）

开发环境下 Vite 还会代理上述三个 `/uploads*` 路径到 `localhost:3001`。

管理子域站点 `root` 指向 `admin.guangyinduidu.com` 目录。CI 部署会将 `admin.html` 复制为 `index.html`，使子域根路径即为管理入口（无需额外 Nginx 重写）。

在 pm2 工作目录的 `server/.env` 中配置 `ADMIN_TOKEN` 后执行 `pm2 restart`。

**管理后台「验证超时」**（WebSocket 已连上但 15 秒无响应）：说明 Node 未处理 `adminAuthenticate`，多为 **server 未部署最新 `dist`**。在服务器执行：

```bash
cd /www/wwwroot/guangyinduidu.com/server
grep adminAuthenticate dist/network/socketHandlers.js   # 应有输出
npm run build
pm2 restart guangyin
pm2 logs guangyin --lines 30   # 登录时应出现 [admin] authenticate request / ok
```

`.env` 格式：`ADMIN_TOKEN=密钥`（等号两侧勿加空格）。错误密钥应立刻提示「密钥无效」，不应等到超时。

## ⚖️ License

MIT License
