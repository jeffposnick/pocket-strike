import { BALL_STYLES } from './art.ts';
import type { BallStyle } from './art.ts';
import type { FrameView } from './scoring.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type BannerKind = 'strike' | 'spare' | 'split' | 'gutter' | 'plain';

export interface GameOverStats {
  score: number;
  best: number;
  newBest: boolean;
  strikes: number;
  spares: number;
}

/** Rack diagram positions (pins 7-10 across the top, head pin at the bottom). */
const RACK_LAYOUT: [number, number, number][] = [
  [1, 1.5, 3],
  [2, 1, 2],
  [3, 2, 2],
  [4, 0.5, 1],
  [5, 1.5, 1],
  [6, 2.5, 1],
  [7, 0, 0],
  [8, 1, 0],
  [9, 2, 0],
  [10, 3, 0],
];

export class Hud {
  private bannerTimer = 0;
  private hintTimer = 0;
  private readonly rackDots = new Map<number, HTMLElement>();
  private styleIndex = 0;
  private bumpers = false;

  constructor() {
    const board = $('board');
    for (let f = 0; f < 10; f++) {
      const el = document.createElement('div');
      el.className = 'frame' + (f === 9 ? ' tenth' : '');
      el.innerHTML = `<div class="fno">${f + 1}</div><div class="marks">${'<span></span>'.repeat(f === 9 ? 3 : 2)}</div><div class="ftot"></div>`;
      board.appendChild(el);
    }
    const rack = $('rack');
    for (const [id, x, y] of RACK_LAYOUT) {
      const d = document.createElement('i');
      d.style.left = `${x * 14 + 2}px`;
      d.style.top = `${y * 12 + 2}px`;
      d.title = `Pin ${id}`;
      rack.appendChild(d);
      this.rackDots.set(id, d);
    }
    try {
      this.styleIndex = Number(localStorage.getItem('ps-style') ?? 0) % BALL_STYLES.length;
      this.bumpers = localStorage.getItem('ps-bumpers') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  renderBoard(frames: FrameView[], current: number): void {
    const els = $('board').children;
    frames.forEach((f, i) => {
      const el = els[i] as HTMLElement;
      el.classList.toggle('current', i === current);
      const spans = el.querySelectorAll('span');
      f.marks.forEach((m, k) => {
        const s = spans[k];
        if (s.textContent !== m) {
          s.textContent = m;
          s.className = m === 'X' ? 'x' : m === '/' ? 'sp' : '';
          if (m) {
            s.classList.add('pop');
          }
        }
      });
      el.querySelector('.ftot')!.textContent = f.total === null ? '' : String(f.total);
    });
  }

  setScore(total: number): void {
    $('total').textContent = String(total);
  }

  setRack(standing: readonly number[]): void {
    for (const [id, el] of this.rackDots) el.classList.toggle('down', !standing.includes(id));
  }

  setStatus(text: string): void {
    $('status').textContent = text;
  }

  setBoardNumber(board: number | null): void {
    const el = $('boardNo');
    if (board === null) {
      el.classList.remove('show');
    } else {
      el.textContent = `Board ${board}`;
      el.classList.add('show');
    }
  }

  showThrow(mph: number, spin: number): void {
    const el = $('throw');
    const hook = Math.round(Math.abs(spin) * 100);
    const dir = spin < -0.02 ? '↰' : spin > 0.02 ? '↱' : '↑';
    el.innerHTML = `<b>${mph.toFixed(1)}</b> mph <span class="sep"></span> ${hook ? `${dir} <b>${hook}%</b> hook` : 'straight'}`;
    el.classList.add('show');
  }

  hideThrow(): void {
    $('throw').classList.remove('show');
  }

  banner(text: string, sub: string, kind: BannerKind, ms = 1400): void {
    const el = $('banner');
    el.className = '';
    void el.offsetWidth;
    el.className = `show ${kind}`;
    $('bannerText').textContent = text;
    $('bannerSub').textContent = sub;
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }

  flash(color = '#fff'): void {
    const el = $('flash');
    el.style.background = color;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  hint(show: boolean, delay = 0): void {
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => $('hint').classList.toggle('show', show), delay);
  }

  onMute(handler: (muted: boolean) => void): void {
    const btn = $('mute');
    let muted = false;
    try {
      muted = localStorage.getItem('ps-muted') === '1';
    } catch {
      /* ignore */
    }
    const apply = () => {
      btn.textContent = muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      handler(muted);
    };
    btn.onclick = () => {
      muted = !muted;
      try {
        localStorage.setItem('ps-muted', muted ? '1' : '0');
      } catch {
        /* ignore */
      }
      apply();
    };
    apply();
  }

  onMenuButton(handler: () => void): void {
    $('menuBtn').onclick = handler;
  }

  showMenu(best: number, onPlay: (style: BallStyle, bumpers: boolean) => void): void {
    $('over').hidden = true;
    const menu = $('menu');
    menu.hidden = false;
    $('menuBest').textContent = best ? `Best game: ${best}` : 'No games bowled yet';

    const picks = $('balls');
    picks.innerHTML = '';
    BALL_STYLES.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'ballPick' + (i === this.styleIndex ? ' on' : '');
      b.style.setProperty('--a', s.a);
      b.style.setProperty('--b', s.b);
      b.setAttribute('aria-label', `${s.name} ball`);
      b.innerHTML = `<i></i><span>${s.name}</span>`;
      b.onclick = () => {
        this.styleIndex = i;
        for (const el of picks.children) el.classList.remove('on');
        b.classList.add('on');
      };
      picks.appendChild(b);
    });

    const bump = $<HTMLInputElement>('bumpers');
    bump.checked = this.bumpers;

    $('play').onclick = () => {
      this.bumpers = bump.checked;
      try {
        localStorage.setItem('ps-style', String(this.styleIndex));
        localStorage.setItem('ps-bumpers', this.bumpers ? '1' : '0');
      } catch {
        /* ignore */
      }
      menu.hidden = true;
      onPlay(BALL_STYLES[this.styleIndex], this.bumpers);
    };
  }

  showOver(stats: GameOverStats, onAgain: () => void, onMenu: () => void): void {
    const over = $('over');
    $('finalScore').textContent = String(stats.score);
    $('finalBest').textContent = stats.newBest ? 'New personal best!' : `Best: ${stats.best}`;
    $('finalBest').classList.toggle('new', stats.newBest);
    $('finalStats').textContent = `${stats.strikes} strike${stats.strikes === 1 ? '' : 's'} · ${stats.spares} spare${stats.spares === 1 ? '' : 's'}`;
    $('finalRating').textContent = rating(stats.score);
    over.hidden = false;
    $('again').onclick = () => {
      over.hidden = true;
      onAgain();
    };
    $('toMenu').onclick = () => {
      over.hidden = true;
      onMenu();
    };
  }
}

function rating(score: number): string {
  if (score >= 300) return 'A perfect game. Legendary.';
  if (score >= 250) return 'Pro tour material.';
  if (score >= 200) return 'Two hundred club!';
  if (score >= 160) return 'League night hero.';
  if (score >= 120) return 'Solid bowling.';
  if (score >= 80) return 'Finding your line.';
  return 'Warm-up game. Bowl another!';
}
