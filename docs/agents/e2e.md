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
`"suite:group,group"`. Rules add up. An e2e script maps to its own suite. `IGNORE` (docs, `*.md`, unit tests, tools
that aren't e2e) maps to nothing. **A path no rule matches gets the core set (touch, click)** and is listed as unmapped:
add a rule for it. The map is by hand, from what each suite's header says it drives; when you add a suite, add it to
`SUITES` and give it rules for the code it's there to cover; when you add a module, a rule saves every later branch the
core set's hour.

## Pictures: `scripts/e2e/lib/shot.mjs`

A screenshot is never a check, so it must never hang or fail a suite. `shot(page, path, opts)` takes one with a
timeout (2 min) and a bound of its own past Playwright's, and on failure prints `(no picture …)` and carries on.
`quiet(page)` waits (bounded) for the page's start-up work: its tray pictures drawn and saved, then `settled()`. Use it
before a picture of a page that has only just loaded in a fresh context: it is still drawing its tray pictures, each read
back from the graphics card, and under load a frame then takes seconds. (e2e:copy-map's last screenshot waited 23–30 s
there for a frame, and ran out on a slower box after every check had passed; after `quiet` it took under a second.)
