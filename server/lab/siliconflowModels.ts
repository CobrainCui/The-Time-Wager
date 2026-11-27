export interface SiliconFlowModelOption {
  id: string;
  label: string;
  vendor: string;
}

export interface SiliconFlowModelGroup {
  vendor: string;
  models: SiliconFlowModelOption[];
}

export const SILICONFLOW_DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
export const SILICONFLOW_PLACEHOLDER_KEY = "sk-siliconflow-placeholder";

/**
 * 硅基流动（docs.siliconflow.cn）已实测可用且最近发布的中国主流厂商对话/推理模型（8 家厂商，共 12 款）。
 */
export const SILICONFLOW_MODEL_GROUPS: SiliconFlowModelGroup[] = [
  {
    vendor: "深度求索 DeepSeek",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        label: "DeepSeek-V4.1-Flash（最新高速推理 · 实测可用）",
        vendor: "深度求索 DeepSeek",
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        label: "DeepSeek-V4-Pro（最新深度旗舰 · 实测可用）",
        vendor: "深度求索 DeepSeek",
      },
    ],
  },
  {
    vendor: "阿里通义千问 Qwen",
    models: [
      {
        id: "Qwen/Qwen3.8-27B",
        label: "Qwen3.8-27B（千问3.8最新推理 · 实测可用）",
        vendor: "阿里通义千问 Qwen",
      },
      {
        id: "Qwen/Qwen3.6-35B-A3B",
        label: "Qwen3.6-35B-A3B（千问3.6高效版 · 实测可用）",
        vendor: "阿里通义千问 Qwen",
      },
    ],
  },
  {
    vendor: "智谱清言 GLM",
    models: [
      {
        id: "zai-org/GLM-5.3",
        label: "GLM-5.3（智谱深思考旗舰 · 较慢）",
        vendor: "智谱清言 GLM",
      },
      {
        id: "zai-org/GLM-5.2",
        label: "GLM-5.2（智谱稳健旗舰 · 实测极速可用）",
        vendor: "智谱清言 GLM",
      },
    ],
  },
  {
    vendor: "月之暗面 Kimi",
    models: [
      {
        id: "moonshotai/Kimi-K2.7-Code",
        label: "Kimi-K2.7-Code（月之暗面最新可用）",
        vendor: "月之暗面 Kimi",
      },
      {
        id: "Pro/moonshotai/Kimi-K2.6",
        label: "Kimi-K2.6（月之暗面旗舰 · 实测可用）",
        vendor: "月之暗面 Kimi",
      },
    ],
  },
  {
    vendor: "腾讯混元 Hunyuan",
    models: [
      {
        id: "tencent/Hy4-preview",
        label: "Hy4-preview（腾讯混元最新旗舰 · 实测可用）",
        vendor: "腾讯混元 Hunyuan",
      },
    ],
  },
  {
    vendor: "美团龙猫 LongCat",
    models: [
      {
        id: "meituan-longcat/LongCat-2.0",
        label: "LongCat-2.0（美团最新推理 · 实测可用）",
        vendor: "美团龙猫 LongCat",
      },
    ],
  },
  {
    vendor: "蚂蚁百灵 Ling",
    models: [
      {
        id: "inclusionAI/Ling-flash-2.0",
        label: "Ling-flash-2.0（蚂蚁百灵高速版 · 实测可用）",
        vendor: "蚂蚁百灵 Ling",
      },
    ],
  },
  {
    vendor: "星辰 XingChen",
    models: [
      {
        id: "XingChenAGI/Xing4.0-29B",
        label: "Xing4.0-29B（星辰最新推理 · 实测可用）",
        vendor: "星辰 XingChen",
      },
    ],
  },
];

export const SILICONFLOW_ALL_MODEL_IDS: string[] = SILICONFLOW_MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => m.id)
);

/** 6AI 实验室 1～6 号座位默认 6 家不同国产厂商已实测通过模型（共用同一把硅基流动 API Key） */
export const DEFAULT_LAB_SIX_SEAT_MODELS: string[] = [
  "deepseek-ai/DeepSeek-V4.1-Flash",
  "Qwen/Qwen3.6-35B-A3B",
  "zai-org/GLM-5.2",
  "Pro/moonshotai/Kimi-K2.6",
  "tencent/Hy4-preview",
  "inclusionAI/Ling-flash-2.0",
];
