# 2026-11-23: a player's Game save wiped by a reload

## What happened

The player's game (seed 770187, May 2022, about 21k coins) had a warehouse with Lift and load. Lift and load stacks a
warehouse's piles three high (`capAt`: 24 × `LIFT_STACK` 3 = 72), and the warehouse held 70 and 72 planks. The save's
schema allowed no pile over `MAX_PILE`, which was the biggest cap alone (40): it ignored the stack and a harbour's dock
sheds. The game wrote such a save without complaint, but turned it away on the next load.

The next load was the reload the "Couldn't fetch that part of the game. Tap here to reload." toast does. Any reload
would have done the same: the toast only triggered it. `initialWorld` met a failed load and built the starter map
(seed 7) in its place without saying anything. It kept only an *older version's* save aside. The first autosave then
wrote the starter map over the real game, under the same Your games slot (`e2zlzkgb`, "770187-gentle"), goals and
progress. The second report (`2026-11-23-wiped-after-update.txt`) shows that: a seed-7 railway with the old slot, goals
and progress.

## The fix (branch `claude/save-never-overwritten`)

- `MAX_PILE` (`src/persist/save-limits.ts`) is now the biggest cap × `LIFT_STACK`, plus all of a harbour's sheds. The
  player's pre-wipe map is a fixture (`src/persist/fixtures/2026-11-23-lift-warehouse-game.txt`) and loads.
- A save that fails to load for any reason is kept as it is under `<key>.unreadable-<hash>` (`loadFromStorage`).
- Game mode, at start-up (`keepUnreadableGame`, main.ts): a save that won't load is moved, as it is, into Your games as
  "Couldn't open: <name>" (`SlotStore.keepUnreadable`), and read back to check. The game's live keys are then cleared,
  and the title shows with Your games open, saying the game is kept there. Opening it again retries it. With no room
  to move it, Game mode's saves are locked for the page (`lockSaves`), so nothing is written over it.
- Your games → **Load a map from text**: paste a "Copy map for a bug report" text, and it's added as a new game beside
  the others ("<name> (from text)"), never in place of one. It works in the production build.

## Getting the player's game back

The game on their device was written over in place. The old save is very likely gone from that browser:

- it wasn't moved into Your games (the starter map took the same slot);
- it wasn't kept as a backup key (only older versions' saves were kept then);
- the cloud copy (if Cloud save is on) was replaced by the starter map at the next upload. The device keeps a
  `woodrail.cloud.backup.game` only when two devices' copies clash.

Their text from about 10 minutes before the wipe (`2026-11-23-teal-line-double-track.txt`) holds the whole game
(railway, session, goals, progress). Once this branch is on the site:

1. Open the game, ☰ **Your games** (or Your games on the title).
2. Tap **Load a map from text…** at the foot of the list.
3. Paste the whole text, from `woodrail-map:1:` to its end, and tap **Add to Your games**.
4. "770187-gentle (from text)" appears in the list: tap **Open**. That's the game as it was when copied.
5. The starter-map game left in the old slot can be deleted from Your games.

Anything played in the last 10 minutes before the wipe is lost.

## The root cause closed (2026-11-26, branch `claude/save-limits-guard`)

The wipe needed two things: a schema limit out of step with the game (`MAX_PILE` 40 against a stacked 72), and a
start-up that saved over a game it couldn't read. Both are now guarded by tests:

- **Every limit against what the game reaches** (`src/persist/save-limits.test.ts`). `schemaBounds` walks the save's
  and session's schemas and lists every upper bound by path (~65). Each must have a row in `REACH`: the most the game
  can put there, worked out from its own constants (`capAt` with `LIFT_STACK` and `MAX_SHEDS`, `SEATS`, `waitingCap`
  with everything learned, `loungeCap`, `MAX_TRACKS`, `MAX_ENGINE_NAME`, the longest catalogue id…). The test fails
  on a bound with no row, a row with no bound, a reach over its bound, or a bound on a count the game never caps
  (`UNBOUNDED`: trains, cars, pieces, towns and their squares, deliveries, coins, the clock, ships built…). Setting
  `MAX_PILE` back to 40 fails it three ways.
- **The round trip at the maxima** (`src/persist/save-maxima.test.ts`). It builds a Game world with everything learned
  and every industry's piece laid (depots by `syncIndustries`). Piles are full to `capAt`, a harbour has all its sheds
  and landed goods, heavy wagons are full, coaches have every seat taken, there are 12 boats of 3 full barges, plus the
  longest names, a long train and long lines. It must pass the schema unmended and load back the same.
- **The wipe at start-up** (`src/persist/unreadable-startup.test.ts`). Game mode's start-up and autosave now live in
  `src/persist/startup.ts` (`openGameSave`, `autosaveGame`; main.ts calls them). The test puts a save that fails for a
  reason other than a limit in the live keys, starts up, runs one autosave, and checks the player's keys are parked
  byte for byte. It also checks the same with no room to park them, when nothing is written.

What was out of step:

- **Heavy wagons lost goods on every reload.** A loaded save's wagons were filled through `setCargo`, which cuts to the
  economy's `wagonCapacity`. Until the research is applied after the load, that is the plain wagon's 3, so the Smithy's
  5 came back as 3. The loader now restores cargo at `MAX_WAGON_CAPACITY`. Found by the round trip.
- **Caps the game never enforces** were dropped: `built.ships` / `built.ferries` ≤ 999 (built as long as they're paid
  for) and a town building's `born` ≤ 99 (town levels go on past the table for ever, `townLevel`).
- **The Journal** had text, key and outline limits in the schema (2000, 500, 64) but nothing in the game held to them.
  A longer one would have turned away the whole session. `Journal.toJSON` now cuts to `JOURNAL_TEXT_MAX`,
  `JOURNAL_KEY_MAX` and `JOURNAL_POINTS_MAX`, and the schema uses them.

Everything else was within its limit, often far within (piles 156 against the fullest 156, riders 24 against 8 seats,
waiting 24 against 12, speed 1000 against about 218).
