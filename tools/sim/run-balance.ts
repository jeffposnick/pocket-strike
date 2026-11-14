// Plays whole Neon Run games with simulated bowlers of three skill levels and
// reports how far they get. Use this to tune stage targets in src/run.ts.
//
//   node tools/sim/run-balance.ts [--runs 30]
//
// The bowler model: aim at the Mega Rack's best line with Gaussian error
// (sigma = skill), shoot spares at the centroid of what's left, arm any
// power-up on the first ball of a frame, pick perks at random and spend coins
// on the priciest power-ups the shop offers. Real players choose perks on purpose, so they do a bit better.
import { MEGA_RACK } from '../../src/constants.ts';
import { hitTier, Run, STAGES } from '../../src/run.ts';
import { powersFor, Sim } from '../../src/sim.ts';
import { flag, gaussian, STEP } from './helpers.ts';

const RUNS = flag('runs', 30);
const stageScores: number[][] = STAGES.map(() => []);

function ball(sim: Sim, run: Run, sigma: number, before: number) {
  const standing = sim.standing();
  if (run.inventory.length && before === sim.rackSize) run.armed.add(0);
  const powers = run.consumeArmed();
  sim.powers = powersFor(powers);
  sim.bumpers = powers.includes('rails') || (run.has('safety') > 0 && before < sim.rackSize);
  const line = MEGA_RACK.homingLine ?? 80;
  let x: number;
  if (before === sim.rackSize) {
    x = line + gaussian() * sigma;
    sim.homingX = line;
  } else {
    const cx = standing.reduce((a, p) => a + p.x, 0) / standing.length;
    x = cx + gaussian() * sigma;
    sim.homingX = cx;
  }
  sim.placeBall(Math.max(-200, Math.min(200, x)));
  sim.events = [];
  sim.launch(2100 + gaussian() * 200, 0, gaussian() * 0.08);
  let t = 0;
  let specials = 0;
  while (!sim.settled() && t < 10) {
    sim.step(STEP);
    t += STEP;
    for (const e of sim.events) {
      if (e.type === 'pinDown' && e.kind !== 'normal') {
        run.collect(e.kind);
        specials++;
      }
    }
    sim.events = [];
  }
  const knocked = before - sim.standing().length;
  if (powers.includes('midas')) run.coins += Math.floor(knocked / 5);
  return { knocked, specials, powers };
}

/** Returns the number of stages cleared (STAGES.length = won). */
function playRun(sigma: number): number {
  const run = new Run();
  const sim = new Sim(Math.random, MEGA_RACK);
  const R = sim.rackSize;
  for (;;) {
    sim.mods = run.mods();
    let streak = 0;
    for (let f = 0; f < run.framesPerStage; f++) {
      sim.resetRack();
      for (const p of sim.pins) p.kind = 'normal';
      for (const [id, k] of run.rollSpecials(R)) sim.pins[id - 1].kind = k;
      const a = ball(sim, run, sigma, R);
      const tier = hitTier(a.knocked, R, true);
      streak = tier === 'big' || tier === 'clear' ? streak + 1 : 0;
      run.addPoints(run.points(a.knocked, tier, false, streak, a.specials, a.powers).total);
      // Second ball, plus one per Encore, while pins remain.
      let extra = a.powers.includes('encore') ? 1 : 0;
      for (let k = 0; k <= extra && sim.standing().length; k++) {
        sim.clearDeadwood();
        const before = sim.standing().length;
        const b = ball(sim, run, sigma, before);
        if (b.powers.includes('encore')) extra++;
        run.addPoints(run.points(b.knocked, null, b.knocked === before, 0, b.specials, b.powers).total);
      }
    }
    stageScores[run.stage].push(run.stageScore);
    if (!run.cleared) return run.stage;
    if (run.isFinalStage) return STAGES.length;
    for (const r of run.stageReward()) run.coins += r.coins;
    const offers = run.offerPerks();
    run.takePerk(offers[Math.floor(Math.random() * offers.length)].id);
    for (const offer of run.offerShop().sort((x, y) => y.price - x.price)) run.buy(offer);
    run.nextStage();
  }
}

console.log(`${RUNS} runs per skill level. Histogram = how many runs cleared 0..${STAGES.length} stages.`);
for (const [label, sigma] of [
  ['strong', 15],
  ['average', 35],
  ['beginner', 60],
] as const) {
  const hist = Array(STAGES.length + 1).fill(0);
  for (let i = 0; i < RUNS; i++) hist[playRun(sigma)]++;
  console.log(`  ${label.padEnd(9)} [${hist.join(' ')}]  win ${Math.round((hist[STAGES.length] / RUNS) * 100)}%`);
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
console.log(`  median score reached per stage: ${stageScores.map((a) => (a.length ? median(a) : '-')).join(' ')}`);
console.log(`  stage targets:                  ${STAGES.map((s) => s.target).join(' ')}`);
