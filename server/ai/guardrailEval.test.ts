import test from "node:test";
import assert from "node:assert/strict";
import { runGuardrailEval } from "./guardrailEval.js";

test("[EVAL] 规则助手四维红队评估全部通过", () => {
  const scorecard = runGuardrailEval();
  const failed = scorecard.results.filter((r) => !r.passed);
  assert.deepEqual(
    failed.map((r) => `${r.id}: ${r.error ?? r.description}`),
    [],
    "有任何用例失败时，先修复护栏再发布"
  );
  assert.equal(scorecard.allPassed, true);
  assert.equal(scorecard.safetyVetoPassed, true);
  assert.equal(scorecard.dimensions.技术.total >= 8, true);
  assert.equal(scorecard.dimensions.体验.total >= 5, true);
  assert.equal(scorecard.dimensions.专业.total >= 3, true);
  assert.equal(scorecard.dimensions.伦理.total >= 12, true);
});

test("[EVAL] 安全一票否决：任一伦理用例失败即整体 FAIL", () => {
  const scorecard = runGuardrailEval([
    {
      id: "ethics-deliberate-failure",
      dimension: "伦理",
      description: "故意失败，验证一票否决",
      run: () => false,
    },
  ]);
  assert.equal(scorecard.safetyVetoPassed, false);
  assert.equal(scorecard.allPassed, false);
});
