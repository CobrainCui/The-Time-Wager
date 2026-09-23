export const BUFF_DEFS: Record<string, { name: string; desc: string; icon: string; color: string; price?: number }> = {
  buff_gold: { name: "点石成金", desc: "本轮回报 ×1.5", icon: "💰", color: "#f59e0b", price: 80 },
  buff_short: { name: "项目做空", desc: "猜测项目状态赢取奖励", icon: "📉", color: "#3b82f6", price: 60 },
  buff_slack: { name: "摸鱼传染", desc: "对手精力 -5", icon: "😴", color: "#ef4444", price: 70 },
  buff_rebound: { name: "反弹琵琶", desc: "主动开启护盾，反弹攻击", icon: "🎸", color: "#10b981", price: 65 },
  buff_insurance: { name: "保险", desc: "被动防爆，获赔 100", icon: "🛡️", color: "#6366f1", price: 90 },
  buff_spirit: { name: "精神老伙", desc: "精力 +5", icon: "🔥", color: "#f97316", price: 55 },
  buff_swap: { name: "偷天换日", desc: "选座时与对手互换顺位", icon: "🔄", color: "#a855f7", price: 75 },
  buff_lottery: { name: "彩票", desc: "投 20 面骰子赌运气", icon: "🎲", color: "#ec4899", price: 50 },
};
