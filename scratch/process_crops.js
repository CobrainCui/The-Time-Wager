const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const stringSimilarity = require('string-similarity');
const sharp = require('sharp');

const DIST_IMG_DIR = path.join(__dirname, '../frontend/dist/images/projects');
const PUBLIC_IMG_DIR = path.join(__dirname, '../frontend/public/images/projects');

const knownProjects = [
  "EAP全面推行",
  "“全民健身日”嘉年华",
  "公共体育设施免费开放",
  "国际文化艺术节",
  "多元文明交响",
  "完美身材",
  "建立体育俱乐部",
  "开采化石能源",
  "心灵觉醒浪潮",
  "数字图书馆",
  "数字排毒",
  "数字星河时代",
  "文化商品化",
  "文化桥梁使者",
  "新能源汽车",
  "植树造林",
  "民俗主题公园",
  "蔚蓝星球计划",
  "遗产保护基金",
  "项目做空"
];

async function main() {
  const files = fs.readdirSync(DIST_IMG_DIR)
                  .filter(f => f.startsWith('微信图片_') && f.endsWith('.png'));
                  
  console.log(`Found ${files.length} manually cropped images.`);
  
  if (!fs.existsSync(PUBLIC_IMG_DIR)) {
    fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
  }

  for (const file of files) {
    const filePath = path.join(DIST_IMG_DIR, file);
    console.log(`Processing ${file}...`);
    try {
      // 1. OCR the image
      const { data: { text } } = await Tesseract.recognize(
        filePath,
        'chi_sim',
        { logger: m => {} }
      );
      
      const cleanText = text.replace(/\s+/g, '');
      console.log(`  OCR Text: ${cleanText}`);
      
      // 2. Find best match
      const matches = stringSimilarity.findBestMatch(cleanText, knownProjects);
      const bestMatch = matches.bestMatch.target;
      const confidence = matches.bestMatch.rating;
      
      console.log(`  Matched: ${bestMatch} (confidence: ${confidence.toFixed(2)})`);
      
      if (confidence > 0.1) {
        // 3. Compress and save to public folder
        const outPath = path.join(PUBLIC_IMG_DIR, `${bestMatch}.jpg`);
        await sharp(filePath)
          .resize(800, 450, { fit: 'cover' }) // ensure proper size
          .jpeg({ quality: 80 })
          .toFile(outPath);
          
        console.log(`  Saved as ${bestMatch}.jpg`);
      } else {
         console.log(`  Skipped due to low confidence.`);
      }
    } catch (e) {
      console.error(`  Error processing ${file}: ${e.message}`);
    }
  }
  
  console.log('Done!');
}

main();
