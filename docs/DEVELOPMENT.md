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

| Command                           | What it does                                                                                                             | Time      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| `npm run typecheck`               | TypeScript, strict mode                                                                                                  | seconds   |
| `npm run lint`                    | oxlint (correctness rules, warnings fail)                                                                                | instant   |
| `npm run format` / `format:check` | oxfmt: format everything, or only check                                                                                  | instant   |
| `npm test`                        | Scoring, flick/stick, swing-detection and sound-rendering unit tests + physics regression checks (`tools/sim/settle.ts`) | seconds   |
| `npm run sim:pinfall`             | Pinfall survey for both racks and every power-up                                                                         | ~2–5 min  |
| `npm run sim:balance`             | Neon Run win rates by skill level (`--runs 30`)                                                                          | ~5–10 min |

Linting and formatting use the [Oxc](https://oxc.rs) tools, configured in `.oxlintrc.json` and
`.oxfmtrc.json` (120 columns, single quotes; `package-lock.json` is left to npm). oxfmt covers TypeScript,
CSS, HTML, JSON and Markdown alike. oxlint runs only its `correctness` category: the stricter categories
were tried and mostly flagged deliberate code, such as `hud.ts` assigning `onclick` so that reopening a
dialog replaces its handlers instead of stacking more.

Every test is deterministic: the physics checks seed each roll (`seeded()` in `tools/sim/helpers.ts`)
and the swing tests seed their synthetic noise, so a run gives the same numbers every time and a
failure means the code changed, never bad luck. The physics checks still measure rates over many rolls;
`node tools/sim/settle.ts --seed N` reruns them with different rolls, which is a quick way to see
how much headroom a threshold has after a physics change.

## Testing in a real browser

The dev build exposes the scene as `window.lanes` (only when `import.meta.env.DEV`), which makes
scripted checks easy:

```js
// In the browser console, or page.evaluate() from Playwright
const l = window.lanes;
l.sim.ball.x = 80;
l.throwBall(2300, 0, -0.4); // speed (px/s), angle (rad), spin (-1..1, negative hooks left)
```

To play quickly in a script, throw whenever `l.phase === 'aim'` and skip the waits between balls with
`l.phaseT = l.phaseDur` during `result`, `sweep` and `return`. Private fields are plain properties at
runtime, so `l.run`, `l.rolls` and `l.fx` can be read or set the same way.

When automating with Playwright:

- Emulate a phone (e.g. `devices['iPhone 13']`) with `deviceScaleFactor: 1`.
- Headless Chromium renders in software, and above 200 ms per frame Excalibur's clock treats the
  frame as 1 ms, so the game crawls at high pixel densities.
- Frame rates measured headless don't reflect real devices.

## Controllers

- `tools/sim/flick.test.ts` (part of `npm test`) covers the flick and the stick swing.
- With the dev server running, `node tools/gamepad-check.ts` drives a fake standard controller in
  Chromium (it replaces `navigator.getGamepads`): menu navigation, lining up, a stick swing,
  skipping and the menu button.
- On real hardware: browsers expose a controller only after one of its buttons is pressed on the page.
  Tune the stick in `STICK` in `src/flick.ts`.
- Controller presses may not count as a user gesture for audio, so with no tap or click at all the
  game can stay silent until the first one.

## Swing controls

- **Unit tests:** `tools/sim/swing.test.ts` (part of `npm test`) runs `src/swing.ts` against synthetic
  swings from `tools/sim/swing-synth.ts`, which models an arm swinging with the phone at any grip, with
  twist, sideways stray, sensor noise and 60 or 100 Hz sampling.
- **In the browser:** with the dev server running, `node tools/swing-check.ts` replays a synthetic swing
  through real `devicemotion` events in Chromium and checks the switch, the first-time dialog, the
  denied-permission message, bowling, and switching back to flicking.
- **On a phone:** open the game with `?swingdebug`. The overlay plots rotation speed (the amber line is
  `SWING.minPeak`), shows what each release measured, and "Save last swing" downloads it as JSON.
  Tune `SWING` in `src/swing.ts` from those numbers. Motion sensors need HTTPS (or localhost), so use the
  deployed site or an HTTPS tunnel rather than the dev server's LAN address.

## Deployment

Every push to `main` (including merged pull requests) runs `.github/workflows/deploy.yml`. It can also
be run by hand from the Actions tab.

1. **build:** install, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, then upload `dist/` as the Pages artifact
   (`actions/upload-pages-artifact`).
2. **deploy:** publish that artifact with `actions/deploy-pages` to the `github-pages` environment.

If a test fails, nothing deploys. Deployments run one at a time; a newer push waits for the current one
to finish rather than cancelling it.

One-time repo setting: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
The site is then at `https://<owner>.github.io/pocket-strike/`.

`vite.config.ts` sets `base: './'` so the build works from any sub-path.

## PWA (offline + installable)

`vite-plugin-pwa` (configured in `vite.config.ts`) builds the service worker and `manifest.webmanifest`.

- **The service worker is our own code:** `src/sw.ts`, built with the `injectManifest` strategy. It uses
  Workbox's runtime from [`@vite-pwa/workbox-swkit`](https://github.com/vite-pwa/workbox/tree/main/packages/swkit),
  the consolidated ESM build of the Workbox service worker libraries.
  - Import from its subpath exports (`@vite-pwa/workbox-swkit/precaching`, `/routing`, `/core`). The
    package's barrel file is only meant for `@vite-pwa/workbox-build`.
  - The build bundles `src/sw.ts` into a single classic script (`dist/sw.js`, about 17 KB, 6 KB
    gzipped) and injects the precache list in place of `self.__WB_MANIFEST`.
  - It precaches with swkit's `parallel` option (4 at a time), serves `index.html` for navigations,
    claims clients on first install, and calls `skipWaiting()` only when the page sends
    `{ type: 'SKIP_WAITING' }`.

- **Offline:** everything the game needs is precached (JS, CSS, HTML, the self-hosted woff2 fonts,
  icons), about 700 KB in 15 files. Fonts come from `@fontsource/*` rather than Google Fonts, so
  nothing loads from another origin at runtime.
- **Updates:** `registerType: 'prompt'`. A new build installs in the background and waits; `src/pwa.ts`
  shows an "Update" button in the menu and an "Update" toast, and nothing reloads until the player taps it (which sends `SKIP_WAITING`), so
  an update never interrupts a game. Besides the browser's own check on navigation, `src/pwa.ts` calls `registration.update()` on
  startup, whenever the app returns to the foreground, and hourly. An installed game can stay open
  for days, and the navigation check alone proved unreliable in testing.
- **Install:** an "Install app" button in the menu uses `navigator.install()` where supported, else
  Chromium's captured `beforeinstallprompt`. iOS Safari has no prompt, so the menu explains Share → Add to Home Screen instead.
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

## Web platform

HTML, CSS and client-side JS follow Chrome's
[Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance), with a Baseline Widely
available target (see CLAUDE.md). Patterns in place:

- **Overlays are modal `<dialog>`s** (menu, game over, shop, run over), opened with `showModal()` via
  `openDialog()` / `closeDialog()` in `src/hud.ts`. The browser makes the page behind inert, moves focus
  in and returns it on close. Each dialog is a step in the game flow, so `cancel` (Esc, Android back) is
  prevented, and a dialog that closes anyway (browsers stop honouring `preventDefault()` after repeated
  presses) reopens itself. Don't open or close them with `hidden`.
- **Ball picker** is a `<fieldset>` of radio inputs styled with `label:has(:checked)`, so the choice is a
  real checked state. The bumpers toggle is `<input type="checkbox" switch role="switch">`.
- **Toast** (`#pwaPill`) is a `popover="manual"` in the top layer, announced with `ariaNotify()` or the
  `#announcer` live region. It never shows over a modal dialog (it would be inert): `pill()` in
  `src/pwa.ts` holds it until the dialog closes. Its Update action is also always in the menu.
- **Motion sensors** (swing controls) are a progressive enhancement: offered only where
  `DeviceMotionEvent` exists and the main pointer is coarse, requested from a tap via
  `DeviceMotionEvent.requestPermission()` where it exists, and turned back off with an explanation if
  refused. The first-time instructions are another guarded modal `<dialog>`.
- **Controllers** use the Gamepad API (Baseline widely available), polled each frame; connection is
  detected by polling, not `gamepadconnected`. In dialogs the controller moves real DOM focus, and a
  `pad-nav` class on the body shows the focus ring (programmatic focus after a tap wouldn't otherwise
  match `:focus-visible`); any pointer or key press removes it. Rumble (`vibrationActuator`) is a
  progressive enhancement.
- **Install** prefers `navigator.install()` (Web Install API) and falls back to `beforeinstallprompt`.
- **Motion:** decorative animations are opted in with `@media (prefers-reduced-motion: no-preference)`;
  ones that carry information (banners, points) swap to an opacity-only keyframe under `reduce` so they
  still end visible.
- **Zoom isn't disabled** in the viewport meta; `touch-action: none` on the page keeps gestures for the
  game. `user-select: none` is limited to the canvas, HUD and buttons.

Not adopted, deliberately: `<meta name="text-scale">` (the HUD is sized in px to sit over a fixed-size
canvas; opting in would need a rem-based HUD layout first) and `font-size-adjust: from-font` (it inherits
as a fixed number and resized the Bungee display text).

## Where to change things

| Goal                                         | Place                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Feel of throws (speed range, hook strength)  | `MIN_SPEED`, `MAX_SPEED`, `HOOK` in `constants.ts`; flick maths in `flickThrow()` in `flick.ts` |
| Feel of swing controls                       | `SWING` in `swing.ts`                                                                           |
| Feel of controller sticks                    | `STICK` in `flick.ts`; button mapping in `gamepad.ts`                                           |
| How easily pins fall                         | `TUNE` in `sim.ts`, `fallScale` per rack layout                                                 |
| Rack shapes                                  | `CLASSIC_RACK` / `MEGA_RACK` in `constants.ts`                                                  |
| Stage targets, perks, power-up odds          | `run.ts`                                                                                        |
| Banners, scoreboard, shop                    | `hud.ts`, `index.html`, `style.css`                                                             |
| Sparks, confetti, flames and other particles | `effects.ts`                                                                                    |
| Classic frame/ball progression               | `classicPosition` in `scoring.ts`                                                               |
| Saved settings and records                   | `storage.ts`                                                                                    |
| Sounds                                       | how each sounds: `audio-synth.ts`; levels, panning, reverb, when they play: `audio.ts`          |
| Lane artwork                                 | `paintLane` in `art.ts`                                                                         |
| App name, colours, icons in the manifest     | `vite.config.ts` (`VitePWA({ manifest })`), `tools/icons/`                                      |
| Install / update prompts                     | `src/pwa.ts`                                                                                    |

After physics or balance changes, re-run the sims and update the numbers in `docs/PHYSICS.md` /
`docs/NEON-RUN.md`.
