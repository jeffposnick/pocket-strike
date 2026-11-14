// Unit tests for ten-pin scoring, Neon Run points and split detection.
//
//   node tools/sim/scoring.test.ts     (exits non-zero on failure)
import { DROPS, hitTier, MYSTERY_PRICE, POWERS, PRICES, Run } from '../../src/run.ts';
import { seeded } from './helpers.ts';
import { isSplit, provisionalTotal, scoreFrames } from '../../src/scoring.ts';

let failures = 0;
function eq<T>(actual: T, expected: T, label: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const zeros = (n: number) => Array<number>(n).fill(0);
const games: [string, number[], number][] = [
  ['perfect game', Array(12).fill(10), 300],
  ['all 5s (spares)', Array(21).fill(5), 150],
  ['gutter game', zeros(20), 0],
  ['mixed', [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1], 167],
  ['9-spare every frame', [9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9, 1, 9], 190],
  ['10th: X X X', [...zeros(18), 10, 10, 10], 30],
  ['10th: 7 / X', [...zeros(18), 7, 3, 10], 20],
  ['10th: X 7 /', [...zeros(18), 10, 7, 3], 20],
  ['in-game sample', [10, 8, 1, 9, 1, 10, 9, 1, 9, 1, 10, 9, 1, 9, 1, 10, 9, 1], 186],
];
for (const [label, rolls, total] of games) {
  eq(scoreFrames(rolls)[9].total, total, `${label} final total`);
  eq(provisionalTotal(rolls), total, `${label} live total`);
}

eq(scoreFrames([...zeros(18), 10, 10, 10])[9].marks, ['X', 'X', 'X'], '10th frame marks X X X');
eq(scoreFrames([...zeros(18), 7, 3, 10])[9].marks, ['7', '/', 'X'], '10th frame marks 7 / X');
eq(scoreFrames([10, 7])[0].total, null, 'strike total waits for both bonus balls');
eq(provisionalTotal([10, 7]), 24, 'live total counts bonus balls rolled so far');

eq(isSplit([7, 10]), true, '7-10 is a split');
eq(isSplit([4, 6, 7, 10]), true, '4-6-7-10 is a split');
eq(isSplit([8, 10]), true, '8-10 is a split');
eq(isSplit([9, 10]), false, '9-10 is adjacent, not a split');
eq(isSplit([2, 4, 5]), false, '2-4-5 is one cluster');
eq(isSplit([1, 7]), false, 'head pin standing is never a split');

// Neon Run (55-pin Mega Rack).
eq(hitTier(55, 55, true), 'clear', 'all 55 is a Mega Strike');
eq(hitTier(50, 55, true), 'big', '50/55 is a Big Hit');
eq(hitTier(44, 55, true), 'nice', '44/55 is a Nice Hit');
eq(hitTier(43, 55, true), null, '43/55 has no tier');
eq(hitTier(55, 55, false), null, 'second ball never gets a first-ball tier');
const run = new Run(() => 0.5);
eq(run.points(43, null, false, 0, 3), { chips: 116, mult: 1, total: 116 }, '43 pins + 3 specials');
eq(run.points(47, 'nice', false, 0, 5), { chips: 144, mult: 1.5, total: 216 }, 'Nice Hit adds +0.5');
eq(run.points(8, null, true, 0, 0), { chips: 16, mult: 2, total: 32 }, 'spare adds +1');

// Power-up scoring.
eq(run.points(50, 'big', false, 1, 0, ['double']), { chips: 100, mult: 4, total: 400 }, 'Double Down doubles the mult');
eq(run.points(10, null, false, 0, 1, ['midas']), { chips: 90, mult: 1, total: 90 }, 'Midas Ball triples the chips');

// Special pins only drop common power-ups; the shop sells the rarer ones.
const r = new Run(seeded(3));
const dropped = new Set<string>();
for (let i = 0; i < 200; i++) for (const k of r.rollSpecials(55).values()) dropped.add(k);
eq([...dropped].every((k) => k === 'gold' || DROPS.includes(k as never)), true, 'pins drop only gold and common power-ups');
eq(DROPS.every((k) => dropped.has(k)), true, 'every common power-up can drop');
let sawLegendary = false;
let shelvesOk = true;
for (let i = 0; i < 200; i++) {
  const shelf = r.offerShop();
  const ids = shelf.map((o) => o.power);
  const [a, b, c, box] = shelf;
  if (shelf.length !== 4 || new Set(ids.slice(0, 3)).size !== 3) shelvesOk = false;
  for (const o of [a, b, c]) if (o.price !== PRICES[POWERS[o.power].rarity]) shelvesOk = false;
  if (POWERS[c.power].rarity === 'common' || !box.mystery || box.price !== MYSTERY_PRICE) shelvesOk = false;
  if (POWERS[c.power].rarity === 'legendary') sawLegendary = true;
}
eq(shelvesOk, true, 'shelf: three different power-ups priced by rarity, the third never common, then a mystery box');
eq(sawLegendary, true, 'legendaries show up in the shop');
const buyer = new Run(seeded(4));
buyer.coins = 6;
eq(buyer.buy({ power: 'quake', price: 8 }), false, "can't buy what you can't afford");
eq(buyer.buy({ power: 'laser', price: 5 }), true, 'buying takes the coins');
eq([buyer.coins, buyer.inventory], [1, ['laser']], 'and fills a slot');
buyer.coins = 20;
buyer.inventory.push('fire');
eq(buyer.buy({ power: 'bomb', price: 3 }), false, "can't buy with every slot full");

if (failures) {
  console.log(`${failures} scoring check(s) failed`);
  process.exit(1);
}
console.log('All scoring checks passed');
