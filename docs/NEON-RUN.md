# Neon Run: the roguelike mode

State and rules live in `src/run.ts`; the scene integration is in `src/lanes.ts` (`startStage`,
`applySpecials`, `runBallResult`, `endStage`, `runOver`); UI is in `src/hud.ts`.

## Structure

- **6 stages ("lanes"), 3 frames each:** a frame is up to two balls, and clearing the rack on the first ball ends it.
- **Targets:** each stage has a points target. Miss it and the run is over.
- **Boss lanes:** stage 3, **Slick Lane**, halves your hook; stage 6, **Iron Pins**, makes pins 35% harder to topple.
- **Rack:** every rack is the 55-pin **Mega Rack** on a wider lane (see PHYSICS.md).

## Points

`points = chips × mult`, computed per ball (`Run.points`).

- **chips:** 2 per pin (+1 per Pin Collector), plus 10 per special pin knocked down.
- **mult:** starts at 1. A first ball at a full rack gets a tier (`hitTier`):

| Tier | Pins down | Mult bonus |
| --- | --- | --- |
| Nice Hit | 80%+ (44 of 55) | +0.5 |
| Big Hit | 90%+ (50 of 55) | +1 (+Heavy Hitter) |
| MEGA STRIKE | all 55 | +3 (+Heavy Hitter) |

  - Big Hits and Mega Strikes also add `+0.5 × Hot Hand × (streak − 1)`.
  - A spare (clearing the rest on ball 2) adds +1 (+Spare Parts).

The HUD shows `chips × mult = +total` under each result banner.

## Special pins and power-ups

- **Specials per rack:** `3 + stage + 2 × Lucky Rack`, capped at 12. Specials glow in their colour, both
  on the deck and on the rack diagram. Knocking one down banks it (`Run.collect`).
- **Gold** gives +1 coin (+2 with Magpie). Any other special adds that power-up to an inventory slot
  (2 slots, +1 per Deep Pockets); with full slots it pays a coin instead.
- **Arming:** tap a slot to arm it for the next throw. Several can be armed at once.

| Power-up | Effect |
| --- | --- |
| 🔥 Fireball | Ball mass ×6, its hits count ×3. Pins it hits catch fire; burning pins hit neighbours harder and spread a shorter-lived flame (0.7 s, ×0.8 each spread). |
| 💣 Bomb | Explodes at first contact: radial impulse on every pin within the layout's bomb radius. |
| ⚡ Chain Lightning | Each falling pin zaps the nearest standing pin within 200 px, up to the layout's zap count. |
| 🌕 Mega Ball | Ball radius × the layout's mega scale, mass ×3. |
| 🎯 Homing | Steers toward the layout's best line on a full rack, or toward the leftover pins on a spare. |
| 🛡️ Guard Rails | Bumpers for that throw. |

## Perks (16)

Drafted 1 of 3 after each cleared stage (rare perks are offered at 0.45 weight); reroll for 2 coins.

- **Ball:** Heavy Ball, Wide Body, Spin Doctor, Laser Sight
- **Pins:** Domino Effect, Lucky Rack, Magpie
- **Scoring:** Pin Collector, Heavy Hitter, Spare Parts, Hot Hand (rare), Extra Frame (rare)
- **Economy:** Power Surge (rare), Deep Pockets, Interest
- **Safety:** Safety Net (bumpers on every spare)

## Economy

- **Stage clear:** +3 coins, plus Overkill +1 per 150 points over the target (max 4), plus Interest
  if you have it (+1 per 3 coins held, max 5).
- **Shop:** two random power-ups at 3 coins each; perk reroll costs 2. Starting coins: 2.

## Balance

`npm run sim:balance` plays whole runs with simulated bowlers (aim error σ = 15 / 35 / 60 px around the
best line, random perks, power-ups armed on first balls). Current targets:
**400 · 600 · 790 · 1000 · 1220 · 1330**.

| Bowler | Win rate | Typical run |
| --- | --- | --- |
| Strong | ~30% | most reach stage 4+ |
| Average | ~23% | failures spread across stages 3–6 |
| Beginner | ~10% | often out by stage 2–4 |

Real players choose perks deliberately, so expect them to do somewhat better than the model.

**History:**
1. With the original 10-pin racks, the first targets (160→720) let even the beginner model win 48% of the time.
2. Raising them to 200→1250 overshot. Around 200→1080 gave a 33% / 15% / 8% spread.
3. The switch to 55 pins rescaled every number. The current values come after widening the lane.

## Ideas

- **Between runs:** unlockable balls and starting perks.
- **New pin types:** cursed pins (a penalty if left standing), moving pins, a "king pin" worth big chips.
- **Events:** a mid-run elite lane with a guaranteed rare perk.
- **Short mode:** seeded daily runs (`Run` already takes an injectable `rand`).
