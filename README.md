# Pocket Strike

A touch-first 2D bowling game built with [Excalibur](https://excaliburjs.com/) + TypeScript + Vite.
Top-down neon lanes, real pin action, ten-frame scoring.

## How to play

- **Slide** your finger sideways to line up the ball. A board number shows where you're standing.
- **Flick up** to bowl. A faster flick means a faster ball (12–22 mph).
- **Curve** the flick to add hook. Bow the stroke out to the right and the ball hooks left, and vice versa.
  The ball skids through the oil and grabs on the dry back end, just like a real lane.
- Aim for the **pocket**, between the 1 and 3 pins. Hooking into it carries strikes best.
- **Bumpers** mode (menu) blocks the gutters.
- Tap during the replay to hurry along to your next ball.

## Features

- Custom rigid-body physics: fallen pins collide as long tumbling bodies, so pins take out other pins.
  Lightly bumped pins wobble and can stay standing.
- Slow motion and hit-stop at impact, screen shake, sparks, confetti, vibration on supported phones.
- Synthesized sound (no audio files): rolling rumble, pin clatter, strike fanfare.
- Full ten-pin scoring including the 10th frame, split detection, and Double / Turkey / N-bagger streaks.
- Best score is remembered on your device.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173, also on your LAN for phone testing
npm run build      # type-check + production build into dist/
```

| File | What it does |
| --- | --- |
| `src/sim.ts` | Ball + pin physics, independent of rendering (runnable in Node for tuning) |
| `src/lanes.ts` | The game scene: gestures, turn flow, camera, effects |
| `src/art.ts` | All procedural artwork: lane tiles, pins, ball |
| `src/scoring.ts` | Ten-pin scoring and split detection |
| `src/audio.ts` | Web Audio sound effects |
| `src/hud.ts` | HTML overlay: scoreboard, rack diagram, banners, menus |
| `src/constants.ts` | Lane geometry and tuning |
