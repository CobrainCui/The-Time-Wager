import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// 1. 文件夹映射
const PERSONA_PATHS: Record<string, string> = {
  "桥梁架构师": "Bridge",
  "瞬刻炼金士": "Moment",
  "罗盘精算师": "Navigator",
  "时荫植者": "Planter",
  "随机诗人": "Poet",
  "涌机触发者": "Wave"
};

const PDF_WIDTH = 210;
const PDF_HEIGHT = 297;

interface GeneratePdfParams {
  playerName: string;
  persona: string;
  totalEnergy: number;
  remainingEnergy: number;
  unfinishedProjects: {name: string, progress: number}[];
  chartElementId: string;
}

// 辅助函数：将 URL 文件转换为 Base64
async function loadFontAsBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // reader.result 是 "data:font/ttf;base64,AAEAAA..."
            // 我们只需要逗号后面的部分
            const base64 = (reader.result as string).split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function generateCollectionManual({
  playerName,
  persona,
  totalEnergy,
  remainingEnergy,
  unfinishedProjects,
  chartElementId
}: GeneratePdfParams) {
  
  const doc = new jsPDF('p', 'mm', 'a4');
  
  // === 1. 动态加载字体===
  try {
      const fontBase64 = await loadFontAsBase64('/fonts/XuandongKaishu.ttf');
      
      doc.addFileToVFS("XuanDong.ttf", fontBase64);
      doc.addFont("XuanDong.ttf", "XuanDong", "normal");
      doc.setFont("XuanDong");
      
      console.log("字体动态加载成功！");
  } catch (e) {
      console.error("字体加载失败，中文将无法显示！请检查 public/fonts/ 目录下是否有 XuandongKaishu.ttf 文件。", e);
      // 回退到默认字体（虽然中文会乱码，但防止程序崩溃）
      doc.setFont("helvetica");
  }

  const pathKey = PERSONA_PATHS[persona] || "Poet";
  const basePath = `/assets/pdf_templates/${pathKey}`;

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = src;
      img.onload = () => resolve(img);
      img.onerror = (e) => {
          console.error("加载图片失败:", src);
          reject(e);
      };
    });
  };

  try {
    // 设置黑色文字
    doc.setTextColor(0, 0, 0);

    // ================= Page 1: 封面 =================
    const img1 = await loadImage(`${basePath}/1.jpg`);
    doc.addImage(img1, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);
    
    doc.setFontSize(24);
    doc.text(playerName, 44, 124); 

    // ================= Page 2: 轨迹目录 & 图表 =================
    doc.addPage();
    const img2 = await loadImage(`${basePath}/2.jpg`);
    doc.addImage(img2, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    // 贴图：雷达图 & 曲线图
    const chartDom = document.getElementById(chartElementId);
    if (chartDom) {
        const canvas = await html2canvas(chartDom, { 
            backgroundColor: null, 
            scale: 2 
        });
        const imgData = canvas.toDataURL('image/png');
        // 坐标：X=35, Y=114, 宽=140, 高=140
        doc.addImage(imgData, 'PNG', 35, 114, 140, 140); 
    }

    // ================= Page 3: 肖像 =================
    doc.addPage();
    const img3 = await loadImage(`${basePath}/3.jpg`);
    doc.addImage(img3, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    // ================= Page 4: 核心特征 =================
    doc.addPage();
    const img4 = await loadImage(`${basePath}/4.jpg`);
    doc.addImage(img4, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    // ================= Page 5: 遗憾分析 =================
    doc.addPage();
    const img5 = await loadImage(`${basePath}/5.jpg`);
    doc.addImage(img5, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.setFontSize(24);
    doc.text(`${remainingEnergy}`, 70, 54); 

    // 表格：未完成项目
    let rowY = 105;
    doc.setFontSize(20);
    
    if (!unfinishedProjects || unfinishedProjects.length === 0) {
        doc.text("无", 80, 76);
    } else {
        unfinishedProjects.forEach(proj => {
            if (rowY > 200) return; 
            doc.text(proj.name, 60, rowY);
            doc.text(`${proj.progress.toFixed(0)}`, 160, rowY); 
            rowY += 10; 
        });
    }

    // ================= Page 6: 寄语 =================
    doc.addPage();
    const img6 = await loadImage(`${basePath}/6.jpg`);
    doc.addImage(img6, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.save(`人生决策藏品手册_${playerName}.pdf`);

  } catch (e) {
    console.error("PDF Generate Error:", e);
    alert("生成 PDF 失败！请按 F12 查看 Console 错误信息。");
  }
}