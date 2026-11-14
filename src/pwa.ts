/** The non-standard install prompt event (Chromium browsers). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const canPopover = 'showPopover' in HTMLElement.prototype;
let pillTimer = 0;
let pending: (() => void) | null = null;

function hidePill(): void {
  window.clearTimeout(pillTimer);
  const el = $('pwaPill');
  if (canPopover) {
    if (el.matches(':popover-open')) el.hidePopover();
  } else {
    el.classList.remove('open');
  }
}

/** Screen readers hear toasts through ariaNotify(), or a polite live region where it's missing. */
function announce(text: string): void {
  const doc = document as Document & { ariaNotify?: (message: string) => void };
  if (doc.ariaNotify) {
    doc.ariaNotify(text);
  } else {
    const region = $('announcer');
    region.textContent = '';
    window.setTimeout(() => (region.textContent = text), 50);
  }
}

/**
 * A small toast at the bottom of the screen for "offline ready" and "update" notices. While a modal
 * dialog (menu, results, shop) is open the rest of the page is inert, so the toast waits until it closes.
 */
function pill(text: string, action?: { label: string; run: () => void }, ms = 0): void {
  const show = () => {
    $('pwaText').textContent = text;
    const btn = $('pwaAction') as HTMLButtonElement;
    btn.hidden = !action;
    if (action) {
      btn.textContent = action.label;
      btn.onclick = action.run;
    }
    hidePill();
    const el = $('pwaPill');
    if (canPopover) el.showPopover();
    else el.classList.add('open');
    announce(action ? `${text} Actions available.` : text);
    if (ms) pillTimer = window.setTimeout(hidePill, ms);
  };
  if (document.querySelector('dialog:modal')) pending = show;
  else show();
}

/** A plain notice in the same toast, for other parts of the game. */
export function toast(text: string, ms: number): void {
  pill(text, undefined, ms);
}

/** `close` doesn't bubble, so listen in the capture phase; a guarded dialog may reopen right after. */
document.addEventListener(
  'close',
  () =>
    window.setTimeout(() => {
      if (pending && !document.querySelector('dialog:modal')) {
        const show = pending;
        pending = null;
        show();
      }
    }),
  true,
);

interface SwHandlers {
  /** A new version is installed and waiting; `update` tells it to take over (the page then reloads). */
  onNeedRefresh(update: () => void): void;
  /** The first install finished: everything is cached for offline play. */
  onOfflineReady(): void;
  onRegistered(registration: ServiceWorkerRegistration): void;
}

/**
 * Registers `sw.js` with workbox-window, "prompt" style: a new version waits until `update` is called,
 * then the page reloads once it takes control. workbox-window loads lazily, after the game.
 */
async function registerServiceWorker(on: SwHandlers): Promise<void> {
  const { Workbox } = await import('@vite-pwa/workbox-window');
  const wb = new Workbox('./sw.js', { scope: './', type: 'classic' });
  let needRefresh = false;
  const showUpdate = () => {
    if (!needRefresh) {
      needRefresh = true;
      wb.addEventListener('controlling', (e) => {
        if (e.isUpdate) window.location.reload();
      });
    }
    on.onNeedRefresh(() => wb.messageSkipWaiting());
  };
  wb.addEventListener('waiting', showUpdate);
  wb.addEventListener('installed', (e) => {
    // A worker installed by another tab (isExternal) is an update this page didn't see coming.
    if (e.isExternal) showUpdate();
    else if (!e.isUpdate && !needRefresh) on.onOfflineReady();
  });
  const registration = await wb.register({ immediate: false });
  if (registration) on.onRegistered(registration);
}

/**
 * Registers the service worker (offline support) and wires up install and
 * update prompts. Updates never apply on their own: the player taps "Update"
 * when it suits them, so a new version can't reload the page mid-game.
 */
export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return;

  $('pwaClose').onclick = hidePill;

  // The dev server builds no service worker (see vite.config.ts), so only production builds register one.
  if (import.meta.env.PROD) registerOfflineSupport();

  installPrompt();
}

function registerOfflineSupport(): void {
  void registerServiceWorker({
    onNeedRefresh(update) {
      // The toast is a shortcut; the menu always offers the update too.
      const updateBtn = $('updateBtn') as HTMLButtonElement;
      updateBtn.onclick = update;
      updateBtn.hidden = false;
      pill('A new version of Pocket Strike is ready.', { label: 'Update', run: update });
    },
    onOfflineReady() {
      pill('Ready to play offline.', undefined, 3500);
    },
    onRegistered(registration) {
      // Browsers only look for a new service worker on navigation, and an
      // installed game can stay open for a long time. Check on startup, when
      // the game comes back to the foreground, and hourly while it's open.
      const check = () => {
        // Skip while the first install is still in progress; there's nothing to update yet.
        if (navigator.onLine && registration.active && !registration.installing) {
          registration.update().catch(() => {});
        }
      };
      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.setInterval(check, 60 * 60 * 1000);
    },
  }).catch((err) => console.error('Service worker registration failed', err));
}

function installPrompt(): void {
  // Install button in the menu. The Web Install API (navigator.install) is preferred; Chromium's
  // beforeinstallprompt is the fallback. The button stays hidden unless one of them can install.
  const nav = navigator as Navigator & { install?: () => Promise<void> };
  const webInstall = typeof nav.install === 'function';
  let deferred: BeforeInstallPromptEvent | null = null;
  const installBtn = $('installBtn') as HTMLButtonElement;
  if (webInstall && !isStandalone()) installBtn.hidden = false;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    if (!webInstall) installBtn.hidden = false;
  });
  installBtn.onclick = async () => {
    if (installBtn.getAttribute('aria-disabled') === 'true') return;
    // aria-disabled rather than disabled, so focus isn't dropped while the browser's dialog is up.
    installBtn.setAttribute('aria-disabled', 'true');
    try {
      if (webInstall) {
        // Called straight from the click handler so it keeps the user activation it needs.
        await nav.install!();
        installBtn.hidden = true;
      } else if (deferred) {
        // The event is single-use: drop it before awaiting the choice.
        const prompt = deferred;
        deferred = null;
        await prompt.prompt();
        await prompt.userChoice;
        if (!deferred) installBtn.hidden = true;
      }
    } catch (err) {
      // AbortError is the player cancelling; keep the button so they can try again.
      if ((err as DOMException).name !== 'AbortError') console.error(err);
    } finally {
      installBtn.removeAttribute('aria-disabled');
    }
  };
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferred = null;
  });

  // iOS Safari has no install prompt: explain the Share-sheet route instead.
  const ios =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !isStandalone()) $('iosHint').hidden = false;
}
