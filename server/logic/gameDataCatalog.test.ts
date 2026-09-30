import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { longTermProjects } from "../data/game_data.js";

const LONG_MAX_ENERGY_BY_ID: Record<number, number> = {
  101: 90,
  102: 100,
  103: 90,
  104: 90,
  105: 100,
  106: 90,
  107: 110,
};

describe("longTermProjects catalog maxEnergy", () => {
  it("matches 90 / 100 / 110 tiers in game_data", () => {
    assert.equal(longTermProjects.length, 7);
    for (const card of longTermProjects) {
      const expected = LONG_MAX_ENERGY_BY_ID[card.id];
      assert.equal(
        card.maxEnergy,
        expected,
        `game_data long id ${card.id} (${card.name}) maxEnergy`
      );
    }
  });

  it("frontend projectCatalog.ts stays in sync with game_data", () => {
    const catalogPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../frontend/src/config/projectCatalog.ts"
    );
    const src = readFileSync(catalogPath, "utf8");
    for (const card of longTermProjects) {
      const re = new RegExp(`id: ${card.id},[^\\n]*maxEnergy: (\\d+)`);
      const match = src.match(re);
      assert.ok(match, `projectCatalog missing long id ${card.id}`);
      assert.equal(
        Number(match[1]),
        card.maxEnergy,
        `projectCatalog id ${card.id} maxEnergy`
      );
    }
  });
});
