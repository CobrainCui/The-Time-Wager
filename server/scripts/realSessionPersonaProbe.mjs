/**
 * 真实对局样例（6 人）— 用当前 AnalysisWeights 推算维分与命运素描。
 * 假定：总精力 = 长+短+风险；无道具/社交/ROI 明细时后三维为 0。
 * 用法：npm run build && node scripts/realSessionPersonaProbe.mjs
 */
import {
  computePersonaDimensions,
  classifyFateSketch,
  FateSketchThresholds,
} from "../dist/logic/analysisLogic.js";

const rows = [
  { id: "P1", long: 31, short: 32, risk: 7, wealth: [0, 100, 140] },
  { id: "P2", long: 56, short: 28, risk: 19, wealth: [0, 55, 125] },
  { id: "P3", long: 36, short: 44, risk: 4, wealth: [0, 25, 125] },
  { id: "P4", long: 18, short: 36, risk: 6, wealth: [0, 105, 175] },
  { id: "P5", long: 102, short: 21, risk: 7, wealth: [0, 120, 150] },
  { id: "P6", long: 69, short: 24, risk: 3, wealth: [0, 55, 95, 58] },
];

function makePlayer(row) {
  const total = row.long + row.short + row.risk;
  return {
    id: row.id,
    name: row.id,
    energy: 0,
    wealth: 0,
    connected: true,
    ready: true,
    rank: 0,
    investment: {},
    longTerm: {},
    riskGains: {},
    inventory: [],
    usedCards: [],
    activeBuffs: [],
    slackedBy: [],
    totalEnergyConsumed: total,
    wealthHistory: row.wealth,
    investedRiskEnergy: row.risk,
    investedLongEnergy: row.long,
    investedShortEnergy: row.short,
    socialRank: null,
  };
}

const emptyGame = {
  roomId: "real",
  players: [],
  phase: "GAME_OVER",
  phaseFinished: new Set(),
  readyPlayers: new Set(),
  transactions: [],
  currentEra: 5,
  roundInEra: 2,
  globalRound: 10,
  eraSequence: [0, 1, 2, 3, 4],
  activeProjects: [],
  uncompletedProjects: [],
  completedProjects: [],
  drawnProjects: new Set(),
  totalRiskEnergyAvailable: 400,
  pendingEvents: {},
  eventCards: {},
  eventChoices: {},
  logs: [],
  playerLogs: {},
};

console.log("FateSketchThresholds:", FateSketchThresholds);
console.log("id\tL/S/R\tlt\tst\trk\tri\tsc\trc\t→素描\n");
for (const row of rows) {
  const p = makePlayer(row);
  const s = computePersonaDimensions(p, emptyGame);
  const persona = classifyFateSketch(s);
  console.log(
    `${row.id}\t${row.long}/${row.short}/${row.risk}\t` +
      `${s.longTermism.toFixed(1)}\t${s.shortTermism.toFixed(1)}\t${s.riskTaking.toFixed(1)}\t` +
      `${s.ruleIntervention.toFixed(0)}\t${s.socialConnection}\t${s.resourceConversion.toFixed(0)}\t${persona}`
  );
}
