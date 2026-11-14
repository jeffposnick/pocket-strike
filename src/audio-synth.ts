// Sound synthesis for src/audio.ts. Pure TypeScript with no DOM or Web Audio code: it runs in a
// Web Worker (src/audio-worker.ts) so rendering never stalls the game, and in Node for
// tools/sim/audio.test.ts.
//
// Physical sounds (pins, ball, lane, pinsetter) are decaying resonant modes plus filtered noise.
// Musical cues are FM bells and marimba bars. Every sound is rendered once, as raw samples.

const TAU = Math.PI * 2;

/** Notes used by the musical cues (equal temperament, A4 = 440 Hz). */
export const NOTE = {
  G4: 392,
  A4: 440,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  B5: 987.77,
  D6: 1174.66,
  E6: 1318.51,
  G6: 1567.98,
  B6: 1975.53,
  E7: 2637.02,
} as const;

/** Every note a cue plays, so they can all be rendered up front. */
export const BELLS = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.B5, NOTE.D6, NOTE.G6, NOTE.B6, NOTE.E6, NOTE.E7];
export const MARIMBAS = [NOTE.E5, NOTE.C5, NOTE.A4];

/** Rendered samples, mono unless noted. Lists hold variations of the same sound. */
export interface Bank {
  pin: Float32Array[];
  heavy: Float32Array[];
  crash: Float32Array[];
  panel: Float32Array[];
  thud: Float32Array[];
  gutter: Float32Array;
  roll: Float32Array;
  release: Float32Array;
  sweep: Float32Array;
  tick: Float32Array;
  zap: Float32Array[];
  boom: Float32Array;
  pad: Float32Array;
  /** Stereo room impulse response for the reverb: [left, right]. */
  room: Float32Array[];
  /** Keyed by frequency. */
  bell: Record<number, Float32Array>;
  marimba: Record<number, Float32Array>;
}

/** A decaying sine: [frequency Hz, amplitude, decay time constant s]. */
type Mode = [number, number, number];

let random = Math.random;
const rnd = (a: number, b: number) => a + random() * (b - a);
const noise = () => random() * 2 - 1;

/** Renders mono samples (`fn` may keep state between calls), peak-normalized. */
function render(sr: number, seconds: number, fn: (t: number) => number, peak = 0.9): Float32Array {
  const n = Math.ceil(seconds * sr);
  const d = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const v = fn(i / sr);
    d[i] = v;
    max = Math.max(max, Math.abs(v));
  }
  // Normalize, and fade the last 10 ms so nothing ends in a click.
  const k = max > 0 ? peak / max : 0;
  const fade = Math.min(n, Math.round(sr * 0.01));
  for (let i = 0; i < n; i++) d[i] *= k * Math.min(1, (n - i) / fade);
  return d;
}

/** One-pole low-pass filter with a fixed cutoff. */
function lowpass(cut: number, sr: number): (x: number) => number {
  const a = 1 - Math.exp((-TAU * cut) / sr);
  let y = 0;
  return (x) => (y += a * (x - y));
}

/** One-pole high-pass filter with a fixed cutoff. */
function highpass(cut: number, sr: number): (x: number) => number {
  const lp = lowpass(cut, sr);
  return (x) => x - lp(x);
}

/** Sum of decaying sines, with a short attack so the onset doesn't click. */
function modes(list: Mode[], t: number, phases: number[], attack = 0.0006): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) {
    const [f, a, d] = list[i];
    s += a * Math.exp(-t / d) * Math.sin(TAU * f * t + phases[i]);
  }
  return s * Math.min(1, t / attack);
}

const phasesFor = (m: Mode[]) => m.map(() => random() * TAU);

/** A maple pin: free-bar modes (1 : 2.76 : 5.40 : 8.93) plus a hollow body mode. */
function pinModes(): Mode[] {
  const f0 = rnd(780, 1150);
  const j = () => rnd(0.97, 1.03);
  return [
    [f0, 1, rnd(0.055, 0.08)],
    [f0 * 2.76 * j(), 0.55, rnd(0.03, 0.045)],
    [f0 * 5.4 * j(), 0.3, 0.02],
    [f0 * 8.93 * j(), 0.15, 0.012],
    [f0 * rnd(0.42, 0.5), 0.45, rnd(0.04, 0.06)],
  ];
}

/** The hard transient of a strike: a millisecond or two of high-passed noise. */
function clicker(sr: number, length = 0.0015, cut = 2500): (t: number) => number {
  const hp = highpass(cut, sr);
  return (t) => hp(noise() * Math.exp(-t / length));
}

/** A drum-like thump: a sine whose pitch drops from `from + to` to `to` Hz. */
function dropper(sr: number, to: number, from: number, fall: number): () => number {
  let phase = 0;
  let t = 0;
  return () => {
    phase += (TAU * (to + from * Math.exp(-t / fall))) / sr;
    t += 1 / sr;
    return Math.sin(phase);
  };
}

/** Pin on pin: the bright wooden "tock". */
function pinHit(sr: number): Float32Array {
  const m = pinModes();
  const ph = phasesFor(m);
  const click = clicker(sr);
  return render(sr, 0.35, (t) => modes(m, t, ph) + 0.9 * click(t));
}

/** The ball (7 kg of resin) driving into a pin: the pin's crack over a low thump. */
function heavyHit(sr: number): Float32Array {
  const m = pinModes();
  const ph = phasesFor(m);
  const click = clicker(sr, 0.002, 1800);
  const lp = lowpass(900, sr);
  const thump = dropper(sr, 55, 95, 0.04);
  return render(sr, 0.6, (t) => {
    const body = lp(noise()) * Math.exp(-t / 0.025);
    return 1.1 * modes(m, t, ph) + 1.2 * click(t) + 1.3 * thump() * Math.exp(-t / 0.11) + 2.2 * body;
  });
}

/** Pins scattering after a solid hit: a dense, quickly thinning cascade of clacks. */
function crash(sr: number): Float32Array {
  const hits = Array.from({ length: 16 }, (_, k) => {
    const m = pinModes();
    return { at: 0.35 * Math.pow(random(), 1.6), amp: Math.pow(0.88, k) * rnd(0.6, 1), m, ph: phasesFor(m) };
  });
  const lp = lowpass(3500, sr);
  const hp = highpass(300, sr);
  return render(sr, 1.0, (t) => {
    let s = 0;
    for (const h of hits) if (t >= h.at) s += h.amp * modes(h.m, t - h.at, h.ph);
    return s + 0.5 * hp(lp(noise())) * Math.exp(-t / 0.18) * Math.min(1, t / 0.005);
  });
}

/** A pin against the side kickback panel: lower and duller than pin on pin. */
function panelHit(sr: number): Float32Array {
  const f0 = rnd(210, 320);
  const m: Mode[] = [
    [f0, 1, 0.07],
    [f0 * 2.3, 0.5, 0.04],
    [f0 * 3.9, 0.25, 0.025],
    [f0 * 6.1, 0.12, 0.015],
  ];
  const ph = phasesFor(m);
  const lp = lowpass(1400, sr);
  return render(sr, 0.3, (t) => modes(m, t, ph) + 1.5 * lp(noise()) * Math.exp(-t / 0.006));
}

/** A soft, heavy thud: the ball off a bumper or into the pit cushion. */
function thud(sr: number): Float32Array {
  const drop = dropper(sr, rnd(40, 50), 70, 0.05);
  const lp = lowpass(380, sr);
  return render(sr, 0.45, (t) => drop() * Math.exp(-t / 0.13) * Math.min(1, t / 0.003) + 2.5 * lp(noise()) * Math.exp(-t / 0.035));
}

/** The ball drops into the gutter: a hollow ring from the channel over a thud. */
function gutterDrop(sr: number): Float32Array {
  const m: Mode[] = [
    [182, 1, 0.22],
    [497, 0.6, 0.16],
    [1012, 0.3, 0.09],
    [1690, 0.18, 0.05],
  ];
  const ph = phasesFor(m);
  const drop = dropper(sr, 50, 60, 0.05);
  const lp = lowpass(600, sr);
  return render(sr, 0.8, (t) => 0.6 * modes(m, t, ph, 0.002) + 0.9 * drop() * Math.exp(-t / 0.12) + 1.5 * lp(noise()) * Math.exp(-t / 0.03));
}

/**
 * A seamless loop of a ball rolling on wood: deep brown noise with a faint grain from the boards.
 * The live graph filters it by speed and adds the turning wobble.
 */
function rollLoop(sr: number): Float32Array {
  const len = 3;
  const xf = 0.25;
  let b = 0;
  const grain = highpass(900, sr);
  const grainLp = lowpass(2500, sr);
  const raw = render(sr, len + xf, () => {
    b = 0.992 * b + 0.05 * noise();
    return b + 0.04 * grain(grainLp(noise())) * (random() < 0.02 ? 6 : 1);
  });
  // Crossfade the tail into the head so the loop has no seam.
  const n = Math.round(len * sr);
  const f = Math.round(xf * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = i < f ? raw[i] * (i / f) + raw[n + i] * (1 - i / f) : raw[i];
  return out;
}

/** The ball meets the lane: a soft, heavy landing and a short skid. */
function releaseSound(sr: number): Float32Array {
  const drop = dropper(sr, 60, 50, 0.04);
  const lp = lowpass(2200, sr);
  const hp = highpass(700, sr);
  return render(sr, 0.6, (t) => {
    const land = drop() * Math.exp(-t / 0.09) * Math.min(1, t / 0.003);
    const skid = hp(lp(noise())) * Math.min(1, t / 0.03) * Math.exp(-t / 0.18);
    return land + 0.7 * skid;
  });
}

/** The pinsetter: a motor spinning up, pins rattling past and the bar landing. */
function sweepSound(sr: number): Float32Array {
  const rattles = Array.from({ length: 10 }, () => {
    const m = pinModes().map(([f, a, d]): Mode => [f * 0.8, a, d * 0.8]);
    return { at: rnd(0.2, 0.75), amp: rnd(0.05, 0.14), m, ph: phasesFor(m) };
  });
  const lp = lowpass(500, sr);
  let p = 0;
  return render(sr, 1.25, (t) => {
    const env = Math.min(1, t / 0.18) * Math.min(1, Math.max(0, (1.0 - t) / 0.2));
    p += (TAU * (95 + 25 * Math.min(1, t / 0.3) + 2 * Math.sin(TAU * 7 * t))) / sr;
    const motor = (Math.sin(p) + 0.5 * Math.sin(2 * p) + 0.25 * Math.sin(3 * p)) * 0.25 + 0.6 * lp(noise());
    let s = motor * env;
    for (const r of rattles) if (t >= r.at) s += r.amp * modes(r.m, t - r.at, r.ph);
    const k = t - 1.0;
    if (k >= 0) s += 0.5 * Math.sin(TAU * 70 * k) * Math.exp(-k / 0.06) + 0.3 * noise() * Math.exp(-k / 0.008);
    return s;
  });
}

/** Lining up: a small wooden tick as the ball crosses a board. */
function tickSound(sr: number): Float32Array {
  const m: Mode[] = [
    [2350, 1, 0.012],
    [5100, 0.4, 0.006],
  ];
  const click = clicker(sr, 0.0008, 3000);
  return render(sr, 0.06, (t) => modes(m, t, [0, 0], 0.0003) + click(t));
}

/** Chain lightning: crackling discharge over a falling electric zing. */
function zapSound(sr: number): Float32Array {
  let p = 0;
  let mp = 0;
  const lp = lowpass(7000, sr);
  const hp = highpass(1500, sr);
  return render(sr, 0.45, (t) => {
    const f = 380 + 2000 * Math.exp(-t / 0.07);
    mp += (TAU * f * 1.48) / sr;
    p += (TAU * f) / sr;
    const zing = Math.sin(p + 3 * Math.exp(-t / 0.08) * Math.sin(mp)) * Math.exp(-t / 0.09);
    const density = 0.08 * Math.exp(-t / 0.15);
    const crackle = hp(lp(random() < density ? noise() * 6 : noise() * 0.2)) * Math.exp(-t / 0.2);
    return 0.5 * zing + crackle;
  });
}

/** The bomb power-up: a sub drop, a blast of noise closing down, and debris. */
function boomSound(sr: number): Float32Array {
  const sub = dropper(sr, 28, 50, 0.18);
  const debrisLp = lowpass(3000, sr);
  let y = 0;
  return render(sr, 1.8, (t) => {
    const cut = 120 + 5000 * Math.exp(-t / 0.12);
    y += (1 - Math.exp((-TAU * cut) / sr)) * (noise() - y);
    const blast = y * Math.exp(-t / 0.4) * Math.min(1, t / 0.002);
    const debris = t > 0.08 && random() < 0.003 * Math.exp(-t / 0.5) ? noise() * 4 : 0;
    return 1.2 * sub() * Math.exp(-t / 0.5) * Math.min(1, t / 0.004) + 1.6 * blast + 0.4 * debrisLp(debris);
  });
}

/** A soft major-ninth chord that swells and fades: the bed under the strike fanfare. */
function padSound(sr: number): Float32Array {
  const freqs = [NOTE.C5 / 2, NOTE.G4, NOTE.E5, NOTE.B5, NOTE.D6];
  const voices = freqs.flatMap((f) => [-6, 0, 6].map((cents) => ({ f: f * Math.pow(2, cents / 1200), ph: random() * TAU })));
  return render(
    sr,
    2.4,
    (t) => {
      const env = Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 0.25) / 0.7);
      let s = 0;
      for (const v of voices) s += Math.sin(TAU * v.f * t + v.ph) + 0.2 * Math.sin(TAU * 2 * v.f * t + v.ph);
      return s * env;
    },
    0.7,
  );
}

/** A glassy FM bell: a 1:1 pair for warmth, a 3.5:1 pair for the strike, slightly chorused. */
function bell(sr: number, f: number): Float32Array {
  const decay = 0.9 * Math.pow(440 / f, 0.35);
  return render(sr, Math.min(2.2, decay * 4), (t) => {
    const env = Math.min(1, t / 0.003) * Math.exp(-t / decay);
    const warm = Math.sin(TAU * f * t + 1.1 * Math.exp(-t / 0.3) * Math.sin(TAU * f * t));
    const strike = Math.sin(TAU * f * t + 0.8 * Math.exp(-t / 0.05) * Math.sin(TAU * 3.5 * f * t));
    const chorus = Math.sin(TAU * f * 1.003 * t);
    return env * (0.6 * warm + 0.4 * strike + 0.25 * chorus);
  });
}

/** A marimba bar: tuned partials at 1, 3.9 and 9.2 times the note, with a soft mallet. */
function marimba(sr: number, f: number): Float32Array {
  const m: Mode[] = [
    [f, 1, 0.38],
    [f * 3.93, 0.3, 0.07],
    [f * 9.2, 0.08, 0.02],
    [f / 2, 0.15, 0.25],
  ];
  return render(sr, 1.2, (t) => modes(m, t, [0, 0, 0, 0], 0.002));
}

/**
 * A synthetic room impulse response: a few early reflections, then a diffuse stereo tail that
 * darkens as it decays, like a big room with hard floors and a low ceiling.
 */
function roomImpulse(sr: number): Float32Array[] {
  const len = Math.round(1.6 * sr);
  return [0, 1].map((ch) => {
    const d = new Float32Array(len);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const cut = 7000 * Math.exp(-t / 0.5) + 400;
      y += (1 - Math.exp((-TAU * cut) / sr)) * (noise() - y);
      d[i] = y * Math.exp(-t / 0.38) * Math.min(1, t / 0.012);
    }
    for (const [at, a] of [
      [0.011, 0.5],
      [0.019, 0.35],
      [0.027, 0.3],
      [0.041, 0.22],
    ]) {
      d[Math.round((at + ch * 0.003) * sr)] += a * (ch ? -1 : 1);
    }
    return d;
  });
}

/** Renders every sound. `rand` makes the variations repeatable (tests). */
export function renderBank(sr: number, rand: () => number = Math.random): Bank {
  random = rand;
  const many = (n: number, fn: (sr: number) => Float32Array) => Array.from({ length: n }, () => fn(sr));
  const bank: Bank = {
    pin: many(8, pinHit),
    heavy: many(3, heavyHit),
    crash: many(2, crash),
    panel: many(3, panelHit),
    thud: many(2, thud),
    gutter: gutterDrop(sr),
    roll: rollLoop(sr),
    release: releaseSound(sr),
    sweep: sweepSound(sr),
    tick: tickSound(sr),
    zap: many(2, zapSound),
    boom: boomSound(sr),
    pad: padSound(sr),
    room: roomImpulse(sr),
    bell: Object.fromEntries(BELLS.map((f) => [f, bell(sr, f)])),
    marimba: Object.fromEntries(MARIMBAS.map((f) => [f, marimba(sr, f)])),
  };
  random = Math.random;
  return bank;
}

/** Every sample array in a bank, for transferring it out of the worker. */
export function bankArrays(bank: Bank): Float32Array[] {
  return Object.values(bank).flatMap((v: Float32Array | Float32Array[] | Record<number, Float32Array>) =>
    v instanceof Float32Array ? [v] : Object.values(v),
  );
}
