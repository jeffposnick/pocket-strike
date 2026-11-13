# Physics model and tuning log

Everything here lives in `src/sim.ts` and `src/constants.ts`. The numbers come from the tools in
`tools/sim/`; re-run them after any change (`npm run sim:pinfall`, `npm test`).

## Units and geometry

- **Scale:** about 7.7 world px per inch across the lane. The lane's length is compressed so a roll lasts about 1.5 s.
- **Lane (Classic):** half-width 150, so 300 px across 39 boards, with 40 px gutters.
- **Lane (Neon Run):** half-width 230.
  The lane width is a mutable live-binding export (`setLaneHalf`), set by `Sim.setLayout`.
- **Positions:** foul line at y = 0, ball starts at y = +150, head pin at y = −3300, pit at y = HEAD_Y − 365.
- **Ball:** radius 30, mass 4.5. Regulation pin: radius 17, lying length 108, mass 1.

## Bodies

- **Ball:** one circle. Hook acceleration = `spin × HOOK × hookMult × grip`, where `grip` ramps from 0 to 1
  between 30% and 70% of the lane. The ball skids through the oil, then hooks on the dry back end.
- **Standing pin:** a single circle with no rotation. Heavy damping, so a nudged pin only scoots a little.
  A standing pin falls when a hit gives it a Δv above `TUNE.fallDv × mods.fallMult × layout.fallScale`,
  with ±15% randomness. Softer hits add `wobble`, a visual rock that decays.
- **Fallen pin:** a rigid body with rotation. It collides as **three circles along its length**, which
  is what makes tumbling pins take out neighbours. Linear friction 2.2/s, angular 1.8/s. It bounces
  off the kickbacks, and falls into the pit past `PIT_Y`.
- **Collisions:** impulse-based with rotation (`resolve()`), at 300 Hz substeps.
  Restitution: ball 0.55, pins 0.6. A bounding-radius check skips far-apart pairs; the 55-pin rack
  needed it (it made physics about 15× faster).

## Rack layouts (`RackLayout`)

| | Classic | Mega Rack (Neon Run) |
| --- | --- | --- |
| Rows / pins | 4 / 10 | 10 / 55 |
| Spacing | 86 | 42 |
| Pin scale, mass | 1, 1 | 0.75, 1 |
| fallScale | 1 | 0.38 |
| Lane half-width | 150 | 230 |
| Bomb radius | 165 | 140 |
| Fire boost | 7 | 3 |
| Mega Ball scale | 1.8 | 1.7 |
| Chain zaps | 3 | 8 |
| Homing line | ±24 | ±80 |

## Tuning results (latest)

### Classic, from `npm run sim:pinfall`

| Shot | Pins down (avg) | Strike rate |
| --- | --- | --- |
| Pocket, straight | 9.2–9.5 | 35–55% |
| Pocket, hooked in | about 9.6 | 55–70% |
| Head-on (x = 0) | about 8 | 0–13%; leaves splits |
| Wide (x = 45) | about 7.5 | 0% |

Early versions struck 60–70% of the time anywhere within ±25 px of centre. Raising `fallDv`
from 150 to 220 and friction from 1.5 to 2.2 fixed that.

### Mega Rack

- **Plain shots:** the best line is about ±80 px from centre (~46–48 pins), dead centre gets ~42,
  and edges ~26–30. Full clears are very rare without a power-up.
- **Power-ups:** each one lifts a bad edge shot to 44–50 pins.
- **History:**
  - The first, tightly packed version (spacing 31, lane 300 wide) cascaded so much that aim barely mattered.
  - Bomb and Fire then cleared all 55 pins over 90% of the time, so power strengths became per-layout settings.

## Bugs fixed (and their regression checks)

All of these are checked by `tools/sim/settle.ts` (part of `npm test`).

1. **Ball rebounding into the gutter.**
   - *Symptom:* in the dense Mega Rack, the ball could bounce back off the pins, leave the deck near
     the edge, drop into the gutter and roll back toward the bowler. The camera followed it and the
     result waited up to 10 s.
   - *Fix:* after first contact, damp any backward ball motion (`vy > 0` decays at 14/s), add deck
     friction, never allow a gutter after contact (side walls apply instead), and settle at the
     latest 4.5 s after contact. The camera also locks onto the deck at first contact.
2. **Jittering fallen pins.**
   - *Symptom:* overlapping fallen pins pushed each other apart by the full overlap every substep,
     shoving neighbours back and forth indefinitely.
   - *Fix:*
     - **Static friction:** a slow pin stops dead after 0.15 s.
     - **Sleeping:** a pin at rest sleeps. It acts as a fixed obstacle unless the relative contact speed exceeds 60.
     - **Soft overlap correction:** resolve 60% of the overlap, with 0.4 px of slop.
     - **Freeze:** the scene stops stepping physics once a roll has settled.
   - *Result:* jitter went from 112 pins (worst 591 px) to about 1% of pins with sub-pixel motion.

## Things that are deliberately not realistic

- Pins never stand back up, and there's no ball-pin friction or ball rotation physics.
- A fallen pin is three circles, not a capsule; good enough, and cheap.
- Pinsetter sweeps are animation only. Deadwood is cleared logically when the sweep bar passes.
