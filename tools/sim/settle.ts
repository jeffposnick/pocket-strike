// Regression checks for two physics bugs that were fixed:
//  1. The ball rebounding off a dense rack into the gutter and rolling back
//     toward the bowler (fixed by damping rebound after contact).
//  2. Fallen pins jittering back and forth in place (fixed by static
//     friction, sleeping pins and soft overlap correction).
//
//   node tools/sim/settle.ts     (exits non-zero if a check fails)
//
// Every roll is seeded, so the checks give the same numbers on every run: a failure is a real
// change in the physics, never bad luck. `--seed N` reruns them with other rolls.
import { CLASSIC_RACK, DECK_Y, MEGA_RACK } from '../../src/constants.ts';
import { Sim } from '../../src/sim.ts';
import { seeded, STEP } from './helpers.ts';

const arg = process.argv.indexOf('--seed');
const SEED = arg > 0 ? Number(process.argv[arg + 1]) : 1;
// Rolls per position and speed. Two rolls gave only ~40 fallen Classic pins, too few for the 5%
// jitter limit: about one seed in four failed it. Eight keeps every seed tried under 4%.
const REPS = 8;

let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failed = true;
};

for (const [name, layout] of [
  ['classic', CLASSIC_RACK],
  ['mega', MEGA_RACK],
] as const) {
  let rolls = 0;
  let gutterAfterContact = 0;
  let maxSettleAfterContact = 0;
  let downPins = 0;
  let jittering = 0;
  let roll = 0;
  for (const x of [-120, -60, 0, 60, 120]) {
    for (const speed of [1400, 2200, 2900]) {
      for (let r = 0; r < REPS; r++) {
        const rand = seeded(SEED * 1000 + roll++);
        const s = new Sim(rand, layout);
        s.placeBall(x);
        s.launch(speed, (rand() - 0.5) * 0.1, (rand() - 0.5) * 1.2);
        let t = 0;
        let contactAt = NaN;
        let gutterBefore = false;
        while (!s.settled() && t < 12) {
          s.step(STEP);
          t += STEP;
          if (s.contact && Number.isNaN(contactAt)) {
            contactAt = t;
            gutterBefore = s.ball.gutter;
          }
        }
        if (Number.isNaN(contactAt)) continue;
        rolls++;
        if ((s.ball.gutter && !gutterBefore) || (s.ball.y > DECK_Y && !s.ball.inPit)) gutterAfterContact++;
        maxSettleAfterContact = Math.max(maxSettleAfterContact, t - contactAt);

        // Jitter: keep simulating after "settled" and look for back-and-forth motion.
        const start = s.pins.map((p) => [p.x, p.y]);
        let prev = s.pins.map((p) => [p.x, p.y]);
        const path = s.pins.map(() => 0);
        for (let k = 0; k < 60; k++) {
          s.step(STEP);
          s.pins.forEach((p, i) => {
            path[i] += Math.hypot(p.x - prev[i][0], p.y - prev[i][1]);
            prev[i] = [p.x, p.y];
          });
        }
        s.pins.forEach((p, i) => {
          if (p.state !== 'down') return;
          downPins++;
          if (path[i] - Math.hypot(p.x - start[i][0], p.y - start[i][1]) > 2) jittering++;
        });
      }
    }
  }
  check(
    gutterAfterContact === 0,
    `${name}: ball never ends up back on the lane after hitting pins (${gutterAfterContact}/${rolls})`,
  );
  check(
    maxSettleAfterContact <= 4.6,
    `${name}: result within 4.6 s of contact (max ${maxSettleAfterContact.toFixed(1)} s)`,
  );
  // The game freezes physics once settled; this measures how quiet piles are anyway.
  const pct = (jittering / Math.max(1, downPins)) * 100;
  check(pct < 5, `${name}: fallen pins jittering after settle ${pct.toFixed(1)}% (${jittering}/${downPins}, limit 5%)`);
}

process.exit(failed ? 1 : 0);
