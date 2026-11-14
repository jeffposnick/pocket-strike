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

### Controllers

Any game controller the browser recognises works, over USB or Bluetooth, through the Gamepad API
(`src/gamepad.ts`, polled each frame from `Lanes.handlePads`). Buttons are read by position in the
browser's standard layout, so the bottom face button confirms whatever its label.

- **Line up:** either stick sideways, or the d-pad.
- **Bowl:** pull either stick back, then push it forward. The stroke from the stick's lowest point
  goes through the same `flickThrow()` as a finger (`src/flick.ts`), scaled so a quick push matches a
  quick flick: push speed sets ball speed, a diagonal push the launch angle, and curving the push
  hooks (a stick needs about twice a finger's bend, since thumbs curve naturally). After a throw the
  stick has to come back to the centre before it can bowl again.
- **Buttons:** bottom face button skips ahead between balls; + / Start opens the menu; L, R, ZL, ZR
  (LB, RB, LT, RT) arm Neon Run power-up slots 1–4.
- **Menus:** while a dialog is open the d-pad or a stick moves focus between its controls and the
  bottom face button presses the focused one.
- Rumble follows the phone's vibration cues where the browser supports `vibrationActuator`.

Controllers without a standard layout get the first stick, button 0 (confirm) and button 9 (menu).

### Swing controls (optional)

On a phone with a gyroscope, "Swing phone to bowl" (menu switch, and the 📱 button next to mute) replaces
the flick with a real swing. It is off by default and remembered (`ps-swing` in `localStorage`).

1. **Hold** a thumb on the screen. Sliding still lines the ball up, until the phone starts turning
   faster than 90°/s; then the ball stays put.
2. **Swing** the arm back and forward, and **let go** (lift the thumb) to bowl. Letting go without a real
   swing throws nothing, and a finger flick does nothing while swing controls are on.

`src/swing.ts` turns the motion before the release into the same speed, angle and spin a flick produces.
It doesn't assume how the phone sits in the hand:

- The gyroscope is integrated into an orientation track, so all rotation can be compared in one fixed frame.
- The arm's direction (in the phone's frame) is the accelerometer reading at the delivery's fastest
  moment, where the centripetal pull and gravity's reaction both point from the hand to the shoulder.
- **Speed:** the delivery stroke's peak swing rate (180–650°/s maps onto the speed range).
- **Hook:** forearm twist about the arm during the stroke; 90° is full hook. Anticlockwise seen from the
  shoulder (a right-hander's handshake release) hooks left.
- **Launch angle:** how far the delivery strays from the backswing's plane, scaled and clamped like the flick's.

Motion access is requested from a tap (the switch, or Play), since iOS Safari and recent Chrome only
prompt then. If access is refused or no sensor answers within 1.5 s, the switch turns itself back off
and says why. The first switch-on shows a dialog on how to swing and to grip the phone firmly.

The tuning numbers in `SWING` are estimates checked against synthetic swings, not yet against real
phones: tune them with the `?swingdebug` overlay (see DEVELOPMENT.md).

## Architecture

```
src/
  main.ts        Engine setup (540×960 portrait, FitScreenAndFill) and scene start
  lanes.ts       The scene: phases, input, camera, game flow, mode switching
  effects.ts     Particles drawn over the lane: sparks, flames, confetti, rings, lightning, lasers
  sim.ts         Ball and pin physics. Pure TypeScript, no Excalibur, runs in Node
  constants.ts   Lane geometry, rack layouts, tuning constants
  art.ts         Procedural canvas art: lane tiles, pins, ball, deck spots
  scoring.ts     Ten-pin scoring, frame/ball progression and split detection (Classic)
  run.ts         Neon Run state: stages, perks, power-ups, points, shop offers
  hud.ts         HTML overlay: scoreboard, run bar, banners, menus, shop
  flick.ts       Flick and controller-stick throws (pure TypeScript, runs in Node)
  gamepad.ts     Game controllers (Gamepad API) and controller menu navigation
  swing.ts       Phone-swing detection (pure TypeScript, runs in Node)
  motion.ts      Motion sensor access and buffering for swing controls
  swing-debug.ts Swing tuning overlay, loaded only with ?swingdebug
  audio.ts       Sound effects: Web Audio playback, reverb, panning, the rolling-ball loop
  audio-synth.ts Sound synthesis (pure TypeScript, runs in a worker and in Node)
  audio-worker.ts Renders the sounds off the main thread
  pwa.ts         Service worker registration, install button, update prompt
  storage.ts     localStorage wrapper (every saved key is listed in `StorageKey`)
  sw.ts          The service worker (Workbox runtime via @vite-pwa/workbox-swkit)
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
  `Scene.onPostDraw`. Particles live in `Effects` (`src/effects.ts`); the scene spawns them from sim
  events and draws the trail, guides and power-up auras itself. That runs in screen space, so it applies the camera by hand:
  translate to screen centre, scale by zoom, translate by −camera.
- **HUD** is plain HTML over the canvas, so text is crisp and CSS animates banners.
  Its root has `pointer-events: none`; only buttons opt back in. Gestures listen on `window`, so a
  swipe that starts in a letterbox bar still counts.

### Camera

- **Aim:** the ball sits low on screen (higher in Neon Run, so the power-up slots don't cover it).
- **Roll:** follows the ball, then locks onto the pin deck at first contact.
- **Return:** a 0.7 s fade to night (a screen-space `ScreenElement` curtain above every actor, below
  the HTML HUD), a cut back to the bowler while it's fully dark, then a fade back in with the ball
  ready. Earlier versions panned the whole lane (a 0.85 s cubic ease, then a 1.3 s sine ease), which
  still looked janky at ~3,000 px of travel.
- **Zoom:** Neon Run uses 0.88 to fit its wider lane.

## Look

- **Palette:** night indigo `#0c0a1f` with neon pink `#ff3fa4`, cyan `#38f3ff`, amber `#ffc84a`
  and violet `#9b6bff`, on warm maple wood.
- **Type:** Bungee for display, Rubik for UI, self-hosted via `@fontsource` (Latin subset) with system fallbacks.
- **Banners:** escalate with the result. STRIKE / DOUBLE / TURKEY / N-BAGGER in Classic;
  Nice Hit / Big Hit / MEGA STRIKE in Neon Run.

## Sound

All sound is synthesized; there are no audio files. `src/audio-synth.ts` renders every sound once,
in a Web Worker when audio unlocks on the first tap (about half a second of work that would
otherwise stall the game), and `src/audio.ts` plays the results.

- **Physical sounds are modelled, not beeps.** A pin is a set of decaying resonant modes in a free
  bar's ratios (1 : 2.76 : 5.40 : 8.93) plus a hollow body mode and a noise click; each render varies
  pitch and decay, and playback varies rate and gain with how hard the hit was. The ball's hit adds a
  low pitch-dropping thump; a solid hit adds a rendered cascade of scattering pins. The side panels,
  gutter channel, pit cushion and pinsetter each have their own render.
- **The roll** is a seamless loop of brown noise with a faint board grain, filtered live by the ball's
  speed, with a slow wobble at its turning rate. In the gutter a resonant boost makes it ring hollow.
- **Space:** every sound is panned to where it happened across the lane and sent to a convolution
  reverb whose impulse response is itself synthesized (early reflections plus a darkening stereo tail).
  A bus compressor keeps a 55-pin pile-up from clipping.
- **Musical cues** use FM bells (strike fanfare over a soft major-ninth pad, spare chime, power-up
  sparkle) and a marimba (the falling figure for misses), all rendered up front.

## Offline and installable

The game is a PWA: it installs to the home screen, launches standalone in portrait, and plays fully
offline. Nothing loads from another origin: fonts are self-hosted, art is drawn in code and sound is
synthesized. So the precache is just the build output. Updates wait for the player to tap "Update".
Details are in [DEVELOPMENT.md](DEVELOPMENT.md#pwa-offline--installable).

## Known limits and ideas

- Headless Chromium renders in software at ~5–40 fps, so it can't judge smoothness. Check feel on a real phone.
- Above 200 ms per frame, Excalibur's clock treats the frame as 1 ms, so a very slow device runs in slow motion rather than skipping.
- **Ideas not done:** two-player pass-and-play in Classic, left-handed board numbering (and a left-handed hook direction for swing controls), more boss
  modifiers, persistent unlocks between runs, haptics tuning, a replay camera.
