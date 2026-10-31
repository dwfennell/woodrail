# Achievements: a proposal

**Status:** proposal for the user to decide on. No code yet. Game Mode team, 2026-10-31.

**The ask:** "at some point perhaps we need to broaden the goals a bit so they become more like achievements? Like:
once we have the core stuff checked off?"

## 1. Today

`GOALS` in `src/game/goals.ts` holds 22 goals, in order:

- **Tutorial (wait their turn):** join two towns, put an engine on the track, get a train moving, run into a station,
  make up a flatbed train, load logs, deliver planks, grow a village, place a school, research switches, place the
  workshop, make a switch, lay a switch, open a farm.
- **Open goals (from `FIRST_OPEN_GOAL` = build-bridge, ticked as soon as met):** build a bridge, connect three towns,
  deliver 10 planks, run two trains at once, open a quarry, open a mine, open a harbour, connect every town.

How they work and show:
- `GoalTracker.update` runs about once a second and after track changes (`checkGoals` in `main.ts`). It ticks at most
  one goal a check. A goal once met stays met. Goals with `needs` hide until their blueprints are learned ("🔒 Research
  Signals to unlock a goal").
- **The goals card** (`src/ui/goals-panel.ts`) is the Journal under the logo. Folded on a phone, it is a chip: "Goals
  16 / 22", a bell for unread news, the current goal's title and a Show me button. Open, it is a bottom sheet with two
  tabs, Goals (current goal, its progress, what's next) and News. With everything done, the chip reads "All done!" and
  offers New game.
- A tick is a toast plus a News milestone (`goalsDoneText`, merged with a growth if close in time).
- Saved as a list of ids under `woodrail.game.goals.v1` (`saveGoals`), apart from the world save.
- Every goal is reached by the player's path in `src/play/balance.test.ts` (fast part 19/22, long part 22/22).

After "Connect every town" there is nothing left to aim at except research and town levels. That's the gap.

## 2. The split

- **Core goals stay the guided path.** The current 22 (plus the "buy some land" goal another session is adding) keep
  their order, Show me, the tray ring and the play-through. Nothing about them changes.
- **Achievements are the open-ended layer.** Broad, optional, collectable, no order, no Show me. Each has a title, a
  one-line "how" and an icon. Some are hidden ("???") until earned.
- **When they show:** achievements are *earned* from the start (a figure-eight built at minute 20 counts), but
  *quiet* until the core path is done: no toast, just a small dot on the chip. Once "Connect every town" is done (or the
  core goals are all done), the Achievements tab opens with what's already earned, and from then on each one gets a
  toast. Recommended: earn always, announce after the core. (Question Q1.)

## 3. Achievement ideas (36)

Each line: id, title, how it's checked. "Event" means a hook we already fire; "scan" means the once-a-second pass.

**Building (track)**
1. `figure-eight`: A figure-eight. A loop with a `crossing` piece (or a bridge over itself) that a train runs through
   both ways. Scan on `piecesVersion` change: cycle in the track graph that uses both roads of one crossing.
2. `over-over`: A bridge over a bridge. Three levels of track stacked at one spot. Scan on `piecesVersion`.
3. `spiral`: A spiral. Track that climbs a full turn and passes over itself. On `piecesVersion`: a ramp run that turns
   ≥360° with a piece above another of the same run.
4. `long-line`: A long line. 100 pieces of track in one connected network. On `piecesVersion`.
5. `river-thrice`: Three bridges over water on running lines. Reuses the bridge goal's `acrossRiver` check.
6. `big-junction`: A junction with 4 switches within a few squares. On `piecesVersion`.
7. `tidy`: A tidy railway. 50+ pieces, no dead ends except buffers and stations. On `piecesVersion`.

**Trains**
8. `five-running`: Five trains running at once (`running(w)` ≥ 5). Scan.
9. `express`: An express. An express engine running with passenger cars. Scan of train cars.
10. `ten-cars`: A long train. A train with 10 cars (the goods engine pulls 8: two engines, double-headed). Scan.
11. `full-house`: Every kind of car on the map at once (engine, hopper, passenger, caboose, timber, van). Scan.
12. `caboose-tail`: A proper goods train. A caboose at the tail of a train of 6 cars (`cabooseAtTail`). Scan.
13. `engine-shed`: Every engine you own parked in a shed (once Engine shed lands). Scan.
14. `fleet`: Own one of every engine look (`CarLook` engines). Event: car made or crate taken.

**Towns**
15. `first-city`: A city (level 3). Event: town grew.
16. `city-star`: A City★. Event: town grew.
17. `all-towns`: Every town connected (core goal `join-all`: earned at once, see §6).
18. `all-villages`: Every town at least a village. Event: town grew.
19. `two-cities`: Two cities. Event: town grew.
20. `treats`: A treat in every town (after the treats plan, a57a272). Event: treat bought.

**Economy**
21. `thousand`: 1,000 coins at once. Event: coins changed (checked in the once-a-second pass).
22. `loads-500`: 500 loads moved (`counts.loadsMoved`). Event.
23. `planks-1000`: 1,000 planks sawn (`counts.planksSawn`). Event.
24. `every-good`: Deliver every kind of good at least once (`deliveredGoods`). Event: delivery.
25. `all-industries`: Every industry type open on one map. Event: depot placed or restored.
26. `all-ruins`: Every ruin on the map restored. Event: `restoreRuin`.
27. `scholar`: 25 blueprints learned. Event: learned.

**Routing**
28. `shared-loop`: A passing loop two lines both use. A loop (two switches, two roads) that trains of two routes
    pass through within a minute. Event: train passes a switch (from the sim's switch-path notice), kept as a small
    per-loop "last route seen" map.
29. `wye-turn`: A wye turn. A train that goes in one leg of a wye and comes out facing the other way. Event: train
    reverses on a wye piece's tail.
30. `signal-wait`: A train waits at a red signal, then goes on safely (after the signals spec, #16). Event.
31. `three-routes`: Three routed lines running at once. Scan of routes.
32. `no-jam-hour`: Four trains on one network for an hour of game time with no head-on stop. Per-second counter.

**Playful**
33. `marathon`: A train runs an hour of game time without stopping (speed > `RUNNING`). Per-second counter per
    train, reset when it stops.
34. `tunnel`: Through a hill. A train runs through a hill cut or a tunnel (when Tunnels lands; `HillCutsView` cut
    blocks today). Event: a cut changes with track in it.
35. `sightseer`: A passenger train that stops at every station on the map in one trip. Event: station stop.
36. `night-train`: A train running when the calendar's night falls (if the calendar keeps day and night). Event.
37. `back-again` (hidden): Put a derailed train back on the line. Event: rerail.
38. `photographer` (hidden): Fly the camera to a train with Show me in the News. Event: tap.

All of these read world state or counters we already keep, or one small new counter. None needs a per-frame check.

## 4. UI on a phone

- **Where they live:** a third tab in the Journal, **Goals · News · Badges**, only once the core is done (Q1). Before
  that, nothing new is visible except a dot on the chip when one is earned quietly; no tab, no counts.
- **The tab:** a grid of badges, 4 across at 360 px (64 px tiles, 44 px+ tap targets). Earned: coloured icon and
  title. Not earned: grey icon and title. Hidden: "???". A tap opens a one-line ticket: how to earn it, and its reward.
  Grouped by theme with small headings; "12 / 38" at the top.
- **When one is earned:** one toast, "🏅 Figure-eight!" (tap opens the Badges tab on it), a News milestone, and the
  chip's dot. Never more than one toast a check (as goals). Achievements never interrupt a goal toast or a growth: they
  queue behind them (`GoalTicks`'s join rule).
- **On the folded chip, after the core:** "Goals ✓ · 🏅 12 / 38" in place of "All done!". New game moves into the
  card, below the Goals tab's "All done" line.

## 5. Rewards

Balance-neutral: cosmetic first, small coins at most.
- **Paint colours** for the paint shop in plan a57a272 (phase C): achievements unlock extra liveries (gold for City★,
  silver for a marathon, stripes for a figure-eight). The paint shop's price stays; achievements only add choices.
- **Decorations:** lineside kits and town treats in a special colour (a gold bandstand), and a few named boards
  ("The Figure-Eight Flyer").
- **Small coins** (10–50) only on achievements earned after the core path, so they can't move the balance bands
  (which end at the core path). Q3.
- No blueprints, no speed, no capacity. Nothing a goal or research needs.

## 6. Cost

- An `AchievementTracker` beside `GoalTracker`, called from the same `checkGoals` (once a second and after changes).
  Each achievement declares what it depends on: `"pieces"` (rechecked only when `Layout.piecesVersion` changes),
  `"towns"`, `"counts"`, `"trains"` (cheap: a few trains), or an event name.
- Track-shape checks (figure-eight, spiral, junction) are graph scans: cached by `piecesVersion`, so they run once
  per edit, not per second. Target ≤ 2 ms on a phone for a 300-piece layout; measured and noted in the commit.
- Per-train timers (marathon, no-jam) add one number per train per second.
- Earned ones are never checked again. Nothing per frame, nothing on pointer moves.

## 7. Saves and migration

- Saved like goals: a list of ids under a new key `woodrail.game.achievements.v1`, in `PROGRESS_KEYS` and the cloud
  merge (a union: earned stays earned). No `SAVE_VERSION` bump.
- **Old saves:** on first load, run every state check once (towns, counts, track, `deliveredGoods`, done goals) and
  earn what holds, quietly (one News line: "You'd already earned 7 badges"). Moment-only ones (marathon, wye turn)
  can't be known and start fresh.
- Counters for new achievements go in `Progress.counts` (already saved and merged).

## 8. Build order

1. **Model and tracker:** `src/game/achievements.ts` (table, `AchievementTracker`, deps keys), save key, unit tests.
   6 easy ones from existing state: city, City★, every town, 1,000 coins, 500 loads, 25 blueprints. No UI.
2. **The Badges tab and toast**, hidden until the core is done. e2e on a 390×844 phone: finish the core path the
   player's way in a fast test map, the tab appears, earn one, see the toast and the ticket.
3. **Old-save pass** with the v12 fixture.
4. **Trains and towns themes** (scan-based).
5. **Track-shape checks** (figure-eight, bridge over bridge, spiral), cached by `piecesVersion`, timed.
6. **Routing and playful** (events from the sim; needs Rail and road for a switch-pass notice).
7. **Rewards:** liveries, once the paint shop (a57a272 phase C) lands.

Play-through: each achievement's test reaches it by the player's actions (lay the pieces, run the trains), per
AGENTS.md. Achievements aren't in the goals play-through (they're optional), so its time doesn't grow.

## 9. Overlaps

- **Tech tree (2026-10-31-tech-tree.md):** blueprints already `requires` counts (`loadsMoved` 200, `logsCut` 100).
  Achievements should read the same `Progress.counts`, not add parallel ones. If the tech tree grows "milestone"
  gates, the two could share one table of stat thresholds; worth agreeing before step 1. "Scholar" (25 blueprints)
  depends on the tree's size.
- **"Buy some land" goal:** stays a core goal. A broader "Own all the land" could be an achievement on top.
- **Treats and paint shop (a57a272):** achievements are a source of liveries and a "treat in every town" badge; the
  plan says treats are "looks and goals only", which fits.
- **Signals spec (#16)** and Tunnels ("soon"): their achievements wait for those to land.

## 10. Open questions

- **Q1.** Earn quietly from the start and show after the core path, or not earn at all until then?
- **Q2.** Name: "Achievements", "Badges" or "Stickers" (a child might like stickers)?
- **Q3.** Coins as rewards at all, or only looks?
- **Q4.** Hidden ones ("???"): fun, or frustrating for a child?
- **Q5.** After the core, should New game stay on the chip, or move into the card?
