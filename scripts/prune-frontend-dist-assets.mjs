import fs from "node:fs";
import path from "node:path";

import { getFrontendDistDir } from "./lib/repoRoot.mjs";
import { getHtmlReferencedAssets } from "./lib/frontendDistHtmlRefs.mjs";

const dist = getFrontendDistDir();
const assetsDir = path.join(dist, "assets");
const keep = getHtmlReferencedAssets();

if (!fs.existsSync(assetsDir)) {
  console.log("no assets dir");
  process.exit(0);
}

// 只删「同入口多版本」的旧 hash（导致线上仍加载 16 的 main/useSocketConnection），
// 不删懒加载 chunk（GameOver、chart-vendor 等由 JS 动态 import，不在 html 里）。
const stalePrefix = /^(main|admin|useSocketConnection)-.+\.js$/;
let removed = 0;
for (const f of fs.readdirSync(assetsDir)) {
  const full = path.join(assetsDir, f);
  if (!fs.statSync(full).isFile()) continue;
  if (!stalePrefix.test(f)) continue;
  if (keep.has(f)) continue;
  fs.unlinkSync(full);
  removed++;
}
console.log(`pruned ${removed} stale hashed entry chunk(s); html references ${keep.size} asset path(s).`);
