import { registerSW } from 'virtual:pwa-register';

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

/** A small pill at the bottom of the screen for "offline ready" and "update" notices. */
function pill(text: string, action?: { label: string; run: () => void }, ms = 0): void {
  const el = $('pwaPill');
  $('pwaText').textContent = text;
  const btn = $('pwaAction') as HTMLButtonElement;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = action.run;
  }
  el.hidden = false;
  if (ms) window.setTimeout(() => (el.hidden = true), ms);
}

/**
 * Registers the service worker (offline support) and wires up install and
 * update prompts. Updates never apply on their own: the player taps "Update"
 * when it suits them, so a new version can't reload the page mid-game.
 */
export function setupPwa(): void {
  if (!('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    onNeedRefresh() {
      pill('A new version of Pocket Strike is ready.', { label: 'Update', run: () => void updateSW(true) });
    },
    onOfflineReady() {
      pill('Ready to play offline.', undefined, 3500);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
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
  });

  // Install button in the menu (Chromium browsers fire beforeinstallprompt).
  let deferred: BeforeInstallPromptEvent | null = null;
  const installBtn = $('installBtn') as HTMLButtonElement;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    installBtn.hidden = false;
  });
  installBtn.onclick = async () => {
    if (!deferred) return;
    installBtn.hidden = true;
    await deferred.prompt();
    await deferred.userChoice;
    deferred = null;
  };
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    deferred = null;
  });

  // iOS Safari has no install prompt: explain the Share-sheet route instead.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !isStandalone()) $('iosHint').hidden = false;
}
