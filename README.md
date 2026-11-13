# Pocket Strike

**Play:** https://jeffposnick.github.io/pocket-strike/ (deployed from `main` on every push)

It's an installable, offline-capable PWA. Use **Install app** in the menu (Chrome, Edge, Android),
or **Share → Add to Home Screen** on iOS. Once loaded, it plays with no connection.

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

## Neon Run (roguelike mode)

Six lanes, three frames each, against a **Mega Rack of 55 pins**: a 10-row triangle of pins with room
between them, on a lane about 50% wider than regulation. The camera zooms out slightly to fit it.
The best line is about two-thirds of the way out from the centre; edge shots leave plenty standing. Score enough points on each lane to move on. Points are **pins × mult**:
2 per pin, +10 per special pin. First-ball tiers add mult:

| Tier | Pins down | Mult |
| --- | --- | --- |
| Nice Hit | 80%+ (44+) | +0.5 |
| Big Hit | 90%+ (50+) | +1 |
| MEGA STRIKE | all 55 | +3 |
| Spare | clear the rest on ball 2 | +1 |

- **Special pins** glow in the rack (and on the rack diagram). Knock one down to bank it:
  - 🔥 **Fireball**: plows through; burning pins topple anything they touch
  - 💣 **Bomb**: explodes on first contact
  - ⚡ **Chain Lightning**: each falling pin zaps its nearest neighbour (up to 3)
  - 🌕 **Mega Ball**: huge, heavy ball for one throw
  - 🎯 **Homing**: steers into the pocket, or toward the pins left for a spare
  - 🛡️ **Guard Rails**: bumpers for one throw
  - 🪙 **Gold**: a coin
- **Tap a power-up slot** to arm it before you throw. You can arm several at once.
- **After each lane:** pick one of three perks (Heavy Ball, Domino Effect, Hot Hand, Laser Sight and more),
  buy power-ups with coins, or reroll the perk offers.
- **Boss lanes:** Slick Lane (hook halved) and Iron Pins (pins 35% harder to topple).
- Power-ups are re-balanced for the Mega Rack (smaller bomb blast, weaker fire spread, smaller Mega Ball).

Stage targets were tuned by simulating hundreds of full runs with simulated players of different skill.

## Features

- Custom rigid-body physics: fallen pins collide as long tumbling bodies, so pins take out other pins.
  Lightly bumped pins wobble and can stay standing.
- Slow motion and hit-stop at impact, screen shake, sparks, confetti, vibration on supported phones.
- Synthesized sound (no audio files): rolling rumble, pin clatter, strike fanfare.
- Full ten-pin scoring including the 10th frame, split detection, and Double / Turkey / N-bagger streaks.
- Best score is remembered on your device.

## Docs

- [docs/DESIGN.md](docs/DESIGN.md): architecture, controls, rendering, camera
- [docs/PHYSICS.md](docs/PHYSICS.md): physics model, tuning results, bugs fixed
- [docs/NEON-RUN.md](docs/NEON-RUN.md): roguelike rules, scoring, perks, balance
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): commands, testing, deployment

## Develop

```sh
npm install
npm run dev        # http://localhost:5173, also on your LAN for phone testing
npm run build      # type-check + production build into dist/
npm test           # scoring tests + physics regression checks
npm run sim:pinfall   # pinfall survey (tuning)
npm run sim:balance   # Neon Run win rates by skill (tuning)
```

Requires Node 22.18+.

| File | What it does |
| --- | --- |
| `src/sim.ts` | Ball + pin physics, independent of rendering (runnable in Node for tuning) |
| `src/lanes.ts` | The game scene: gestures, turn flow, camera, effects |
| `src/art.ts` | All procedural artwork: lane tiles, pins, ball |
| `src/scoring.ts` | Ten-pin scoring and split detection |
| `src/run.ts` | Roguelike run: stages, perks, power-ups, points, shop offers |
| `src/audio.ts` | Web Audio sound effects |
| `src/hud.ts` | HTML overlay: scoreboard, rack diagram, banners, menus |
| `src/constants.ts` | Lane geometry, rack layouts and tuning |
| `tools/sim/` | Headless simulations and tests (run directly with Node) |
