import type { TutorialDemoKey } from "./tutorial/demoKeys";
import { TUTORIAL_SLIDE_TITLE_TIED_RANK } from "./config/playerHelpReference";

export { TUTORIAL_SLIDE_TITLE_TIED_RANK };

export interface TutorialSlide {
    title: string;
    content: string[];
    hostNotes: string;
    icon: string;
    demoKey?: TutorialDemoKey;
    /** 大号排版：与欢迎页同档字号，容器更宽（欢迎页、核心资源页等） */
    intro?: boolean;
    /** 收束页：更大字号与留白（如「准备出发」） */
    finale?: boolean;
    /** 标题区用开源法槌图标，不用 emoji icon */
    gavelIcon?: boolean;
}

/**
 * 产品版教程：只回答新玩家最关心的三件事——「赢什么」「按什么」「怎么开始」。
 * 每页不超过 4 条短句；完整数值与例外情况放在游戏内「指南 / 规则助手」里，
 * 不做成一上来就要读完的说明书。
 */
export const TUTORIAL_SLIDES: TutorialSlide[] = [
    {
        title: "欢迎来到《光阴对弈》",
        icon: "⚖️",
        intro: true,
        content: [
            "4 个时代：青年 → 壮年 → 中年 → 老年。每个时代 2 轮，共 8 轮。",
            "终局财富最高的人获胜；真人、AI 用同一套规则，AI 也是对手。",
            "开局财富 100；每轮重新发精力，上一轮没花完的精力不会留到下一轮。",
        ],
        hostNotes: "一句话开场即可：赢家只有一个指标——终局财富。",
    },
    {
        title: "你只有两种资源",
        icon: "💎",
        content: [
            "⚡ 精力：每轮重新发放，只在本轮有效，用来投资项目。四代依次 15 → 13 → 11 → 9。",
            "💰 财富：开局 100，终局比分；投资回报、排名奖、道具都围绕它。",
            "☕ 咖啡：投资阶段花 17 财富换 1 精力，本轮锁定前可以退掉。",
        ],
        hostNotes: "强调精力每轮重置、不要留到下一轮。",
        intro: true,
    },
    {
        title: "三类项目，一句话记住",
        icon: "📋",
        content: [
            "短期：本轮结算，每点精力返 10 财富。全场累计恰好投满上限才有排名奖；超过上限直接爆掉（无回报，还有惩罚）。",
            "长期：全场一起攒，攒满上限才统一发钱，每点精力返 15 财富。第 4 时代结束仍未满，按累计进度分档返还。",
            "风险：本轮结算，每点精力返 20–25 财富。超过上限会爆掉，并追回你此前从该项目拿到的收益。",
            `同一项目投入相同名次并列，奖励均分；排名奖只按历史累计投入计算（详见「${TUTORIAL_SLIDE_TITLE_TIED_RANK}」）。`,
        ],
        hostNotes: "只讲三类节奏：当轮、完成后、赌一把。数值细节让玩家查指南。",
    },
    {
        title: "道具与拍卖",
        icon: "",
        gavelIcon: true,
        content: [
            "时代 2、3、4 开始前各有一场拍卖，每场逐张拍 4 张道具卡；用财富出价，价高者得，成交价从财富扣除。",
            "起拍价 5，每次至少加 5；出价时财富只是暂时冻结，没拍到不会扣钱。",
            "道具卡只能在投资阶段、锁定投资前使用，每张一次；锁定后本轮就不能再用。",
            "常见用法：摸鱼扣对手精力、点石成金放大收益、保险兜底风险项目。",
        ],
        hostNotes: "不逐个念卡面：玩家手上有卡时，卡面会写清效果。",
    },
    {
        title: "一局怎么走",
        icon: "🚀",
        finale: true,
        content: [
            "每轮：发精力 → 拖动分配 → 锁定投资 → 结算。",
            "锁定后、倒计时结束前，还可以自己解锁修改；倒计时结束会自动提交。",
            "本轮不会因为全员锁定而提前结束；倒计时结束后自动结算，不需要主持人。",
            "不确定时点左下角「规则助手」，或打开左侧「指南」，随时问。",
        ],
        hostNotes: "最后提醒：锁定后倒计时结束前还能自己解锁修改。",
    }
];
