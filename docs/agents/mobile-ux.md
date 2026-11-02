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
- `e2e:locked` (about 6 min): locked tiles' note and Show in Research, the tray tabs' fit at 360 px (with Roads too), the town card on its side (two columns, ✕ top right, no scroll);
- `e2e:draw` takes more than 1.5 h; run it by group with E2E_ONLY.
- Run long jobs in the background with a log, then grep the log.

**Touch timing.** Send touches with CDP `Input.dispatchTouchEvent` and explicit timestamps. Hold and pin are decided by event time (decideHold), not by when an event arrives. Hold is 380 ms, pin 450 ms, HOLD_SLOP 10 px and BRANCH_SLOP 7 px.

**Wait on conditions, not sleeps.** Use `woodrail.settled()`, `!director.busy`, a toast's `.show` with its transform settled, and train speed above 0. Headless frames can take seconds.

**A tap can arrive seconds late.** At 390×844 with deviceScaleFactor 2, SwiftShader takes 3–5 s for one frame of the map, and a tap sent meanwhile is handled after it (e2e:stickers: 8 s, with 27 ms of script in the frame). A toast's time (4–5 s) can run out first, and the tap falls to the map. To tap a toast, keep it up longer in the harness (e2e:stickers wraps `hud.toast` for the one it taps), and say so as a named shortcut. To tap a car, aim with the game's own pick (`interaction.pick(x, y, true)`) where the canvas is on top, after the view has stopped (e2e:train-summary `tapPointOn`).

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

**The engine card shows all its controls (no ⋯):** Follow and ✕ in the corners; status and summary; Go (as wide as the row under it) and the way arrow; Continue under them when it shows; then Swap ends, Decouple and Remove, always (they were behind a ⋯ toggle, a tap more than the user wanted; nothing else was behind it, so the ⋯ is gone). Upright the card sits above the tray as before, 54 px taller. On a phone on its side (`max-height: 520px`) it keeps its own width at the right (also at 640 px, where it used to span the screen) and may come down over the tray, as the cloud card does, so it all shows without a scroll at 360 px tall; with no route yet, "Plan a route" goes under the row alone (the old row-wrap that put it beside Go made the card ~590 px wide, which `viewRoom` and `keepClearOfCard` took for a card at the bottom, so the train was left under it). A docked card must keep its left edge past 40% of the screen (and 200 px) for the map's room to be beside it. e2e: `train-card` in `npm run e2e:touch` (360×640 both ways; moving, Swap ends and Decouple greyed, stopped, back; then Swap ends, Decouple and Remove each do their job).

**Card buttons that would only be refused are greyed, not hidden:** Swap ends and Decouple (engine card) and the wagon card's Decouple get `aria-disabled` while the sim would refuse them (`Sim.runAroundRefusal` / `decoupleRefusal`, the same checks `runAround` and `decouple` make: moving or on a turning deck, or nothing coupled), with why as the tooltip ("Stop the train first", a long press on a phone); a tap does nothing (`button()` skips aria-disabled). The look is the top bar's disabled one, solid wood with faded words (`.card .chip[aria-disabled]`), not see-through. Main's `showRefusals` keys on car and refusals, so the buttons are touched only as the train starts or stops. Remove is never refused, so it stays. Swap ends on an engine alone only turns it, allowed moving; no room at the far end is known only by trying, so that one stays a toast.

**The canvas ResizeObserver** (game.ts): resize when the canvas's client size differs from the last size applied. iOS Safari's toolbars change the box without a resize event. Keep it change-only.

**MIN_PITCH 0.45** (game.ts): the cap applies to mouse, touch and keys. The map view (MAP_PHI 0.22, `steepAllowed`) and director glides may go steeper; closing the map without its glide eases up to the cap.

**FOV is fixed at 30° vertical** for every aspect. A change would mean moving everything keyed on distance (zoom limits, detail levels, the near plane, focus distances, the shadow radius) to an equivalent distance. That was rejected as too costly.

**Glides** go by real elapsed time, with the first step after `glideTo` capped at dt.

**Accepted limits:**
- A six-line toast covers Go at 740×360.
- At 740 and 667, toasts of three or more lines sit under the goals and over the card.
- Depot pile frames in the map view stay.

**Train summary (#9):** the engine card's summary sits under the status, two lines at most, each `nowrap` with an ellipsis: "4 cars · steady · Red line", then what's on board by good in cargo order, riders last ("🌲 12 · 🪵 4 · 🧑 3", "Empty"; more than four kinds: three and "+n more"). Text from `trainSummary` / `loadWords` in `src/game/train-summary.ts`; a line name over 12 characters is left out. Speeds are words (`speedWord`, `SPEED_WORDS`), by the slowest engine's `speed` against the classic's: "slow" (goods 0.8), "steady" (classic, tank), "quick" (diesel, electric), "fast" (express); a train too heavy to move says none. The wagon card has a load line from `carLoadWords` ("🌲 Logs: 2 of 3", "Empty (carries logs, planks, iron)", "🧑 3 of 6 seats"). Both are set by main's `showSummary`, keyed by the car, `Economy.loadsVersion` (bumped by `setCargo` and `setRiders`), the train's make-up (length, end cars) and the line's name: never rebuilt per frame. Loads on the wagons in 3D were already there (depot-view's wagon units and hopper heaps). e2e: `npm run e2e:train-summary` (360×740, about 8 min: the crane is slow headless).

**Who's in the way (Show):** every waiting or stuck engine card names its blocker and can show it. One helper feeds both: `engineView` (`src/game/engine-status.ts`) works out `trainState` once and gives the status line and `blocker` (`blockerOf`: the `by` each wait already carries, from sections' waits, `Router.waitOf`, `Sim.heldBy`/`Sections.clearWait`, stalls.ts, and `Sections.spareOn` for a train standing on a full line's loop road). Names (`blockerName`): by its line ("the train on the Blue line"); else by where it is (main's `trainPlace`: the nearest town or stop within 900 mm, names ≤ 14 chars) and how it stands: "the train parked by Elder" (lever off), "the train stopped by Elder" (lever on, held by something), "the train by Elder … It has no route" (running by hand); with no place near, "a parked train", "a stopped train", "a train with no route". Never an id. A lever-on train in a ring with this one is named as running (it waits on us too), and a train turning back or at a stand a moment while it changes way is running, not stopped. The card's `.engine-blocker` row: **Show** (pans with `glideTo(..., inRoom)` to the blocker, framing the points too for a points wait, or just the points for a red switch; lets go of Follow). (Its **Put it away** went on 2026-11-01: beside Remove it read as this train's. The player taps the blocker and uses its own card's Remove, or picks it up; the status line says the fix.) The flash is `Game.flashBlocker`: a flourish (2.4 s, three pulses) setting `TrainView.setFlash` (shell level 3, coral, the opacity eased: no geometry touched) and outlining the points ("blocked" tone) only if nothing else is outlined; it ends by itself, then one frame and 0 after. The row goes with the status *shown* (held 600 ms with it). **"A train not on the line"**, the old text, meant a train on no line (no route) with its lever on: a hand-run engine the player Go'd and forgot, running or standing; lever off it was "a parked train". e2e: `E2E_ONLY=blocker npm run e2e:touch` (360×740: a Red line train behind an engine left parked on its track; the card names it in 2 lines, Show ≥ 44 px and no Put it away; Show glides there and flashes it; 0 frames after; the parked engine tapped and its own Remove, and the Red train delivers).

**Locked tray tiles** (hud.ts `lockedTap`, main's `lockOf`, `unlockHow` in research-text.ts; the Signal mark too, till Signals is learned): a tap or click on a tile with the Locked badge shows `.lock-note` over it (how to unlock it, and Show in Research → `setBoardOpen(true, jump)`), never a pick-up. `jump` is only a blueprint the picker shows (`seenOf` "shown"): never a "?". The note goes with a tap elsewhere, a scroll of the shelf, a tab change, Escape or 9 s. Hover: the tooltip's `.tip-lock` line (`data-tip-lock`, set in `decorate`).

**Tray tabs' fit** (hud.ts `fitTabs`): Game mode only, all tabs with an `icon` (tray-catalogue). Steps: none, `short` (tabs not open as pictures), `icons` (all). Measured on a tab opening and by a ResizeObserver on the head and the tools, never on the tabs (a fit changes them: that would loop).

**The town card on its side** (`max-height: 520px`): a grid of two columns; the ledger is `display: contents` and its `.ledger-main` / `.ledger-side` (town-ledger.ts; `display: contents` upright, so the upright card is unchanged) are the columns. The ✕ is `grid-column: auto` so it's placed by the card's edges.
**No swipe Back; Fullscreen** (`src/ui/swipe-guard.ts`, `src/ui/fullscreen.ts`):
- A sideways swipe never navigates: `overscroll-behavior: none` on html, body and the tray (`contain` on the other scroll boxes, which stops navigation too), `touch-action: none` on the canvas, and a window wheel listener (non-passive) that cancels every mostly-horizontal wheel and scrolls the sideways box under it (the tray, the research web) by hand. Safari on a Mac swipes back on an uncancelled horizontal wheel whatever the CSS says. The canvas's wheel stays Interaction's (it cancels them all). A trackpad pinch (ctrlKey) is left alone.
- History guard, top-level pages only: one entry pushed after the first tap or key (so Chrome doesn't skip it), re-pushed on a Back that lands under it. Never in an iframe (the Artifact, itch.io): it would eat the host page's Back.
- Can't be prevented: iOS Safari's edge swipe and Android's system back gesture belong to the browser or OS. On a top-level page the guard keeps the game there; in an iframe nothing does.
- Fullscreen: a wide-only top-bar chip (`.fullscreen-btn`, 44 px) and a narrow-only menu item ("Fullscreen" / "Leave fullscreen"), both shown only if `fullscreenAvailable()` (`fullscreenEnabled`, or the webkit one): hidden on iPhone Safari and in an iframe without allow="fullscreen". The claude.ai Artifact iframe has `allow="fullscreen"` and `allowfullscreen` (checked in the viewer), with no `allow-popups`, so "open in its own tab" isn't possible there. Icons follow `fullscreenchange` (Esc too). The canvas resizes through its ResizeObserver: no frames after it settles. e2e: `npm run e2e:click` ("fullscreen, and a sideways wheel" and the touch section).

**Pin hints:** `undoPin` restores PinHint's state and withdraws its toast.

**Names and details** (`src/ui/piece-info.ts`, #10 and #12):
- `pieceInfo(type)` names every catalogue piece (a unit test fails for a new piece without a name, so a new piece type needs a line there) and says what it does. The piece card shows the name as its title and the detail under it (`.piece-detail`). Props, scenery and groups have no detail.
- A name holds its tray label ("Long" → "Long straight"); the tray tiles keep their short labels.
- Details are at most `DETAIL_MAX` (64) characters: two lines of the card at 360 px. Engines' come from `ENGINES` (pulls, speed, power), wagons' from `CARRIES`.
- **The tray's long press** (`Hud.trayPress`): a finger held `TRAY_INFO_MS` (450, as a pin) on an item shows its details in the tooltip, pinned; nothing is picked up, scrolled or tapped until it lifts, and they stay up 2.5 s after. Decided by event time: the timer shows them, and a late move past the slop or a lift with a timestamp before 450 ms takes them back (`undoDetails`) and is a drag, scroll or tap. Shelves (tray groups) have no long press.
- **Hover** (a mouse): the tooltip shows the name, the detail and the title's how-to. On touch a lift fires `pointerout`: the tooltip ignores it while pinned.
- **The place card** (#12, `Hud.showPlaceCard`, text from `placeCardInfo` in piece-info.ts): while a tray item is ready to place (clicked with a mouse or pen, or a road tapped) a cream card sits above the tray and its tools, over the item: the name, what it does, then facts (an engine: "Pulls 4 cars · steady", its speed word from `speedWord`, and its key stat from `engineKeyStat`; an industry: `recipeWords`, "Makes planks from logs · every 8 s"; a Game-mode `gameDetail`). `pointer-events: none`: the map under it takes the drop. Shown from the tray tap (`tapTrayItem`), never per frame; it goes on `setArmed` to anything else, a tab change, or the first thing put down (`trayPlaced`, from main's `onPlaced` and `onTrayTrainDropped`). On touch, a tap that makes nothing ready (a piece, a train) shows it 3.5 s (`PLACE_CARD_MS`). A locked tile's tap or click shows its lock note instead (`lockedTap`, below): one card at a time, each hides the other. The hover tooltip stays off an item with its card up (`.has-card`). A click on the item hides the tooltip by design (mouse pointerup): that, not a regression, was why a clicked Engine showed nothing before. e2e: `npm run e2e:click` (desktop piece, Game-mode Engine, a locked engine's note in its place, touch tap, road, long press).

## 4. Open items
- Map depot-pile frames (accepted).
- idle-cpu.mjs should start a game and report frames.
- Confirm the canvas fix on a real iPhone.

## 5. Gotchas
- **A hold decided by event time, on a busy page:** under SwiftShader a press can be handled seconds after its stamp, and an unstamped CDP move sent next is stamped then: by stamps alone it was "held". The tray's long press (`trayPress`) counts the hold from the press's stamp or from when the page saw it, whichever is later (`heldFor`), so a flick out of the tray still picks up (e2e:touch `flick`). Do the same for any new hold.
- Don't edit files in a worktree while e2e runs there (Vite hot-reloads).
- **Measure a card's buttons once it has popped in.** `card-in` scales the card from 0.96: a box read mid-way under SwiftShader is 0.96 of its size (42 px for a 44 px chip). Wait for `card.getAnimations()` to finish, and check `offsetHeight` too.
- **Two trains started on one tick at the same points** race: the router's routed and hand-run looks come round on counters of their own, phased by everything that ran before, so the winner changes with the run order. Start them in a stated order (`hand-wait`, `wait`).
- `pgrep -f <script>` in a wait loop matches the loop's own command line: wait on a log line instead.
- **The focus ring and the game's keys:** Chrome's `:focus-visible` turns on for a clicked button at the next key press, and the game takes keys (the camera, shortcuts), so a clicked tab grew a ring. The ring is drawn only under `.kbd-nav` (set by Tab, cleared by a pointer press: `src/ui/focus-ring.ts`) and inset (`outline-offset: -3px`) so a scrolling strip can't clip it. Don't add a control-specific `:focus-visible` outline; the global rule covers every control (`e2e:focus-ring`).
- **Headless, an idle page may not tick a CSS transition along:** a tab's background can stay part-way after a click. `document.getAnimations().forEach((a) => a.finish())` before a screenshot.
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
