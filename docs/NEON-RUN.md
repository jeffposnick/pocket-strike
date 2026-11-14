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

| Tier        | Pins down       | Mult bonus         |
| ----------- | --------------- | ------------------ |
| Nice Hit    | 80%+ (44 of 55) | +0.5               |
| Big Hit     | 90%+ (50 of 55) | +1 (+Heavy Hitter) |
| MEGA STRIKE | all 55          | +3 (+Heavy Hitter) |

- Big Hits and Mega Strikes also add `+0.5 × Hot Hand × (streak − 1)`.
- A spare (clearing the rest on ball 2) adds +1 (+Spare Parts).

The HUD shows `chips × mult = +total` under each result banner.

## Special pins and power-ups

- **Specials per rack:** `3 + stage + 2 × Lucky Rack`, capped at 12. Specials glow in their colour, both
  on the deck and on the rack diagram. Knocking one down banks it (`Run.collect`).
- **Gold** gives +1 coin (+2 with Magpie). Any other special adds that power-up to an inventory slot
  (2 slots, +1 per Deep Pockets); with full slots it pays a coin instead.
- **Arming:** tap a slot (or press L / R / ZL / ZR on a controller) to arm it for the next throw.
  Several can be armed at once, and they stack.

### Power-ups

Power-ups come in three rarities (`POWERS[id].rarity` in `src/run.ts`). Only **common** ones drop from
special pins; **rare** and **legendary** ones are only sold in the shop. The physics for each is in
`Sim.stepPowers` and friends (`src/sim.ts`); scoring ones are applied in `Run.points`.

**Common** (drop from pins, 3 coins in the shop)

| Power-up           | Effect                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔥 Fireball        | Ball mass ×6, its hits count ×3. Pins it hits catch fire; burning pins hit neighbours harder and spread a shorter-lived flame (0.7 s, ×0.8 each spread).               |
| 💣 Bomb            | Explodes at first contact: radial impulse on every pin within the layout's bomb radius.                                                                                |
| ⚡ Chain Lightning | Each falling pin zaps the nearest standing pin within 200 px, up to the layout's zap count.                                                                            |
| 🌕 Mega Ball       | Ball radius × the layout's mega scale, mass ×3.                                                                                                                        |
| 🎯 Homing          | Steers toward the layout's best line on a full rack, or toward the leftover pins on a spare.                                                                           |
| 🛡️ Guard Rails     | Bumpers for that throw.                                                                                                                                                |
| 🧲 Magnet          | After contact, every pin that's down and moving is pulled toward the nearest standing pin within 130 px (scaled), so falling pins crash into the ones still up.        |
| ☃️ Snowball        | Each solid hit grows the ball ×1.1 (mass with its area), up to ×2.6. Rewards a good line: it does little from the edge.                                                |
| 🔁 Ricochet        | No contact damping: the ball keeps its speed, rebounds off the kickbacks at 95%, and bounces off the back cushion twice, aimed at the centre of what's still standing. |

**Rare** (shop only, 5 coins)

| Power-up       | Effect                                                                                                                                                                                                                                                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🕳️ Black Hole  | At first contact a vortex opens in line with the hit, at the middle of the standing pins, for 0.9 s. Its reach is 1.8× the bomb radius: a sharp first pull, then a swirling drag that tears standing pins off their spots (the nearer, the likelier). |
| 🔦 Pin Laser   | 0.25 s after release, a beam along the ball's launch line (2.6 ball radii wide) topples every pin in it, blowing each sideways into its neighbours. Strong on spares.                                                                                 |
| ✖️ Double Down | This ball's mult ×2 (applied after every other mult bonus).                                                                                                                                                                                           |
| 🔂 Encore      | One extra ball this frame (they stack). Wasted if the frame ends on a clear first.                                                                                                                                                                    |

**Legendary** (shop only, 8 coins)

| Power-up      | Effect                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 🌋 Earthquake | At first contact the deck shakes for 1.4 s; each standing pin topples with a 1.5/s chance. Usually leaves only a handful. |
| 👑 Midas Ball | Triple chips for this ball, and +1 coin for every 5 pins it knocks down.                                                  |

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
- **Shop** (`Run.offerShop`): four items after every cleared stage, never the same power-up twice.
  - Two picks, each rare 40% of the time (else common).
  - A third that is legendary 30% of the time (else rare), so there's always something special.
  - A 🎁 **Mystery Box** for 2 coins: a random power-up, revealed when bought (common 65%, rare 28%,
    legendary 7%).
  - Prices: common 3, rare 5, legendary 8. A perk reroll costs 2. Starting coins: 2.
  - Rare stock gets a heavier frame and a badge; legendary stock shimmers.

## Balance

`npm run sim:balance` plays whole runs with simulated bowlers (aim error σ = 15 / 35 / 60 px around the
best line, random perks, power-ups armed on first balls, the priciest shop items they can afford).
Current targets: **400 · 600 · 790 · 1000 · 1220 · 1330**.

With 80 runs per level (30 runs swing by ±10 points):

| Bowler   | Win rate | Typical run                                          |
| -------- | -------- | ---------------------------------------------------- |
| Strong   | ~16%     | most reach stage 3+; the last two lanes are the wall |
| Average  | ~11–15%  | failures spread across stages 3–6                    |
| Beginner | ~9–11%   | often out by stage 2–4                               |

The item revamp (rarities, shop-only items, mystery box) didn't move these beyond the noise: the same
model on the old item set gave 16% / 15% / 9%. The table above used to say ~30% / 23% / 10%; those
figures predate later physics changes and no longer reproduce.

Real players choose perks deliberately, so expect them to do somewhat better than the model.

**History:**

1. With the original 10-pin racks, the first targets (160→720) let even the beginner model win 48% of the time.
2. Raising them to 200→1250 overshot. Around 200→1080 gave a 33% / 15% / 8% spread.
3. The switch to 55 pins rescaled every number. The current values come after widening the lane.
4. The item revamp added three common pin drops, four rare and two legendary shop-only items, and a
   mystery box. Win rates stayed within noise of the old item set.

## Ideas

- **Between runs:** unlockable balls and starting perks.
- **New pin types:** cursed pins (a penalty if left standing), moving pins, a "king pin" worth big chips.
- **Events:** a mid-run elite lane with a guaranteed rare perk.
- **Short mode:** seeded daily runs (`Run` already takes an injectable `rand`).
