const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const stringSimilarity = require('string-similarity');
const sharp = require('sharp');

const SOURCE_DIR = 'D:/workspace/光阴对赌/桌游人生/图片/时代';
const TARGET_PUBLIC = path.join(__dirname, '../frontend/public/images/eras');
const TARGET_DIST = path.join(__dirname, '../frontend/dist/images/eras');

const ERAS = ['气候', '科技', '文化', '健康', '心理'];

async function main() {
  if (!fs.existsSync(TARGET_PUBLIC)) fs.mkdirSync(TARGET_PUBLIC, { recursive: true });
  if (!fs.existsSync(TARGET_DIST)) fs.mkdirSync(TARGET_DIST, { recursive: true });

  const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.jpg') || f.endsWith('.png'));
  console.log(`Found ${files.length} era images.`);

  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    console.log(`Processing ${file}...`);

    try {
      // 提取下半部分的文字进行 OCR (时代卡牌通常中间或偏下有字)
      const meta = await sharp(filePath).metadata();
      const cropHeight = Math.floor(meta.height * 0.4);
      const cropTop = Math.floor(meta.height * 0.6);
      
      const croppedBuffer = await sharp(filePath)
        .extract({ left: 0, top: cropTop, width: meta.width, height: cropHeight })
        .toBuffer();

      const worker = await Tesseract.createWorker('chi_sim', 1, {
        workerPath: './node_modules/tesseract.js/dist/worker.min.js',
        langPath: __dirname,
        corePath: './node_modules/tesseract.js-core/tesseract-core.wasm.js',
      });
      
      const ret = await worker.recognize(croppedBuffer);
      const text = ret.data.text.replace(/\s+/g, '');
      await worker.terminate();
      
      console.log(`  OCR Text: ${text}`);

      let bestMatch = "";
      if (text) {
        const matches = stringSimilarity.findBestMatch(text, ERAS);
        if (matches.bestMatch.rating > 0) {
          bestMatch = matches.bestMatch.target;
        }
      }

      // 强制手动回退机制 (如果 OCR 不准，我们直接用启发式猜测，或者这里有 5 个文件对应 5 个时代)
      // 如果匹配不到，我们后续可能需要手动命名。为了全自动，我会先跑一下看看结果。
      
      if (bestMatch) {
         console.log(`  Matched: ${bestMatch}`);
         
         const outName = `${bestMatch}.jpg`;
         
         await sharp(filePath)
           .resize(600, 900, { fit: 'cover' })
           .jpeg({ quality: 80 })
           .toFile(path.join(TARGET_PUBLIC, outName));
           
         await sharp(filePath)
           .resize(600, 900, { fit: 'cover' })
           .jpeg({ quality: 80 })
           .toFile(path.join(TARGET_DIST, outName));
      } else {
         console.log(`  Could not match confidently.`);
      }

    } catch (e) {
      console.error(e);
    }
  }
}

main().catch(console.error);
