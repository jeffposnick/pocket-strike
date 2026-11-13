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
- Tests: `npm test` (scoring unit tests and physics regression checks; about a minute)
- Build: `npm run build`

## Conventions

- `src/sim.ts`, `src/run.ts`, `src/scoring.ts` and `src/constants.ts` must stay free of Excalibur and
  DOM code so `tools/sim/` can run them in Node.
- Use explicit `.ts` import extensions and erasable TypeScript only (no enums or parameter properties):
  the sim tools run under Node's type stripping.
- After changing physics or balance, run `npm run sim:pinfall` / `npm run sim:balance` and update the
  tables in `docs/PHYSICS.md` / `docs/NEON-RUN.md`.
- Pushes to `main` deploy to GitHub Pages via the `gh-pages` branch.
- It's a PWA (`vite-plugin-pwa`). Keep every runtime asset same-origin and bundled so it stays
  offline-capable; no CDN fonts or scripts. After changing PWA behaviour, run `tools/pwa-check.cjs`
  (see docs/DEVELOPMENT.md).
