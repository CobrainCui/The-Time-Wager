/**
 * 从 卡牌图片/道具卡 识别卡名 → 压缩为默认道具卡面。
 * 运行：cd scratch && npm install && npm run process:buffs
 * 改源图后重新运行，并提交 frontend/public/images/buffs/*.jpg 与 buff_image_mapping.json
 */
const fs = require("fs");
const path = require("path");
const Tesseract = require("tesseract.js");
const stringSimilarity = require("string-similarity");
const sharp = require("sharp");

const SRC_DIR = path.join(__dirname, "../卡牌图片/道具卡");
const OUT_DIR = path.join(__dirname, "../frontend/public/images/buffs");
const MAPPING_PATH = path.join(__dirname, "buff_image_mapping.json");

const BUFF_CARDS = [
  { id: "buff_gold", name: "点石成金", aliases: ["点石", "成金"] },
  { id: "buff_short", name: "项目做空", aliases: ["做空", "PROJECT"] },
  { id: "buff_slack", name: "摸鱼传染", aliases: ["摸鱼"] },
  { id: "buff_insurance", name: "保险", aliases: ["INSURANCE"] },
  { id: "buff_lottery", name: "彩票", aliases: ["LOTTERY"] },
  { id: "buff_force_buy", name: "强买强卖", aliases: ["强买", "强卖"] },
  { id: "buff_work_rest", name: "劳逸结合", aliases: ["劳逸"] },
  { id: "buff_lighter", name: "打火机", aliases: ["打火"] },
];

const NAMES = BUFF_CARDS.map((c) => c.name);
const NAME_TO_ID = Object.fromEntries(BUFF_CARDS.map((c) => [c.name, c.id]));

const OUT_WIDTH = 600;
const OUT_HEIGHT = 800;
const JPEG_QUALITY = 80;
const MIN_CONFIDENCE = 0.12;

function loadOverrides() {
  if (!fs.existsSync(MAPPING_PATH)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
    return data.overrides && typeof data.overrides === "object" ? data.overrides : {};
  } catch {
    return {};
  }
}

const ENGLISH_HINTS = [
  { id: "buff_gold", patterns: ["TURNSTONE", "INTOGOLD", "点石成金"] },
  { id: "buff_short", patterns: ["PROJECTSHORT", "SHORTSELLING", "项目做空", "做空"] },
  { id: "buff_slack", patterns: ["SLACKINGISCONTAGIOUS", "SLACKING", "摸鱼传染", "摸鱼"] },
  { id: "buff_insurance", patterns: ["INSURANCE", "保险"] },
  { id: "buff_lottery", patterns: ["LOTTERY", "彩票"] },
  { id: "buff_force_buy", patterns: ["FORCEEDTRADING", "FORCEDTRADING", "强买强卖", "强买"] },
  { id: "buff_work_rest", patterns: ["HARMONIOUSBALANCE", "劳逸结合", "劳逸"] },
  { id: "buff_lighter", patterns: ["LIGHTER", "打火机"] },
];

function matchCardId(cleanText) {
  if (!cleanText) return null;
  const upper = cleanText.toUpperCase();

  for (const { id, patterns } of ENGLISH_HINTS) {
    for (const p of patterns) {
      const key = p.replace(/\s+/g, "").toUpperCase();
      if (upper.includes(key) || cleanText.includes(p)) return id;
    }
  }

  for (const card of BUFF_CARDS) {
    if (cleanText.includes(card.name)) return card.id;
    for (const a of card.aliases) {
      if (a.length >= 2 && cleanText.includes(a)) return card.id;
    }
  }

  const sim = stringSimilarity.findBestMatch(cleanText, NAMES);
  if (sim.bestMatch.rating >= MIN_CONFIDENCE) {
    return NAME_TO_ID[sim.bestMatch.target];
  }
  return null;
}

async function recognizeCardText(filePath) {
  const meta = await sharp(filePath).metadata();
  const cropTop = Math.floor(meta.height * 0.58);
  const cropHeight = Math.max(1, meta.height - cropTop);

  const bottomBuf = await sharp(filePath)
    .extract({ left: 0, top: cropTop, width: meta.width, height: cropHeight })
    .toBuffer();

  const worker = await Tesseract.createWorker("chi_sim", 1, {
    logger: () => {},
  });

  let text = "";
  try {
    const bottom = await worker.recognize(bottomBuf);
    text = bottom.data.text || "";
    if (text.replace(/\s+/g, "").length < 4) {
      const full = await worker.recognize(filePath);
      text = `${text} ${full.data.text || ""}`;
    }
  } finally {
    await worker.terminate();
  }

  return text.replace(/\s+/g, "");
}

async function writeJpeg(srcPath, outPath) {
  await sharp(srcPath)
    .resize(OUT_WIDTH, OUT_HEIGHT, { fit: "cover" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(outPath);
}

async function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Missing source dir: ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const overrides = loadOverrides();
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => /\.(jpg|jpeg|png)$/i.test(f));

  console.log(`Found ${files.length} source images.`);

  const assigned = new Map();
  const results = [];

  for (const file of files) {
    const filePath = path.join(SRC_DIR, file);
    let cardId = overrides[file] || null;
    let ocrText = "";
    let confidence = null;
    let method = "override";

    if (!cardId) {
      method = "ocr";
      ocrText = await recognizeCardText(filePath);
      console.log(`  ${file} OCR: ${ocrText.slice(0, 40)}${ocrText.length > 40 ? "…" : ""}`);
      cardId = matchCardId(ocrText);
      if (cardId) {
        const card = BUFF_CARDS.find((c) => c.id === cardId);
        const sim = stringSimilarity.compareTwoStrings(ocrText, card?.name || "");
        confidence = sim;
      }
    }

    results.push({ file, cardId, ocrText, confidence, method });

    if (!cardId) {
      console.warn(`  WARN: could not map ${file}`);
      continue;
    }
    if (assigned.has(cardId)) {
      console.error(`  ERROR: duplicate cardId ${cardId} for ${file} (already ${assigned.get(cardId)})`);
      process.exitCode = 1;
      continue;
    }
    assigned.set(cardId, file);

    const outPath = path.join(OUT_DIR, `${cardId}.jpg`);
    await writeJpeg(filePath, outPath);
    console.log(`  → ${cardId}.jpg`);
  }

  const mapping = {
    generatedAt: new Date().toISOString(),
    overrides,
    notes:
      "在 overrides 中手工指定 源文件名→cardId 可跳过 OCR；改图后重新 npm run process:buffs",
    results,
    missingCardIds: BUFF_CARDS.map((c) => c.id).filter((id) => !assigned.has(id)),
    unmappedFiles: files.filter((f) => !results.find((r) => r.file === f && r.cardId)),
  };

  fs.writeFileSync(MAPPING_PATH, JSON.stringify(mapping, null, 2), "utf8");
  console.log(`Wrote ${MAPPING_PATH}`);

  if (mapping.missingCardIds.length) {
    console.error(`Missing cards: ${mapping.missingCardIds.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
