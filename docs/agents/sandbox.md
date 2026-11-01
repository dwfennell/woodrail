# Sandbox — playbook

## 1. Scope
- **Track pieces and kits:**
  - the catalogue (`src/track/pieces.ts`);
  - snapping (`snap.ts`), overlap and headroom (`overlap.ts`);
  - supports (`src/landscape/support.ts`).
- **The tray:**
  - `src/ui/tray-catalogue.ts` (shelves, labels);
  - `src/game/things.ts` (Game prices, blueprints);
  - click/touch carry in `src/game/interaction.ts`.
- **Models and carving:** `src/render/track-geometry.ts` (CSG, `buildPieceGeometry`, `bridgeSupport`), with `TrackView.carveInBackground` in workers and a main-thread fallback.
- **Cloud saves:**
  - the Worker and R2 in `cloud/`;
  - `src/persist/cloud.ts` (CloudSync) and `progress-merge.ts`;
  - the cloud card;
  - `Progress.origin` and `Progress.taken` (`src/game/progress.ts`).

## 2. How to test

**Gates:**
- `npm run typecheck` and `npx vitest run`;
- `cd cloud && npx tsc --noEmit && npx vitest run` (16 Worker tests, Miniflare).

**Running e2e suites:** run each one **alone**: they share the Worker port, and running several loads the machine. Never edit `src/` while an e2e runs, because Vite reloads the page.

**e2e:cloud** (`scripts/e2e/cloud.mjs`, about 25 min, 24 steps):
- It starts a local Worker (wrangler dev) and runs two-device steps.
- Run `npm --prefix cloud ci` first.
- A running Game page sends its progress on its own every minute: a new game's forest cuts logs (`counts`, a progress edit every 15 s or so). A page that then finds the other device's later copy reloads onto it, by design. So "landed" means the cloud copy holds what was sent (the step 7a check decodes the bundle's coins), not just any new copy: the Worker turns an upload within 10 s of the last away (429), and the page keeps it for its next round. From 7b the test pauses both games and sends every upload itself (`quiesce`, `hideAndSettle`: a merge that takes the other's later copy reloads and sends its merged copy only on a second round).
- A page's start-up check of the cloud is waited on for 3 s past loading, then cut off (`cutoff()`) and left for its next upload round. A page with nothing of its own to send has no such round, so it stays on its own copy until it next has an edit. Headless, the check is cut off now and then: the test's `restart` starts such a page again. Open question for the user/CoS: a clean Sandbox device whose check was late shows its older railway, and its next edit then outranks the newer one (kept as a backup, with a toast).
- A copy taken while playing (`onTaken`, the page reloading) stops that page's sync (`reloading`): it used to go on and send the merged copy as it went, and landing after the new page's own round began, that copy was merged with it again, so coins were counted twice (e2e:cloud "one learns a blueprint while the other earns", 495 for 450; fixed 2026-11-01, `cloud.test.ts` "taken while playing").
- A take-reload starts the page again from storage, so progress made in the last 5 s before the page's own upload round (since the last 5 s save) isn't in the copy it merges and reloads onto. Not fixed (2026-11-01); an e2e that earns must wait for the save (`earnOn` does).

**e2e:ramps** (`scripts/e2e/ramps.mjs`, 10–25 min):
- Runs on Sandbox #seed-24.
- Lanes are built through the tray, with spots picked by the game's own `checkPlacement`, `findOverlap` and `findLowCrossing` (±24 mm margin).
- `DEBUG=1` logs refusals; `ONLY=<lane>` runs one lane.

**Other e2e:**
- **e2e:tray** builds first (5 checks).
- **e2e:kits and e2e:joints** don't touch ramps.
- **e2e:draw and e2e:roads** use only the straight ramp.
- **When `main.ts` or the cards change,** run touch, click and workshop.

**Known flakes under load:**
- A card button tapped as soon as it's in the DOM is dropped by the card tap guard (mobile-ux.md §5). Wait `frames()` then 250 ms. To check, record `performance.now() - hud.buttonMovedAt.get(button)` on pointerdown: under 150 means dropped.
- The sim runs slower than the wall clock. Bound waits by `w.simSeconds`, not wall time.
- Reading straight after `reload()` can beat the device's start-up take. Wait for the expected value, or for the copy to be in.
- A device's own 60 s timer can fire mid-step. Hold a device offline with `setOffline` while the other works.
- A direct `coins += n` is lost if an adopt happens before the 5 s autosave. Earn offline, wait for the local save, then go online.

## 3. Design rules
**Piece families:**
- Flat curves are 90, 180 and 270 mm at 45°, on the 18 mm lattice.
- Curved ramps match them: `ramp-curve-small`, `ramp-curve` and `ramp-curve-wide`, each a quarter turn up one level (48 mm).
- The straight ramp is 144 mm. `isRamp()` covers all four ramps.

**Supports:**
- Every ramp stands on its own sloping, arched support (geometry only; track has no colliders).
- Raised a level or more, it stands on arches (`canStandOnArches`).
- A ramp's ends are rest heights, so track on its top needs no riser (ramps-2).

**Draw** lays only the straight ramp.

**Switch shelf:** the wye has a lever at each corner (#15, `cornerLevers`; its state a bit per corner, see rail-road.md). Saves carry `wyeLevers: 3`; older ones load their one-lever wye set the same at every corner.

**Carving** stays in workers; the arch variants for levels 1–3 are carved in the background at load.

**Keep turning:** a curve or curved ramp from the tray takes the flip that turns on as the curve it meets (never a switch or a straight); Flip pressed for that piece wins. Draw doesn't (its rule: never mirror a held piece to fit).

**Performance:** pointer moves are hot. The keep-turning check re-runs a snap at most once per move. Put numbers in commits.

**Cloud merge rules:**
- **Keys:** `saves/HMAC(CODE_KEY, code)/mode`, with `.prev` for the previous copy.
- **Limits:** 2 MB; one PUT per code and mode every 10 s.
- **No overwriting unseen:** a PUT sends `X-Base-Saved-At` and is stored only via `onlyIf` on the etag. The first PUT uses `etagDoesNotMatch: "*"`. A loser gets a 409.
- **Who wins:**
  - a layout edit outranks progress;
  - between two edits of the same kind, the later by server time wins;
  - the loser's copy is kept to restore.
- **What merges:**
  - Progress always merges, even when the layouts clash.
  - Coins, counters and the toy box: base plus each side's change.
  - bestLevel: the higher. firstFlour: either. Learned and goals: both.
  - Offers: one per town and level; one taken on either side stays taken.
  - Research goods: added up, capped at the need.
  - A reward taken on both pays once (`Progress.taken`).
- **Origin rule:**
  - same origin with a known base: count from the base;
  - different origins: count from a new game's progress;
  - same origin with no base: count from the per-field minimum.
  - The merged copy takes the cloud copy's origin.
- **Accepted limits:**
  - two playing devices both earn;
  - overspend leaves 0;
  - about 5 s of earnings can be lost at a merge;
  - an open device sees remote changes only when it starts or uploads.

**Go-live** (`cloud/README.md`), waiting on the user's Cloudflare token and on allowing api.cloudflare.com:
1. API token: the Workers template plus R2 edit.
2. `npx wrangler r2 bucket create woodrail-saves`, then `openssl rand -hex 32 | npx wrangler secret put CODE_KEY`.
3. Check `ALLOWED_ORIGINS`.
4. `npx wrangler deploy`.
5. A curl with no code should return 400.
6. Set the GitHub variable `WOODRAIL_CLOUD_URL`.
7. Check that two simultaneous first PUTs give 200 + 409 on real R2.

Before going wide: rate-limit HEAD/GET, and codes with nothing saved yet.

## 4. Open items
1. **curved-ramps:** `claude/curved-ramps-land` (curved-ramps-2-dont-land on main 0d5410e, plus the e2e fix) is ready to land: e2e:ramps 7/7 twice.
   - **Cause of the 4/7:** the test clicked the engine card's Go before it was drawn. Its pointerdown came 43 ms after Go came into place, inside `CARD_MOVED_MS`, so the card tap guard dropped it (#19). It wasn't the sim: `crossMasks` is 0 for one-path pieces (straights, all ramps), so `crossCap` never holds them.
   - **Fix (test only):** two frames and 250 ms before tapping Go, as e2e:touch does.
2. **cloud-saves-5** deb8623:
   - **The bug:** a false "changed on another device too" toast at step 8a. It means D thought it held an unsent layout edit (`m.layout`).
   - **Step 11** also needs to wait until both devices reach the sum.
   - **Next:**
     - log `meta.modes.game.layout` on D before 8a. Suspects: town growth, or world changes after load (unconfirmed);
     - rerun alone, twice.
3. **ramps-2 + #8 keep-turning** (`claude/keep-turning`):
   - a curve or curved ramp from the tray (held, carried, or waiting at the end of the last one put down) seated on a curve keeps its turn (`keepTurning` in `snap.ts`), unless Flip was pressed for it. **#8's cause:** the waiting piece (`previewNextAt`) seats by whichever end turns it least from the tray's heading, so from about a half turn round a flat curve came backwards (an S); only ramps were kept turning.
   - `keepTurning` seats the piece itself (either end, each mirrored to keep turning; not below the floor, then the least turn from the hold). Snapping a mirrored piece afresh can seat it by its other end and turn it back.
   - Flip while the next piece waits shows it again mirrored (`reshowPreview`); a tap lays it as shown.
   - the riser-in-ramp refusal is fixed;
   - unit tests in `snap.test.ts`; e2e:ramps lanes the wide, the S, the spiral and the drag (#8; fails with keep-turning off).
   - e2e:ramps 14/14. The spiral's curve is taken as it comes: asked for unmirrored, it can seat by its far end and turn off the checked place (hills, "past the edge").
   - **Open:** a second curved ramp clicked on a curve's raised end (two levels up) doesn't snap, even clicked 30 mm ahead of the end (ghost `snap: none`, "headroom"). The spiral lane stops at the curve on top. Next: log `findSnapAtPoint` at that end's level in the page.
4. **Issue #10:** piece names on piece cards: done on `claude/piece-names` (names in `src/ui/piece-info.ts`; see mobile-ux.md §3). A new piece type needs a name there, or `piece-info.test.ts` fails.

## 5. Gotchas
- **Per-carry flags** live on Interaction (see `flipPressed`), not on the drag state: on desktop the drag state is rebuilt whenever the mouse comes back over the map.
- **Clicks:** a click puts a piece's *middle* where you click, at the view's heading. Read the real pose after placing.
- **Snapping:** the snap loop tries several levels, so a click on a raised end can take a free end at the ground beneath it on screen.
- **Snap reach is tight on purpose** (play-test: pieces put down near track jumped onto it). `SNAP_CAPTURE_RADIUS` 10 mm (was 30); `captureRadius` 10 px at the pointer, 10–40 mm (was 28 px, 30–120 mm); a tap's `TAP_REACH` 27 mm (was 80); `findSnapAhead` half the held piece plus 15 mm ahead (108 + 15 for a 216 straight: a finger in the middle of a gap still aims its piece in; e2e:touch stuck and route-keep), 15 mm aside (was 230 for any piece, 45); a picked group's `GROUP_SNAP_REACH` follows `SNAP_CAPTURE_RADIUS`. A test that misses a join should aim closer to the end, not loosen these.
- **Placement:** `findOverlap` isn't the whole check. Risers (`checkSupport`) are added and checked too, and a riser refusal reads as "piece in the way".
- **Lone engines:** a lone engine stops at an open end and doesn't come back.
- **Empty codes:** `useCode` on an empty code returns "nothing". A first-PUT race happens in Game mode on a code that has only Sandbox saved.
- **Flaky e2e:** check whether main fails the same way before blaming your branch.
