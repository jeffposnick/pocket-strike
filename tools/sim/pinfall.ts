// Pinfall survey: how many pins each line, hook and power-up knocks down.
// Use this after touching anything in src/sim.ts or the rack layouts.
//
//   node tools/sim/pinfall.ts [--trials 30]
import { CLASSIC_RACK, MEGA_RACK } from '../../src/constants.ts';
import { SIM_POWERS } from '../../src/sim.ts';
import { flag, fmt, repeat, roll } from './helpers.ts';

const N = flag('trials', 30);

console.log(`Classic (10 pins), ${N} trials per cell. "x" is where the ball starts; + is the bowler's right.`);
for (const spin of [0, -0.6]) {
  const cells = [-30, 0, 10, 20, 30, 45].map((x) => {
    // For hooked balls, start further right so the ball arrives near `x`.
    const start = spin ? x + 75 : x;
    return `x${x}: ${fmt(repeat(N, () => roll(CLASSIC_RACK, start, { spin })))}`;
  });
  console.log(`  ${spin ? 'hook' : 'straight'}  ${cells.join('  ')}`);
}

console.log(`\nMega Rack (55 pins), straight balls:`);
console.log(
  '  ' +
    [-150, -80, -40, 0, 40, 80, 150].map((x) => `x${x}: ${fmt(repeat(Math.ceil(N / 2), () => roll(MEGA_RACK, x)))}`).join('  '),
);

console.log(`\nPower-ups on a bad line (Classic from x=-70, Mega Rack from x=-150):`);
for (const p of SIM_POWERS) {
  const c = repeat(N, () => roll(CLASSIC_RACK, -70, { powers: { [p]: true } }));
  const m = repeat(Math.ceil(N / 2), () => roll(MEGA_RACK, -150, { powers: { [p]: true } }));
  console.log(`  ${p.padEnd(9)} classic ${fmt(c).padEnd(22)} mega ${fmt(m)}`);
}
