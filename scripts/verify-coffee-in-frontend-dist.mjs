import fs from "node:fs";
import path from "node:path";

import { getFrontendDistDir } from "./lib/repoRoot.mjs";
import { getHtmlReferencedAssets } from "./lib/frontendDistHtmlRefs.mjs";

const dist = getFrontendDistDir();
const assetsDir = path.join(dist, "assets");
if (!fs.existsSync(assetsDir)) {
  console.error("missing frontend/dist/assets — run: cd frontend && npm run build");
  process.exit(1);
}

const keep = getHtmlReferencedAssets();
const coffeeBad = [
  "来杯咖啡(-16",
  "来杯咖啡（-16",
  "消耗16财富",
  "需要16💰",
  "K=16,X=1",
];

function listTopLevelJs() {
  return fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js") && fs.statSync(path.join(assetsDir, f)).isFile());
}

for (const f of listTopLevelJs()) {
  const content = fs.readFileSync(path.join(assetsDir, f), "utf8");
  for (const s of coffeeBad) {
    if (content.includes(s)) {
      console.error(`FAIL: ${f} still contains coffee price literal: ${s}`);
      process.exit(1);
    }
  }
}

const entryChunk = [...keep].find((f) => /^useSocketConnection-.+\.js$/.test(f));
if (!entryChunk) {
  console.error("FAIL: index/admin html missing useSocketConnection-*.js reference");
  process.exit(1);
}
const entryPath = path.join(assetsDir, entryChunk);
if (!fs.existsSync(entryPath)) {
  console.error(`FAIL: missing entry chunk ${entryChunk}`);
  process.exit(1);
}
const entry = fs.readFileSync(entryPath, "utf8");
if (!entry.includes("K=17,Q=1") && !entry.includes("const K=17") && !entry.includes("K=17,X=1")) {
  console.error(`FAIL: ${entryChunk} does not contain coffee config K=17 (expected K=17,Q=1)`);
  process.exit(1);
}

console.log(`OK: coffee wealth cost 17 in ${entryChunk}; no stale 16 literals in dist/assets/*.js`);
