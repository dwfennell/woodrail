# Woodrail — notes for agents

A Brio-style wooden railway game: TypeScript, Three.js, Vite, Rapier physics. It runs on phones, so keep CPU and GPU cost in mind.

## Commands

- `npm run dev`: dev server
- `npm test`: unit tests (Vitest)
- `npm run typecheck`
- `npm run build`
- `npm run build:artifact`: a build to publish as a claude.ai Artifact (see `docs/artifact-builds.md`)
- `npm run build:itch`: a build for itch.io, zipped (`woodrail-itch.zip`); releases push it there (see `docs/itch-builds.md`)
- `npm run fuzz:long [-- --seeds 200 --seconds 1800]`: the long routing fuzz with every train invariant, sharded over the cores; for release points (about 30 game minutes a seed)
- `npm run replay -- <file>`: replay a "Copy map for a bug report" text headless with the train invariants on, and print the first break (`src/play/bugmap.ts`)
- `npm run feedback -- <id or map link>`: fetch a "Report a bug or give feedback" report's map into a file for `npm run replay` (`--list` with `ADMIN_KEY` lists the latest; see `docs/feedback.md`)
- `npm run e2e:roads`: end-to-end road tests in a headless browser
- `npm run e2e:kits [-- <out> [groups]]`: end-to-end track props (kits, lineside furniture) in Sandbox, headless (about 12 min)
- `npm run e2e:research [-- <out>]`: end-to-end Research picker and pill on a 390×844 phone, headless (about 3 min)
- `npm run e2e:copy-map [-- <out>]`: ☰ "Copy map for a bug report" and the dev-only `#load=` back in, on a phone, headless (about 2 min)
- `npm run e2e:train-summary [-- <out>]`: end-to-end train summary and wagon loads on the cards, Game mode on a 360×740 phone, headless (about 8 min)
- `npm run e2e:engine-names [-- <out>]`: end-to-end engine names in Game mode on a 390×844 phone: an engine dragged out is named, its card titled with the name, renamed by a tap on the title, and the name kept after a reload (about 2 min)
- `npm run e2e:stickers [-- <out>]`: end-to-end stickers: one earned quietly by laying track, the dot, the last core goal, the toast and the Stickers tab, on a 390×844 phone, headless
- `npm run e2e:stats [-- <out>]`: end-to-end "Help improve Woodrail" play stats on a 390×844 phone: asked after the first goal, a yes, the batch the Worker reads, Stop sharing (about 2 min; see `docs/stats.md`)
- `npm run e2e:hopper-load [-- <out>]`: hoppers in Sandbox, headless: empty shows an open bin, loads show a heap of their goods as high as they are full, with pictures (about 1.5 min)
- `npm run e2e:locked [-- <out>]`: locked tray tiles say how to unlock them and open Research there; Game's tray tabs fit at 360 px; the town card on a phone on its side in two columns (about 6 min)
- `npm run e2e:warehouse [-- <out>]`: end-to-end warehouses in Game mode on a 390×844 phone: the hand-run explanation, planks set to Takes only on its card, a route dropping planks there and one taking none until they're set back, then taking them to a town, by taps, headless (about 4 min)
- `npm run e2e:focus-ring [-- <out>]`: the keyboard focus ring: none after a click or tap (even when a key follows), and inside the control by Tab, on the tray tabs, Journal tabs, research board and chips, at 390 and 1440, headless (about 4 min)
- `npm run e2e:signals [-- <out>]`: end-to-end signals in Game mode on a 390×844 phone: dragged from the Switch shelf onto a joint (snap, tint, move cost), its card, Turn round, a tap to hold, the Signal tool and a run along the track, undo; 0 idle frames and a few draws; the payoff on a line of two trains, the held-by-hand card, an old save's signal piece, headless (about 7 min)
- `npm run e2e:life [-- <out>]`: end-to-end small touches in Game mode on a 390×844 phone: the first train's marker on Go and after a reload, a working forest's axe swinging (and holding still, nothing drawn, while paused), the towns' touches (about 4 min). Pictures and frame costs: `node tools/shots/industry-life.mjs [<out>]`

Designs and plans are in `docs/superpowers/specs` and `docs/superpowers/plans`.

## Performance: don't recompute what hasn't changed

The game should cost close to nothing when nothing is happening, and only pay for what changed when something does.

- **Render on change.** Draw a frame only when something visible changed: the camera moved, a train or animation is running, or `invalidate()` was called. Don't add work that runs every frame unconditionally.
- **Shadows** redraw only when a shadow caster moves (`moveShadows()`), something changes (`invalidate()`), or the shadow frustum refits. A camera move alone doesn't redraw them.
- **Rebuild incrementally.** When one thing changes, rebuild only the meshes, colliders or data it affects, not the whole map. For example, `HillCutsView` rebuilds only blocks whose cuts changed; the map-wide core and shadow mesh are rebuilt only when the set of cut blocks changes.
- **Key caches by their inputs.** Skip work when the inputs are the same as last time, such as a key built from the pose, or a signature of what's cut. Cache derived data per map (as `hillsOf(grid)` does).
- **Pointer moves are hot paths.** Code called on every pointer move while dragging (placement checks, previews) should be cheap and bounded. Time it, with a target of a few milliseconds on a phone.
- **Measure before and after** a performance change: idle CPU, frame time, the time of the operation itself. Note the numbers in the commit.

## Testing: check the player's path, end to end

A feature works only if a player can reach it and it pays off. (A restored old farm once shipped that couldn't farm: the play-through skipped the "Open a …" goals and the e2e stopped at the restore button.)

- **Every goal is reached by the player's path** in the play-through (`src/play/balance.test.ts`): through the actions a player takes (tray drops, card buttons, prices paid), not by writing state (`learned.add`, `coins =`, `piles[…] =`, placing depots directly). A goal that can't be is on an explicit allowlist with a reason, and a guard test fails when a goal is neither reached nor allowlisted.
- **Assert the payoff, not just the UI.** An e2e or test for a feature checks what it is for: an industry produces and its goods are carried, a goal ticks, a train delivers. Not only that a card opened or a button went away.
- **The harness uses the game's own rules.** Same footprints, prices and reach as `main.ts`. A harness-only shortcut must be named and commented, and never stands in for the player's path of the thing under test.
- **Shortcuts in setup are fine** (learning research to get to a state quickly), but only for what isn't the thing being tested.

## Design skill

`.claude/skills/impeccable` (with helper agents in `.claude/agents/impeccable-*`) is the Impeccable design skill, vendored from github.com/pbakaus/impeccable. Use `/impeccable` (e.g. `critique`, `polish`, `clarify`, `adapt`) for HUD, card, menu and tray work. It is written for websites: keep the game's wooden-toy look and the phone limits above. Its launcher downloads a checksum-verified binary from the repo's GitHub releases on first run. Its hooks are not installed.
