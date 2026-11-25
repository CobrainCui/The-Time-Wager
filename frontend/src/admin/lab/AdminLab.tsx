import React, { useCallback, useEffect, useMemo, useState } from "react";
import { uiRem } from "../../utils/typography";
import {
  deleteLabRunApi,
  downloadLabFile,
  fetchLabConfig,
  fetchLabRuns,
  fetchLabStatus,
  runLabPreflightApi,
  startLabRunApi,
  stopLabRunApi,
} from "./labApi";
import { LabSessionDrawer } from "./LabSessionDrawer";
import type {
  LabConfigSummary,
  LabLiveStatus,
  LabPreflightResult,
  LabRunsResponse,
  LabRunWithSessions,
  LabSessionListItem,
} from "./LabTypes";

interface Props {
  onBack: () => void;
  onSpectateLabRoom: (roomId: string) => void;
}

const PHASE_NAMES: Record<string, string> = {
  ROOM_WAITING: "等候开局",
  ERA_INTRO: "时代介绍",
  INVESTMENT: "投资与道具",
  BUFF_USAGE: "投资与道具",
  SETTLEMENT: "本轮结算",
  AUCTION: "拍卖会",
  COMMUNITY_NAMING: "社区命名",
  GAME_OVER: "游戏结束",
};

function formatDateTime(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDurationMs(ms: number): string {
  if (!ms || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min} 分 ${remSec} 秒` : `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} 小时 ${m} 分`;
}

function formatQuotaWan(num: number | undefined, zeroLabel = "不限额度"): string {
  const n = Number(num ?? 0);
  if (n === 0) return zeroLabel;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return n.toLocaleString();
}

function runStatusBadge(run: LabRunWithSessions): { label: string; bg: string; color: string } {
  if (run.status === "running") {
    return { label: "运行中", bg: "rgba(56,189,248,0.18)", color: "#7dd3fc" };
  }
  if (run.status === "completed") {
    return { label: "已完成", bg: "rgba(16,185,129,0.18)", color: "#6ee7b7" };
  }
  if (run.status === "stopped") {
    return { label: "已手动停止", bg: "rgba(245,158,11,0.18)", color: "#fcd34d" };
  }
  return { label: "失败/作废", bg: "rgba(239,68,68,0.18)", color: "#fca5a5" };
}

export const AdminLab: React.FC<Props> = ({ onBack, onSpectateLabRoom }) => {
  const [config, setConfig] = useState<LabConfigSummary | null>(null);
  const [liveStatus, setLiveStatus] = useState<LabLiveStatus | null>(null);
  const [runsData, setRunsData] = useState<LabRunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新实验表单
  const [condition, setCondition] = useState("C1");
  const [runName, setRunName] = useState("");
  const [notes, setNotes] = useState("");
  const [games, setGames] = useState(1);
  const [seedBase, setSeedBase] = useState(20261104);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [predictionEnabled, setPredictionEnabled] = useState(true);
  const [autoSocialScore, setAutoSocialScore] = useState(true);
  const [mockMode, setMockMode] = useState(false);
  /** 按「万」单位显示与调整单局上限，默认 500 万，0 表示不限额度 */
  const [budgetWan, setBudgetWan] = useState(500);
  const [budgetInited, setBudgetInited] = useState(false);
  const [perSeatMode, setPerSeatMode] = useState(true);
  const [sharedModel, setSharedModel] = useState("");
  const [seatModels, setSeatModels] = useState<string[]>(["", "", "", "", "", ""]);
  const [customSharedMode, setCustomSharedMode] = useState(false);
  const [customSeatModes, setCustomSeatModes] = useState<boolean[]>([
    false,
    false,
    false,
    false,
    false,
    false,
  ]);

  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightResult, setPreflightResult] = useState<LabPreflightResult | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // 记录筛选与多选对比导出
  const [filterMode, setFilterMode] = useState<"real" | "all" | "failed">("real");
  const [searchText, setSearchText] = useState("");
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [drawerSession, setDrawerSession] = useState<LabSessionListItem | null>(null);

  const applyLabSnapshot = useCallback(
    (cfg: LabConfigSummary, runs: LabRunsResponse) => {
      setError(null);
      setConfig(cfg);
      setLiveStatus(cfg.activeRun);
      setRunsData(runs);

      if (!budgetInited) {
        const defaultWan =
          cfg.defaultLabTokenBudgetPerAgent === 0
            ? 0
            : Math.max(5, Math.round(cfg.defaultLabTokenBudgetPerAgent / 10_000));
        setBudgetWan(defaultWan);
        setBudgetInited(true);
      }
      setSharedModel((prev) => prev || cfg.defaultModel);
      setSeatModels((prev) =>
        prev.map((m, idx) => m || cfg.defaultSeatModels?.[idx] || cfg.defaultModel),
      );
      setExpandedRuns((prev) => {
        if (Object.keys(prev).length > 0 || runs.runs.length === 0) return prev;
        return { [runs.runs[0].runId]: true };
      });
    },
    [budgetInited],
  );

  const loadAll = useCallback(async () => {
    const includeMock = filterMode !== "real";
    const status = filterMode === "failed" ? "failed" : "all";
    try {
      const [cfg, runs] = await Promise.all([
        fetchLabConfig(),
        fetchLabRuns({ includeMock, status }),
      ]);
      applyLabSnapshot(cfg, runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载实验室数据失败");
    } finally {
      setLoading(false);
    }
  }, [filterMode, applyLabSnapshot]);

  useEffect(() => {
    let cancelled = false;
    const includeMock = filterMode !== "real";
    const status = filterMode === "failed" ? "failed" : "all";
    Promise.all([fetchLabConfig(), fetchLabRuns({ includeMock, status })])
      .then(([cfg, runs]) => {
        if (!cancelled) applyLabSnapshot(cfg, runs);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "加载实验室数据失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterMode, applyLabSnapshot]);

  // 轮询运行中状态
  useEffect(() => {
    const isRunning = liveStatus?.running === true;
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      fetchLabStatus()
        .then((st) => {
          setLiveStatus(st);
          if (!st.running) {
            void loadAll();
          }
        })
        .catch(() => {
          /* ignore transient poll error */
        });
    }, 2500);
    return () => window.clearInterval(timer);
  }, [liveStatus?.running, loadAll]);

  const allPoolModelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of config?.modelPoolGroups ?? []) {
      for (const m of g.models) ids.add(m.id);
    }
    return ids;
  }, [config?.modelPoolGroups]);

  const activeModelsForRun = useMemo(() => {
    const fallback = sharedModel.trim() || config?.defaultModel || "deepseek-ai/DeepSeek-V4.1-Flash";
    if (!perSeatMode) return Array(6).fill(fallback) as string[];
    return seatModels.map((m, i) => m.trim() || config?.defaultSeatModels?.[i] || fallback);
  }, [perSeatMode, sharedModel, seatModels, config?.defaultModel, config?.defaultSeatModels]);

  const applyDefaultSixVendorModels = () => {
    const defaults = config?.defaultSeatModels ?? [
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "Qwen/Qwen3.5-397B-A17B",
      "zai-org/GLM-5.3-Flash",
      "moonshotai/Kimi-K3.1-Pro",
      "MiniMaxAI/MiniMax-M3.1-Flash",
      "stepfun-ai/Step-3.5-Flash",
    ];
    setPerSeatMode(true);
    setSeatModels(defaults.slice(0, 6));
    setCustomSeatModes([false, false, false, false, false, false]);
  };

  const applyPreset = (preset: "C0" | "C1" | "C2" | "C3" | "SMOKE") => {
    setActionMsg(null);
    if (preset === "C0") {
      setCondition("C0");
      setChatEnabled(false);
      setMemoryEnabled(true);
      setPredictionEnabled(true);
      setAutoSocialScore(true);
      setMockMode(false);
      setPerSeatMode(false);
      setNotes("C0 基线：关闭沟通，测试纯规则与单局记忆下的行为分化");
    } else if (preset === "C1") {
      setCondition("C1");
      setChatEnabled(true);
      setMemoryEnabled(true);
      setPredictionEnabled(true);
      setAutoSocialScore(true);
      setMockMode(false);
      setPerSeatMode(false);
      setNotes("C1 沟通条件：开启公开群聊、自建小群与一对一私聊");
    } else if (preset === "C2") {
      setCondition("C2");
      setChatEnabled(true);
      setMemoryEnabled(true);
      setPredictionEnabled(true);
      setAutoSocialScore(true);
      setMockMode(false);
      setPerSeatMode(true);
      setNotes("C2 多模型对比：同一把后台密钥，给 6 个座位分配不同模型");
    } else if (preset === "C3") {
      setCondition("C3");
      setChatEnabled(false);
      setMemoryEnabled(false);
      setPredictionEnabled(true);
      setAutoSocialScore(true);
      setMockMode(false);
      setPerSeatMode(false);
      setNotes("C3 无记忆对照：关闭单局滚动记忆，观察跨轮适应变化");
    } else {
      setCondition("smoke");
      setGames(1);
      setChatEnabled(true);
      setMemoryEnabled(true);
      setPredictionEnabled(true);
      setAutoSocialScore(true);
      setMockMode(true);
      setPerSeatMode(false);
      setNotes("免费假跑自检：不消耗真实大模型费用，几十秒验证整条流程");
    }
  };

  const handlePreflight = async () => {
    setPreflightBusy(true);
    setPreflightResult(null);
    try {
      const res = await runLabPreflightApi(activeModelsForRun);
      setPreflightResult(res);
    } catch (e) {
      setPreflightResult({
        ok: false,
        error: e instanceof Error ? e.message : "检测失败",
        results: [],
      });
    } finally {
      setPreflightBusy(false);
    }
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setActionMsg(null);
    try {
      const tokenBudgetPerAgent =
        budgetWan <= 0 ? 0 : Math.max(50_000, Math.round(budgetWan * 10_000));
      await startLabRunApi({
        condition: condition.trim() || "C1",
        name: runName.trim() || undefined,
        notes: notes.trim() || undefined,
        games,
        seedBase,
        chatEnabled,
        memoryEnabled,
        predictionEnabled,
        autoSocialScore,
        mock: mockMode,
        tokenBudgetPerAgent,
        models: activeModelsForRun,
      });
      const st = await fetchLabStatus();
      setLiveStatus(st);
      setActionMsg("✅ 实验已启动！即使关闭此网页，后台也会继续按预设局数自动跑完。");
      void loadAll();
    } catch (err) {
      setActionMsg(`❌ 启动失败：${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!window.confirm("确定停止当前正在运行的实验批次？已跑完的局会保留，进行中的这局将记为已停止。")) {
      return;
    }
    setStopping(true);
    try {
      await stopLabRunApi();
      const st = await fetchLabStatus();
      setLiveStatus(st);
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "停止失败");
    } finally {
      setStopping(false);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    if (!window.confirm(`确定删除实验记录「${runId}」？删除后不可恢复。`)) return;
    try {
      await deleteLabRunApi(runId);
      setSelectedRunIds((prev) => prev.filter((id) => id !== runId));
      await loadAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleComparisonExport = async (format: "xlsx" | "csv") => {
    setExportBusy(true);
    try {
      const q = new URLSearchParams({
        format,
        includeMock: filterMode === "all" ? "1" : "0",
      });
      if (selectedRunIds.length > 0) {
        q.set("runIds", selectedRunIds.join(","));
      }
      await downloadLabFile(
        `/api/admin/lab/export-analysis?${q}`,
        `6ai_lab_comparison.${format}`,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "导出对比表失败");
    } finally {
      setExportBusy(false);
    }
  };

  const visibleRuns = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const list = runsData?.runs ?? [];
    if (!q) return list;
    return list.filter(
      (r) =>
        r.runId.toLowerCase().includes(q) ||
        r.manifest.condition.toLowerCase().includes(q) ||
        r.manifest.name.toLowerCase().includes(q) ||
        r.manifest.notes.toLowerCase().includes(q),
    );
  }, [runsData, searchText]);

  const toggleRunSelected = (runId: string) => {
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId],
    );
  };

  const productBaselineWan = config
    ? Math.round(config.productTokenBudgetPerAgent / 10_000)
    : 100;
  const defaultLabWan = config
    ? Math.round(config.defaultLabTokenBudgetPerAgent / 10_000)
    : 200;

  return (
    <div style={{ minHeight: "100vh", background: "#070b14", padding: "1.75rem 1.5rem", color: "#e2e8f0" }}>
      {/* 顶栏 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: "0.6rem" }}>
            ← 返回控制台
          </button>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, color: "#fbbf24", margin: 0 }}>
            🧪 6AI 实验室
          </h1>
          <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.84), marginTop: "0.35rem" }}>
            6 个无预设人设 AI 独立对局实验台 · 数据与普通玩家排行榜完全隔离 · 支持实时围观与三档研究数据导出
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadAll()} disabled={loading}>
          刷新数据
        </button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.75rem",
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.35)",
            color: "#fecaca",
            fontSize: uiRem(0.85),
          }}
        >
          {error}
        </div>
      )}

      {/* 正在运行的实验实时监控卡片 */}
      {liveStatus?.running && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1.25rem",
            borderRadius: "1rem",
            background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(56,189,248,0.1))",
            border: "1px solid rgba(56,189,248,0.45)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
              marginBottom: "0.85rem",
            }}
          >
            <div>
              <div style={{ fontWeight: 900, fontSize: uiRem(1.05), color: "#6ee7b7" }}>
                ⚡ 实验正在后台运行中：{liveStatus.name || liveStatus.condition}
              </div>
              <div style={{ fontSize: uiRem(0.82), color: "#cbd5e1", marginTop: "0.25rem" }}>
                进度：第 {Math.min(liveStatus.currentGameIndex + 1, liveStatus.totalGames)} / {liveStatus.totalGames} 局
                （已完成 {liveStatus.completedGames} 局） · 阶段：
                {liveStatus.phase ? PHASE_NAMES[liveStatus.phase] || liveStatus.phase : "准备中"} · 第{" "}
                {liveStatus.currentEra} 时代第 {liveStatus.roundInEra} 轮 · 已耗时{" "}
                {formatDurationMs(liveStatus.elapsedMs)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {liveStatus.roomId && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onSpectateLabRoom(liveStatus.roomId!)}
                >
                  👁 进房实时围观
                </button>
              )}
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={stopping}
                onClick={() => void handleStop()}
              >
                {stopping ? "停止中…" : "⏹ 停止本次实验"}
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "0.6rem",
            }}
          >
            {liveStatus.seats.map((seat) => {
              const pct =
                liveStatus.tokenBudgetPerAgent > 0
                  ? Math.min(100, Math.round((seat.tokensUsed / liveStatus.tokenBudgetPerAgent) * 100))
                  : 0;
              return (
                <div
                  key={seat.playerId}
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: "0.65rem",
                    background: "rgba(15,23,42,0.75)",
                    border: seat.thinking
                      ? "1px solid rgba(56,189,248,0.65)"
                      : "1px solid rgba(255,255,255,0.08)",
                    fontSize: uiRem(0.75),
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                    <span style={{ color: "#fbbf24" }}>{seat.name}</span>
                    <span style={{ color: seat.thinking ? "#38bdf8" : "#94a3b8" }}>
                      {seat.thinking ? "思考中…" : `财富 ${seat.wealth}`}
                    </span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: uiRem(0.68), marginTop: "0.15rem" }}>
                    {seat.model}
                  </div>
                  <div style={{ color: "#cbd5e1", fontSize: uiRem(0.68), marginTop: "0.25rem" }}>
                    消耗 {formatQuotaWan(seat.tokensUsed, "0")} / {formatQuotaWan(liveStatus.tokenBudgetPerAgent)}
                    {liveStatus.tokenBudgetPerAgent > 0 ? ` (${pct}%)` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 区块 1：发起新实验 */}
      <form
        onSubmit={handleStart}
        style={{
          marginBottom: "1.75rem",
          padding: "1.35rem",
          borderRadius: "1rem",
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <h2 style={{ margin: 0, fontSize: uiRem(1.1), fontWeight: 800, color: "#fbbf24" }}>
            1. 发起新实验
          </h2>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset("C0")}>
              C0 关闭聊天（基线）
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset("C1")}>
              C1 开启聊天（公聊+私聊）
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset("C2")}>
              C2 6人不同模型混战
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyPreset("C3")}>
              C3 关闭记忆对照
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                background: "rgba(16,185,129,0.16)",
                border: "1px solid rgba(16,185,129,0.4)",
                color: "#6ee7b7",
              }}
              onClick={() => applyPreset("SMOKE")}
            >
              ⚡ 免费假跑自检（1局）
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "0.9rem",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: uiRem(0.8) }}>
            <span style={{ color: "var(--color-text-muted)" }}>实验条件代号</span>
            <input
              className="input"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="如 C0 / C1 / C2"
              maxLength={32}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: uiRem(0.8) }}>
            <span style={{ color: "var(--color-text-muted)" }}>本批实验名称（可选）</span>
            <input
              className="input"
              value={runName}
              onChange={(e) => setRunName(e.target.value)}
              placeholder="如：正式第一批-开启聊天"
              maxLength={60}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: uiRem(0.8) }}>
            <span style={{ color: "var(--color-text-muted)" }}>连跑局数（1～20 局）</span>
            <input
              type="number"
              className="input"
              min={1}
              max={20}
              value={games}
              onChange={(e) => setGames(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
          </label>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: uiRem(0.8) }}>
            <span style={{ color: "var(--color-text-muted)" }}>
              固定发牌编号（同号抽到相同时代与项目卡）
            </span>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <input
                type="number"
                className="input"
                value={seedBase}
                onChange={(e) => setSeedBase(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSeedBase(Math.floor(100_000 + Math.random() * 9_000_000))}
              >
                🎲 随机
              </button>
            </div>
          </div>
        </div>

        {/* 单局消耗上限（研究员可手动调整，默认 500 万，支持不限额度） */}
        <div
          style={{
            marginTop: "1rem",
            padding: "0.85rem 1rem",
            borderRadius: "0.75rem",
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.22)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: uiRem(0.86), color: "#fbbf24" }}>
                单局消耗上限（每位 AI 每局，单位：万）
              </div>
              <div style={{ fontSize: uiRem(0.75), color: "var(--color-text-muted)", marginTop: "0.2rem" }}>
                产品版基准为 {productBaselineWan} 万/位，实验室已默认大幅提高至{" "}
                <strong style={{ color: "#fde68a" }}>{defaultLabWan} 万/位</strong>
                （{budgetWan === 0 ? "当前已设为不限额度" : `当前 6 人整局最高合计 ${budgetWan * 6} 万`}）；设限且超限时将直接停局并标为作废
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
              <input
                type="number"
                className="input"
                min={0}
                max={10000}
                step={50}
                value={budgetWan}
                onChange={(e) => {
                  const n = Math.trunc(Number(e.target.value));
                  if (!Number.isFinite(n) || n <= 0) setBudgetWan(0);
                  else setBudgetWan(Math.max(5, Math.min(10000, n)));
                }}
                style={{ width: "6.5rem" }}
              />
              <span style={{ fontSize: uiRem(0.8), color: "#cbd5e1" }}>
                {budgetWan === 0 ? "不限额度" : "万 / 位"}
              </span>
              {[
                { val: 200, label: "200万" },
                { val: defaultLabWan, label: `${defaultLabWan}万(默认推荐)` },
                { val: 1000, label: "1000万" },
                { val: 0, label: "♾️ 不限额度" },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`btn btn-sm ${budgetWan === preset.val ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBudgetWan(preset.val)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 能力开关与模型选择（共用一个密钥） */}
        <div
          style={{
            marginTop: "0.9rem",
            display: "flex",
            flexWrap: "wrap",
            gap: "1rem",
            alignItems: "center",
            fontSize: uiRem(0.82),
          }}
        >
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input type="checkbox" checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />
            允许聊天（公开群 + 小群 + 私聊）
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} />
            开启单局记忆
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={predictionEnabled}
              onChange={(e) => setPredictionEnabled(e.target.checked)}
            />
            每时代前预测排名
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoSocialScore}
              onChange={(e) => setAutoSocialScore(e.target.checked)}
            />
            终局自动评定社交档 (A–E)
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              cursor: "pointer",
              color: mockMode ? "#6ee7b7" : "#cbd5e1",
              fontWeight: mockMode ? 700 : 400,
            }}
          >
            <input type="checkbox" checked={mockMode} onChange={(e) => setMockMode(e.target.checked)} />
            免费假跑自检（不调真实大模型）
          </label>
        </div>

        {/* 单密钥模型选择器 */}
        <div
          style={{
            marginTop: "0.95rem",
            padding: "0.85rem 1rem",
            borderRadius: "0.75rem",
            background: "rgba(56,189,248,0.05)",
            border: "1px solid rgba(56,189,248,0.22)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.65rem",
              marginBottom: "0.75rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: "#7dd3fc", fontSize: uiRem(0.84) }}>
                模型选择（共用后台同一把密钥）
              </span>
              <span
                style={{
                  fontSize: uiRem(0.74),
                  padding: "0.15rem 0.5rem",
                  borderRadius: "9999px",
                  background: config?.keyConfigured ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)",
                  color: config?.keyConfigured ? "#6ee7b7" : "#fca5a5",
                }}
              >
                {config?.keyConfigured
                  ? `✅ 密钥已就绪（${config.provider}）`
                  : "⚠️ 后台尚未配置密钥（可先用假跑自检）"}
              </span>
            </div>

            <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className={`btn btn-sm ${!perSeatMode ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPerSeatMode(false)}
              >
                6 人共用同一模型
              </button>
              <button
                type="button"
                className={`btn btn-sm ${perSeatMode ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPerSeatMode(true)}
              >
                1～6 号分别指定模型
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={mockMode}
                onClick={applyDefaultSixVendorModels}
              >
                🎲 一键填 6 家不同模型
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  background: "rgba(16,185,129,0.14)",
                  border: "1px solid rgba(16,185,129,0.38)",
                  color: "#6ee7b7",
                }}
                disabled={preflightBusy || mockMode}
                onClick={() => void handlePreflight()}
              >
                {preflightBusy ? "检测中…" : "🔌 测试模型连通性"}
              </button>
            </div>
          </div>

          <datalist id="lab-suggested-models">
            {(config?.suggestedModels ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          {!perSeatMode ? (
            <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: uiRem(0.8), color: "var(--color-text-muted)" }}>全员使用模型：</span>
              <select
                className="input"
                value={mockMode ? "__mock__" : customSharedMode || (sharedModel && !allPoolModelIds.has(sharedModel)) ? "__custom__" : sharedModel}
                disabled={mockMode}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__custom__") {
                    setCustomSharedMode(true);
                  } else {
                    setCustomSharedMode(false);
                    setSharedModel(val);
                  }
                }}
                style={{ width: "22rem" }}
              >
                {mockMode && <option value="__mock__">mock-model（假跑自检）</option>}
                {(config?.modelPoolGroups ?? []).map((group) => (
                  <optgroup key={group.vendor} label={`${group.vendor}（最近两款）`}>
                    {group.models.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="__custom__">自定义输入其他模型 ID…</option>
              </select>
              {!mockMode && (customSharedMode || (sharedModel && !allPoolModelIds.has(sharedModel))) && (
                <input
                  list="lab-suggested-models"
                  className="input"
                  value={sharedModel}
                  onChange={(e) => setSharedModel(e.target.value)}
                  placeholder="输入硅基流动模型 ID"
                  style={{ width: "18rem" }}
                />
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "0.65rem",
              }}
            >
              {seatModels.map((model, idx) => {
                const isCustom =
                  !mockMode && (customSeatModes[idx] || (!!model && !allPoolModelIds.has(model)));
                return (
                  <div
                    key={idx}
                    style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: uiRem(0.74) }}
                  >
                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>玩家 {idx + 1}</span>
                    <select
                      aria-label={`玩家 ${idx + 1} 模型`}
                      className="input"
                      value={mockMode ? "__mock__" : isCustom ? "__custom__" : model}
                      disabled={mockMode}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__custom__") {
                          setCustomSeatModes((prev) => prev.map((x, j) => (j === idx ? true : x)));
                        } else {
                          setCustomSeatModes((prev) => prev.map((x, j) => (j === idx ? false : x)));
                          setSeatModels((prev) => prev.map((x, j) => (j === idx ? val : x)));
                        }
                      }}
                    >
                      {mockMode && <option value="__mock__">mock-model（假跑自检）</option>}
                      {(config?.modelPoolGroups ?? []).map((group) => (
                        <optgroup key={group.vendor} label={`${group.vendor}（最近两款）`}>
                          {group.models.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      <option value="__custom__">自定义输入其他模型 ID…</option>
                    </select>
                    {isCustom && (
                      <input
                        list="lab-suggested-models"
                        className="input"
                        value={model}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSeatModels((prev) => prev.map((x, j) => (j === idx ? val : x)));
                        }}
                        placeholder="输入完整模型 ID"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {preflightResult && (
            <div
              style={{
                marginTop: "0.7rem",
                padding: "0.55rem 0.75rem",
                borderRadius: "0.55rem",
                background: preflightResult.ok ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.12)",
                fontSize: uiRem(0.76),
                color: preflightResult.ok ? "#6ee7b7" : "#fecaca",
              }}
            >
              {preflightResult.error && <div>{preflightResult.error}</div>}
              {preflightResult.results.map((r) => (
                <div key={r.model}>
                  {r.ok ? "✅" : "❌"} {r.model} · {r.latencyMs}ms {r.error ? `（${r.error}）` : ""}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: "0.9rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="实验备注（可选，会一起写入导出清单）"
            style={{ flex: 1, minWidth: "240px" }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={starting || liveStatus?.running === true}
          >
            {liveStatus?.running
              ? "当前已有实验在运行"
              : starting
                ? "正在启动…"
                : mockMode
                  ? "⚡ 启动免费假跑自检"
                  : "🚀 开始运行实验"}
          </button>
        </div>
        {actionMsg && (
          <div style={{ marginTop: "0.65rem", fontSize: uiRem(0.82), color: "#fde68a" }}>{actionMsg}</div>
        )}
      </form>

      {/* 区块 2：历史批次记录 + 对比导出 */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: uiRem(1.1), fontWeight: 800, color: "#fbbf24" }}>
              2. 实验批次记录与数据分析导出
            </h2>
            {runsData && (
              <div style={{ fontSize: uiRem(0.78), color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                共 {runsData.stats.totalRuns} 个批次 · 正式有效局 {runsData.stats.completedRealSessions} 局 ·
                作废/中断 {runsData.stats.failedOrStoppedSessions} 局 · 假跑自检 {runsData.stats.mockSessions} 局
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={exportBusy}
              onClick={() => void handleComparisonExport("xlsx")}
            >
              {exportBusy
                ? "生成中…"
                : selectedRunIds.length > 0
                  ? `📊 导出选中 ${selectedRunIds.length} 批对比表 (.xlsx)`
                  : "📊 导出全部有效批次对比表 (.xlsx)"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={exportBusy}
              onClick={() => void handleComparisonExport("csv")}
            >
              📥 导出玩家级总表 (.csv)
            </button>
          </div>
        </div>

        {/* 筛选与搜索 */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          {(
            [
              ["real", "只看正式实验（不含假跑）"],
              ["all", "全部批次（含假跑自检）"],
              ["failed", "只看作废与中断"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`btn btn-sm ${filterMode === mode ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setFilterMode(mode)}
            >
              {label}
            </button>
          ))}
          <input
            className="input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索条件代号 / 批次名 / 备注…"
            style={{ width: "16rem", marginLeft: "auto" }}
          />
        </div>

        {/* 批次列表 */}
        {loading && !runsData ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--color-text-muted)" }}>
            正在加载实验档案…
          </div>
        ) : visibleRuns.length === 0 ? (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              color: "var(--color-text-muted)",
              border: "2px dashed var(--color-border)",
              borderRadius: "1rem",
            }}
          >
            暂无符合条件的实验记录
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {visibleRuns.map((run) => {
              const badge = runStatusBadge(run);
              const isExpanded = Boolean(expandedRuns[run.runId]);
              const isSelected = selectedRunIds.includes(run.runId);
              const uniqueModels = Array.from(new Set(run.manifest.models)).join(" / ");
              return (
                <div
                  key={run.runId}
                  style={{
                    borderRadius: "0.95rem",
                    background: "var(--color-bg-card)",
                    border: isSelected
                      ? "1px solid rgba(251,191,36,0.6)"
                      : "1px solid var(--color-border)",
                    padding: "1rem 1.15rem",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "0.75rem",
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRunSelected(run.runId)}
                        title="勾选加入对比导出"
                        style={{ marginTop: "0.25rem", cursor: "pointer" }}
                      />
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: uiRem(0.98), color: "#fbbf24" }}>
                            {run.manifest.condition}
                          </strong>
                          <span style={{ fontWeight: 700, color: "#f8fafc", fontSize: uiRem(0.92) }}>
                            {run.manifest.name}
                          </span>
                          <span
                            style={{
                              fontSize: uiRem(0.7),
                              padding: "0.12rem 0.5rem",
                              borderRadius: "9999px",
                              background: badge.bg,
                              color: badge.color,
                            }}
                          >
                            {badge.label}
                          </span>
                          {run.manifest.mock && (
                            <span
                              style={{
                                fontSize: uiRem(0.7),
                                padding: "0.12rem 0.5rem",
                                borderRadius: "9999px",
                                background: "rgba(148,163,184,0.2)",
                                color: "#cbd5e1",
                              }}
                            >
                              假跑自检
                            </span>
                          )}
                          {run.migratedFromAgentEdition && (
                            <span
                              style={{
                                fontSize: uiRem(0.7),
                                padding: "0.12rem 0.5rem",
                                borderRadius: "9999px",
                                background: "rgba(168,85,247,0.18)",
                                color: "#d8b4fe",
                              }}
                            >
                              历史实测迁入
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: uiRem(0.76), color: "var(--color-text-muted)", marginTop: "0.3rem" }}>
                          完成 {run.completedGames}/{run.manifest.games} 局 · 模型：{uniqueModels || "—"} ·
                          发牌基准号：{run.manifest.seedBase} · 单局上限：
                          {run.manifest.tokenBudgetPerAgent === 0
                            ? "不限额度"
                            : `${formatQuotaWan(run.manifest.tokenBudgetPerAgent)}/位`}{" "}
                          · 沟通：{run.manifest.chatEnabled ? "开" : "关"} · 记忆：
                          {run.manifest.memoryEnabled ? "开" : "关"} · 耗时：
                          {formatDurationMs(run.durationMs)} · 开始于 {formatDateTime(run.manifest.createdAt)}
                        </div>
                        {run.manifest.notes && (
                          <div style={{ fontSize: uiRem(0.74), color: "#cbd5e1", marginTop: "0.2rem" }}>
                            备注：{run.manifest.notes}
                          </div>
                        )}
                        {run.failureReason && (
                          <div style={{ fontSize: uiRem(0.74), color: "#fca5a5", marginTop: "0.2rem" }}>
                            中断/失败说明：{run.failureReason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          setExpandedRuns((prev) => ({ ...prev, [run.runId]: !isExpanded }))
                        }
                      >
                        {isExpanded ? "收起局次" : `查看局次 (${run.sessions.length})`}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() =>
                          void downloadLabFile(
                            `/api/admin/lab/runs/${encodeURIComponent(run.runId)}/export?format=xlsx`,
                            `${run.runId}_batch.xlsx`,
                          )
                        }
                      >
                        导出本批 Excel
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          void downloadLabFile(
                            `/api/admin/lab/runs/${encodeURIComponent(run.runId)}/export?format=json`,
                            `${run.runId}_batch.json`,
                          )
                        }
                      >
                        本批 JSON
                      </button>
                      {run.status !== "running" && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: "#f87171" }}
                          onClick={() => void handleDeleteRun(run.runId)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{ marginTop: "0.9rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.75rem" }}>
                      {run.sessions.length === 0 ? (
                        <div style={{ fontSize: uiRem(0.78), color: "var(--color-text-muted)" }}>
                          本批次尚未产生完整归档局记录
                        </div>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", fontSize: uiRem(0.78), borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ color: "var(--color-text-muted)", textAlign: "left" }}>
                                <th style={{ padding: "0.35rem" }}>局序 / 社区名</th>
                                <th style={{ padding: "0.35rem" }}>体检状态</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>总财富 / 首富</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>轮次</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>公/私聊</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>预测数</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>总消耗</th>
                                <th style={{ padding: "0.35rem", textAlign: "right" }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {run.sessions.map((s) => (
                                <tr key={s.sessionId} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                  <td style={{ padding: "0.45rem 0.35rem" }}>
                                    <div style={{ fontWeight: 700, color: "#f8fafc" }}>
                                      第 {s.sessionOrdinal + 1} 局 · {s.communityName}
                                    </div>
                                    <div style={{ fontSize: uiRem(0.7), color: "#94a3b8" }}>
                                      种子 {s.seed} · 主题 {s.eraTheme ?? "—"}
                                    </div>
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem" }}>
                                    {s.qc?.valid ? (
                                      <span style={{ color: "#6ee7b7", fontWeight: 700 }}>✅ 通过</span>
                                    ) : (
                                      <span style={{ color: "#fca5a5", fontWeight: 700 }}>
                                        ❌ 作废（{s.failureReason || s.qc?.reasons?.[0] || "未通过"}）
                                      </span>
                                    )}
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    <div>{s.communityWealth.toLocaleString()}</div>
                                    <div style={{ fontSize: uiRem(0.7), color: "#94a3b8" }}>
                                      {s.topPlayer.name} ({s.topPlayer.wealth})
                                    </div>
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    {s.qc?.currentEra ?? 0}代·{s.qc?.globalRound ?? 0}轮
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    {s.qc?.publicMessages ?? 0} / {s.qc?.privateMessages ?? 0}
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    {s.qc?.predictions ?? 0}
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    {formatQuotaWan(s.qc?.totalTokensUsed, "0")}
                                  </td>
                                  <td style={{ padding: "0.45rem 0.35rem", textAlign: "right" }}>
                                    <div style={{ display: "inline-flex", gap: "0.35rem", flexWrap: "wrap" }}>
                                      <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => setDrawerSession(s)}
                                      >
                                        查看分析
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() =>
                                          void downloadLabFile(
                                            `/api/admin/lab/sessions/${encodeURIComponent(s.sessionId)}/export?format=xlsx`,
                                            `${s.condition}_${s.sessionId.slice(0, 8)}.xlsx`,
                                          )
                                        }
                                      >
                                        Excel(16表)
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn-ghost btn-sm"
                                        onClick={() =>
                                          void downloadLabFile(
                                            `/api/admin/lab/sessions/${encodeURIComponent(s.sessionId)}/export?format=json`,
                                            `${s.condition}_${s.sessionId.slice(0, 8)}.json`,
                                          )
                                        }
                                      >
                                        JSON
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drawerSession && (
        <LabSessionDrawer session={drawerSession} onClose={() => setDrawerSession(null)} />
      )}
    </div>
  );
};
