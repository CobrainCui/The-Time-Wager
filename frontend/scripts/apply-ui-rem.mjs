import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, "..", "src");
const THRESHOLD = 1.35;

const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && e.name !== "utils" && e.name !== "config") walk(p);
    else if (e.isFile() && p.endsWith(".tsx")) files.push(p);
  }
}
walk(srcRoot);

const re = /fontSize:\s*["']([0-9.]+)rem["']/g;

for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  let changed = false;
  content = content.replace(re, (match, numStr) => {
    const n = parseFloat(numStr);
    if (n >= THRESHOLD) return match;
    changed = true;
    return `fontSize: uiRem(${numStr})`;
  });
  if (!changed) continue;

  if (!content.includes('from "../utils/typography"') && !content.includes('from "./utils/typography"')) {
    const rel = path.relative(path.dirname(file), path.join(srcRoot, "utils", "typography.ts")).replace(/\\/g, "/").replace(/\.ts$/, "");
    const importPath = rel.startsWith(".") ? rel : "./" + rel;
    const importLine = `import { uiRem } from "${importPath}";\n`;
    const firstImport = content.match(/^import .+\n/m);
    if (firstImport) {
      content = content.replace(firstImport[0], firstImport[0] + importLine);
    } else {
      content = importLine + content;
    }
  }
  fs.writeFileSync(file, content);
  console.log("updated", path.relative(srcRoot, file));
}
