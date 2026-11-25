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
 * 硅基流动（docs.siliconflow.cn）中国主流厂商最近发布的两款对话/推理模型（7 家 × 2 款 = 14 款）。
 */
export const SILICONFLOW_MODEL_GROUPS: SiliconFlowModelGroup[] = [
  {
    vendor: "深度求索 DeepSeek",
    models: [
      {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        label: "DeepSeek-V4.1-Flash（最新高速推理）",
        vendor: "深度求索 DeepSeek",
      },
      {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        label: "DeepSeek-V4-Pro（最新深度旗舰）",
        vendor: "深度求索 DeepSeek",
      },
    ],
  },
  {
    vendor: "阿里通义千问 Qwen",
    models: [
      {
        id: "Qwen/Qwen3.5-397B-A17B",
        label: "Qwen3.5-397B-A17B（千问3.5旗舰Plus）",
        vendor: "阿里通义千问 Qwen",
      },
      {
        id: "Qwen/Qwen3.5-35B-A3B",
        label: "Qwen3.5-35B-A3B（千问3.5高效推理）",
        vendor: "阿里通义千问 Qwen",
      },
    ],
  },
  {
    vendor: "智谱清言 GLM",
    models: [
      {
        id: "zai-org/GLM-5.3-Flash",
        label: "GLM-5.3-Flash（智谱最新高速智能体）",
        vendor: "智谱清言 GLM",
      },
      {
        id: "zai-org/GLM-5.2",
        label: "GLM-5.2（智谱最新旗舰推理）",
        vendor: "智谱清言 GLM",
      },
    ],
  },
  {
    vendor: "月之暗面 Kimi",
    models: [
      {
        id: "moonshotai/Kimi-K3.1-Pro",
        label: "Kimi-K3.1-Pro（月之暗面最新旗舰）",
        vendor: "月之暗面 Kimi",
      },
      {
        id: "moonshotai/Kimi-K3",
        label: "Kimi-K3（月之暗面百万长文本）",
        vendor: "月之暗面 Kimi",
      },
    ],
  },
  {
    vendor: "稀宇科技 MiniMax",
    models: [
      {
        id: "MiniMaxAI/MiniMax-M3.1-Flash",
        label: "MiniMax-M3.1-Flash（最新高速智能体）",
        vendor: "稀宇科技 MiniMax",
      },
      {
        id: "MiniMaxAI/MiniMax-M3",
        label: "MiniMax-M3（MiniMax旗舰）",
        vendor: "稀宇科技 MiniMax",
      },
    ],
  },
  {
    vendor: "阶跃星辰 StepFun",
    models: [
      {
        id: "stepfun-ai/Step-3.5-Flash",
        label: "Step-3.5-Flash（阶跃最新稀疏推理）",
        vendor: "阶跃星辰 StepFun",
      },
      {
        id: "stepfun-ai/step3",
        label: "step3（阶跃多模态推理旗舰）",
        vendor: "阶跃星辰 StepFun",
      },
    ],
  },
  {
    vendor: "腾讯混元 Hunyuan",
    models: [
      {
        id: "tencent/Hy4-preview",
        label: "Hy4-preview（腾讯混元最新旗舰）",
        vendor: "腾讯混元 Hunyuan",
      },
      {
        id: "tencent/Hy3",
        label: "Hy3（腾讯混元混合推理）",
        vendor: "腾讯混元 Hunyuan",
      },
    ],
  },
];

export const SILICONFLOW_ALL_MODEL_IDS: string[] = SILICONFLOW_MODEL_GROUPS.flatMap((g) =>
  g.models.map((m) => m.id)
);

/** 6AI 实验室 1～6 号座位默认 6 家不同厂商代表模型（共用同一把硅基流动 API Key） */
export const DEFAULT_LAB_SIX_SEAT_MODELS: string[] = [
  "deepseek-ai/DeepSeek-V4.1-Flash",
  "Qwen/Qwen3.5-397B-A17B",
  "zai-org/GLM-5.3-Flash",
  "moonshotai/Kimi-K3.1-Pro",
  "MiniMaxAI/MiniMax-M3.1-Flash",
  "stepfun-ai/Step-3.5-Flash",
];
