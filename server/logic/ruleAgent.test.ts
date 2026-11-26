import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroundingHint,
  isRuleAgentConfigured,
  resolveRuleAgentConfig,
} from "./ruleAgent.js";

const ENV_KEYS = [
  "RULE_AGENT_API_KEY",
  "RULE_AGENT_BASE_URL",
  "RULE_AGENT_MODEL",
  "SILICONFLOW_API_KEY",
  "SILICONFLOW_BASE_URL",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_PROVIDER",
  "AI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
] as const;

function withEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const prev = new Map<string, string | undefined>();
  for (const k of ENV_KEYS) {
    prev.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of ENV_KEYS) {
      const old = prev.get(k);
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }
  }
}

test("拍卖问题预取起拍价、加价步长与扣费时机", () => {
  const hint = buildGroundingHint("拍卖时起拍价多少，每次加价多少？出价会立刻扣钱吗？");
  assert.match(hint, /起拍价 5/);
  assert.match(hint, /加价步长 5/);
  assert.match(hint, /不会立刻扣钱/);
});

test("超额投资问题预取三类项目的上限与结算顺序", () => {
  const hint = buildGroundingHint("这轮投入超过项目上限会怎样？");
  assert.match(hint, /基础回报/);
  assert.match(hint, /overInvestPenalty/);
  assert.match(hint, /风险/);
  assert.match(hint, /长期/);
});

test("无关问题不注入预取资料", () => {
  assert.equal(buildGroundingHint("今天天气怎么样"), "");
});

test("规则助手优先共用 SILICONFLOW_API_KEY 并默认 deepseek-ai/DeepSeek-V4.1-Flash", () => {
  withEnv({ SILICONFLOW_API_KEY: "sk-sf-real-test" }, () => {
    assert.equal(isRuleAgentConfigured(), true);
    const cfg = resolveRuleAgentConfig();
    assert.equal(cfg?.apiKey, "sk-sf-real-test");
    assert.equal(cfg?.baseURL, "https://api.siliconflow.cn/v1");
    assert.equal(cfg?.model, "deepseek-ai/DeepSeek-V4.1-Flash");
    assert.deepEqual(cfg?.extraParams, { enable_thinking: false });
  });

  withEnv({ SILICONFLOW_API_KEY: "sk-siliconflow-placeholder" }, () => {
    assert.equal(isRuleAgentConfigured(), false);
    assert.equal(resolveRuleAgentConfig(), null);
  });

  withEnv(
    {
      SILICONFLOW_API_KEY: "sk-sf-real-test",
      RULE_AGENT_MODEL: "Pro/deepseek-ai/DeepSeek-V3",
    },
    () => {
      const cfg = resolveRuleAgentConfig();
      assert.equal(cfg?.model, "Pro/deepseek-ai/DeepSeek-V3");
    }
  );

  withEnv({ DEEPSEEK_API_KEY: "sk-ds-legacy" }, () => {
    const cfg = resolveRuleAgentConfig();
    assert.equal(cfg?.apiKey, "sk-ds-legacy");
    assert.equal(cfg?.baseURL, "https://api.deepseek.com");
    assert.equal(cfg?.model, "deepseek-v4-pro");
    assert.deepEqual(cfg?.extraParams, { thinking: { type: "disabled" } });
  });
});
