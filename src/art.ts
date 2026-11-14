import * as ex from 'excalibur';
import type { RackLayout } from './constants.ts';
import {
  ARROWS_Y,
  BALL_R,
  BOARDS,
  BOARD_W,
  DECK_Y,
  DOTS_Y,
  GUTTER_W,
  HEAD_Y,
  LANE_HALF,
  PIN_LEN,
  PIN_R,
  PIT_DEPTH,
  PIT_Y,
  rackSpots,
  WALL_X,
} from './constants.ts';

export const NEON = {
  pink: '#ff3fa4',
  cyan: '#38f3ff',
  amber: '#ffc84a',
  violet: '#9b6bff',
  night: '#0c0a1f',
};

export const WORLD_HALF_W = 300;
export const LANE_TOP = PIT_Y - PIT_DEPTH - 700;
export const LANE_BOTTOM = 700;
export const TILE_H = 512;

/** Deterministic hash → [0, 1). Keeps grain identical across tile seams. */
function hash(a: number, b = 0): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const laneCanvases: ex.Canvas[] = [];

/** Redraws the lane after its width changes. */
export function repaintLane(): void {
  for (const c of laneCanvases) c.flagDirty();
}

/** Lane, gutters, pin deck, pit and the neon masking panel, cut into tiles. */
export function makeLaneTiles(): ex.Actor[] {
  const tiles: ex.Actor[] = [];
  const w = WORLD_HALF_W * 2;
  for (let y0 = LANE_TOP; y0 < LANE_BOTTOM; y0 += TILE_H) {
    const top = y0;
    const canvas = new ex.Canvas({
      width: w,
      height: TILE_H,
      cache: true,
      draw: (ctx) => paintLane(ctx, -WORLD_HALF_W, top, w, TILE_H),
    });
    laneCanvases.push(canvas);
    const a = new ex.Actor({ pos: ex.vec(-WORLD_HALF_W, top), anchor: ex.vec(0, 0), z: 0 });
    a.graphics.use(canvas);
    tiles.push(a);
  }
  return tiles;
}

function glowLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 2): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (const [lw, a] of [
    [width * 7, 0.08],
    [width * 3.5, 0.18],
    [width * 1.6, 0.45],
    [width, 1],
  ]) {
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintLane(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
  ctx.save();
  ctx.translate(-x0, -y0);
  const yTop = y0;
  const yBot = y0 + h;
  const pitTop = PIT_Y - PIT_DEPTH;

  // Night-time alley floor beside the lane.
  ctx.fillStyle = NEON.night;
  ctx.fillRect(x0, y0, w, h);

  // Capping / ball-return dividers.
  for (const s of [-1, 1]) {
    const inner = s * (WALL_X + 6);
    const g = ctx.createLinearGradient(inner, 0, s * WORLD_HALF_W, 0);
    g.addColorStop(0, '#1b1640');
    g.addColorStop(0.3, '#15112f');
    g.addColorStop(1, '#0c0a1f');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(inner, s * WORLD_HALF_W), yTop, Math.abs(s * WORLD_HALF_W - inner), h);
    glowLine(ctx, s * (WALL_X + 18), Math.max(yTop, pitTop), s * (WALL_X + 18), yBot, NEON.cyan, 1.5);
    glowLine(ctx, s * (WALL_X + 70), Math.max(yTop, pitTop), s * (WALL_X + 70), yBot, NEON.violet, 1);
  }

  // Approach (behind the foul line).
  if (yBot > 0) {
    const g = ctx.createLinearGradient(-LANE_HALF - 20, 0, LANE_HALF + 20, 0);
    g.addColorStop(0, '#a77846');
    g.addColorStop(0.5, '#c79560');
    g.addColorStop(1, '#a77846');
    ctx.fillStyle = g;
    ctx.fillRect(-WALL_X, 0, WALL_X * 2, LANE_BOTTOM);
    ctx.fillStyle = 'rgba(40,20,5,0.55)';
    for (const dy of [70, 250]) {
      for (const b of [3, 5, 8, 11, 14, 20]) {
        for (const s of b === 20 ? [0] : [-1, 1]) {
          const x = s === 0 ? 0 : s * (LANE_HALF - (b - 0.5) * BOARD_W);
          ctx.beginPath();
          ctx.arc(x, dy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Lane boards.
  const laneTop = Math.max(yTop, pitTop);
  const laneBot = Math.min(yBot, 0);
  if (laneBot > laneTop) {
    for (let i = 0; i < BOARDS; i++) {
      const bx = -LANE_HALF + i * BOARD_W;
      const tone = hash(i) * 0.12 - 0.06;
      for (const [s0, s1, deck] of [
        [Math.max(laneTop, DECK_Y), laneBot, false],
        [laneTop, Math.min(laneBot, DECK_Y), true],
      ] as [number, number, boolean][]) {
        if (s1 <= s0) continue;
        const l = (deck ? 66 : 58) + tone * 90;
        ctx.fillStyle = `hsl(${29 + tone * 50}, ${deck ? 58 : 66}%, ${l}%)`;
        ctx.fillRect(bx, s0, BOARD_W + 0.5, s1 - s0);
      }
      // Grain streaks, seeded by board and segment so they line up across tiles.
      const seg = 180;
      for (let sy = Math.floor(laneTop / seg) * seg; sy < laneBot; sy += seg) {
        const n = 2 + Math.floor(hash(i, sy) * 3);
        for (let k = 0; k < n; k++) {
          const gx = bx + 1 + hash(i * 7 + k, sy) * (BOARD_W - 2);
          const gy = sy + hash(i, sy + k * 31) * seg;
          const len = 40 + hash(k, i + sy) * 140;
          ctx.strokeStyle = `rgba(110,60,20,${0.08 + hash(i + k, sy) * 0.1})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(gx, Math.max(gy, laneTop));
          ctx.lineTo(gx + (hash(k, sy) - 0.5) * 1.5, Math.min(gy + len, laneBot));
          ctx.stroke();
        }
      }
    }
    ctx.strokeStyle = 'rgba(90,50,20,0.25)';
    ctx.lineWidth = 0.7;
    for (let i = 1; i < BOARDS; i++) {
      const bx = -LANE_HALF + i * BOARD_W;
      ctx.beginPath();
      ctx.moveTo(bx, laneTop);
      ctx.lineTo(bx, laneBot);
      ctx.stroke();
    }

    // Oil sheen: a soft lengthwise highlight plus reflections of ceiling lights.
    const sheen = ctx.createLinearGradient(-LANE_HALF, 0, LANE_HALF, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.35, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.13)');
    sheen.addColorStop(0.65, 'rgba(255,255,255,0.10)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-LANE_HALF, Math.max(laneTop, DECK_Y), LANE_HALF * 2, Math.max(0, laneBot - Math.max(laneTop, DECK_Y)));

    ctx.save();
    ctx.beginPath();
    ctx.rect(-LANE_HALF, laneTop, LANE_HALF * 2, laneBot - laneTop);
    ctx.clip();
    for (let k = 0; k < 8; k++) {
      const cy = -260 - k * 520;
      for (const [cx, col] of [
        [-75, 'rgba(255,120,220,0.20)'],
        [75, 'rgba(120,240,255,0.20)'],
      ] as [number, string][]) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, 5);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
        rg.addColorStop(0, col);
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(-34, -34, 68, 68);
        ctx.restore();
      }
    }
    ctx.restore();

    // Targeting dots and arrows.
    ctx.fillStyle = 'rgba(45,22,8,0.75)';
    for (const b of [3, 5, 8, 11, 14]) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * (LANE_HALF - (b - 0.5) * BOARD_W), DOTS_Y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const b of [5, 10, 15, 20]) {
      for (const s of b === 20 ? [1] : [-1, 1]) {
        const x = b === 20 ? 0 : s * (LANE_HALF - (b - 0.5) * BOARD_W);
        const y = ARROWS_Y + (20 - b) * 4;
        ctx.save();
        ctx.shadowColor = NEON.cyan;
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#3b1f0c';
        ctx.beginPath();
        ctx.moveTo(x, y - 26);
        ctx.lineTo(x + 6.5, y + 12);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6.5, y + 12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // Deck edge line.
    if (DECK_Y > laneTop && DECK_Y < laneBot) {
      ctx.fillStyle = 'rgba(80,40,10,0.35)';
      ctx.fillRect(-LANE_HALF, DECK_Y - 1, LANE_HALF * 2, 2);
    }
  }

  // Gutters.
  const gTop = Math.max(yTop, pitTop);
  const gBot = Math.min(yBot, 0);
  if (gBot > gTop) {
    for (const s of [-1, 1]) {
      const a = s * LANE_HALF;
      const b = s * WALL_X;
      const g = ctx.createLinearGradient(a, 0, b, 0);
      g.addColorStop(0, '#2a2546');
      g.addColorStop(0.5, '#0f0c22');
      g.addColorStop(1, '#2d2850');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(a, b), gTop, GUTTER_PX, gBot - gTop);
      glowLine(ctx, b, gTop, b, gBot, NEON.pink, 1.4);
    }
  }

  // Kickbacks flanking the pin deck.
  const kTop = Math.max(yTop, pitTop);
  const kBot = Math.min(yBot, HEAD_Y + 120);
  if (kBot > kTop) {
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#231c4a';
      ctx.fillRect(s > 0 ? WALL_X : -WALL_X - 16, kTop, 16, kBot - kTop);
      glowLine(ctx, s * (WALL_X + 8), kTop, s * (WALL_X + 8), kBot, NEON.amber, 1.2);
    }
  }

  // Pit.
  if (yTop < PIT_Y && yBot > pitTop) {
    const g = ctx.createLinearGradient(0, pitTop, 0, PIT_Y);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.7, '#07060f');
    g.addColorStop(1, '#1a1530');
    ctx.fillStyle = g;
    ctx.fillRect(-WALL_X - 16, pitTop, (WALL_X + 16) * 2, PIT_DEPTH);
  }

  // Masking panel above the pit.
  if (yTop < pitTop) {
    const bot = Math.min(yBot, pitTop);
    const g = ctx.createLinearGradient(0, LANE_TOP, 0, pitTop);
    g.addColorStop(0, '#07051a');
    g.addColorStop(1, '#1d1645');
    ctx.fillStyle = g;
    ctx.fillRect(-WORLD_HALF_W, yTop, WORLD_HALF_W * 2, bot - yTop);
    for (let i = 0; i < 70; i++) {
      const sx = (hash(i, 3) - 0.5) * WORLD_HALF_W * 2;
      const sy = LANE_TOP + hash(i, 9) * (pitTop - LANE_TOP - 30);
      ctx.fillStyle = `rgba(255,255,255,${0.2 + hash(i, 5) * 0.6})`;
      ctx.fillRect(sx, sy, 2, 2);
    }
    const base = pitTop - 40;
    glowLine(ctx, -WALL_X, base, WALL_X, base, NEON.pink, 2);
    glowLine(ctx, -WALL_X + 30, base - 34, WALL_X - 30, base - 34, NEON.cyan, 1.6);
    glowLine(ctx, -WALL_X + 60, base - 64, WALL_X - 60, base - 64, NEON.amber, 1.3);
    // A neon pin outline in the centre of the panel.
    ctx.save();
    ctx.translate(0, base - 200);
    ctx.scale(1.1, 1.1);
    ctx.strokeStyle = NEON.pink;
    ctx.shadowColor = NEON.pink;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 3;
    pinProfilePath(ctx, -54, 0, 108, true);
    ctx.stroke();
    ctx.restore();
  }

  // Foul line.
  if (yTop < 4 && yBot > -4) {
    ctx.fillStyle = '#1a0d05';
    ctx.fillRect(-LANE_HALF, -2, LANE_HALF * 2, 4);
    glowLine(ctx, -LANE_HALF, 0, LANE_HALF, 0, 'rgba(255,63,164,0.6)', 0.8);
  }

  ctx.restore();
}

const GUTTER_PX = GUTTER_W;

/** Painted pin spots for one rack layout, as an actor laid over the deck. */
export function makeDeckSpots(layout: RackLayout): ex.Actor {
  const spots = rackSpots(layout);
  const half = layout.laneHalf ?? LANE_HALF;
  const w = half * 2;
  const top = PIT_Y;
  const h = HEAD_Y + 20 - top;
  const r = 7 * layout.pinScale;
  const canvas = new ex.Canvas({
    width: w,
    height: h,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(70,35,10,0.35)';
      for (const p of spots) {
        ctx.beginPath();
        ctx.arc(p.x + half, p.y - top, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  });
  const a = new ex.Actor({ pos: ex.vec(-half, top), anchor: ex.vec(0, 0), z: 1 });
  a.graphics.use(canvas);
  return a;
}

/**
 * Side-on outline of a bowling pin lying along +x from (x, y), length `len`.
 * `vertical` draws it standing upright instead (used for the neon sign).
 */
function pinProfilePath(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, vertical = false): void {
  // [position along the pin 0..1, half-width as a fraction of PIN_R]
  const prof: [number, number][] = [
    [0, 0.62],
    [0.08, 0.8],
    [0.22, 0.97],
    [0.34, 1.0],
    [0.48, 0.8],
    [0.62, 0.42],
    [0.72, 0.4],
    [0.84, 0.56],
    [0.93, 0.48],
    [0.985, 0.25],
    [1, 0],
  ];
  const pt = (t: number, side: number): [number, number] => {
    const along = t * len;
    let w = 0;
    for (let i = 1; i < prof.length; i++) {
      if (t <= prof[i][0]) {
        const [t0, w0] = prof[i - 1];
        const [t1, w1] = prof[i];
        const k = (t - t0) / (t1 - t0);
        const s = k * k * (3 - 2 * k);
        w = (w0 + (w1 - w0) * s) * PIN_R;
        break;
      }
    }
    return vertical ? [x + len / 2 + side * w, y + len / 2 - along] : [x + along, y + side * w];
  };
  ctx.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const [px, py] = pt(i / N, -1);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  for (let i = N; i >= 0; i--) {
    const [px, py] = pt(i / N, 1);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Pin seen from above while standing. `accent` marks a special pin. */
export function makeStandingPin(accent?: string, quality = 1): ex.Canvas {
  const size = 56;
  const c = size / 2;
  return new ex.Canvas({
    width: size,
    height: size,
    quality,
    smoothing: true,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, size, size);
      if (accent) {
        const halo = ctx.createRadialGradient(c, c, PIN_R * 0.8, c, c, c);
        halo.addColorStop(0, accent);
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, size, size);
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 5;
      const g = ctx.createRadialGradient(c - 4, c - 5, 2, c, c, PIN_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.7, '#f1eff8');
      g.addColorStop(1, '#bdb8d0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, PIN_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Red neck stripes seen from above.
      ctx.strokeStyle = accent ?? '#e8203f';
      ctx.lineWidth = accent ? 3.4 : 2.6;
      ctx.beginPath();
      ctx.arc(c, c, 10.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = accent ?? 'rgba(232,32,63,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(c, c, 13.2, 0, Math.PI * 2);
      ctx.stroke();
      // Head.
      const hg = ctx.createRadialGradient(c - 2.5, c - 3, 0.5, c, c, 8);
      hg.addColorStop(0, '#ffffff');
      hg.addColorStop(1, accent ?? '#dcd8e8');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(c, c, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(c - 2.6, c - 3, 2.2, 0, Math.PI * 2);
      ctx.fill();
    },
  });
}

/** Pin lying on its side, head pointing toward +x. */
export function makeFallenPin(accent?: string, quality = 1): ex.Canvas {
  const wdt = PIN_LEN + 24;
  const hgt = PIN_R * 2 + 22;
  const x0 = 12;
  const cy = hgt / 2;
  return new ex.Canvas({
    width: wdt,
    height: hgt,
    quality,
    smoothing: true,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, wdt, hgt);
      ctx.save();
      ctx.shadowColor = accent ?? 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = accent ? 12 : 6;
      ctx.shadowOffsetX = accent ? 0 : 3;
      ctx.shadowOffsetY = accent ? 0 : 5;
      const g = ctx.createLinearGradient(0, cy - PIN_R, 0, cy + PIN_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#f6f4fb');
      g.addColorStop(1, '#a9a3c2');
      ctx.fillStyle = g;
      pinProfilePath(ctx, x0, cy, PIN_LEN);
      ctx.fill();
      ctx.restore();
      ctx.save();
      pinProfilePath(ctx, x0, cy, PIN_LEN);
      ctx.clip();
      ctx.fillStyle = accent ?? '#e8203f';
      ctx.fillRect(x0 + PIN_LEN * 0.6, 0, PIN_LEN * 0.035, hgt);
      ctx.fillRect(x0 + PIN_LEN * 0.665, 0, PIN_LEN * 0.035, hgt);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(x0, cy - PIN_R * 0.55, PIN_LEN, 2.5);
      ctx.restore();
    },
  });
}

export interface BallStyle {
  name: string;
  a: string;
  b: string;
  swirl: string;
}

export const BALL_STYLES: BallStyle[] = [
  { name: 'Nebula', a: '#7b2ff7', b: '#f107a3', swirl: '#ffd1f4' },
  { name: 'Riptide', a: '#00c6ff', b: '#0047b3', swirl: '#c9f6ff' },
  { name: 'Magma', a: '#ff512f', b: '#a1120c', swirl: '#ffd27a' },
  { name: 'Venom', a: '#b6ff3b', b: '#0d7a3a', swirl: '#f2ffcc' },
];

/** The ball and pin graphics take a `quality` (bitmap oversampling); see `rasterQuality()`. */
export function makeBall(style: BallStyle, quality = 1): ex.Canvas {
  const size = BALL_R * 2 + 4;
  const c = size / 2;
  return new ex.Canvas({
    width: size,
    height: size,
    quality,
    smoothing: true,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, BALL_R, 0, Math.PI * 2);
      ctx.clip();
      const g = ctx.createRadialGradient(c - 8, c - 10, 4, c, c, BALL_R);
      g.addColorStop(0, style.a);
      g.addColorStop(1, style.b);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      // Marbled swirls.
      for (let i = 0; i < 7; i++) {
        const a0 = (i / 7) * Math.PI * 2;
        ctx.strokeStyle = i % 2 ? style.swirl : style.b;
        ctx.globalAlpha = i % 2 ? 0.35 : 0.5;
        ctx.lineWidth = 2 + (i % 3) * 1.5;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a0) * 4, c + Math.sin(a0) * 4);
        ctx.bezierCurveTo(
          c + Math.cos(a0 + 0.9) * 22,
          c + Math.sin(a0 + 0.9) * 22,
          c + Math.cos(a0 + 1.6) * 30,
          c + Math.sin(a0 + 1.6) * 8,
          c + Math.cos(a0 + 2.3) * 34,
          c + Math.sin(a0 + 2.3) * 34,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Finger and thumb holes.
      for (const [hx, hy, r] of [
        [-7, -11, 4.2],
        [7, -11, 4.2],
        [0, 7, 5.2],
      ]) {
        const hg = ctx.createRadialGradient(c + hx + 1, c + hy + 1, 0, c + hx, c + hy, r);
        hg.addColorStop(0, '#000');
        hg.addColorStop(0.75, '#140a1c');
        hg.addColorStop(1, 'rgba(255,255,255,0.35)');
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(c + hx, c + hy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c, c, BALL_R - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    },
  });
}

/** Fixed lighting on top of the rotating ball. */
export function makeBallGloss(quality = 1): ex.Canvas {
  const size = BALL_R * 2 + 4;
  const c = size / 2;
  return new ex.Canvas({
    width: size,
    height: size,
    quality,
    smoothing: true,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, size, size);
      const g = ctx.createRadialGradient(c - 10, c - 12, 0, c - 10, c - 12, 16);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      const rim = ctx.createRadialGradient(c, c, BALL_R * 0.7, c, c, BALL_R);
      rim.addColorStop(0, 'rgba(0,0,0,0)');
      rim.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.arc(c, c, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    },
  });
}

/**
 * Bitmap quality (Raster oversampling) for a sprite drawn at `screenScale` device pixels per world
 * unit, in half steps so it rarely rebuilds. Used by the ball and pins so they stay crisp when scaled
 * up (Mega Ball, Snowball, Wide perk) and on high-DPI screens.
 */
export function rasterQuality(screenScale: number): number {
  return Math.min(12, Math.max(1, Math.ceil(screenScale * 2) / 2));
}

export function makeBallShadow(quality = 1): ex.Canvas {
  const size = BALL_R * 2 + 30;
  const c = size / 2;
  return new ex.Canvas({
    width: size,
    height: size,
    quality,
    smoothing: true,
    cache: true,
    draw: (ctx) => {
      ctx.clearRect(0, 0, size, size);
      const g = ctx.createRadialGradient(c, c, BALL_R * 0.5, c, c, BALL_R + 12);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    },
  });
}
