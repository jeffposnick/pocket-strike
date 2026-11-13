// Shared helpers for the headless simulation tools. These run under Node's
// built-in TypeScript type stripping (Node 22.18+), no build step needed.
import type { RackLayout } from '../../src/constants.ts';
import { NO_POWERS, Sim } from '../../src/sim.ts';
import type { ActivePowers } from '../../src/sim.ts';

export const STEP = 1 / 60;

export interface RollResult {
  knocked: number;
  rackSize: number;
  /** Seconds until the sim reported everything had settled. */
  settleTime: number;
  sim: Sim;
}

/** Bowls one ball at a full rack and runs it until it settles. */
export function roll(
  layout: RackLayout,
  x: number,
  opts: { speed?: number; angle?: number; spin?: number; powers?: Partial<ActivePowers>; homingX?: number } = {},
): RollResult {
  const s = new Sim(Math.random, layout);
  s.powers = { ...NO_POWERS, ...opts.powers };
  s.homingX = opts.homingX ?? layout.homingLine ?? 24;
  s.placeBall(x);
  s.launch(opts.speed ?? 2200, opts.angle ?? 0, opts.spin ?? 0);
  let t = 0;
  while (!s.settled() && t < 12) {
    s.step(STEP);
    t += STEP;
  }
  return { knocked: s.rackSize - s.standing().length, rackSize: s.rackSize, settleTime: t, sim: s };
}

export interface Summary {
  avg: number;
  allDownPct: number;
  min: number;
  max: number;
}

export function repeat(n: number, fn: () => RollResult): Summary {
  const results = Array.from({ length: n }, fn);
  const k = results.map((r) => r.knocked);
  return {
    avg: k.reduce((a, b) => a + b, 0) / n,
    allDownPct: (results.filter((r) => r.knocked === r.rackSize).length / n) * 100,
    min: Math.min(...k),
    max: Math.max(...k),
  };
}

export const fmt = (s: Summary) =>
  `${s.avg.toFixed(1)}${s.allDownPct ? ` (${Math.round(s.allDownPct)}% all down)` : ''}`;

export function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Simple CLI flag reader: `--trials 40`. */
export function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}
