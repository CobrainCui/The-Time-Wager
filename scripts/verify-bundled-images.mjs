/**
 * Fail frontend build if bundled default images are missing.
 * Keeps era/project defaults on ASCII paths so Windows zip → Linux unzip stays stable.
 * Run from repo root or via frontend npm run build.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const images = path.join(root, "frontend", "public", "images");
const missing = [];

function requireFile(rel) {
  const p = path.join(images, rel);
  if (!fs.existsSync(p)) missing.push(rel.replace(/\\/g, "/"));
}

const ERA_FILES = ["climate.jpg", "tech.jpg", "culture.jpg", "health.jpg", "mind.jpg"];
for (const f of ERA_FILES) requireFile(path.join("eras", f));
const erasDir = path.join(images, "eras");
if (fs.existsSync(erasDir)) {
  for (const f of fs.readdirSync(erasDir)) {
    if (!ERA_FILES.includes(f) && f.toLowerCase().endsWith(".jpg")) {
      missing.push(`eras/${f} (only ASCII names allowed: ${ERA_FILES.join(", ")})`);
    }
  }
}

const PERSONA_SLUGS = ["Bridge", "Moment", "Navigator", "Planter", "Poet", "Wave"];
for (const s of PERSONA_SLUGS) requireFile(path.join("personas", `${s}.jpg`));

const projTs = fs.readFileSync(path.join(root, "frontend", "src", "config", "projects.ts"), "utf8");
const projRe = /\{id:\s*(\d+),/g;
let m;
const projectIds = new Set();
while ((m = projRe.exec(projTs))) {
  projectIds.add(m[1]);
  requireFile(path.join("projects", `${m[1]}.jpg`));
}
const projectsDir = path.join(images, "projects");
if (fs.existsSync(projectsDir)) {
  for (const f of fs.readdirSync(projectsDir)) {
    if (!f.toLowerCase().endsWith(".jpg")) continue;
    if (!/^\d+\.jpg$/.test(f)) {
      missing.push(`projects/${f} (only numeric {id}.jpg allowed)`);
      continue;
    }
    if (!projectIds.has(f.replace(/\.jpg$/i, ""))) {
      missing.push(`projects/${f} (id not in projects.ts)`);
    }
  }
}

const buffTs = fs.readFileSync(path.join(root, "frontend", "src", "data", "buffDefs.ts"), "utf8");
const buffRe = /^\s*(buff_[a-z0-9_]+)\s*:/gm;
const buffIds = new Set();
while ((m = buffRe.exec(buffTs))) {
  buffIds.add(m[1]);
  requireFile(path.join("buffs", `${m[1]}.jpg`));
}
const buffsDir = path.join(images, "buffs");
if (fs.existsSync(buffsDir)) {
  for (const f of fs.readdirSync(buffsDir)) {
    if (!f.toLowerCase().endsWith(".jpg")) continue;
    const id = f.replace(/\.jpg$/i, "");
    if (!buffIds.has(id)) {
      missing.push(`buffs/${f} (id not in buffDefs.ts — remove retired/orphan defaults)`);
    }
  }
}

if (missing.length) {
  console.error("verify-bundled-images: missing files under frontend/public/images:\n" + missing.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      eras: ERA_FILES.length,
      projects: projectIds.size,
      personas: PERSONA_SLUGS.length,
      buffs: buffIds.size,
    },
    null,
    2,
  ),
);
