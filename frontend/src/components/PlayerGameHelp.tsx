import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiRem } from "../utils/typography";
import { GameState, Player } from "../types";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  HELP_TABS,
  HelpTabId,
  HELP_RESOURCES,
  HELP_PROJECT_RULES,
  HELP_FLOW,
  HELP_MISC,
  buildBuffHelpEntries,
} from "../config/playerHelpReference";
import {
  PROJECT_CATALOG,
  formatTop3,
  formatShortBurstPenaltyTop3,
} from "../config/projectCatalog";
import {
  buildProjectHelpRows,
  settlementCaption,
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
  textAlign: "left",
  borderBottom: "1px solid var(--color-border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.28rem 0.12rem",
  fontSize: uiRem(0.78),
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  verticalAlign: "middle",
};

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

export const PlayerGameHelp: React.FC<Props> = ({
  open,
  onOpenChange,
  game,
  me,
  overlayWhenOpen = false,
}) => {
  const [tab, setTab] = useState<HelpTabId>("projects_table");
  const isDesktopLayout = useMediaQuery("(min-width: 768px)", true);
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const prevOpenRef = useRef(open);

  const dynamicRows = useMemo(() => buildProjectHelpRows(game, me), [game, me]);
  const dynamicAnnotated = useMemo(() => annotateDynamicRows(dynamicRows), [dynamicRows]);
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
      ? "本局尚未发牌，开战后这里会显示项目状态"
      : "暂无项目记录";

  const toggle = () => onOpenChange(!open);
  const useDrawerOverlay = open && !isDesktopLayout;
  const useDesktopOverlay = open && overlayWhenOpen && isDesktopLayout;

  const renderTabBody = (tabId: HelpTabId) => {
    if (tabId === "projects_table") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <section>
            <h3 style={{ fontSize: uiRem(0.85), fontWeight: 800, color: "#60a5fa", marginBottom: "0.25rem" }}>
              <span aria-hidden>🎯 </span>本局项目
            </h3>
            <p style={{ margin: "0 0 0.65rem", fontSize: uiRem(0.75), color: "var(--color-text-muted)" }}>
              {settlementCaption(game)}
            </p>
            {dynamicRows.length === 0 ? (
              <p style={{ color: "var(--color-text-muted)", fontSize: uiRem(0.85) }}>{emptyDynamicHint}</p>
            ) : (
              <div className="player-help-table-wrap">
                <table className="player-help-table">
                  <thead>
                    <tr>
                      {["名称", "类型", "进度", "状态"].map((h) => (
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
                            <td colSpan={4} />
                          </tr>
                        );
                      }
                      return (
                        <tr
                          key={row.projectId}
                          className={afterSeparator ? "player-help-row-after-separator" : undefined}
                        >
                          <td style={tdStyle}>{row.name}</td>
                          <td style={tdStyle}>
                            {row.projectType ? <ProjectTypeLabel type={row.projectType} /> : row.typeLabel}
                          </td>
                          <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>{row.progressHint}</td>
                          <td style={tdStyle}>
                            <span
                              className="player-help-status-chip"
                              title={row.status?.tooltip}
                              aria-label={row.status?.tooltip}
                            >
                              {row.status?.chip}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h3 style={{ fontSize: uiRem(0.85), fontWeight: 800, color: "#c084fc", marginBottom: "0.35rem" }}>
              <span aria-hidden>📋 </span>全卡数值
            </h3>
            <p style={{ margin: "0 0 0.5rem", fontSize: uiRem(0.68), color: "var(--color-text-muted)" }}>
              左右滑动查看
            </p>
            <div className="player-help-table-wrap">
              <table className="player-help-table">
                <thead>
                  <tr>
                    {["名称", "类型", "上限", "回报", "排名(前3)", "爆罚(前3)"].map((h) => (
                      <th key={h} scope="col" style={thStyle}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PROJECT_CATALOG.map((p) => (
                    <tr key={p.id}>
                      <td style={tdStyle}>{p.name}</td>
                      <td style={tdStyle}>
                        <ProjectTypeLabel type={p.type} />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>{p.maxEnergy}</td>
                      <td style={tdStyle}>{p.baseReturnHint}</td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>
                        {formatTop3(p.rankRewards)}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", color: "#fca5a5" }}>
                        {formatShortBurstPenaltyTop3(p)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

    const lines =
      tabId === "resources"
        ? HELP_RESOURCES
        : tabId === "projects_rules"
          ? HELP_PROJECT_RULES
          : tabId === "flow"
            ? HELP_FLOW
            : HELP_MISC;

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
          aria-label="关闭说明速查"
          onClick={() => onOpenChange(false)}
        />
      )}
      {useDesktopOverlay && <div className="player-help-rail-spacer" aria-hidden />}
      <aside
        ref={asideRef}
        className={`player-help-sidebar${open ? " player-help-sidebar--open" : ""}${
          useDrawerOverlay ? " player-help-sidebar--drawer" : ""
        }${useDesktopOverlay ? " player-help-sidebar--overlay" : ""}`}
        aria-label="游戏说明速查"
      >
        <div className="player-help-sidebar-rail">
          <button
            ref={toggleRef}
            type="button"
            className="player-help-toggle"
            aria-label={open ? "收起说明" : "展开说明"}
            aria-expanded={open}
            aria-controls="player-help-sidebar-panel"
            title="游戏说明速查"
            onClick={toggle}
          >
            ?
          </button>
        </div>

        {open && (
          <div id="player-help-sidebar-panel" className="player-help-sidebar-panel">
            <div className="player-help-sidebar-header">
              <h2 id="player-help-title" style={{ margin: 0, fontWeight: 800, fontSize: uiRem(1.05), color: "white" }}>
                说明速查
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
                    <span aria-hidden>{t.icon} </span>
                    {t.title}
                  </button>
                );
              })}
            </div>

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
      </aside>
    </>
  );
};
