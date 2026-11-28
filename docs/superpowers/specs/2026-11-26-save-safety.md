# Save safety: no single bug loses a railway (2026-11-26)

After the 2026-11-22 wipe (`docs/agents/reports/2026-11-23-wiped-game.md`): a save this build turned away, the starter
map made in its place, and the first autosave writing it over the player's game. The causes are fixed (`c4a7b33a`,
`5b05429f`, `986f9c82`). This spec adds four layers so the next bug of that kind can't lose a railway either. Each
layer stands without the others.

## 1. Backups (`src/persist/backups.ts`)

- **When.** Each time a Game-mode game loads cleanly at start-up (`openGameSave`), its live keys as they were read are
  copied. The first copy of a calendar day is that day's copy. A copy the same as the newest one isn't taken again.
  Copies are taken off the start-up path, a few seconds after the game is in play. The strings are held from the load
  until then.
- **Good only when checked.** A copy is the game's keys (railway, session, goals, stickers, progress), gzipped and
  base64'd as parked games are (`packKeys`). It's written, then read back and unpacked. It's listed only when the
  unpacked keys are byte for byte the ones that just loaded. A copy that fails that is removed.
- **How many.** For each game: the 3 newest load copies, the 4 newest day copies, and up to 2 kept by the write guard
  (layer 2) or before a restore. Deleting a game deletes its copies. The game's id keys them, so they follow it
  through rename, park and open.
- **Size.** Copies of all games together stay under `BACKUP_BUDGET` (1.2 M chars, about a quarter of a phone's 5 M
  char localStorage quota). The oldest go first: load copies, then day copies, then kept ones. Each game's newest copy
  goes last. The user's 2026-11-23 game is a 39 K char copy. A backup never stops a save: when an autosave doesn't fit,
  the oldest copy is let go and the save tried again.
- **Index.** `woodrail.games.backups.v1` holds `{ [gameId]: Backup[] }`, with when, kind (`load`, `day`, `kept`,
  `replaced`), trains, pieces, coins and size. Each copy is under `woodrail.games.backup.<gameId>.<n>`.
- **Restore.** ☰ Your games gets **Earlier versions** on each game's row. It lists the copies, newest first, each with
  its date and time, trains, pieces and coins, and why it was kept. Each copy offers:
  - **Add as a game**: a new game beside the others, "<name> (<date>)". Nothing is replaced.
  - **Replace**: asks first ("What it is now is kept as an earlier version"). Then the game as it is now is copied as a
    `replaced` copy (read back) before its keys are written. It's the open game's live keys (and the page starts again
    on it) or a parked game's parked key. If that copy can't be kept, nothing is replaced.

## 2. The write guard (`src/persist/write-guard.ts`)

Before Game mode's autosave writes, the railway about to be written is compared with the one stored, by a summary of
each: seed, whether it's the starter map, pieces and cars. The stored summary is worked out once
a page (a `JSON.parse`) and again only when the stored text isn't the text this page last wrote (a string compare).

The guard trips when the stored railway is a real one (pieces + cars ≥ 25) and the new one:

- is on another seed (a new game always takes a new slot, so this is never right), or
- is the starter map (seed 7, `starter`) over a game that isn't, or
- is near-empty beside it: a quarter of its pieces and cars or fewer, and at least 20 fewer.

(Every Game map has `starter: true`. Only seed 7 with it is the starter map, as `nameOfLand` has it.)

When it trips, nothing is written: not the railway, session, goals or progress. The stored keys are kept as a `kept`
copy (layer 1) and read back. Once that copy is safe, a toast says so ("…kept: ☰ Your games, Earlier versions"), and
saves go on from the next autosave. If it can't be kept (no room, or it doesn't read back), Game mode's saves are locked
for the page (`lockSaves`) and the toast says the game wasn't saved over. That's the fail-safe side. A false trip, such
as a player tearing up most of a big railway at once, costs one copy and a toast.

## 3. The corpus gate (`src/persist/corpus.test.ts`, in `npm test`)

Every save in the repo must load on the current code and round-trip: loaded, saved, loaded again and saved again, with
the second save the same as the first, and no clamp or drop on its load. The corpus is:

- `src/persist/fixtures/*`
- `src/play/bugmaps/**/*.txt` (the reference maps too)
- `docs/agents/reports/*.txt`
- the older versions' saves (`src/persist/fixtures/v12-game.json`, `src/game/fixtures/draw-depot-948582.json` (v13) and
  `src/persist/fixtures/v14-game.json`, recorded with the v14 writer)

The test also checks that the corpus holds every version from `MIGRATES_FROM` to `SAVE_VERSION − 1`. AGENTS.md says a
feature that adds saved state adds a fixture at its maximum.

## 4. Loading says what it lost (`LoadReport`, `src/persist/save.ts`)

`deserializeWorld` takes an optional report and counts what it clamped (numbers brought down to a schema limit by
`mendTooBig`, and piles over their cap) and what it dropped (trains it couldn't put back, cargo or riders a car can't
hold, signals whose joint is gone, boats with no dock, yard orders, ruins not found). At start-up, a report with
anything in it gives a toast that names it ("Loaded, but this version couldn't keep: 1 train put back, 2 piles over
their limit"). It also sends one crash report of kind `save-mended`, with the counts and names only (as `gl-lost`'s
does: never the map).

## Costs

Nothing runs per frame. An autosave adds one `getItem` and a string compare against the text it last wrote, and keeps
that text (one save's size, about 190 KB on the user's map). Backups cost a gzip off the start-up path, at load only.
A backup is done in short steps, each in an idle moment (`requestIdleCallback`; the gzip fed 32 K chars at a time), so
none holds the main thread over a frame: on the user's map (190 K chars of keys) its longest hold is 6–14 ms with the
CPU slowed 4× and 8–15 ms at 6×, where taken all at once it was 14–31 ms and 21–77 ms; it takes about a second from
start to end, in idle time (`node tools/perf/backup-slices.mjs`). Numbers are in the branch's report.

## Tests

- `src/persist/save-safety.test.ts` (the guard, backups, their packing in slices, restores, the load report), `corpus.test.ts`
- `npm run e2e:save-safety`, on a 390×844 phone, by taps. `restore`: the user's game opened, a copy taken, a piece
  laid; Your games, Earlier versions, Replace asks and replaces it, and the page is back on the copy's railway.
  `guard`: the starter map in play over the user's game in storage (the 2026-11-22 state). An edit by taps trips the
  guard, the toast shows, the copy holds the game byte for byte, and Earlier versions lists it with 10 trains and 267
  pieces. Add as a game, then Open, gets it back.

## The cloud: not built here (flagged)

Save safety stays out of the cloud sync (`src/persist/cloud*`, the cloud parts of `slots.ts`, the Worker's sync), which
another branch is changing. What it does today, and what it should do when the two meet:

- **A cloud pull writes the live keys itself** (`cloud.ts`'s own `storage.setItem`, then a reload), not through
  `autosaveGame`, so the write guard never sees it. On the reload the pulled game loads cleanly: the guard knows it
  and its `load` backup is taken, so the game as it was before the pull survives only as the cloud's own one backup
  (Cloud save → Restore), not in Earlier versions. **Should:** before a pull writes over a game, take a `kept` copy of
  the keys it replaces (`BackupStore.take(id, keys, "kept")`, read back), and run the guard's rule (`tripOf`) on the
  pulled railway against the local one: a pull that trips (another seed, the starter map, near-empty) asks the player
  instead of taking it quietly.
- **A park or a code typed in** (`parkOpen`) moves the open game's keys under Your games; backups are keyed by the
  game's id, so they follow it. Nothing needed.
- **A restore from Earlier versions** calls `cloud?.edited("game")` (as any edit does), so the restored game goes up
  as the newest. Nothing changed in the cloud code for it.
- **The Worker:** only its crash report check, which now takes the kind `save-mended` (`cloud/src/crash.ts`); nothing
  of the sync. It needs a deploy before those reports are taken.
