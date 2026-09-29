import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Chart } from 'chart.js';
import {
  assertPdfChartElementsReady,
  PdfProjectParticipationChart,
  prepareChartsForPdfCapture,
  waitForChartPaint,
  waitForPdfChartCanvases,
} from './gameOverPdf';
import { buildCollectionManualFileName } from './pdfFileName';
import {
  PDF_COVER_PLAYER_NAME,
  PDF_PAGE2_CHARTS,
  PDF_PAGE5_BAR_TITLE,
  PDF_PAGE5_PROJECT_BAR,
  PDF_PAGE5_PROJECT_NAMES,
  PDF_PAGE5_UNFINISHED_TABLE,
  pdfProjectBarColumnLayout,
  PDF_RADAR_CAPTURE_CROP_X,
} from './pdfLayout';

import { FATE_SKETCH_IMAGE_SLUG } from "../config/personaConfig";
import { publicAssetUrl } from "./publicAssetUrl";

const PDF_WIDTH = 210;
const PDF_HEIGHT = 297;

type PdfBox = { x: number; y: number; w: number; h: number };

function cropCanvasHorizontal(
  source: HTMLCanvasElement,
  cropRatioEachSide: number
): HTMLCanvasElement {
  const ratio = Math.min(0.45, Math.max(0, cropRatioEachSide));
  const sx = Math.round(source.width * ratio);
  const sw = Math.max(1, source.width - 2 * sx);
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = source.height;
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(source, sx, 0, sw, source.height, 0, 0, sw, source.height);
  return out;
}

function fitImageInBoxMm(
  box: PdfBox,
  pixelWidth: number,
  pixelHeight: number
): { x: number; y: number; w: number; h: number } {
  const aspect = pixelWidth / pixelHeight;
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y,
    w,
    h,
  };
}

function captureChartCanvas(
  elementId: string,
  options?: { cropHorizontal?: number; pixelScale?: number }
): HTMLCanvasElement | null {
  const canvas = document.getElementById(elementId)?.querySelector("canvas");
  if (!canvas) return null;
  const chart = Chart.getChart(canvas);
  if (!chart) return null;
  chart.update("none");

  const pixelScale = options?.pixelScale ?? 2;
  let output: HTMLCanvasElement = canvas;
  if (pixelScale !== 1) {
    const scaled = document.createElement("canvas");
    scaled.width = Math.max(1, Math.round(canvas.width * pixelScale));
    scaled.height = Math.max(1, Math.round(canvas.height * pixelScale));
    const ctx = scaled.getContext("2d");
    if (!ctx) return canvas;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    output = scaled;
  }

  if (options?.cropHorizontal != null && options.cropHorizontal > 0) {
    output = cropCanvasHorizontal(output, options.cropHorizontal);
  }
  return output;
}

async function addChartFromDom(
  doc: jsPDF,
  elementId: string,
  box: PdfBox,
  label: string,
  options?: {
    cropHorizontal?: number;
    preserveAspectRatio?: boolean;
    /** 优先用 Chart.js canvas 导出，避免 html2canvas 把柱色/渐变渲黑 */
    preferChartCanvas?: boolean;
  }
): Promise<boolean> {
  const chartDom = document.getElementById(elementId);
  if (!chartDom) {
    console.warn(`PDF: 未找到图表容器（${label}）`, elementId);
    return false;
  }

  const preferCanvas = options?.preferChartCanvas !== false;

  try {
    let output: HTMLCanvasElement | null = null;
    if (preferCanvas) {
      output = captureChartCanvas(elementId, {
        cropHorizontal: options?.cropHorizontal,
        pixelScale: 2,
      });
    }
    if (!output) {
      output = await html2canvas(chartDom, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: true,
        width: chartDom.offsetWidth,
        height: chartDom.offsetHeight,
      });
    }
    if (output.width === 0 || output.height === 0) {
      console.warn(`PDF: 图表截图为空（${label}）`);
      return false;
    }
    const imgData = output.toDataURL("image/png");
    const placement = options?.preserveAspectRatio
      ? fitImageInBoxMm(box, output.width, output.height)
      : box;
    doc.addImage(imgData, "PNG", placement.x, placement.y, placement.w, placement.h);
    return true;
  } catch (e) {
    console.warn(`PDF: 图表截图失败（${label}）`, e);
    return false;
  }
}

interface GeneratePdfParams {
  playerName: string;
  persona: string;
  remainingEnergy: number;
  unfinishedProjects: { name: string; progress: number }[];
  projectParticipationChart: PdfProjectParticipationChart;
  radarChartElementId: string;
  lineChartElementId: string;
  projectBarChartElementId: string;
  onProgress?: (message: string) => void;
}

export type GeneratePdfResult =
  | { ok: true; fileName: string; warnings?: string[] }
  | { ok: false; message: string };

function drawProjectParticipationNames(
  doc: jsPDF,
  chart: PdfProjectParticipationChart
): void {
  const { topY, fontSize, lineHeight, blankLinesBefore, maxY } = PDF_PAGE5_PROJECT_NAMES;
  const { centers, maxWidth } = pdfProjectBarColumnLayout();
  doc.setFontSize(fontSize);
  const columns = [chart.unfinished, chart.completed, chart.exploded];
  columns.forEach((names, colIndex) => {
    const centerX = centers[colIndex] ?? centers[0];
    let y = topY + lineHeight * blankLinesBefore;
    if (!names.length) {
      doc.setTextColor(80, 80, 80);
      doc.text("无", centerX, y, { align: "center" });
      doc.setTextColor(0, 0, 0);
      return;
    }
    for (const name of names) {
      if (y > maxY) break;
      const lines = doc.splitTextToSize(name, maxWidth);
      for (let i = 0; i < lines.length; i++) {
        const lineY = y + i * lineHeight;
        if (lineY > maxY) break;
        doc.text(lines[i], centerX, lineY, { align: "center" });
      }
      y += lineHeight * Math.max(1, lines.length);
    }
  });
}

const ASSET_LOAD_TIMEOUT_MS = 15_000;

function withRetryQuery(url: string): string {
  return url.includes("?") ? `${url}&retry=1` : `${url}?retry=1`;
}

async function loadFontAsBase64(url: string): Promise<string> {
  const tryOnce = async (href: string) => {
    const response = await fetch(publicAssetUrl(href), { signal: AbortSignal.timeout(ASSET_LOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`字体加载失败 (${response.status})`);
    }
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };
  try {
    return await tryOnce(url);
  } catch {
    return await tryOnce(withRetryQuery(url));
  }
}

function loadImageOnce(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      img.src = "";
      reject(new Error(`图片加载超时：${src}`));
    }, ASSET_LOAD_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`无法加载 PDF 模板：${src}`));
    };
    img.src = src;
  });
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  try {
    return await loadImageOnce(src);
  } catch {
    return await loadImageOnce(withRetryQuery(src));
  }
}

export async function generateCollectionManual({
  playerName,
  persona,
  remainingEnergy,
  unfinishedProjects,
  projectParticipationChart,
  radarChartElementId,
  lineChartElementId,
  projectBarChartElementId,
  onProgress,
}: GeneratePdfParams): Promise<GeneratePdfResult> {
  const safeName = playerName.trim() || "玩家";
  const fileName = buildCollectionManualFileName(safeName);

  const chartElementIds = [
    radarChartElementId,
    lineChartElementId,
    projectBarChartElementId,
  ];
  const notReady = assertPdfChartElementsReady(...chartElementIds);
  if (notReady) {
    return { ok: false, message: notReady };
  }

  const chartsRendered = await waitForPdfChartCanvases(chartElementIds, {
    onProgress,
  });
  if (!chartsRendered) {
    return { ok: false, message: "图表渲染超时，请稍候再试" };
  }

  prepareChartsForPdfCapture(chartElementIds);
  await waitForChartPaint();

  const doc = new jsPDF('p', 'mm', 'a4');

  try {
    onProgress?.("正在加载字体…");
    const fontBase64 = await loadFontAsBase64('/fonts/XuandongKaishu.ttf');
    doc.addFileToVFS("XuanDong.ttf", fontBase64);
    doc.addFont("XuanDong.ttf", "XuanDong", "normal");
    doc.setFont("XuanDong");
  } catch (e) {
    console.error("字体加载失败，中文可能无法正常显示", e);
    doc.setFont("helvetica");
  }

  const pathKey = FATE_SKETCH_IMAGE_SLUG[persona] || "Poet";
  const basePath = publicAssetUrl(`/assets/pdf_templates/${pathKey}`);
  /** 封面固定为通用模板，不随人格立绘变化 */
  const coverPath = publicAssetUrl("/assets/pdf_templates/Cover/1.jpg");

  onProgress?.("正在加载 PDF 模板…");

  const loadCoverImage = (): Promise<HTMLImageElement> => loadImage(coverPath);

  try {
    doc.setTextColor(0, 0, 0);

    const img1 = await loadCoverImage();
    doc.addImage(img1, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);
    doc.setFontSize(PDF_COVER_PLAYER_NAME.fontSize);
    doc.text(safeName, PDF_COVER_PLAYER_NAME.x, PDF_COVER_PLAYER_NAME.y);

    doc.addPage();
    const img2 = await loadImage(`${basePath}/2.jpg`);
    doc.addImage(img2, 'JPEG', 0, 0, PDF_WIDTH, PDF_HEIGHT);

    const radarOk = await addChartFromDom(
      doc,
      radarChartElementId,
      PDF_PAGE2_CHARTS.radar,
      "雷达图",
      {
        cropHorizontal: PDF_RADAR_CAPTURE_CROP_X,
        preserveAspectRatio: true,
      }
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

    let rowY = PDF_PAGE5_UNFINISHED_TABLE.startY;
    doc.setFontSize(20);

    const {
      nameX,
      progressX,
      lineHeight,
      nameColumnWidthMm,
      maxY: unfinishedMaxY,
    } = PDF_PAGE5_UNFINISHED_TABLE;
    if (!unfinishedProjects.length) {
      doc.text("无", nameX, rowY);
    } else {
      unfinishedProjects.forEach((proj) => {
        if (rowY > unfinishedMaxY) return;
        const lines = doc.splitTextToSize(proj.name, nameColumnWidthMm);
        const blockBottom = rowY + lineHeight * (Math.max(1, lines.length) - 1);
        if (blockBottom > unfinishedMaxY) return;
        doc.text(lines, nameX, rowY);
        doc.text(`${proj.progress.toFixed(0)}`, progressX, rowY);
        rowY += lineHeight * Math.max(1, lines.length);
      });
    }

    doc.setFontSize(PDF_PAGE5_BAR_TITLE.fontSize);
    doc.setTextColor(0, 0, 0);
    doc.text(PDF_PAGE5_BAR_TITLE.text, PDF_PAGE5_BAR_TITLE.x, PDF_PAGE5_BAR_TITLE.y);

    const barOk = await addChartFromDom(
      doc,
      projectBarChartElementId,
      PDF_PAGE5_PROJECT_BAR,
      "项目柱形图"
    );
    if (!barOk) {
      warnings.push("项目柱形图未能嵌入");
    }
    drawProjectParticipationNames(doc, projectParticipationChart);

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
