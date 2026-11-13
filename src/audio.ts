/** Every sound is synthesized with Web Audio, so there are no files to load. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private lastClack = 0;
  muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  rollStart(): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    this.rollStop();
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    f.Q.value = 6;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.rollSrc = src;
    this.rollGain = g;
    this.rollFilter = f;
  }

  rollUpdate(speed01: number, gutter: boolean): void {
    if (!this.ctx || !this.rollGain || !this.rollFilter) return;
    const t = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(0.25 + speed01 * 0.55, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(gutter ? 420 : 140 + speed01 * 120, t, 0.05);
  }

  rollStop(): void {
    if (!this.ctx || !this.rollSrc || !this.rollGain) return;
    const t = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(0, t, 0.08);
    const src = this.rollSrc;
    window.setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }, 400);
    this.rollSrc = null;
    this.rollGain = null;
  }

  /** Wooden pin clack; intensity 0..1. */
  clack(intensity: number, big = false): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const now = c.currentTime;
    if (now - this.lastClack < 0.018) return;
    this.lastClack = now;
    const v = Math.min(1, intensity);

    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 2200;
    bp.Q.value = 3;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.5 * v + (big ? 0.4 : 0), now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.09 + (big ? 0.12 : 0));
    n.connect(bp).connect(ng).connect(this.master);
    n.start(now, Math.random() * 0.5, 0.25);

    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(700 + Math.random() * 900, now);
    o.frequency.exponentialRampToValueAtTime(300, now + 0.08);
    const og = c.createGain();
    og.gain.setValueAtTime(0.35 * v, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    o.connect(og).connect(this.master);
    o.start(now);
    o.stop(now + 0.12);

    if (big) this.thump(0.9);
  }

  thump(v: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, now);
    o.frequency.exponentialRampToValueAtTime(45, now + 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.7 * v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.32);
  }

  /** Bright rising arpeggio. `level` grows with strike streaks. */
  fanfare(level: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const base = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
    const count = Math.min(base.length, 4 + level);
    for (let i = 0; i < count; i++) {
      const t = c.currentTime + i * 0.075;
      for (const type of ['square', 'triangle'] as const) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = base[i] * (type === 'square' ? 1 : 2);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(type === 'square' ? 0.09 : 0.05, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        o.connect(g).connect(this.master);
        o.start(t);
        o.stop(t + 0.4);
      }
    }
  }

  chime(): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    [659.25, 987.77].forEach((f, i) => {
      const t = c.currentTime + i * 0.09;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.45);
    });
  }

  womp(): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, now);
    o.frequency.exponentialRampToValueAtTime(90, now + 0.6);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);
    o.connect(f).connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.7);
  }

  whoosh(): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const now = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, now);
    f.frequency.exponentialRampToValueAtTime(2400, now + 0.35);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    n.connect(f).connect(g).connect(this.master);
    n.start(now, 0, 0.45);
  }

  /** Sparkly pickup for special pins. */
  collect(): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    [880, 1318.5, 1760].forEach((f, i) => {
      const t = c.currentTime + i * 0.05;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.3);
    });
  }

  boom(): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const now = c.currentTime;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, now);
    f.frequency.exponentialRampToValueAtTime(120, now + 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(1.0, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    n.connect(f).connect(g).connect(this.master);
    n.start(now, 0, 0.95);
    this.thump(1);
  }

  zap(): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1800, now);
    o.frequency.exponentialRampToValueAtTime(240, now + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.22);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.3, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    n.connect(hp).connect(ng).connect(this.master);
    n.start(now, Math.random() * 0.5, 0.2);
  }

  tick(): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = 1400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.05);
  }
}

export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here */
  }
}
