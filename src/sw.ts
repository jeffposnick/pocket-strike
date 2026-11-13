/// <reference lib="webworker" />
// The service worker, built from this file by vite-plugin-pwa (injectManifest)
// using Workbox's runtime from @vite-pwa/workbox-swkit. Import from the
// subpath exports (…/precaching, …/routing): the package's barrel file is only
// meant for @vite-pwa/workbox-build.
import { clientsClaim } from '@vite-pwa/workbox-swkit/core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from '@vite-pwa/workbox-swkit/precaching';
import { NavigationRoute, registerRoute } from '@vite-pwa/workbox-swkit/routing';

declare let self: ServiceWorkerGlobalScope;

// Precache the whole game: the build injects the list of hashed assets here.
// Nothing loads from another origin, so this is everything needed to play
// offline. Downloading a few files at a time makes the first install (about
// 700 KB) finish sooner without starving the page that's loading the game.
precacheAndRoute(self.__WB_MANIFEST, { parallel: { enabled: true, concurrency: 4 } });
cleanupOutdatedCaches();

// It's a single-page app: every navigation in scope gets the precached shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Take control of the open page as soon as the first install finishes.
clientsClaim();

// Updates are "prompt" style: a new worker waits until the player taps
// "Update" (src/pwa.ts), and the page then asks it to take over.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
