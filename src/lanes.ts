import * as ex from 'excalibur';
import {
  makeBall,
  makeBallGloss,
  makeBallShadow,
  makeDeckSpots,
  makeFallenPin,
  makeLaneTiles,
  makeStandingPin,
  NEON,
  repaintLane,
} from './art.ts';
import type { BallStyle } from './art.ts';
import { buzz, setRumble, Sfx } from './audio.ts';
import {
  BALL_R,
  BALL_START_Y,
  CLASSIC_RACK,
  HEAD_Y as PIN_HEAD_Y,
  MEGA_RACK,
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
import { flickThrow } from './flick.ts';
import { Gamepads, moveFocus, pressFocused, topDialog } from './gamepad.ts';
import { Motion, motionNeedsTap, motionSupported } from './motion.ts';
import { DROPS, hitTier, Run, pinInfo, POWERS } from './run.ts';
import { isSplit, provisionalTotal, scoreFrames } from './scoring.ts';
import { DEFAULT_MODS, NO_POWERS, powersFor, Sim } from './sim.ts';
import type { PinKind, PowerId } from './sim.ts';

export type Mode = 'classic' | 'run';

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
  /** Swing controls: the phone started swinging, so the ball stops following the thumb. */
  frozen: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Gentle ease for the long camera pan back to the bowler (peak speed ~1.6× average, not 3×). */
const easeSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
const RETURN_MS = 1300;
const CONFETTI_COLORS = [NEON.pink, NEON.cyan, NEON.amber, NEON.violet, '#ffffff', '#7dff9b'].map((c) =>
  ex.Color.fromHex(c),
);

export class Lanes extends ex.Scene {
  private readonly sim = new Sim();
  private readonly sfx = new Sfx();
  private readonly motion = new Motion();
  private readonly pads = new Gamepads();
  /** What the player last bowled or lined up with, for the how-to hint. */
  private lastInput: 'touch' | 'pad' = 'touch';
  /** Seconds left showing the board number after lining up with a controller. */
  private padBoardT = 0;
  /** The player chose swing controls (they apply once the sensors are running). */
  private swingWanted = false;
  /** Bumped on every swing toggle, so a slow permission answer can't undo a later choice. */
  private swingToken = 0;
  private phase: Phase = 'menu';

  // Actors
  private readonly pinActors: ex.Actor[] = [];
  private readonly standingGfx = makeStandingPin();
  private readonly fallenGfx = makeFallenPin();
  private readonly specialGfx = new Map<PinKind, { standing: ex.Canvas; fallen: ex.Canvas }>();
  private readonly ball = new ex.Actor({ z: 5 });
  private readonly ballGloss = new ex.Actor({ z: 5.1 });
  private readonly ballShadow = new ex.Actor({ z: 3 });
  private readonly spotsClassic = makeDeckSpots(CLASSIC_RACK);
  private readonly spotsMega = makeDeckSpots(MEGA_RACK);

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
  private mode: Mode = 'classic';
  private run: Run | null = null;
  private ballPowers: PowerId[] = [];
  private ballSpecials = 0;
  private stageOver = false;
  private bestRun = 0;

  // Presentation
  private camY = 0;
  /** Neon Run zooms out a little to fit its wider lane. */
  private zoom = 1;
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
  private zapBolts: { pts: { x: number; y: number }[]; t: number }[] = [];
  private laserBeams: { x: number; width: number; fromY: number; t: number }[] = [];
  /** Encore: extra balls granted in the current frame. */
  private bonusBalls = 0;
  private rings: { x: number; y: number; t: number }[] = [];
  private flames: Spark[] = [];

  private readonly hud: Hud;

  constructor(hud: Hud) {
    super();
    this.hud = hud;
  }

  override onInitialize(engine: ex.Engine): void {
    for (const t of makeLaneTiles()) this.add(t);
    this.add(this.spotsClassic);
    this.add(this.spotsMega);
    this.spotsMega.graphics.isVisible = false;
    this.ensurePinActors();
    for (const kind of ['gold', ...DROPS] as PinKind[]) {
      const info = pinInfo(kind)!;
      this.specialGfx.set(kind, { standing: makeStandingPin(info.color), fallen: makeFallenPin(info.color) });
    }
    this.ballShadow.graphics.use(makeBallShadow());
    this.ballGloss.graphics.use(makeBallGloss());
    this.add(this.ballShadow);
    this.add(this.ball);
    this.add(this.ballGloss);

    try {
      this.best = Number(localStorage.getItem('ps-best') ?? 0) || 0;
      this.bestRun = Number(localStorage.getItem('ps-best-run') ?? 0) || 0;
    } catch {
      /* ignore */
    }

    this.camY = this.aimCamY(engine);
    this.sim.placeBall(0);

    const toWorld = (e: PointerEvent) => engine.screen.pageToWorldCoordinates(ex.vec(e.pageX, e.pageY));
    setRumble((p) => this.pads.rumble(p));
    // A pointer or key press ends controller-style focus rings in menus.
    window.addEventListener('keydown', () => document.body.classList.remove('pad-nav'));
    window.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      document.body.classList.remove('pad-nav');
      this.useInput('touch');
      if ((e.target as HTMLElement).closest('button, input, label, .overlay')) return;
      this.onDown(toWorld(e), e.pointerId);
    });
    window.addEventListener('pointermove', (e) => this.onMove(toWorld(e), e.pointerId));
    window.addEventListener('pointerup', (e) => this.onUp(e.pointerId, false));
    window.addEventListener('pointercancel', (e) => this.onUp(e.pointerId, true));

    this.hud.onMute((m) => this.sfx.setMuted(m));
    this.initSwing();
    this.hud.onMenuButton(() => this.openMenu());
    this.openMenu();
  }

  // ---- Swing controls -----------------------------------------------------------

  /** Swing the phone to bowl, instead of flicking. Off by default; the choice is remembered. */
  private get swingControls(): boolean {
    return this.swingWanted && this.motion.active;
  }

  private initSwing(): void {
    const supported = motionSupported();
    this.hud.initSwing(supported, (on) => void this.setSwing(on));
    try {
      this.swingWanted = supported && localStorage.getItem('ps-swing') === '1';
    } catch {
      /* storage unavailable */
    }
    this.hud.setSwing(this.swingWanted);
    this.refreshHint();
    // Where no permission is needed, the sensors can start now. Otherwise (iOS, recent Chrome) access
    // is asked for on a tap: the switch, or Play.
    if (this.swingWanted && !motionNeedsTap()) void this.setSwing(true);
    if (new URLSearchParams(location.search).has('swingdebug')) {
      void import('./swing-debug.ts').then((m) => m.swingDebug(this.motion));
    }
  }

  private async setSwing(on: boolean): Promise<void> {
    const token = ++this.swingToken;
    const save = (v: boolean) => {
      try {
        localStorage.setItem('ps-swing', v ? '1' : '0');
      } catch {
        /* ignore */
      }
    };
    if (!on) {
      this.swingWanted = false;
      this.motion.stop();
      save(false);
      this.hud.setSwing(false);
      this.refreshHint();
      return;
    }
    this.hud.setSwing(true);
    const status = this.motion.active ? 'granted' : await this.motion.request();
    if (token !== this.swingToken) return;
    if (status !== 'granted') {
      this.swingWanted = false;
      save(false);
      this.hud.setSwing(
        false,
        status === 'denied'
          ? 'Motion access was blocked. Allow motion sensors for this site in your browser settings to swing.'
          : 'This device has no motion sensor to swing with.',
      );
      this.refreshHint();
      return;
    }
    const first = !this.swingWanted;
    this.swingWanted = true;
    save(true);
    this.hud.setSwing(true);
    this.refreshHint();
    if (first) {
      this.throws = 0;
      if (this.phase === 'aim') this.hud.hint(true);
      let seen = false;
      try {
        seen = localStorage.getItem('ps-swing-intro') === '1';
        localStorage.setItem('ps-swing-intro', '1');
      } catch {
        /* ignore */
      }
      if (!seen) this.hud.showSwingIntro();
    }
  }

  // ---- Controllers --------------------------------------------------------------

  private useInput(kind: 'touch' | 'pad'): void {
    if (this.lastInput === kind) return;
    this.lastInput = kind;
    this.refreshHint();
    if (this.phase === 'aim') this.hud.hint(true);
  }

  private refreshHint(): void {
    this.hud.setControlsHint(this.lastInput === 'pad' ? 'pad' : this.swingControls ? 'swing' : 'touch');
  }

  /** Reads the controllers once a frame: menus while a dialog is open, otherwise the game. */
  private handlePads(dt: number): void {
    const f = this.pads.poll();
    const dialog = topDialog();
    for (const e of f.events) {
      if (e.type === 'connected' || e.type === 'disconnected') {
        this.hud.setPadConnected(e.count, e.type === 'connected' ? 'Controller connected' : 'Controller disconnected');
        continue;
      }
      if (dialog) {
        if (e.type !== 'press') continue;
        if (e.button === 'confirm') {
          this.sfx.unlock();
          pressFocused(dialog);
        } else if (e.button === 'up' || e.button === 'down' || e.button === 'left' || e.button === 'right') {
          moveFocus(dialog, e.button);
        }
        continue;
      }
      if (e.type === 'throw') {
        if (this.phase === 'aim' && !this.gesture) {
          this.useInput('pad');
          this.padBoardT = 0;
          this.hud.setBoardNumber(null);
          if (e.throw) this.throwBall(e.throw.speed, e.throw.angle, e.throw.spin);
        }
        continue;
      }
      if (e.button === 'confirm') {
        this.sfx.unlock();
        this.hurry();
      } else if (e.button === 'menu') {
        if (this.phase !== 'menu') this.openMenu();
      } else if (e.button.startsWith('slot')) {
        const i = Number(e.button.slice(4)) - 1;
        if (this.run && this.phase === 'aim' && this.run.inventory[i]) this.toggleArm(i);
      }
    }

    // Lining up with a stick or the d-pad.
    if (dialog || this.phase !== 'aim' || this.gesture) return;
    if (f.swinging) {
      this.useInput('pad');
      this.padBoardT = 0;
      this.hud.setBoardNumber(null);
    } else if (f.aim) {
      this.useInput('pad');
      const lim = LANE_HALF - BALL_R + 8;
      const x = Math.max(-lim, Math.min(lim, this.sim.ball.x + f.aim * 260 * dt));
      if (boardAt(x) !== boardAt(this.sim.ball.x)) this.sfx.tick();
      this.sim.ball.x = x;
      this.hud.setBoardNumber(boardAt(x));
      this.padBoardT = 0.8;
    } else if (this.padBoardT > 0) {
      this.padBoardT -= dt;
      if (this.padBoardT <= 0) this.hud.setBoardNumber(null);
    }
  }

  // ---- Flow -----------------------------------------------------------------

  private openMenu(): void {
    this.phase = 'menu';
    this.gesture = null;
    this.hud.hint(false);
    this.hud.setBoardNumber(null);
    this.hud.showMenu(this.best, this.bestRun, (style, bumpers, mode) => this.newGame(style, bumpers, mode));
  }

  private newGame(style: BallStyle, bumpers: boolean, mode: Mode = this.mode): void {
    // Called from a tap (Play, Bowl again), when browsers let us ask for motion access.
    if (this.swingWanted && !this.motion.active) void this.setSwing(true);
    if (style !== this.style) this.ball.graphics.use(makeBall(style));
    this.style = style;
    this.mode = mode;
    this.bumpers = mode === 'classic' && bumpers;
    this.sim.bumpers = this.bumpers;
    this.sim.powers = { ...NO_POWERS };
    this.sim.mods = { ...DEFAULT_MODS };
    this.run = mode === 'run' ? new Run() : null;
    const layout = mode === 'run' ? MEGA_RACK : CLASSIC_RACK;
    if (this.sim.layout !== layout) {
      this.sim.setLayout(layout);
      this.ensurePinActors();
      repaintLane();
    }
    this.zoom = layout === MEGA_RACK ? 0.88 : 1;
    this.camera.zoom = this.zoom;
    this.camY = this.aimCamY();
    this.hud.setRackLayout(layout.rows);
    this.spotsClassic.graphics.isVisible = layout === CLASSIC_RACK;
    this.spotsMega.graphics.isVisible = layout === MEGA_RACK;
    this.stageOver = false;
    this.hud.setMode(mode);
    this.frame = 0;
    this.ballInFrame = 0;
    this.rolls = [];
    this.tenth = [];
    this.standingBefore = this.sim.rackSize;
    this.streak = 0;
    this.strikes = 0;
    this.spares = 0;
    this.gameOver = false;
    this.sim.resetRack();
    this.applySpecials();
    this.rackDrop = 0;
    this.lastX = 0;
    this.sim.placeBall(this.lastX);
    this.confetti = [];
    this.sparks = [];
    this.trail = [];
    this.refreshHud();
    this.hud.hideThrow();
    if (this.run) this.startStage();
    this.beginAim();
  }

  private ensurePinActors(): void {
    while (this.pinActors.length < this.sim.pins.length) {
      const a = new ex.Actor({ z: 6 });
      a.graphics.use(this.standingGfx);
      this.pinActors.push(a);
      this.add(a);
    }
  }

  // ---- Roguelike run --------------------------------------------------------

  private startStage(): void {
    const run = this.run!;
    this.sim.mods = run.mods();
    this.stageOver = false;
    if (run.has('surge')) {
      for (let i = 0; i < run.has('surge'); i++) {
        if (run.inventory.length < run.slots) run.inventory.push(run.randomPower());
      }
    }
    const st = run.stageInfo;
    if (st.boss) this.hud.banner('BOSS LANE', `${st.name}: ${st.boss}`, 'split', 2600);
    else this.hud.banner(`STAGE ${run.stage + 1}`, `${st.name} · Score ${st.target} to advance`, 'plain', 2200);
    this.refreshHud();
  }

  /** Marks the special pins in a fresh rack (classic mode has none). */
  private applySpecials(): void {
    for (const p of this.sim.pins) p.kind = 'normal';
    if (!this.run) return;
    for (const [id, kind] of this.run.rollSpecials(this.sim.rackSize)) this.sim.pins[id - 1].kind = kind;
    this.hud.setRack(this.sim.standing().map((p) => p.id), this.rackColors());
  }

  private rackColors(): Map<number, string> {
    const m = new Map<number, string>();
    for (const p of this.sim.pins) {
      if (p.kind !== 'normal' && p.state === 'standing') m.set(p.id, pinInfo(p.kind)!.color);
    }
    return m;
  }

  private toggleArm(i: number): void {
    const run = this.run;
    if (!run || this.phase !== 'aim' || i >= run.inventory.length) return;
    if (run.armed.has(i)) run.armed.delete(i);
    else run.armed.add(i);
    this.sfx.tick();
    this.hud.renderInventory(run, (k) => this.toggleArm(k));
    this.syncBallSize();
  }

  /** Previews Mega Ball while it's armed. */
  private syncBallSize(): void {
    const run = this.run;
    const megaArmed = !!run && [...run.armed].some((i) => run.inventory[i] === 'mega');
    if (this.phase === 'aim') this.sim.powers = { ...NO_POWERS, mega: megaArmed };
  }

  private endStage(): void {
    const run = this.run!;
    if (!run.cleared) {
      this.runOver(false);
      return;
    }
    if (run.isFinalStage) {
      this.runOver(true);
      return;
    }
    this.hud.hideThrow();
    const reward = run.stageReward();
    for (const r of reward) run.coins += r.coins;
    this.phase = 'over';
    this.sfx.fanfare(1);
    this.burstConfetti(120);
    this.hud.showShop(run, reward, () => {
      run.nextStage();
      this.frame = 0;
      this.ballInFrame = 0;
      this.standingBefore = this.sim.rackSize;
      this.sim.clearDeadwood();
      this.sim.resetRack();
      this.applySpecials();
      this.rackDrop = 0;
      this.startStage();
      this.returnFrom = this.camY;
      this.sim.placeBall(this.lastX);
      this.setPhase('return', RETURN_MS);
    }, () => this.sfx.chime());
  }

  private runOver(victory: boolean): void {
    const run = this.run!;
    this.phase = 'over';
    const reached = run.stage + (victory ? 1 : 0);
    const newBest = reached > this.bestRun || (victory && reached === this.bestRun);
    if (reached > this.bestRun) {
      this.bestRun = reached;
      try {
        localStorage.setItem('ps-best-run', String(reached));
      } catch {
        /* ignore */
      }
    }
    if (victory) {
      this.burstConfetti(300);
      this.sfx.fanfare(2);
    } else {
      this.sfx.womp();
    }
    this.hud.hideThrow();
    this.hud.showRunOver(run, victory, newBest, () => this.newGameSame(), () => this.openMenu());
  }

  private beginAim(): void {
    this.phase = 'aim';
    const frames = this.run ? `/${this.run.framesPerStage}` : '';
    this.hud.setStatus(`Frame ${this.frame + 1}${frames} · Ball ${this.ballInFrame + 1}`);
    // Safety Net perk: bumpers for every spare attempt.
    if (this.run) this.sim.bumpers = this.run.has('safety') > 0 && this.standingBefore < this.sim.rackSize;
    this.syncBallSize();
    if (this.throws < 2) this.hud.hint(true, 300);
  }

  private refreshHud(): void {
    if (this.run) {
      this.hud.renderRun(this.run, this.frame);
      this.hud.renderInventory(this.run, (k) => this.toggleArm(k));
      this.hud.setScore(this.run.totalScore);
    } else {
      this.hud.renderBoard(scoreFrames(this.rolls), this.gameOver ? -1 : this.frame);
      this.hud.setScore(provisionalTotal(this.rolls));
    }
    this.hud.setRack(this.sim.standing().map((p) => p.id), this.rackColors());
  }

  // ---- Input ------------------------------------------------------------------

  /** A tap (or the confirm button) hurries the between-ball sequence along. */
  private hurry(): void {
    if ((this.phase === 'result' || this.phase === 'return') && this.phaseT > 0.35) {
      this.phaseT = Math.max(this.phaseT, this.phaseDur - 0.05);
    }
  }

  private onDown(pos: ex.Vector, id: number): void {
    if (this.phase !== 'aim') {
      this.hurry();
      return;
    }
    if (this.gesture) return;
    const s = { x: pos.x, y: pos.y, t: performance.now() / 1000 };
    this.gesture = { id, samples: [s], startX: pos.x, ballX0: this.sim.ball.x, mode: 'position', lowestIdx: 0, frozen: false };
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
    if (!this.swingControls) {
      this.fingerTrail.push(s);
      if (this.fingerTrail.length > 60) this.fingerTrail.shift();
    }

    if (g.mode === 'position') {
      if (pos.y >= g.samples[g.lowestIdx].y) g.lowestIdx = g.samples.length - 1;
      const climbed = g.samples[g.lowestIdx].y - pos.y;
      if (this.swingControls) {
        // The thumb only lines up; once the phone swings, the ball stays put.
        if (!g.frozen && this.motion.swinging()) {
          g.frozen = true;
          this.hud.setBoardNumber(null);
        }
      } else if (climbed > 30) {
        g.mode = 'throw';
        this.hud.setBoardNumber(null);
      }
      if (g.mode === 'position' && !g.frozen) {
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
    if (cancelled || this.phase !== 'aim') return;
    if (this.swingControls) {
      const swing = this.motion.release();
      if (swing) this.throwBall(MIN_SPEED + swing.power * (MAX_SPEED - MIN_SPEED), swing.angle, swing.spin);
      return;
    }
    if (g.mode !== 'throw') return;

    const t = flickThrow(g.samples.slice(g.lowestIdx));
    if (t) this.throwBall(t.speed, t.angle, t.spin);
  }

  private throwBall(speed: number, angle: number, spin: number): void {
    this.lastX = this.sim.ball.x;
    this.ballPowers = this.run ? this.run.consumeArmed() : [];
    this.ballSpecials = 0;
    const has = (p: PowerId) => this.ballPowers.includes(p);
    this.sim.powers = powersFor(this.ballPowers);
    if (has('rails')) this.sim.bumpers = true;
    if (has('encore')) this.bonusBalls++;
    const standing = this.sim.standing();
    if (standing.length >= this.sim.rackSize - 1 || standing.length === 0) {
      const line = this.sim.layout.homingLine ?? 24;
      this.sim.homingX = spin > 0.05 ? -line : line;
    } else {
      this.sim.homingX = standing.reduce((a, p) => a + p.x, 0) / standing.length;
    }
    if (this.ballPowers.length) {
      const names = this.ballPowers.map((p) => `${POWERS[p].icon} ${POWERS[p].name}`).join(' + ');
      this.hud.banner('POWER UP!', names, 'spare', 1100);
      this.sfx.chime();
      if (this.run) this.hud.renderInventory(this.run, (k) => this.toggleArm(k));
    }
    this.sim.launch(speed, angle, spin);
    this.phase = 'roll';
    this.throws++;
    this.trail = [];
    this.hud.hint(false);
    this.hud.showThrow(speedToMph(speed), spin);
    this.sfx.release();
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
    const rack = this.sim.rackSize;
    const fullRack = this.standingBefore === rack;
    this.rolls.push(knocked);

    // Message.
    let ms = 1300;
    if (this.run) {
      ms = this.runBallResult(knocked, rack, fullRack, standing.length);
    } else if (fullRack && knocked === 10) {
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
    if (this.run) {
      // A frame is two balls, plus one per Encore, and ends early once the rack is clear.
      if (standing.length === 0 || this.ballInFrame >= 1 + this.bonusBalls) {
        this.nextFrame();
        this.run.frameInStage = this.frame;
        if (this.frame >= this.run.framesPerStage) this.stageOver = true;
      } else {
        this.ballInFrame++;
      }
    } else if (this.frame < 9) {
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
    this.standingBefore = this.resetAfter ? rack : standing.length;

    this.refreshHud();
    this.setPhase('result', ms);
  }

  /** Neon Run's per-ball banner and points. Returns how long to show the result. */
  private runBallResult(knocked: number, rack: number, fullRack: boolean, left: number): number {
    const run = this.run!;
    const tier = hitTier(knocked, rack, fullRack);
    const spare = !fullRack && left === 0;
    if (tier === 'clear' || tier === 'big') this.streak++;
    else if (fullRack) this.streak = 0;
    const pts = run.points(knocked, tier, spare, this.streak, this.ballSpecials, this.ballPowers);
    run.addPoints(pts.total);
    if (this.ballPowers.includes('midas')) {
      const coins = Math.floor(knocked / 5);
      if (coins) {
        run.coins += coins;
        const page = this.engine.screen.worldToPageCoordinates(ex.vec(0, PIN_HEAD_Y - 120));
        this.hud.floatText(`👑 +${coins} 🪙`, page.x, page.y, POWERS.midas.color);
      }
    }
    if (tier === 'clear') run.strikes++;
    if (tier === 'clear' || tier === 'big') run.bigHits++;
    if (spare) run.spares++;
    this.hud.points(pts);

    const streakText = this.streak >= 2 ? ` · ${this.streak} in a row!` : '';
    let ms = 1500;
    if (tier === 'clear') {
      this.hud.banner('MEGA STRIKE!', `All ${rack} pins down${streakText}`, 'strike', 2200);
      this.hud.flash('rgba(255,255,255,0.9)');
      this.sfx.fanfare(2);
      this.burstConfetti(320);
      this.shake = Math.max(this.shake, 20);
      buzz([40, 40, 80, 40, 120]);
      ms = 2300;
    } else if (tier === 'big') {
      this.hud.banner('BIG HIT!', `${knocked} of ${rack}${streakText}`, 'strike', 1700);
      this.hud.flash('rgba(255,255,255,0.6)');
      this.sfx.fanfare(Math.min(2, this.streak - 1));
      this.burstConfetti(110 + this.streak * 30);
      this.shake = Math.max(this.shake, 12);
      buzz([30, 40, 60]);
      ms = 1900;
    } else if (spare) {
      this.hud.banner('SPARE!', `Cleared the last ${knocked}`, 'spare', 1500);
      this.hud.flash('rgba(56,243,255,0.4)');
      this.sfx.chime();
      this.burstConfetti(80);
      buzz([20, 30, 20]);
    } else if (knocked === 0) {
      this.hud.banner(this.sim.ball.gutter ? 'GUTTER' : 'MISS', 'Not a pin', 'gutter', 1400);
      this.sfx.womp();
    } else if (tier === 'nice') {
      this.hud.banner('NICE HIT', `${knocked} of ${rack} · ${left} left`, 'spare', 1500);
    } else {
      this.hud.banner(`${knocked} PINS`, fullRack ? `${left} left standing` : `${left} still up`, 'plain', 1400);
    }
    return ms;
  }

  private nextFrame(): void {
    this.frame++;
    this.bonusBalls = 0;
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

  /** Stereo position for a sound at lane x: -1 at the left wall, 1 at the right. */
  private panAt(x: number): number {
    return Math.max(-1, Math.min(1, x / WALL_X));
  }

  private handleEvents(): void {
    for (const e of this.sim.events) {
      switch (e.type) {
        case 'ballPin': {
          const big = e.power > 380;
          this.sfx.clack(Math.min(1, e.power / 500), big, this.panAt(e.x));
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
          this.sfx.clack(Math.min(1, e.power / 420), false, this.panAt(e.x));
          this.spawnSparks(e.x, e.y, e.power * 0.6, true);
          this.shake = Math.max(this.shake, Math.min(6, e.power / 90));
          break;
        case 'wall':
          this.sfx.panel(Math.min(1, e.power / 600), this.panAt(e.x));
          break;
        case 'bumper':
          this.sfx.thump(0.5, this.panAt(e.x));
          this.spawnSparks(e.x, e.y, 300, false);
          break;
        case 'gutter':
          this.sfx.gutter(this.panAt(e.x));
          break;
        case 'pit':
          this.sfx.thump(0.25, this.panAt(e.x));
          break;
        case 'pinDown':
          if (this.run && e.kind !== 'normal') {
            const label = this.run.collect(e.kind);
            this.ballSpecials++;
            const info = pinInfo(e.kind)!;
            const page = this.engine.screen.worldToPageCoordinates(ex.vec(e.x, e.y));
            this.hud.floatText(label, page.x, page.y, info.color);
            this.hud.renderInventory(this.run, (k) => this.toggleArm(k));
            this.hud.renderRun(this.run, this.frame);
            this.sfx.collect(this.panAt(e.x));
            this.spawnSparks(e.x, e.y, 700, false);
          }
          break;
        case 'bomb':
          this.rings.push({ x: e.x, y: e.y, t: 0 });
          this.shake = Math.max(this.shake, 24);
          this.hitStop = Math.max(this.hitStop, 0.09);
          this.hud.flash('rgba(255,140,60,0.7)');
          this.sfx.boom(this.panAt(e.x));
          this.spawnSparks(e.x, e.y, 1800, false);
          this.spawnSparks(e.x, e.y, 1200, true);
          buzz([60, 30, 80]);
          break;
        case 'hole':
          this.shake = Math.max(this.shake, 14);
          this.hitStop = Math.max(this.hitStop, 0.06);
          this.hud.flash('rgba(155,107,255,0.45)');
          this.sfx.vortex(this.panAt(e.x));
          buzz([80, 40, 120]);
          break;
        case 'laser':
          this.laserBeams.push({ x: e.x, width: e.width, fromY: this.sim.ball.y, t: 0 });
          this.hud.flash('rgba(255,59,59,0.35)');
          this.sfx.laser(this.panAt(e.x));
          this.shake = Math.max(this.shake, 8);
          buzz(40);
          break;
        case 'quake':
          this.hud.flash('rgba(255,138,61,0.4)');
          this.sfx.quake();
          buzz([100, 50, 100, 50, 150]);
          break;
        case 'ricochet':
          this.sfx.ricochet(this.panAt(e.x));
          this.spawnSparks(e.x, e.y, 500, false);
          this.shake = Math.max(this.shake, 5);
          break;
        case 'zap': {
          const pts = [{ x: e.x1, y: e.y1 }];
          for (let k = 1; k < 7; k++) {
            const t = k / 7;
            pts.push({ x: e.x1 + (e.x2 - e.x1) * t + rand(-14, 14), y: e.y1 + (e.y2 - e.y1) * t + rand(-14, 14) });
          }
          pts.push({ x: e.x2, y: e.y2 });
          this.zapBolts.push({ pts, t: 0 });
          this.sfx.zap(this.panAt((e.x1 + e.x2) / 2));
          this.shake = Math.max(this.shake, 6);
          break;
        }
      }
    }
    this.sim.events = [];
  }

  private slowStarted = false;

  // ---- Frame loop -------------------------------------------------------------------

  /** Visible world height (the camera zoom shows more world when < 1). */
  private viewH(): number {
    return (this.engine?.drawHeight ?? 960) / this.zoom;
  }

  private aimCamY(engine?: ex.Engine): number {
    const vh = engine ? engine.drawHeight / this.zoom : this.viewH();
    // In Neon Run the ball sits a little higher so the power-up slots don't cover it.
    return BALL_START_Y - vh * (this.run ? 0.24 : 0.34);
  }

  private deckCamY(): number {
    // Put the pit's edge just below the header so the whole rack is visible.
    return PIT_Y - 240 / this.zoom + this.viewH() / 2;
  }

  override onPreUpdate(engine: ex.Engine, elapsed: number): void {
    const dt = Math.min(elapsed / 1000, 0.05);
    this.phaseT += dt;
    this.handlePads(dt);

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
            this.sfx.rollUpdate(Math.hypot(b.vx, b.vy) / MAX_SPEED, b.gutter, this.panAt(b.x));
          }
        }
        // Follow the ball down the lane, but stay on the pins once it reaches them.
        const target = this.sim.contact ? this.deckCamY() : Math.max(this.deckCamY(), b.y - this.viewH() * 0.16);
        this.camY += (target - this.camY) * (1 - Math.exp(-9 * dt));
        if (this.sim.settled()) {
          this.slowStarted = false;
          this.finishBall();
        }
        break;
      }
      case 'result':
        // The roll is decided and everything has settled: freeze the deck so
        // resting pins stay exactly where they landed.
        this.handleEvents();
        if (this.trail.length) this.trail.shift();
        this.camY += (this.deckCamY() - this.camY) * (1 - Math.exp(-6 * dt));
        if (this.phaseT >= this.phaseDur) {
          if (this.gameOver) this.endGame();
          else if (this.stageOver) this.endStage();
          else {
            this.setPhase('sweep', 1000);
            this.sweepCleared = false;
            this.sfx.sweep();
          }
        }
        break;
      case 'sweep':
        this.updateSweep();
        if (this.phaseT >= this.phaseDur) {
          this.returnFrom = this.camY;
          this.sim.placeBall(this.lastX);
          this.setPhase('return', RETURN_MS);
          this.hud.hideThrow();
        }
        break;
      case 'return': {
        const k = easeSine(Math.min(1, this.phaseT / this.phaseDur));
        this.camY = this.returnFrom + (this.aimCamY(engine) - this.returnFrom) * k;
        if (this.phaseT >= this.phaseDur) this.beginAim();
        break;
      }
      case 'over':
      case 'menu':
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
    for (const p of this.sim.pins) {
      if (p.burning && (p.state === 'down' || p.state === 'standing') && Math.random() < 0.6) {
        this.flames.push({
          x: p.x + rand(-20, 20),
          y: p.y + rand(-14, 14),
          vx: rand(-20, 20),
          vy: rand(-60, -20),
          life: 0,
          max: rand(0.25, 0.5),
          size: rand(3, 7),
          color: ex.Color.fromHex(Math.random() < 0.5 ? '#ff7a2b' : '#ffd166'),
        });
      }
    }
    const b0 = this.sim.ball;
    if (this.sim.powers.fire && b0.rolling && !b0.inPit) {
      for (let k = 0; k < 3; k++) {
        this.flames.push({
          x: b0.x + rand(-18, 18),
          y: b0.y + rand(0, 30),
          vx: rand(-30, 30),
          vy: rand(40, 120),
          life: 0,
          max: rand(0.2, 0.45),
          size: rand(4, 9),
          color: ex.Color.fromHex(Math.random() < 0.5 ? '#ff5a1f' : '#ffc84a'),
        });
      }
    }
    for (const f of this.flames) {
      f.life += dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    this.flames = this.flames.filter((f) => f.life < f.max);
    for (const z of this.zapBolts) z.t += dt;
    this.zapBolts = this.zapBolts.filter((z) => z.t < 0.35);
    for (const l of this.laserBeams) l.t += dt;
    this.laserBeams = this.laserBeams.filter((l) => l.t < 0.6);
    // The deck keeps shaking for as long as the quake lasts.
    if (this.sim.quakeT > 0) this.shake = Math.max(this.shake, 9);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < 0.5);
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
          this.applySpecials();
          this.rackDrop = 0;
        }
        this.hud.setRack(this.sim.standing().map((p) => p.id), this.rackColors());
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
    const ps = this.sim.layout.pinScale;
    for (let i = this.sim.pins.length; i < this.pinActors.length; i++) this.pinActors[i].graphics.isVisible = false;
    this.sim.pins.forEach((p, i) => {
      const a = this.pinActors[i];
      if (p.state === 'cleared') {
        a.graphics.isVisible = false;
        return;
      }
      a.graphics.isVisible = true;
      const special = p.kind !== 'normal' ? this.specialGfx.get(p.kind) : undefined;
      if (p.state === 'standing') {
        a.graphics.use(special?.standing ?? this.standingGfx);
        a.z = 6;
        const wob = p.wobble;
        const drop = 1 - this.rackDrop;
        a.pos = ex.vec(p.x + Math.sin(time * 34 + p.id) * wob * 3.2, p.y + Math.cos(time * 29 + p.id) * wob * 2.4);
        const pulse = special ? Math.sin(time * 5 + p.id) * 0.06 : 0;
        const sc = (1 + pulse + wob * 0.05 + lift * 0.16 + drop * 0.45) * ps;
        a.scale = ex.vec(sc, sc);
        a.rotation = 0;
        a.graphics.opacity = 1 - drop * 0.9 - lift * 0.15;
      } else {
        a.graphics.use(special?.fallen ?? this.fallenGfx);
        a.z = 4;
        a.pos = ex.vec(p.x, p.y);
        a.rotation = p.angle;
        if (p.state === 'down') {
          const k = Math.min(1, p.downT / 0.14);
          a.scale = ex.vec((0.3 + 0.7 * k) * ps, ps);
          a.graphics.opacity = 1;
        } else {
          const k = Math.min(1, p.pitT / 0.25);
          a.scale = ex.vec((1 - k * 0.3) * ps, (1 - k * 0.3) * ps);
          a.graphics.opacity = 1 - k;
        }
      }
    });

    const b = this.sim.ball;
    let scale = (b.gutter ? 0.86 : 1) * (this.sim.ballR / BALL_R);
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

  /** Effects for the newer power-ups, drawn in world space. */
  private drawPowerFx(ctx: ex.ExcaliburGraphicsContext): void {
    const now = performance.now() / 1000;
    const b = this.sim.ball;
    const rolling = this.phase === 'roll' && b.rolling && !b.inPit;

    // Magnet: a field pulsing out from the ball.
    if (rolling && this.sim.powers.magnet) {
      for (let i = 0; i < 3; i++) {
        const k = (now * 1.6 + i / 3) % 1;
        ctx.drawCircle(ex.vec(b.x, b.y), this.sim.ballR + 20 + k * 80, ex.Color.Transparent, ex.Color.fromRGB(255, 94, 196, 0.5 * (1 - k)), 2);
      }
    }

    // Midas Ball: a golden halo.
    if (rolling && this.ballPowers.includes('midas')) {
      const pulse = 1 + 0.08 * Math.sin(now * 8);
      ctx.drawCircle(ex.vec(b.x, b.y), this.sim.ballR * 1.45 * pulse, ex.Color.fromRGB(255, 207, 51, 0.18), ex.Color.fromRGB(255, 230, 140, 0.8), 3);
    }

    // Black Hole: a dark core with arms spiralling in.
    const h = this.sim.hole;
    if (h) {
      const fade = Math.min(1, h.t / 0.25);
      const reach = this.sim.bombRadius * 1.8;
      ctx.drawCircle(ex.vec(h.x, h.y), reach * 0.55, ex.Color.fromRGB(40, 10, 80, 0.25 * fade));
      for (let arm = 0; arm < 6; arm++) {
        let prev: ex.Vector | null = null;
        for (let j = 0; j <= 10; j++) {
          const r = 22 + (reach * 0.7 * j) / 10;
          const a = now * 5 + (arm * Math.PI) / 3 + j * 0.32;
          const p = ex.vec(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r);
          if (prev) ctx.drawLine(prev, p, ex.Color.fromRGB(155, 107, 255, 0.55 * fade * (1 - j / 11)), 4);
          prev = p;
        }
      }
      ctx.drawCircle(ex.vec(h.x, h.y), 26, ex.Color.fromHex('#05020f'), ex.Color.fromRGB(200, 170, 255, fade), 3);
    }

    // Pin Laser: a beam from the ball to the pit along its line, fading out.
    for (const l of this.laserBeams) {
      const a = 1 - l.t / 0.6;
      const top = PIT_Y - 60;
      const len = l.fromY - top;
      ctx.drawRectangle(ex.vec(l.x - l.width, top), l.width * 2, len, ex.Color.fromRGB(255, 59, 59, 0.22 * a));
      ctx.drawRectangle(ex.vec(l.x - l.width * 0.25, top), l.width * 0.5, len, ex.Color.fromRGB(255, 220, 220, 0.85 * a));
    }
  }

  override onPostDraw(ctx: ex.ExcaliburGraphicsContext): void {
    // Post-draw runs in screen space: apply the camera (zoom and shake) by hand. The screen centre
    // comes from the resolution: the engine's halfDrawWidth/Height are already divided by the zoom,
    // which put every effect off-centre in Neon Run (zoom 0.88).
    ctx.save();
    const res = this.engine?.screen.resolution;
    ctx.translate((res?.width ?? 540) / 2, (res?.height ?? 960) / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.camera.pos.x, -this.camera.pos.y);

    // Aim guide: a faint line up the board you're standing on.
    if (this.sim.bumpers && this.phase !== 'menu') {
      for (const sgn of [-1, 1]) {
        const x = sgn * (LANE_HALF - 2);
        ctx.drawRectangle(ex.vec(x - 3, DECK_Y), 6, -DECK_Y, ex.Color.fromRGB(125, 255, 155, 0.25));
        ctx.drawRectangle(ex.vec(x - 1, DECK_Y), 2, -DECK_Y, ex.Color.fromHex('#7dff9b'));
      }
    }

    if (this.phase === 'aim') {
      const b = this.sim.ball;
      const pulse = 0.18 + 0.1 * Math.sin(performance.now() / 300);
      const reach = this.run?.has('laser') ? b.y - DECK_Y + 60 : 760;
      for (let y = b.y - BALL_R - 20; y > b.y - reach; y -= 26) {
        const fade = this.run?.has('laser') ? 0.8 : 1 - (b.y - y) / reach;
        ctx.drawRectangle(ex.vec(b.x - 1.5, y), 3, 12, ex.Color.fromRGB(255, 255, 255, pulse * fade));
      }
    }

    // Ball streak.
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const k = i / this.trail.length;
      const tc = this.sim.powers.fire ? [255, 120, 40] : this.sim.powers.homing ? [180, 124, 255] : [56, 243, 255];
      ctx.drawLine(ex.vec(a.x, a.y), ex.vec(b.x, b.y), ex.Color.fromRGB(tc[0], tc[1], tc[2], 0.16 * k), this.sim.ballR * 2 * (0.4 + 0.6 * k));
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

    if (this.sim.powers.homing && this.phase === 'roll') {
      const pulse = 1 + 0.15 * Math.sin(performance.now() / 120);
      const pos = ex.vec(this.sim.homingX, PIN_HEAD_Y + 40);
      ctx.drawCircle(pos, 26 * pulse, ex.Color.Transparent, ex.Color.fromHex('#b47cff'), 3);
      ctx.drawCircle(pos, 6, ex.Color.fromHex('#b47cff'));
    }

    for (const r of this.rings) {
      const k = r.t / 0.5;
      ctx.drawCircle(ex.vec(r.x, r.y), this.sim.bombRadius * (0.3 + 0.9 * k), ex.Color.fromRGB(255, 160, 60, 0.45 * (1 - k)), ex.Color.fromRGB(255, 240, 200, 1 - k), 6);
    }

    for (const f of this.flames) {
      const c = f.color.clone();
      c.a = 0.9 * (1 - f.life / f.max);
      ctx.drawCircle(ex.vec(f.x, f.y), f.size * (1 - f.life / f.max * 0.5), c);
    }

    this.drawPowerFx(ctx);

    for (const z of this.zapBolts) {
      const a = 1 - z.t / 0.35;
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
      ctx.drawRectangle(ex.vec(-c.w / 2, (-c.h / 2) * Math.abs(Math.cos(c.rot * 1.7))), c.w, c.h * Math.abs(Math.cos(c.rot * 1.7)) + 0.5, col);
      ctx.restore();
    }

    ctx.restore();
  }
}

