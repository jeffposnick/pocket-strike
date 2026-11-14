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
- Lint: `npm run lint` (oxlint). Format: `npm run format` (oxfmt), checked in CI by `npm run format:check`.
  Run `npm run format` before committing; CI fails on unformatted files.
- Tests: `npm test` (scoring, flick/stick, swing-detection and sound-rendering unit tests and physics regression checks; seconds)
- Build: `npm run build`

## Where code goes

- `src/lanes.ts` is the scene and is already the biggest file: keep it to orchestration (phases, input,
  camera, wiring sim events to sound/HUD/effects). Put new logic in the module that owns it instead.
- Game rules (scoring, frame progression, run economy) belong in the pure modules (`scoring.ts`,
  `run.ts`, `sim.ts`) with unit tests in `tools/sim/`, not in `lanes.ts` or `hud.ts`.
- Particles go in `src/effects.ts`; all DOM work goes in `src/hud.ts` as ordinary class methods (no
  `Hud.prototype` patching).
- Read and write localStorage only through `src/storage.ts`, and add any new key to `StorageKey`.
- `tools/sim/run-balance.ts` replays the Neon Run frame loop on its own (Encore, Safety Net, Midas coins).
  When those rules change in `lanes.ts`/`run.ts`, update it too.

## Refactoring safely

- `npm test` output is deterministic, including the seeded physics checks in `tools/sim/settle.ts`. Save
  it before a refactor and diff it after (ignore the audio line's render time): identical output means the
  physics didn't move.
- Seeded results depend on the order of `this.rand()` calls in `sim.ts`/`run.ts`; don't reorder or add
  calls unless the change is meant to alter outcomes (then re-run the sims and update the docs' tables).
- For anything the scene does, smoke-test in Chromium against the dev server with `window.lanes`
  (see "Testing in a real browser" in docs/DEVELOPMENT.md for how to play fast in a script).
- When adding, moving or renaming a module, update the architecture list in docs/DESIGN.md and
  "Where to change things" in docs/DEVELOPMENT.md.

## Conventions

- Don't "fix" `on<event> =` assignments in `hud.ts` into `addEventListener`: dialogs reassign their
  handlers each time they open, and listeners would stack. Before enabling a stricter oxlint rule or
  category, check its hits are real problems (see "Checks" in docs/DEVELOPMENT.md).
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
- It's a PWA built from the `@vite-pwa/workbox-*` packages (no `vite-plugin-pwa`): the service worker is
  `src/sw.ts` on `@vite-pwa/workbox-swkit` (subpath imports only), bundled by `@vite-pwa/workbox-build`'s
  `ViteWorkboxPWAPlugin`; the manifest is `MANIFEST` in `vite.config.ts`; registration is in `src/pwa.ts`
  (`@vite-pwa/workbox-window`). New runtime asset types must be added to `globPatterns` to be precached. Keep every runtime asset same-origin and bundled so it stays
  offline-capable; no CDN fonts or scripts. After changing PWA behaviour, run `tools/pwa-check.cjs`
  (see docs/DEVELOPMENT.md).
