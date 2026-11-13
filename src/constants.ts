// World units are roughly 7.7 px per inch across the lane; the lane length is
// compressed so a roll takes about a second and a half.

/** Lane surface spans x ∈ [-LANE_HALF, LANE_HALF]. 39 boards, like a real lane. */
export const LANE_HALF = 150;
export const BOARDS = 39;
export const BOARD_W = (LANE_HALF * 2) / BOARDS;
export const GUTTER_W = 40;
/** Outer edge of the gutters / inner face of the kickback walls. */
export const WALL_X = LANE_HALF + GUTTER_W;

export const FOUL_Y = 0;
export const BALL_START_Y = 150;
export const DOTS_Y = -150;
export const ARROWS_Y = -400;

export const PIN_SPACING = 86;
export const ROW_SPACING = PIN_SPACING * (Math.sqrt(3) / 2);
export const HEAD_Y = -3300;
export const DECK_Y = HEAD_Y + 90;
export const PIT_Y = HEAD_Y - 3 * ROW_SPACING - 70;
export const PIT_DEPTH = 150;

export const BALL_R = 30;
export const PIN_R = 17;
/** A pin lying on its side is about 15 inches long. */
export const PIN_LEN = 108;

export const BALL_MASS = 4.5;
export const PIN_MASS = 1;

export const MIN_SPEED = 1250;
export const MAX_SPEED = 2900;
/** Lateral acceleration at full spin once the ball reaches the dry back end. */
export const HOOK = 560;

export interface RackLayout {
  rows: number;
  spacing: number;
  /** Size of each pin relative to a regulation pin. */
  pinScale: number;
  /** Pin mass relative to a regulation pin. */
  pinMass: number;
  /** Multiplier on how hard a pin must be hit to fall. */
  fallScale?: number;
  /** Bomb blast radius. */
  bombRadius?: number;
  /** How much harder burning pins hit. */
  fireBoost?: number;
  /** Where Homing aims on a full rack (mirrored for a left hook). */
  homingLine?: number;
  /** Mega Ball size multiplier. */
  megaScale?: number;
}

/** The regulation 10-pin triangle. */
export const CLASSIC_RACK: RackLayout = { rows: 4, spacing: PIN_SPACING, pinScale: 1, pinMass: 1 };
/** Neon Run's 55-pin triangle: ten rows of smaller pins that still fit the lane. */
export const MEGA_RACK: RackLayout = {
  rows: 10,
  spacing: 31,
  pinScale: 0.7,
  pinMass: 1,
  fallScale: 0.45,
  bombRadius: 110,
  fireBoost: 1.3,
  homingLine: 60,
  megaScale: 1.45,
};

/** Pin home spots in row-major order from the head pin; within a row, bowler's left first. */
export function rackSpots(layout: RackLayout): { x: number; y: number; row: number; k: number }[] {
  const spots: { x: number; y: number; row: number; k: number }[] = [];
  const rowGap = layout.spacing * (Math.sqrt(3) / 2);
  for (let row = 0; row < layout.rows; row++) {
    for (let k = 0; k <= row; k++) {
      spots.push({ x: (k - row / 2) * layout.spacing, y: HEAD_Y - row * rowGap, row, k });
    }
  }
  return spots;
}

/** Regulation pin spots, indexed 0..9 for pins 1..10. Negative x is the bowler's left. */
export const PIN_SPOTS = rackSpots(CLASSIC_RACK);

/** Speed range shown to the player, mph. */
export const MPH_MIN = 12;
export const MPH_MAX = 22;
export const speedToMph = (s: number) =>
  MPH_MIN + ((s - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * (MPH_MAX - MPH_MIN);

/** Board number counted from the right edge, the way right-handed bowlers count. */
export const boardAt = (x: number) =>
  Math.max(1, Math.min(BOARDS, Math.round((LANE_HALF - x) / BOARD_W + 0.5)));
