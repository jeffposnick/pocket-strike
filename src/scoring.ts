export interface FrameView {
  marks: string[];
  /** Running total, or null until the frame's bonus balls are known. */
  total: number | null;
}

const sym = (n: number) => (n === 0 ? '-' : String(n));

/** Standard ten-pin scoring from a flat list of pinfall per ball. */
export function scoreFrames(rolls: readonly number[]): FrameView[] {
  const frames: FrameView[] = [];
  let i = 0;
  let running = 0;
  let known = true;

  for (let f = 0; f < 10; f++) {
    const a = rolls[i];
    const b = rolls[i + 1];
    const c = rolls[i + 2];
    let marks: string[];
    let score: number | null = null;

    if (f < 9) {
      if (a === 10) {
        marks = ['', 'X'];
        if (b !== undefined && c !== undefined) score = 10 + b + c;
        i += 1;
      } else {
        marks = [a === undefined ? '' : sym(a), b === undefined ? '' : a + b === 10 ? '/' : sym(b)];
        if (a !== undefined && b !== undefined) {
          if (a + b < 10) score = a + b;
          else if (c !== undefined) score = 10 + c;
        }
        i += 2;
      }
    } else {
      marks = ['', '', ''];
      if (a !== undefined) marks[0] = a === 10 ? 'X' : sym(a);
      if (b !== undefined) {
        if (a === 10) marks[1] = b === 10 ? 'X' : sym(b);
        else marks[1] = a + b === 10 ? '/' : sym(b);
      }
      if (c !== undefined) {
        if (a === 10 && b === 10) marks[2] = c === 10 ? 'X' : sym(c);
        else if (a === 10) marks[2] = b + c === 10 ? '/' : sym(c);
        else marks[2] = c === 10 ? 'X' : sym(c);
      }
      if (a !== undefined && b !== undefined) {
        if (a === 10 || a + b === 10) {
          if (c !== undefined) score = a + b + c;
        } else {
          score = a + b;
        }
      }
    }

    if (score === null) known = false;
    if (known && score !== null) running += score;
    frames.push({ marks, total: known && score !== null ? running : null });
  }
  return frames;
}

/** Where a Classic game stands after a list of rolls: what comes next, and on what rack. */
export interface ClassicPosition {
  /** 0-based frame of the next ball (stays 9 once the game is over). */
  frame: number;
  /** 0-based ball within that frame. */
  ball: number;
  /** The next ball is at a fresh rack of ten. */
  freshRack: boolean;
  over: boolean;
}

export function classicPosition(rolls: readonly number[]): ClassicPosition {
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return { frame: f, ball: 0, freshRack: true, over: false };
    if (rolls[i] === 10) {
      i += 1;
      continue;
    }
    if (i + 1 >= rolls.length) return { frame: f, ball: 1, freshRack: false, over: false };
    i += 2;
  }
  const [a, b] = rolls.slice(i);
  switch (rolls.length - i) {
    case 0:
      return { frame: 9, ball: 0, freshRack: true, over: false };
    case 1:
      return { frame: 9, ball: 1, freshRack: a === 10, over: false };
    case 2:
      if (a === 10 || a + b === 10) {
        // A strike then a strike, or a spare, earns a fresh rack; a strike then a count leaves pins.
        return { frame: 9, ball: 2, freshRack: a === 10 ? b === 10 : true, over: false };
      }
      return { frame: 9, ball: 2, freshRack: false, over: true };
    default:
      return { frame: 9, ball: 3, freshRack: false, over: true };
  }
}

/** Score as it stands: every pin so far plus whatever bonus balls have been rolled. */
export function provisionalTotal(rolls: readonly number[]): number {
  let total = 0;
  let i = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    const a = rolls[i] ?? 0;
    const b = rolls[i + 1] ?? 0;
    const c = rolls[i + 2] ?? 0;
    if (f === 9) {
      total += a + b + c;
      break;
    }
    if (a === 10) {
      total += 10 + b + c;
      i += 1;
    } else {
      total += a + b + (a + b === 10 ? c : 0);
      i += 2;
    }
  }
  return total;
}

/**
 * A split: the head pin is down and the pins left standing form two or more
 * groups with a gap between them.
 */
export function isSplit(standingIds: readonly number[]): boolean {
  if (standingIds.includes(1) || standingIds.length < 2) return false;
  const adj: Record<number, number[]> = {
    1: [2, 3],
    2: [1, 3, 4, 5],
    3: [1, 2, 5, 6],
    4: [2, 5, 7, 8],
    5: [2, 3, 4, 6, 8, 9],
    6: [3, 5, 9, 10],
    7: [4, 8],
    8: [4, 5, 7, 9],
    9: [5, 6, 8, 10],
    10: [6, 9],
  };
  const set = new Set(standingIds);
  const seen = new Set<number>();
  const stack = [standingIds[0]];
  while (stack.length) {
    const p = stack.pop()!;
    if (seen.has(p)) continue;
    seen.add(p);
    for (const q of adj[p]) if (set.has(q) && !seen.has(q)) stack.push(q);
  }
  return seen.size < set.size;
}
