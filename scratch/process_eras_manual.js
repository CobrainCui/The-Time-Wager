const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SOURCE_DIR = 'D:/workspace/光阴对赌/桌游人生/图片/时代';
const TARGET_PUBLIC = path.join(__dirname, '../frontend/public/images/eras');
const TARGET_DIST = path.join(__dirname, '../frontend/dist/images/eras');

const mapping = {
  's.jpg': '气候',
  '微信图片_2025-12-17_183801_665.jpg': '科技',
  '微信图片_2025-12-17_183803_766.jpg': '文化',
  '微信图片_2025-12-17_183808_410.jpg': '健康',
  '微信图片_2025-12-17_183810_954.jpg': '心理'
};

async function main() {
  if (!fs.existsSync(TARGET_PUBLIC)) fs.mkdirSync(TARGET_PUBLIC, { recursive: true });
  if (!fs.existsSync(TARGET_DIST)) fs.mkdirSync(TARGET_DIST, { recursive: true });

  for (const [filename, eraName] of Object.entries(mapping)) {
    const filePath = path.join(SOURCE_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${filename}, not found.`);
      continue;
    }
    
    console.log(`Processing ${filename} -> ${eraName}.jpg`);
    const outName = `${eraName}.jpg`;
    
    await sharp(filePath)
      .resize(600, 900, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(path.join(TARGET_PUBLIC, outName));
      
    await sharp(filePath)
      .resize(600, 900, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toFile(path.join(TARGET_DIST, outName));
  }
  
  console.log('Finished processing era images.');
}

main().catch(console.error);
