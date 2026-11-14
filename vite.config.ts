import { ViteWorkboxPWAPlugin } from '@vite-pwa/workbox-build/build/vite/plugin';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const NIGHT = '#0c0a1f';

/** The web app manifest: makes the game installable, with its name, colours, icons and screenshots. */
const MANIFEST = {
  id: './',
  name: 'Pocket Strike',
  short_name: 'Pocket Strike',
  description: 'Neon 2D bowling for your phone: flick to bowl, curve to hook, and take on the 55-pin Neon Run.',
  lang: 'en',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: NIGHT,
  theme_color: NIGHT,
  categories: ['games', 'entertainment'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
  screenshots: [
    {
      src: 'screenshots/menu.png',
      sizes: '780x1688',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Pick a ball and a mode',
    },
    { src: 'screenshots/strike.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Strike!' },
    {
      src: 'screenshots/neon-run.png',
      sizes: '780x1688',
      type: 'image/png',
      form_factor: 'narrow',
      label: 'Neon Run: 55 pins and power-ups',
    },
  ],
};

/** Writes `manifest.webmanifest` into the build and links it from index.html. */
function webManifest(manifest: object): Plugin {
  return {
    name: 'pocket-strike:web-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest) });
    },
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages /pocket-strike/).
  base: './',
  server: { host: true },
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [
    webManifest(MANIFEST),
    // Our own service worker (src/sw.ts, written against @vite-pwa/workbox-swkit). Once the app is built,
    // @vite-pwa/workbox-build bundles it into dist/sw.js and injects the precache list. Registration and
    // the "Update" prompt are in src/pwa.ts.
    ViteWorkboxPWAPlugin({
      strategy: 'build-sw',
      buildSW: {
        swSrc: 'src/sw.ts',
        swDest: 'sw.js',
        // A single self-contained classic script: no module workers, no separate Workbox runtime file.
        swType: 'classic',
        inlineWorkboxRuntime: true,
        // Everything the game needs is precached, so it plays fully offline. The screenshots are only for
        // the install dialog, so they're left out.
        globPatterns: [
          '**/*.{js,css,html,woff2,webmanifest}',
          'favicon.svg',
          'favicon-32.png',
          'apple-touch-icon.png',
          'icon-*.png',
        ],
        globIgnores: ['screenshots/**'],
      },
    }),
  ],
});
