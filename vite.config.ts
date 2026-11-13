import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const NIGHT = '#0c0a1f';

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages /pocket-strike/).
  base: './',
  server: { host: true },
  build: { chunkSizeWarningLimit: 1000 },
  plugins: [
    VitePWA({
      // Never reload on our own: a new version waits until the player taps "Update"
      // (src/pwa.ts), so an update can't interrupt a game in progress.
      registerType: 'prompt',
      injectRegister: false,
      // Our own service worker (src/sw.ts), written against @vite-pwa/workbox-swkit.
      // The build bundles it and injects the precache manifest into it.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Pocket Strike',
        short_name: 'Pocket Strike',
        description: 'Neon 2D bowling for your phone: flick to bowl, curve to hook, and take on the 55-pin Neon Run.',
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
          { src: 'screenshots/menu.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Pick a ball and a mode' },
          { src: 'screenshots/strike.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Strike!' },
          { src: 'screenshots/neon-run.png', sizes: '780x1688', type: 'image/png', form_factor: 'narrow', label: 'Neon Run: 55 pins and power-ups' },
        ],
      },
      injectManifest: {
        // Everything the game needs is precached, so it plays fully offline.
        // The plugin adds the icons and manifest; screenshots are only for the
        // install dialog, so they're left out.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        globIgnores: ['screenshots/**'],
        // A single self-contained classic script: no module workers needed.
        rollupFormat: 'iife',
      },
    }),
  ],
});
