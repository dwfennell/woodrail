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
- `e2e:names` (24 checks, about 12 min): a long press on a tray item shows its details and starts no drag; a quick drag still takes it out; the piece put down, tapped, opens its card named, with its detail in two lines; hover on desktop;
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

**Train summary (#9):** the engine card's summary sits under the status, two lines at most, each `nowrap` with an ellipsis: "4 cars · 40 km/h · Red line", then what's on board by good in cargo order, riders last ("🌲 12 · 🪵 4 · 🧑 3", "Empty"; more than four kinds: three and "+n more"). Text from `trainSummary` / `loadWords` in `src/game/train-summary.ts`; a line name over 12 characters is left out. Speeds are toy km/h: the classic engine is 40 (`CLASSIC_KMH`), the others by their `speed`; a train too heavy to move says none. The wagon card has a load line from `carLoadWords` ("🌲 Logs: 2 of 3", "Empty (carries logs, planks, iron)", "🧑 3 of 6 seats"). Both are set by main's `showSummary`, keyed by the car, `Economy.loadsVersion` (bumped by `setCargo` and `setRiders`), the train's make-up (length, end cars) and the line's name: never rebuilt per frame. Loads on the wagons in 3D were already there (depot-view's wagon units and hopper heaps). e2e: `npm run e2e:train-summary` (360×740, about 8 min: the crane is slow headless).

**Who's in the way (Show):** every waiting or stuck engine card names its blocker and can show it. One helper feeds both: `engineView` (`src/game/engine-status.ts`) works out `trainState` once and gives the status line and `blocker` (`blockerOf`: the `by` each wait already carries, from sections' waits, `Router.waitOf`, `Sim.heldBy`/`Sections.clearWait`, stalls.ts, and `Sections.spareOn` for a train standing on a full line's loop road). Names (`blockerName`): by its line ("the train on the Blue line"); else by where it is (main's `trainPlace`: the nearest town or stop within 900 mm, names ≤ 14 chars) and how it stands: "the train parked by Elder" (lever off), "the train stopped by Elder" (lever on, held by something), "the train by Elder … It has no route" (running by hand); with no place near, "a parked train", "a stopped train", "a train with no route". Never an id. A lever-on train in a ring with this one is named as running (it waits on us too), and a train turning back or at a stand a moment while it changes way is running, not stopped. The card's `.engine-blocker` row: **Show** (pans with `glideTo(..., inRoom)` to the blocker, framing the points too for a points wait, or just the points for a red switch; lets go of Follow) and **Put it away** for a blocker not running a line (`putAwayFromCard(car)`, one undo step). The flash is `Game.flashBlocker`: a flourish (2.4 s, three pulses) setting `TrainView.setFlash` (shell level 3, coral, the opacity eased: no geometry touched) and outlining the points ("blocked" tone) only if nothing else is outlined; it ends by itself, then one frame and 0 after. The row goes with the status *shown* (held 600 ms with it). **"A train not on the line"**, the old text, meant a train on no line (no route) with its lever on: a hand-run engine the player Go'd and forgot, running or standing; lever off it was "a parked train". e2e: `E2E_ONLY=blocker npm run e2e:touch` (360×740: a Red line train behind an engine left parked on its track; the card names it in 2 lines, Show and Put it away ≥ 44 px; Show glides there and flashes it; 0 frames after; Put it away, and the Red train delivers).

**Pin hints:** `undoPin` restores PinHint's state and withdraws its toast.

**Names and details** (`src/ui/piece-info.ts`, #10 and #12):
- `pieceInfo(type)` names every catalogue piece (a unit test fails for a new piece without a name, so a new piece type needs a line there) and says what it does. The piece card shows the name as its title and the detail under it (`.piece-detail`). Props, scenery and groups have no detail.
- A name holds its tray label ("Long" → "Long straight"); the tray tiles keep their short labels.
- Details are at most `DETAIL_MAX` (64) characters: two lines of the card at 360 px. Engines' come from `ENGINES` (pulls, speed, power), wagons' from `CARRIES`.
- **The tray's long press** (`Hud.trayPress`): a finger held `TRAY_INFO_MS` (450, as a pin) on an item shows its details in the tooltip, pinned; nothing is picked up, scrolled or tapped until it lifts, and they stay up 2.5 s after. Decided by event time: the timer shows them, and a late move past the slop or a lift with a timestamp before 450 ms takes them back (`undoDetails`) and is a drag, scroll or tap. Shelves (tray groups) have no long press.
- **Hover** (a mouse): the tooltip shows the name, the detail and the title's how-to. On touch a lift fires `pointerout`: the tooltip ignores it while pinned.

## 4. Open items
- Map depot-pile frames (accepted).
- idle-cpu.mjs should start a game and report frames.
- Confirm the canvas fix on a real iPhone.

## 5. Gotchas
- **A hold decided by event time, on a busy page:** under SwiftShader a press can be handled seconds after its stamp, and an unstamped CDP move sent next is stamped then: by stamps alone it was "held". The tray's long press (`trayPress`) counts the hold from the press's stamp or from when the page saw it, whichever is later (`heldFor`), so a flick out of the tray still picks up (e2e:touch `flick`). Do the same for any new hold.
- Don't edit files in a worktree while e2e runs there (Vite hot-reloads).
- Temporary scripts go inside the worktree (scripts/.x.mjs) so they can import playwright-core and vite. Delete them afterwards.
- Use `bash -c` with && chains; write commit messages to a file and use `git commit -F`.
- ResizeObserver callbacks arrive only with a rendering update. Wait for conditions.
- **Tapping a card button that has just shown** (e2e): wait for `frames(p)` and then more than `CARD_MOVED_MS` before the tap. A button shown in the DOM may not have been drawn yet: under SwiftShader the next frame can be seconds away. A tap sent before then lands just after the frame that first lays the button out, and the card tap guard drops it, correctly (#19, the dead-end Continue).
- TypeScript-private fields are reachable from page JS, but prefer public paths in tests.
- Check computed visibility, not offsetParent. position: fixed elements have a null offsetParent.
- Spies on hud.toast: start each section with its own list.
- Under load, an earlier check's late gesture can move the view or pin a switch. Reset the state you assert on just before acting.
- **Tapping a piece in an e2e:** track is picked only from close by (`withinReach`: 144 mm ≥ 54 px). At `frameDistance(450)` on a phone it's borderline. Frame at 300 or so, and check the view got there (the game's opening glide can take over a glide sent too soon).
- **After a tray drop** the next piece waits at its end ("tap anywhere else to stop"): the first tap on the map only stops it. Tap open ground first.
- **Dropping from the tray in an e2e:** the held piece rides above the finger, and the ghost's `blocked` is read a frame late. Move until two reads in a row are clear, then lift.
