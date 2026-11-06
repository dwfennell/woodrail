# Signals audit (2026-11-06)

A broad, independent look at signals: block working, routes, saves, placing, cards and how they read on a phone. It
was written alongside two other sessions:

- **`claude/signal-pairs`** (the signals author): sets that move and go together. It also fixed two bugs this audit
  found too (B1, B2).
- **`claude/shared-line-turns`**: report 2's wait, and "waiting for &lt;train&gt;" on the engine card.

This branch (`claude/signals-audit`) is built on `claude/signal-pairs` a04fc68.

The user's reports, and where each stands:

| # | Report | Root cause | Where it's fixed |
|---|---|---|---|
| 1 | A train just past a pair, yet the post facing trains coming shows green | B1: a pair's partner emptied its block | `claude/signal-pairs` e0ab738 |
| 2 | The green engine with 3 vans waits at the pair before the mill | B4: sections never give it the mill's stretch (a train on an unmanaged line circles there) | `claude/shared-line-turns` |
| 3 | Pairs don't move together; the preview shows one post | (UI) | `claude/signal-pairs` |
| 4 | No way to remove signals | (UI; see U5: the card needs a long press) | `claude/signal-pairs` (Remove on the card) |
| 5 | Do the lights change realistically? | See "Realism" below | — |

## Bugs

### B1. A pair's partner emptied its block: both posts always green (report 1). Fixed on `claude/signal-pairs`

- **Repro:** a straight line, a pair on one joint, a train standing on the piece just past it.
  - `sim.signalBlock` of the post facing the train is `[]`.
  - `markClear` is true.
  - A second train runs on in, held only by `followCap`.
- **Root cause:** `Sim.findBlock` ended a block at "a mark facing back at this joint" (`marksAt.has(next)`). At the
  signal's own joint, that's the pair's partner, so every paired signal's block was empty. `pathFor` broke at n=0 the
  same way.
  - On the user's mill map, **36 of its 37 signals had empty blocks.**
  - The tint (`signal-place.ts` `reach`) never had this bug, so it showed a block the sim ignored.
- **Why the tests missed it:** `harness-fuzz.test.ts` lays lone marks only, never pairs. Its `redRun` and `blockOne`
  read `sim.signalBlock`, so an empty block broke nothing.
- **Tests:**
  - `src/sim/signal-aspects.test.ts` (signal-pairs).
  - Here: `src/sim/signals.test.ts` "a pair on one joint" (a train stops at the pair's red and goes when the block clears; a pair before points is a path signal).
  - `src/play/bugmaps/signals-mill.test.ts`: every signal's block on the user's map is its tint's.
  - The new fuzz (below), which fails on main.

### B2. A signal placed while paused (or a save loaded paused) showed green till the game ran. Fixed on `claude/signal-pairs`

- **Repro:** a train standing on a line, the game paused, a signal placed behind it: `markClear` is true until a tick.
- **Root cause:** aspects were worked out only in `tick()`, and default to clear.

### B3. A pair in a line end before points: two trains of a line stuck for good. Fixed here

- **Repro:** fuzz seed 11 with pairs (`signal-fuzz.test.ts` "cases it found").
  - Layout: a shuttle from a forest, a pair at 2|3, points, a passing loop, points, a pair at 12|13, a forest; two trains on one line.
  - Result: 1 stop each in 5 minutes, against 25 without the signals; stalled "signals".
- **Root cause:**
  - The train in the line end stands at the pair's red. The block beyond has points in it, so it's a path signal, clear only once the router has the train's way locked.
  - The router locks only after sections grant the move.
  - Sections let a train ask for its move only when it nears its slot's end (`ASK_LOOK`), here about 216 mm past the signal.
  - So it never asked. The line's other train waited in the loop for that line end.
- **Fix:** `Sections.capOf` lets a train standing at a red short of its slot's end ask from there. It's the same move it would ask for a few hundred mm later, so it's no less safe. A signal held by hand doesn't count: by spec §3.3, a train there holds nothing ahead.
- **Test:** the seed-11 case fails without the fix and passes with it.

### B4. Report 2: the mill wait. Diagnosed here, fixed on `claude/shared-line-turns`

- **Repro:** the user's map, `src/play/bugmaps/signals-mill-wait.txt`.
  - Train 196 (engine #44, 3 vans, Yellow line) stands at the pair 220|221, in the waiting point (signal slot) of mark 221.1.
  - It waits on `{ kind: "section", engine: 48 }` for 10+ minutes.
  - With every mark removed it leaves at once and runs its route.
- **Root cause:**
  - Engine #48 (hoppers, line 4: farm 120 ⇄ mill 124) goes round a small ring without stopping: 120 → 122 → points 206 → mill 124 → points 150 → 153 → … → 140 → 120.
  - The Yellow line joins that ring at points 206, going the same way, and follows it round past the farm.
  - Line 4 has no loop of its own, so sections don't manage it, and for lines 1–3 its train is "foreign".
  - `Sections.zoneOf` keeps a managed line's trains out of a running foreign train's section and the next two regions ahead.
  - The signals cut the ring into short slots and sections (2 waiting points, 2 sections), so the zone covers the mill's section nearly always.
  - Without signals, the Yellow train stood mid-section with nothing to ask and simply followed the sim's rules. The pair made a waiting point right at the junction, so now it must ask, and it is never granted.
- **Tried here and reverted:**
  - Ending the zone at a facing signal the foreign train can still stop for, and showing that signal red while a granted move is beyond it.
  - That freed the mill's section, but the Yellow train's way runs on round the ring behind the hopper train, into slots the zone still covers.
  - The real fix is a sections rule for sharing a ring with an unmanaged line, which `claude/shared-line-turns` owns.
- **The red the user saw** at 221.1 came from `signalGate` (sections' waiting-point gate), not the block: the block was empty (B1). So the green the user expected ("the way is clear") was true of the track. The card said only "Waiting at a red signal" (U3).

### B5. A signal inside a passing loop's road: two trains stuck, each tail on the other's points. Not fixed: a decision

- **Repro:** fuzz seeds 14, 33 and 38 with pairs (`SIGNAL_FUZZ=60 SIGNAL_FUZZ_SECONDS=600`).
  - Seed 14: a pair at 9|10 on road 8-9-10 and a lone signal at 6.1 on road 6-7. Two trains of one line.
  - Each is granted a move into a loop road, and is stopped by the signal inside it before it is wholly on the road.
  - t4's tail stands on points 5 and t5's across points 11 and 12. Each waits for the other.
  - Stall "signals": 0–1 stops against 24–25 without.
- **Root cause:** sections grant a move into a road expecting the train to run to the road's far end. The sim's block working stops it at any red on the way, wherever its tail is.
- **Options (pick one):**
  - **(a) Placing:** refuse a signal on a joint inside a passing loop's road. The toast would say "Trains pass each other here: a signal would stop them on the points". It's simple and the rule is easy to see.
  - **(b) The sim:** a line's train with its move granted into a road passes signals inside that road. Sections already keep a road to one train. Signals there would keep working for hand-run trains. It's more forgiving but invisible.
  - **Recommendation: (a).** A signal inside a loop does nothing useful for a line, and a toy that refuses with a reason is easier to learn from than one that quietly ignores the signal.

### B6. In a ring of signals, the stuck trains said only "Waiting at a red signal". Fixed here

- **Repro:** an oval with 2 signals and 3 trains (`engine-status.test.ts` "at a ring of signals"). Stalls says all three are stuck, kind "signals".
- **Root cause:** `trainState` checked `atRedSignal` before the stall checks. So "Stuck: too many trains for these signals. Add a signal" reached only the one train not standing at a red.
- **Fix:** at a red that stalls says is stuck, the stuck card wins.

### Checked and found sound

- **Modes:** Always red (`held`) and Always green (`forced`: no block, the router's locks and gate still hold).
- **Turntables and lifts:** signals on a lifted piece are skipped; decks hold like a red.
- **Old pieces:**
  - Old signal pieces (`legacyPiece`) are block boundaries on the piece.
  - Old saves with lone marks are unchanged: B1's fix touches only a mark's own joint.
- **The dead-end rule and #29:** untouched. No breaks in the fuzz.
- **The default before an aspect is worked out:**
  - Plain blocks: green (B2 fixed the stale case).
  - Path signals: red with no train coming, worked out for the nearest train coming. See Realism.

### Note for old saves

Pairs placed before B1's fix did nothing. Now they work, so a player's ring with more trains than blocks will stand and say "Stuck: too many trains for these signals". That is right, but it will be new to those players. The fuzz found 15 ring seeds that do this with 1–4 pairs on a ring of 2–4 trains.

## The fuzz (`src/routing/signal-fuzz.test.ts`)

- **Layouts:** signals laid as a player lays them over the routing harness's line and ring fixtures. Pairs on plain joints four times in five, else a lone post facing either way.
- **Checked every tick, against blocks worked out apart from the sim (the tint's `blocksOf`):**
  - **greenOnTrain:** a plain block's signal is never green for 2+ ticks with a train on its block.
  - **redForNothing:** no train stands at a plain block's red for 2+ ticks with its block clear of other trains, not held, and no grant it waits for.
  - Every harness invariant (`redRun`, `blockOne`, `deadlock`, …).
  - A stall only with a signal ring, or where the seed stalls without signals.
- **Reported, not checked:** the longest wait for a grant at a clear block (report 2's pattern). It's 0 s on every seed so far.
- **In the suite:** 8 line + 8 ring seeds × 4 min (about 20 s), plus the seed-11 case.
- **Long run:** `SIGNAL_FUZZ=60 SIGNAL_FUZZ_SECONDS=600`.
  - All checks hold.
  - 21 seeds stall with signals where they don't without: 15 rings (rightly: more trains than blocks), 6 line layouts.
  - Of the 6 line layouts: B3 (11, 42, 58, fixed) and B5 (14, 33, 38, open).

## UX

The pictures are 390×844 @2x, from the high angle a player holds:

- `docs/agents/shots/signals-audit-1-mill-wait.jpg`: report 2's scene.
- `docs/agents/shots/signals-audit-2-mill-pair-close.jpg`: the pair up close.
- `docs/agents/shots/signals-audit-3-mill-card.jpg`: the waiting engine's card.
- `docs/agents/shots/signals-audit-4-pairs-zoomed-out.jpg`: the area zoomed out.

To take them again: `node tools/shots/signals-audit.mjs <map file>`.

The review used the impeccable critique (a design review, plus the detector, which can't see the game's runtime-built cards and found nothing on signals). Nielsen total: 24/40. The weakest scores are system status (1) and recognition over recall (1).

### U1. The aspect can't be seen from above (P0)

- The lenses are vertical discs on the head's face (`signal-marks-view.ts`, the colour-light lenses).
- From the high angle a player sees the black top of the head and its cream knob. In shot 2 neither lamp of the pair shows. Zoomed out (shot 4), the reds are 2–3 px specks and the greens can't be told from the grass.
- **Fix, cheap:** make the knob on top the lamp: a lit cap facing up, red or green, in the same two `MeshBasicMaterial` batches (instance moved between them as the lenses are). That's no new draws and no lights. Make it about 1.5× wider, and tilt the lenses about 30° up.

### U2. Which way a signal faces, and which post of a pair is which, can't be read (P1)

- A pair is two identical black boxes. The back of one looks like the front of the other.
- **Fix:** a small flat wooden chevron on the sleeper in front of each post, pointing the way it guards and tinted with its aspect. It's one instanced quad, and a toy says "this side" with shape, not words.
- The card's title "Signal: guards this way →" uses a screen arrow that doesn't relate to the track. Point it as the chevron does, or drop it.

### U3. Why a train waits: the card is a dead end (P1)

- "Waiting at a red signal" doesn't say which signal or what it waits for. Next to the engine, the post shows no red (U1).
- In report 2 it waited for the hopper train going round the mill, which nothing on screen says.
- **Fix:**
  - "Waiting for the line ahead: the Brown line's train is on it", with a Show chip that glides to the signal and opens its tint. `claude/shared-line-turns` is adding "waiting for &lt;train&gt;".
  - While a waiting train's card is open, tint the block holding it. The tint exists (`showTint`).

### U4. The block is invisible except while its card is open (P2)

This is spec decision 6, and it stays right for a cosy game. U3's tint on a waiting train's card shows it at the one moment a player wonders why.

### U5. A tap holds; the card needs a long press (P1, the coordinating session asked)

- Every other piece opens its card on a tap. A signal toggles Held at red on a tap and opens its card only on a long press. That is why "no way to remove signals" (report 4) happened: Remove was on a card players never found.
- **Recommendation: a tap opens the card**, as everywhere else, with "Hold at red" on it.
  - Always red is already the first-row mode chip, so holding stays one tap from the card.
  - Kids lose the one-tap toy. The card's mode chips are big (52 px) and show lamps, so it's two taps.
  - If the one-tap hold must stay, a short toast on the first tap ("Held at red · Tap again to let go · Hold for its card") at least teaches the long press.

### U6. The card's details (P2)

- **Mode chips:**
  - The selected mode is a green fill whatever the mode, so "Always red" chosen shows green.
  - Selected and unselected differ by hue only (1.62:1).
  - **Fix:** the cream selected state with a check or outline.
- **Too-short warning:** "Too short for a train to wait here" is in `.card-hint` `#8a6a4a` on `#faf3e6` (4.49:1, under 4.5), too faint for a warning. Use `warn-ink`.
- **Style:** "Style" cycles three looks blind: "Look: Lamps ▸", or a picker.
- **Accessible names:** each chip's `aria-label` is its long description, so "Auto" is announced as "Red while a train is on the line ahead…" (WCAG 2.5.3). Put the description in `title` or `aria-description`.
- **Six controls** on one card. Turn round and Style could share a row.
- **Live aspect:** the card doesn't show whether the signal is red or green now.

### Realism (report 5)

- **What the lights do now:**
  - **Plain blocks** are two-aspect, as most simple real signals are: red while a train is in the block, green otherwise. That is realistic, and they now change at the right moment (B1, B2).
  - **Path signals** (points in the block) rest at red and clear for the train coming once its way is set and locked. That is like real "approach-released" junction signals, but beside a plain one resting green it looks inconsistent.
- **Options:**
  - **Keep it:** say it on the card ("Red until a train's way through the points is set").
  - **Show them green at rest** when the way as the points lie is free. That is closer to what a player expects, and the path check still holds the train.
  - **Recommendation:** green at rest.
- **Out of scope for a cosy toy:** there is no yellow (caution) aspect and no distant signals. Neither is needed.

## Fix list

**Now, done on this branch (or on the other branches):**

1. B1 and B2: `claude/signal-pairs`.
2. B3: the train at a red in its line end asks for its move (here).
3. B6: the stuck card at signal rings (here).
4. The fuzz in the suite (here).
5. B4: `claude/shared-line-turns`.

**Next, needing a decision:**

1. **U1, the lamp on top:** a cheap model change. Recommended now; it is what makes signals readable at all from a phone's angle.
2. **U5, tap opens the card:** recommended.
3. **B5, signals inside a loop's road:** (a) refuse when placing, recommended; or (b) let a line's trains pass them.
4. **U3, the waiting card names the cause and shows the signal and its block:** with `claude/shared-line-turns`' wording.
5. **U2, a facing chevron on the sleeper.**
6. **Realism:** path signals green at rest (recommended), or keep and explain.
7. **U6, the card's details:** selected state, warn-ink, accessible names, and a style picker.

## Built (the user's picks, 2026-11-06)

The user picked U1 + U2, U5, and U3 + U6 with path signals green at rest. B5 (refusing signals in loop roads) was not
picked; it stays open above.

This branch merges `origin/main` and `claude/shared-line-turns` (d942c44). Since that merge, report 2's train goes on
to the mill.

- **U1, the lamp on top:**
  - The toy colour light's wooden knob is replaced by a dome lit red or green (radius 4.8 mm, the knob's 2.6), and the lenses lean back 30°.
  - The dome is part of each lit lens's geometry (`mergeGeometries`), so there are no new draws, and one fewer part.
  - The kit looks (semaphore, colour-light kit, gantry) are unchanged: their arms and lenses come from the kit models.
- **U2, the arrowhead:**
  - A flat filled arrowhead lies beside the post's foot, out from the track, pointing the way the signal guards and lit with its aspect.
  - It is in the same lit geometry.
  - The card's screen arrow ("guards this way →") is gone.
- **U5:** a tap on a signal opens its card. Always red holds it, Auto lets it go. A held train's card says "Waiting at a signal you're holding at red. Tap it, then Auto".
- **U6, the card:**
  - Its title says what it shows now and why (`Sim.markWhy`): "Signal · red: a train is on the line ahead", "· green: the line ahead is clear", "· red: held here", "· red: a train waits here for its turn", "· red: a train's way through the points isn't set". It follows aspect changes on the marks view's sync, never per frame.
  - The selected mode is cream with a dark ring.
  - The too-short note is in `warn-ink`.
  - Mode chips are announced by their names, with the description as `aria-description`.
  - "Look: Lamps ▸".
- **Path signals green at rest:** with no train coming, a path signal shows green while no train is on its block. It's worked out in `updateSignals` on a change, not every tick.
- **U3:**
  - An engine standing at a red signal has Signal on its card, beside Show. It glides to that signal, and the line the signal guards is tinted while the card is open.
  - The words are `line-wait-for`'s, from `claude/shared-line-turns`.

**Pictures:** `docs/agents/shots/signals-ux-before-after-*.jpg` (main on the left, this branch on the right; 390×844 @2x from the high angle).
