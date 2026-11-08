# End-to-end suites: groups, resume, and what to run

The e2e suites (`npm run e2e:*`, in `scripts/e2e/` and `tools/e2e/`) drive the game in headless Chromium with
SwiftShader. They are slow: e2e:touch is 212 checks and 40–70 min, e2e:click 78 checks and about 40 min. A run that
times out or loses its container used to start again from nothing. Now:

- **Every suite has named groups**, listed by `npm run e2e:<suite> -- --list`, and `E2E_ONLY=<group,…>` runs just
  those (in the suite's order). Suites not split yet have one group, `all`.
- **A killed run resumes.** Each group that passes is written at once to `.e2e-cache/<suite>/<key>.json` (gitignored),
  keyed by a hash of the source tree. Run the same command again on the same code and those groups print
  `group <name>: cached pass (N checks, …)`; only the rest run. The final `N/N passed` counts the cached checks too, so
  the landing gate's grep (`all passed$|ALL PASS|^([0-9]+)/\1 passed$|^([0-9]+)/\2 PASS`) sees the same line.
- **`npm run e2e:affected [-- <base-ref>]`** lists the suites (and groups) a branch's changes may affect.

The helper is `scripts/e2e/lib/groups.mjs` (suites split into groups use it directly) and `scripts/e2e/lib/run.mjs`
(package.json runs every other suite through it, as one group).

## Running

| | |
|---|---|
| `npm run e2e:touch -- --list` | the groups, in order (no browser started) |
| `E2E_ONLY=routes,via npm run e2e:touch` | those groups only |
| `E2E_SHARD=2/3 npm run e2e:touch` | every third group, from the second: three processes can share a suite (each prints its own `N/N passed`; on a 4-core box SwiftShader leaves little to gain past 2) |
| `E2E_RESUME=0 npm run e2e:touch` | ignore the checkpoints: run everything (they're still written as groups pass) |
| `E2E_FRESH=1 npm run e2e:touch` | each group on a fresh page, as when it runs alone (touch: proves no group leans on one before it) |
| `rm -rf .e2e-cache` | forget every checkpoint |

**The key** (`sourceKey()` in groups.mjs) is git's index (every tracked file's blob id) plus the content of every
changed or new file, leaving out `docs/**` and `*.md`. Any change to code, assets, package.json or the e2e scripts runs
everything again; editing a doc doesn't. Not a git checkout: no key, nothing skipped.

**A group passes** when every check it made passed and the page threw nothing while it ran. A failed group isn't
recorded, so the next run runs it again (and the ones after it that hadn't run). A run given arguments (an out dir for
pictures) isn't cached by run.mjs: it's run for its pictures.

## Groups in the split suites

**touch** (`scripts/e2e/touch.mjs`): `sandbox-shelves`, the 28 Sandbox checks (`map-taps`, `select-drag`, … `route-ux-more`;
the comment above `openGroundScript` says what each is) and `game-shelves`. The Sandbox groups share one page, as
before, opened when the first of them that runs needs it (after `sandbox-shelves`'s taps, or without them when that one
is cached or not selected); each one's `step` takes up what it laid. With `E2E_FRESH=1` each opens a page of its own:
a full run that way shows no group leans on one before it. (It found two that did: a group run first on a new page
tapped before the page had settled, so `openMode` waits for `settled()` when a group other than the shelves opens
the page (not in a full run: settling first moves the opening view, and the Sandbox checks after it ran 30 min slower); and select-drag was within reach of its
piece only from the view map-taps left, so it now zooms in itself.)

**click** (`scripts/e2e/click-place.mjs`): `desktop`, `model-train`, `tight-curves`, `feedback`, `fullscreen`,
`game-engine`, `touch-tray`, `routes`. Each opens its own pages; one that throws fails `<group>: ran to the end` and the
rest still run (before, one throw ended the run with no last line).

**sites** (`tools/e2e/map-sites.mjs`, about 37 min): `ruins` (steps 1–12 on one page), then `sandbox` (13),
`phone-side` (14), `map-view` (15), `map-side` (16), `big-map` (17), each on fresh pages, closed after it.

**draw** (`scripts/e2e/draw.mjs`, about 90 min): `favourites`, `shelf-drag`, `drawn` (steps 1–6, from the free end
found on the map), `phone-drag` (7), `phone` (7b, the phone on its side), `specials` (ramps and bridges), QA's
replays a group each (`qa-slant-23-there`, `qa-slant-30-back`, `qa-slant-10-back`, `qa-slant-m23-back`,
`qa-slant-10-there`, `qa-slant-40-back`, `qa-terrace`, `qa-terrace-2`: each on a fresh page, about 7 min; once one group,
`qa-slant`), `terrace-repeat`, `terrace-qa`, `junctions` (on a fresh page), `loop`, `under-slant` (a line drawn at a slant under a bridge one level up, on a phone page of its own), `ghosts`. `lift` runs only when
named (`extra`, below): the old subset that isn't in a full run. The old `E2E_ONLY=junctions` ran junctions, loop,
ghosts and lift on the first page: now `E2E_ONLY=junctions,loop,ghosts,lift`. The old `E2E_ONLY=qa-slant`: the eight
`qa-*` groups and `terrace-repeat,terrace-qa`.

**low-bridge** (`tools/e2e/low-bridge.mjs`, about 12 min): one Sandbox phone page; each group builds its own place:
`square`, `diagonal`, `curved`, `curved-end`, `curve-under`, `points`, `train`, `signal`, `laid-under`, `draw-ramp`,
`hilltop`, `hill-edge`, `hill-edge-curved`, `hillside`, `road`, `road-over`, `draw-under`, `costs` (road-over and costs
put down an underpass first when run alone).

**ramps** (`scripts/e2e/ramps.mjs`, about 9 min on a 4-core box): `wide`, `s`, `spiral` (a lane each: laid from the
tray, an engine run up it) and `drag` (#8's curves dragged out and tapped), on one desktop Sandbox page, each finding its
own room. On the test clock and Battery saver, a tray item's shelf tapped straight off (not shelf after shelf).

**joints** (`scripts/e2e/joints.mjs`): `qa-line` (QA's drawn line's joints through a reload, an older build's save),
`slip-draw` (a Draw stroke along a 45° crossing's turn makes it a slip, Game mode). Each on a fresh page.

**tray** (`scripts/e2e/tray.mjs`, on the build): `pictures` (every Track-tray item's real picture, fresh and from the
cache), `track-pieces` (slips and the double three-way on the Switch shelf: pictures in Sandbox, locked in Game till
learned).

**roads** (`scripts/e2e/roads.mjs`): `sandbox` (A–J on one page, each section on the roads the ones before laid) and
`game` (K–X, each on the route N laid). They're one chain each, so two groups; `game` alone opens Sandbox first only
to read its tabs (K1 compares them).

**cloud** (`scripts/e2e/cloud.mjs`, about 19 min idle, 27 with a CPU hog): `sandbox` (steps 1–6, devices A and B),
`game-sync` (7–8) and `game-rewards` (9–10). Each Game group sets up two devices (C and D) on a code of its own, so it
can run alone; each run starts its own Worker on a free port (`CLOUD_PORT` to pin one), so `E2E_SHARD=1/2` and `2/2`
can run side by side. As one group, a gate's 1700 s timeout fell on step 10 with every check before it passing.

**A group that runs only when named:** `suite.add(name, fn, { extra: true, about: "…" })`. A full run (no `E2E_ONLY`)
leaves it out; `--list` marks it "(only when named)".

## Splitting another suite into groups

1. `import { groups } from "./lib/groups.mjs"` (from tools/e2e: `"../../scripts/e2e/lib/groups.mjs"`), and
   `const suite = groups("<suite>", { results, errors, check })`, where `results` is the array `check` pushes
   `{ name, ok }` to and `errors` the page errors. (A suite with only a `failures` count: make `check` push to a
   `results` array too.)
2. Each section becomes `suite.add("<name>", async () => { … })`, setting up its own page and state, so it can run
   alone. Keep the checks as they were: same names, same assertions.
3. Start the dev server and browser lazily (`boot()` in touch.mjs and click-place.mjs), so `--list` and an all-cached
   run start nothing.
4. `await suite.run(around)` (`around(group, go)` may open a page before and close what's left after), then the suite's
   last checks ("no page errors"), then `suite.finish()`, which prints `N/N passed` and exits.
5. In package.json call the script directly (not through run.mjs; run.mjs passes a suite that imports groups.mjs
   straight through anyway). Set `groups: true` for it in `SUITES` in scripts/e2e/affected.mjs, and name its groups in
   rules where a path only touches some of them.

## What to run for a change: `npm run e2e:affected`

```
npm run e2e:affected                 # against origin/main
npm run e2e:affected -- HEAD~3       # against another base
npm run e2e:affected -- --run        # and run them, one after another
npm run e2e:affected -- --json
npm run e2e:affected -- --check      # every rule names a real suite and group
```

It diffs the working tree (commits, staged, unstaged, new files) against the merge base, and maps each path through
`RULES` in `scripts/e2e/affected.mjs`: a glob (or list of them) and what it affects, `"suite"` or
`"suite:group,group"`. Rules add up. An e2e script maps to its own suite; touch.mjs's own changes to the groups whose
functions they're in (`touchGroupsOf`: a change to a shared helper, the boot or `openMode` is the whole suite).
`IGNORE` (docs, `*.md`, unit tests, tools that aren't e2e) maps to nothing. **A path no rule matches gets `SMOKE`**, a
few quick touch groups across the game and click's `desktop` (about 6 min), and is listed as unmapped: add a rule for
it. So do the paths that reach everywhere (src/main.ts, game.ts, the build, the harness's lib).

**Before the rules, each file's change is classified** (`scripts/e2e/lib/diff-kind.mjs`, against the merge base): a
JS/TS file is compared with its comments dropped and its string literals blanked, a CSS file rule by rule. Only
comments changed: no suite. Only strings changed, and every changed string reads as prose (a space, an emoji or
"…", sentence punctuation; not a lowercase name, class list or selector): the suites whose scripts hold those words
(old or new; touch narrowed to the groups whose lines hold them), plus `COPY_SMOKE` (touch `game-shelves,train-card`).
Only paint-only declarations (colours, backgrounds, shadows) in existing CSS rules: the suites naming the rules'
classes, plus `COPY_SMOKE`. Anything else, or a file it can't read for sure, gets the rules. The output prints a line
for each such file. Tests: `scripts/e2e/affected.test.mjs` (real past commits). Which tier of checks a branch needs
overall: the `/check` skill.

touch and click are selected by group: `TOUCH_INPUT` (presses, holds, drags and drops), `TOUCH_TRACK` (laying track,
points), `TOUCH_TRAINS` and `TOUCH_ROUTES` (the sim, routing), `TOUCH_UI` (the HUD), `CLICK_INPUT`; a rule for a file
names the ones it exercises. Neither is run whole on a landing any more: **run them whole nightly**, `npm run
e2e:affected -- --nightly --run` (about 80 min), so what the narrowed selection leaves out is still run every day.
The estimate it prints is from each group's measured time (`GROUP_SECONDS`; else the suite's minutes shared out). The map is by hand, from what each suite's header says it drives; when you add a suite, add it to
`SUITES` and give it rules for the code it's there to cover; when you add a module, a rule saves every later branch the
core set's hour.

## Pictures: `scripts/e2e/lib/shot.mjs`

A screenshot is never a check, so it must never hang or fail a suite. `shot(page, path, opts)` takes one with a
timeout (2 min) and a bound of its own past Playwright's, and on failure prints `(no picture …)` and carries on.
`quiet(page)` waits (bounded) for the page's start-up work: its tray pictures drawn and saved, then `settled()`. Use it
before a picture of a page that has only just loaded in a fresh context: it is still drawing its tray pictures, each read
back from the graphics card, and under load a frame then takes seconds. (e2e:copy-map's last screenshot waited 23–30 s
there for a frame, and ran out on a slower box after every check had passed; after `quiet` it took under a second.)

## Speed: where the time goes, and `scripts/e2e/lib/fast.mjs`

Under SwiftShader (no GPU, 4 cores) a frame of the game costs about a second on a 390×844 phone page and two on the
1200×800 desktop page: about a million triangles a frame, so it's bound by vertices more than pixels. Nearly all of a
suite's time is frames: a pointer move waits for one, `settled()` waits for animations to end, a two-`requestAnimationFrame`
wait is two. Three things made that worse than it has to be, and `lib/fast.mjs` takes each away without changing a check:

- **The test clock** (`testClockIn(browser)`): a frame's step of the world was capped at 0.1 s (and the sim at 8 ticks
  of 1/120 s: 0.067 s), so at a frame a second the sim and every animation ran at a fifteenth of real time. A laid
  line's settling took 12 s, a research a minute. In the test clock's pages (`window.__e2eClock`, read by
  `e2eMaxDt` in src/game/game.ts; never set in play) a frame's step may be up to 1 s: the same fixed sim ticks, more of
  them a frame, so game time keeps up with real time. `E2E_CLOCK=0`: as before. A suite that waits on game time
  itself (a lesson's 20 or 45 s of study) may also run it faster than real time: `testClockIn(b, { speed: 4 })`
  (e2e:research), still at most a second's step a frame. Opt in per suite, saying why, and check that nothing it
  looks at mid-way (a study counting down) is over before it looks. `E2E_SPEED=1`: at real time.
- **Moves a few to a frame** (`mouseMoves`, `touchMoves`, `inFrames`): a phone samples a finger at 120 Hz and the
  game draws 30 frames a second, so a frame's pointer event carries about four moves, the rest in
  `getCoalescedEvents()`, and the game takes every one in order (`coalesced` in src/game/interaction.ts). The helpers
  send `MOVES_PER_FRAME` (4) moves at once and await them together: the same points in the same order, a quarter of
  the frames. Stamped strokes keep their stamps. `E2E_MOVES_PER_FRAME=1`: one a frame, as before.
- **Cheaper frames where pixels aren't checked**: phone pages at a device scale of 1 (`E2E_PHONE_DPR=2`: as before;
  the layout is in CSS pixels either way), and the desktop page as "Battery saver" (`batterySaverIn`: the mobile tier,
  no ambient occlusion or depth of field, which cost a desktop frame several seconds). `E2E_SAVER=0`: high, as before.

To see where a suite's time goes: `E2E_PROFILE=1 npm run e2e:<suite>` (`lib/profile.mjs`) times every Playwright call
by the line of the suite that made it (inclusive up its own call chain), and prints the top lines after each group and
for the run (`E2E_PROFILE_TOP=n` lines). A helper's line (`settled`, `boot`, `drag`) shows everything through it.

## CI: the suites on GitHub Actions (`.github/workflows/e2e.yml`)

Every push to a `claude/**` branch (not one that touches only `docs/**`) runs the e2e suites in parallel on GitHub's
runners, on **the branch merged with main**, so a green run holds for what would land. A newer push to the same branch
cancels the older run. To run it on demand: Actions → e2e → Run workflow, with `ref` (a branch or sha), and either
`suites` (the gate's form: `signals touch:blocker,defaults click:desktop`) or `all`. A push whose head commit's message has the line `[e2e all]` runs every suite too (for a release point, or
when dispatching isn't open to you), and `[e2e: signals touch:blocker]` runs just those (each on a line of its own).

The jobs:

- **plan + build**: merges main (a conflict fails here, naming the files), then `node scripts/e2e/ci.mjs plan`: the
  suites from `scripts/e2e/affected.mjs origin/main --json` plus `SMOKE` (or the ones given, or all), split into shards
  of about 9 minutes each, at most 12 (GitHub Free runs 20 jobs at once across the account; other branches and Pages share them), longest first onto the least loaded shard. A grouped suite over 8 minutes is
  split by its groups (`E2E_ONLY`); a shard's units of one suite run as one invocation. Durations are rough, from
  `scripts/e2e/durations.json`. It also runs `npm run build` (typecheck + vite) once; a shard that needs `dist/`
  (e2e:tray) downloads it instead of building.
- **shard N**: one runner a shard (4 cores, SwiftShader, Playwright's own Chromium, cached): each suite as the gate
  runs it (`npm run -s e2e:<suite>`, `E2E_ONLY=…` for groups); it passes on exit 0 and the gate's pass line. A failure
  is retried once (the groups that passed are cached, so only the failed ones run again); a second failure is real.
  A suite is killed past 2.5× its estimate (15–55 min).
- **unit 1/4 … 4/4**: vitest, `--shard`.
- **e2e**: the one check to gate on. It passes only when every shard reported and every suite passed (a flaky pass,
  green on its retry, counts as a pass and is marked ⚠️).

**Reading results.** The `e2e` job's summary has a table: suite (and groups), result, seconds, shard. The artifact
`e2e-results` holds `e2e-results.json`: `ok`, `tree` (the tested merge's `git rev-parse HEAD^{tree}`: match it against
what you land), `sha` (the ref), `main` (the main merged in), each unit's result, seconds and pass line, and
`measured` (seconds per suite or one-group unit: copy them into `durations.json` when the shards drift out of
balance). A failed shard uploads `e2e-logs-<N>`: `e2e-logs/<suite>.log` (both attempts) and `e2e-out/` (screenshots).
In the shard's own log each suite is a folded group; a failed one says `::error::<unit> failed twice`.

Locally: `node scripts/e2e/ci.mjs plan --pretty [--all | --suites "…"]` prints the shards without running anything.
