// Phone motion sensors for "swing the phone to bowl". This is the browser side: permission, the
// `devicemotion` listener and a short buffer of readings. The swing maths is in src/swing.ts.
import { detectSwing, isSwinging } from './swing.ts';
import type { MotionSample, SwingThrow } from './swing.ts';

type PermissionState = 'granted' | 'denied';
/** iOS Safari and recent Chrome: motion access must be asked for from a tap. */
type MotionEventClass = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };

const MotionEvent = (globalThis as { DeviceMotionEvent?: MotionEventClass }).DeviceMotionEvent;

/** Seconds of readings kept: enough for a backswing, a pause and the delivery. */
const KEEP = 2.5;

export type MotionStatus = 'granted' | 'denied' | 'unavailable';

/**
 * Whether to offer swing controls at all: the browser must know about motion events, and the main
 * pointer must be a finger (desktops expose `DeviceMotionEvent` without a sensor behind it).
 */
export function motionSupported(): boolean {
  return !!MotionEvent && window.matchMedia('(pointer: coarse)').matches;
}

/** True where motion access needs a tap first (iOS, recent Chrome), so it can't start at page load. */
export function motionNeedsTap(): boolean {
  return typeof MotionEvent?.requestPermission === 'function';
}

export interface SwingRecord {
  samples: MotionSample[];
  release: number;
  result: SwingThrow | null;
}

export class Motion {
  private samples: MotionSample[] = [];
  private listening = false;
  private gotData = false;
  /** The last release, for the `?swingdebug` overlay. */
  last: SwingRecord | null = null;
  /** Called for every reading (debug overlay only). */
  onSample: ((s: MotionSample) => void) | null = null;

  get active(): boolean {
    return this.listening && this.gotData;
  }

  /**
   * Asks for motion access (call it from a tap: browsers that prompt do so only then), starts listening and
   * waits briefly for the first reading, since some devices have the API but no gyroscope.
   */
  async request(): Promise<MotionStatus> {
    if (!MotionEvent) return 'unavailable';
    if (motionNeedsTap()) {
      try {
        if ((await MotionEvent.requestPermission!()) !== 'granted') return 'denied';
      } catch {
        return 'denied';
      }
    }
    this.start();
    if (await this.waitForData(1500)) return 'granted';
    this.stop();
    return 'unavailable';
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.onMotion);
    this.listening = false;
    this.gotData = false;
    this.samples = [];
  }

  /** True while the phone is turning fast (mid-swing). */
  swinging(): boolean {
    return isSwinging(this.samples, performance.now() / 1000);
  }

  /** The thumb lifted: turns the recent motion into a throw, or `null` if there was no swing. */
  release(): SwingThrow | null {
    const t = performance.now() / 1000;
    const result = detectSwing(this.samples, t);
    this.last = { samples: this.samples.slice(), release: t, result };
    return result;
  }

  private start(): void {
    if (this.listening) return;
    window.addEventListener('devicemotion', this.onMotion);
    this.listening = true;
  }

  private waitForData(ms: number): Promise<boolean> {
    if (this.gotData) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const poll = () => {
        if (this.gotData) resolve(true);
        else if (performance.now() - t0 > ms) resolve(false);
        else window.setTimeout(poll, 50);
      };
      poll();
    });
  }

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const r = e.rotationRate;
    const a = e.accelerationIncludingGravity;
    // Devices without a gyroscope report nulls; there's no swing to read from those.
    if (
      !r ||
      !a ||
      r.alpha === null ||
      r.beta === null ||
      r.gamma === null ||
      a.x === null ||
      a.y === null ||
      a.z === null
    )
      return;
    this.gotData = true;
    const s: MotionSample = { t: e.timeStamp / 1000, ax: a.x, ay: a.y, az: a.z, rx: r.beta, ry: r.gamma, rz: r.alpha };
    this.samples.push(s);
    while (this.samples.length && s.t - this.samples[0].t > KEEP) this.samples.shift();
    this.onSample?.(s);
  };
}
