import test from "node:test";
import assert from "node:assert/strict";
import { buildGroundingHint } from "./ruleAgent.js";

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
