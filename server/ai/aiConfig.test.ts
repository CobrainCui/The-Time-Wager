import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AI_PLAYER_SLOTS,
  resolveAiModelConfig,
  resolveAiModelConfigForSlot,
} from "./aiConfig.js";

const AI_KEYS = [
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_PROVIDER",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "RULE_AGENT_API_KEY",
];
for (let slot = 1; slot <= MAX_AI_PLAYER_SLOTS; slot++) {
  for (const field of ["API_KEY", "BASE_URL", "MODEL", "PROVIDER"]) {
    AI_KEYS.push(`AI_PLAYER_${slot}_${field}`);
  }
}

function withEnv(values: Record<string, string>, fn: () => void): void {
  const saved = new Map<string, string | undefined>();
  for (const key of AI_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    fn();
  } finally {
    for (const key of AI_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("没有共享 Key 时所有座位都不可用", () => {
  withEnv({}, () => {
    assert.equal(resolveAiModelConfig(), null);
    assert.equal(resolveAiModelConfigForSlot(1), null);
    assert.equal(resolveAiModelConfigForSlot(5), null);
  });
});

test("只配置共享 Key 时，每个座位使用同一份配置", () => {
  withEnv({ AI_API_KEY: "sk-shared-key", AI_MODEL: "gpt-4o" }, () => {
    const one = resolveAiModelConfigForSlot(1);
    const three = resolveAiModelConfigForSlot(3);
    assert.equal(one?.apiKey, "sk-shared-key");
    assert.equal(one?.model, "gpt-4o");
    assert.equal(one?.source, "shared");
    assert.equal(three?.apiKey, "sk-shared-key");
  });
});

test("每个座位可以用不同的 Key / 模型 / 供应商地址", () => {
  withEnv(
    {
      AI_API_KEY: "sk-shared-key",
      AI_MODEL: "gpt-4o",
      AI_PLAYER_1_API_KEY: "sk-slot-1",
      AI_PLAYER_1_MODEL: "gpt-4o-mini",
      AI_PLAYER_1_PROVIDER: "openai",
      AI_PLAYER_2_API_KEY: "sk-slot-2",
      AI_PLAYER_2_BASE_URL: "https://api.deepseek.com",
      AI_PLAYER_2_MODEL: "deepseek-chat",
      AI_PLAYER_2_PROVIDER: "deepseek",
    },
    () => {
      const one = resolveAiModelConfigForSlot(1);
      const two = resolveAiModelConfigForSlot(2);
      const three = resolveAiModelConfigForSlot(3);

      assert.equal(one?.apiKey, "sk-slot-1");
      assert.equal(one?.model, "gpt-4o-mini");
      assert.equal(one?.source, "player-1");
      assert.equal(one?.slot, 1);

      assert.equal(two?.apiKey, "sk-slot-2");
      assert.equal(two?.baseURL, "https://api.deepseek.com");
      assert.equal(two?.model, "deepseek-chat");
      assert.equal(two?.provider, "deepseek");

      // 未单独配置的座位仍然回退到共享 Key
      assert.equal(three?.apiKey, "sk-shared-key");
      assert.equal(three?.source, "shared");
    }
  );
});

test("座位只覆盖模型时沿用共享 Key", () => {
  withEnv(
    { AI_API_KEY: "sk-shared-key", AI_MODEL: "gpt-4o", AI_PLAYER_4_MODEL: "gpt-4.1-mini" },
    () => {
      const four = resolveAiModelConfigForSlot(4);
      assert.equal(four?.apiKey, "sk-shared-key");
      assert.equal(four?.model, "gpt-4.1-mini");
      assert.equal(four?.source, "player-4");
    }
  );
});

test("座位 Key 是占位值时不会当成真实 Key，仍沿用共享 Key", () => {
  withEnv(
    {
      AI_API_KEY: "sk-shared-key",
      AI_PLAYER_2_API_KEY: "sk-placeholder-agent-2",
      AI_PLAYER_2_MODEL: "gpt-4.1-mini",
    },
    () => {
      const two = resolveAiModelConfigForSlot(2);
      assert.equal(two?.apiKey, "sk-shared-key");
      assert.equal(two?.model, "gpt-4.1-mini");
      assert.equal(two?.source, "player-2");
    }
  );
});

test("座位号超出范围时使用共享配置", () => {
  withEnv({ AI_API_KEY: "sk-shared-key" }, () => {
    assert.equal(resolveAiModelConfigForSlot(0)?.source, "shared");
    assert.equal(resolveAiModelConfigForSlot(99)?.source, "shared");
    assert.equal(resolveAiModelConfigForSlot(undefined)?.source, "shared");
  });
});
