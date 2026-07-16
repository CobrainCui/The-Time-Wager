const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');
const sharp = require('sharp');

const DIST_IMG_DIR = path.join(__dirname, '../frontend/dist/images/projects');
const PUBLIC_IMG_DIR = path.join(__dirname, '../frontend/public/images/projects');

const allProjects = [
  "点石成金","项目做空","摸鱼传染","反弹琵琶","保险","精神老伙","偷天换日","彩票","新能源汽车",
  "兴建巨型水坝","视频会议","数字地图","国际文化艺术节","民俗主题公园","公共体育设施免费开放",
  "“全民健身日”嘉年华","数字排毒","EAP全面推行","植树造林","城市海绵体改造","数字图书馆",
  "遗产保护基金","文化桥梁使者","建立体育俱乐部","心理学教育普及","开采化石能源","成瘾算法",
  "数据监控","文化商品化","营养代餐","完美身材","幸福药丸","大师速成班"
];

async function main() {
  const files = fs.readdirSync(DIST_IMG_DIR)
                  .filter(f => f.endsWith('.png'));
                  
  console.log(`Found ${files.length} manually renamed .png files.`);
  
  if (!fs.existsSync(PUBLIC_IMG_DIR)) {
    fs.mkdirSync(PUBLIC_IMG_DIR, { recursive: true });
  }

  for (const file of files) {
    const filePath = path.join(DIST_IMG_DIR, file);
    const baseName = path.basename(file, '.png');
    
    // Find best match in our database
    const matches = stringSimilarity.findBestMatch(baseName, allProjects);
    const bestMatch = matches.bestMatch.target;
    
    console.log(`Processing ${file} -> Mapped to: ${bestMatch}`);
    
    // Compress, resize, and convert to .jpg, saving to public folder
    const outPath = path.join(PUBLIC_IMG_DIR, `${bestMatch}.jpg`);
    await sharp(filePath)
      .resize(800, 450, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(outPath);
      
    // Also save directly to dist folder so we don't even have to rebuild!
    const outDistPath = path.join(DIST_IMG_DIR, `${bestMatch}.jpg`);
    await sharp(filePath)
      .resize(800, 450, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(outDistPath);
      
    // Remove the original .png file from dist so it doesn't take up space in the zip
    fs.unlinkSync(filePath);
  }
  
  console.log('Finished processing all images.');
}

main().catch(console.error);
