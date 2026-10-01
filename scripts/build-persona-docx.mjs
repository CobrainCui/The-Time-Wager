/**
 * 生成「命运素描人格图鉴」Word：六种人格名称 + 立绘 + 描述。
 * 文案与 frontend/src/config/personaConfig.ts 的 FATE_SKETCH_CONFIG 保持一致。
 *
 * 用法（仓库根目录）：
 *   npm i docx --no-save
 *   node scripts/build-persona-docx.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
} from "docx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PERSONAS_DIR = path.join(ROOT, "frontend", "public", "images", "personas");
const OUT_DIR = path.join(ROOT, "docs");
const OUT_FILE = path.join(OUT_DIR, "命运素描人格图鉴.docx");

/** 与 frontend FATE_SKETCH_CONFIG / FATE_SKETCH_IMAGE_SLUG 一致 */
const PERSONAS = [
  {
    name: "桥梁架构师",
    slug: "Bridge",
    desc: "你擅长在博弈场中编织人际联结与信任网络，依靠协作拿到单人无法企及的机会。对你而言，关系本身就是资源。",
  },
  {
    name: "瞬刻炼金士",
    slug: "Moment",
    desc: "你偏好见效迅速的短期机会，重视本轮就能落袋的周转收益；善于借卡牌调整对局节奏，抢占每一轮即时的行动空间。",
  },
  {
    name: "罗盘精算师",
    slug: "Navigator",
    desc: "你本能规避会造成毁灭性回撤的高风险博弈，无意干预他人策略。习惯在既定规则下审慎推演，算清每一轮投入与精力分配，谋定而后动。",
  },
  {
    name: "时荫植者",
    slug: "Planter",
    desc: "你倾向深耕需要漫长周期兑现价值的长期布局，能够忍耐前期缓慢的收益，在旁人观望迟疑时，默默培育未来的回报。",
  },
  {
    name: "随机诗人",
    slug: "Poet",
    desc: "你的策略不被单一框架束缚，长线布局、短线套利、灵活扰动交替使用，走出一条贴合自身直觉、无法复刻的独特对局路径。",
  },
  {
    name: "涌机触发者",
    slug: "Wave",
    desc: "你敢于重仓高风险机会，善用杠杆、做空与干扰类卡牌；在局势动荡的不确定性里捕捉机会，借波动攫取收益。",
  },
];

/** 立绘竖版 2:3，Word 中约半页高 */
const IMAGE_WIDTH_PX = 280;
const IMAGE_HEIGHT_PX = 420;

function personaSection(persona, { pageBreakBefore }) {
  const imgPath = path.join(PERSONAS_DIR, `${persona.slug}.jpg`);
  if (!fs.existsSync(imgPath)) {
    throw new Error(`缺少立绘：${imgPath}`);
  }
  const imageBuffer = fs.readFileSync(imgPath);

  const children = [];
  if (pageBreakBefore) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: persona.name,
          bold: true,
          size: 36,
          font: "Microsoft YaHei",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 280 },
      children: [
        new ImageRun({
          type: "jpg",
          data: imageBuffer,
          transformation: {
            width: IMAGE_WIDTH_PX,
            height: IMAGE_HEIGHT_PX,
          },
          altText: {
            title: persona.name,
            description: `${persona.name}立绘`,
            name: persona.slug,
          },
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: "描述",
          bold: true,
          size: 24,
          font: "Microsoft YaHei",
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: persona.desc,
          size: 22,
          font: "Microsoft YaHei",
        }),
      ],
    })
  );
  return children;
}

async function main() {
  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "命运素描人格图鉴",
          bold: true,
          size: 48,
          font: "Microsoft YaHei",
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: "光阴对赌 · 六种命运素描（名称 · 立绘 · 描述）",
          size: 22,
          font: "Microsoft YaHei",
          color: "666666",
        }),
      ],
    }),
  ];

  for (let i = 0; i < PERSONAS.length; i++) {
    children.push(...personaSection(PERSONAS[i], { pageBreakBefore: true }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT_FILE, buffer);
  console.log(`Wrote ${OUT_FILE} (${buffer.length} bytes, ${PERSONAS.length} personas)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
