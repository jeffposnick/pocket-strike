// Tests for phone-swing detection (src/swing.ts) against synthetic swings (swing-synth.ts).
//
//   node tools/sim/swing.test.ts     (exits non-zero on failure)
import { detectSwing, isSwinging, SWING } from '../../src/swing.ts';
import type { SwingThrow } from '../../src/swing.ts';
import { randomGrip, rng, synthStill, synthSwing } from './swing-synth.ts';
import type { SwingSpec } from './swing-synth.ts';

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const fmt = (r: SwingThrow | null) =>
  r ? `power ${r.power.toFixed(2)} angle ${r.angle.toFixed(3)} spin ${r.spin.toFixed(2)} peak ${r.peak.toFixed(0)} arc ${r.arc.toFixed(0)} twist ${r.twist.toFixed(0)}` : 'null';

function bowl(spec: SwingSpec): SwingThrow | null {
  const s = synthSwing(spec);
  return detectSwing(s.samples, s.release);
}

// A plain swing is a throw, with the peak rate read correctly.
{
  const s = synthSwing({ hz: 100 });
  const r = detectSwing(s.samples, s.release);
  ok(r !== null, `plain swing throws (${fmt(r)})`);
  if (r) {
    ok(near(r.peak, s.peak, s.peak * 0.06), `peak ${r.peak.toFixed(0)} ≈ ${s.peak.toFixed(0)} deg/s`);
    ok(r.spin === 0, `no twist → straight (spin ${r.spin})`);
    ok(near(r.angle, 0, 0.003), `no stray → angle ≈ 0 (${r.angle.toFixed(4)})`);
  }
}

// Faster swings make faster balls.
{
  const powers = [0.7, 0.5, 0.4, 0.3, 0.22].map((fwdTime) => bowl({ fwdTime })?.power ?? -1);
  ok(powers.every((p, i) => i === 0 || p >= powers[i - 1]), `power rises with swing speed (${powers.map((p) => p.toFixed(2)).join(' ')})`);
  ok(powers[0] < 0.25 && powers[4] > 0.95, 'slow swing is slow, fast swing is full power');
}

// Twisting anticlockwise (seen from the shoulder) hooks left (negative spin), and the reverse.
{
  const left = bowl({ twist: 60 });
  const right = bowl({ twist: -60 });
  ok(!!left && near(left.spin, -60 / SWING.twistFull, 0.08), `twist +60 → hook left (${fmt(left)})`);
  ok(!!right && near(right.spin, 60 / SWING.twistFull, 0.08), `twist -60 → hook right (${fmt(right)})`);
  const fast = bowl({ twist: 90, fwdTime: 0.25 });
  ok(!!fast && fast.spin < -0.95 && Math.abs(fast.angle) < 0.02, `a hard twist stays hook, not launch angle (${fmt(fast)})`);
  const small = bowl({ twist: 6 });
  ok(!!small && small.spin === 0, `small twist is in the dead zone (${fmt(small)})`);
}

// Straying sideways sets the launch angle; its sign follows the hand.
{
  const r = bowl({ side: 8 });
  const l = bowl({ side: -8 });
  ok(!!r && r.angle > 0.01, `stray right → positive angle (${fmt(r)})`);
  ok(!!l && l.angle < -0.01, `stray left → negative angle (${fmt(l)})`);
  const wild = bowl({ side: 40 });
  ok(!!wild && wild.angle === SWING.maxAngle, `angle is clamped (${fmt(wild)})`);
}

// The grip doesn't matter: any phone orientation in the hand gives the same throw.
{
  const r = rng(7);
  const spec: SwingSpec = { twist: 45, side: 5, fwdTime: 0.35 };
  const base = bowl(spec)!;
  let worst = 0;
  for (let i = 0; i < 40; i++) {
    const g = bowl({ ...spec, grip: randomGrip(r) });
    if (!g) {
      ok(false, `grip ${i}: no throw`);
      continue;
    }
    worst = Math.max(worst, Math.abs(g.power - base.power), Math.abs(g.spin - base.spin), Math.abs(g.angle - base.angle) * 10);
  }
  ok(worst < 0.02, `40 random grips agree (worst difference ${worst.toFixed(4)})`);
}

// Sensor noise and a 60 Hz sensor (iOS) still give close to the clean answer.
{
  const r = rng(11);
  const spec: SwingSpec = { twist: 45, side: 5, fwdTime: 0.35 };
  const clean = bowl({ ...spec, hz: 200 })!;
  let worst = 0;
  for (let i = 0; i < 30; i++) {
    const g = bowl({ ...spec, hz: i % 2 ? 60 : 100, grip: randomGrip(r), gyroNoise: 4, accNoise: 0.4, seed: 100 + i });
    if (!g) {
      ok(false, `noisy swing ${i}: no throw`);
      continue;
    }
    worst = Math.max(worst, Math.abs(g.power - clean.power), Math.abs(g.spin - clean.spin));
  }
  ok(worst < 0.08, `noisy 60/100 Hz swings agree (worst difference ${worst.toFixed(3)})`);
}

// Other swing shapes still throw: no backswing (launch is straight), an early or a late release.
{
  const noBack = bowl({ back: 0, fwd: 80, releaseAt: 60 });
  ok(!!noBack && noBack.angle === 0, `forward swing from hanging throws straight (${fmt(noBack)})`);
  ok(bowl({ releaseAt: -10 }) !== null, 'release just before the bottom still throws');
  const late = bowl({ releaseAt: 40, side: 6 });
  ok(!!late && late.angle > 0.01, `late release keeps the stray (${fmt(late)})`);
}

// Not throws: holding still, a slow tilt, a tiny swing, or swinging then holding on.
{
  const still = synthStill(1.5, 0, { gyroNoise: 3 });
  ok(detectSwing(still.samples, still.release) === null, 'phone held still: no throw');
  const tilt = synthStill(1, 45, { grip: randomGrip(rng(3)) });
  ok(detectSwing(tilt.samples, tilt.release) === null, 'slow tilt: no throw');
  ok(bowl({ back: 12, fwd: 12, fwdTime: 0.4, releaseAt: 5 }) === null, 'tiny swing: no throw');
  ok(bowl({ holdAfter: 0.9 }) === null, 'swing, then hold on for 0.9 s: no throw');
  ok(bowl({ holdAfter: 0.2 }) !== null, 'swing, release 0.2 s late: still a throw');
}

// Mid-swing detection (used to stop the ball following the thumb while swinging).
{
  const s = synthSwing({ fwdTime: 0.3 });
  const mid = s.samples.findIndex((p) => p.t > 0.3 + 0.25);
  ok(isSwinging(s.samples.slice(0, mid + 1), s.samples[mid].t), 'isSwinging during the backswing');
  ok(!isSwinging(s.samples.slice(0, 10), s.samples[9].t), 'not swinging while held still');
}

console.log(failures ? `${failures} of ${checks} swing checks failed` : `All ${checks} swing checks passed`);
if (failures) process.exit(1);
