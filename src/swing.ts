// Swing detection for "swing the phone to bowl". Pure TypeScript with no DOM or Excalibur code, so
// tools/sim/swing.test.ts can run it in Node against synthetic swings.
//
// The phone is held in the bowling hand and swung like a ball. The phone's grip is unknown (screen
// forward, sideways, tilted), so nothing assumes a fixed axis:
//
//   1. The gyroscope is integrated into an orientation track, so every rotation rate can be expressed
//      in one fixed (inertial) frame: the phone's attitude at the fastest moment of the swing.
//   2. The arm's direction in the phone's own frame comes from the accelerometer at the bottom of the
//      swing, where gravity and the swing's centripetal pull both point along the arm.
//   3. Rotation about the arm is wrist/forearm twist (hook). The rest is the arm swinging; its main
//      rotation axis is found from the data, and the last stroke before release is the delivery.
//   4. Speed comes from the stroke's peak rate, hook from the twist during it, launch angle from how
//      far the stroke strays sideways.

/** One `devicemotion` reading, in the phone's frame (W3C: x right, y up the screen, z out of the screen). */
export interface MotionSample {
  /** Seconds. */
  t: number;
  /** `accelerationIncludingGravity` in m/s² (a phone lying face up reads z ≈ +9.8). */
  ax: number;
  ay: number;
  az: number;
  /** `rotationRate` in deg/s about x (`beta`), y (`gamma`) and z (`alpha`). */
  rx: number;
  ry: number;
  rz: number;
}

export interface SwingThrow {
  /** 0..1, mapped onto the game's speed range like the touch flick's power. */
  power: number;
  /** Launch angle in radians, clamped like the touch flick's. */
  angle: number;
  /** Hook, -1..1. Negative hooks left, as for the touch flick. */
  spin: number;
  /** Diagnostics for tuning (degrees and deg/s). */
  peak: number;
  arc: number;
  twist: number;
  side: number;
}

/** Tuning numbers. The defaults are first estimates; tune them on real phones with `?swingdebug`. */
export const SWING = {
  /** How far back from the release the detector looks, seconds. */
  window: 1.6,
  /** The delivery stroke must have been under way within this long before the release, seconds. */
  maxHold: 0.5,
  /** A stroke is the run of samples swinging faster than this, deg/s. */
  strokeFloor: 40,
  /** Slowest peak that still counts as a throw, deg/s. Anything slower is a wobble, not a swing. */
  minPeak: 140,
  /** Smallest arc that counts as a throw, degrees. */
  minArc: 35,
  /** Peak swing rate for the slowest and fastest ball, deg/s. */
  powerLo: 180,
  powerHi: 650,
  /** Wrist twist during the stroke for full hook, degrees. */
  twistFull: 90,
  /** Hook below this is played straight, as with the touch flick's dead zone. */
  spinDead: 0.12,
  /** Same scaling and clamp as the touch flick's launch angle. */
  angleGain: 0.3,
  maxAngle: 0.06,
  /** Rotation faster than this means the phone is mid-swing, deg/s (used to freeze aiming). */
  movingRate: 90,
};

type V3 = [number, number, number];
/** Quaternion [w, x, y, z]. */
type Q = [number, number, number, number];

const DEG = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / (norm(a) || 1));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function qmul(a: Q, b: Q): Q {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

/** Quaternion for a rotation vector (axis × angle, radians). */
function qexp(v: V3): Q {
  const th = norm(v);
  if (th < 1e-9) return [1, v[0] / 2, v[1] / 2, v[2] / 2];
  const s = Math.sin(th / 2) / th;
  return [Math.cos(th / 2), v[0] * s, v[1] * s, v[2] * s];
}

/** Rotates v by q (q v q*). */
function qrot(q: Q, v: V3): V3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

const rate = (s: MotionSample): V3 => [s.rx, s.ry, s.rz];
const accel = (s: MotionSample): V3 => [s.ax, s.ay, s.az];

/** Unit vector along the largest spread of `vs` (power iteration on Σ v vᵀ). */
function principalAxis(vs: V3[]): V3 {
  let best = vs[0];
  for (const v of vs) if (norm(v) > norm(best)) best = v;
  let u = unit(best);
  for (let it = 0; it < 30; it++) {
    let acc: V3 = [0, 0, 0];
    for (const v of vs) acc = [acc[0] + v[0] * dot(v, u), acc[1] + v[1] * dot(v, u), acc[2] + v[2] * dot(v, u)];
    if (norm(acc) < 1e-9) break;
    u = unit(acc);
  }
  return u;
}

/** True while the phone is turning fast, i.e. the player is mid-swing. */
export function isSwinging(samples: readonly MotionSample[], now: number): boolean {
  for (let i = samples.length - 1; i >= 0 && now - samples[i].t < 0.1; i--) {
    if (norm(rate(samples[i])) > SWING.movingRate) return true;
  }
  return false;
}

/**
 * Turns the motion recorded up to the moment the thumb lifted into a throw, or `null` when there was
 * no real swing (the player only repositioned, or wobbled the phone).
 */
export function detectSwing(all: readonly MotionSample[], releaseT: number): SwingThrow | null {
  const s = all.filter((p) => p.t >= releaseT - SWING.window && p.t <= releaseT + 0.03);
  const n = s.length;
  if (n < 5) return null;

  // Reference moment: the fastest turn shortly before the release (usually the delivery's bottom).
  let k = -1;
  for (let i = 0; i < n; i++) {
    if (s[i].t < releaseT - 0.6) continue;
    if (k < 0 || norm(rate(s[i])) > norm(rate(s[k]))) k = i;
  }
  if (k < 0 || norm(rate(s[k])) < SWING.minPeak) return null;

  // Orientation track: q[i] maps phone-frame vectors at sample i into the phone frame at sample k.
  const q: Q[] = new Array(n);
  q[k] = [1, 0, 0, 0];
  for (let i = k + 1; i < n; i++) {
    const w = scale(rate(s[i - 1]).map((v, j) => (v + rate(s[i])[j]) / 2) as V3, DEG * (s[i].t - s[i - 1].t));
    q[i] = qmul(q[i - 1], qexp(w));
  }
  for (let i = k - 1; i >= 0; i--) {
    const w = scale(rate(s[i]).map((v, j) => (v + rate(s[i + 1])[j]) / 2) as V3, -DEG * (s[i + 1].t - s[i].t));
    q[i] = qmul(q[i + 1], qexp(w));
  }

  // The arm's direction in the phone frame. At the fastest point of a stroke the hand is neither
  // speeding up nor slowing down, so the specific force is the centripetal pull plus gravity's
  // reaction, both pointing (near enough) from the hand to the shoulder. The direction is fixed in the
  // phone frame while the wrist twists. First guess: the fastest turn overall. Then the delivery's own
  // peak, interpolated between samples (just off the peak, the hand's tangential acceleration tilts it).
  const accelAt = (t: number): V3 => {
    let i = 0;
    while (i < n - 2 && s[i + 1].t <= t) i++;
    const f = clamp((t - s[i].t) / (s[i + 1].t - s[i].t || 1), 0, 1);
    return sub(accel(s[i]), scale(sub(accel(s[i]), accel(s[i + 1])), f));
  };
  let m = measure(unit(accel(s[k])));
  if (m) m = measure(unit(accelAt(m.tPeak)));
  if (m) m = measure(unit(accelAt(m.tPeak)));
  if (!m) return null;
  const { peak, arc, twist, sideArc } = m;
  if (peak < SWING.minPeak || arc < SWING.minArc) return null;

  function measure(arm: V3) {
    // Rates and the arm's direction, in the fixed frame.
    const w = s.map((p, i) => qrot(q[i], rate(p)));
    const armRef = q.map((qi) => qrot(qi, arm));
    // The swing alone: rates with the twist about the arm removed.
    const swing = w.map((v, i) => sub(v, scale(armRef[i], dot(v, armRef[i]))));

    // The swing's main axis, then the last stroke before the release is the delivery.
    const u0 = principalAxis(swing);
    let end = -1;
    for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(dot(swing[i], u0)) >= SWING.minPeak) {
        end = i;
        break;
      }
    }
    if (end < 0) return null;
    const fwd = dot(swing[end], u0) < 0 ? scale(u0, -1) : u0;
    const stroke = (u: V3) => {
      const proj = swing.map((v) => dot(v, u));
      let i0 = end;
      while (i0 > 0 && proj[i0 - 1] > SWING.strokeFloor) i0--;
      let i1 = end;
      while (i1 < n - 1 && proj[i1 + 1] > SWING.strokeFloor) i1++;
      return { proj, i0, i1 };
    };
    let { proj, i0, i1 } = stroke(fwd);

    // The delivery is measured against the backswing's plane, so pulling the arm across the body
    // reads as a launch angle. (Fitting the delivery alone would fold any stray into its own axis.)
    // Without a backswing, the delivery's own axis is used and the launch is straight.
    let u = fwd;
    let b1 = i0 - 1;
    while (b1 >= 0 && proj[b1] > -SWING.strokeFloor && s[i0].t - s[b1].t < 0.4) b1--;
    if (b1 >= 0 && proj[b1] <= -SWING.strokeFloor) {
      let b0 = b1;
      while (b0 > 0 && proj[b0 - 1] <= -SWING.strokeFloor) b0--;
      let backArc = 0;
      for (let i = b0; i < b1; i++) backArc -= ((proj[i] + proj[i + 1]) / 2) * (s[i + 1].t - s[i].t);
      if (backArc >= 20) {
        const ub = principalAxis(swing.slice(b0, b1 + 1));
        u = dot(ub, fwd) < 0 ? scale(ub, -1) : ub;
        ({ proj, i0, i1 } = stroke(u));
      }
    }
    if (releaseT - s[i1].t > SWING.maxHold) return null;

    let j = i0;
    for (let i = i0; i <= i1; i++) if (proj[i] > proj[j]) j = i;
    // Time of the peak, from a parabola through the samples around it.
    let tPeak = s[j].t;
    if (j > 0 && j < n - 1) {
      const [y0, y1, y2] = [proj[j - 1], proj[j], proj[j + 1]];
      const den = y0 - 2 * y1 + y2;
      const off = den < 0 ? clamp((0.5 * (y0 - y2)) / den, -1, 1) : 0;
      tPeak = off < 0 ? s[j].t + off * (s[j].t - s[j - 1].t) : s[j].t + off * (s[j + 1].t - s[j].t);
    }

    // At the peak: the arm (projected square to the swing axis) and the sideways axis.
    // Positive rotation about the sideways axis carries the hand to the right.
    const armP = unit(sub(armRef[j], scale(u, dot(armRef[j], u))));
    const side = cross(u, armP);
    // Away from the peak the arm leans along the sideways axis, so a twist about it and a sideways
    // stray share that direction. Solve for both: w⊥ = stray·side + twistRate·arm(t).
    const parts = w.map((v, i) => {
      const cosA = dot(armRef[i], armP);
      const sinA = dot(armRef[i], side);
      const tw = Math.abs(cosA) > 0.3 ? dot(v, armP) / cosA : dot(v, armRef[i]);
      return { swing: dot(v, u), twist: tw, side: dot(v, side) - tw * sinA };
    });

    let arc = 0;
    let twist = 0;
    let sideArc = 0;
    for (let i = i0; i < i1; i++) {
      const dt = s[i + 1].t - s[i].t;
      arc += ((parts[i].swing + parts[i + 1].swing) / 2) * dt;
      twist += ((parts[i].twist + parts[i + 1].twist) / 2) * dt;
      sideArc += ((parts[i].side + parts[i + 1].side) / 2) * dt;
    }
    return { tPeak, peak: proj[j], arc, twist, sideArc };
  }

  const power = clamp((peak - SWING.powerLo) / (SWING.powerHi - SWING.powerLo), 0, 1);
  // Twisting anticlockwise about the arm (seen from the shoulder) is a right-hander's hook: left.
  let spin = clamp(-twist / SWING.twistFull, -1, 1);
  if (Math.abs(spin) < SWING.spinDead) spin = 0;
  const angle = clamp(Math.atan2(sideArc, arc) * SWING.angleGain, -SWING.maxAngle, SWING.maxAngle);
  return { power, angle, spin, peak, arc, twist, side: sideArc };
}
