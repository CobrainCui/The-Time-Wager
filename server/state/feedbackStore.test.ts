import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { FORBIDDEN_WORDS_ZH } from "../data/forbiddenWords.js";
import {
  addFeedback,
  deleteFeedback,
  FEEDBACK_CONTENT_MAX,
  getAdminFeedbackForExport,
  getFeedbackStats,
  getFeedbackSummary,
  initFeedbackPersistence,
  listAdminFeedback,
  listPublicFeedback,
  resetFeedbackStoreForTests,
  setFeedbackPinned,
  setFeedbackReply,
  setFeedbackStatus,
  toggleFeedbackHelpful,
  toPublicFeedbackEntry,
  updateOwnFeedback,
} from "./feedbackStore.js";

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-store-"));
  tempDirs.push(dir);
  return path.join(dir, "feedback.json");
}

function freshStore(): string {
  const file = tempFilePath();
  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);
  return file;
}

function seedLegacyEntry(
  id: string,
  createdAt: number,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    rating: 5,
    content: `content-${id}`,
    tags: [],
    createdAt,
    status: "visible",
    source: "unknown",
    ...overrides,
  };
}

test("addFeedback rejects ratings outside integer 1..5", () => {
  freshStore();
  for (const rating of [0, 6, 3.5, "5", null, undefined]) {
    const result = addFeedback({ rating });
    assert.equal(result.ok, false, `rating=${String(rating)} should be rejected`);
  }
  const ok = addFeedback({ rating: 5 });
  assert.equal(ok.ok, true);
});

test("content is masked and capped at 500 chars, control chars removed", () => {
  freshStore();
  const forbidden = FORBIDDEN_WORDS_ZH[0];
  const masked = addFeedback({ rating: 5, content: `前缀 ${forbidden} 后缀` });
  assert.equal(masked.ok, true);
  if (!masked.ok) return;
  assert.equal(masked.entry.content.includes(forbidden), false);
  assert.equal(masked.entry.content.includes("*"), true);

  const long = addFeedback({ rating: 4, content: "测".repeat(650) });
  assert.equal(long.ok, true);
  if (!long.ok) return;
  assert.equal(long.entry.content.length, FEEDBACK_CONTENT_MAX);

  const control = addFeedback({ rating: 3, content: "a\u0000b\u0007c" });
  assert.equal(control.ok, true);
  if (!control.ok) return;
  assert.equal(control.entry.content, "abc");

  const multiline = addFeedback({ rating: 4, content: "第一行\n\n\n第二行" });
  assert.equal(multiline.ok, true);
  if (!multiline.ok) return;
  assert.equal(multiline.entry.content, "第一行\n\n第二行");
});

test("tags accept both new and legacy whitelist, dedupe, and cap at 3", () => {
  freshStore();
  const result = addFeedback({
    rating: 4,
    tags: ["好玩上头", "好玩上头", "未知标签", "策略有深度", "好玩", "AI 很聪明", 123],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.entry.tags, ["好玩上头", "策略有深度", "好玩"]);
});

test("legacy entries load safely with defaults and sort by newest", () => {
  const file = tempFilePath();
  fs.writeFileSync(
    file,
    JSON.stringify({
      entries: [
        seedLegacyEntry("old", 1000, { source: "lobby", tags: ["规则清晰"] }),
        seedLegacyEntry("new", 3000, { source: "game_over", tags: ["好玩"] }),
        seedLegacyEntry("mid", 2000),
      ],
    }),
    "utf-8"
  );
  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);

  const list = listPublicFeedback({ sort: "newest" });
  assert.deepEqual(list.items.map((item) => item.id), ["new", "mid", "old"]);
  assert.equal(list.items[0].verifiedGameOver, true);
  assert.equal(list.items[1].verifiedGameOver, false);
  assert.equal(list.items[0].helpfulCount, 0);
  assert.equal(list.items[0].pinned, false);
  assert.deepEqual(list.items[2].tags, ["规则清晰"]);
});

test("gameContext is only kept for game_over and strictly sanitized", () => {
  freshStore();
  const lobbyAttempt = addFeedback({
    rating: 5,
    source: "lobby",
    gameContext: { modeLabel: "单人+5名AI", personaName: "罗盘精算师" },
  });
  assert.equal(lobbyAttempt.ok, true);
  if (!lobbyAttempt.ok) return;
  assert.equal(lobbyAttempt.entry.verifiedGameOver, false);
  assert.equal(lobbyAttempt.entry.gameContext, undefined);

  const gameOverOk = addFeedback({
    rating: 5,
    source: "game_over",
    gameContext: {
      modeLabel: "单人 + 5名AI",
      humanCount: 1,
      aiCount: 5,
      personaName: "罗盘精算师",
    },
  });
  assert.equal(gameOverOk.ok, true);
  if (!gameOverOk.ok) return;
  assert.equal(gameOverOk.entry.verifiedGameOver, true);
  assert.deepEqual(gameOverOk.entry.gameContext, {
    modeLabel: "单人 + 5名AI",
    humanCount: 1,
    aiCount: 5,
    personaName: "罗盘精算师",
  });

  const invalidPersona = addFeedback({
    rating: 4,
    source: "game_over",
    gameContext: { personaName: "不存在人格", humanCount: 99 },
  });
  assert.equal(invalidPersona.ok, true);
  if (!invalidPersona.ok) return;
  assert.equal(invalidPersona.entry.gameContext, undefined);
});

test("stats, distribution, positiveRate, and tagCounts exclude hidden reviews", () => {
  freshStore();
  addFeedback({ rating: 5, tags: ["好玩上头", "策略有深度"], source: "game_over" });
  addFeedback({ rating: 4, tags: ["好玩上头"], source: "lobby" });
  const hidden = addFeedback({ rating: 1, tags: ["节奏偏慢"] });
  assert.equal(hidden.ok, true);
  if (!hidden.ok) return;
  setFeedbackStatus(hidden.entry.id, "hidden");

  const stats = getFeedbackStats();
  assert.equal(stats.count, 2);
  assert.equal(stats.average, 4.5);
  assert.equal(stats.positiveRate, 100);
  assert.equal(stats.verifiedCount, 1);
  assert.deepEqual(stats.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
  assert.deepEqual(stats.tagCounts, [
    { tag: "好玩上头", count: 2 },
    { tag: "策略有深度", count: 1 },
  ]);
  assert.deepEqual(getFeedbackSummary(), { count: 2, average: 4.5 });
});

test("helpful voting toggles per voter and never leaks voterIds publicly", () => {
  freshStore();
  const created = addFeedback({ rating: 5, content: "很好玩" });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const badVoter = toggleFeedbackHelpful(created.entry.id, "abc");
  assert.equal(badVoter.ok, false);

  const vote1 = toggleFeedbackHelpful(created.entry.id, "fc_device_01");
  assert.deepEqual(vote1, { ok: true, helpfulCount: 1, voted: true });

  const vote2 = toggleFeedbackHelpful(created.entry.id, "fc_device_02");
  assert.deepEqual(vote2, { ok: true, helpfulCount: 2, voted: true });

  const listForVoter1 = listPublicFeedback({ voterId: "fc_device_01" });
  assert.equal(listForVoter1.items[0].helpfulCount, 2);
  assert.equal(listForVoter1.items[0].viewerHasVoted, true);
  assert.equal("helpfulVoterIds" in listForVoter1.items[0], false);
  assert.equal("editTokenHash" in listForVoter1.items[0], false);

  const unvote1 = toggleFeedbackHelpful(created.entry.id, "fc_device_01");
  assert.deepEqual(unvote1, { ok: true, helpfulCount: 1, voted: false });
});

test("featured sort prioritizes pinned, helpful, verified, and text reviews; filters work", () => {
  freshStore();
  const blank = addFeedback({ rating: 5, source: "lobby" });
  const detailed = addFeedback({
    rating: 4,
    content: "策略博弈很上头，跟朋友玩了整晚，AI 在后期抢风险项目非常凶！",
    tags: ["策略有深度"],
    source: "game_over",
  });
  const pinnedLow = addFeedback({ rating: 2, content: "节奏偏慢但很有潜力", tags: ["节奏偏慢"], source: "game_over" });
  assert.equal(blank.ok && detailed.ok && pinnedLow.ok, true);
  if (!blank.ok || !detailed.ok || !pinnedLow.ok) return;

  toggleFeedbackHelpful(detailed.entry.id, "fc_user_a");
  setFeedbackPinned(pinnedLow.entry.id, true);

  const featured = listPublicFeedback({ sort: "featured" });
  assert.deepEqual(
    featured.items.map((i) => i.id),
    [pinnedLow.entry.id, detailed.entry.id, blank.entry.id]
  );

  const highest = listPublicFeedback({ sort: "highest" });
  assert.equal(highest.items[0].id, blank.entry.id);

  const lowest = listPublicFeedback({ sort: "lowest" });
  assert.equal(lowest.items[0].id, pinnedLow.entry.id);

  const withText = listPublicFeedback({ withContent: true });
  assert.equal(withText.total, 2);

  const verifiedOnly = listPublicFeedback({ verifiedOnly: true, rating: 4 });
  assert.equal(verifiedOnly.total, 1);
  assert.equal(verifiedOnly.items[0].id, detailed.entry.id);

  const byTag = listPublicFeedback({ tag: "策略有深度" });
  assert.equal(byTag.total, 1);
  assert.equal(byTag.items[0].id, detailed.entry.id);
});

test("self-edit verifies editToken, updates entry, and preserves helpful votes", () => {
  freshStore();
  const created = addFeedback({
    rating: 3,
    content: "初版评价",
    tags: ["节奏偏慢"],
    source: "game_over",
    gameContext: { modeLabel: "双人+4名AI", personaName: "桥梁架构师" },
  });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  toggleFeedbackHelpful(created.entry.id, "fc_fan_1");

  const wrongToken = updateOwnFeedback(created.entry.id, "bad-token", {
    rating: 5,
    content: "篡改",
    tags: [],
  });
  assert.equal(wrongToken.ok, false);
  if (!wrongToken.ok) assert.equal(wrongToken.statusCode, 403);

  const updated = updateOwnFeedback(created.entry.id, created.editToken, {
    rating: 5,
    content: "二刷之后真香",
    tags: ["好玩上头", "策略有深度"],
    clearGameContext: true,
  });
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  assert.equal(updated.entry.rating, 5);
  assert.equal(updated.entry.content, "二刷之后真香");
  assert.deepEqual(updated.entry.tags, ["好玩上头", "策略有深度"]);
  assert.equal(updated.entry.helpfulCount, 1);
  assert.equal(updated.entry.gameContext, undefined);
  assert.equal(typeof updated.entry.updatedAt, "number");

  const pub = toPublicFeedbackEntry(updated.entry);
  assert.equal("editTokenHash" in pub, false);
});

test("admin reply, pin, search filter, and export work and survive reload", () => {
  const file = freshStore();
  const r1 = addFeedback({ rating: 2, content: "前期不知道先看哪个表", tags: ["新手易迷糊"], source: "lobby" });
  const r2 = addFeedback({ rating: 5, content: "太上头了", tags: ["好玩上头"], source: "game_over" });
  assert.equal(r1.ok && r2.ok, true);
  if (!r1.ok || !r2.ok) return;

  assert.equal(setFeedbackPinned(r1.entry.id, true), true);
  const replyRes = setFeedbackReply(r1.entry.id, "收到！我们正在优化第一轮引导。");
  assert.equal(replyRes.ok, true);
  if (replyRes.ok) {
    assert.equal(replyRes.officialReply?.content, "收到！我们正在优化第一轮引导。");
  }

  const adminSearch = listAdminFeedback({ status: "all", q: "哪个表" });
  assert.equal(adminSearch.total, 1);
  assert.equal(adminSearch.items[0].id, r1.entry.id);
  assert.equal(adminSearch.statusCounts.pinned, 1);

  const exported = getAdminFeedbackForExport({ status: "visible", rating: 2 });
  assert.equal(exported.length, 1);
  assert.equal(exported[0].officialReply?.content, "收到！我们正在优化第一轮引导。");

  // 清空回复
  const cleared = setFeedbackReply(r1.entry.id, "   ");
  assert.equal(cleared.ok, true);
  if (cleared.ok) assert.equal(cleared.officialReply, undefined);

  // 重新设置回复并校验磁盘重载
  setFeedbackReply(r2.entry.id, "感谢五星好评！");
  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);

  const reloaded = listPublicFeedback({ sort: "newest" });
  const reloadedR2 = reloaded.items.find((i) => i.id === r2.entry.id);
  const reloadedR1 = reloaded.items.find((i) => i.id === r1.entry.id);
  assert.equal(reloadedR2?.officialReply?.content, "感谢五星好评！");
  assert.equal(reloadedR1?.pinned, true);

  assert.equal(deleteFeedback(r1.entry.id), true);
  assert.equal(deleteFeedback(r1.entry.id), false);
});
