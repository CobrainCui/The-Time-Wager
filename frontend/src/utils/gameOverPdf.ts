import { Chart } from "chart.js";
import { GameState, Player } from "../types";

export function buildPdfUnfinishedProjects(
  game: GameState,
  me: Player
): { name: string; progress: number }[] {
  const projectsById = new Map(
    [...game.activeProjects, ...game.uncompletedProjects, ...game.completedProjects].map((p) => [
      p.id,
      p,
    ])
  );

  return Object.values(me.longTerm || {})
    .filter((lt) => lt.status === "active" && lt.totalInvested > 0)
    .map((lt) => {
      const proj = projectsById.get(lt.projectId);
      if (!proj || proj.type !== "long") return null;

      let communityProgress = 0;
      game.players.forEach((p) => {
        communityProgress += p.longTerm[proj.id]?.totalInvested || 0;
      });
      const progress =
        proj.maxEnergy > 0
          ? Math.min(100, (communityProgress / proj.maxEnergy) * 100)
          : 0;

      return { name: proj.name, progress };
    })
    .filter((row): row is { name: string; progress: number } => row !== null);
}

/** 等待 Chart.js 完成布局与绘制，避免 html2canvas 截到空白图 */
export async function waitForChartPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise((resolve) => setTimeout(resolve, 32));
}

/** 导出前强制 Chart.js 按离屏容器尺寸重绘 */
export function prepareChartsForPdfCapture(elementIds: string[]): void {
  for (const id of elementIds) {
    const canvas = document.getElementById(id)?.querySelector("canvas");
    if (!canvas) continue;
    const chart = Chart.getChart(canvas);
    chart?.resize();
    chart?.update("none");
  }
}

export function assertPdfChartElementsReady(
  radarChartElementId: string,
  lineChartElementId: string
): string | null {
  const missing: string[] = [];
  if (!document.getElementById(radarChartElementId)) missing.push("雷达图");
  if (!document.getElementById(lineChartElementId)) missing.push("财富曲线");
  if (missing.length === 0) return null;
  return `图表尚未就绪（${missing.join("、")}），请稍候再试`;
}

export const PDF_RADAR_CHART_ID = "pdf-radar-chart";
export const PDF_LINE_CHART_ID = "pdf-line-chart";
