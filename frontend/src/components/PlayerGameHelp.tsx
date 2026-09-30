import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  HELP_TABS,
  HelpTabId,
  HELP_RESOURCES,
  HELP_PROJECT_RULE_SECTIONS,
  HELP_FLOW_OVERVIEW,
  HELP_FLOW_SECTIONS,
  HELP_MISC,
  buildBuffHelpEntries,
} from "../config/playerHelpReference";
import {
  CatalogProjectType,
  formatRankList,
  formatShortBurstPenaltyForGame,
  PROJECT_CATALOG_BY_ID,
  ProjectCatalogEntry,
  rankRewardsForGameProject,
  resolveRankRewardTierCountFromGame,
  SETTLEMENT_TIMING_SHORT,
} from "../config/projectCatalog";
import {
  buildProjectHelpRows,
  buildAppearedCatalogEntries,
  resolveProjectStatus,
  ProjectHelpRow,
} from "../utils/projectHelpTable";
import { HelpLine } from "./help/HelpLine";
import { ProjectTypeLabel } from "./help/ProjectTypeLabel";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: GameState;
  me: Player;
  /** 时代页等：展开时不挤主栏，侧栏浮层遮挡 */
  overlayWhenOpen?: boolean;
}

const thStyle: React.CSSProperties = {
  padding: "0.32rem 0.12rem",
  fontWeight: 700,
  fontSize: uiRem(0.72),
  color: "var(--color-text-muted)",
  textAlign: "center",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.28rem 0.12rem",
  fontSize: uiRem(0.78),
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  verticalAlign: "middle",
};

const EMPTY_CELL_MARK = "—";

const PLAYER_HELP_WIDTH_KEY = "player-help-sidebar-width";
const PLAYER_HELP_MIN_WIDTH = 300;
const PLAYER_HELP_MAX_WIDTH_DESKTOP = 900;

function defaultOpenWidthPx(isDrawer: boolean): number {
  const vw = window.innerWidth;
  if (isDrawer) return Math.min(360, Math.round(vw * 0.92));
  return Math.min(560, Math.round(vw * 0.58));
}

function maxOpenWidthPx(isDrawer: boolean): number {
  const vw = window.innerWidth;
  if (isDrawer) return Math.round(vw * 0.92);
  return Math.min(PLAYER_HELP_MAX_WIDTH_DESKTOP, Math.round(vw * 0.85));
}

function clampOpenWidthPx(px: number, isDrawer: boolean): number {
  return Math.round(Math.max(PLAYER_HELP_MIN_WIDTH, Math.min(maxOpenWidthPx(isDrawer), px)));
}

function readStoredOpenWidth(): number | null {
  try {
    const raw = localStorage.getItem(PLAYER_HELP_WIDTH_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function helpCellClass(value: string, extra?: string): string | undefined {
  const classes = [extra, value === EMPTY_CELL_MARK ? "player-help-cell-empty" : undefined].filter(Boolean);
  return classes.length > 0 ? classes.join(" ") : undefined;
}

const SETTLEMENT_LEGEND_TYPES: CatalogProjectType[] = ["short", "long", "risk"];

function ProjectSettlementLegend() {
  return (
    <div className="player-help-settlement-legend" aria-label="三种项目结算方式">
      {SETTLEMENT_LEGEND_TYPES.map((type) => (
        <div key={type} className="player-help-settlement-legend-row">
          <ProjectTypeLabel type={type} />
          <span>{SETTLEMENT_TIMING_SHORT[type]}</span>
        </div>
      ))}
    </div>
  );
}

function annotateDynamicRows(rows: ProjectHelpRow[]): { row: ProjectHelpRow; afterSeparator: boolean }[] {
  let afterSeparator = false;
  return rows.map((row) => {
    if (row.kind === "separator") {
      afterSeparator = true;
      return { row, afterSeparator: false };
    }
    const out = { row, afterSeparator };
    afterSeparator = false;
    return out;
  });
}

/** 与「不可再投项目」同一套列：名称 / 时代 / 类型 / 上限 / 回报 / 排名奖 / 投爆罚 / 状态 */
function projectStatTableHeaders(rankTierCount: number): string[] {
  return [
    "名称",
    "时代",
    "类型",
    "上限",
    "回报",
    `排名奖(1–${rankTierCount})`,
    `投爆罚(1–${rankTierCount})`,
    "状态",
  ];
}

function ProjectStatTableCells({
  name,
  era,
  projectType,
  catalog,
  statusChip,
  statusTooltip,
  statusChipColor,
  game,
}: {
  name: string;
  era: string;
  projectType?: CatalogProjectType;
  catalog?: ProjectCatalogEntry;
  statusChip: string;
  statusTooltip: string;
  statusChipColor?: string;
  game: GameState;
}) {
  const entry = catalog;
  const maxEnergy = entry?.maxEnergy;
  const returnHint = entry?.baseReturnHint ?? EMPTY_CELL_MARK;
  const rankDisplay = entry ? formatRankList(rankRewardsForGameProject(game, entry)) : EMPTY_CELL_MARK;
  const burstPenalty = entry ? formatShortBurstPenaltyForGame(game, entry) : EMPTY_CELL_MARK;

  return (
    <>
      <td style={tdStyle}>{name}</td>
      <td style={{ ...tdStyle, color: "var(--color-text-secondary)" }} className="player-help-cell-nowrap">
        {era || EMPTY_CELL_MARK}
      </td>
      <td style={tdStyle}>
        {projectType ? <ProjectTypeLabel type={projectType} /> : EMPTY_CELL_MARK}
      </td>
      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }} className="player-help-cell-nowrap">
        {maxEnergy ?? EMPTY_CELL_MARK}
      </td>
      <td style={tdStyle} className="player-help-cell-nowrap">
        {returnHint}
      </td>
      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }} className={helpCellClass(rankDisplay)}>
        {rankDisplay}
      </td>
      <td
        style={{
          ...tdStyle,
          fontFamily: "var(--font-mono)",
          color: burstPenalty === EMPTY_CELL_MARK ? undefined : "#fca5a5",
        }}
        className={helpCellClass(burstPenalty)}
      >
        {burstPenalty}
      </td>
      <td style={tdStyle} className={helpCellClass(statusChip)}>
        <span
          className="player-help-status-chip"
          style={statusChipColor ? { color: statusChipColor } : undefined}
          title={statusTooltip}
          aria-label={statusTooltip}
        >
          {statusChip}
        </span>
      </td>
    </>
  );
}

export const PlayerGameHelp: React.FC<Props> = ({
  open,
  onOpenChange,
  game,
  me,
  overlayWhenOpen = false,
}) => {
  const [tab, setTab] = useState<HelpTabId>("projects_table");
  const [openWidthPx, setOpenWidthPx] = useState<number | null>(() => readStoredOpenWidth());
  const [isResizing, setIsResizing] = useState(false);
  const isDesktopLayout = useMediaQuery("(min-width: 1024px)", true);
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(open);
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const dynamicRows = useMemo(() => buildProjectHelpRows(game, me), [game, me]);
  const dynamicAnnotated = useMemo(() => annotateDynamicRows(dynamicRows), [dynamicRows]);
  const appearedCatalog = useMemo(() => buildAppearedCatalogEntries(game, me), [game, me]);
  const rankTierCount = resolveRankRewardTierCountFromGame(game);
  const buffEntries = useMemo(
    () =>
      buildBuffHelpEntries().sort(
        (a, b) => a.auctionRound - b.auctionRound || a.name.localeCompare(b.name, "zh")
      ),
    []
  );

  useEffect(() => {
    if (!open || isDesktopLayout) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isDesktopLayout]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const root = asideRef.current;
      const focusInSidebar = root?.contains(document.activeElement) ?? false;
      const escClosesGlobally = !isDesktopLayout || overlayWhenOpen;
      if (!escClosesGlobally && !focusInSidebar) return;
      e.preventDefault();
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, isDesktopLayout, overlayWhenOpen]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const active = asideRef.current?.querySelector<HTMLButtonElement>(
        '.player-help-tab[aria-selected="true"]'
      );
      active?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (prevOpenRef.current && !open) toggleRef.current?.focus({ preventScroll: true });
    prevOpenRef.current = open;
  }, [open]);

  const handleTabListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = HELP_TABS.findIndex((t) => t.id === tab);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIdx = (idx + 1) % HELP_TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIdx = (idx - 1 + HELP_TABS.length) % HELP_TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = HELP_TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const nextId = HELP_TABS[nextIdx].id;
    setTab(nextId);
    requestAnimationFrame(() => document.getElementById(`player-help-tab-${nextId}`)?.focus());
  };

  const emptyDynamicHint =
    game.activeProjects.length === 0 &&
    (game.completedProjects?.length ?? 0) === 0 &&
    (game.uncompletedProjects?.length ?? 0) === 0
      ? "本局尚未发牌，开战后这里会显示你仍可投的项目"
      : "当前没有仍可投的项目";

  const toggle = () => onOpenChange(!open);
  const useDrawerOverlay = open && !isDesktopLayout;
  const useDesktopOverlay = open && overlayWhenOpen && isDesktopLayout;
  const isDrawerMode = useDrawerOverlay;

  const openSidebarWidthPx = useMemo(() => {
    if (!open) return null;
    const base = openWidthPx ?? defaultOpenWidthPx(isDrawerMode);
    return clampOpenWidthPx(base, isDrawerMode);
  }, [open, openWidthPx, isDrawerMode]);

  useEffect(() => {
    if (!open) return;
    const onWindowResize = () => {
      setOpenWidthPx((prev) => {
        const base = prev ?? defaultOpenWidthPx(isDrawerMode);
        return clampOpenWidthPx(base, isDrawerMode);
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [open, isDrawerMode]);

  const persistOpenWidth = (w: number) => {
    const clamped = clampOpenWidthPx(w, isDrawerMode);
    setOpenWidthPx(clamped);
    try {
      localStorage.setItem(PLAYER_HELP_WIDTH_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  };

  const onResizeHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const aside = asideRef.current;
    if (!aside) return;
    resizeDragRef.current = { startX: e.clientX, startWidth: aside.getBoundingClientRect().width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const onResizeHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    const delta = e.clientX - resizeDragRef.current.startX;
    const next = clampOpenWidthPx(resizeDragRef.current.startWidth + delta, isDrawerMode);
    setOpenWidthPx(next);
  };

  const endResizeHandle = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return;
    resizeDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsResizing(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    const w = asideRef.current?.getBoundingClientRect().width;
    if (w) persistOpenWidth(w);
  };

  const renderTabBody = (tabId: HelpTabId) => {
    if (tabId === "projects_table") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <section>
            <h3 style={{ fontSize: uiRem(1.1), fontWeight: 800, color: "#60a5fa", marginBottom: "0.65rem" }}>
              <span aria-hidden style={{ fontSize: uiRem(1.2) }}>🎯 </span>可投项目
            </h3>
            {dynamicRows.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>{emptyDynamicHint}</p>
            ) : (
              <div className="player-help-table-wrap">
                <table className="player-help-table">
                  <thead>
                    <tr>
                      {projectStatTableHeaders(rankTierCount).map((h) => (
                        <th key={h} scope="col" style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dynamicAnnotated.map(({ row, afterSeparator }, idx) => {
                      if (row.kind === "separator") {
                        return (
                          <tr key={`sep-${idx}`} className="player-help-row-separator" aria-hidden>
                            <td colSpan={8} />
                          </tr>
                        );
                      }
                      const catalog = row.projectId != null ? PROJECT_CATALOG_BY_ID[row.projectId] : undefined;
                      return (
                        <tr
                          key={row.projectId}
                          className={afterSeparator ? "player-help-row-after-separator" : undefined}
                        >
                          <ProjectStatTableCells
                            name={row.name ?? `#${row.projectId}`}
                            era={row.eraShort ?? catalog?.era ?? EMPTY_CELL_MARK}
                            projectType={row.projectType ?? catalog?.type}
                            catalog={catalog}
                            statusChip={row.status?.chip ?? EMPTY_CELL_MARK}
                            statusTooltip={row.status?.tooltip ?? ""}
                            statusChipColor={row.status?.chipColor}
                            game={game}
                          />
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 style={{ fontSize: uiRem(1.1), fontWeight: 800, color: "#c084fc", marginBottom: "0.35rem" }}>
              <span aria-hidden style={{ fontSize: uiRem(1.2) }}>📋 </span>不可再投项目
            </h3>
            {appearedCatalog.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>
                暂无不可再投的项目
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 0.5rem", fontSize: uiRem(0.68), color: "var(--color-text-muted)" }}>
                  共 {appearedCatalog.length} 项 · 左右滑动查看
                </p>
                <div className="player-help-table-wrap">
                  <table className="player-help-table">
                    <thead>
                      <tr>
                        {projectStatTableHeaders(rankTierCount).map((h) => (
                          <th key={h} scope="col" style={thStyle}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {appearedCatalog.map((p) => {
                        const status = resolveProjectStatus(game, me, p.id);
                        return (
                          <tr key={p.id}>
                            <ProjectStatTableCells
                              name={p.name}
                              era={p.era}
                              projectType={p.type}
                              catalog={p}
                              statusChip={status.chip}
                              statusTooltip={status.tooltip}
                              statusChipColor={status.chipColor}
                              game={game}
                            />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      );
    }

    if (tabId === "buffs") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {buffEntries.map((b) => (
            <div
              key={b.cardId}
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: "0.75rem",
                border: `1px solid ${b.color}33`,
                background: `${b.color}10`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.25rem",
                }}
              >
                <span aria-hidden style={{ fontSize: uiRem(1.2) }}>
                  {b.icon}
                </span>
                <span style={{ fontWeight: 800, color: b.color, fontSize: uiRem(0.95) }}>{b.name}</span>
                <span
                  title="该道具出现在第几场拍卖"
                  style={{
                    fontSize: uiRem(0.72),
                    fontWeight: 700,
                    color: "#fbbf24",
                    background: "rgba(251,191,36,0.12)",
                    padding: "0.15rem 0.45rem",
                    borderRadius: "9999px",
                  }}
                >
                  第{b.auctionRound}场
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: uiRem(0.82),
                  color: "var(--color-text-secondary)",
                  lineHeight: 1.45,
                }}
              >
                {b.desc}
              </p>
            </div>
          ))}
        </div>
      );
    }

    if (tabId === "projects_rules" || tabId === "flow") {
      const overview =
        tabId === "projects_rules"
          ? "项目的总收益 = 基础收益 + 排名奖惩 + 时代奖励"
          : HELP_FLOW_OVERVIEW;
      const sections = tabId === "projects_rules" ? HELP_PROJECT_RULE_SECTIONS : HELP_FLOW_SECTIONS;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <p
            style={{
              margin: 0,
              padding: "0.55rem 0.75rem",
              borderRadius: "0.65rem",
              background: "rgba(96,165,250,0.08)",
              border: "1px solid rgba(96,165,250,0.22)",
              color: "#93c5fd",
              fontSize: uiRem(0.9),
              fontWeight: 700,
              lineHeight: 1.45,
            }}
          >
            {overview}
          </p>
          {sections.map((section) => (
            <section key={section.title}>
              <h3
                style={{
                  margin: "0 0 0.35rem",
                  fontSize: uiRem(0.95),
                  fontWeight: 800,
                  color: "white",
                }}
              >
                {section.title}
              </h3>
              <div>
                {section.lines.map((line, i) => (
                  <HelpLine key={i} icon={line.icon}>
                    {line.text}
                  </HelpLine>
                ))}
              </div>
            </section>
          ))}
        </div>
      );
    }

    const lines = tabId === "resources" ? HELP_RESOURCES : HELP_MISC;

    return lines.map((line, i) => (
      <HelpLine key={i} icon={line.icon}>
        {line.text}
      </HelpLine>
    ));
  };

  return (
    <>
      {useDrawerOverlay && (
        <button
          type="button"
          className="player-help-backdrop"
          aria-label="关闭说明书"
          onClick={() => onOpenChange(false)}
        />
      )}
      {useDesktopOverlay && <div className="player-help-rail-spacer" aria-hidden />}
      <aside
        ref={asideRef}
        className={`player-help-sidebar${open ? " player-help-sidebar--open" : ""}${
          useDrawerOverlay ? " player-help-sidebar--drawer" : ""
        }${useDesktopOverlay ? " player-help-sidebar--overlay" : ""}${
          isResizing ? " player-help-sidebar--resizing" : ""
        }`}
        style={openSidebarWidthPx != null ? { width: openSidebarWidthPx } : undefined}
        aria-label="游戏说明书"
      >
        <div className="player-help-sidebar-rail">
          <button
            ref={toggleRef}
            type="button"
            className="player-help-toggle"
            aria-label={open ? "收起说明" : "展开说明"}
            aria-expanded={open}
            aria-controls="player-help-sidebar-panel"
            title="游戏说明书"
            onClick={toggle}
          >
            ?
          </button>
        </div>

        {open && (
          <div id="player-help-sidebar-panel" className="player-help-sidebar-panel">
            <div className="player-help-sidebar-header">
              <h2 id="player-help-title" style={{ margin: 0, fontWeight: 800, fontSize: uiRem(1.05), color: "white" }}>
                说明书
              </h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenChange(false)} aria-label="收起">
                收起
              </button>
            </div>

            <div
              role="tablist"
              aria-label="说明分类"
              className="player-help-tabs"
              onKeyDown={handleTabListKeyDown}
            >
              {HELP_TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`player-help-tab-${t.id}`}
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    aria-controls={`player-help-panel-${t.id}`}
                    className="player-help-tab"
                    onClick={() => setTab(t.id)}
                  >
                    <span className="player-help-tab-icon" aria-hidden>{t.icon}</span>
                    <span>{t.title}</span>
                  </button>
                );
              })}
            </div>

            {tab === "projects_table" && <ProjectSettlementLegend />}

            <div className="player-help-sidebar-body">
              {HELP_TABS.map((t) => (
                <div
                  key={t.id}
                  role="tabpanel"
                  id={`player-help-panel-${t.id}`}
                  aria-labelledby={`player-help-tab-${t.id}`}
                  hidden={tab !== t.id}
                >
                  {renderTabBody(t.id)}
                </div>
              ))}
            </div>
          </div>
        )}

        {open && (
          <div
            className="player-help-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖动调整说明栏宽度"
            title="拖动调整宽度"
            onPointerDown={onResizeHandlePointerDown}
            onPointerMove={onResizeHandlePointerMove}
            onPointerUp={endResizeHandle}
            onPointerCancel={endResizeHandle}
          />
        )}
      </aside>
    </>
  );
};
