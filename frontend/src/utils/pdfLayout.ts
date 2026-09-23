/** A4 第 2 页图表占位（mm），与 pdf_templates 各人格 2.jpg 版式一致 */
export const PDF_PAGE2_CHARTS = {
  /** 标题在左侧，图落在右侧留白区 */
  radar: { x: 48, y: 90, w: 136, h: 58 },
  wealthLine: { x: 28, y: 162, w: 154, h: 70 },
} as const;

/** 截图像素与 PDF mm 同比例，避免 addImage 拉伸 */
export const PDF_CHART_CAPTURE_PX_PER_MM = 10;

export function pdfChartCaptureSize(box: { w: number; h: number }) {
  const scale = PDF_CHART_CAPTURE_PX_PER_MM;
  return {
    width: Math.round(box.w * scale),
    height: Math.round(box.h * scale),
  };
}

export const PDF_RADAR_CAPTURE = pdfChartCaptureSize(PDF_PAGE2_CHARTS.radar);
export const PDF_LINE_CAPTURE = pdfChartCaptureSize(PDF_PAGE2_CHARTS.wealthLine);
