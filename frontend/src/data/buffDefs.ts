export const BUFF_DEFS: Record<string, { name: string; desc: string; icon: string; color: string; price?: number }> = {
  buff_slack: { name: "摸鱼传染", desc: "指定玩家精力 -8；对方发动【劳逸结合】则对方获得 8 精力", icon: "😴", color: "#ef4444", price: 70 },
  buff_insurance: { name: "保险", desc: "本轮参与的风险项目投爆赔 100；点石成金可作用于赔付", icon: "🛡️", color: "#6366f1", price: 90 },
  buff_gold: { name: "点石成金", desc: "本轮正收益与保险、彩票按 1.5 倍向下取整；惩罚不放大", icon: "💰", color: "#f59e0b", price: 80 },
  buff_force_buy: { name: "强买强卖", desc: "拍卖阶段一次：免费拿当前正在拍的卡", icon: "🤝", color: "#a855f7", price: 75 },
  buff_short: { name: "项目做空", desc: "指定本轮可投入项目，结算时已积累精力清零；已入账财富不追回", icon: "📉", color: "#3b82f6", price: 60 },
  buff_work_rest: { name: "劳逸结合", desc: "被使用【摸鱼传染】后获得 8 精力。单独使用无效。", icon: "⚖️", color: "#10b981", price: 65 },
  buff_lighter: {
    name: "打火机",
    desc: "指定其他玩家后，从其本局拍卖得到的道具中选一张烧毁（不显示在手牌或已发动）；被烧的卡不再生效",
    icon: "🔥",
    color: "#f97316",
    price: 55,
  },
  buff_lottery: { name: "彩票", desc: "实体骰子定奖，主持输入金额；若你本轮打出了点石成金可×1.5向下取整", icon: "🎲", color: "#ec4899", price: 50 },
};
