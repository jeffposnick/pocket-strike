// The game's sound effects. Every sound is synthesized (src/audio-synth.ts, rendered in a worker
// when audio unlocks): there are no audio files to download or precache, so the game plays fully
// offline. This file is the Web Audio side: it plays those renders through a synthesized room
// reverb, pans each one to where it happened on the lane, and drives the live rolling-ball loop.

import { NOTE, renderBank } from './audio-synth.ts';
import type { Bank } from './audio-synth.ts';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface PlayOpts {
  gain?: number;
  rate?: number;
  /** -1 (left) .. 1 (right). */
  pan?: number;
  /** Reverb send level. */
  wet?: number;
  /** Seconds from now. */
  when?: number;
}

type Buffers<T> = T extends Float32Array
  ? AudioBuffer
  : T extends Float32Array[]
    ? AudioBuffer[]
    : T extends Record<number, Float32Array>
      ? Record<number, AudioBuffer>
      : never;
/** The rendered sounds as playable buffers (the room impulse goes straight to the reverb). */
type Sounds = { [K in Exclude<keyof Bank, 'room'>]: Buffers<Bank[K]> };

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Dry bus and reverb input; both feed the master. */
  private bus: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private bank: Sounds | null = null;
  private voices = 0;
  private lastClack = 0;
  private roll: { src: AudioBufferSourceNode; lfo: OscillatorNode; gain: GainNode; lp: BiquadFilterNode; hollow: BiquadFilterNode; lfoDepth: GainNode; pan: StereoPannerNode } | null = null;
  muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const c = new AudioContext();
        this.ctx = c;
        this.master = c.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        // Gentle bus compression glues the layers and catches a 55-pin pile-up.
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -16;
        comp.knee.value = 12;
        comp.ratio.value = 3.5;
        comp.attack.value = 0.004;
        comp.release.value = 0.2;
        this.master.connect(comp).connect(c.destination);
        this.bus = c.createGain();
        this.bus.connect(this.master);
        this.verb = c.createConvolver();
        const verbOut = c.createGain();
        verbOut.gain.value = 0.9;
        this.verb.connect(verbOut).connect(this.master);
        this.loadSounds(c);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /**
   * Synthesis takes about half a second, so it runs in a worker; sounds stay silent until it's
   * done. Without workers it runs here, after the tap that unlocked audio has been handled.
   */
  private loadSounds(c: AudioContext): void {
    const done = (bank: Bank) => this.useBank(c, bank);
    try {
      const worker = new Worker(new URL('./audio-worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<Bank>) => {
        done(e.data);
        worker.terminate();
      };
      worker.onerror = () => {
        worker.terminate();
        window.setTimeout(() => done(renderBank(c.sampleRate)));
      };
      worker.postMessage({ sampleRate: c.sampleRate });
    } catch {
      window.setTimeout(() => done(renderBank(c.sampleRate)));
    }
  }

  private useBank(c: AudioContext, bank: Bank): void {
    const buf = (...channels: Float32Array[]) => {
      const b = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate: c.sampleRate });
      channels.forEach((d, i) => b.copyToChannel(d as Float32Array<ArrayBuffer>, i));
      return b;
    };
    const list = (l: Float32Array[]) => l.map((d) => buf(d));
    const keyed = (r: Record<number, Float32Array>) => Object.fromEntries(Object.entries(r).map(([k, d]) => [k, buf(d)]));
    if (this.verb) this.verb.buffer = buf(...bank.room);
    this.bank = {
      pin: list(bank.pin),
      heavy: list(bank.heavy),
      crash: list(bank.crash),
      panel: list(bank.panel),
      thud: list(bank.thud),
      gutter: buf(bank.gutter),
      roll: buf(bank.roll),
      release: buf(bank.release),
      sweep: buf(bank.sweep),
      tick: buf(bank.tick),
      zap: list(bank.zap),
      boom: buf(bank.boom),
      pad: buf(bank.pad),
      bell: keyed(bank.bell),
      marimba: keyed(bank.marimba),
    };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  private play(buf: AudioBuffer, o: PlayOpts = {}): void {
    const c = this.ctx;
    if (!c || !this.bus || !this.verb) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate ?? 1;
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    src.connect(g).connect(p).connect(this.bus);
    let send: GainNode | null = null;
    if (o.wet) {
      send = c.createGain();
      send.gain.value = o.wet;
      p.connect(send).connect(this.verb);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      p.disconnect();
      send?.disconnect();
    };
    src.start(c.currentTime + (o.when ?? 0));
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
  }

  // ---- Ball ---------------------------------------------------------------------

  /** The ball is set down on the lane. */
  release(): void {
    if (this.bank) this.play(this.bank.release, { gain: 0.8, rate: rnd(0.95, 1.05), wet: 0.12 });
  }

  rollStart(): void {
    const c = this.ctx;
    if (!c || !this.bank || !this.bus || !this.verb) return;
    this.rollStop();
    const src = c.createBufferSource();
    src.buffer = this.bank.roll;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.Q.value = 0.8;
    // Boosted only in the gutter, where the channel rings hollow.
    const hollow = c.createBiquadFilter();
    hollow.type = 'peaking';
    hollow.frequency.value = 340;
    hollow.Q.value = 3;
    hollow.gain.value = 0;
    const gain = c.createGain();
    gain.gain.value = 0;
    // A slow wobble at the ball's turning rate: the finger holes coming round.
    const am = c.createGain();
    am.gain.value = 1;
    const lfo = c.createOscillator();
    lfo.frequency.value = 3;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.12;
    lfo.connect(lfoDepth).connect(am.gain);
    const pan = c.createStereoPanner();
    src.connect(lp).connect(hollow).connect(am).connect(gain).connect(pan).connect(this.bus);
    const send = c.createGain();
    send.gain.value = 0.1;
    pan.connect(send).connect(this.verb);
    src.start(0, Math.random() * 2);
    lfo.start();
    this.roll = { src, lfo, gain, lp, hollow, lfoDepth, pan };
  }

  /** `pan` is where the ball is across the lane, -1..1. */
  rollUpdate(speed01: number, gutter: boolean, pan = 0): void {
    const r = this.roll;
    if (!this.ctx || !r) return;
    const t = this.ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed01));
    r.gain.gain.setTargetAtTime(gutter ? 0.75 : 0.45 + s * 0.6, t, 0.06);
    r.lp.frequency.setTargetAtTime(gutter ? 900 : 180 + s * 260, t, 0.06);
    r.hollow.gain.setTargetAtTime(gutter ? 12 : 0, t, 0.05);
    r.src.playbackRate.setTargetAtTime(0.8 + s * 0.45, t, 0.1);
    r.lfo.frequency.setTargetAtTime(2 + s * 9, t, 0.1);
    r.lfoDepth.gain.setTargetAtTime(gutter ? 0.25 : 0.12, t, 0.1);
    r.pan.pan.setTargetAtTime(pan * 0.6, t, 0.05);
  }

  rollStop(): void {
    const r = this.roll;
    if (!this.ctx || !r) return;
    r.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    window.setTimeout(() => {
      try {
        r.src.stop();
        r.lfo.stop();
      } catch {
        /* already stopped */
      }
    }, 700);
    this.roll = null;
  }

  // ---- Impacts ------------------------------------------------------------------

  /** A pin struck; intensity 0..1. `big` is the ball driving into the rack. */
  clack(intensity: number, big = false, pan = 0): void {
    const b = this.bank;
    const c = this.ctx;
    if (!b || !c) return;
    const now = c.currentTime;
    const v = Math.min(1, Math.max(0, intensity));
    // Dozens of contacts can land in one frame (Mega Rack): keep the loudest few.
    if (!big && (now - this.lastClack < 0.012 || this.voices > 28)) return;
    this.lastClack = now;
    const p = pan * 0.7;
    if (big) {
      this.play(this.pick(b.heavy), { gain: 0.9, rate: rnd(0.95, 1.05), pan: p, wet: 0.25 });
      this.play(this.pick(b.crash), { gain: 0.75, rate: rnd(0.96, 1.04), pan: p * 0.6, wet: 0.35 });
    } else {
      // Harder hits are brighter as well as louder.
      this.play(this.pick(b.pin), { gain: 0.12 + v * 0.6, rate: rnd(0.92, 1.08) * (0.94 + v * 0.1), pan: p, wet: 0.22 });
    }
  }

  /** A pin hits the side kickback panel. */
  panel(intensity: number, pan = 0): void {
    const b = this.bank;
    if (!b || this.voices > 28) return;
    this.play(this.pick(b.panel), { gain: 0.15 + Math.min(1, intensity) * 0.5, rate: rnd(0.9, 1.1), pan: pan * 0.8, wet: 0.2 });
  }

  /** A dull thud: the ball off a bumper, or into the pit cushion. */
  thump(v: number, pan = 0): void {
    const b = this.bank;
    if (b) this.play(this.pick(b.thud), { gain: 0.3 + v * 0.7, rate: rnd(0.92, 1.08), pan: pan * 0.6, wet: 0.15 });
  }

  /** The ball drops into the gutter channel. */
  gutter(pan = 0): void {
    const b = this.bank;
    if (b) this.play(b.gutter, { gain: 0.8, rate: rnd(0.95, 1.05), pan: pan * 0.8, wet: 0.2 });
  }

  /** The pinsetter's sweep bar clears the deck. */
  sweep(): void {
    if (this.bank) this.play(this.bank.sweep, { gain: 0.55, wet: 0.25 });
  }

  /** Lining up: the ball crosses a board. */
  tick(): void {
    if (this.bank) this.play(this.bank.tick, { gain: 0.25, rate: rnd(0.95, 1.05) });
  }

  // ---- Power-ups ----------------------------------------------------------------

  boom(pan = 0): void {
    const b = this.bank;
    if (!b) return;
    this.play(b.boom, { gain: 1, pan: pan * 0.4, wet: 0.45 });
    this.play(this.pick(b.crash), { gain: 0.6, rate: 0.9, wet: 0.3, when: 0.03 });
  }

  zap(pan = 0): void {
    const b = this.bank;
    if (b) this.play(this.pick(b.zap), { gain: 0.55, rate: rnd(0.95, 1.1), pan: pan * 0.6, wet: 0.3 });
  }

  /** Sparkle for collecting a special pin. */
  collect(pan = 0): void {
    [NOTE.E6, NOTE.B6, NOTE.E7].forEach((f, i) =>
      this.note('bell', f, { gain: 0.22 - i * 0.03, pan: pan * 0.5 + (i - 1) * 0.3, wet: 0.35, when: i * 0.045 }),
    );
  }

  // ---- Musical cues -------------------------------------------------------------

  /** Strikes: a rising bell arpeggio over a shimmering chord. `level` grows with the streak. */
  fanfare(level: number): void {
    const b = this.bank;
    if (!b) return;
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.B5, NOTE.D6, NOTE.G6, NOTE.B6];
    const count = Math.min(notes.length, 4 + level);
    notes.slice(0, count).forEach((f, i) =>
      this.note('bell', f, { gain: 0.2, pan: (i / (count - 1) - 0.5) * 0.8, wet: 0.4, when: i * 0.07 }),
    );
    this.play(b.pad, { gain: 0.3 + level * 0.08, wet: 0.5 });
  }

  /** Spares and power-ups: two bright bell notes. */
  chime(): void {
    this.note('bell', NOTE.E5, { gain: 0.24, pan: -0.15, wet: 0.35 });
    this.note('bell', NOTE.B5, { gain: 0.22, pan: 0.15, wet: 0.35, when: 0.09 });
  }

  /** Gutter balls, misses and a lost run: a soft falling marimba figure. */
  womp(): void {
    this.note('marimba', NOTE.E5, { gain: 0.35, pan: 0.1, wet: 0.3 });
    this.note('marimba', NOTE.C5, { gain: 0.35, pan: -0.05, wet: 0.3, when: 0.16 });
    this.note('marimba', NOTE.A4, { gain: 0.4, pan: -0.15, wet: 0.35, when: 0.34 });
  }

  private note(kind: 'bell' | 'marimba', freq: number, o: PlayOpts): void {
    const buf = this.bank?.[kind][freq];
    if (buf) this.play(buf, o);
  }
}

let rumble: ((pattern: number | number[]) => void) | null = null;

/** Also rumble a game controller whenever the phone would vibrate. */
export function setRumble(fn: (pattern: number | number[]) => void): void {
  rumble = fn;
}

/** Haptic feedback: the phone's vibration motor, and a controller's rumble where there is one. */
export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here */
  }
  rumble?.(pattern);
}
