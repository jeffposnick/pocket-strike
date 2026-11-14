// World units are roughly 7.7 px per inch across the lane; the lane length is
// compressed so a roll takes about a second and a half.

/** Regulation lane half-width (Classic). Neon Run uses a wider lane. */
export const CLASSIC_LANE_HALF = 150;
export const MEGA_LANE_HALF = 230;
export const BOARDS = 39;
export const GUTTER_W = 40;

// The lane width can change between modes. These are `let` exports, so every
// importing module sees the current value (ES module live bindings).
/** Lane surface spans x ∈ [-LANE_HALF, LANE_HALF]. 39 boards, like a real lane. */
export let LANE_HALF = CLASSIC_LANE_HALF;
export let BOARD_W = (LANE_HALF * 2) / BOARDS;
/** Outer edge of the gutters / inner face of the kickback walls. */
export let WALL_X = LANE_HALF + GUTTER_W;

export function setLaneHalf(half: number): void {
  LANE_HALF = half;
  BOARD_W = (half * 2) / BOARDS;
  WALL_X = half + GUTTER_W;
}

export const FOUL_Y = 0;
export const BALL_START_Y = 150;
export const DOTS_Y = -150;
export const ARROWS_Y = -400;

export const PIN_SPACING = 86;
export const ROW_SPACING = PIN_SPACING * (Math.sqrt(3) / 2);
export const HEAD_Y = -3300;
export const DECK_Y = HEAD_Y + 90;
/** Deep enough for the Mega Rack's back row. */
export const PIT_Y = HEAD_Y - 365;
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
  /** Lane half-width to use with this rack. */
  laneHalf?: number;
  /** How many pins Chain Lightning can zap. */
  zaps?: number;
}

/** The regulation 10-pin triangle. */
export const CLASSIC_RACK: RackLayout = { rows: 4, spacing: PIN_SPACING, pinScale: 1, pinMass: 1 };
/** Neon Run's 55-pin triangle: ten rows of smaller pins that still fit the lane. */
export const MEGA_RACK: RackLayout = {
  rows: 10,
  spacing: 42,
  pinScale: 0.75,
  pinMass: 1,
  fallScale: 0.38,
  bombRadius: 140,
  fireBoost: 3,
  homingLine: 80,
  megaScale: 1.7,
  zaps: 8,
  laneHalf: MEGA_LANE_HALF,
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
export const speedToMph = (s: number) => MPH_MIN + ((s - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * (MPH_MAX - MPH_MIN);

/** Board number counted from the right edge, the way right-handed bowlers count. */
export const boardAt = (x: number) => Math.max(1, Math.min(BOARDS, Math.round((LANE_HALF - x) / BOARD_W + 0.5)));
