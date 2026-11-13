# Pocket Strike: design notes

How the game is put together, and why. Read this before making structural changes.
Physics details live in [PHYSICS.md](PHYSICS.md) and the roguelike mode in [NEON-RUN.md](NEON-RUN.md).

## Goals

- **Touch first.** Played on a phone held upright, one thumb. Everything works with a mouse too.
- **2D, top-down.** The lane runs up the screen; the camera follows the ball.
- **Slick and juicy.** Neon "cosmic bowling" look, slow motion at impact, shake, sparks, confetti,
  synthesized sound, vibration where the device allows it.
- **Original.** Generic bowling, no real brands or alleys. All art is drawn in code; all sound is synthesized.

## Controls

One gesture does everything (`Lanes.onDown/onMove/onUp` in `src/lanes.ts`):

1. **Slide**: while the finger moves mostly sideways, the ball follows it along the foul line.
   A "Board N" readout counts boards from the right edge, the way right-handed bowlers do.
2. **Flick**: once the finger has climbed 30 world px above its lowest point, the gesture becomes a throw.
   - **Speed** comes from the finger's velocity over the last ~110 ms (12–22 mph shown).
   - **Launch angle** comes from the stroke as a whole (start to end), clamped to ±0.06 rad.
     An early version used the end velocity, which meant curving the flick also steered the ball
     into the gutter.
   - **Hook** comes from how much the stroke bends: the largest perpendicular deviation from the
     start-to-end chord, divided by 16% of its length. Bow out right → hook left. Dead zone ±0.1.
3. A slow release just repositions; nothing is thrown.

Tapping during the result or the camera's return skips ahead.

## Architecture

```
src/
  main.ts        Engine setup (540×960 portrait, FitScreenAndFill) and scene start
  lanes.ts       The scene: phases, input, camera, effects, mode switching
  sim.ts         Ball and pin physics. Pure TypeScript, no Excalibur, runs in Node
  constants.ts   Lane geometry, rack layouts, tuning constants
  art.ts         Procedural canvas art: lane tiles, pins, ball, deck spots
  scoring.ts     Ten-pin scoring and split detection (Classic)
  run.ts         Neon Run state: stages, perks, power-ups, points, shop offers
  hud.ts         HTML overlay: scoreboard, run bar, banners, menus, shop
  audio.ts       Web Audio synth effects (no audio files)
  pwa.ts         Service worker registration, install button, update prompt
  style.css      HUD and menu styles
tools/sim/       Headless simulations and tests that import src/ directly
```

**Physics is separate from rendering on purpose.** `Sim` knows nothing about Excalibur, so every balance
question can be answered with thousands of simulated throws in Node in seconds (see `tools/sim/`).
The scene copies sim state onto actors each frame (`Lanes.syncActors`).

### Scene phases

`menu → aim → roll → result → sweep → return → aim …`, plus `over` for game-over, run-over and the
Neon Run shop. Physics only steps during `roll`. Once a roll has settled, the deck is frozen
so resting pins can't shuffle.

### Rendering

- **Lane:** cut into 600×512 tiles (`makeLaneTiles`), each an `ex.Canvas` with `cache: true`, painted
  once. Board grain is seeded per board and per segment so it lines up across tile seams.
  `repaintLane()` redraws them when the lane width changes between modes.
- **Pins and ball:** shared cached canvases (`makeStandingPin`, `makeFallenPin`, `makeBall`). Special pins
  get tinted variants. Actor scale handles Mega Rack pin size, topple animation and wobble.
- **Effects** (trail, sparks, confetti, lightning, bomb rings, flames, sweep bar, aim guide) are drawn in
  `Scene.onPostDraw`. That runs in screen space, so it applies the camera by hand:
  translate to screen centre, scale by zoom, translate by −camera.
- **HUD** is plain HTML over the canvas, so text is crisp and CSS animates banners.
  Its root has `pointer-events: none`; only buttons opt back in. Gestures listen on `window`, so a
  swipe that starts in a letterbox bar still counts.

### Camera

- **Aim:** the ball sits low on screen (higher in Neon Run, so the power-up slots don't cover it).
- **Roll:** follows the ball, then locks onto the pin deck at first contact.
- **Return:** a 1.3 s sine-eased pan back to the bowler. The original 0.85 s cubic ease peaked at
  ~200 px per frame and looked like a frame-rate problem; the sine ease peaks around 65 px.
- **Zoom:** Neon Run uses 0.88 to fit its wider lane.

## Look

- **Palette:** night indigo `#0c0a1f` with neon pink `#ff3fa4`, cyan `#38f3ff`, amber `#ffc84a`
  and violet `#9b6bff`, on warm maple wood.
- **Type:** Bungee for display, Rubik for UI, self-hosted via `@fontsource` (Latin subset) with system fallbacks.
- **Banners:** escalate with the result. STRIKE / DOUBLE / TURKEY / N-BAGGER in Classic;
  Nice Hit / Big Hit / MEGA STRIKE in Neon Run.

## Offline and installable

The game is a PWA: it installs to the home screen, launches standalone in portrait, and plays fully
offline. Nothing loads from another origin: fonts are self-hosted, art is drawn in code and sound is
synthesized. So the precache is just the build output. Updates wait for the player to tap "Update".
Details are in [DEVELOPMENT.md](DEVELOPMENT.md#pwa-offline--installable).

## Known limits and ideas

- Headless Chromium renders in software at ~5–40 fps, so it can't judge smoothness. Check feel on a real phone.
- Above 200 ms per frame, Excalibur's clock treats the frame as 1 ms, so a very slow device runs in slow motion rather than skipping.
- **Ideas not done:** two-player pass-and-play in Classic, left-handed board numbering, more boss
  modifiers, persistent unlocks between runs, haptics tuning, a replay camera.
