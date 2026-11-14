// Synthetic phone swings for testing src/swing.ts without a phone.
//
// Real kinematics: an arm of length L hangs from the shoulder and swings back, then forward, while
// the forearm twists (hook) and the arm strays sideways (launch angle). The phone sits in the hand
// at an arbitrary grip. Samples are what a W3C `devicemotion` event would report: specific force
// (accelerationIncludingGravity) and body rotation rates in deg/s, in the phone's own frame.
//
// World frame: x to the bowler's right, y forward down the lane, z up.
import type { MotionSample } from '../../src/swing.ts';

type V3 = [number, number, number];
type Q = [number, number, number, number];

const DEG = Math.PI / 180;

const qmul = (a: Q, b: Q): Q => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const conj = (q: Q): Q => [q[0], -q[1], -q[2], -q[3]];
function axisAngle(axis: V3, rad: number): Q {
  const n = Math.hypot(...axis);
  const s = Math.sin(rad / 2) / n;
  return [Math.cos(rad / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}
function rot(q: Q, v: V3): V3 {
  const r = qmul(qmul(q, [0, v[0], v[1], v[2]]), conj(q));
  return [r[1], r[2], r[3]];
}
/** Rotation vector (radians) of a unit quaternion. */
function qlog(q: Q): V3 {
  const w = Math.max(-1, Math.min(1, q[0]));
  const s = Math.hypot(q[1], q[2], q[3]);
  if (s < 1e-12) return [2 * q[1], 2 * q[2], 2 * q[3]];
  const th = 2 * Math.atan2(s, w);
  return [(q[1] / s) * th, (q[2] / s) * th, (q[3] / s) * th];
}

export { seeded as rng } from './helpers.ts';
import { seeded as rng } from './helpers.ts';

/** A uniformly random grip (phone orientation in the hand). */
export function randomGrip(r: () => number): Q {
  const [u1, u2, u3] = [r(), r(), r()];
  return [
    Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2),
    Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2),
    Math.sqrt(u1) * Math.sin(2 * Math.PI * u3),
    Math.sqrt(u1) * Math.cos(2 * Math.PI * u3),
  ];
}

export interface SwingSpec {
  /** Backswing height and forward swing end, degrees from hanging. */
  back?: number;
  fwd?: number;
  /** Duration of the forward swing, seconds (shorter is faster). */
  fwdTime?: number;
  /** Forearm twist during the forward swing, degrees (positive: anticlockwise seen from the shoulder). */
  twist?: number;
  /** Sideways stray during the forward swing, degrees (positive: hand goes right). */
  side?: number;
  /** Swing angle (degrees, past hanging) at which the thumb lifts. */
  releaseAt?: number;
  /** Extra time after reaching `releaseAt` before the thumb lifts, seconds. */
  holdAfter?: number;
  /** Phone orientation in the hand (body → hand frame). */
  grip?: Q;
  hz?: number;
  /** Noise standard deviations: gyro deg/s, accelerometer m/s². */
  gyroNoise?: number;
  accNoise?: number;
  seed?: number;
  armLength?: number;
}

export interface SynthSwing {
  samples: MotionSample[];
  /** When the thumb lifts, seconds. */
  release: number;
  /** Analytic peak swing rate, deg/s. */
  peak: number;
}

const ease = (x: number) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, x)))) / 2;

export function synthSwing(spec: SwingSpec = {}): SynthSwing {
  const back = spec.back ?? 60;
  const fwd = spec.fwd ?? 60;
  const fwdTime = spec.fwdTime ?? 0.4;
  const twist = spec.twist ?? 0;
  const side = spec.side ?? 0;
  const releaseAt = spec.releaseAt ?? 10;
  const grip = spec.grip ?? [1, 0, 0, 0];
  const hz = spec.hz ?? 60;
  const L = spec.armLength ?? 0.65;
  const r = rng(spec.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

  const t0 = 0.3; // thumb down, phone still
  const tb = 0.5; // backswing
  const tp = 0.08; // pause at the top
  const tf = t0 + tb + tp; // forward swing starts
  const swingAngle = (t: number) => {
    if (t >= t0 && t < t0 + tb) return -back * ease((t - t0) / tb);
    if (t >= t0 + tb && t < tf) return -back;
    if (t >= tf) return -back + (back + fwd) * ease((t - tf) / fwdTime);
    return 0;
  };
  // Release: the first moment the forward swing passes `releaseAt`.
  let letGo = tf + fwdTime;
  for (let t = tf; t <= tf + fwdTime; t += 0.001) {
    if (swingAngle(t) >= releaseAt) {
      letGo = t;
      break;
    }
  }
  // Twist and stray happen during the forward swing and are complete by the release.
  const angles = (t: number) => {
    const x = (t - tf) / (letGo - tf);
    return { theta: swingAngle(t), psi: twist * ease(x), phi: side * ease(x) };
  };
  const attitude = (t: number): Q => {
    const { theta, psi, phi } = angles(t);
    const sideQ = axisAngle([0, -1, 0], phi * DEG);
    const swingQ = axisAngle([1, 0, 0], theta * DEG);
    const twistQ = axisAngle([0, 0, 1], psi * DEG);
    return qmul(qmul(qmul(sideQ, swingQ), twistQ), grip);
  };
  const hand = (t: number): V3 => {
    const { theta, phi } = angles(t);
    return rot(qmul(axisAngle([0, -1, 0], phi * DEG), axisAngle([1, 0, 0], theta * DEG)), [0, 0, -L]);
  };

  const release = letGo + (spec.holdAfter ?? 0);

  const h = 1e-3;
  const samples: MotionSample[] = [];
  for (let t = 0; t <= release + 1e-9; t += 1 / hz) {
    const q = attitude(t);
    // Body rates from the attitude change over a short step.
    const w = qlog(qmul(conj(attitude(t - h / 2)), attitude(t + h / 2))).map((v) => v / h / DEG);
    const p0 = hand(t - h);
    const p1 = hand(t);
    const p2 = hand(t + h);
    const acc: V3 = [0, 1, 2].map((i) => (p2[i] - 2 * p1[i] + p0[i]) / (h * h)) as V3;
    acc[2] += 9.81; // specific force: a phone at rest reads +g pointing up
    const a = rot(conj(q), acc);
    const gn = spec.gyroNoise ?? 0;
    const an = spec.accNoise ?? 0;
    samples.push({
      t,
      ax: a[0] + an * gauss(),
      ay: a[1] + an * gauss(),
      az: a[2] + an * gauss(),
      rx: w[0] + gn * gauss(),
      ry: w[1] + gn * gauss(),
      rz: w[2] + gn * gauss(),
    });
  }
  return { samples, release, peak: ((back + fwd) * Math.PI) / (2 * fwdTime) };
}

/** The phone held still (or slowly tilted) with the thumb down: never a throw. */
export function synthStill(seconds: number, tiltDeg = 0, spec: SwingSpec = {}): SynthSwing {
  const hz = spec.hz ?? 60;
  const r = rng(spec.seed ?? 2);
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
  const gn = spec.gyroNoise ?? 0;
  const grip = spec.grip ?? [1, 0, 0, 0];
  const rateDeg = tiltDeg / seconds;
  const samples: MotionSample[] = [];
  for (let t = 0; t <= seconds; t += 1 / hz) {
    const q = qmul(axisAngle([1, 0, 0], rateDeg * t * DEG), grip);
    const a = rot(conj(q), [0, 0, 9.81]);
    const w = rot(conj(grip), [rateDeg, 0, 0]);
    samples.push({ t, ax: a[0], ay: a[1], az: a[2], rx: w[0] + gn * gauss(), ry: w[1] + gn * gauss(), rz: w[2] + gn * gauss() });
  }
  return { samples, release: seconds, peak: rateDeg };
}
