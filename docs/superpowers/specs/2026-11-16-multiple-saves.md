# Multiple saves ("Your games")

2026-11-16. The user: "can we also add support for multiple game saves?"

## Today

Game mode keeps one railway in localStorage: `woodrail.game.v2` (the world), `woodrail.game.v2.session` (clock, pause,
Journal), `woodrail.game.goals.v1`, `woodrail.game.stickers.v1`, `woodrail.game.progress.v1` (coins, research, toy
box), and `woodrail.game.started` (a device flag: the next game is on a fresh map, not the starter). New game (the
title's, ☰'s) asks, then writes the new map over them. Cloud saves (`persist/cloud.ts`) carry those keys
(`modeKeys("game")`) as one bundle per sync code; play-stats snapshots and "Copy map for a bug report" read the same
keys. Sandbox has its own keys.

## Sizes, measured

The bug maps in `src/play/bugmaps/` (players' Game saves, all the keys):

| Save | Raw JSON | gzip | gzip + base64 |
| --- | --- | --- | --- |
| A late game (issue-31, 5 lines, signals) | 205 KB | 26 KB | 35 KB |
| A mid game (far-train) | 90 KB | 15 KB | 21 KB |
| An early game (goals-long) | 75 KB | 11 KB | 14 KB |

gzip takes them 6–8× smaller. localStorage gives about 5 M characters an origin (Chrome, Firefox, Safari), so even
at 250 KB raw a late game parks in about 45 KB: some 80 parked late games beside the open one. **localStorage, gzipped,
is enough; no IndexedDB** (which would make every read async and need a second store to keep in step with the cloud's).

## Storage: the open game in today's keys, the others parked

- **The open game stays in today's keys**, exactly as now. Which game it is (`{ id, name }`) rides in its session,
  `woodrail.game.v2.session`'s `slot`, not a key of its own: an older build's cloud check turns away a bundle with a key
  it doesn't know, but reads a session with a field it doesn't know (zod drops it). So the autosave, the session, goals,
  progress, the bug map, snapshots and the cloud all keep working on the same keys, and the autosave writes only the
  open game.
- **Every other game is parked** under `woodrail.games.slot.<id>`: its keys (the five above, not
  `woodrail.game.started`, which is the device's) as JSON, gzipped (`CompressionStream`, as the cloud and Copy map already do), base64.
- **Its picture** under `woodrail.games.pic.<id>`: a WebP (JPEG where WebP can't be made) data URL, 192×108 at most,
  capped at 12 KB (smaller quality, then smaller, as the feedback picture does). Kept apart from the parked blob so the
  list reads without unzipping anything.
- **The index**, `woodrail.games.v1`: `{ v: 1, open: id | null, games: [{ id, name, created, played, playMs, goals,
  coins, deleted? }] }`, newest played first. `played`: when last played (ms); `playMs`: time played (in play, page in
  view); `goals`: goals done; `coins`. Ids: 8 random base-36 letters.
- `persist/slots.ts` (`SlotStore`, over any `Storage`, unit tested) owns all of it; `ui/games-sheet.ts` is the list.

**Switching** (Open another game): save the open one; park it (its blob and picture written, then read back to check);
write the other's keys into the live keys; remove its blob; set `open`; reload into Game mode (`reloadInto`). The
reload is how the page starts on a save today (cloud takes, quality changes), so every per-game thing (progress, goals,
stickers, Journal, tips' place, the clock) comes up as it does on any start. If a write fails half-way, the parked copy
of the game being left is still there and is written back: a game is never lost.

**New game** parks the open game first, then makes a new entry (named after the map: "Starter map" or its map code,
e.g. "48213-gentle-water-some") and the new map, as today, into the live keys. **Copy** writes a new parked blob (the
open game's, zipped, or a parked one's, as it is), named "… (copy)", picture copied. **Rename**: the index (and the tag
key when open). **Delete** asks first; a parked game: its blob, picture, entry; the open game (offered on the title
only, not from ☰ while it's played): its live keys, and `open` is null. Deleted ids are remembered (`deleted`) so the
cloud never brings one back.

**Quota.** Every write that adds a game (park, copy, new) is tried, and if `setItem` throws, what it wrote is taken out
again and nothing else is touched: the player is told "No room for another game on this device: delete one in Your
games first". The live keys are written last, after the game leaving is safely parked, so a full store refuses a new
game rather than losing one. (The cloud's `apply` already rolls back the same way.)

## Migration

At start-up, before the cloud is made: no index, and a Game save in `woodrail.game.v2` → an index with that save as
game 1, open, named after its map, and its tag added to its session. The save itself is not touched (it stays byte
for byte as it was, and loads through the save's own migration). No save: an empty index. Idempotent; a reload
finds the index and does nothing. The start-up check also mends: live keys with no tag (a bug map's `#load=`, a copy
from an older device in the cloud) are the open game; a tag not in the index (a game from the cloud) is added.

## Cloud saves: the open game syncs

One Game bundle per sync code stays (no change to the Worker): **the open game is the one that syncs**, and its bundle
carries the tag (in its session), so a device knows which game it is. In `CloudSync`, a new `slots` option:

- A cloud copy of **the same game** (same id, or no tag: an older build's): as today (merge, take, keep here, backup).
- A cloud copy of **another game**: never merged with, nor written over, the open game. It's parked here as that game
  (added to Your games, or replacing the parked copy if the cloud's is newer), and the open game stays open and goes up
  at its next edit. A toast: "A game from your other device is in Your games". A deleted id is ignored.
- **Typing a code** (or Continue from cloud under another code), and restoring the backup, put the cloud's game in the
  open keys as today, but if it's another game the open one is parked first (instead of only kept as the backup).
- Switching games marks Game edited, so the newly opened game goes up: the cloud carries the game last played. Before
  a switch, what's waiting goes up first (`flush`, 3 s at most), so the game left is in the cloud as it was left.
- A game deleted here: nothing goes up for Game while no game is open (no empty copy over the cloud's).

Parked games aren't in the cloud (per-game cloud saves: later, if wanted; the Worker would need a key per game).

## Play stats and bug maps

The device id (`woodrail.stats.id`) is the device's, not a game's: unchanged. Snapshots and Copy map send the open
game's keys, its session with its tag (an id and a name).

## Autosave and cost

The autosave writes only the open game's keys, as today. The index is written when a game is made, switched, renamed,
copied or deleted, when the page is hidden or the title comes up (played time and date), and from a save only when the
goals done or the coins changed, at most every 30 s. The picture is taken from a frame the game draws anyway (no
`invalidate`, `Game.grabSmall`): after a layout edit, at most every 2 minutes; one frame drawn for it when the title's
glide out has stopped (the whole map), and when a game is left for another (the view as it was); copied small in one
`drawImage`, 192×108, and encoded at that size. Nothing new runs while idle or paused.

## The UI

- **Title**, Game card: Continue opens the most recently played game (unparked first if it isn't the open one), New
  game (the new-game screen; Start makes a new game beside the others, never over one), and **Your games** (when there's
  at least one).
- **☰ Your games** in Game mode, by New game. ☰ New game no longer warns that it ends this game: it says the game is
  kept in Your games.
- **The list** (a sheet, 44 px buttons, scrolls on a phone): each game's picture, name, "Played 16 Nov · 2 h 10 min ·
  12 goals · 340 🪙", and Open (Playing now for the open one in play), Rename (inline field), Copy, Delete (inline
  "Delete … ? It can't be undone." Delete / Keep). 0 frames while it's open.

## Tests

- Unit (`persist/slots.test.ts`): the index (made, read, sorted, bad JSON), park and unpark round trip, new, copy,
  rename, delete, migration of an old single save (unchanged keys, slot 1, idempotent), quota (a store that throws past
  a size: a new game refused, nothing lost, nothing half-written), the cloud hook (another game parked, not merged).
- e2e `e2e:saves` on a 390×844 phone by taps: a game, track laid; ☰ New game makes a second game, track laid there; Your
  games lists both with pictures; open the first, its track is there; rename, copy, delete (with its confirm); after a
  reload Continue opens the last played; an old single save migrates.
- And the cloud, new-game and stats suites, which touch saves.
