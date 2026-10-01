import fs from "node:fs";
import path from "node:path";

import { getFrontendDistDir } from "./repoRoot.mjs";

export function assetRefsFromHtml(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const refs = new Set();
  for (const m of html.matchAll(/\/assets\/([^"'\s>]+)/g)) {
    refs.add(m[1]);
  }
  return refs;
}

/** index.html + admin.html 直接引用的 /assets/* 路径 */
export function getHtmlReferencedAssets() {
  const dist = getFrontendDistDir();
  const keep = new Set();
  for (const name of ["index.html", "admin.html"]) {
    const p = path.join(dist, name);
    if (fs.existsSync(p)) {
      for (const r of assetRefsFromHtml(p)) keep.add(r);
    }
  }
  return keep;
}
