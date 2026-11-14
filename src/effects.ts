// Short-lived particle effects drawn over the lane: sparks, flames, confetti, bomb rings, chain
// lightning and Pin Laser beams. The scene spawns them from sim events, steps them once a frame and
// draws them in world space from `onPostDraw` (after it has applied the camera).
import * as ex from 'excalibur';
import { NEON } from './art.ts';
import { PIT_Y, WALL_X } from './constants.ts';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: ex.Color;
}

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: ex.Color;
  life: number;
}

interface Point {
  x: number;
  y: number;
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const hex = (c: string[]) => c.map((h) => ex.Color.fromHex(h));
const CONFETTI_COLORS = hex([NEON.pink, NEON.cyan, NEON.amber, NEON.violet, '#ffffff', '#7dff9b']);
const NEON_SPARK = hex([NEON.cyan, NEON.pink]);
const WOOD_SPARK = hex(['#ffe7b0', '#ffffff']);
const PIN_FLAME = hex(['#ff7a2b', '#ffd166']);
const BALL_FLAME = hex(['#ff5a1f', '#ffc84a']);

const ZAP_LIFE = 0.35;
const LASER_LIFE = 0.6;
const RING_LIFE = 0.5;

export class Effects {
  private sparks: Spark[] = [];
  private flames: Spark[] = [];
  private confetti: Confetto[] = [];
  private rings: { x: number; y: number; radius: number; t: number }[] = [];
  private zaps: { pts: Point[]; t: number }[] = [];
  private lasers: { x: number; width: number; fromY: number; t: number }[] = [];

  clear(): void {
    this.sparks = [];
    this.flames = [];
    this.confetti = [];
    this.rings = [];
    this.zaps = [];
    this.lasers = [];
  }

  /** Confetti raining down from `top` (world y of the top of the view). */
  burstConfetti(n: number, top: number): void {
    for (let i = 0; i < n; i++) {
      this.confetti.push({
        x: rand(-WALL_X - 60, WALL_X + 60),
        y: top - rand(0, 260),
        vx: rand(-90, 90),
        vy: rand(220, 520),
        rot: rand(0, Math.PI * 2),
        vr: rand(-10, 10),
        w: rand(6, 13),
        h: rand(3, 6),
        color: pick(CONFETTI_COLORS),
        life: rand(2.4, 3.4),
      });
    }
  }

  /** A burst of sparks from an impact; `wood` gives pale wood chips instead of neon. */
  spawnSparks(x: number, y: number, power: number, wood: boolean): void {
    const n = Math.min(22, Math.floor(power / 45));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(80, 260) * Math.min(2.2, power / 300);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0,
        max: rand(0.18, 0.45),
        size: rand(1.5, 3.6),
        color: pick(wood ? WOOD_SPARK : NEON_SPARK),
      });
    }
  }

  /** One flame licking up off a burning pin. */
  pinFlame(x: number, y: number): void {
    this.flames.push({
      x: x + rand(-20, 20),
      y: y + rand(-14, 14),
      vx: rand(-20, 20),
      vy: rand(-60, -20),
      life: 0,
      max: rand(0.25, 0.5),
      size: rand(3, 7),
      color: pick(PIN_FLAME),
    });
  }

  /** One flame trailing behind a Fireball. */
  ballFlame(x: number, y: number): void {
    this.flames.push({
      x: x + rand(-18, 18),
      y: y + rand(0, 30),
      vx: rand(-30, 30),
      vy: rand(40, 120),
      life: 0,
      max: rand(0.2, 0.45),
      size: rand(4, 9),
      color: pick(BALL_FLAME),
    });
  }

  /** The Bomb's shock ring, growing out to `radius`. */
  ring(x: number, y: number, radius: number): void {
    this.rings.push({ x, y, radius, t: 0 });
  }

  /** A jagged Chain Lightning bolt between two pins. */
  zap(x1: number, y1: number, x2: number, y2: number): void {
    const pts = [{ x: x1, y: y1 }];
    for (let k = 1; k < 7; k++) {
      const t = k / 7;
      pts.push({ x: x1 + (x2 - x1) * t + rand(-14, 14), y: y1 + (y2 - y1) * t + rand(-14, 14) });
    }
    pts.push({ x: x2, y: y2 });
    this.zaps.push({ pts, t: 0 });
  }

  /** The Pin Laser's beam from the ball (at `fromY`) to the pit. */
  laser(x: number, width: number, fromY: number): void {
    this.lasers.push({ x, width, fromY, t: 0 });
  }

  /**
   * `timeScale` is the slow-motion factor; `simDt` is zero during hit-stop, when sparks hang in the
   * air and age only slowly.
   */
  update(dt: number, timeScale: number, simDt: number): void {
    for (const s of this.sparks) {
      s.life += simDt || dt * 0.2;
      s.x += s.vx * dt * timeScale;
      s.y += s.vy * dt * timeScale;
      s.vx *= Math.exp(-4 * dt);
      s.vy *= Math.exp(-4 * dt);
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    for (const f of this.flames) {
      f.life += dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flames = this.flames.filter((f) => f.life < f.max);
    for (const z of this.zaps) z.t += dt;
    this.zaps = this.zaps.filter((z) => z.t < ZAP_LIFE);
    for (const l of this.lasers) l.t += dt;
    this.lasers = this.lasers.filter((l) => l.t < LASER_LIFE);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < RING_LIFE);
    for (const c of this.confetti) {
      c.life -= dt;
      c.vy += 60 * dt;
      c.vx += Math.sin(c.rot * 0.7) * 40 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0);
  }

  /** Bomb rings and flames: drawn beneath the power-up auras. */
  drawBelow(ctx: ex.ExcaliburGraphicsContext): void {
    for (const r of this.rings) {
      const k = r.t / RING_LIFE;
      ctx.drawCircle(ex.vec(r.x, r.y), r.radius * (0.3 + 0.9 * k), ex.Color.fromRGB(255, 160, 60, 0.45 * (1 - k)), ex.Color.fromRGB(255, 240, 200, 1 - k), 6);
    }
    for (const f of this.flames) {
      const c = f.color.clone();
      c.a = 0.9 * (1 - f.life / f.max);
      ctx.drawCircle(ex.vec(f.x, f.y), f.size * (1 - (f.life / f.max) * 0.5), c);
    }
  }

  /** Laser beams, lightning, sparks and confetti: drawn over everything else. */
  drawAbove(ctx: ex.ExcaliburGraphicsContext): void {
    for (const l of this.lasers) {
      const a = 1 - l.t / LASER_LIFE;
      const top = PIT_Y - 60;
      const len = l.fromY - top;
      ctx.drawRectangle(ex.vec(l.x - l.width, top), l.width * 2, len, ex.Color.fromRGB(255, 59, 59, 0.22 * a));
      ctx.drawRectangle(ex.vec(l.x - l.width * 0.25, top), l.width * 0.5, len, ex.Color.fromRGB(255, 220, 220, 0.85 * a));
    }

    for (const z of this.zaps) {
      const a = 1 - z.t / ZAP_LIFE;
      for (let i = 1; i < z.pts.length; i++) {
        const p0 = ex.vec(z.pts[i - 1].x, z.pts[i - 1].y);
        const p1 = ex.vec(z.pts[i].x, z.pts[i].y);
        ctx.drawLine(p0, p1, ex.Color.fromRGB(56, 243, 255, 0.35 * a), 10);
        ctx.drawLine(p0, p1, ex.Color.fromRGB(255, 255, 255, a), 3);
      }
    }

    for (const s of this.sparks) {
      const c = s.color.clone();
      c.a = 1 - s.life / s.max;
      ctx.drawCircle(ex.vec(s.x, s.y), s.size, c);
    }

    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      const col = c.color.clone();
      col.a = Math.min(1, c.life / 0.6);
      const squash = Math.abs(Math.cos(c.rot * 1.7));
      ctx.drawRectangle(ex.vec(-c.w / 2, (-c.h / 2) * squash), c.w, c.h * squash + 0.5, col);
      ctx.restore();
    }
  }
}
