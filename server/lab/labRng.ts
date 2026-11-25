import type { GameState } from "../state/gameState.js";
import { shuffleArray } from "../utils/shuffle.js";

/**
 * 可复现随机数（6AI 实验室用）。
 *
 * 同一基准种子 + 局序生成确定性的时代顺序、项目发牌顺序；
 * 仅在 game.isLabExperiment === true 时启用，普通产品房间仍走默认随机。
 */
export function normalizeSeed(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return (Math.trunc(n) >>> 0) || 0;
}

export function deriveSeed(baseSeed: number, ordinal: number): number {
  let x = (baseSeed + Math.imul(ordinal + 1, 0x9e3779b9)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0 || 1;
}

export function nextRandomValue(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, t >>> 0];
}

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = normalizeSeed(seed) || 1;
  }

  get rngState(): number {
    return this.state;
  }

  next(): number {
    const [value, state] = nextRandomValue(this.state);
    this.state = state;
    return value;
  }

  int(maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

export function shuffleWithGameRng<T>(game: GameState, items: readonly T[]): T[] {
  if (game.isLabExperiment && typeof game.labRngState === "number") {
    const rng = new Rng(game.labRngState);
    const out = rng.shuffle(items);
    game.labRngState = rng.rngState;
    return out;
  }
  return shuffleArray([...items]);
}
