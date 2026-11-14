import type { RackLayout } from './constants.ts';
import {
  BALL_MASS,
  BALL_R,
  BALL_START_Y,
  CLASSIC_LANE_HALF,
  CLASSIC_RACK,
  DECK_Y,
  HEAD_Y,
  HOOK,
  LANE_HALF,
  PIN_LEN,
  PIN_MASS,
  PIN_R,
  PIT_Y,
  rackSpots,
  setLaneHalf,
  WALL_X,
} from './constants.ts';

export type PinState = 'standing' | 'down' | 'pit' | 'cleared';

/** Power-ups a special pin can drop (they're also sold in the shop). */
export type DropId = 'fire' | 'bomb' | 'chain' | 'mega' | 'homing' | 'rails' | 'magnet' | 'snowball' | 'ricochet';
/** Rarer power-ups that only the shop sells. */
export type ShopId = 'blackhole' | 'laser' | 'double' | 'encore' | 'quake' | 'midas';
/** Anything that can sit in an inventory slot and be armed for a throw. */
export type PowerId = DropId | ShopId;
export type PinKind = 'normal' | 'gold' | DropId;

/** Lasting changes to the physics, from roguelike perks and stage modifiers. */
export interface SimMods {
  ballR: number;
  ballMass: number;
  hookMult: number;
  /** Multiplier on how hard a pin must be hit to fall. */
  fallMult: number;
}

/** The power-ups that change the physics, active for the current roll. */
export const SIM_POWERS = [
  'fire',
  'bomb',
  'chain',
  'mega',
  'homing',
  'magnet',
  'snowball',
  'ricochet',
  'blackhole',
  'laser',
  'quake',
] as const;
export type SimPower = (typeof SIM_POWERS)[number];
export type ActivePowers = Record<SimPower, boolean>;

export const NO_POWERS: ActivePowers = Object.fromEntries(SIM_POWERS.map((k) => [k, false])) as ActivePowers;

/** Active powers for a set of armed power-ups. */
export function powersFor(armed: readonly PowerId[]): ActivePowers {
  return Object.fromEntries(SIM_POWERS.map((k) => [k, armed.includes(k)])) as ActivePowers;
}
export const DEFAULT_MODS: SimMods = { ballR: 1, ballMass: 1, hookMult: 1, fallMult: 1 };

export interface Pin {
  id: number;
  kind: PinKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;
  state: PinState;
  /** 0..1, how hard a standing pin is rocking. */
  wobble: number;
  /** Seconds since the pin went down (drives the topple animation). */
  downT: number;
  /** Seconds since it dropped into the pit. */
  pitT: number;
  /** Set by the Fireball: a burning pin topples whatever it touches. */
  burning: boolean;
  /** Seconds left before a burning pin goes out. */
  burnT: number;
  /** Seconds a fallen pin has been nearly still; past SLEEP_AFTER it sleeps until hit. */
  restT: number;
}

const SLEEP_AFTER = 0.15;
/** Relative speed needed to wake a sleeping pin. */
const WAKE_SPEED = 60;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  rolling: boolean;
  gutter: boolean;
  inPit: boolean;
  pitT: number;
  /** Visual rotation. */
  rot: number;
}

export type SimEvent =
  | { type: 'ballPin'; x: number; y: number; power: number }
  | { type: 'pinPin'; x: number; y: number; power: number }
  | { type: 'wall'; x: number; y: number; power: number }
  | { type: 'gutter'; x: number; y: number }
  | { type: 'bumper'; x: number; y: number; power: number }
  | { type: 'pit'; x: number; y: number }
  | { type: 'pinDown'; id: number; kind: PinKind; x: number; y: number }
  | { type: 'bomb'; x: number; y: number }
  | { type: 'zap'; x1: number; y1: number; x2: number; y2: number }
  | { type: 'hole'; x: number; y: number }
  | { type: 'laser'; x: number; width: number }
  | { type: 'quake' }
  | { type: 'ricochet'; x: number; y: number };

/** Where a gutter ball runs, measured out from the lane edge. */
const GUTTER_MID = 20;
const BOMB_RADIUS = 165;
const MEGA_SCALE = 1.8;
/** Snowball: each solid hit grows the ball by this much, up to the cap. */
const SNOW_GROWTH = 1.1;
const SNOW_MAX = 2.6;
/** Black Hole: how long the vortex pulls, and its reach as a multiple of the bomb radius. */
const HOLE_TIME = 0.9;
const HOLE_REACH = 1.8;
/** Earthquake: how long the deck shakes, and each standing pin's chance per second of toppling. */
const QUAKE_TIME = 1.4;
const QUAKE_RATE = 1.5;

/** Δv a standing pin must take to go down; softer knocks just make it wobble. */
export const TUNE = { fallDv: 220, downFriction: 2.2, pinE: 0.6, ballE: 0.55 };
const STEP = 1 / 300;

type Rand = () => number;

interface BodyRef {
  x: number;
  y: number;
  vx: number;
  vy: number;
  av: number;
  invM: number;
  invI: number;
}

export class Sim {
  pins: Pin[] = [];
  layout: RackLayout = CLASSIC_RACK;
  private spots = rackSpots(CLASSIC_RACK);
  private pinR = PIN_R;
  private pinMass = PIN_MASS;
  private pinI = (PIN_MASS * PIN_LEN * PIN_LEN) / 12;
  /** A fallen pin collides as three circles along its length. */
  private segOffsets = [-PIN_LEN * 0.34, 0, PIN_LEN * 0.34];
  private segR = 15;
  readonly ball: Ball = {
    x: 0,
    y: BALL_START_Y,
    vx: 0,
    vy: 0,
    spin: 0,
    rolling: false,
    gutter: false,
    inPit: false,
    pitT: 0,
    rot: 0,
  };
  events: SimEvent[] = [];
  bumpers = false;
  /** True once the ball has touched any pin on this roll. */
  contact = false;
  /** Seconds since the ball first touched a pin. */
  sinceContact = 0;
  rollTime = 0;
  mods: SimMods = { ...DEFAULT_MODS };
  powers: ActivePowers = { ...NO_POWERS };
  /** Where homing steers the ball. */
  homingX = 0;
  /** Snowball growth so far this roll (1 = normal size). */
  growth = 1;
  /** An active Black Hole vortex. */
  hole: { x: number; y: number; t: number } | null = null;
  /** Seconds of Earthquake left. */
  quakeT = 0;
  /** Seconds before the Pin Laser fires. */
  private laserT = -1;
  /** Ricochet: bounces off the back of the deck left. */
  private backBounces = 0;
  private holeUsed = false;
  private quakeUsed = false;
  private bombUsed = false;
  private zaps: { x: number; y: number; t: number }[] = [];
  private zapsLeft = 0;
  private readonly rand: Rand;

  constructor(rand: Rand = Math.random, layout: RackLayout = CLASSIC_RACK) {
    this.rand = rand;
    this.setLayout(layout);
  }

  /** Switches between the regulation rack and Neon Run's mega rack. */
  setLayout(layout: RackLayout): void {
    this.layout = layout;
    setLaneHalf(layout.laneHalf ?? CLASSIC_LANE_HALF);
    this.spots = rackSpots(layout);
    const s = layout.pinScale;
    this.pinR = PIN_R * s;
    this.pinMass = PIN_MASS * layout.pinMass;
    const len = PIN_LEN * s;
    this.pinI = (this.pinMass * len * len) / 12;
    this.segOffsets = [-len * 0.34, 0, len * 0.34];
    this.segR = 15 * s;
    this.pins = [];
    for (let i = 0; i < this.spots.length; i++) {
      this.pins.push({
        id: i + 1,
        kind: 'normal',
        burning: false,
        burnT: 0,
        restT: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        angle: 0,
        av: 0,
        state: 'standing',
        wobble: 0,
        downT: 0,
        pitT: 0,
      });
    }
    this.resetRack();
  }

  get bombRadius(): number {
    return this.layout.bombRadius ?? BOMB_RADIUS;
  }

  /** Δv that topples a standing pin, after the rack's scale and perk or stage modifiers. */
  private get fallNeed(): number {
    return TUNE.fallDv * this.mods.fallMult * (this.layout.fallScale ?? 1);
  }

  get rackSize(): number {
    return this.pins.length;
  }

  resetRack(): void {
    this.pins.forEach((p, i) => {
      Object.assign(p, {
        x: this.spots[i].x,
        y: this.spots[i].y,
        vx: 0,
        vy: 0,
        angle: 0,
        av: 0,
        state: 'standing' as PinState,
        burning: false,
        burnT: 0,
        restT: 0,
        wobble: 0,
        downT: 0,
        pitT: 0,
      });
    });
  }

  /** Removes everything that isn't standing, as the sweep bar does. */
  clearDeadwood(): void {
    for (const p of this.pins) {
      if (p.state !== 'standing') p.state = 'cleared';
      p.vx = p.vy = p.av = 0;
      p.wobble = 0;
    }
  }

  standing(): Pin[] {
    return this.pins.filter((p) => p.state === 'standing');
  }

  /** Centre of the pins still standing, or null if none are. */
  standingCentre(): { x: number; y: number } | null {
    const up = this.standing();
    if (!up.length) return null;
    return { x: up.reduce((a, p) => a + p.x, 0) / up.length, y: up.reduce((a, p) => a + p.y, 0) / up.length };
  }

  placeBall(x: number): void {
    this.growth = 1; // Snowball growth lasts one roll.
    Object.assign(this.ball, {
      x,
      y: BALL_START_Y,
      vx: 0,
      vy: 0,
      spin: 0,
      rolling: false,
      gutter: false,
      inPit: false,
      pitT: 0,
    });
  }

  /** Current ball radius, after perks, Mega Ball and Snowball growth. */
  get ballR(): number {
    return BALL_R * this.mods.ballR * (this.powers.mega ? (this.layout.megaScale ?? MEGA_SCALE) : 1) * this.growth;
  }

  private get ballMass(): number {
    return BALL_MASS * this.mods.ballMass * (this.powers.mega ? 3 : 1) * (this.powers.fire ? 6 : 1) * this.growth ** 2;
  }

  launch(speed: number, angle: number, spin: number): void {
    const b = this.ball;
    this.bombUsed = false;
    this.holeUsed = false;
    this.quakeUsed = false;
    this.hole = null;
    this.quakeT = 0;
    this.growth = 1;
    this.backBounces = this.powers.ricochet ? 2 : 0;
    this.laserT = this.powers.laser ? 0.25 : -1;
    this.zaps = [];
    this.zapsLeft = this.layout.zaps ?? 3;
    b.vx = Math.sin(angle) * speed;
    b.vy = -Math.cos(angle) * speed;
    b.spin = spin;
    b.rolling = true;
    this.contact = false;
    this.sinceContact = 0;
    this.rollTime = 0;
  }

  step(dt: number): void {
    const n = Math.max(1, Math.ceil(dt / STEP));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
    this.rollTime += dt;
    if (this.contact) this.sinceContact += dt;
  }

  /** Everything has come to rest (or the roll has gone on long enough). */
  settled(): boolean {
    const b = this.ball;
    // Once the ball has been among the pins for a while, only the pins matter.
    const ballDone = !b.rolling || b.inPit || Math.hypot(b.vx, b.vy) < 15 || this.sinceContact > 2.5;
    if (!ballDone) return false;
    if (this.zaps.length || this.hole || this.quakeT > 0 || this.laserT >= 0) return false;
    if (this.rollTime > 7 || this.sinceContact > 4.5 || (b.inPit && b.pitT > 2.2)) return true;
    return this.pins.every(
      (p) =>
        p.state === 'cleared' ||
        p.state === 'pit' ||
        (p.state === 'standing' && p.wobble < 0.08) ||
        (p.state === 'down' && Math.hypot(p.vx, p.vy) < 25 && Math.abs(p.av) < 1 && p.downT > 0.4),
    );
  }

  private substep(h: number): void {
    const b = this.ball;

    // ---- Ball
    if (b.rolling && !b.inPit) {
      if (!b.gutter) {
        // Oil up front, dry back end: the ball skids, then hooks.
        const progress = -b.y / -HEAD_Y;
        const grip = Math.max(0, Math.min(1, (progress - 0.3) / 0.4));
        b.vx += b.spin * HOOK * this.mods.hookMult * grip * h;
        if (this.powers.homing && b.y < -300 && b.y > HEAD_Y + 30) {
          const ax = (this.homingX - b.x) * 30 - b.vx * 11;
          b.vx += Math.max(-2600, Math.min(2600, ax)) * h;
        }
      }
      const drag = Math.exp(-0.04 * h);
      b.vx *= drag;
      b.vy *= drag;
      if (this.contact && !b.gutter && !this.powers.ricochet) {
        // A 16 lb ball doesn't bounce back off pins: soak up any rebound toward the bowler.
        if (b.vy > 0) b.vy *= Math.exp(-14 * h);
        const deck = Math.exp(-0.8 * h);
        b.vx *= deck;
        b.vy *= deck;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      const R = this.ballR;
      b.rot += (Math.hypot(b.vx, b.vy) / R) * h * 0.18 + b.spin * h * 5;

      if (!b.gutter && !this.contact && b.y > DECK_Y) {
        if (this.bumpers) {
          const lim = LANE_HALF - R + 6;
          if (Math.abs(b.x) > lim) {
            const s = Math.sign(b.x);
            b.x = s * lim;
            this.events.push({ type: 'bumper', x: b.x, y: b.y, power: Math.abs(b.vx) });
            b.vx = -s * Math.abs(b.vx) * 0.45;
            b.spin *= 0.4;
          }
        } else if (Math.abs(b.x) > LANE_HALF + 4) {
          b.gutter = true;
          b.spin = 0;
          b.vx = 0;
          b.x = Math.sign(b.x) * (LANE_HALF + GUTTER_MID);
          this.events.push({ type: 'gutter', x: b.x, y: b.y });
        }
      }
      if (!b.gutter && (b.y <= DECK_Y || this.contact) && Math.abs(b.x) > WALL_X - R) {
        const s = Math.sign(b.x);
        b.x = s * (WALL_X - R);
        // Ricochet: a lively bounce off the kickbacks, back into the rack.
        b.vx = -s * Math.abs(b.vx) * (this.powers.ricochet ? 0.95 : 0.4);
        if (this.powers.ricochet && Math.abs(b.vx) > 120) this.events.push({ type: 'ricochet', x: b.x, y: b.y });
      }
      if (this.backBounces > 0 && !b.gutter && b.y < PIT_Y + R && b.vy < 0) {
        // Ricochet: off the back cushion and through the rack again, angled toward the busier side.
        this.backBounces--;
        b.y = PIT_Y + R;
        const cx = this.standingCentre()?.x ?? 0;
        const speed = Math.max(900, Math.hypot(b.vx, b.vy) * 0.85);
        const dir = Math.atan2(cx - b.x, 420);
        b.vx = Math.sin(dir) * speed;
        b.vy = Math.cos(dir) * speed;
        this.events.push({ type: 'ricochet', x: b.x, y: b.y });
      }
      if (b.vy > 0 && this.contact && b.y > DECK_Y + 200) {
        // A ricochet heading back toward the bowler has done its work: let it roll to a stop.
        const k = Math.exp(-4 * h);
        b.vx *= k;
        b.vy *= k;
      }
      if (b.y < PIT_Y - R * 0.4) {
        b.inPit = true;
        this.events.push({ type: 'pit', x: b.x, y: b.y });
      }
    }
    if (b.inPit) b.pitT += h;

    // ---- Pins
    for (const p of this.pins) {
      if (p.burning) {
        p.burnT -= h;
        if (p.burnT <= 0) p.burning = false;
      }
      if (p.state === 'standing') {
        const k = Math.exp(-14 * h);
        p.vx *= k;
        p.vy *= k;
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.wobble *= Math.exp(-2.2 * h);
      } else if (p.state === 'down') {
        p.downT += h;
        const k = Math.exp(-TUNE.downFriction * h);
        p.vx *= k;
        p.vy *= k;
        p.av *= Math.exp(-1.8 * h);
        // Static friction: a slow pin lying on the deck stops dead instead of creeping.
        if (Math.abs(p.vx) + Math.abs(p.vy) < 18 && Math.abs(p.av) < 0.8) {
          p.restT += h;
          if (p.restT > SLEEP_AFTER) p.vx = p.vy = p.av = 0;
        } else {
          p.restT = 0;
        }
        p.x += p.vx * h;
        p.y += p.vy * h;
        p.angle += p.av * h;
        // Kickbacks and the lane edge.
        for (const off of p.restT > SLEEP_AFTER ? [] : this.segOffsets) {
          const ex = p.x + Math.cos(p.angle) * off;
          if (Math.abs(ex) > WALL_X - this.segR) {
            const s = Math.sign(ex);
            const push = Math.abs(ex) - (WALL_X - this.segR);
            p.x -= s * push;
            if (Math.sign(p.vx) === s) {
              this.events.push({ type: 'wall', x: ex, y: p.y, power: Math.abs(p.vx) });
              p.vx = -p.vx * 0.55;
              p.av += -s * off * 0.004 * Math.abs(p.vx) * 0.1;
            }
          }
        }
      } else if (p.state === 'pit') {
        p.pitT += h;
      }
      if ((p.state === 'standing' || p.state === 'down') && p.y < PIT_Y) {
        if (p.state === 'standing') this.events.push({ type: 'pinDown', id: p.id, kind: p.kind, x: p.x, y: p.y });
        p.state = 'pit';
        p.pitT = 0;
        this.events.push({ type: 'pit', x: p.x, y: p.y });
      }
    }

    // ---- Chain lightning
    for (const z of this.zaps) z.t -= h;
    while (this.zaps.length && this.zaps[0].t <= 0) {
      const z = this.zaps.shift()!;
      let best: Pin | null = null;
      let bestD = 200;
      for (const p of this.pins) {
        if (p.state !== 'standing') continue;
        const d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        const nx = (best.x - z.x) / (bestD || 1);
        const ny = (best.y - z.y) / (bestD || 1);
        this.events.push({ type: 'zap', x1: z.x, y1: z.y, x2: best.x, y2: best.y });
        best.vx = nx * 320;
        best.vy = ny * 320;
        this.afterHit(best, 9999, nx, ny);
      }
    }

    this.stepPowers(h);

    // ---- Collisions
    if (b.rolling && !b.gutter && !b.inPit) {
      const br = this.ballR;
      for (const p of this.pins) {
        if (p.state !== 'standing' && p.state !== 'down') continue;
        const reach = br + this.reach(p);
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        this.collideBallPin(p);
      }
    }
    for (let i = 0; i < this.pins.length; i++) {
      const a = this.pins[i];
      if (a.state !== 'standing' && a.state !== 'down') continue;
      for (let j = i + 1; j < this.pins.length; j++) {
        const c = this.pins[j];
        if (c.state !== 'standing' && c.state !== 'down') continue;
        if (this.resting(a) && this.resting(c) && (this.asleep(a) || this.asleep(c))) continue;
        if (a.state === 'standing' && c.state === 'standing') {
          // Two standing pins only interact if one has been shoved into the other.
          if (Math.abs(a.vx) + Math.abs(a.vy) + Math.abs(c.vx) + Math.abs(c.vy) < 5) continue;
        }
        const reach = this.reach(a) + this.reach(c);
        const dx = a.x - c.x;
        const dy = a.y - c.y;
        if (dx * dx + dy * dy > reach * reach) continue;
        this.collidePins(a, c);
      }
    }
  }

  /** Asleep, or standing still and not rocking. */
  private resting(p: Pin): boolean {
    if (p.state === 'standing') return Math.abs(p.vx) + Math.abs(p.vy) < 3 && p.wobble < 0.3;
    return this.asleep(p);
  }

  private asleep(p: Pin): boolean {
    return p.state === 'down' && p.restT > SLEEP_AFTER;
  }

  /** Bounding radius around a pin's centre. */
  private reach(p: Pin): number {
    return p.state === 'standing' ? this.pinR : this.segOffsets[2] + this.segR;
  }

  private circles(p: Pin): { x: number; y: number; r: number }[] {
    if (p.state === 'standing') return [{ x: p.x, y: p.y, r: this.pinR }];
    const cx = Math.cos(p.angle);
    const sy = Math.sin(p.angle);
    return this.segOffsets.map((o) => ({ x: p.x + cx * o, y: p.y + sy * o, r: this.segR }));
  }

  private collideBallPin(p: Pin): void {
    const b = this.ball;
    for (const c of this.circles(p)) {
      const dx = c.x - b.x;
      const dy = c.y - b.y;
      const d = Math.hypot(dx, dy);
      const min = this.ballR + c.r;
      if (d >= min || d === 0) continue;
      p.restT = 0;
      const ballRef: BodyRef = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, av: 0, invM: 1 / this.ballMass, invI: 0 };
      const pinRef = this.pinRef(p);
      const dv = resolve(
        ballRef,
        pinRef,
        c.x - (dx / d) * c.r,
        c.y - (dy / d) * c.r,
        dx / d,
        dy / d,
        min - d,
        TUNE.ballE,
      );
      b.x = ballRef.x;
      b.y = ballRef.y;
      b.vx = ballRef.vx;
      b.vy = ballRef.vy;
      this.applyRef(p, pinRef);
      if (dv > 20) {
        this.events.push({ type: 'ballPin', x: c.x, y: c.y, power: dv });
        this.contact = true;
      }
      if (this.powers.fire && dv > 20) this.ignite(p);
      this.afterHit(p, this.powers.fire ? dv * 3 : dv, dx / d, dy / d);
      if (this.powers.bomb && !this.bombUsed && dv > 20) this.explode(c.x, c.y);
      if (this.powers.blackhole && !this.holeUsed && dv > 20) this.openHole(c.x, c.y);
      if (this.powers.quake && !this.quakeUsed && dv > 20) this.startQuake();
      if (this.powers.snowball && dv > 20) this.growth = Math.min(SNOW_MAX, this.growth * SNOW_GROWTH);
      return;
    }
  }

  private collidePins(a: Pin, c: Pin): void {
    for (const ca of this.circles(a)) {
      for (const cc of this.circles(c)) {
        const dx = cc.x - ca.x;
        const dy = cc.y - ca.y;
        const d = Math.hypot(dx, dy);
        const min = ca.r + cc.r;
        if (d >= min || d === 0) continue;
        const nx = dx / d;
        const ny = dy / d;
        // A sleeping pin acts like a fixed obstacle unless it's hit hard enough to wake.
        const rel = Math.abs(a.vx - c.vx) + Math.abs(a.vy - c.vy) + (Math.abs(a.av) + Math.abs(c.av)) * 10;
        const aSleeps = this.asleep(a);
        const cSleeps = this.asleep(c);
        if (aSleeps && cSleeps) return;
        if (rel > WAKE_SPEED) {
          a.restT = 0;
          c.restT = 0;
        }
        const ra = this.pinRef(a);
        const rc = this.pinRef(c);
        if (aSleeps && rel <= WAKE_SPEED) ra.invM = ra.invI = 0;
        if (cSleeps && rel <= WAKE_SPEED) rc.invM = rc.invI = 0;
        if (ra.invM === 0 && rc.invM === 0) return;
        const dv = resolve(ra, rc, ca.x + nx * ca.r, ca.y + ny * ca.r, nx, ny, min - d, TUNE.pinE);
        const aWasStanding = a.state === 'standing';
        const cWasStanding = c.state === 'standing';
        this.applyRef(a, ra);
        this.applyRef(c, rc);
        if (dv > 25) this.events.push({ type: 'pinPin', x: ca.x + nx * ca.r, y: ca.y + ny * ca.r, power: dv });
        const fire = a.burning || c.burning;
        if (fire && dv > 4) {
          // Fire spreads, but each new flame burns a little shorter.
          const t = Math.max(a.burning ? a.burnT : 0, c.burning ? c.burnT : 0) * 0.8;
          if (!a.burning) this.ignite(a, t);
          if (!c.burning) this.ignite(c, t);
        }
        const boost = fire ? (this.layout.fireBoost ?? 7) : 1;
        if (aWasStanding) this.afterHit(a, dv * boost * (c.state === 'standing' ? 0.6 : 1), -nx, -ny);
        if (cWasStanding) this.afterHit(c, dv * boost * (a.state === 'standing' ? 0.6 : 1), nx, ny);
        return;
      }
    }
  }

  private pinRef(p: Pin): BodyRef {
    const standing = p.state === 'standing';
    return {
      x: p.x,
      y: p.y,
      vx: p.vx,
      vy: p.vy,
      av: p.av,
      invM: 1 / this.pinMass,
      invI: standing ? 0 : 1 / this.pinI,
    };
  }

  private applyRef(p: Pin, r: BodyRef): void {
    p.x = r.x;
    p.y = r.y;
    p.vx = r.vx;
    p.vy = r.vy;
    if (p.state === 'down') p.av = r.av;
  }

  private ignite(p: Pin, t = 0.7): void {
    if (t < 0.15) return;
    p.burning = true;
    p.burnT = t;
  }

  /** Per-substep effects of the active power-ups. */
  private stepPowers(h: number): void {
    const b = this.ball;

    // Magnet: pins that go down are drawn to the nearest pin still standing, and crash into it.
    if (this.powers.magnet && this.contact) {
      const reach = 130 * this.layout.pinScale;
      for (const p of this.pins) {
        if (p.state !== 'down' || p.restT > SLEEP_AFTER) continue;
        let best: Pin | null = null;
        let bestD = reach;
        for (const q of this.pins) {
          if (q.state !== 'standing') continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
        if (!best) continue;
        const pull = 1100 * (1 - bestD / reach) + 150;
        p.vx += ((best.x - p.x) / (bestD || 1)) * pull * h;
        p.vy += ((best.y - p.y) / (bestD || 1)) * pull * h;
      }
    }

    // Pin Laser: a beam along the ball's line that topples every pin it crosses.
    if (this.laserT >= 0) {
      this.laserT -= h;
      if (this.laserT < 0) {
        const t = (b.y - HEAD_Y) / Math.max(1, -b.vy);
        const x = b.x + b.vx * t;
        const width = this.ballR * 2.6;
        this.events.push({ type: 'laser', x, width });
        // Each pin in the beam is blown sideways, out of the beam and into its neighbours.
        for (const p of this.pins) {
          if (p.state !== 'standing' || Math.abs(p.x - x) > width) continue;
          const side = p.x >= x ? 1 : -1;
          p.vx = side * 800;
          p.vy = -120;
          this.afterHit(p, 9999, side, 0);
        }
      }
    }

    // Black Hole: everything nearby is dragged toward the impact point and swirls around it.
    if (this.hole) {
      const o = this.hole;
      o.t -= h;
      const reach = this.bombRadius * HOLE_REACH;
      const need = this.fallNeed;
      for (const p of this.pins) {
        if (p.state !== 'standing' && p.state !== 'down') continue;
        const dx = o.x - p.x;
        const dy = o.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > reach || d < 8) continue;
        const k = 1 - d / reach;
        const pull = 2600 * k;
        p.vx += ((dx / d) * pull - (dy / d) * pull * 0.6) * h;
        p.vy += ((dy / d) * pull + (dx / d) * pull * 0.6) * h;
        p.restT = 0;
        if (p.state === 'down') p.av += 14 * k * h;
        // Standing pins get torn off their spots, the nearer the likelier.
        else if (this.rand() < 5 * k * h) {
          p.vx = (dx / d) * 300;
          p.vy = (dy / d) * 300;
          this.afterHit(p, need * 2, dx / d, dy / d);
        }
      }
      if (o.t <= 0) this.hole = null;
    }

    // Earthquake: the deck shakes and standing pins topple at random.
    if (this.quakeT > 0) {
      this.quakeT -= h;
      const need = this.fallNeed;
      for (const p of this.pins) {
        if (p.state === 'standing') {
          p.wobble = Math.min(1, p.wobble + h * 3);
          if (this.rand() < QUAKE_RATE * h) {
            const a = this.rand() * Math.PI * 2;
            p.vx = Math.cos(a) * 160;
            p.vy = Math.sin(a) * 160;
            this.afterHit(p, need * 2, Math.cos(a), Math.sin(a));
          }
        } else if (p.state === 'down' && this.rand() < 4 * h) {
          p.vx += (this.rand() - 0.5) * 120;
          p.vy += (this.rand() - 0.5) * 120;
          p.restT = 0;
        }
      }
    }
  }

  private openHole(x: number, contactY: number): void {
    this.holeUsed = true;
    // The vortex opens in the middle of what's still standing, in line with the hit.
    const y = this.standingCentre()?.y ?? contactY - 40;
    this.hole = { x, y, t: HOLE_TIME };
    this.events.push({ type: 'hole', x, y });
    // The first pull is sharp enough to topple what's close.
    const reach = this.bombRadius * HOLE_REACH;
    for (const p of this.pins) {
      if (p.state !== 'standing') continue;
      const dx = x - p.x;
      const dy = y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > reach) continue;
      const dv = 200 + 700 * (1 - d / reach);
      p.vx = (dx / d) * dv;
      p.vy = (dy / d) * dv;
      this.afterHit(p, dv, dx / d, dy / d);
    }
  }

  private startQuake(): void {
    this.quakeUsed = true;
    this.quakeT = QUAKE_TIME;
    this.events.push({ type: 'quake' });
  }

  private explode(x: number, y: number): void {
    this.bombUsed = true;
    this.events.push({ type: 'bomb', x, y });
    for (const p of this.pins) {
      if (p.state !== 'standing' && p.state !== 'down') continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > this.bombRadius) continue;
      const dv = 140 + 760 * (1 - d / this.bombRadius);
      const nx = dx / d;
      const ny = dy / d;
      p.vx += nx * dv;
      p.vy += ny * dv;
      p.restT = 0;
      if (p.state === 'down') p.av += (this.rand() - 0.5) * 30;
      else this.afterHit(p, dv, nx, ny);
    }
  }

  /** Decides whether a standing pin that just got hit topples or just rocks. */
  private afterHit(p: Pin, dv: number, nx: number, ny: number): void {
    if (p.state !== 'standing') return;
    const need = this.fallNeed;
    if (dv > need * (0.85 + this.rand() * 0.3)) {
      p.state = 'down';
      p.downT = 0;
      this.events.push({ type: 'pinDown', id: p.id, kind: p.kind, x: p.x, y: p.y });
      if (this.powers.chain && this.zapsLeft > 0) {
        this.zapsLeft--;
        this.zaps.push({ x: p.x, y: p.y, t: 0.09 });
      }
      const speed = Math.hypot(p.vx, p.vy);
      // A little chaos so no two racks fall the same way.
      const jitter = (this.rand() - 0.5) * 0.5;
      const dir = Math.atan2(p.vy, p.vx) + jitter;
      p.vx = Math.cos(dir) * speed;
      p.vy = Math.sin(dir) * speed;
      p.angle = dir + (this.rand() < 0.5 ? 0 : Math.PI);
      p.av = (this.rand() - 0.5) * 10;
      p.wobble = 0;
    } else {
      // Resting contact (a pin lying against this one) shouldn't keep it rocking forever.
      if (dv > 12) p.wobble = Math.min(1, p.wobble + dv / need + 0.15);
      // Standing pins only scoot a little.
      p.vx = nx * Math.min(dv, 60) * 0.5;
      p.vy = ny * Math.min(dv, 60) * 0.5;
    }
  }
}

/**
 * Impulse resolution between two rigid bodies at contact point (px, py) with
 * normal n pointing from a to b. Returns the Δv applied to b.
 */
function resolve(
  a: BodyRef,
  b: BodyRef,
  px: number,
  py: number,
  nx: number,
  ny: number,
  depth: number,
  e: number,
): number {
  // Soft positional correction: resolve most of the overlap, leave a little slop,
  // so resting pins don't get shoved back and forth every step.
  const total = a.invM + b.invM;
  const corr = Math.max(0, depth - 0.4) * 0.6;
  a.x -= nx * corr * (a.invM / total);
  a.y -= ny * corr * (a.invM / total);
  b.x += nx * corr * (b.invM / total);
  b.y += ny * corr * (b.invM / total);

  const rax = px - a.x;
  const ray = py - a.y;
  const rbx = px - b.x;
  const rby = py - b.y;
  const vax = a.vx - a.av * ray;
  const vay = a.vy + a.av * rax;
  const vbx = b.vx - b.av * rby;
  const vby = b.vy + b.av * rbx;
  const vn = (vbx - vax) * nx + (vby - vay) * ny;
  if (vn >= 0) return 0;
  const raxn = rax * ny - ray * nx;
  const rbxn = rbx * ny - rby * nx;
  const k = a.invM + b.invM + raxn * raxn * a.invI + rbxn * rbxn * b.invI;
  const j = (-(1 + e) * vn) / k;
  a.vx -= j * nx * a.invM;
  a.vy -= j * ny * a.invM;
  a.av -= raxn * j * a.invI;
  b.vx += j * nx * b.invM;
  b.vy += j * ny * b.invM;
  b.av += rbxn * j * b.invI;
  return j * b.invM;
}
