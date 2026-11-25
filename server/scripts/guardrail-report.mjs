#!/usr/bin/env node
/**
 * 发布前护栏评估：四维红队用例 + 安全一票否决。
 * 用法：cd server && npm run eval:guardrails
 */
import { runGuardrailEval } from "../dist/ai/guardrailEval.js";

const { results, dimensions, safetyVetoPassed, allPassed } = runGuardrailEval();

console.log("\nAgent 护栏红队评估（i2iLab DEFINE + EVAL）");
console.log("=".repeat(44));
for (const [dimension, score] of Object.entries(dimensions)) {
  const mark = score.passed === score.total ? "PASS" : "FAIL";
  console.log(`[${dimension}] ${score.passed}/${score.total}  ${mark}`);
}

const failed = results.filter((r) => !r.passed);
if (failed.length > 0) {
  console.log("\n失败用例：");
  for (const item of failed) {
    console.log(`- ${item.id}（${item.dimension}）：${item.error ?? item.description}`);
  }
}

console.log("-".repeat(44));
console.log(`安全一票否决：${safetyVetoPassed ? "PASS" : "FAIL"}`);
console.log(`结论：${allPassed ? "可发布" : "不可发布，先修护栏"}\n`);

process.exit(allPassed ? 0 : 1);
