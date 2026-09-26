import { ActiveProject, GameState, Player } from "../types";
import { PROJECT_CATALOG_BY_ID, TYPE_LABEL, CatalogProjectType } from "../config/projectCatalog";

export type ProjectHelpStatusId =
  | "exploded"
  | "completed"
  | "withdrawn"
  | "abandoned"
  | "investable"
  | "unpaid_long"
  | "in_progress"
  | "participated"
  | "none";

export interface ProjectHelpStatus {
  id: ProjectHelpStatusId;
  chip: string;
  tooltip: string;
}

const STATUS_META: Record<ProjectHelpStatusId, { chip: string; tooltip: string }> = {
  exploded: { chip: "💥 爆", tooltip: "已超上限爆掉并离场（短期无时代加成）" },
  completed: { chip: "🎉 已完成", tooltip: "已正常完成并离场（短期为恰好满额；可含时代加成）" },
  withdrawn: { chip: "🗑️ 已撤场", tooltip: "连续 2 轮无人投资，项目离场" },
  abandoned: { chip: "🚫 已放弃", tooltip: "你已退出该长期项目排名" },
  investable: { chip: "✅ 可投", tooltip: "当前阶段可对本项目分配精力" },
  unpaid_long: { chip: "💤 未发放", tooltip: "长期未满额，完成奖尚未发放" },
  in_progress: { chip: "⏳ 进行中", tooltip: "项目仍在牌桌，暂不可投或未跟投" },
  participated: { chip: "🙋 已参与", tooltip: "你曾参与，当前无更高优先级状态" },
  none: { chip: "—", tooltip: "你未参与该项目" },
};

function findActive(game: GameState, projectId: number): ActiveProject | undefined {
  return game.activeProjects.find((p) => p.id === projectId);
}

function findCompleted(game: GameState, projectId: number): ActiveProject | undefined {
  return game.completedProjects?.find((p) => p.id === projectId);
}

function findUncompleted(game: GameState, projectId: number): ActiveProject | undefined {
  return game.uncompletedProjects?.find((p) => p.id === projectId);
}

function lastResult(game: GameState, projectId: number) {
  return game.lastSettlement?.results.find((r) => r.projectId === projectId);
}

function isOffTableExploded(game: GameState, projectId: number): boolean {
  const r = lastResult(game, projectId);
  if (r?.isExploded) return true;
  const u = findUncompleted(game, projectId);
  if (!u || u.type === "long") return false;
  return false;
}

function isOffTableCompleted(game: GameState, projectId: number): boolean {
  if (findCompleted(game, projectId)) return true;
  return lastResult(game, projectId)?.isCompleted === true;
}

function isOffTableWithdrawn(game: GameState, projectId: number): boolean {
  if (!findUncompleted(game, projectId)) return false;
  if (isOffTableExploded(game, projectId)) return false;
  const u = findUncompleted(game, projectId)!;
  return (u.roundsNoInvestment ?? 0) >= 2;
}

/** 本轮结算刚撤场：仍在结算轮次内，且该项目出现在最近一次结算快照中 */
export function isFreshWithdrawnProject(game: GameState, projectId: number): boolean {
  const ls = game.lastSettlement;
  if (!ls || game.globalRound !== ls.round) return false;
  return ls.results.some((r) => r.projectId === projectId);
}

export function canInvestNow(game: GameState, me: Player, project: ActiveProject): boolean {
  if (!game.activeProjects.some((p) => p.id === project.id)) return false;
  if (game.phase !== "BUFF_USAGE" && game.phase !== "INVESTMENT") return false;
  if (game.phase === "INVESTMENT" && me.ready) return false;

  if (project.type === "long") {
    const lt = me.longTerm[project.id];
    if (lt?.status === "abandoned" || lt?.status === "completed") return false;
  }
  return true;
}

function playerParticipated(game: GameState, me: Player, projectId: number): boolean {
  const lt = me.longTerm[projectId];
  if (lt && lt.status !== undefined) return true;
  if ((me.investment?.[projectId] ?? 0) > 0) return true;
  if ((me.investmentDraft?.[projectId] ?? 0) > 0) return true;
  const r = lastResult(game, projectId);
  if (r) {
    if ((r.playerInvestments[me.id] ?? 0) > 0) return true;
    if ((r.playerGains[me.id]?.total ?? 0) !== 0) return true;
  }
  const active = findActive(game, projectId) ?? findCompleted(game, projectId) ?? findUncompleted(game, projectId);
  if (active?.investorRecords?.[me.id]) return true;
  return false;
}

export function resolveProjectStatus(game: GameState, me: Player, projectId: number): ProjectHelpStatus {
  const meta = (id: ProjectHelpStatusId): ProjectHelpStatus => ({ id, ...STATUS_META[id] });

  const onTable = findActive(game, projectId);
  const offCompleted = findCompleted(game, projectId);
  const offUncompleted = findUncompleted(game, projectId);
  const catalog = PROJECT_CATALOG_BY_ID[projectId];
  const type =
    onTable?.type ??
    catalog?.type ??
    offCompleted?.type ??
    offUncompleted?.type ??
    lastResult(game, projectId)?.type;

  if (offCompleted || offUncompleted) {
    if (isOffTableExploded(game, projectId)) return meta("exploded");
    if (isOffTableCompleted(game, projectId)) return meta("completed");
    if (isOffTableWithdrawn(game, projectId)) return meta("withdrawn");
  } else if (!onTable) {
    const r = lastResult(game, projectId);
    if (r?.isExploded) return meta("exploded");
    if (r?.isCompleted) return meta("completed");
  }

  if (type === "long" && me.longTerm[projectId]?.status === "abandoned") {
    return meta("abandoned");
  }

  if (onTable && canInvestNow(game, me, onTable)) {
    return meta("investable");
  }

  if (
    type === "long" &&
    onTable &&
    me.longTerm[projectId]?.status === "active" &&
    (onTable.accumulatedInvested ?? 0) < onTable.maxEnergy
  ) {
    return meta("unpaid_long");
  }

  if (onTable) return meta("in_progress");

  if (playerParticipated(game, me, projectId)) return meta("participated");

  return meta("none");
}

export interface ProjectHelpRow {
  kind: "data" | "separator";
  projectId?: number;
  name?: string;
  projectType?: CatalogProjectType;
  typeLabel?: string;
  progressHint?: string;
  status?: ProjectHelpStatus;
}

function collectProjectIds(game: GameState): number[] {
  const ids = new Set<number>();
  for (const p of game.activeProjects) ids.add(p.id);
  for (const p of game.completedProjects ?? []) ids.add(p.id);
  for (const p of game.uncompletedProjects ?? []) ids.add(p.id);
  for (const r of game.lastSettlement?.results ?? []) ids.add(r.projectId);
  return [...ids];
}

function rowForProject(game: GameState, me: Player, projectId: number): ProjectHelpRow {
  const active = findActive(game, projectId);
  const catalog = PROJECT_CATALOG_BY_ID[projectId];
  const name = active?.name ?? catalog?.name ?? findCompleted(game, projectId)?.name ?? findUncompleted(game, projectId)?.name ?? `#${projectId}`;
  const type = active?.type ?? catalog?.type ?? "short";
  const typeLabel = TYPE_LABEL[type];
  const max = active?.maxEnergy ?? catalog?.maxEnergy;
  const acc = active?.accumulatedInvested;
  const progressHint =
    max != null && acc != null && active ? `${acc}/${max}` : max != null ? `上限 ${max}` : "—";
  return {
    kind: "data",
    projectId,
    name,
    projectType: type,
    typeLabel,
    progressHint,
    status: resolveProjectStatus(game, me, projectId),
  };
}

export function buildProjectHelpRows(game: GameState, me: Player): ProjectHelpRow[] {
  const ids = collectProjectIds(game);
  if (ids.length === 0) return [];

  const rows = ids
    .map((id) => rowForProject(game, me, id))
    .filter((r) => {
      if (r.status?.id !== "withdrawn") return true;
      return r.projectId != null && isFreshWithdrawnProject(game, r.projectId);
    });

  const investable = rows.filter((r) => r.status?.id === "investable");
  const withdrawn = rows.filter((r) => r.status?.id === "withdrawn");
  const rest = rows.filter((r) => r.status?.id !== "investable" && r.status?.id !== "withdrawn");

  const sortByName = (a: ProjectHelpRow, b: ProjectHelpRow) => (a.name ?? "").localeCompare(b.name ?? "", "zh");
  investable.sort(sortByName);
  rest.sort(sortByName);
  withdrawn.sort(sortByName);

  const out: ProjectHelpRow[] = [...investable];
  if (investable.length > 0 && (rest.length > 0 || withdrawn.length > 0)) {
    out.push({ kind: "separator" });
  }
  out.push(...rest);
  out.push(...withdrawn);
  return out;
}

export function settlementCaption(game: GameState): string {
  if (!game.lastSettlement) return "📌 尚未结算";
  return `📌 截至第 ${game.lastSettlement.round} 轮结算`;
}
