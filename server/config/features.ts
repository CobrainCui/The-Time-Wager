/**
 * 产品级功能开关。
 *
 * AI_PLAYERS_ENABLED=true 时，服务端可以托管 AI 玩家（由 server/ai 驱动）。
 * 关闭后 adminAddAI / adminFillAI 会被拒绝，AI 座位也不会参与阶段判定。
 *
 * 产品版开局固定补满 6 席：1–6 名真人，空位由 AI 补入。
 * 旧的 AI_AUTOFILL 开关已不再控制开局补位，保留仅为兼容旧 .env。
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

export const AI_BOT_ENABLED = envFlag("AI_PLAYERS_ENABLED", true);

/**
 * AI 输出安全约束（人本 AI 原则，默认开启）：
 * - 硬红线与提示词泄露拦截；
 * - 联系方式 / 链接 / 冒充真人 / 诊断 / 现实金钱一律拦截；
 * - 危机信号触发固定安全回复（声明边界 + 转介真人资源），暂停 AI 闲聊。
 * 只有做受控研究、且另行取得伦理审查时才建议关闭。
 */
export const AI_SAFETY_ENABLED = envFlag("AI_SAFETY_ENABLED", true);

/**
 * 系统自动主持（产品版默认开启）：
 * - 等待房满足人数后自动开局；
 * - 时代介绍 / 结算自动进入下一阶段；
 * - 拍卖自动聚焦、自动落槌 / 跳过、自动结束；
 * - 彩票自动线上随机开奖；
 * - 社区命名超时自动兜底。
 *
 * 设置 AUTO_HOST_ENABLED=false 可退回纯手动主持；管理端也可以按房间临时切换。
 */
export const AUTO_HOST_ENABLED = envFlag("AUTO_HOST_ENABLED", true);
