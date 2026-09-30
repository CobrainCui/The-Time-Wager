/**
 * Stage server_upload contents: dist + deps + default images for uploads*.
 * Run from repo root after `npm run build` in frontend & server.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "_pack_staging", "server");

function rim(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

/** fs.cpSync 在部分 Windows + 非 ASCII 路径下会异常退出，用手动递归复制 */
function copyDirRecursive(srcDir, dstDir) {
  mkdirp(dstDir);
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

if (fs.existsSync(stage)) rim(stage);
mkdirp(path.join(stage, "dist"));
copyDirRecursive(path.join(root, "server", "dist"), path.join(stage, "dist"));
for (const f of ["package.json", "package-lock.json", ".env.example"]) {
  fs.copyFileSync(path.join(root, "server", f), path.join(stage, f));
}

const buffsDir = path.join(root, "frontend", "public", "images", "buffs");
const stagedBuffsDir = path.join(stage, "data", "uploads_buffs");
rim(stagedBuffsDir);
mkdirp(stagedBuffsDir);
const buffTs = fs.readFileSync(path.join(root, "frontend", "src", "data", "buffDefs.ts"), "utf8");
const buffIdRe = /^\s*(buff_[a-z0-9_]+)\s*:/gm;
let buffs = 0;
let bm;
const seededBuffIds = new Set();
while ((bm = buffIdRe.exec(buffTs))) {
  const id = bm[1];
  const src = path.join(buffsDir, `${id}.jpg`);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(stagedBuffsDir, `${id}.jpg`));
  seededBuffIds.add(id);
  buffs++;
}
// 清掉整包残留的下线/多余道具图（Windows 上整目录 rm 偶发留文件）
for (const f of fs.readdirSync(stagedBuffsDir)) {
  if (!f.toLowerCase().endsWith(".jpg")) continue;
  const id = f.replace(/\.jpg$/i, "");
  if (!seededBuffIds.has(id)) fs.unlinkSync(path.join(stagedBuffsDir, f));
}
/** Seed uploads_eras with Chinese ids (Node/Linux OK); zip via UTF-8-aware packer. */
const erasDir = path.join(stage, "data", "uploads_eras");
rim(erasDir);
mkdirp(erasDir);
const ERA_ASCII_TO_CN = {
  "climate.jpg": "气候.jpg",
  "tech.jpg": "科技.jpg",
  "culture.jpg": "文化.jpg",
  "health.jpg": "健康.jpg",
  "mind.jpg": "心理.jpg",
};
const erasPublic = path.join(root, "frontend", "public", "images", "eras");
let eras = 0;
for (const [ascii, cn] of Object.entries(ERA_ASCII_TO_CN)) {
  const src = path.join(erasPublic, ascii);
  if (!fs.existsSync(src)) continue;
  fs.copyFileSync(src, path.join(erasDir, cn));
  eras++;
}

const uploadsDir = path.join(stage, "data", "uploads");
mkdirp(uploadsDir);
const projTs = fs.readFileSync(path.join(root, "frontend", "src", "config", "projects.ts"), "utf8");
const re = /\{id:\s*(\d+),\s*name:'([^']+)'/g;
let m;
let projects = 0;
while ((m = re.exec(projTs))) {
  const src = path.join(root, "frontend", "public", "images", "projects", `${m[1]}.jpg`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(uploadsDir, `${m[1]}.jpg`));
    projects++;
  }
}

const personaSlugs = ["Bridge", "Moment", "Navigator", "Planter", "Poet", "Wave"];
const personasDir = path.join(stage, "data", "uploads_personas");
mkdirp(personasDir);
let personas = 0;
for (const slug of personaSlugs) {
  const src = path.join(root, "frontend", "public", "images", "personas", `${slug}.jpg`);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(personasDir, `${slug}.jpg`));
    personas++;
  }
}

console.log(
  JSON.stringify({ buffs, eras, projects, personas, stage }, null, 2),
);
