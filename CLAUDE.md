# CLAUDE.md

Pocket Strike: a touch-first 2D bowling game (Excalibur + TypeScript + Vite). Classic 10-pin plus a
roguelike "Neon Run" mode with a 55-pin rack.

## Read first

- `docs/DESIGN.md`: architecture, controls, rendering, camera
- `docs/PHYSICS.md`: physics model, tuning numbers, fixed bugs
- `docs/NEON-RUN.md`: roguelike rules, scoring, perks, balance
- `docs/DEVELOPMENT.md`: commands, testing tips, deployment

## Checks

- Type-check: `npm run typecheck`
- Tests: `npm test` (scoring, flick/stick, swing-detection and sound-rendering unit tests and physics regression checks; seconds)
- Build: `npm run build`

## Conventions

- `src/sim.ts`, `src/run.ts`, `src/scoring.ts`, `src/constants.ts`, `src/flick.ts`, `src/swing.ts` and
  `src/audio-synth.ts` must stay free of Excalibur, DOM and Web Audio code so `tools/sim/` can run them in Node.
- Use explicit `.ts` import extensions and erasable TypeScript only (no enums or parameter properties):
  the sim tools run under Node's type stripping.
- After changing physics or balance, run `npm run sim:pinfall` / `npm run sim:balance` and update the
  tables in `docs/PHYSICS.md` / `docs/NEON-RUN.md`.
- Pushes to `main` deploy to GitHub Pages through GitHub Actions (`.github/workflows/deploy.yml`).
- Follow Chrome's Modern Web Guidance (https://developer.chrome.com/docs/modern-web-guidance) for all
  HTML, CSS and client-side JS work (not for `src/sim.ts`-style game logic, tooling or the sim tools).
  `.claude/settings.json` enables its `modern-web-guidance` plugin: use that skill before writing UI
  code (if it isn't loaded, run `npx -y modern-web-guidance@latest search "<2-5 word query>"`, then
  `retrieve "<id>"`), and check the result against the guide. See "Web platform"
  in docs/DEVELOPMENT.md for the patterns already in place.
- **Browser support:** Baseline Widely available. Newer features are fine as progressive enhancement
  with a small same-origin fallback; never load a polyfill from a CDN, and only bundle one if a guide
  requires it and the fallback can't be done in a few lines.
- It's a PWA (`vite-plugin-pwa`, injectManifest; the service worker is `src/sw.ts` on
  `@vite-pwa/workbox-swkit`, imported via subpath exports only). Keep every runtime asset same-origin and bundled so it stays
  offline-capable; no CDN fonts or scripts. After changing PWA behaviour, run `tools/pwa-check.cjs`
  (see docs/DEVELOPMENT.md).
