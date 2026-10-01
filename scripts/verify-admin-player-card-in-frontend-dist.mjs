import fs from "node:fs";
import path from "node:path";

import { getFrontendDistDir } from "./lib/repoRoot.mjs";
import { assetRefsFromHtml } from "./lib/frontendDistHtmlRefs.mjs";

const dist = getFrontendDistDir();
const adminHtml = path.join(dist, "admin.html");
if (!fs.existsSync(adminHtml)) {
  console.error("missing frontend/dist/admin.html — run: cd frontend && npm run build");
  process.exit(1);
}

const refs = assetRefsFromHtml(adminHtml);
const adminChunk = [...refs].find((f) => /^admin-.+\.js$/.test(f));
if (!adminChunk) {
  console.error("FAIL: admin.html missing admin-*.js reference");
  process.exit(1);
}

const chunkPath = path.join(dist, "assets", adminChunk);
if (!fs.existsSync(chunkPath)) {
  console.error(`FAIL: missing admin chunk ${adminChunk}`);
  process.exit(1);
}

const content = fs.readFileSync(chunkPath, "utf8");
if (!content.includes("adminAdjustPlayerCard")) {
  console.error(`FAIL: ${adminChunk} missing adminAdjustPlayerCard emit`);
  process.exit(1);
}
if (!content.includes("补发")) {
  console.error(`FAIL: ${adminChunk} missing 补发 UI label (hand column entry)`);
  process.exit(1);
}

console.log(`OK: admin hand card adjust UI in ${adminChunk}`);
