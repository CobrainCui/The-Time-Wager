/**
 * 从 卡牌图片/人格（第一版） 按卡面英文标题映射到 FATE_SKETCH slug，压缩后写入默认立绘路径。
 * 运行：node process_personas.js（在 scratch 目录，需 npm install）
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC_DIR = path.join(__dirname, "../卡牌图片/人格（第一版）");
const OUT_BASE = path.join(__dirname, "../frontend/public/assets/pdf_templates");

/** 源文件名 → slug（依据卡底英文标题） */
const FILE_TO_SLUG = {
  "微信图片_20251216201151_503_1081.jpg": "Navigator", // The Navigator of Certainty
  "微信图片_20251216201152_504_1081.jpg": "Planter", // The Shade Planter
  "微信图片_20251216201153_505_1081.jpg": "Wave", // The Wave Rider
  "微信图片_20251216201154_506_1081.jpg": "Moment", // The Moment Alchemist
  "微信图片_20251216201155_507_1081.jpg": "Bridge", // The Bridge Architect
  "微信图片_20251216201156_508_1081.jpg": "Poet", // The Randomness Poet
};

const MAX_WIDTH = 1000;
const JPEG_QUALITY = 82;

async function main() {
  for (const [file, slug] of Object.entries(FILE_TO_SLUG)) {
    const src = path.join(SRC_DIR, file);
    if (!fs.existsSync(src)) {
      console.error(`Missing source: ${file}`);
      process.exitCode = 1;
      continue;
    }
    const outDir = path.join(OUT_BASE, slug);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "1.jpg");
    const before = fs.statSync(src).size;
    await sharp(src)
      .resize(MAX_WIDTH, null, { withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toFile(outPath);
    const after = fs.statSync(outPath).size;
    console.log(`${slug}: ${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB  →  ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
