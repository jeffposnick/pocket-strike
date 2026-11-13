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

After physics or balance changes, re-run the sims and update the numbers in `docs/PHYSICS.md` /
`docs/NEON-RUN.md`.
