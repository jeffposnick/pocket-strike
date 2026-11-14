// Tests for the flick (src/flick.ts): touch strokes, and a controller stick as a bowling arm.
//
//   node tools/sim/flick.test.ts     (exits non-zero on failure)
import { MAX_SPEED, MIN_SPEED } from '../../src/constants.ts';
import { flickThrow, STICK, StickSwing } from '../../src/flick.ts';
import type { StickResult, StrokePoint, Throw } from '../../src/flick.ts';

let failures = 0;
let checks = 0;
function ok(cond: boolean, label: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}
const fmt = (t: Throw | null | undefined) => (t ? `speed ${t.speed.toFixed(0)} angle ${t.angle.toFixed(3)} spin ${t.spin.toFixed(2)}` : String(t));

/** A finger stroke: `dy` px up the screen over `ms`, bowing `bow` px sideways at its middle. */
function stroke(dy: number, ms: number, bow = 0, dx = 0, hz = 60): StrokePoint[] {
  const n = Math.max(2, Math.round((ms / 1000) * hz));
  return Array.from({ length: n + 1 }, (_, i) => {
    const k = i / n;
    return { x: dx * k + bow * Math.sin(Math.PI * k), y: 600 - dy * k, t: (k * ms) / 1000 };
  });
}

// Touch flicks.
{
  const fast = flickThrow(stroke(260, 70));
  ok(!!fast && fast.speed > MIN_SPEED + 0.7 * (MAX_SPEED - MIN_SPEED), `fast straight flick is fast (${fmt(fast)})`);
  ok(!!fast && fast.spin === 0 && fast.angle === 0, 'straight flick: no hook, no angle');
  const slow = flickThrow(stroke(260, 260));
  ok(!!slow && !!fast && slow.speed < fast.speed, `slower flick, slower ball (${fmt(slow)})`);
  ok(flickThrow(stroke(150, 600)) === null, 'a gentle slide is not a throw');
  const right = flickThrow(stroke(260, 100, 40));
  const left = flickThrow(stroke(260, 100, -40));
  ok(!!right && !!left && right.spin === -left.spin && right.spin !== 0, `curving either way hooks opposite ways (${fmt(right)} / ${fmt(left)})`);
  const diag = flickThrow(stroke(260, 100, 0, 60));
  ok(!!diag && diag.angle > 0 && diag.spin === 0, `a diagonal flick angles without hook (${fmt(diag)})`);
}

/** Feeds a stick path (x, y per frame at 60 Hz) and collects what comes out. */
function drive(path: [number, number][], swing = new StickSwing()): StickResult[] {
  return path.map(([x, y], i) => swing.feed(i / 60, x, y));
}
const hold = (x: number, y: number, frames: number): [number, number][] => Array.from({ length: frames }, () => [x, y]);
const sweep = (from: [number, number], to: [number, number], frames: number, bow = 0): [number, number][] =>
  Array.from({ length: frames }, (_, i) => {
    const k = (i + 1) / frames;
    return [from[0] + (to[0] - from[0]) * k + bow * Math.sin(Math.PI * k), from[1] + (to[1] - from[1]) * k];
  });
const thrown = (r: StickResult[]) => r.filter((x) => x.thrown !== undefined).map((x) => x.thrown);

// Stick: pull back, push forward.
{
  const fast = thrown(drive([...hold(0, 0, 5), ...sweep([0, 0], [0, 1], 8), ...sweep([0, 1], [0, -1], 2), ...hold(0, -1, 5)]));
  const slow = thrown(drive([...hold(0, 0, 5), ...sweep([0, 0], [0, 1], 8), ...sweep([0, 1], [0, -1], 6), ...hold(0, -1, 5)]));
  ok(fast.length === 1 && !!fast[0], `pull back and push: one throw (${fmt(fast[0])})`);
  ok(slow.length === 1 && !!slow[0] && !!fast[0] && slow[0].speed < fast[0].speed, `slower push, slower ball (${fmt(slow[0])})`);
  const crawl = thrown(drive([...sweep([0, 0], [0, 1], 8), ...sweep([0, 1], [0, -1], 40)]));
  ok(crawl.length === 1 && crawl[0] === null, 'a very slow push is too gentle to throw');
  const curved = thrown(drive([...sweep([0, 0], [0, 1], 8), ...sweep([0, 1], [0, -1], 4, 0.6)]));
  ok(!!curved[0] && curved[0].spin !== 0, `curving the push hooks (${fmt(curved[0])})`);
  const wobble = thrown(drive([...sweep([0, 0], [0, 1], 8), ...sweep([0, 1], [0, -1], 4, 0.05)]));
  ok(!!wobble[0] && wobble[0].spin === 0, `a slight thumb curve stays straight (${fmt(wobble[0])})`);
}

// Stick: not throws, and one throw per push.
{
  ok(thrown(drive(sweep([0, 0], [0, -1], 3))).length === 0, 'pushing forward without pulling back first does nothing');
  const cancelled = drive([...sweep([0, 0], [0, 1], 6), ...hold(0, 0, 30), ...sweep([0, 0], [0, -1], 3)]);
  ok(thrown(cancelled).length === 0, 'pull back, let the stick centre for a while, then push: no throw');
  const twice = drive([...sweep([0, 0], [0, 1], 6), ...sweep([0, 1], [0, -1], 2), ...hold(0, -1, 10), ...sweep([0, -1], [0, 1], 3), ...sweep([0, 1], [0, -1], 2)]);
  ok(thrown(twice).length === 1, 'no second throw until the stick returns to the centre');
  const aim = drive(hold(0.8, 0.1, 3));
  ok(aim.every((r) => r.aim > 0.6 && !r.swinging), 'sideways lines up');
  ok(drive(hold(0.1, 0.05, 3)).every((r) => r.aim === 0), 'inside the dead zone nothing moves');
  const mid = drive(sweep([0, 0], [0, 1], 6));
  ok(mid[mid.length - 1].swinging && mid[mid.length - 1].aim === 0, 'pulled back: swinging, not lining up');
  ok(STICK.back > 0 && STICK.forward < 0, 'stick thresholds point the right way');
}

console.log(failures ? `${failures} of ${checks} flick checks failed` : `All ${checks} flick checks passed`);
if (failures) process.exit(1);
