import type { DropId, PinKind, PowerId, SimMods } from './sim.ts';

/** Common power-ups drop from special pins; rare and legendary ones are only sold in the shop. */
export type Rarity = 'common' | 'rare' | 'legendary';

export interface PowerInfo {
  name: string;
  icon: string;
  color: string;
  desc: string;
  rarity?: Rarity;
}

export const POWERS: Record<PowerId, PowerInfo & { rarity: Rarity }> = {
  fire: { name: 'Fireball', icon: '🔥', color: '#ff7a2b', rarity: 'common', desc: 'Plows through the rack and sets pins ablaze. Burning pins topple anything they touch.' },
  bomb: { name: 'Bomb', icon: '💣', color: '#ff4d6d', rarity: 'common', desc: 'Explodes on first contact and blasts every pin nearby.' },
  chain: { name: 'Chain Lightning', icon: '⚡', color: '#38f3ff', rarity: 'common', desc: 'Each falling pin zaps the nearest standing pin.' },
  mega: { name: 'Mega Ball', icon: '🌕', color: '#ffe066', rarity: 'common', desc: 'The ball grows huge and heavy for one throw.' },
  homing: { name: 'Homing', icon: '🎯', color: '#b47cff', rarity: 'common', desc: 'Steers the ball into the pocket, or toward the pins left standing.' },
  rails: { name: 'Guard Rails', icon: '🛡️', color: '#7dff9b', rarity: 'common', desc: 'Bumpers for one throw. No gutter ball.' },
  magnet: { name: 'Magnet', icon: '🧲', color: '#ff5ec4', rarity: 'common', desc: 'Pins near the ball slide into its path as it reaches the rack.' },
  snowball: { name: 'Snowball', icon: '☃️', color: '#cfefff', rarity: 'common', desc: 'The ball grows bigger and heavier with every pin it hits.' },
  ricochet: { name: 'Ricochet', icon: '🔁', color: '#5cffd8', rarity: 'common', desc: "The ball keeps its speed, caroms off the walls and bounces back through the rack twice." },
  blackhole: { name: 'Black Hole', icon: '🕳️', color: '#9b6bff', rarity: 'rare', desc: 'At first contact a vortex opens and drags every pin nearby into a spinning pile.' },
  laser: { name: 'Pin Laser', icon: '🔦', color: '#ff3b3b', rarity: 'rare', desc: "Fires a beam down the ball's line that topples every pin it crosses." },
  double: { name: 'Double Down', icon: '✖️', color: '#ffd23f', rarity: 'rare', desc: "This ball's mult is doubled." },
  encore: { name: 'Encore', icon: '🔂', color: '#7df3ff', rarity: 'rare', desc: 'One extra ball this frame.' },
  quake: { name: 'Earthquake', icon: '🌋', color: '#ff8a3d', rarity: 'legendary', desc: 'At first contact the deck shakes for over a second. Most standing pins go down.' },
  midas: { name: 'Midas Ball', icon: '👑', color: '#ffcf33', rarity: 'legendary', desc: 'Every pin it knocks down is gold: triple chips, and +1 coin for every 5 pins.' },
};

/** The power-ups special pins can drop. */
export const DROPS = (Object.keys(POWERS) as PowerId[]).filter((k): k is DropId => POWERS[k].rarity === 'common');

export const PRICES: Record<Rarity, number> = { common: 3, rare: 5, legendary: 8 };
export const MYSTERY_PRICE = 2;

export const GOLD: PowerInfo = { name: 'Gold Pin', icon: '🪙', color: '#ffc84a', desc: 'Knock it down for a coin.' };

/** Something on the shop shelf. `mystery` hides which power-up it is until it's bought. */
export interface ShopOffer {
  power: PowerId;
  price: number;
  mystery?: boolean;
}

export function pinInfo(kind: PinKind): PowerInfo | null {
  if (kind === 'normal') return null;
  if (kind === 'gold') return GOLD;
  return POWERS[kind];
}

export type PerkId =
  | 'heavy'
  | 'wide'
  | 'spin'
  | 'domino'
  | 'collector'
  | 'striker'
  | 'spares'
  | 'hothand'
  | 'extra'
  | 'magpie'
  | 'lucky'
  | 'safety'
  | 'surge'
  | 'pockets'
  | 'laser'
  | 'interest';

export interface Perk {
  id: PerkId;
  name: string;
  icon: string;
  desc: string;
  rare?: boolean;
  /** How many times it can be taken. */
  max: number;
}

export const PERKS: Perk[] = [
  { id: 'heavy', name: 'Heavy Ball', icon: '🏋️', desc: 'Ball is 50% heavier and drives through the rack.', max: 2 },
  { id: 'wide', name: 'Wide Body', icon: '⭕', desc: 'Ball is 15% bigger.', max: 2 },
  { id: 'spin', name: 'Spin Doctor', icon: '🌀', desc: 'Your hook is 40% stronger.', max: 2 },
  { id: 'domino', name: 'Domino Effect', icon: '🀱', desc: 'Pins topple 15% more easily.', max: 3 },
  { id: 'collector', name: 'Pin Collector', icon: '📌', desc: '+1 point for every pin.', max: 5 },
  { id: 'striker', name: 'Heavy Hitter', icon: '✖️', desc: 'Big Hits and Mega Strikes give +1 extra mult.', max: 3 },
  { id: 'spares', name: 'Spare Parts', icon: '➗', desc: 'Spares give +1 extra mult.', max: 3 },
  { id: 'hothand', name: 'Hot Hand', icon: '♨️', desc: '+0.5 mult for each Big Hit in a row.', rare: true, max: 3 },
  { id: 'extra', name: 'Extra Frame', icon: '➕', desc: 'One more frame in every stage.', rare: true, max: 2 },
  { id: 'magpie', name: 'Magpie', icon: '🐦', desc: 'Gold pins show up more and pay double.', max: 1 },
  { id: 'lucky', name: 'Lucky Rack', icon: '🍀', desc: 'Two more special pins in every rack.', max: 3 },
  { id: 'safety', name: 'Safety Net', icon: '🥅', desc: 'Bumpers go up whenever you shoot a spare.', max: 1 },
  { id: 'surge', name: 'Power Surge', icon: '🔋', desc: 'Start every stage with a random power-up.', rare: true, max: 2 },
  { id: 'pockets', name: 'Deep Pockets', icon: '🎒', desc: 'One more power-up slot.', max: 2 },
  { id: 'laser', name: 'Laser Sight', icon: '🔦', desc: 'Your aim line reaches all the way to the pins.', max: 1 },
  { id: 'interest', name: 'Interest', icon: '🏦', desc: 'At the end of each stage, +1 coin per 3 coins you hold.', max: 1 },
];

export interface Stage {
  name: string;
  target: number;
  boss?: string;
  mods?: Partial<SimMods>;
}

export const STAGES: Stage[] = [
  { name: 'Warm-up Lane', target: 400 },
  { name: 'League Night', target: 600 },
  { name: 'Slick Lane', target: 790, boss: 'Oil spill: your hook is cut in half', mods: { hookMult: 0.5 } },
  { name: 'Cosmic Hour', target: 1000 },
  { name: 'Pro-Am', target: 1220 },
  { name: 'Iron Pins', target: 1330, boss: 'Iron pins: 35% harder to topple', mods: { fallMult: 1.35 } },
];

export const REROLL_PRICE = 2;

export interface BallPoints {
  chips: number;
  mult: number;
  total: number;
}

/** How good a first ball at a full Mega Rack was. */
export type HitTier = 'clear' | 'big' | 'nice' | null;

export function hitTier(knocked: number, rack: number, fullRack: boolean): HitTier {
  if (!fullRack) return null;
  if (knocked === rack) return 'clear';
  if (knocked >= rack * 0.9) return 'big';
  if (knocked >= rack * 0.8) return 'nice';
  return null;
}

type Rand = () => number;

export class Run {
  stage = 0;
  stageScore = 0;
  totalScore = 0;
  frameInStage = 0;
  coins = 2;
  readonly perks = new Map<PerkId, number>();
  inventory: PowerId[] = [];
  armed = new Set<number>();
  strikes = 0;
  bigHits = 0;
  spares = 0;
  specialsHit = 0;
  private readonly rand: Rand;

  constructor(rand: Rand = Math.random) {
    this.rand = rand;
  }

  has(id: PerkId): number {
    return this.perks.get(id) ?? 0;
  }

  get stageInfo(): Stage {
    return STAGES[this.stage];
  }

  get framesPerStage(): number {
    return 3 + this.has('extra');
  }

  get slots(): number {
    return 2 + this.has('pockets');
  }

  mods(): SimMods {
    const s = this.stageInfo.mods ?? {};
    return {
      ballR: 1.15 ** this.has('wide') * (s.ballR ?? 1),
      ballMass: 1.5 ** this.has('heavy') * (s.ballMass ?? 1),
      hookMult: 1.4 ** this.has('spin') * (s.hookMult ?? 1),
      fallMult: 0.85 ** this.has('domino') * (s.fallMult ?? 1),
    };
  }

  /** Picks which pins (by id, 1-based) are special in a fresh rack. */
  rollSpecials(rackSize: number): Map<number, PinKind> {
    const count = Math.min(12, 3 + this.stage + 2 * this.has('lucky'));
    const ids = Array.from({ length: rackSize }, (_, i) => i + 1)
      .sort(() => this.rand() - 0.5)
      .slice(0, count);
    const weights: [PinKind, number][] = [
      ['gold', this.has('magpie') ? 6 : 3],
      ['fire', 1],
      ['bomb', 0.8],
      ['chain', 1],
      ['mega', 1],
      ['homing', 1],
      ['rails', 0.8],
      ['magnet', 0.9],
      ['snowball', 0.9],
      ['ricochet', 0.8],
    ];
    const total = weights.reduce((a, [, w]) => a + w, 0);
    const out = new Map<number, PinKind>();
    for (const id of ids) {
      let r = this.rand() * total;
      for (const [k, w] of weights) {
        r -= w;
        if (r <= 0) {
          out.set(id, k);
          break;
        }
      }
    }
    return out;
  }

  /** Banks a special pin's reward. Returns a short description for the pop-up. */
  collect(kind: PinKind): string {
    this.specialsHit++;
    if (kind === 'normal') return '';
    if (kind === 'gold') {
      const n = this.has('magpie') ? 2 : 1;
      this.coins += n;
      return `+${n} 🪙`;
    }
    if (this.inventory.length < this.slots) {
      this.inventory.push(kind);
      return `+${POWERS[kind].icon} ${POWERS[kind].name}`;
    }
    this.coins += 1;
    return `Slots full: +1 🪙`;
  }

  /** Removes the armed power-ups from the inventory and returns them. */
  consumeArmed(): PowerId[] {
    const used = [...this.armed].sort((a, b) => b - a).map((i) => this.inventory[i]);
    for (const i of [...this.armed].sort((a, b) => b - a)) this.inventory.splice(i, 1);
    this.armed.clear();
    return used;
  }

  /**
   * `streak` counts consecutive Big Hits / Mega Strikes, including this ball. `used` is what was armed
   * for it: Midas Ball triples the chips and Double Down doubles the mult.
   */
  points(knocked: number, tier: HitTier, spare: boolean, streak: number, specials: number, used: readonly PowerId[] = []): BallPoints {
    const chips = (knocked * (2 + this.has('collector')) + specials * 10) * (used.includes('midas') ? 3 : 1);
    let mult = 1;
    if (tier === 'clear') mult += 3 + this.has('striker');
    if (tier === 'big') mult += 1 + this.has('striker');
    if (tier === 'nice') mult += 0.5;
    if (tier === 'clear' || tier === 'big') mult += 0.5 * this.has('hothand') * Math.max(0, streak - 1);
    if (spare) mult += 1 + this.has('spares');
    if (used.includes('double')) mult *= 2;
    const total = Math.round(chips * mult);
    return { chips, mult, total };
  }

  addPoints(n: number): void {
    this.stageScore += n;
    this.totalScore += n;
  }

  get cleared(): boolean {
    return this.stageScore >= this.stageInfo.target;
  }

  get isFinalStage(): boolean {
    return this.stage === STAGES.length - 1;
  }

  /** Coins awarded for clearing the stage, itemized. */
  stageReward(): { label: string; coins: number }[] {
    const out = [{ label: 'Stage clear', coins: 3 }];
    const surplus = Math.floor((this.stageScore - this.stageInfo.target) / 150);
    if (surplus > 0) out.push({ label: 'Overkill', coins: Math.min(4, surplus) });
    if (this.has('interest')) {
      const i = Math.min(5, Math.floor(this.coins / 3));
      if (i > 0) out.push({ label: 'Interest', coins: i });
    }
    return out;
  }

  nextStage(): void {
    this.stage++;
    this.stageScore = 0;
    this.frameInStage = 0;
  }

  /** Three perks to choose from, never offering one already maxed out. */
  offerPerks(): Perk[] {
    const pool = PERKS.filter((p) => this.has(p.id) < p.max);
    const picks: Perk[] = [];
    while (picks.length < 3 && pool.length) {
      const weights = pool.map((p) => (p.rare ? 0.45 : 1));
      let r = this.rand() * weights.reduce((a, b) => a + b, 0);
      let idx = 0;
      for (; idx < pool.length; idx++) {
        r -= weights[idx];
        if (r <= 0) break;
      }
      picks.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
    }
    return picks;
  }

  /**
   * The shop shelf: two picks that are each rare 40% of the time, a third that is legendary 30% of
   * the time (else rare), and a mystery box. Never the same power-up twice.
   */
  offerShop(): ShopOffer[] {
    const taken = new Set<PowerId>();
    const pick = (rarity: Rarity): PowerId => {
      const pool = (Object.keys(POWERS) as PowerId[]).filter((k) => POWERS[k].rarity === rarity && !taken.has(k));
      const p = pool[Math.floor(this.rand() * pool.length)];
      taken.add(p);
      return p;
    };
    const offer = (rarity: Rarity): ShopOffer => ({ power: pick(rarity), price: PRICES[rarity] });
    return [
      offer(this.rand() < 0.4 ? 'rare' : 'common'),
      offer(this.rand() < 0.4 ? 'rare' : 'common'),
      offer(this.rand() < 0.3 ? 'legendary' : 'rare'),
      { power: this.mysteryPower(), price: MYSTERY_PRICE, mystery: true },
    ];
  }

  /** What a mystery box holds: common 65%, rare 28%, legendary 7%. */
  mysteryPower(): PowerId {
    const r = this.rand();
    const rarity: Rarity = r < 0.07 ? 'legendary' : r < 0.35 ? 'rare' : 'common';
    const pool = (Object.keys(POWERS) as PowerId[]).filter((k) => POWERS[k].rarity === rarity);
    return pool[Math.floor(this.rand() * pool.length)];
  }

  /** A random common power-up (Power Surge). */
  randomPower(): PowerId {
    return DROPS[Math.floor(this.rand() * DROPS.length)];
  }

  /** Buys a shop offer if there's room and money. */
  buy(offer: ShopOffer): boolean {
    if (this.coins < offer.price || this.inventory.length >= this.slots) return false;
    this.coins -= offer.price;
    this.inventory.push(offer.power);
    return true;
  }

  takePerk(id: PerkId): void {
    this.perks.set(id, this.has(id) + 1);
  }
}
