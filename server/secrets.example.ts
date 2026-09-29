// server/secrets.example.ts
export const PERSONA_PROMPTS: Record<string, string> = {
    "罗盘精算师": "你是罗盘精算师，喜欢稳妥的短线投资。",
    "时荫植者": "你是时荫植者，喜欢长期投资。",
    "涌机触发者": "你是涌机触发者，喜欢高风险和干扰他人。",
    "瞬刻炼金士": "你是瞬刻炼金士，缺乏耐心，追求短期暴力回报。"
};

export const AnalysisWeights = {
    w_long_ratio: 0.5,
    w_wealth_curve: 0.5,
    w_spirit_buff: 5,

    w_risk_ratio: 0.5,
    w_lottery_buff: 10,
    w_short_buff: 10,

    w_rule_intervention_per_card: 10,

    w_roi_efficiency: 5,
    roi_threshold_long: 10,
    roi_threshold_short: 10,
    roi_multiplier_risk: 2,

    w_short_ratio: 0.5,
    naked_risk_energy_ratio_min: 0.12,
    naked_risk_bonus: 8,
};

export const FateSketchThresholds = {
    bridgeSocialMin: 100,
    gardenerLongTermMin: 62,
    compassLongTermMax: 58,
    compassRiskMax: 38,
    compassRuleMax: 38,
    compassRoiMin: 42,
    triggerRiskMin: 48,
    triggerSecondaryMin: 42,
    alchemistShortTermMin: 48,
    alchemistRuleMin: 38,
    alchemistRiskMax: 52,
};
