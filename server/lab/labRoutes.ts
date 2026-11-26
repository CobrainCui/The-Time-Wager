import express from "express";
import { requireAdminToken } from "../config/adminAuth.js";
import { allow } from "../util/rateLimit.js";
import {
  buildLabComparisonAnalysis,
  buildLabComparisonWorkbook,
  buildLabDatasetCsv,
  buildLabRunWorkbook,
  buildLabSessionWorkbook,
  contentDispositionAttachment,
  safeExportBasename,
} from "./labExport.js";
import {
  getLabConfigSummary,
  getLabLiveStatus,
  runLabPreflight,
  startLabRun,
  stopActiveLabRun,
} from "./labRunner.js";
import {
  deleteLabRun,
  getLabRunById,
  getLabSessionById,
  listAllLabRunsRaw,
  listLabRuns,
  listLabSessionsByRunIds,
} from "./labStore.js";

function exportLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!allow(`lab-export:${req.ip ?? "unknown"}`, 20, 60_000)) {
    res.status(429).json({ error: "导出请求过于频繁" });
    return;
  }
  next();
}

export function registerLabAdminRoutes(app: express.Express): void {
  app.get("/api/admin/lab/config", requireAdminToken, (_req, res) => {
    res.json(getLabConfigSummary());
  });

  app.post("/api/admin/lab/preflight", express.json(), requireAdminToken, async (req, res) => {
    const models = Array.isArray(req.body?.models)
      ? req.body.models.map((m: unknown) => String(m ?? "").trim()).filter(Boolean)
      : [];
    const result = await runLabPreflight(models);
    res.json(result);
  });

  app.get("/api/admin/lab/status", requireAdminToken, (_req, res) => {
    res.json(getLabLiveStatus());
  });

  app.post("/api/admin/lab/runs/start", express.json(), requireAdminToken, (req, res) => {
    const body = req.body ?? {};
    const result = startLabRun({
      condition: String(body.condition ?? "custom"),
      name: typeof body.name === "string" ? body.name : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      games: Number(body.games ?? 1),
      seedBase: body.seedBase != null ? Number(body.seedBase) : undefined,
      chatEnabled: body.chatEnabled !== false,
      memoryEnabled: body.memoryEnabled !== false,
      predictionEnabled: body.predictionEnabled !== false,
      autoSocialScore: body.autoSocialScore !== false,
      mock: body.mock === true,
      tokenBudgetPerAgent: Number(body.tokenBudgetPerAgent),
      models: Array.isArray(body.models) ? body.models.map(String) : [],
      interactionMode:
        body.interactionMode === "free_two_step" ||
        body.interactionMode === "free_one_step" ||
        body.interactionMode === "guided_two_step"
          ? body.interactionMode
          : undefined,
      thinkingMode:
        body.thinkingMode === "fast" ||
        body.thinkingMode === "moderate" ||
        body.thinkingMode === "deep"
          ? body.thinkingMode
          : undefined,
      publicChatEnabled: typeof body.publicChatEnabled === "boolean" ? body.publicChatEnabled : undefined,
      privateChatEnabled: typeof body.privateChatEnabled === "boolean" ? body.privateChatEnabled : undefined,
      customGroupsEnabled: typeof body.customGroupsEnabled === "boolean" ? body.customGroupsEnabled : undefined,
      transferEnabled: typeof body.transferEnabled === "boolean" ? body.transferEnabled : undefined,
      auctionEnabled: typeof body.auctionEnabled === "boolean" ? body.auctionEnabled : undefined,
      buffCardsEnabled: typeof body.buffCardsEnabled === "boolean" ? body.buffCardsEnabled : undefined,
      coffeeEnabled: typeof body.coffeeEnabled === "boolean" ? body.coffeeEnabled : undefined,
      customSystemPrompt: typeof body.customSystemPrompt === "string" ? body.customSystemPrompt : undefined,
    });
    if (!result.ok) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.status(201).json(result);
  });

  app.post("/api/admin/lab/runs/stop", requireAdminToken, (_req, res) => {
    const stopped = stopActiveLabRun("管理员在实验控制台停止了运行");
    if (!stopped.ok) {
      res.status(404).json({ error: "当前没有正在运行的实验" });
      return;
    }
    res.json(stopped);
  });

  app.get("/api/admin/lab/runs", requireAdminToken, (req, res) => {
    const includeMock = String(req.query.includeMock ?? "1") !== "0";
    const status = String(req.query.status ?? "all");
    res.json(listLabRuns({ includeMock, status }));
  });

  app.get("/api/admin/lab/runs/:runId", requireAdminToken, (req, res) => {
    const runId = String(req.params.runId ?? "").trim();
    const run = getLabRunById(runId);
    if (!run) {
      res.status(404).json({ error: "实验批次不存在" });
      return;
    }
    const sessions = listLabSessionsByRunIds([runId]).map(({ snapshot: _snap, ...rest }) => rest);
    res.json({ run, sessions });
  });

  app.delete("/api/admin/lab/runs/:runId", requireAdminToken, (req, res) => {
    const runId = String(req.params.runId ?? "").trim();
    if (!deleteLabRun(runId)) {
      res.status(400).json({ error: "批次不存在或正在运行中，无法删除" });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/lab/sessions/:sessionId", requireAdminToken, (req, res) => {
    const sessionId = String(req.params.sessionId ?? "").trim();
    const session = getLabSessionById(sessionId);
    if (!session) {
      res.status(404).json({ error: "实验场次不存在" });
      return;
    }
    res.json(session);
  });

  app.get(
    "/api/admin/lab/sessions/:sessionId/export",
    exportLimit,
    requireAdminToken,
    async (req, res) => {
      const sessionId = String(req.params.sessionId ?? "").trim();
      const format = String(req.query.format ?? "xlsx").toLowerCase();
      const session = getLabSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: "实验场次不存在" });
        return;
      }
      const base = safeExportBasename(`${session.condition}_${session.roomId}`);
      const suffix = sessionId.slice(0, 8);
      if (format === "xlsx") {
        const buf = await buildLabSessionWorkbook(session.snapshot);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`${base}_${suffix}_lab_session.xlsx`)
        );
        res.send(buf);
        return;
      }
      if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`${base}_${suffix}_lab_session.json`)
        );
        res.send(JSON.stringify(session.snapshot, null, 2));
        return;
      }
      res.status(400).json({ error: "无效导出格式（支持 xlsx 或 json）" });
    }
  );

  app.get(
    "/api/admin/lab/runs/:runId/export",
    exportLimit,
    requireAdminToken,
    async (req, res) => {
      const runId = String(req.params.runId ?? "").trim();
      const format = String(req.query.format ?? "xlsx").toLowerCase();
      const run = getLabRunById(runId);
      if (!run) {
        res.status(404).json({ error: "实验批次不存在" });
        return;
      }
      const sessions = listLabSessionsByRunIds([runId]);
      const base = safeExportBasename(runId);

      if (format === "xlsx") {
        const buf = await buildLabRunWorkbook(run, sessions);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`${base}_batch_report.xlsx`)
        );
        res.send(buf);
        return;
      }
      if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`${base}_batch_bundle.json`)
        );
        res.send(
          JSON.stringify(
            {
              manifest: run.manifest,
              run,
              qc: sessions.map((s) => s.qc),
              sessions,
            },
            null,
            2
          )
        );
        return;
      }
      res.status(400).json({ error: "无效导出格式（支持 xlsx 或 json）" });
    }
  );

  app.get(
    "/api/admin/lab/export-analysis",
    exportLimit,
    requireAdminToken,
    async (req, res) => {
      const rawIds = String(req.query.runIds ?? "").trim();
      const runIds = rawIds ? rawIds.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const includeMock = String(req.query.includeMock ?? "0") === "1";
      const format = String(req.query.format ?? "xlsx").toLowerCase();

      const allRuns = listAllLabRunsRaw();
      const selectedRuns =
        runIds.length > 0 ? allRuns.filter((r) => runIds.includes(r.runId)) : allRuns;
      const sessions = listLabSessionsByRunIds(selectedRuns.map((r) => r.runId));
      const analysis = buildLabComparisonAnalysis(selectedRuns, sessions, { includeMock });
      const stamp = new Date().toISOString().slice(0, 10);

      if (format === "xlsx") {
        const buf = await buildLabComparisonWorkbook(analysis);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`6ai_lab_comparison_${stamp}.xlsx`)
        );
        res.send(buf);
        return;
      }
      if (format === "csv") {
        const csv = buildLabDatasetCsv(analysis);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`6ai_lab_dataset_${stamp}.csv`)
        );
        res.send(csv);
        return;
      }
      if (format === "json") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          contentDispositionAttachment(`6ai_lab_analysis_${stamp}.json`)
        );
        res.send(JSON.stringify(analysis, null, 2));
        return;
      }
      res.status(400).json({ error: "无效导出格式（支持 xlsx / csv / json）" });
    }
  );
}
