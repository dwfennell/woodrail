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
