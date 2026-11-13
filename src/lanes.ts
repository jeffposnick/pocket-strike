import * as ex from 'excalibur';
import {
  makeBall,
  makeBallGloss,
  makeBallShadow,
  makeFallenPin,
  makeLaneTiles,
  makeStandingPin,
  NEON,
} from './art.ts';
import type { BallStyle } from './art.ts';
import { buzz, Sfx } from './audio.ts';
import {
  BALL_R,
  BALL_START_Y,
  boardAt,
  DECK_Y,
  LANE_HALF,
  MAX_SPEED,
  MIN_SPEED,
  PIT_DEPTH,
  PIT_Y,
  speedToMph,
  WALL_X,
} from './constants.ts';
import type { Hud } from './hud.ts';
import { isSplit, provisionalTotal, scoreFrames } from './scoring.ts';
import { Sim } from './sim.ts';

type Phase = 'menu' | 'aim' | 'roll' | 'result' | 'sweep' | 'return' | 'over';

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

interface Sample {
  x: number;
  y: number;
  t: number;
}

interface Gesture {
  id: number;
  samples: Sample[];
  startX: number;
  ballX0: number;
  mode: 'position' | 'throw';
  lowestIdx: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const CONFETTI_COLORS = [NEON.pink, NEON.cyan, NEON.amber, NEON.violet, '#ffffff', '#7dff9b'].map((c) =>
  ex.Color.fromHex(c),
);

export class Lanes extends ex.Scene {
  private readonly sim = new Sim();
  private readonly sfx = new Sfx();
  private phase: Phase = 'menu';

  // Actors
  private readonly pinActors: ex.Actor[] = [];
  private readonly standingGfx = makeStandingPin();
  private readonly fallenGfx = makeFallenPin();
  private readonly ball = new ex.Actor({ z: 5 });
  private readonly ballGloss = new ex.Actor({ z: 5.1 });
  private readonly ballShadow = new ex.Actor({ z: 3 });

  // Game state
  private frame = 0;
  private ballInFrame = 0;
  private rolls: number[] = [];
  private tenth: number[] = [];
  private standingBefore = 10;
  private streak = 0;
  private strikes = 0;
  private spares = 0;
  private resetAfter = false;
  private gameOver = false;
  private lastX = 0;
  private bumpers = false;
  private style: BallStyle | null = null;
  private throws = 0;

  // Presentation
  private camY = 0;
  private returnFrom = 0;
  private phaseT = 0;
  private phaseDur = 0;
  private slowT = 0;
  private hitStop = 0;
  private shake = 0;
  private rackDrop = 1;
  private sweepY = 0;
  private sweepCleared = false;
  private rollSoundOn = false;
  private sparks: Spark[] = [];
  private confetti: Confetto[] = [];
  private trail: { x: number; y: number }[] = [];
  private gesture: Gesture | null = null;
  private fingerTrail: Sample[] = [];
  private fingerFade = 0;
  private best = 0;

  private readonly hud: Hud;

  constructor(hud: Hud) {
    super();
    this.hud = hud;
  }

  override onInitialize(engine: ex.Engine): void {
    for (const t of makeLaneTiles()) this.add(t);
    for (let i = 0; i < 10; i++) {
      const a = new ex.Actor({ z: 6 });
      a.graphics.use(this.standingGfx);
      this.pinActors.push(a);
      this.add(a);
    }
    this.ballShadow.graphics.use(makeBallShadow());
    this.ballGloss.graphics.use(makeBallGloss());
    this.add(this.ballShadow);
    this.add(this.ball);
    this.add(this.ballGloss);

    try {
      this.best = Number(localStorage.getItem('ps-best') ?? 0) || 0;
    } catch {
      /* ignore */
    }

    this.camY = this.aimCamY(engine);
    this.sim.placeBall(0);

    const toWorld = (e: PointerEvent) => engine.screen.pageToWorldCoordinates(ex.vec(e.pageX, e.pageY));
    window.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if ((e.target as HTMLElement).closest('button, input, label, .overlay')) return;
      this.onDown(toWorld(e), e.pointerId);
    });
    window.addEventListener('pointermove', (e) => this.onMove(toWorld(e), e.pointerId));
    window.addEventListener('pointerup', (e) => this.onUp(e.pointerId, false));
    window.addEventListener('pointercancel', (e) => this.onUp(e.pointerId, true));

    this.hud.onMute((m) => this.sfx.setMuted(m));
    this.hud.onMenuButton(() => this.openMenu());
    this.openMenu();
  }

  // ---- Flow -----------------------------------------------------------------

  private openMenu(): void {
    this.phase = 'menu';
    this.gesture = null;
    this.hud.hint(false);
    this.hud.setBoardNumber(null);
    this.hud.showMenu(this.best, (style, bumpers) => this.newGame(style, bumpers));
  }

  private newGame(style: BallStyle, bumpers: boolean): void {
    if (style !== this.style) this.ball.graphics.use(makeBall(style));
    this.style = style;
    this.bumpers = bumpers;
    this.sim.bumpers = bumpers;
    this.frame = 0;
    this.ballInFrame = 0;
    this.rolls = [];
    this.tenth = [];
    this.standingBefore = 10;
    this.streak = 0;
    this.strikes = 0;
    this.spares = 0;
    this.gameOver = false;
    this.sim.resetRack();
    this.rackDrop = 0;
    this.lastX = 0;
    this.sim.placeBall(this.lastX);
    this.confetti = [];
    this.sparks = [];
    this.trail = [];
    this.refreshHud();
    this.hud.hideThrow();
    this.beginAim();
  }

  private beginAim(): void {
    this.phase = 'aim';
    this.hud.setStatus(`Frame ${this.frame + 1} · Ball ${this.ballInFrame + 1}`);
    if (this.throws < 2) this.hud.hint(true, 300);
  }

  private refreshHud(): void {
    this.hud.renderBoard(scoreFrames(this.rolls), this.gameOver ? -1 : this.frame);
    this.hud.setScore(provisionalTotal(this.rolls));
    this.hud.setRack(this.sim.standing().map((p) => p.id));
  }

  // ---- Input ------------------------------------------------------------------

  private onDown(pos: ex.Vector, id: number): void {
    if (this.phase !== 'aim') {
      // Tap to hurry the between-ball sequence along.
      if ((this.phase === 'result' || this.phase === 'return') && this.phaseT > 0.35) {
        this.phaseT = Math.max(this.phaseT, this.phaseDur - 0.05);
      }
      return;
    }
    if (this.gesture) return;
    const s = { x: pos.x, y: pos.y, t: performance.now() / 1000 };
    this.gesture = { id, samples: [s], startX: pos.x, ballX0: this.sim.ball.x, mode: 'position', lowestIdx: 0 };
    this.fingerTrail = [s];
    this.fingerFade = 1;
    this.hud.setBoardNumber(boardAt(this.sim.ball.x));
  }

  private onMove(pos: ex.Vector, id: number): void {
    const g = this.gesture;
    if (!g || g.id !== id || this.phase !== 'aim') return;
    const s = { x: pos.x, y: pos.y, t: performance.now() / 1000 };
    g.samples.push(s);
    if (g.samples.length > 240) {
      g.samples.shift();
      g.lowestIdx = Math.max(0, g.lowestIdx - 1);
    }
    this.fingerTrail.push(s);
    if (this.fingerTrail.length > 60) this.fingerTrail.shift();

    if (g.mode === 'position') {
      if (pos.y >= g.samples[g.lowestIdx].y) g.lowestIdx = g.samples.length - 1;
      const climbed = g.samples[g.lowestIdx].y - pos.y;
      if (climbed > 30) {
        g.mode = 'throw';
        this.hud.setBoardNumber(null);
      } else {
        const lim = LANE_HALF - BALL_R + 8;
        const x = Math.max(-lim, Math.min(lim, g.ballX0 + (pos.x - g.startX)));
        if (boardAt(x) !== boardAt(this.sim.ball.x)) this.sfx.tick();
        this.sim.ball.x = x;
        this.hud.setBoardNumber(boardAt(x));
      }
    }
  }

  private onUp(id: number, cancelled: boolean): void {
    const g = this.gesture;
    if (!g || g.id !== id) return;
    this.gesture = null;
    this.hud.setBoardNumber(null);
    if (cancelled || this.phase !== 'aim' || g.mode !== 'throw') return;

    const stroke = g.samples.slice(g.lowestIdx);
    const end = stroke[stroke.length - 1];
    // Velocity over the last ~110 ms of the flick.
    let k = stroke.length - 1;
    while (k > 0 && end.t - stroke[k - 1].t < 0.11) k--;
    const first = stroke[k];
    const dt = Math.max(0.016, end.t - first.t);
    const vy = (end.y - first.y) / dt;
    if (vy > -380) return; // Too gentle: treat it as repositioning.

    const power = Math.max(0, Math.min(1, (-vy - 380) / 2600));
    const speed = MIN_SPEED + power * (MAX_SPEED - MIN_SPEED);
    // Hook comes from how much the stroke bends: bow out right → hook left.
    // The launch line comes from the stroke as a whole, so curving doesn't also steer.
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
    let spin = Math.max(-1, Math.min(1, -dev / (len * 0.16)));
    if (Math.abs(spin) < 0.1) spin = 0;

    this.throwBall(speed, angle, spin);
  }

  private throwBall(speed: number, angle: number, spin: number): void {
    this.lastX = this.sim.ball.x;
    this.sim.launch(speed, angle, spin);
    this.phase = 'roll';
    this.throws++;
    this.trail = [];
    this.hud.hint(false);
    this.hud.showThrow(speedToMph(speed), spin);
    this.sfx.whoosh();
    this.sfx.rollStart();
    this.rollSoundOn = true;
    buzz(12);
  }

  // ---- Per-ball outcome ---------------------------------------------------------

  private finishBall(): void {
    if (this.rollSoundOn) {
      this.sfx.rollStop();
      this.rollSoundOn = false;
    }
    const standing = this.sim.standing().map((p) => p.id);
    const knocked = this.standingBefore - standing.length;
    const fullRack = this.standingBefore === 10;
    this.rolls.push(knocked);

    // Message.
    let ms = 1300;
    if (fullRack && knocked === 10) {
      this.streak++;
      this.strikes++;
      const names = ['STRIKE!', 'DOUBLE!', 'TURKEY!'];
      const text = this.streak <= 3 ? names[this.streak - 1] : `${this.streak}-BAGGER!`;
      const sub = this.streak >= 3 ? `${this.streak} strikes in a row` : 'All ten down';
      this.hud.banner(text, sub, 'strike', 1700);
      this.hud.flash('rgba(255,255,255,0.85)');
      this.sfx.fanfare(Math.min(2, this.streak - 1));
      this.burstConfetti(150 + this.streak * 40);
      this.shake = Math.max(this.shake, 14);
      buzz([30, 40, 60]);
      ms = 1900;
    } else if (!fullRack && standing.length === 0) {
      this.streak = 0;
      this.spares++;
      this.hud.banner('SPARE!', 'Picked it up', 'spare', 1400);
      this.hud.flash('rgba(56,243,255,0.4)');
      this.sfx.chime();
      this.burstConfetti(60);
      buzz([20, 30, 20]);
    } else {
      if (fullRack) this.streak = 0;
      if (knocked === 0) {
        if (this.sim.ball.gutter) this.hud.banner('GUTTER', 'Happens to everyone', 'gutter', 1300);
        else this.hud.banner('MISS', 'Not a pin', 'gutter', 1300);
        this.sfx.womp();
      } else if (fullRack && isSplit(standing)) {
        this.hud.banner('SPLIT!', `${standing.join('–')} left standing`, 'split', 1500);
        this.sfx.womp();
        ms = 1500;
      } else if (fullRack && knocked === 9) {
        this.hud.banner('9 PINS', `So close! The ${standing[0]}-pin held on`, 'plain', 1300);
      } else {
        this.hud.banner(`${knocked} PIN${knocked === 1 ? '' : 'S'}`, fullRack ? 'Good leave for a spare' : 'Open frame', 'plain', 1200);
      }
    }

    // Advance the frame.
    this.resetAfter = false;
    if (this.frame < 9) {
      if (this.ballInFrame === 0 && knocked === 10) this.nextFrame();
      else if (this.ballInFrame === 0) this.ballInFrame = 1;
      else this.nextFrame();
    } else {
      this.tenth.push(knocked);
      const [a, b] = this.tenth;
      if (this.tenth.length === 1) {
        this.ballInFrame = 1;
        this.resetAfter = a === 10;
      } else if (this.tenth.length === 2) {
        if (a === 10 || a + b === 10) {
          this.ballInFrame = 2;
          this.resetAfter = (a === 10 && b === 10) || (a !== 10 && a + b === 10);
        } else {
          this.gameOver = true;
        }
      } else {
        this.gameOver = true;
      }
    }
    this.standingBefore = this.resetAfter ? 10 : standing.length;

    this.refreshHud();
    this.setPhase('result', ms);
  }

  private nextFrame(): void {
    this.frame++;
    this.ballInFrame = 0;
    this.resetAfter = true;
  }

  private endGame(): void {
    this.phase = 'over';
    const score = provisionalTotal(this.rolls);
    const newBest = score > this.best;
    if (newBest) {
      this.best = score;
      try {
        localStorage.setItem('ps-best', String(score));
      } catch {
        /* ignore */
      }
    }
    if (newBest || score >= 200) {
      this.burstConfetti(220);
      this.sfx.fanfare(2);
    }
    this.hud.hideThrow();
    this.hud.showOver(
      { score, best: this.best, newBest, strikes: this.strikes, spares: this.spares },
      () => this.newGameSame(),
      () => this.openMenu(),
    );
  }

  private newGameSame(): void {
    if (this.style) this.newGame(this.style, this.bumpers);
  }

  private setPhase(p: Phase, dur: number): void {
    this.phase = p;
    this.phaseT = 0;
    this.phaseDur = dur / 1000;
  }

  // ---- Effects --------------------------------------------------------------------

  private burstConfetti(n: number): void {
    const top = this.camY - this.viewH() / 2;
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
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        life: rand(2.4, 3.4),
      });
    }
  }

  private spawnSparks(x: number, y: number, power: number, wood: boolean): void {
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
        color: wood
          ? ex.Color.fromHex(Math.random() < 0.5 ? '#ffe7b0' : '#ffffff')
          : ex.Color.fromHex(Math.random() < 0.5 ? NEON.cyan : NEON.pink),
      });
    }
  }

  private handleEvents(): void {
    for (const e of this.sim.events) {
      switch (e.type) {
        case 'ballPin': {
          const big = e.power > 380;
          this.sfx.clack(Math.min(1, e.power / 500), big);
          this.spawnSparks(e.x, e.y, e.power * 1.3, false);
          this.spawnSparks(e.x, e.y, e.power * 0.6, true);
          this.shake = Math.max(this.shake, Math.min(12, e.power / 60));
          if (!this.slowStarted) {
            this.slowStarted = true;
            this.hitStop = 0.07;
            this.slowT = 0.85;
            buzz(25);
          }
          break;
        }
        case 'pinPin':
          this.sfx.clack(Math.min(1, e.power / 420));
          this.spawnSparks(e.x, e.y, e.power * 0.6, true);
          this.shake = Math.max(this.shake, Math.min(6, e.power / 90));
          break;
        case 'wall':
          this.sfx.clack(Math.min(0.6, e.power / 600));
          break;
        case 'bumper':
          this.sfx.thump(0.5);
          this.spawnSparks(e.x, e.y, 300, false);
          break;
        case 'gutter':
          this.sfx.womp();
          break;
        case 'pit':
          this.sfx.thump(0.25);
          break;
      }
    }
    this.sim.events = [];
  }

  private slowStarted = false;

  // ---- Frame loop -------------------------------------------------------------------

  private viewH(): number {
    return this.engine?.drawHeight ?? 960;
  }

  private aimCamY(engine?: ex.Engine): number {
    const vh = engine?.drawHeight ?? this.viewH();
    return BALL_START_Y - vh * 0.34;
  }

  private deckCamY(): number {
    return PIT_Y - PIT_DEPTH - 60 + this.viewH() / 2;
  }

  override onPreUpdate(engine: ex.Engine, elapsed: number): void {
    const dt = Math.min(elapsed / 1000, 0.05);
    this.phaseT += dt;

    // Slow motion right after the ball reaches the pins.
    let timeScale = 1;
    if (this.slowT > 0) {
      this.slowT -= dt;
      timeScale = 0.38 + 0.62 * (1 - Math.max(0, this.slowT) / 0.85) ** 2;
    }
    let simDt = dt * timeScale;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      simDt = 0;
    }

    switch (this.phase) {
      case 'aim':
        this.camY += (this.aimCamY(engine) - this.camY) * (1 - Math.exp(-8 * dt));
        break;
      case 'roll': {
        this.sim.step(simDt);
        this.handleEvents();
        const b = this.sim.ball;
        if (!b.inPit) {
          this.trail.push({ x: b.x, y: b.y });
          if (this.trail.length > 26) this.trail.shift();
        } else if (this.trail.length) {
          this.trail.shift();
        }
        if (this.rollSoundOn) {
          if (b.inPit) {
            this.sfx.rollStop();
            this.rollSoundOn = false;
          } else {
            this.sfx.rollUpdate(Math.hypot(b.vx, b.vy) / MAX_SPEED, b.gutter);
          }
        }
        const target = Math.max(this.deckCamY(), b.y - this.viewH() * 0.16);
        this.camY += (target - this.camY) * (1 - Math.exp(-9 * dt));
        if (this.sim.settled()) {
          this.slowStarted = false;
          this.finishBall();
        }
        break;
      }
      case 'result':
        this.sim.step(simDt);
        this.handleEvents();
        if (this.trail.length) this.trail.shift();
        this.camY += (this.deckCamY() - this.camY) * (1 - Math.exp(-6 * dt));
        if (this.phaseT >= this.phaseDur) {
          if (this.gameOver) this.endGame();
          else {
            this.setPhase('sweep', 1000);
            this.sweepCleared = false;
            this.sfx.whoosh();
          }
        }
        break;
      case 'sweep':
        this.updateSweep();
        if (this.phaseT >= this.phaseDur) {
          this.returnFrom = this.camY;
          this.sim.placeBall(this.lastX);
          this.setPhase('return', 850);
          this.hud.hideThrow();
        }
        break;
      case 'return': {
        const k = easeInOut(Math.min(1, this.phaseT / this.phaseDur));
        this.camY = this.returnFrom + (this.aimCamY(engine) - this.returnFrom) * k;
        if (this.phaseT >= this.phaseDur) this.beginAim();
        break;
      }
      case 'over':
      case 'menu':
        this.sim.step(simDt);
        this.sim.events = [];
        break;
    }

    if (this.rackDrop < 1) this.rackDrop = Math.min(1, this.rackDrop + dt / 0.35);

    // Particles.
    for (const s of this.sparks) {
      s.life += simDt || dt * 0.2;
      s.x += s.vx * dt * timeScale;
      s.y += s.vy * dt * timeScale;
      s.vx *= Math.exp(-4 * dt);
      s.vy *= Math.exp(-4 * dt);
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    for (const c of this.confetti) {
      c.life -= dt;
      c.vy += 60 * dt;
      c.vx += Math.sin(c.rot * 0.7) * 40 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
    }
    this.confetti = this.confetti.filter((c) => c.life > 0);
    if (!this.gesture) this.fingerFade = Math.max(0, this.fingerFade - dt * 2.5);

    // Camera with shake.
    this.shake *= Math.exp(-7 * dt);
    const sx = this.shake > 0.3 ? rand(-this.shake, this.shake) : 0;
    const sy = this.shake > 0.3 ? rand(-this.shake, this.shake) : 0;
    this.camera.pos = ex.vec(sx, this.camY + sy);

    this.syncActors();
  }

  private updateSweep(): void {
    const t = this.phaseT;
    const top = PIT_Y - PIT_DEPTH + 10;
    const front = DECK_Y + 40;
    if (t < 0.35) {
      this.sweepY = top + (front - top) * easeInOut(t / 0.35);
    } else if (t < 0.8) {
      this.sweepY = front + (PIT_Y - 30 - front) * easeInOut((t - 0.35) / 0.45);
      // Push the deadwood back into the pit.
      for (const p of this.sim.pins) {
        if (p.state === 'down' && p.y > this.sweepY - 22) {
          p.y = this.sweepY - 22;
          p.vx *= 0.5;
          p.vy = 0;
        }
      }
    } else {
      this.sweepY = PIT_Y - 30 + (top - (PIT_Y - 30)) * easeInOut((t - 0.8) / 0.2);
      if (!this.sweepCleared) {
        this.sweepCleared = true;
        this.sim.clearDeadwood();
        if (this.resetAfter) {
          this.sim.resetRack();
          this.rackDrop = 0;
        }
        this.hud.setRack(this.sim.standing().map((p) => p.id));
      }
    }
  }

  /** How high standing pins are lifted by the pinsetter during the sweep (0..1). */
  private liftAmount(): number {
    if (this.phase !== 'sweep') return 0;
    const t = this.phaseT;
    if (t < 0.25) return t / 0.25;
    if (t < 0.85) return 1;
    return Math.max(0, 1 - (t - 0.85) / 0.15);
  }

  private syncActors(): void {
    const time = performance.now() / 1000;
    const lift = this.liftAmount();
    this.sim.pins.forEach((p, i) => {
      const a = this.pinActors[i];
      if (p.state === 'cleared') {
        a.graphics.isVisible = false;
        return;
      }
      a.graphics.isVisible = true;
      if (p.state === 'standing') {
        a.graphics.use(this.standingGfx);
        a.z = 6;
        const wob = p.wobble;
        const drop = 1 - this.rackDrop;
        a.pos = ex.vec(p.x + Math.sin(time * 34 + p.id) * wob * 3.2, p.y + Math.cos(time * 29 + p.id) * wob * 2.4);
        const sc = 1 + wob * 0.05 + lift * 0.16 + drop * 0.45;
        a.scale = ex.vec(sc, sc);
        a.rotation = 0;
        a.graphics.opacity = 1 - drop * 0.9 - lift * 0.15;
      } else {
        a.graphics.use(this.fallenGfx);
        a.z = 4;
        a.pos = ex.vec(p.x, p.y);
        a.rotation = p.angle;
        if (p.state === 'down') {
          const k = Math.min(1, p.downT / 0.14);
          a.scale = ex.vec(0.3 + 0.7 * k, 1);
          a.graphics.opacity = 1;
        } else {
          const k = Math.min(1, p.pitT / 0.25);
          a.scale = ex.vec(1 - k * 0.3, 1 - k * 0.3);
          a.graphics.opacity = 1 - k;
        }
      }
    });

    const b = this.sim.ball;
    let scale = b.gutter ? 0.86 : 1;
    let opacity = 1;
    if (b.inPit) {
      const k = Math.min(1, b.pitT / 0.3);
      scale *= 1 - k * 0.35;
      opacity = 1 - k;
    }
    for (const a of [this.ball, this.ballGloss]) {
      a.pos = ex.vec(b.x, b.y);
      a.scale = ex.vec(scale, scale);
      a.graphics.opacity = opacity;
      a.graphics.isVisible = this.phase !== 'sweep';
    }
    this.ball.rotation = b.rot;
    this.ballShadow.pos = ex.vec(b.x + 5, b.y + 8);
    this.ballShadow.scale = ex.vec(scale, scale);
    this.ballShadow.graphics.opacity = opacity * (b.gutter ? 0.5 : 1);
    this.ballShadow.graphics.isVisible = this.phase !== 'sweep';
  }

  override onPostDraw(ctx: ex.ExcaliburGraphicsContext): void {
    const ox = (this.engine?.halfDrawWidth ?? 270) - this.camera.pos.x;
    const oy = (this.engine?.halfDrawHeight ?? 480) - this.camera.pos.y;
    ctx.save();
    ctx.translate(ox, oy);

    // Aim guide: a faint line up the board you're standing on.
    if (this.phase === 'aim') {
      const b = this.sim.ball;
      const pulse = 0.18 + 0.1 * Math.sin(performance.now() / 300);
      for (let y = b.y - BALL_R - 20; y > b.y - 760; y -= 26) {
        const fade = 1 - (b.y - y) / 760;
        ctx.drawRectangle(ex.vec(b.x - 1.5, y), 3, 12, ex.Color.fromRGB(255, 255, 255, pulse * fade));
      }
    }

    // Ball streak.
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const k = i / this.trail.length;
      ctx.drawLine(ex.vec(a.x, a.y), ex.vec(b.x, b.y), ex.Color.fromRGB(56, 243, 255, 0.16 * k), BALL_R * 2 * (0.4 + 0.6 * k));
      ctx.drawLine(ex.vec(a.x, a.y), ex.vec(b.x, b.y), ex.Color.fromRGB(255, 255, 255, 0.35 * k), 4 * k);
    }

    // The flick you just drew.
    if (this.fingerFade > 0 && this.fingerTrail.length > 1) {
      for (let i = 1; i < this.fingerTrail.length; i++) {
        const a = this.fingerTrail[i - 1];
        const b = this.fingerTrail[i];
        const k = i / this.fingerTrail.length;
        ctx.drawLine(
          ex.vec(a.x, a.y),
          ex.vec(b.x, b.y),
          ex.Color.fromRGB(255, 63, 164, 0.7 * k * this.fingerFade),
          3 + 5 * k,
        );
      }
    }

    // Sweep bar.
    if (this.phase === 'sweep') {
      const y = this.sweepY;
      ctx.drawRectangle(ex.vec(-WALL_X - 12, y - 16), (WALL_X + 12) * 2, 32, ex.Color.fromHex('#141032'));
      ctx.drawRectangle(ex.vec(-WALL_X - 12, y + 12), (WALL_X + 12) * 2, 4, ex.Color.fromHex(NEON.amber));
      ctx.drawRectangle(ex.vec(-WALL_X - 12, y + 16), (WALL_X + 12) * 2, 10, ex.Color.fromRGB(255, 200, 74, 0.18));
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
      ctx.drawRectangle(ex.vec(-c.w / 2, (-c.h / 2) * Math.abs(Math.cos(c.rot * 1.7))), c.w, c.h * Math.abs(Math.cos(c.rot * 1.7)) + 0.5, col);
      ctx.restore();
    }

    ctx.restore();
  }
}

