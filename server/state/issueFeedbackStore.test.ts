import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { FORBIDDEN_WORDS_ZH } from "../data/forbiddenWords.js";
import {
  addIssueFeedback,
  deleteIssueFeedback,
  getAdminIssuesForExport,
  getIssueCounts,
  initIssueFeedbackPersistence,
  ISSUE_CONTENT_MAX,
  listAdminIssues,
  resetIssueFeedbackStoreForTests,
  setIssueStatus,
} from "./issueFeedbackStore.js";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function freshStore(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-feedback-"));
  tempDirs.push(dir);
  const file = path.join(dir, "issue_feedback.json");
  resetIssueFeedbackStoreForTests();
  initIssueFeedbackPersistence(file);
  return file;
}

test("addIssueFeedback validates category and content length", () => {
  freshStore();

  const badCat = addIssueFeedback({ category: "不存在", content: "测试问题" });
  assert.equal(badCat.ok, false);

  const tooShort = addIssueFeedback({ category: "规则没看懂", content: "a" });
  assert.equal(tooShort.ok, false);

  const ok = addIssueFeedback({
    category: "规则没看懂",
    content: "第二轮长期项目为什么不能撤回？",
  });
  assert.equal(ok.ok, true);
});

test("issue content masks forbidden words and caps at max length; context is sanitized", () => {
  freshStore();
  const forbidden = FORBIDDEN_WORDS_ZH[0];
  const res = addIssueFeedback({
    category: "界面/操作问题",
    content: `问题 ${forbidden} ` + "字".repeat(700),
    context: {
      roomId: "ab12cd!@#",
      phase: "INVESTMENT",
      era: 2,
      round: 4,
      humanCount: 2,
      aiCount: 4,
      deviceType: "mobile",
      viewport: "390x844",
    },
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.equal(res.entry.content.includes(forbidden), false);
  assert.equal(Array.from(res.entry.content).length, ISSUE_CONTENT_MAX);
  assert.deepEqual(res.entry.context, {
    roomId: "AB12CD",
    phase: "INVESTMENT",
    era: 2,
    round: 4,
    humanCount: 2,
    aiCount: 4,
    deviceType: "mobile",
    viewport: "390x844",
  });

  const invalidCtx = addIssueFeedback({
    category: "卡顿/掉线",
    content: "掉线重连后转圈",
    context: {
      phase: "HACKED_PHASE",
      era: 99,
      deviceType: "fridge",
      viewport: "bad",
    },
  });
  assert.equal(invalidCtx.ok, true);
  if (!invalidCtx.ok) return;
  assert.deepEqual(invalidCtx.entry.context, {});
});

test("status transition, filtering, export, delete, and persistence reload work", () => {
  const file = freshStore();
  const i1 = addIssueFeedback({
    category: "AI 表现异常",
    content: "AI 在拍卖最后一直加价",
    context: { roomId: "ROOM01", phase: "AUCTION", era: 1, round: 2 },
  });
  const i2 = addIssueFeedback({
    category: "玩法建议",
    content: "希望增加快捷算分提示",
    context: { roomId: "ROOM02", phase: "SETTLEMENT", era: 3, round: 6 },
  });
  assert.equal(i1.ok && i2.ok, true);
  if (!i1.ok || !i2.ok) return;

  assert.deepEqual(getIssueCounts(), { all: 2, open: 2, resolved: 0 });

  const resolved = setIssueStatus(i1.entry.id, "resolved", "已在拍卖轮次调整上限");
  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.entry.status, "resolved");
    assert.equal(resolved.entry.adminNote, "已在拍卖轮次调整上限");
    assert.equal(typeof resolved.entry.resolvedAt, "number");
  }

  assert.deepEqual(getIssueCounts(), { all: 2, open: 1, resolved: 1 });

  const searchOpen = listAdminIssues({ status: "open", q: "算分" });
  assert.equal(searchOpen.total, 1);
  assert.equal(searchOpen.items[0].id, i2.entry.id);

  const exportResolved = getAdminIssuesForExport({ status: "resolved", category: "AI 表现异常" });
  assert.equal(exportResolved.length, 1);
  assert.equal(exportResolved[0].id, i1.entry.id);

  resetIssueFeedbackStoreForTests();
  initIssueFeedbackPersistence(file);
  const afterReload = listAdminIssues({ status: "all" });
  assert.equal(afterReload.total, 2);
  assert.equal(afterReload.counts.resolved, 1);

  assert.equal(deleteIssueFeedback(i2.entry.id), true);
  assert.equal(deleteIssueFeedback(i2.entry.id), false);
});
