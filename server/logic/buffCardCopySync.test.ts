import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buffCards } from "../data/game_data.js";

const catalogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../frontend/src/config/buffCards.ts"
);

/**
 * 卡面文案在 frontend 以 `X_CARD_BULLETS` 数组维护，经 formatBuffBullets 拼成
 * `· 条目\n· 条目`。这里按同样规则还原，保证与服务端 game_data 字符级一致。
 */
function parseBulletDescriptions(src: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of src.matchAll(
    /export const (\w+)_CARD_BULLETS(?::[^=]*)?\s*=\s*\[([\s\S]*?)\]\s*;/g
  )) {
    const bullets: string[] = [];
    for (const s of m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      bullets.push(s[1]);
    }
    map[`${m[1]}_CARD_DESCRIPTION`] = bullets.map((b) => `· ${b}`).join("\n");
  }
  return map;
}

function extractDescriptionConstants(src: string): Record<string, string> {
  return parseBulletDescriptions(src);
}

function resolveDescValue(raw: string, consts: Record<string, string>): string {
  const t = raw.trim();
  if (t.startsWith('"')) {
    return t.slice(1, -1);
  }
  if (t in consts) return consts[t];
  return t;
}

/** Parse BUFF_CARD_DEFS desc fields from buffCards.ts (kept in sync via this test). */
function parseFrontendBuffDescriptions(src: string): Record<string, string> {
  const consts = extractDescriptionConstants(src);
  const out: Record<string, string> = {};
  const blockStart = src.indexOf("export const BUFF_CARD_DEFS");
  assert.ok(blockStart >= 0, "BUFF_CARD_DEFS missing");
  const block = src.slice(blockStart);
  for (const m of block.matchAll(/(buff_\w+):\s*\{[^}]*?desc:\s*([^,\n]+)/gs)) {
    const id = m[1];
    const raw = m[2].trim();
    out[id] = resolveDescValue(raw, consts);
  }
  return out;
}

describe("buff card copy sync", () => {
  const src = readFileSync(catalogPath, "utf8");
  const frontendDesc = parseFrontendBuffDescriptions(src);

  it("frontend catalog has all server buff ids", () => {
    for (const card of buffCards) {
      assert.ok(frontendDesc[card.id], `frontend missing desc for ${card.id}`);
    }
  });

  it("game_data descriptions match BUFF_CARD_DEFS.desc", () => {
    for (const card of buffCards) {
      assert.equal(
        card.description,
        frontendDesc[card.id],
        `description drift for ${card.id} — update server/data/game_data.ts or frontend/src/config/buffCards.ts`
      );
    }
  });

  it("BUFF_UI_SNIPPETS stay aligned with settlement terminology", () => {
    assert.ok(src.includes("结算页判定"), "lighter confirm snippet should use 结算页判定");
    assert.equal(src.includes("结算页统一判定"), false, "avoid mixed 统一判定 wording in catalog");
  });

  it("catalog L1 does not use legacy 本轮/往轮 wording", () => {
    const lighterBulletsOnly =
      src.match(/export const LIGHTER_CARD_BULLETS[\s\S]*?=\s*\[([\s\S]*?)\]\s*(?:as const)?;/)?.[1] ?? "";
    assert.equal(lighterBulletsOnly.includes("本轮"), false, "lighter bullets must not contain 本轮");
    assert.equal(lighterBulletsOnly.includes("往轮"), false, "lighter bullets must not contain 往轮");
    for (const [id, desc] of Object.entries(frontendDesc)) {
      if (id === "buff_short") continue;
      assert.equal(desc.includes("本轮"), false, `${id} desc must not contain 本轮`);
      assert.equal(desc.includes("往轮"), false, `${id} desc must not contain 往轮`);
    }
  });

  it("player-facing copy does not use obsolete blind-pick wording", () => {
    for (const [id, desc] of Object.entries(frontendDesc)) {
      assert.equal(desc.includes("盲选"), false, `${id} desc must not contain 盲选`);
    }
    for (const m of src.matchAll(/desc:\s*"([^"]*)"/g)) {
      assert.equal(m[1].includes("盲选"), false, "inline desc must not contain 盲选");
    }
  });
});
