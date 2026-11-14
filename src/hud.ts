import { BALL_STYLES } from './art.ts';
import type { BallStyle } from './art.ts';
import type { Mode } from './lanes.ts';
import { PERKS, POWERS, REROLL_PRICE, STAGES } from './run.ts';
import type { BallPoints, Perk, Run } from './run.ts';
import type { FrameView } from './scoring.ts';
import { toast } from './pwa.ts';
import { loadFlag, loadNumber, save } from './storage.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Return value that marks a dialog as closed by the game rather than by Esc or the back gesture. */
const DONE = 'done';

/** Opens an overlay as a native modal dialog: the page behind goes inert and focus moves inside. */
export function openDialog(id: string): void {
  const d = $<HTMLDialogElement>(id);
  if (!d.open) d.showModal();
}

/** Closes an overlay opened with `openDialog`. Focus returns to the element that opened it. */
export function closeDialog(id: string): void {
  const d = $<HTMLDialogElement>(id);
  if (d.open) d.close(DONE);
}

/**
 * Every overlay is a step in the game flow that only its own buttons can leave, so Esc and the
 * Android back gesture must not close it. `cancel` is prevented, and because browsers stop honouring
 * that after repeated presses without user activation, a dialog that closes anyway reopens.
 */
function guardDialogs(): void {
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog.overlay')) {
    d.addEventListener('cancel', (e) => e.preventDefault());
    d.addEventListener('close', () => {
      if (d.returnValue !== DONE) d.showModal();
      d.returnValue = '';
    });
  }
}

const FLICK_HINT = '<b>Slide</b> to line up · <b>Flick up</b> to bowl<br />Curve the flick to <b>hook</b> the ball';
const SWING_HINT =
  '<b>Hold</b> your thumb down · <b>Swing</b>, then <b>let go</b><br />Twist your wrist to <b>hook</b> the ball';
const PAD_HINT =
  '<b>Stick</b> or <b>d-pad</b> to line up · <b>Pull back</b>, then <b>push</b> to bowl<br />Curve the push to <b>hook</b> the ball';

/** Which controls the how-to-bowl hint describes. */
export type ControlsHint = 'touch' | 'swing' | 'pad';

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
    guardDialogs();
    const board = $('board');
    for (let f = 0; f < 10; f++) {
      const el = document.createElement('div');
      el.className = 'frame' + (f === 9 ? ' tenth' : '');
      el.innerHTML = `<div class="fno">${f + 1}</div><div class="marks">${'<span></span>'.repeat(f === 9 ? 3 : 2)}</div><div class="ftot"></div>`;
      board.appendChild(el);
    }
    this.setRackLayout(4);
    this.styleIndex = loadNumber('ps-style') % BALL_STYLES.length;
    this.bumpers = loadFlag('ps-bumpers');
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
    const up = [...this.rackDots.keys()].filter((id) => standing.includes(id)).length;
    $('rack').setAttribute('aria-label', `${up} of ${this.rackDots.size} pins standing`);
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
    let muted = loadFlag('ps-muted');
    const apply = () => {
      btn.textContent = muted ? '🔇' : '🔊';
      btn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      handler(muted);
    };
    btn.onclick = () => {
      muted = !muted;
      save('ps-muted', muted);
      apply();
    };
    apply();
  }

  /**
   * Swing controls: the menu switch and the in-game button. Both only ask `onChange` for a new
   * state; `setSwing` shows the state that actually took effect (permission can refuse it).
   */
  initSwing(supported: boolean, onChange: (on: boolean) => void): void {
    $('swingToggle').hidden = !supported;
    $('swingBtn').hidden = !supported;
    const input = $<HTMLInputElement>('swing');
    input.addEventListener('change', () => onChange(input.checked));
    $('swingBtn').onclick = () => onChange($('swingBtn').getAttribute('aria-pressed') !== 'true');
  }

  /** Shows whether swing controls are on, with an optional note (why it couldn't be turned on). */
  setSwing(on: boolean, note = ''): void {
    $<HTMLInputElement>('swing').checked = on;
    const btn = $('swingBtn');
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Swing to bowl is on' : 'Swing to bowl is off';
    const el = $('swingNote');
    el.textContent = note;
    el.hidden = !note;
    // Outside the menu the note would go unseen, so it becomes a toast.
    if (note && !document.querySelector('dialog:modal')) toast(note, 5000);
  }

  /** Sets the how-to-bowl hint for the controls in use. */
  setControlsHint(kind: ControlsHint): void {
    const hint = $('hint');
    hint.classList.toggle('noHand', kind !== 'touch');
    hint.querySelector('p')!.innerHTML = kind === 'swing' ? SWING_HINT : kind === 'pad' ? PAD_HINT : FLICK_HINT;
  }

  /** Controllers came or went: the menu explains the controller controls while one is connected. */
  setPadConnected(count: number, announce: string): void {
    $('padHow').hidden = count === 0;
    // In the menu the controller line says enough; a toast would only wait for the menu to close.
    if (!document.querySelector('dialog:modal')) toast(announce, 3000);
  }

  /** How to swing, and a word about grip. Shown the first time swing controls are switched on. */
  showSwingIntro(): void {
    openDialog('swingIntro');
    $('swingOk').onclick = () => closeDialog('swingIntro');
  }

  onMenuButton(handler: () => void): void {
    $('menuBtn').onclick = handler;
  }

  showMenu(best: number, bestRun: number, onPlay: (style: BallStyle, bumpers: boolean, mode: Mode) => void): void {
    closeDialog('over');
    closeDialog('runover');
    closeDialog('shop');
    const parts: string[] = [];
    if (best) parts.push(`Best classic game: ${best}`);
    if (bestRun)
      parts.push(
        `Furthest run: stage ${Math.min(bestRun, STAGES.length)}${bestRun >= STAGES.length ? ' (champion!)' : ''}`,
      );
    $('menuBest').textContent = parts.length ? parts.join(' · ') : 'No games bowled yet';

    // A radio group, so the chosen ball is exposed as a checked state, not just a highlight.
    const picks = $('balls');
    picks.querySelectorAll('label').forEach((el) => el.remove());
    BALL_STYLES.forEach((s, i) => {
      const label = document.createElement('label');
      label.className = 'ballPick';
      label.style.setProperty('--a', s.a);
      label.style.setProperty('--b', s.b);
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'ball';
      radio.checked = i === this.styleIndex;
      radio.addEventListener('change', () => (this.styleIndex = i));
      label.append(
        radio,
        document.createElement('i'),
        Object.assign(document.createElement('span'), { textContent: s.name }),
      );
      picks.appendChild(label);
    });

    const bump = $<HTMLInputElement>('bumpers');
    bump.checked = this.bumpers;

    const go = (mode: Mode) => {
      this.bumpers = bump.checked;
      save('ps-style', this.styleIndex);
      save('ps-bumpers', this.bumpers);
      closeDialog('menu');
      onPlay(BALL_STYLES[this.styleIndex], this.bumpers, mode);
    };
    $('play').onclick = () => go('classic');
    $('playRun').onclick = () => go('run');
    openDialog('menu');
  }

  showOver(stats: GameOverStats, onAgain: () => void, onMenu: () => void): void {
    $('finalScore').textContent = String(stats.score);
    $('finalBest').textContent = stats.newBest ? 'New personal best!' : `Best: ${stats.best}`;
    $('finalBest').classList.toggle('new', stats.newBest);
    $('finalStats').textContent =
      `${stats.strikes} strike${stats.strikes === 1 ? '' : 's'} · ${stats.spares} spare${stats.spares === 1 ? '' : 's'}`;
    $('finalRating').textContent = rating(stats.score);
    openDialog('over');
    $('again').onclick = () => {
      closeDialog('over');
      onAgain();
    };
    $('toMenu').onclick = () => {
      closeDialog('over');
      onMenu();
    };
  }

  // ---- Neon Run ------------------------------------------------------------------

  setMode(mode: Mode): void {
    document.body.classList.toggle('run-mode', mode === 'run');
  }

  renderRun(run: Run, frame: number): void {
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
  }

  renderInventory(run: Run, onToggle: (i: number) => void): void {
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
  }

  points(p: BallPoints): void {
    const el = $('points');
    const mult = Number.isInteger(p.mult) ? String(p.mult) : p.mult.toFixed(1);
    el.innerHTML = `<span class="chips">${p.chips}</span> × <span class="mult">${mult}</span> = <b>+${p.total}</b>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  floatText(text: string, x: number, y: number, color: string): void {
    const el = document.createElement('div');
    el.className = 'float';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = color;
    $('floats').appendChild(el);
    window.setTimeout(() => el.remove(), 1400);
  }

  showShop(run: Run, reward: { label: string; coins: number }[], onDone: () => void, onBuy: () => void): void {
    $('shopTitle').textContent = `${run.stageInfo.name} cleared!`;
    $('shopScore').textContent = `${run.stageScore} / ${run.stageInfo.target}`;
    $('shopReward').textContent = reward.map((r) => `${r.label} +${r.coins}`).join(' · ');
    const next = STAGES[run.stage + 1];
    $('shopNext').textContent = `Next: ${next.name}, target ${next.target}${next.boss ? ` · BOSS: ${next.boss}` : ''}`;

    let offers: Perk[] = run.offerPerks();
    let picked: Perk | null = null;
    const powerOffers = run.offerShop().map((o) => ({ ...o, sold: false, revealed: false }));

    const render = () => {
      $('shopCoins').textContent = `🪙 ${run.coins}`;
      const cards = $('cards');
      cards.innerHTML = '';
      for (const perk of offers) {
        const b = document.createElement('button');
        b.className = 'perk' + (perk.rare ? ' rare' : '') + (perk === picked ? ' taken' : '');
        const owned = run.has(perk.id);
        b.innerHTML = `<span class="ico">${perk.icon}</span><b>${perk.name}</b><small>${perk.desc}</small>${owned ? `<em>Owned ×${owned}</em>` : perk.rare ? '<em>Rare</em>' : ''}`;
        b.disabled = !!picked;
        b.onclick = () => {
          if (picked) return;
          picked = perk;
          run.takePerk(perk.id);
          onBuy();
          render();
        };
        cards.appendChild(b);
      }
      const reroll = $<HTMLButtonElement>('reroll');
      reroll.textContent = `Reroll perks · 🪙 ${REROLL_PRICE}`;
      reroll.disabled = !!picked || run.coins < REROLL_PRICE;
      reroll.onclick = () => {
        if (run.coins < REROLL_PRICE || picked) return;
        run.coins -= REROLL_PRICE;
        offers = run.offerPerks();
        render();
      };
      const shelf = $('shelf');
      shelf.innerHTML = '';
      for (const offer of powerOffers) {
        const info = POWERS[offer.power];
        const hidden = offer.mystery && !offer.revealed;
        const b = document.createElement('button');
        b.className = `power ${hidden ? 'mystery' : info.rarity}`;
        if (!hidden) b.style.setProperty('--c', info.color);
        const full = run.inventory.length >= run.slots;
        const badge = hidden
          ? 'Mystery'
          : info.rarity === 'common'
            ? ''
            : info.rarity === 'rare'
              ? 'Rare'
              : 'Legendary';
        const name = hidden ? 'Mystery Box' : info.name;
        const desc = hidden
          ? 'A random power-up. Usually common, sometimes rare, now and then legendary.'
          : offer.mystery
            ? `From the box: ${info.desc}`
            : info.desc;
        b.innerHTML =
          `<span class="ico">${hidden ? '🎁' : info.icon}</span>` +
          `<span><b>${name}${badge ? ` <em>${badge}</em>` : ''}</b><small>${desc}</small></span>` +
          `<span class="price">${offer.sold ? 'Sold' : full ? 'Full' : `🪙 ${offer.price}`}</span>`;
        b.disabled = offer.sold || full || run.coins < offer.price;
        b.onclick = () => {
          if (offer.sold || !run.buy(offer)) return;
          offer.sold = true;
          offer.revealed = true;
          onBuy();
          render();
        };
        shelf.appendChild(b);
      }
      $('shopGo').textContent = picked ? 'Next lane ▸' : 'Skip perk ▸';
    };
    render();
    openDialog('shop');
    $('shopGo').onclick = () => {
      closeDialog('shop');
      onDone();
    };
  }

  showRunOver(run: Run, victory: boolean, newBest: boolean, onAgain: () => void, onMenu: () => void): void {
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
    openDialog('runover');
    $('roAgain').onclick = () => {
      closeDialog('runover');
      onAgain();
    };
    $('roMenu').onclick = () => {
      closeDialog('runover');
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
