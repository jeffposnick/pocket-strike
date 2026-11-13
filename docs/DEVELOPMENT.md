# Development guide

## Setup

```sh
npm install
npm run dev        # Vite dev server on :5173, exposed on your LAN so a phone can load it
npm run build      # tsc type-check + production build into dist/
npm run preview    # serve dist/
```

Node 22.18 or newer: the `tools/sim` scripts rely on Node's built-in TypeScript type stripping
(no ts-node or tsx). That's also why `src/` imports use explicit `.ts` extensions and avoids
TypeScript-only runtime syntax such as enums and parameter properties (`erasableSyntaxOnly`).

## Checks

| Command | What it does | Time |
| --- | --- | --- |
| `npm run typecheck` | TypeScript, strict mode | seconds |
| `npm test` | Scoring unit tests + physics regression checks (`tools/sim/settle.ts`) | ~1 min |
| `npm run sim:pinfall` | Pinfall survey for both racks and every power-up | ~2–5 min |
| `npm run sim:balance` | Neon Run win rates by skill level (`--runs 30`) | ~5–10 min |

The physics checks are statistical and their thresholds have headroom. A rare flaky failure means
"look closer", not "retry until green".

## Testing in a real browser

The dev build exposes the scene as `window.lanes` (only when `import.meta.env.DEV`), which makes
scripted checks easy:

```js
// In the browser console, or page.evaluate() from Playwright
const l = window.lanes;
l.sim.ball.x = 80;
l.throwBall(2300, 0, -0.4); // speed (px/s), angle (rad), spin (-1..1, negative hooks left)
```

When automating with Playwright:
- Emulate a phone (e.g. `devices['iPhone 13']`) with `deviceScaleFactor: 1`.
- Headless Chromium renders in software, and above 200 ms per frame Excalibur's clock treats the
  frame as 1 ms, so the game crawls at high pixel densities.
- Frame rates measured headless don't reflect real devices.

## Deployment

Every push to `main` (including merged pull requests) runs `.github/workflows/deploy.yml`:
install, test, build, then publish `dist/` to the `gh-pages` branch.

One-time repo setting: **Settings → Pages → Build and deployment → Source: Deploy from a branch,
Branch: `gh-pages` / root.** The site is then at `https://<owner>.github.io/pocket-strike/`.

`vite.config.ts` sets `base: './'` so the build works from any sub-path.

## PWA (offline + installable)

`vite-plugin-pwa` (configured in `vite.config.ts`) generates a Workbox service worker (`dist/sw.js`) and
`manifest.webmanifest` at build time.

- **Offline:** everything the game needs is precached (JS, CSS, HTML, the self-hosted woff2 fonts,
  icons), about 700 KB in 15 files. Fonts come from `@fontsource/*` rather than Google Fonts, so
  nothing loads from another origin at runtime.
- **Updates:** `registerType: 'prompt'`. A new build installs in the background, and `src/pwa.ts`
  shows an "Update" pill; nothing reloads until the player taps it, so an update never interrupts a
  game. Besides the browser's own check on navigation, `src/pwa.ts` calls `registration.update()` on
  startup, whenever the app returns to the foreground, and hourly. An installed game can stay open
  for days, and the navigation check alone proved unreliable in testing.
- **Install:** Chromium's `beforeinstallprompt` is captured and shown as an "Install app" button in
  the menu. iOS Safari has no prompt, so the menu explains Share → Add to Home Screen instead.
- **Icons:** `tools/icons/icon.svg` is the source. `node tools/icons/render.cjs` (needs Playwright)
  renders `public/icon-*.png`, the maskable icon (art shrunk into the 80% safe zone), the Apple touch
  icon and favicons.
- **Install-dialog screenshots:** `public/screenshots/*.png` (780×1688). Regenerate with the dev server
  running: `node tools/icons/screenshots.cjs`.
- **End-to-end check:** `tools/pwa-check.cjs` verifies installability, offline play and the update flow
  in Chromium. Serve `dist/` with a plain static server: `vite preview` caches file metadata at startup
  and breaks the update test.

  ```sh
  npm run build
  python3 -m http.server 4175 --directory dist &
  node tools/pwa-check.cjs --update
  ```

The dev server doesn't register a service worker (`devOptions` is off), so offline behaviour can
only be tested against a build.

## Where to change things

| Goal | Place |
| --- | --- |
| Feel of throws (speed range, hook strength) | `MIN_SPEED`, `MAX_SPEED`, `HOOK` in `constants.ts`; gesture maths in `Lanes.onUp` |
| How easily pins fall | `TUNE` in `sim.ts`, `fallScale` per rack layout |
| Rack shapes | `CLASSIC_RACK` / `MEGA_RACK` in `constants.ts` |
| Stage targets, perks, power-up odds | `run.ts` |
| Banners, scoreboard, shop | `hud.ts`, `index.html`, `style.css` |
| Sounds | `audio.ts` |
| Lane artwork | `paintLane` in `art.ts` |
| App name, colours, icons in the manifest | `vite.config.ts` (`VitePWA({ manifest })`), `tools/icons/` |
| Install / update prompts | `src/pwa.ts` |

After physics or balance changes, re-run the sims and update the numbers in `docs/PHYSICS.md` /
`docs/NEON-RUN.md`.
