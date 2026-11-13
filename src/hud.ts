import { BALL_STYLES } from './art.ts';
import type { BallStyle } from './art.ts';
import type { Mode } from './lanes.ts';
import { PERKS, POWER_PRICE, POWERS, REROLL_PRICE, STAGES } from './run.ts';
import type { BallPoints, Perk, Run } from './run.ts';
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
    this.setRackLayout(4);
    try {
      this.styleIndex = Number(localStorage.getItem('ps-style') ?? 0) % BALL_STYLES.length;
      this.bumpers = localStorage.getItem('ps-bumpers') === '1';
    } catch {
      /* storage unavailable */
    }
  }

  /** Builds the rack diagram: back row across the top, head pin at the bottom. */
  setRackLayout(rows: number): void {
    const rack = $('rack');
    rack.innerHTML = '';
    this.rackDots.clear();
    const dot = rows > 4 ? 4 : 8;
    const stepX = rows > 4 ? 5.2 : 14;
    const stepY = rows > 4 ? 4.6 : 12;
    rack.classList.toggle('mega', rows > 4);
    let id = 1;
    for (let row = 0; row < rows; row++) {
      for (let k = 0; k <= row; k++) {
        const d = document.createElement('i');
        d.style.width = d.style.height = `${dot}px`;
        d.style.left = `${(k + (rows - 1 - row) / 2) * stepX + 2}px`;
        d.style.top = `${(rows - 1 - row) * stepY + 2}px`;
        d.title = `Pin ${id}`;
        rack.appendChild(d);
        this.rackDots.set(id, d);
        id++;
      }
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

  /** `colors` highlights special pins (by pin id) in their power-up color. */
  setRack(standing: readonly number[], colors?: ReadonlyMap<number, string>): void {
    for (const [id, el] of this.rackDots) {
      el.classList.toggle('down', !standing.includes(id));
      const c = colors?.get(id);
      el.style.background = c ?? '';
      el.style.boxShadow = c ? `0 0 8px ${c}, 0 0 2px ${c}` : '';
      el.classList.toggle('special', !!c);
    }
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

  showMenu(best: number, bestRun: number, onPlay: (style: BallStyle, bumpers: boolean, mode: Mode) => void): void {
    $('over').hidden = true;
    $('runover').hidden = true;
    $('shop').hidden = true;
    const menu = $('menu');
    menu.hidden = false;
    const parts: string[] = [];
    if (best) parts.push(`Best classic game: ${best}`);
    if (bestRun) parts.push(`Furthest run: stage ${Math.min(bestRun, STAGES.length)}${bestRun >= STAGES.length ? ' (champion!)' : ''}`);
    $('menuBest').textContent = parts.length ? parts.join(' · ') : 'No games bowled yet';

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

    const go = (mode: Mode) => {
      this.bumpers = bump.checked;
      try {
        localStorage.setItem('ps-style', String(this.styleIndex));
        localStorage.setItem('ps-bumpers', this.bumpers ? '1' : '0');
      } catch {
        /* ignore */
      }
      menu.hidden = true;
      onPlay(BALL_STYLES[this.styleIndex], this.bumpers, mode);
    };
    $('play').onclick = () => go('classic');
    $('playRun').onclick = () => go('run');
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

// ---- Roguelike run UI ------------------------------------------------------

Hud.prototype.setMode = function (this: Hud, mode: Mode): void {
  document.body.classList.toggle('run-mode', mode === 'run');
};

Hud.prototype.renderRun = function (this: Hud, run: Run, frame: number): void {
  const st = run.stageInfo;
  $('stageName').textContent = `Stage ${run.stage + 1}/${STAGES.length} · ${st.name}`;
  $('stageName').classList.toggle('boss', !!st.boss);
  $('coins').textContent = `🪙 ${run.coins}`;
  const frac = Math.min(1, run.stageScore / st.target);
  $('progFill').style.width = `${frac * 100}%`;
  $('progFill').classList.toggle('done', frac >= 1);
  $('progText').textContent = `${run.stageScore} / ${st.target}`;
  const dots = $('frameDots');
  dots.innerHTML = '';
  for (let i = 0; i < run.framesPerStage; i++) {
    const d = document.createElement('i');
    if (i < frame) d.className = 'used';
    else if (i === frame) d.className = 'now';
    dots.appendChild(d);
  }
  const row = $('perkRow');
  row.innerHTML = '';
  for (const [id, n] of run.perks) {
    const perk = PERKS.find((p) => p.id === id)!;
    const el = document.createElement('span');
    el.title = `${perk.name}: ${perk.desc}`;
    el.textContent = perk.icon + (n > 1 ? `×${n}` : '');
    row.appendChild(el);
  }
};

Hud.prototype.renderInventory = function (this: Hud, run: Run, onToggle: (i: number) => void): void {
  const inv = $('inv');
  inv.innerHTML = '';
  for (let i = 0; i < run.slots; i++) {
    const kind = run.inventory[i];
    const b = document.createElement('button');
    b.className = 'slot' + (kind ? ' full' : '') + (run.armed.has(i) ? ' armed' : '');
    if (kind) {
      const info = POWERS[kind];
      b.style.setProperty('--c', info.color);
      b.innerHTML = `<span class="ico">${info.icon}</span>`;
      b.setAttribute('aria-label', `${run.armed.has(i) ? 'Disarm' : 'Arm'} ${info.name}`);
      b.title = `${info.name}: ${info.desc}`;
      b.onclick = () => onToggle(i);
    } else {
      b.disabled = true;
      b.setAttribute('aria-label', 'Empty power-up slot');
    }
    inv.appendChild(b);
  }
  const armed = [...run.armed].map((i) => run.inventory[i]).filter(Boolean);
  const label = $('invLabel');
  label.textContent = armed.length
    ? `Armed: ${armed.map((k) => POWERS[k].name).join(' + ')}`
    : run.inventory.length
      ? 'Tap a power-up to arm it'
      : 'Knock down glowing pins for power-ups';
  label.classList.toggle('armed', armed.length > 0);
};

Hud.prototype.points = function (this: Hud, p: BallPoints): void {
  const el = $('points');
  const mult = Number.isInteger(p.mult) ? String(p.mult) : p.mult.toFixed(1);
  el.innerHTML = `<span class="chips">${p.chips}</span> × <span class="mult">${mult}</span> = <b>+${p.total}</b>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
};

Hud.prototype.floatText = function (this: Hud, text: string, x: number, y: number, color: string): void {
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = color;
  $('floats').appendChild(el);
  window.setTimeout(() => el.remove(), 1400);
};

Hud.prototype.showShop = function (
  this: Hud,
  run: Run,
  reward: { label: string; coins: number }[],
  onDone: () => void,
  onBuy: () => void,
): void {
  const shop = $('shop');
  shop.hidden = false;
  $('shopTitle').textContent = `${run.stageInfo.name} cleared!`;
  $('shopScore').textContent = `${run.stageScore} / ${run.stageInfo.target}`;
  $('shopReward').textContent = reward.map((r) => `${r.label} +${r.coins}`).join(' · ');
  const next = STAGES[run.stage + 1];
  $('shopNext').textContent = `Next: ${next.name}, target ${next.target}${next.boss ? ` · BOSS: ${next.boss}` : ''}`;

  let offers: Perk[] = run.offerPerks();
  let picked = false;
  const powerOffers = run.offerPowers().map((p) => ({ p, sold: false }));

  const render = () => {
    $('shopCoins').textContent = `🪙 ${run.coins}`;
    const cards = $('cards');
    cards.innerHTML = '';
    for (const perk of offers) {
      const b = document.createElement('button');
      b.className = 'perk' + (perk.rare ? ' rare' : '');
      const owned = run.has(perk.id);
      b.innerHTML = `<span class="ico">${perk.icon}</span><b>${perk.name}</b><small>${perk.desc}</small>${owned ? `<em>Owned ×${owned}</em>` : perk.rare ? '<em>Rare</em>' : ''}`;
      b.disabled = picked;
      b.onclick = () => {
        if (picked) return;
        picked = true;
        run.takePerk(perk.id);
        b.classList.add('taken');
        onBuy();
        render();
        b.classList.add('taken');
      };
      cards.appendChild(b);
    }
    const reroll = $<HTMLButtonElement>('reroll');
    reroll.textContent = `Reroll perks · 🪙 ${REROLL_PRICE}`;
    reroll.disabled = picked || run.coins < REROLL_PRICE;
    reroll.onclick = () => {
      if (run.coins < REROLL_PRICE || picked) return;
      run.coins -= REROLL_PRICE;
      offers = run.offerPerks();
      render();
    };
    const shelf = $('shelf');
    shelf.innerHTML = '';
    for (const offer of powerOffers) {
      const info = POWERS[offer.p];
      const b = document.createElement('button');
      b.className = 'power';
      b.style.setProperty('--c', info.color);
      const full = run.inventory.length >= run.slots;
      b.innerHTML = `<span class="ico">${info.icon}</span><span><b>${info.name}</b><small>${info.desc}</small></span><span class="price">${offer.sold ? 'Sold' : full ? 'Full' : `🪙 ${POWER_PRICE}`}</span>`;
      b.disabled = offer.sold || full || run.coins < POWER_PRICE;
      b.onclick = () => {
        if (offer.sold || run.coins < POWER_PRICE || run.inventory.length >= run.slots) return;
        run.coins -= POWER_PRICE;
        run.inventory.push(offer.p);
        offer.sold = true;
        onBuy();
        render();
      };
      shelf.appendChild(b);
    }
    $('shopGo').textContent = picked ? 'Next lane ▸' : 'Skip perk ▸';
  };
  render();
  $('shopGo').onclick = () => {
    shop.hidden = true;
    onDone();
  };
};

Hud.prototype.showRunOver = function (
  this: Hud,
  run: Run,
  victory: boolean,
  newBest: boolean,
  onAgain: () => void,
  onMenu: () => void,
): void {
  const el = $('runover');
  el.hidden = false;
  $('roTitle').textContent = victory ? 'CHAMPION!' : 'RUN OVER';
  $('roTitle').classList.toggle('win', victory);
  $('roSub').textContent = victory
    ? `You conquered all ${STAGES.length} lanes.`
    : `${run.stageInfo.name}: ${run.stageScore} of ${run.stageInfo.target} needed`;
  $('roStats').innerHTML = [
    ['Stage reached', `${Math.min(run.stage + 1, STAGES.length)} / ${STAGES.length}`],
    ['Total points', String(run.totalScore)],
    ['Big hits · spares', `${run.bigHits} · ${run.spares}`],
    ['Special pins', String(run.specialsHit)],
  ]
    .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
    .join('');
  const perks = [...run.perks].map(([id, n]) => {
    const p = PERKS.find((x) => x.id === id)!;
    return `${p.icon} ${p.name}${n > 1 ? ` ×${n}` : ''}`;
  });
  $('roPerks').textContent = perks.length ? perks.join(' · ') : 'No perks this run';
  $('roBest').textContent = newBest ? 'New personal best!' : '';
  $('roAgain').onclick = () => {
    el.hidden = true;
    onAgain();
  };
  $('roMenu').onclick = () => {
    el.hidden = true;
    onMenu();
  };
};

declare module './hud.ts' {
  interface Hud {
    setMode(mode: Mode): void;
    renderRun(run: Run, frame: number): void;
    renderInventory(run: Run, onToggle: (i: number) => void): void;
    points(p: BallPoints): void;
    floatText(text: string, x: number, y: number, color: string): void;
    showShop(run: Run, reward: { label: string; coins: number }[], onDone: () => void, onBuy: () => void): void;
    showRunOver(run: Run, victory: boolean, newBest: boolean, onAgain: () => void, onMenu: () => void): void;
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
