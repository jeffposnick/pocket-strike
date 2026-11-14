// The flick: turning a stroke into a throw. Used for a finger on the screen and for a controller's
// stick, so both feel the same. Pure TypeScript with no DOM or Excalibur code, so
// tools/sim/flick.test.ts can run it in Node.
import { MAX_SPEED, MIN_SPEED } from './constants.ts';

export interface StrokePoint {
  /** World px; y grows down the screen, so a flick toward the pins has falling y. */
  x: number;
  y: number;
  /** Seconds. */
  t: number;
}

export interface Throw {
  speed: number;
  angle: number;
  spin: number;
}

/**
 * A stroke from its lowest point to its release. Speed comes from the velocity over the last
 * ~110 ms; the launch line from the stroke as a whole (start to end), so curving doesn't also
 * steer; hook from how much the stroke bends away from that line. `null` when the stroke was too
 * gentle to be a throw. `hookBend` is the bend, as a fraction of the stroke's length, for full hook.
 */
export function flickThrow(stroke: readonly StrokePoint[], hookBend = 0.16): Throw | null {
  if (stroke.length < 2) return null;
  const end = stroke[stroke.length - 1];
  let k = stroke.length - 1;
  while (k > 0 && end.t - stroke[k - 1].t < 0.11) k--;
  const first = stroke[k];
  const dt = Math.max(0.016, end.t - first.t);
  const vy = (end.y - first.y) / dt;
  if (vy > -380) return null;

  const power = Math.max(0, Math.min(1, (-vy - 380) / 2600));
  const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
  const s0 = stroke[0];
  const cx = end.x - s0.x;
  const cy = end.y - s0.y;
  const angle = Math.max(-0.06, Math.min(0.06, Math.atan2(cx, -cy) * 0.3));
  const len = Math.hypot(cx, cy) || 1;
  let dev = 0;
  for (const p of stroke) {
    const d = (cx * (p.y - s0.y) - cy * (p.x - s0.x)) / len;
    if (Math.abs(d) > Math.abs(dev)) dev = d;
  }
  let spin = Math.max(-1, Math.min(1, -dev / (len * hookBend)));
  if (Math.abs(spin) < 0.1) spin = 0;
  return { speed, angle, spin };
}

/** Tuning for the controller stick. */
export const STICK = {
  /** Readings inside this radius count as centred. */
  dead: 0.15,
  /** Pulling back past this starts a swing (stick y is positive when pulled down/back). */
  back: 0.5,
  /** Pushing forward past this throws. */
  forward: -0.8,
  /** World px per unit of stick travel, so a stick flick lands in the touch flick's speed range. */
  scale: 55,
  /** Sticks curve naturally under a thumb, so a stick needs more bend than a finger for full hook. */
  hookBend: 0.3,
  /** A swing abandoned at the centre for this long is cancelled, seconds. */
  cancelAfter: 0.35,
};

export interface StickResult {
  /** Sideways lining-up input, -1..1, while the stick isn't swinging. */
  aim: number;
  /** A swing is under way: the ball should stay put. */
  swinging: boolean;
  /** Set on the frame the stick reaches the front: the throw, or `null` if it was too slow. */
  thrown?: Throw | null;
}

/**
 * One analog stick as a bowling arm: pull it back, then push it forward to bowl. Sideways while
 * idle lines the ball up. After a throw the stick must return to the centre before the next one.
 */
export class StickSwing {
  private state: 'idle' | 'back' | 'done' = 'idle';
  private stroke: StrokePoint[] = [];
  private lowest = 0;
  private centredSince = -1;

  feed(t: number, rawX: number, rawY: number): StickResult {
    const r = Math.hypot(rawX, rawY);
    // Radial dead zone, rescaled so output still starts at 0 just outside it.
    const k = r < STICK.dead ? 0 : (r - STICK.dead) / (1 - STICK.dead) / r;
    const x = rawX * k;
    const y = rawY * k;

    if (this.state === 'done') {
      if (r < 0.3) this.state = 'idle';
      return { aim: 0, swinging: false };
    }
    if (this.state === 'idle') {
      if (rawY > STICK.back) {
        this.state = 'back';
        this.stroke = [{ x: x * STICK.scale, y: y * STICK.scale, t }];
        this.lowest = 0;
        this.centredSince = -1;
        return { aim: 0, swinging: true };
      }
      return { aim: Math.abs(rawY) < STICK.back ? x : 0, swinging: false };
    }

    // Pulled back: follow the stroke until the stick reaches the front.
    const p = { x: x * STICK.scale, y: y * STICK.scale, t };
    this.stroke.push(p);
    if (p.y >= this.stroke[this.lowest].y) this.lowest = this.stroke.length - 1;
    if (rawY <= STICK.forward) {
      this.state = 'done';
      return { aim: 0, swinging: false, thrown: flickThrow(this.stroke.slice(this.lowest), STICK.hookBend) };
    }
    if (r < STICK.dead) {
      if (this.centredSince < 0) this.centredSince = t;
      else if (t - this.centredSince > STICK.cancelAfter) this.state = 'idle';
    } else {
      this.centredSince = -1;
    }
    return { aim: 0, swinging: this.state === 'back' };
  }
}
