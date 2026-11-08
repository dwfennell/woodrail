---
name: check
description: "Decide and run the checks a Woodrail branch needs before it's handed over for landing, sized to what changed: text and CSS only, UI behaviour, rendering and models, sim/routing/economy, or wide. Use before saying a branch is ready, when asked what to test, or when asked to run the checks or the gate."
user-invocable: true
argument-hint: "[base-ref (default: origin/main)] [--tier copy|ui|render|sim|wide]"
---

# Check a branch before landing

The point: run what the change can break, and nothing that only costs time. A button label doesn't need two hours of
browser suites; a routing change does need the fuzz. Pick the tier from the diff, run its list, escalate when the
diff says so, and report what ran in a form the lander can trust.

## 1. Look at the diff

```
git fetch origin main
git diff --stat origin/main...HEAD; git status --short    # what changed (commits, and anything uncommitted)
npm run e2e:affected                                       # the suites it picks, and why, by file
```

`e2e:affected` (`scripts/e2e/affected.mjs`) classifies each changed file before it maps it
(`scripts/e2e/lib/diff-kind.mjs`): it prints a line for each light file.

- **comments only**: no suite.
- **words only**: only string literals that read as prose changed (labels, toasts, hints). It picks the suites whose
  scripts refer to the old or new words, plus `COPY_SMOKE` (touch `game-shelves,train-card`, about 1.5 min).
- **paint only**: a CSS colour, background or shadow in an existing rule. It picks the suites that name the rule's
  classes, plus `COPY_SMOKE`.
- Anything else is code and gets the full rules, as before. A changed class name, key or event name in a string is
  code.

The tier is the highest one any file in the diff reaches. Pass `--tier` only to raise it.

## 2. The tiers

Rough durations are on a 4-core cloud box with SwiftShader. Run the e2e suites one at a time (they share the cores),
and the unit tests before them: a unit failure is cheaper to find.

### Copy: text, comments, CSS paint only

Every changed source file is "comments only", "words only" or "paint only" in `e2e:affected`'s output.

```
npm run typecheck                                    # ~1 min
npx vitest run <the unit tests of those files>       # seconds; grep src for the old words: a unit test may assert them
npm run e2e:affected -- --run                        # the suites that refer to the words, and the smoke (~5-10 min)
```

Also grep `tools/e2e` and `scripts/e2e` for the old words yourself (`git grep -n "Throw away" -- tools/e2e scripts/e2e`):
a suite that still asserts them must be updated in the same branch. A label that got longer: look at it at 360 px
(the suite's screenshot, or `npm run e2e:locked`'s fit checks if it's on the tray). No broad sweep.

Escalate to **UI** when: a string is built from code that changed, a CSS size, gap, padding, display or position
changed (affected.mjs already calls that code), or a label is new rather than reworded.

### UI behaviour: the HUD, cards, tray, menus, input

```
npm run typecheck
npm test                                             # ~6 min (all of it: cheap next to the browser)
npm run e2e:affected -- --run                        # the HUD's suites, and touch's TOUCH_UI / TOUCH_INPUT groups
```

Plus the suite for the area if affected.mjs didn't pick it (a card: its feature's suite; the tray: `e2e:tray`,
`e2e:locked`; focus and keys: `e2e:focus-ring`; Learn more: `e2e:learn-more`). Usually 15-40 min.

Escalate to **wide** when: `src/main.ts`'s wiring, `src/ui/hud.ts`'s structure or the shared e2e lib changed.

### Rendering and models: src/render, src/catalogue, props, geometry, materials

```
npm run typecheck
npm test                                             # includes the model tests (model-overlaps, buildability)
npm run e2e:affected -- --run                        # picks the visual suites (kits, life, low-bridge, gl-lost, …)
npm run build && npm run perf:check                  # ~16 min: frames, draw calls, memory against the budgets
```

Add `npm run e2e:kits` (~12 min) and `npm run e2e:life` (~4 min) when a model, prop or ambient motion changed and
they weren't picked. A new material or a geometry change that rightly costs more: update the budgets in the same commit
with the numbers (AGENTS.md, Budgets). Take a look at the pictures the suites write (`e2e-out/`).

### Sim, routing, economy: src/sim, src/routing, src/game, src/economy, src/track

```
npm run typecheck
npm test                                             # includes the harness fuzz (8 seeds) and src/play/bugmaps
npm run e2e:affected -- --run                        # signals, depot-tracks, sandbox-chains, touch's route groups, …
```

And, by what moved:

- **Routing or the sim's train rules** (routing/, sim/, signals, points, levers): the long fuzz. For a branch,
  `npm run fuzz:long -- --seeds 40 --seconds 600` (a fifteenth of the full run's game time; note how long it took);
  the full `npm run fuzz:long` (200 seeds × 30 game minutes, hours) at release points. A bug a player reported: `npm run replay -- <file>` for its map, and add it to
  `src/play/bugmaps/` so it stays fixed.
- **Economy numbers** (prices, rates, rewards, research costs, growth): `npm run balance:sweep -- --from 0 --to 40
  --jobs 4` (about 10 min); `npm run balance:sweep` (0-200, about 50 min) when a band is near its edge or at a
  release point.
- **A new goal or feature that pays**: `BALANCE=1 npx vitest run src/play/balance.test.ts` reaches it by the
  player's path (AGENTS.md, Testing).

Usually 40-90 min with the fuzz.

### Wide: many files, the save format, new game, the landscape, the e2e harness

The diff touches several tiers' areas, many e2e scripts, `src/persist` (save format and schemas), new-game set-up, the
landscape (`src/landscape`), `scripts/e2e/lib`, or the build (`vite.config.ts`, `package.json`).

```
npm run typecheck && npm test && npm run build
npm run e2e:affected -- --run
npm run e2e:affected -- --nightly --run              # touch and click whole (~80 min)
npm run build && npm run perf:check                  # if anything drawn or loaded changed
```

A save format change: the suites that check their feature "kept after a reload" are the ones to watch, and an old
save must still load (the save's unit tests). Plus the sim tier's fuzz and sweep if the sim or economy is in it. Expect 2-3 hours: say so at the start, and use
`E2E_SHARD=i/n` to split touch over two processes.

## 3. Failures

- A failure in what you changed is real: fix it, then rerun that suite (`E2E_ONLY=<group>` for the failed group;
  the passed groups are cached and skipped on the same code).
- A failure that looks unrelated (a timeout, a tap that missed, nothing your diff touches): rerun **once**, that
  suite or group alone. If it passes, report it as a flake with both results. If it fails again, it's real: look at it,
  and if it's truly not yours, show that it fails the same on `origin/main` before calling it pre-existing.
- Never skip, disable or loosen a test to get green.

## 4. The hand-over

End with a block like this, so the lander can see what ran and decide without rerunning it:

```
Tier: copy (src/ui/hud.ts words only; main.ts, style.css comments only)
- typecheck: clean
- unit: 6136 passed, 15 skipped (355 files), 5m41s
- e2e (from e2e:affected): train-summary 24/24 passed (4m12s); touch game-shelves,train-card 9/9 (1m30s)
- not run: perf:check (nothing drawn changed), fuzz (no sim change)
- flake: none
```

Counts are the suite's own last line (`N/N passed`), times from the run, and "not run" names what a bigger tier would
have added and why it wasn't needed. A rerun flake lists both runs. Don't round a failure into a pass.
