import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { FORBIDDEN_WORDS_ZH } from "../data/forbiddenWords.js";
import {
  addFeedback,
  deleteFeedback,
  getFeedbackSummary,
  initFeedbackPersistence,
  listAdminFeedback,
  listPublicFeedback,
  resetFeedbackStoreForTests,
  setFeedbackStatus,
  type FeedbackEntry,
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

function seedEntry(id: string, createdAt: number, overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
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

test("content is masked and capped at 300 chars, control chars removed", () => {
  freshStore();
  const forbidden = FORBIDDEN_WORDS_ZH[0];
  const masked = addFeedback({ rating: 5, content: `前缀 ${forbidden} 后缀` });
  assert.equal(masked.ok, true);
  if (!masked.ok) return;
  assert.equal(masked.entry.content.includes(forbidden), false);
  assert.equal(masked.entry.content.includes("*"), true);

  const long = addFeedback({ rating: 4, content: "测".repeat(400) });
  assert.equal(long.ok, true);
  if (!long.ok) return;
  assert.equal(long.entry.content.length, 300);

  const control = addFeedback({ rating: 3, content: "a\u0000b\u0007c" });
  assert.equal(control.ok, true);
  if (!control.ok) return;
  assert.equal(control.entry.content, "abc");

  const multiline = addFeedback({ rating: 4, content: "第一行\n\n\n第二行" });
  assert.equal(multiline.ok, true);
  if (!multiline.ok) return;
  assert.equal(multiline.entry.content, "第一行\n\n第二行");
});

test("tags are filtered by whitelist, deduped, and capped at 3", () => {
  freshStore();
  const result = addFeedback({
    rating: 4,
    tags: ["好玩", "好玩", "未知标签", "规则清晰", "AI 陪玩", "适合开黑", 123],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.entry.tags, ["好玩", "规则清晰", "AI 陪玩"]);
});

test("entries load sorted by createdAt descending", () => {
  const file = tempFilePath();
  fs.writeFileSync(
    file,
    JSON.stringify({
      entries: [
        seedEntry("old", 1000),
        seedEntry("new", 3000),
        seedEntry("mid", 2000),
      ],
    }),
    "utf-8"
  );
  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);

  const ids = listPublicFeedback().items.map((item) => item.id);
  assert.deepEqual(ids, ["new", "mid", "old"]);
});

test("pagination reports total and hasMore", () => {
  const file = tempFilePath();
  fs.writeFileSync(
    file,
    JSON.stringify({
      entries: [
        seedEntry("e5", 5000),
        seedEntry("e4", 4000),
        seedEntry("e3", 3000),
        seedEntry("e2", 2000),
        seedEntry("e1", 1000),
      ],
    }),
    "utf-8"
  );
  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);

  const first = listPublicFeedback({ offset: 0, limit: 2 });
  assert.equal(first.total, 5);
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);

  const last = listPublicFeedback({ offset: 4, limit: 2 });
  assert.equal(last.items.length, 1);
  assert.equal(last.hasMore, false);

  const admin = listAdminFeedback({ status: "all", offset: 0, limit: 3 });
  assert.equal(admin.total, 5);
  assert.equal(admin.items.length, 3);
  assert.equal(admin.hasMore, true);
});

test("hidden feedback is excluded from the public list and average", () => {
  freshStore();
  const visible = addFeedback({ rating: 5, content: "保留" });
  const toHide = addFeedback({ rating: 1, content: "隐藏" });
  assert.equal(visible.ok, true);
  assert.equal(toHide.ok, true);
  if (!visible.ok || !toHide.ok) return;

  assert.equal(setFeedbackStatus(toHide.entry.id, "hidden"), true);

  const publicList = listPublicFeedback();
  assert.equal(publicList.total, 1);
  assert.deepEqual(publicList.items.map((item) => item.id), [visible.entry.id]);
  assert.equal(publicList.average, 5);
  assert.equal(publicList.hasMore, false);

  const hidden = listAdminFeedback({ status: "hidden" });
  assert.equal(hidden.total, 1);
  assert.equal(hidden.items[0].id, toHide.entry.id);
  assert.equal(typeof hidden.items[0].hiddenAt, "number");
});

test("average is rounded to one decimal place", () => {
  freshStore();
  addFeedback({ rating: 5 });
  addFeedback({ rating: 4 });
  addFeedback({ rating: 2 });

  const list = listPublicFeedback();
  assert.equal(list.count, 3);
  assert.equal(list.average, 3.7);
  assert.deepEqual(getFeedbackSummary(), { count: 3, average: 3.7 });
});

test("setFeedbackStatus and deleteFeedback return false for unknown ids", () => {
  freshStore();
  const created = addFeedback({ rating: 5 });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  assert.equal(setFeedbackStatus(created.entry.id, "hidden"), true);
  assert.equal(setFeedbackStatus(created.entry.id, "visible"), true);
  assert.equal(setFeedbackStatus("fb_missing", "hidden"), false);

  assert.equal(deleteFeedback(created.entry.id), true);
  assert.equal(deleteFeedback(created.entry.id), false);
  assert.equal(listAdminFeedback({ status: "all" }).total, 0);
});

test("data survives a reload from disk", () => {
  const file = freshStore();
  const created = addFeedback({ rating: 4, content: "持久化评价", tags: ["好玩"] });
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const onDisk = JSON.parse(fs.readFileSync(file, "utf-8")) as { entries: FeedbackEntry[] };
  assert.equal(onDisk.entries.length, 1);
  assert.equal(onDisk.entries[0].content, "持久化评价");

  resetFeedbackStoreForTests();
  initFeedbackPersistence(file);

  const reloaded = listPublicFeedback();
  assert.equal(reloaded.total, 1);
  assert.equal(reloaded.items[0].id, created.entry.id);
  assert.equal(reloaded.items[0].content, "持久化评价");
  assert.deepEqual(reloaded.items[0].tags, ["好玩"]);
});
