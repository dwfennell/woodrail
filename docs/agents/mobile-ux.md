# Mobile UX — playbook

## 1. Scope
Phone-first layout and feel:
- the HUD (top bar, goals, tray, research pill), toasts and cards (engine, car, piece, depot, group);
- the camera: the director's glides and zoom, touch gestures, pitch and FOV, the map view's framing, and canvas sizing;
- the controls tutorial (coach), and the tap and hold rules (hold, pin, branch, carry).

Not in scope: the economy, the sim, or drawing logic, beyond the gestures that start them.

## 2. How to test

**Viewports.** Always check portrait 390×844 and 360×740, and landscape 844×390, 667×375 and 740×360. Use 932×430 for the widest phone. Use isMobile, hasTouch and DPR 2–3.

**Chromium:** /opt/pw-browsers/chromium, launched with `--headless=new --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.

**Gates:**
- typecheck, vitest and build;
- `e2e:touch` (71 checks): holds, pins, branches, cards, toasts, and the dead-end Continue;
- `e2e:click` (carry and click-to-place), `e2e:tutorial`, `e2e:tray`, and `e2e:sites` (the map view, labels and idle frames, about 37 min);
- `e2e:draw` takes more than 1.5 h; run it by group with E2E_ONLY.
- Run long jobs in the background with a log, then grep the log.

**Touch timing.** Send touches with CDP `Input.dispatchTouchEvent` and explicit timestamps. Hold and pin are decided by event time (decideHold), not by when an event arrives. Hold is 380 ms, pin 450 ms, HOLD_SLOP 10 px and BRANCH_SLOP 7 px.

**Wait on conditions, not sleeps.** Use `woodrail.settled()`, `!director.busy`, a toast's `.show` with its transform settled, and train speed above 0. Headless frames can take seconds.

**Shake out flakes:** run three `e2e:touch` at once, plus one busy-looping core.

**Make e2e setups independent of the view.** Place pieces on open ground, searching outward from controls.target, at least 700 mm from pieces and 400 mm from props. Frame them with `glideTo(..., frameDistance(...))`, and confirm the view is there before tapping.

**Idle frames.** `woodrail.framesDrawn` counts on-screen frames; `renderer.info.render.frame` also counts thumbnail renders. A still game should add about 0. Stub `boats.update` when counting.

**Perf.** `tools/perf/idle-cpu.mjs` samples the Chromium tree's CPU, but it never starts a game. In SwiftShader one frame costs about 6 CPU-seconds, so report frames alongside CPU. An idle Game draws about one frame per 15 s while a depot pile in view grows. That's legitimate.

**Measure before and after**, with the numbers in the commit message.

## 3. Design rules not to break

**Toast placement** (hud.ts, toast-room.ts):
- Placed only on show or refit, never per frame. It's placed by layout (offsetTop and offsetLeft), not by its box (TOAST_SLIDE).
- It goes under whatever is pinned below the top bar. Goals hidden with visibility: hidden don't count.
- It clears the tray by `toastFloor`, and the clamp never lifts it into the goals (`toastAbove`).
- A docked card: beside it at full width, then nearer the goals (down to 8 px below them), then narrower to its left (down to 200 px, `besideNarrower`). After that, over the card (`overCard`), covering the fewest controls, with Go counting most.
- The map view: `clearSpot` (the middle, the sides, then next to each label, with widths stepping down 15% to 220 px). Then `leastCovered`, where a badge counts more than a label.
- It refits once the map view has been still for 100 ms and 3 ticks (MAP_STILL_MS, MAP_STILL_TICKS), and when a card resizes.
- While the map takes taps (`setMapTaps`), the toast has pointer-events: none.
- `withdrawToast` takes back a toast whose cause was undone.

**The card tap guard** (card-settle): a tap is dropped only if the button under the finger moved more than 6 px (or first came into place) within 150 ms. Never drop on a resize alone: a dead-end card reflows while Continue stays put. The engine card's route and rows go in synchronously as it opens (`onEngineCardShown`).

**The canvas ResizeObserver** (game.ts): resize when the canvas's client size differs from the last size applied. iOS Safari's toolbars change the box without a resize event. Keep it change-only.

**MIN_PITCH 0.45** (game.ts): the cap applies to mouse, touch and keys. The map view (MAP_PHI 0.22, `steepAllowed`) and director glides may go steeper; closing the map without its glide eases up to the cap.

**FOV is fixed at 30° vertical** for every aspect. A change would mean moving everything keyed on distance (zoom limits, detail levels, the near plane, focus distances, the shadow radius) to an equivalent distance. That was rejected as too costly.

**Glides** go by real elapsed time, with the first step after `glideTo` capped at dt.

**Accepted limits:**
- A six-line toast covers Go at 740×360.
- At 740 and 667, toasts of three or more lines sit under the goals and over the card.
- Depot pile frames in the map view stay.

**Pin hints:** `undoPin` restores PinHint's state and withdraws its toast.

## 4. Open items
- Map depot-pile frames (accepted).
- idle-cpu.mjs should start a game and report frames.
- Confirm the canvas fix on a real iPhone.

## 5. Gotchas
- Don't edit files in a worktree while e2e runs there (Vite hot-reloads).
- Temporary scripts go inside the worktree (scripts/.x.mjs) so they can import playwright-core and vite. Delete them afterwards.
- Use `bash -c` with && chains; write commit messages to a file and use `git commit -F`.
- ResizeObserver callbacks arrive only with a rendering update. Wait for conditions.
- **Tapping a card button that has just shown** (e2e): wait for `frames(p)` and then more than `CARD_MOVED_MS` before the tap. A button shown in the DOM may not have been drawn yet: under SwiftShader the next frame can be seconds away. A tap sent before then lands just after the frame that first lays the button out, and the card tap guard drops it, correctly (#19, the dead-end Continue).
- TypeScript-private fields are reachable from page JS, but prefer public paths in tests.
- Check computed visibility, not offsetParent. position: fixed elements have a null offsetParent.
- Spies on hud.toast: start each section with its own list.
- Under load, an earlier check's late gesture can move the view or pin a switch. Reset the state you assert on just before acting.
