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
- `npm run balance:sweep [-- --from 0 --to 200 --jobs 4]`: the `BALANCE=1` play-through over a range of player seeds, each checked against the bands at 180 min; for balance changes and release points (about a minute of CPU a seed)
- `npm run replay -- <file>`: replay a "Copy map for a bug report" text headless with the train invariants on, and print the first break (`src/play/bugmap.ts`)
- `npm run feedback -- <id or map link>`: fetch a "Report a bug or give feedback" report's map into a file for `npm run replay` (`--list` with `ADMIN_KEY` lists the latest; see `docs/feedback.md`)
- `npm run e2e:affected [-- <base-ref>] [--run]`: the e2e suites (and groups) a branch's changes may affect, against origin/main by default; `--run` runs them. The map is `RULES` in `scripts/e2e/affected.mjs`: add a rule for a new module (see `docs/agents/e2e.md`)
- Every e2e suite: `npm run e2e:<suite> -- --list` prints its groups; `E2E_ONLY=<group,…>` runs only those; a killed or timed-out run, run again on the same code, skips the groups that already passed (`group X: cached pass`, counted in the last line; `E2E_RESUME=0` runs all); `E2E_SHARD=i/n` runs a slice. Checkpoints in `.e2e-cache/` (`docs/agents/e2e.md`)
- `npm run perf [-- --maps fresh,late,sandbox --profile]`: the perf harness, after a build (see `docs/agents/perf.md`); `npm run perf:check`: it against `tools/perf/budgets.json` (about 5 min)
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
- `npm run e2e:warehouse [-- <out>]`: end-to-end warehouses in Game mode on a 390×844 phone: the hand-run explanation, planks set to Takes only on its card, a route dropping planks there and one taking none until they're set back, then taking them to a town; a mine set to coal only; hoppers set not to take coal; by taps, headless (about 6 min)
- `npm run e2e:focus-ring [-- <out>]`: the keyboard focus ring: none after a click or tap (even when a key follows), and inside the control by Tab, on the tray tabs, Journal tabs, research board and chips, at 390 and 1440, headless (about 4 min)
- `npm run e2e:sandbox-chains [-- <out>]`: Sandbox's chain hints on a 390×844 phone, headless: the Industries tab and its tip, a Harvester and a Sawmill dragged out (rings while held), the sawmill's card (where logs come from, Show, where planks go) and its chevrons, idle frames, coaches at a forest told they need a flatbed, a flatbed train routed by taps carrying logs in and planks to a town, a bakery's card, ☰ Chain hints off; then the card at 1440×900 (about 10 min)
- `npm run e2e:signals [-- <out>]`: end-to-end signals in Game mode on a 390×844 phone: dragged from the Switch shelf onto a joint (snap, tint, move cost), its card, Turn round, a tap to hold, the Signal tool and a run along the track, undo; 0 idle frames and a few draws; the payoff on a line of two trains, the held-by-hand card, an old save's signal piece, headless (about 7 min)
- `npm run e2e:low-bridge [-- <out>]`: end-to-end low bridges in Sandbox on a 390×844 phone: a Bridge from the tray onto a ramp's top one level up over a line digs an underpass under it (toast, one undo step, a girder span), a train with the tallest cars runs under it; at 45° and a curved bridge too; refused over a curve, points, a curved bridge's end, a train or a signal on the line, saying why; a Long straight laid on under a standing bridge digs one too, and so does Draw across a line from a ramp's top and on the ground under a standing bridge; on a hilltop (cut into the hill); refused across a road, and a road refused across one; plan cost and 0 idle frames (about 9 min)
- `npm run e2e:depot-tracks [-- <out>]`: end-to-end depot tracks in Game mode on a 390×844 phone: a mill's card, Second track by a tap (planks taken), Undo (track and planks back), Third track (planks and stone), the one crane's gantry over 2 and 3 tracks; two trains routed by taps standing at the mill at once on their own tracks, the crane serving each in turn (never two loads at once), both trains' grain unloaded; three tracks after a reload; 0 idle frames (about 6 min)
- `npm run e2e:tunnels [-- <out>]`: end-to-end tunnels in Game mode on a 390×844 phone: Tunnels researchable after Bridges, the mouths on the Bridges shelf and their price, a Long straight dropped against a hill's side digs a tunnel under it (one undo step, the toast, two short mouths out of the box), portals and dashes, a train run under the hill (a ghost there) and out, Draw across a second hill goes under it; costs and 0 idle frames (about 6 min)
- `npm run e2e:life [-- <out>]`: end-to-end small touches in Game mode on a 390×844 phone: the first train's marker on Go and after a reload, a working forest's axe swinging (and holding still, nothing drawn, while paused), the towns' touches (about 4 min). Pictures and frame costs: `node tools/shots/industry-life.mjs [<out>]`

Designs and plans are in `docs/superpowers/specs` and `docs/superpowers/plans`.

## Performance: don't recompute what hasn't changed

The game should cost close to nothing when nothing is happening, and only pay for what changed when something does.

- **Render on change.** Draw a frame only when something visible changed: the camera moved, a train or animation is running, or `invalidate()` was called. Don't add work that runs every frame unconditionally.
- **Ambient animation draws only when it can be seen.** Motion that's there for looks (an industry's saw or axe, a boat, a road vehicle) asks for frames only while it's on screen *and* drawn big enough to see it move: test it with the frame's `AmbientEye` (`src/render/ambient.ts`: frustum and size in pixels, thresholds per kind in `AMBIENT_MIN_PX`), not with an object's `visible`. Zoomed out, it stands still and the map costs nothing. When ambient motion is all that moves, it's drawn at `AMBIENT_FRAME_MS` (15 a second); trains and the camera keep the full rate. New ambient motion follows the same rule.
- **Shadows** redraw only when a shadow caster moves (`moveShadows()`), something changes (`invalidate()`), or the shadow frustum refits. A camera move alone doesn't redraw them.
- **Rebuild incrementally.** When one thing changes, rebuild only the meshes, colliders or data it affects, not the whole map. For example, `HillCutsView` rebuilds only blocks whose cuts changed; the map-wide core and shadow mesh are rebuilt only when the set of cut blocks changes.
- **Key caches by their inputs.** Skip work when the inputs are the same as last time, such as a key built from the pose, or a signature of what's cut. Cache derived data per map (as `hillsOf(grid)` does).
- **Pointer moves are hot paths.** Code called on every pointer move while dragging (placement checks, previews) should be cheap and bounded. Time it, with a target of a few milliseconds on a phone.
- **Measure before and after** a performance change: idle CPU, frame time, the time of the operation itself. Note the numbers in the commit. `npm run perf` (tools/perf/run.mjs) measures three maps on a throttled phone-sized page (load, idle, paused, pan, tray drag, cards, autosave, draw calls, triangles, heap); `--profile` adds CPU profiles. How to read it: `docs/agents/perf.md`.
- **Budgets.** `npm run perf:check` (after a build, about 5 min) fails when a measure is over `tools/perf/budgets.json`. A change that rightly costs more updates the budgets (`-- --update`) in the same commit, saying why; one that saves a lot tightens them.
- **Before adding per-frame work**, ask: does it need to run every tick, or on an event or a version change? `Game.frame` and `onFrame` run 30 times a second even when nothing is drawn, paused too. Does it allocate (arrays, closures, spreads, strings)? Does it write the DOM when nothing changed? Does it add draw calls or a new material (a new shader program to compile at load)?
- **Not while paused or idle.** A paused game, or one with nothing moving, should cost next to nothing: no placing objects that haven't moved, no re-uploading buffers that haven't changed, no saving what hasn't changed.

## Testing: check the player's path, end to end

A feature works only if a player can reach it and it pays off. (A restored old farm once shipped that couldn't farm: the play-through skipped the "Open a …" goals and the e2e stopped at the restore button.)

- **Every goal is reached by the player's path** in the play-through (`src/play/balance.test.ts`): through the actions a player takes (tray drops, card buttons, prices paid), not by writing state (`learned.add`, `coins =`, `piles[…] =`, placing depots directly). A goal that can't be is on an explicit allowlist with a reason, and a guard test fails when a goal is neither reached nor allowlisted.
- **Assert the payoff, not just the UI.** An e2e or test for a feature checks what it is for: an industry produces and its goods are carried, a goal ticks, a train delivers. Not only that a card opened or a button went away.
- **The harness uses the game's own rules.** Same footprints, prices and reach as `main.ts`. A harness-only shortcut must be named and commented, and never stands in for the player's path of the thing under test.
- **Shortcuts in setup are fine** (learning research to get to a state quickly), but only for what isn't the thing being tested.

## Design skill

`.claude/skills/impeccable` (with helper agents in `.claude/agents/impeccable-*`) is the Impeccable design skill, vendored from github.com/pbakaus/impeccable. Use `/impeccable` (e.g. `critique`, `polish`, `clarify`, `adapt`) for HUD, card, menu and tray work. It is written for websites: keep the game's wooden-toy look and the phone limits above. Its launcher downloads a checksum-verified binary from the repo's GitHub releases on first run. Its hooks are not installed.
