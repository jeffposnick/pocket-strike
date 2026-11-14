// Game controllers through the Gamepad API: any controller the browser and operating system
// recognise, over USB or Bluetooth. Polled once per frame by the scene (src/lanes.ts).
//
// Buttons are read by position, using the browser's "standard" layout where it has one: the
// bottom face button confirms whatever the controller's label (A on Xbox, B on Nintendo, ✕ on
// PlayStation). Controllers without a standard layout get the first stick, button 0 and button 9.
import { StickSwing } from './flick.ts';
import type { Throw } from './flick.ts';

export type PadButton = 'confirm' | 'menu' | 'up' | 'down' | 'left' | 'right' | 'slot1' | 'slot2' | 'slot3' | 'slot4';

export type PadEvent =
  | { type: 'connected'; count: number }
  | { type: 'disconnected'; count: number }
  | { type: 'press'; button: PadButton }
  | { type: 'throw'; throw: Throw };

export interface PadFrame {
  events: PadEvent[];
  /** Lining-up input, -1..1 (strongest of every stick and d-pad). */
  aim: number;
  /** A stick swing is under way. */
  swinging: boolean;
}

/** Standard-layout button indexes. */
const STANDARD: [number, PadButton][] = [
  [0, 'confirm'],
  [9, 'menu'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [4, 'slot1'],
  [5, 'slot2'],
  [6, 'slot3'],
  [7, 'slot4'],
];
const BASIC: [number, PadButton][] = [
  [0, 'confirm'],
  [9, 'menu'],
];

/** Stick travel that counts as a menu direction press, and where it must fall back to re-arm. */
const NAV_ON = 0.6;
const NAV_OFF = 0.4;

interface PadState {
  pressed: Set<PadButton>;
  /** Per stick: the menu direction it's holding, if any. */
  nav: (PadButton | null)[];
  swings: StickSwing[];
}

export class Gamepads {
  private readonly pads = new Map<number, PadState>();
  /** The controller that last did anything, for rumble. */
  private lastIndex = -1;

  get connected(): number {
    return this.pads.size;
  }

  poll(): PadFrame {
    const frame: PadFrame = { events: [], aim: 0, swinging: false };
    let list: (Gamepad | null)[] = [];
    try {
      list = navigator.getGamepads?.() ?? [];
    } catch {
      /* blocked by permissions policy */
    }
    const seen = new Set<number>();
    const t = performance.now() / 1000;
    for (const gp of list) {
      if (!gp || !gp.connected) continue;
      seen.add(gp.index);
      let st = this.pads.get(gp.index);
      if (!st) {
        st = { pressed: new Set(), nav: [], swings: [] };
        this.pads.set(gp.index, st);
        frame.events.push({ type: 'connected', count: this.pads.size });
      }
      this.read(gp, st, t, frame);
    }
    for (const index of [...this.pads.keys()]) {
      if (!seen.has(index)) {
        this.pads.delete(index);
        frame.events.push({ type: 'disconnected', count: this.pads.size });
      }
    }
    return frame;
  }

  private read(gp: Gamepad, st: PadState, t: number, frame: PadFrame): void {
    const before = frame.events.length;
    const standard = gp.mapping === 'standard';
    const down = new Set<PadButton>();
    for (const [i, name] of standard ? STANDARD : BASIC) {
      if (gp.buttons[i]?.pressed) down.add(name);
    }
    for (const name of down) if (!st.pressed.has(name)) frame.events.push({ type: 'press', button: name });

    // Sticks: axes 0-1 and, on a standard layout, 2-3.
    const sticks = standard || gp.axes.length >= 4 ? 2 : gp.axes.length >= 2 ? 1 : 0;
    for (let s = 0; s < sticks; s++) {
      const x = gp.axes[s * 2] ?? 0;
      const y = gp.axes[s * 2 + 1] ?? 0;
      st.swings[s] ??= new StickSwing();
      const r = st.swings[s].feed(t, x, y);
      if (Math.abs(r.aim) > Math.abs(frame.aim)) frame.aim = r.aim;
      if (r.swinging) frame.swinging = true;
      if (r.thrown) frame.events.push({ type: 'throw', throw: r.thrown });

      // The same stick also steps through menus, one press per push.
      const held = st.nav[s] ?? null;
      const mag = Math.max(Math.abs(x), Math.abs(y));
      if (held && mag < NAV_OFF) st.nav[s] = null;
      else if (!held && mag > NAV_ON) {
        const dir: PadButton = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
        st.nav[s] = dir;
        frame.events.push({ type: 'press', button: dir });
      }
    }
    if (down.has('left')) frame.aim = -1;
    if (down.has('right')) frame.aim = 1;
    st.pressed = down;
    if (frame.events.length > before || frame.aim || frame.swinging) this.lastIndex = gp.index;
  }

  /** Rumbles the controller in use, where the browser supports it. Takes a vibrate() pattern. */
  rumble(pattern: number | number[]): void {
    const ms = Array.isArray(pattern) ? pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : pattern;
    try {
      const gp = navigator.getGamepads?.()[this.lastIndex];
      void gp?.vibrationActuator
        ?.playEffect('dual-rumble', {
          duration: Math.min(400, ms * 2),
          strongMagnitude: Math.min(1, ms / 60),
          weakMagnitude: 0.6,
        })
        .catch(() => {});
    } catch {
      /* no rumble here */
    }
  }
}

// ---- Menus ------------------------------------------------------------------------------

/** The dialog on top, if one is open: controller presses go to it instead of the game. */
export function topDialog(): HTMLDialogElement | null {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog:modal');
  return open.length ? open[open.length - 1] : null;
}

function focusables(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>('button, input')].filter(
    (el) => !(el as HTMLButtonElement).disabled && !el.closest('[hidden]') && el.getClientRects().length > 0,
  );
}

/**
 * Moves focus to the previous (up/left) or next (down/right) control in the dialog. Focus moved
 * this way shows the keyboard focus ring (`pad-nav` on the body), since a controller is like a keyboard.
 */
export function moveFocus(dialog: HTMLElement, dir: 'up' | 'down' | 'left' | 'right'): void {
  const els = focusables(dialog);
  if (!els.length) return;
  const i = els.indexOf(document.activeElement as HTMLElement);
  const step = dir === 'up' || dir === 'left' ? -1 : 1;
  const next = i < 0 ? els[0] : els[(i + step + els.length) % els.length];
  document.body.classList.add('pad-nav');
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

/** Presses the focused control in the dialog, or focuses the first one. */
export function pressFocused(dialog: HTMLElement): void {
  const el = document.activeElement as HTMLElement | null;
  if (el && dialog.contains(el) && focusables(dialog).includes(el)) el.click();
  else moveFocus(dialog, 'down');
}
