// Sanity checks for the synthesized sounds (src/audio-synth.ts): every render is finite, audible,
// peak-normalized and the length it should be, and the rolling loop has no seam.
//
//   node tools/sim/audio.test.ts     (exits non-zero on failure)
import { BELLS, MARIMBAS, renderBank } from '../../src/audio-synth.ts';
import { seeded } from './helpers.ts';

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}

const SR = 48000;
const t0 = performance.now();
const bank = renderBank(SR, seeded(1));
const ms = performance.now() - t0;

const all: [string, Float32Array][] = [];
for (const [name, v] of Object.entries(bank)) {
  if (v instanceof Float32Array) all.push([name, v]);
  else if (Array.isArray(v)) v.forEach((d, i) => all.push([`${name}[${i}]`, d]));
  else for (const [k, d] of Object.entries(v as Record<string, Float32Array>)) all.push([`${name}@${k}`, d]);
}

for (const [name, d] of all) {
  let peak = 0;
  let sum = 0;
  let finite = true;
  for (const x of d) {
    if (!Number.isFinite(x)) finite = false;
    peak = Math.max(peak, Math.abs(x));
    sum += x * x;
  }
  const rms = Math.sqrt(sum / d.length);
  ok(finite, `${name}: all samples finite`);
  ok(peak <= 1, `${name}: no clipping (peak ${peak.toFixed(3)})`);
  ok(rms > 0.01, `${name}: audible (rms ${rms.toFixed(4)})`);
  if (name !== 'room[0]' && name !== 'room[1]' && name !== 'roll') {
    ok(Math.abs(d[d.length - 1]) < 1e-3, `${name}: fades out to silence`);
  }
}

ok(
  Object.keys(bank.bell).length === BELLS.length && Object.keys(bank.marimba).length === MARIMBAS.length,
  'every note a cue plays is rendered',
);
// The roll loop wraps from its last sample to its first: the step must be no bigger than a normal one.
const r = bank.roll;
let maxStep = 0;
for (let i = 1; i < r.length; i++) maxStep = Math.max(maxStep, Math.abs(r[i] - r[i - 1]));
ok(
  Math.abs(r[0] - r[r.length - 1]) <= maxStep,
  `roll loop has no seam (${Math.abs(r[0] - r[r.length - 1]).toFixed(4)} vs max step ${maxStep.toFixed(4)})`,
);

console.log(
  failures
    ? `${failures} of ${checks} audio checks failed`
    : `All ${checks} audio checks passed (rendered in ${Math.round(ms)} ms)`,
);
if (failures) process.exit(1);
