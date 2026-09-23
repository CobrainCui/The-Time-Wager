import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  assertPdfChartElementsReady,
  prepareChartsForPdfCapture,
  waitForChartPaint,
} from './gameOverPdf';
import { buildCollectionManualFileName } from './pdfFileName';
import { PDF_PAGE2_CHARTS } from './pdfLayout';

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

type PdfBox = { x: number; y: number; w: number; h: number };

async function addChartFromDom(
  doc: jsPDF,
  elementId: string,
  box: PdfBox,
  label: string
): Promise<boolean> {
  const chartDom = document.getElementById(elementId);
  if (!chartDom) {
    console.warn(`PDF: 未找到图表容器（${label}）`, elementId);
    return false;
  }
  try {
    await waitForChartPaint();
    const canvas = await html2canvas(chartDom, {
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false,
      useCORS: true,
      width: chartDom.offsetWidth,
      height: chartDom.offsetHeight,
    });
    if (canvas.width === 0 || canvas.height === 0) {
      console.warn(`PDF: 图表截图为空（${label}）`);
      return false;
    }
    const imgData = canvas.toDataURL("image/png");
    doc.addImage(imgData, "PNG", box.x, box.y, box.w, box.h);
    return true;
  } catch (e) {
    console.warn(`PDF: 图表截图失败（${label}）`, e);
    return false;
  }
}

function publicAssetUrl(path: string): string {
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base}${normalized}`;
}

interface GeneratePdfParams {
  playerName: string;
  persona: string;
  remainingEnergy: number;
  unfinishedProjects: { name: string; progress: number }[];
  radarChartElementId: string;
  lineChartElementId: string;
}

export type GeneratePdfResult =
  | { ok: true; fileName: string; warnings?: string[] }
  | { ok: false; message: string };

async function loadFontAsBase64(url: string): Promise<string> {
  const response = await fetch(publicAssetUrl(url));
  if (!response.ok) {
    throw new Error(`字体加载失败 (${response.status})`);
  }
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
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
  remainingEnergy,
  unfinishedProjects,
  radarChartElementId,
  lineChartElementId,
}: GeneratePdfParams): Promise<GeneratePdfResult> {
  const safeName = playerName.trim() || "玩家";
  const fileName = buildCollectionManualFileName(safeName);

  const notReady = assertPdfChartElementsReady(radarChartElementId, lineChartElementId);
  if (notReady) {
    return { ok: false, message: notReady };
  }

  prepareChartsForPdfCapture([radarChartElementId, lineChartElementId]);
  await waitForChartPaint();

  const doc = new jsPDF('p', 'mm', 'a4');

  try {
    const fontBase64 = await loadFontAsBase64('/fonts/XuandongKaishu.ttf');
    doc.addFileToVFS("XuanDong.ttf", fontBase64);
    doc.addFont("XuanDong.ttf", "XuanDong", "normal");
    doc.setFont("XuanDong");
  } catch (e) {
    console.error("字体加载失败，中文可能无法正常显示", e);
    doc.setFont("helvetica");
  }

  const pathKey = PERSONA_PATHS[persona] || "Poet";
  const basePath = publicAssetUrl(`/assets/pdf_templates/${pathKey}`);

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.error("加载图片失败:", src);
        reject(new Error(`无法加载 PDF 模板：${src}`));
      };
    });
  };

  try {
    doc.setTextColor(0, 0, 0);

    const img1 = await loadImage(`${basePath}/1.jpg`);
    doc.addImage(img1, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);
    doc.setFontSize(24);
    doc.text(safeName, 44, 124);

    doc.addPage();
    const img2 = await loadImage(`${basePath}/2.jpg`);
    doc.addImage(img2, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    const radarOk = await addChartFromDom(
      doc,
      radarChartElementId,
      PDF_PAGE2_CHARTS.radar,
      "雷达图"
    );
    const lineOk = await addChartFromDom(
      doc,
      lineChartElementId,
      PDF_PAGE2_CHARTS.wealthLine,
      "财富曲线"
    );
    const warnings: string[] = [];
    if (!radarOk) warnings.push("决策雷达图未能嵌入");
    if (!lineOk) warnings.push("财富曲线未能嵌入");
    if (!radarOk && !lineOk) {
      return { ok: false, message: "图表截图失败，请刷新页面后重试" };
    }

    doc.addPage();
    const img3 = await loadImage(`${basePath}/3.jpg`);
    doc.addImage(img3, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.addPage();
    const img4 = await loadImage(`${basePath}/4.jpg`);
    doc.addImage(img4, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.addPage();
    const img5 = await loadImage(`${basePath}/5.jpg`);
    doc.addImage(img5, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.setFontSize(24);
    doc.text(`${Math.max(0, Math.round(remainingEnergy))}`, 70, 54);

    let rowY = 105;
    doc.setFontSize(20);

    const nameColumnWidthMm = 88;
    if (!unfinishedProjects.length) {
      doc.text("无", 60, rowY);
    } else {
      unfinishedProjects.forEach((proj) => {
        if (rowY > 200) return;
        const lines = doc.splitTextToSize(proj.name, nameColumnWidthMm);
        doc.text(lines, 60, rowY);
        doc.text(`${proj.progress.toFixed(0)}`, 160, rowY);
        rowY += 10 * Math.max(1, lines.length);
      });
    }

    doc.addPage();
    const img6 = await loadImage(`${basePath}/6.jpg`);
    doc.addImage(img6, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    doc.save(fileName);
    return warnings.length > 0
      ? { ok: true, fileName, warnings }
      : { ok: true, fileName };
  } catch (e) {
    console.error("PDF Generate Error:", e);
    const message =
      e instanceof Error ? e.message : "生成 PDF 失败，请稍后重试";
    return { ok: false, message };
  }
}
