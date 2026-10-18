# Track props: the railway kit that trains really use

Date: 2026-10-17. Status: design, for review. Sandbox only to start; Game mode comes later.

## What the user asked

> In the sandbox we had a bunch of different track-like pieces that we removed because they didn't interact with the
> actual tracks. I'd like to bring those back, but they should interact with the track system (can be sandbox only to
> start).

906b0a6 held them back (`RAIL_HELD_BACK`, `src/catalogue/shelves.ts`) because each "carries its own stretch of track
trains can't use"; tunnels were held back earlier. The props still offered on Buildings → Railway and on Machines →
Railway & yard should join in too. The aim is a railway that feels alive, with the least for the player to manage.

## Where we start from

- **Pieces are pure track data**, with nothing decorative on them (`PieceDef` in `src/track/pieces.ts`: connectors,
  paths, `isSwitch`, `signal?`). The sim reads only paths, `isSwitch`, `def.signal` and the connector count, never a
  type name.
- **Anything with a look is drawn beside the piece, keyed by its type and pose.** The depot is the pattern:
  - its track is a plain 216 straight;
  - `INDUSTRY_ROLE` maps the type to a role, and the economy depot is keyed by piece id;
  - `DepotView` draws the building and yard at the piece's pose.
  
  Since 1cddfa9 a depot also splices onto a run of straights. That covers `findSplice`, `Editor.replace` (one undo
  step), `gapFill` when it leaves, a yard footprint that must be clear (`depot-footprint.ts`), refusals named after the
  depot, and the flip hint.
- **Any piece registered with `economy.addDepot` is a stopping place.** `capFor` halts a train where its car needs
  service, and trains with nothing to do run through.
- **The held-back assets are catalogue models** (`Asset.build(kit)`, model on y=0 facing +x). Their track is only
  geometry: `kit.trackSlab` (40 wide, grooves 26 apart, the same as real track) or slabs inside Blender models.
  - Their lengths are odd ones: 150, 130, 140, 100, 80, 180, 204, 300, 110 and so on.
  - Some have `animate(root, t)` (turntable deck, gantry trolley, lift, shed doors, portcullis), used only in the
    catalogue viewer.
- **Props** (`PropStore`, `{asset, x, z, heading, y}`) are drawn as one BatchedMesh instance each, with nothing per
  frame. Their footprint is the baked bounding box. Old sandbox autosaves may hold held-back ids from before 906b0a6;
  they load as plain props.
- **Gaps:**
  - track can't pass through a hill block, and there is no tunnel support;
  - no piece animates (except semaphore arms, crossing barriers and depot cranes);
  - `MAX_CONNECTORS` is 4, and saved switch state is clamped to 0..2;
  - an unknown piece type fails the whole load (`z.enum(PIECE_TYPES)`).

## The mechanism: kit pieces

**A track prop becomes a piece, not a prop:** a *kit piece*. Its track is real track: it is in the layout, has joints,
is saved with the pieces, and is undone by the editor. Trains run on it because the sim already runs on anything with
paths. Its look is the catalogue model, drawn by one `KitView` the way `DepotView` draws depots. So everything that
already works for pieces (snapping, splicing, undo, saves, routing, signals) works for kits, and kits add only what
they need.

### The shared interface (`src/track/kits.ts`, owned by Game Mode)

```ts
interface KitDef {
  /** The catalogue model drawn for it (its own track slabs left out: real track is drawn under it). */
  asset: string;
  /** Its track: connectors and paths, built with the same helpers as pieces (straight, curve, buffer ends). */
  track: PieceDef;
  /** Who draws the rails: the ordinary track (most kits), or the model itself (bridges, tunnels, the turntable deck). */
  rails: "track" | "model";
  /** Ground it needs clear, in piece-local t/l rectangles (stations' platforms, cranes' legs, a shed's walls). */
  footprint: Rect[];
  /** Can be dropped onto a run of straights to take its place, like a depot (single path, length a multiple of 54). */
  splices?: boolean;
  /** Trains stop here: where, for how long, and which trains (passenger cars, steam engines, any). */
  stop?: { at: number; seconds: number; who: "passengers" | "steam" | "any" };
  /** It's a cargo stop: registered as an economy depot of this role, so cranes load and unload as at a depot. */
  depot?: DepotRole;
  /** When its model moves: while a train is on it, while one is stopped at it, or when its state changes. */
  moves?: "occupied" | "stopped" | "state";
}
```

- **Registration.** `KITS: Record<KitId, KitDef>` generates `CATALOG` entries (as the join and fit types are
  generated), so each kit is a `PieceTypeId` and saves as one. `kitOf(type)` returns its def or nothing.
- **Track that matches.** Kit track lengths are real lengths:
  - 54 multiples, so they splice and snap onto straights: 108, 162, 216, 324;
  - curves are the existing radii.

  Each asset is re-authored to match. The slab lengths change, the buildings mostly don't. Its slabs are tagged
  (`userData.slab`; a `slab` name prefix in the Blender scripts) so `KitView` can leave them out when the real track is
  drawn.
- **Placement** is the depot's, generalised:
  - A single-path straight kit (`splices`) drops onto a straight run (`findSplice`), or seats on an open end like any
    piece. A multi-path kit (two-platform station, terminus, shed, turntable) seats on an end with the usual snap.
  - `checkYard` becomes `checkFootprint(type)`: hill, water, houses, props, other track and yards, with refusals named
    after the kit. `depot-footprint.ts` becomes its first user.
  - The flip hint, gap fill, two-way blocking ("That's the station's platform") and the along-track snap all carry
    over.
- **Undo and saves** come with being a piece. Adding kit types to `PIECE_TYPES` means a save holding them won't load
  in an older build. That is the same for every new piece, and fine.
- **Old saves** that hold held-back props keep them as decorative props, where they were. Nothing converts
  automatically, since a prop's track didn't line up with anything. If players ask, a later "make it work" tap could
  swap one for its kit where it fits.
- **Drawing (`KitView`):**
  - one BatchedMesh instance per kit piece, slab-stripped and baked once per asset (as props are);
  - updated only for kits added, moved or removed (a diff by piece id and pose key), never per frame.
  - Moving parts (doors, cranes, decks, brushes) are split off the static bake into a small live group for that kit,
    animated only while its trigger holds (`moves`). While it moves it calls `invalidate()`, then it stops, so an idle
    railway still costs nothing.
  - Triggers come from what the sim and economy already know: bogies on a piece, a train halted by `capFor`, a state
    change (as `signalsVersion` does).
- **In the tray:** kits go on the shelves they came from (Buildings → Railway, Machines → Railway & yard, Bridges,
  Tunnels), shown with their model thumbnails. Taking one out holds a piece, not a prop. Sandbox only: in Game mode
  these shelves stay as they are until a later design.

### Lineside props without track

The Railway shelf's buildings and the yard machines carry no track. Two kinds:

- **Things that belong to the line are kit pieces too.** Each is a straight with the building on one side, exactly as
  a depot is. Drop one onto your line and it takes a straight's place:
  - country halt, mountain station, harbour station, furnished platform: a stop for passengers;
  - water tower, coal stage: a stop for steam engines;
  - goods shed, magnet crane: a cargo stop.
  
  This is the same gesture players have just learned with the workshop, and it ties the behaviour to the track
  without any hidden "nearest line" rule.
- **Small furniture stays a prop:** ticket booth, waiting shelter, station clock, ticket barrier, whistle post, lever
  frame, signal box. Where a little behaviour helps, it works by nearness, worked out when the prop or the track
  changes, never per frame:
  - **Whistle post:** a train passing within ~150 mm whistles (an audio event on entering the nearest piece).
  - **Signal box and lever frame:** tapping one opens a small card listing the switches and signals within ~400 mm,
    each tappable. That's a nicer way to throw a busy junction, and needs nothing new from the sim.
  - **Clock:** shows the game's time.
  - **Shelter, booth and barrier** are dressing; they don't change anything.

## What "interacts" means, group by group

### Stations and sheds (Game Mode)

| Kit | Track | Behaviour |
|---|---|---|
| Country halt, mountain station, harbour station, furnished platform | 216 straight, building one side, splices | `stop: passengers, 4 s`: a train with coaches stops at the platform, its doors pulse, then it runs on. Goods trains run through. |
| Two-platform station | two parallel 216 tracks (4 connectors, 2 paths) | Each road stops passenger trains. A natural passing place, since the second road is free while one waits. |
| Grand terminus | 3 roads of 216, buffer-ended (3 connectors) | `stop` at each road's end; trains turn back at the buffers as they do now. The clock animates while a train stands. |
| Engine shed | 2 roads, buffer-ended, under a roof | Doors open as a train approaches and close behind it (`moves: occupied`). Somewhere to park engines. |
| Roundhouse segment | 3 stall roads fanned round a centre, buffer-ended | Built to sit round the turntable (Sandbox's). Stalls are parking; doors as the shed. |
| Castle gate | 108 straight through the arch | The portcullis rises as a train comes and drops behind it (`moves: occupied`). |

In Sandbox, a stop is a dwell, not a passenger count. `stop` goes through `capFor` in the same way as a depot's
service, so the train eases in, waits, and goes. When passengers come to Sandbox later, these become real boarding
points (the "town" role).

### Engine services: water, coal and fuel (Game Mode)

Water tower, coal stage, water crane, coaling crane, coal chute and fuel station: `stop: steam` (or `any` for fuel).

- An engine passing stops for ~3 s while the spout swings or the chute tips, then goes on.
- No new resource and no "needs water" timer, so nothing to manage. It's the toy's version of a service stop.
- To keep a busy line moving, an engine that took one in the last ~60 s runs through.

### Cargo cranes and loaders (Game Mode)

Gantry crane, harbour crane, log loader, grain elevator, cargo conveyor, tipping dump, drop hopper, goods shed and
magnet crane are each a splicing straight with `depot`. Each is registered as an economy depot, so trains stop for
loading and unloading exactly as at an industry, and the kit's own crane parts do the animating.

Sandbox has no industries to feed, so the roles are kept small:

- **A loader** has an endless pile of one kind of goods and fills matching wagons:
  - log loader: logs;
  - grain elevator, conveyor: grain;
  - coal chute: coal;
  - gantry, harbour or magnet crane: crates, i.e. planks.
- **An unloader** empties wagons and the goods vanish into it: tipping dump, drop hopper, goods shed.

So a Sandbox player can make a working goods line from one loader and one unloader. These are new `DepotRole`s with
recipes and nothing else, so the economy needs no other change.

The weighbridge is a crawl: trains slow to a walk over it while the dial swings, then speed up again. It gives the
same `capFor` treatment with a cap, not a stop.

### Signals and crossings (Rail and road)

- **Semaphore, colour-light and signal gantry** become skins of the existing `signal` piece: new kit types sharing
  `signal: { stopAt }`, with `KitView` drawing their post instead of `syncLevers`' default semaphore. The colour-light
  shows red or green from the same `signalClear`; the gantry is a skin over two parallel tracks (2 paths, a signal on
  each).
- **Buffer-stop lamp** is a skin of the buffer pieces. The lamp lights while a train stands against it.
- **Level crossing and gated crossing** stay derived, as crossings are now (`findCrossings`). These two become
  crossing styles: dropping one on an existing crossing sets its style, stored with the prop, so the barriers or gates
  drawn there are its own. Gates swing instead of lowering.
- *Built (kit-signals):* `kit-semaphore-signal`, `kit-colour-light-signal`, `kit-signal-gantry` (both its signals
  guard the same way, from its first ends, as its heads face), `kit-buffer-stop-lamp` (lit while a train is on it:
  `moves: "occupied"`), and the two crossing styles. See "How to add a kit", 5.

### Bridges (Rail and road)

Stone arch, viaduct, truss, suspension, covered, trestle and rope become bridge styles: new types sharing the bridge's
def, with `isBridge` widened to the set, and `rails: model`. Two parts:

- The support and deck geometry comes from the asset, rebuilt for the bridge's levels the way `bridgeSupport` is
  today (so the asset's `build` takes a height).
- Lengths are re-authored to `BRIDGE_LENGTH` (216), or a 432 two-span for the viaduct.

Moving bridges (bascule, swing, lift) come later, if at all: they'd need a state that blocks the track, and boats
under them.

- **Road-over-rail** belongs to roads, as a road bridge style.
- **River ford** is a road crossing water, so it's for the road team.

### Tunnels (Rail and road)

Track through a hill block is the one genuinely new piece of terrain work:

- A `tunnel` piece (straight 216, `rails: model`) is allowed below a hill's surface. `checkPlacement` lets it pass
  `BLOCKED.hill` where the block fully covers it above the tunnel's clearance.
- The hill is not cut; `KitView` draws the portal on each face where the track enters (the tunnel-portal asset) and
  nothing inside. A train running through simply goes out of sight.
- Mountain tunnel and double tunnel are larger portal styles, the double being two paths.
- **Rock cutting** is a style of the existing ramp cutting: a rock-faced bank skin on `HillCut`, no new mechanic.

### Railway kit (Sandbox)

**Turntable**, the one that needs the most new mechanics:

- A kit with up to 8 connectors round a deck. That means raising `MAX_CONNECTORS` and the saved switch-state clamp.
- Its routes are the deck's orientations, so `routeFrom` treats it as a switch whose state is the deck's angle.
- Tapping turns the deck to the next road, and the deck animates (`moves: state`).
- It won't turn with a train half on it.
- It pairs with the roundhouse segment.

**Transfer table:** the same idea in a straight line. Parallel roads each side, and the table shifts which pair joins.

**Train lift:**

- A low end and a high end, several levels apart.
- A train that arrives is held on the platform (cap 0). The platform and train rise together (the train's cars are
  drawn lifted), then the train is moved onto the upper path and goes on.
- It's a carry, not a slope, so the sim needs one new move: "lift the train from piece A's end to piece B's".

**Train wash and track cleaner:** pass-through straights whose brushes spin while a train is on them
(`moves: occupied`). The wash also slows trains to a crawl.

**Loop-the-loop:** last, and maybe as a show, not a path. A train entering slows, a toy copy of its engine goes round
the loop while the real one passes underneath, and they meet at the far end. Real upside-down track would need rolled
cars in the sim, which is out of proportion for one prop.

## Phasing (Sandbox only)

| Phase | What | Who |
|---|---|---|
| 0 | `kits.ts` interface, `KitView` (static), footprint check generalised from depots, splice generalised, slab tagging, tray entries, save of kit types. First pilot: the furnished platform (a stop). | Game Mode |
| 1 | Halts and stations with stops; engine services; cargo loaders and unloaders (new small roles); engine shed and castle gate doors. Signal skins; buffer-stop lamp; static bridge styles; crossing styles. | Game Mode; Rail and road |
| 2 | Turntable plus roundhouse; transfer table; train wash, track cleaner and weighbridge. Tunnels (track through hill blocks, portals) and the rock-cutting skin. Lineside furniture: whistle post, signal box and lever frame card, clock. | Sandbox (+ Game Mode for roundhouse); Rail and road; Game Mode |
| 3 | Train lift; moving bridges; loop-the-loop show. Old-save "make it work" tap if wanted. Game mode availability (a separate design). | Sandbox; Rail and road |

Phase 0 lands first. Everyone builds on its interface, and nothing else starts before it's on main.

## Performance

- **Idle:** kits are static instances, so nothing per frame. Moving parts animate only while a train is on or
  stopped at that kit, or its state changes. The trigger is read from data the sim already produces, then
  `invalidate()` while moving and nothing after.
- **Edits:** `KitView` diffs by piece id and pose, so adding one kit builds one instance. Assets are baked once and
  cached per asset id.
- **Placement:** the footprint check is the depot's, already measured at about 0.1–0.3 ms per move with caching. Kits
  have more footprint rectangles, so measure on a phone before and after Phase 0.
- **Nearness features** (whistle post, signal box) are worked out when a prop or the track changes, never per move or
  per frame.

## Open questions

1. **Lengths.** Re-authoring every asset to 54 multiples changes some models' proportions slightly (the 150 platform
   becomes 162; the 204 arch becomes 216). I propose doing it.
2. **Dwell time** in Sandbox is 4 s at stops and 3 s at services. Should Sandbox let a player turn stops off per
   train? I propose not yet.
3. **Sandbox cargo roles** (an endless loader and a vanishing unloader) are a new idea for Sandbox. They're small,
   but they're a product call.

## How to add a kit (Phase 0 is built: read this before Phase 1)

1. **The model.** The asset's built-in track must be drawn with `kit.trackSlab` (TS assets), or `k.trackSlab` in
   `tools/blender` (Blender assets, re-exported with the pipeline; it runs here, with pip bpy plus gltfpack). Slabs
   are then tagged (`userData.slab`, or a node named `slab`), so the kit's model is baked without them and real track
   is drawn instead. Lengths along the track must be the kit track's: multiples of 54 for a splicing straight.
2. **The kit.** Add an entry to `KITS` in `src/track/kits.ts`:
   - `asset`, `name` (lower case, used in messages);
   - `track`, built with the piece helpers (`straight(type, len)`, curves, buffer ends);
   - `rails`;
   - `place`, where the model stands in the piece's frame. t runs along the track from connector 0, +l is to the
     left; `turn` rotates it;
   - `footprint` rects (t, l, w, d) for the ground it needs clear;
   - optionally `splices` and `stop`.

   The type is `kit-<name>`. It becomes a `PieceTypeId` automatically, so it saves, undoes and snaps like any piece.
3. **The tray.** Put the asset id on its Sandbox shelf in `src/catalogue/shelves.ts`, and take it out of
   `RAIL_HELD_BACK`. `shelfItem` offers the kit (a piece) wherever a shelf lists an asset that has one. Game mode
   trays are untouched.
4. **What you get for free:**
   - drawing (`KitView`, which updates on layout changes only), the held ghost and the tray thumbnail;
   - the footprint check, with refusals named after the kit and the flip hint;
   - two-way blocking ("That's the platform");
   - splicing onto straights with gap fill, for `splices` kits;
   - stops (`KitStops`, through the economy's speed cap, in Sandbox and Game alike).
5. **Built in Phase 1 (Game Mode's share):**
   - `moves: "occupied" | "stopped"`: add the asset to `KIT_MOTIONS` (`src/render/kit-motions.ts`): the names of its
     moving nodes (as its catalogue `animate` finds them) and `pose(parts, on, t)`, which must leave them at rest when
     `on` is 0. `holds: true` for a motion that holds still once fully engaged (doors open), `period` for one that
     cycles back to rest (crates on a belt). The library bakes the model whole and bare of those parts; `KitView`
     draws the bare one plus a live copy of the parts only while the kit moves. The game asks `KitView.update` only on
     frames where trains moved, one halted (`Economy.halts`), or a kit is still moving. `"state"` (built in Phase 2: the
     turntable, the transfer table) follows the piece's switch state: give the motion a `state` (`value(k)`, `pose`,
     `round` for a deck that keeps turning one way). `KitView` draws its parts live always, glides them over
     `DECK_GLIDE_S` when the state changes (the game asks it when `Layout.switchesVersion` moves), and makes them the
     tap target that turns it.
   - **A state from the signals** (the signal skins): `state.source: "signals"` makes the state the piece's signals'
     aspects instead of its switch state: `Sim.redSignals(id)`, a bit for each of its roads at red (road 0's is 1), so
     state 0 (the rest pose, baked) is all clear. `KitView.signalState` reads it (the game sets it), and the game asks
     `KitView.update` when `Sim.signalsVersion` moves as well as `Layout.switchesVersion`. `state.glide` sets the glide
     time (default `DECK_GLIDE_S`; 0 switches at once: a lamp, with `value(k) = k` carrying the bits). Its live parts
     aren't a deck's lever: tapped, `KitView.pieceAt` gives its piece, and the pick holds or lets go the signal over
     the road nearest the tap (`signalRoadAt`, `Sim.toggleSignal(id, road)`).
   - **Signal skins**: `track: signalTrack(type)` (the signal piece's 144 straight, `signal: { stopAt: 100 }`), or for
     several roads `{ ...roads(...), signal }`: the sim's block working gives every path of a signal piece its own
     signal (from → to), its own block, and its own hold bit in the switch state. `TrackView` draws no semaphore on a
     kit. **Buffer skins**: `bufferTrack(type)`, flipping as a buffer does (`SWAPS_ENDS` takes any one-ended flippable
     kit); `TrackView` draws no buffer block on a kit, so the model draws it, its buffers' faces 76 along the piece.
   - **Crossing styles** stay props, not kits: `CROSSING_STYLES` (`src/landscape/crossing-styles.ts`) maps a crossing
     prop's asset to a style. `styleCrossings` links each to the crossing nearest it within `STYLE_REACH`, worked out
     when props, track or roads change (`Game.crossingsChanged`, `Game.propsChanged`, keyed by the props' version). A
     linked prop isn't drawn as a prop; `CrossingsView` draws its style at that crossing's gates (and taps there pick
     the prop). Crossing props block nothing and nothing blocks them (`standsAside`); dropped, one snaps onto the
     nearest crossing, or is refused ("Drop it where the track crosses a road"). To add a style: an entry in
     `CROSSING_STYLES`, and a branch in `CrossingsView.buildPost` (a barrier's open and shut angles, about z to lower,
     or y to swing).
   - `depot`: a `DepotRole` (Sandbox's: `KitDepotRole`, loaders with an endless heap and an unloader that swallows
     goods). `syncIndustries` registers it; `DepotView` leaves it to the kit's model.
   - `stop.cooldown` (seconds: an engine service's), and `crawl` (mm/s: a weighbridge).
   - A kit of several roads: build its track with `roads(type, starts, length, buffered)` in `kits.ts`. Buffer-ended
     roads stop trains coming in only, and the model draws the buffer stops (`TrackView` leaves its block off kits).
   - `rails: "model"`: the model draws its own rails (a deck's: keep its slab with `deckTrack` in the asset, so it isn't
     stripped). `TrackView` gives the piece an invisible plain body, only for picking.
   - A deck: `gated: true` on its track. Only path `switchState % paths.length` joins its ends (`routeFrom`); the
     others are open ends, where trains turn back. `Sim.toggleSwitch` steps it, refuses while a train is on it, and
     keeps it closed for `DECK_GLIDE_S` while it moves. Up to `MAX_CONNECTORS` (8) ends.
     A train standing still wholly on a deck rides it (`Sim.startRide`): its axles go to the new road at once (on a
     turntable turned past half round, running the other way: an engine turned round), and it's drawn carried round
     over the glide, held still, nothing coupling to it. A train partly on it or moving refuses the turn
     (`deckRefusal`, with the toast).
6. **Tests to copy:**
   - `src/track/kits.test.ts`: the registry;
   - `src/game/kit-footprint.test.ts`: the footprint and flip hint;
   - `src/economy/kit-stops.test.ts`: stops (several roads, buffer-ended roads, services' cool-down);
   - `src/economy/kit-depots.test.ts`: cargo stops and the crawl;
   - `src/render/kit-motions.test.ts`, `src/render/kit-view.test.ts`: moving parts;
   - `src/editor/editor.test.ts`: the kit block, splice and undo;
   - `src/persist/save.test.ts`: kit pieces in saves.
   - `src/sim/signal-skins.test.ts`: skinned signals hold trains as the plain one does; the gantry's two signals;
   - `src/render/kit-skins.test.ts`: signal skins' aspects drawn, the buffer-stop lamp;
   - `src/landscape/crossing-styles.test.ts`: crossing styles, resolved and drawn.

## Phase 3 plan (2026-10-17, after P0 to P2 and the signals)

P0 to P2 and the signal and crossing skins are built: kit-signals plus p1-polish. Two items from the original Phase 3
fall away: old saves are no longer kept (the user's call), so there's no "make it work" tap for old props; and the
roundhouse doors are done. That leaves three mechanisms and Game mode.

### Mechanisms (Sandbox)

| Kit | Approach | Owner |
|---|---|---|
| Train lift | Two rim ends, a level or more apart. A train halts on the platform: a stop at the platform's middle, cap 0. It is carried up as a ride, the way the turntable carries trains (`Sim.startRide`): bogies held still while the platform's motion (`moves: "state"`) lifts them, then moved onto the upper path with the lever left on. One new sim move, "carry a train from end A to end B over T seconds", built on the turntable's ride. | Sandbox |
| Moving bridges (bascule, swing, lift) | A bridge style (Rail and road's bridge styles) with a state: open blocks the track, so the bridge acts as a held signal on both paths (`signal` plus a hold bit, which already exists) while it's raised. It opens for a few seconds every so often, or when tapped, and only when no train is on it or within braking distance. Boats under it are optional (the harbour boats already exist). | Rail and road |
| Loop-the-loop | A show, not track: a 216 straight kit. A train on it slows to a crawl while a toy copy of its engine runs the loop (a `moves: "occupied"` animation on a spline), and the copy meets the real train at the far end. Nothing in the sim changes. | Sandbox |

All three use the hooks already built (`moves`, `rails: "model"`, the turntable's ride, signal holds). None needs a
new per-frame cost.

### Game mode availability (Game Mode, design for the user)

The kits stay Sandbox-only until this is agreed. My proposal is to tie them to blueprints that are already on the
board, so there are no new branches:

| Blueprint (already on the board) | Unlocks in Game mode | Notes |
|---|---|---|
| Signals (tier 1, built) | semaphore skin as the signal's look | The colour light needs Electricity. |
| Junctions and loops | signal gantry | |
| Engine shed (now "soon") | engine shed, water tower, coal stage, water crane, coaling crane | Engine services are a short visual stop with no resource. The engine shed parks engines. |
| Turntable and roundhouse (now "later") | turntable, roundhouse segment, transfer table | Turns engines round. |
| Tunnels (now "soon") | tunnel portals, rock cutting | Rail and road's Phase 2. |
| Stone viaduct, Lift bridge (now "later") | bridge styles, moving bridges | |
| Scenery kit (now "later", crafting) | castle gate, station clock, whistle post, signal box and lever frame card, train wash, track cleaner, weighbridge | The "makes it alive" set: decoration with small behaviours. |

Each kit is made at the workshop like any piece (a `THING_RULES` entry with a plank cost), so it goes through the
tray, crafting and the toy box as today. Old blueprints marked "soon" or "later" become real when their kits land.

Three questions for the user before Game mode gets any of this:

1. **Halts and stations in Game mode.** Should a country halt, or the mountain or harbour station, placed near a town
   act as an extra passenger stop for that town, with boarding and alighting counting for it? I propose yes, under a
   "Halts" blueprint in Passengers. It gives a reason to build branch lines.
2. **Cargo machines in Game mode.** Sandbox's endless loader and vanishing unloader don't belong in Game's economy. I
   propose they stay Sandbox-only. In Game mode the goods shed could be a small warehouse's look instead.
3. **Crossing styles in Game mode:** cosmetic, so free once Scenery kit is learned? I propose yes.

**Decided and built (kits-game):** yes to all three. The table is `THING_RULES` (src/game/things.ts), one row per kit
or piece of furniture naming its blueprint and plank cost; tests: `src/game/kit-unlocks.test.ts`, `halts.test.ts`.

- Engine shed, Turntable and roundhouse, and Scenery kit lost their `plan`; Halts is a new board blueprint in
  Passengers (tier 1, needs Passengers, 12 planks + 20 coins). Tunnels, the viaduct and the lift bridge still wait.
- The track cleaner is the wagon (`car:cleaner`); lineside furniture are props (`prop:<asset>` things), counted on
  the map like pieces. The crossing styles' rules are `free`.
- **Halts** (`HALT_KITS`, src/game/world.ts): placed in Game mode within `HALT_REACH` (a plot's depth) of a town's
  middle, a halt is an economy depot of role "town" for the nearest town (re-linked if moved). People wait there,
  board, and alight from other towns as at its station (`canAlight`/`canBoard` compare towns, not depots); it takes no
  goods (`Economy.isHalt`). Its kit dwell gives way to the depot's service (`KitStops` `hasDepot`), so a train stops
  once, and only when someone gets on or off. Elsewhere: "Build halts within 23 squares of a town" (`HALT_TOO_FAR`).
  While a halt is held, a soft ring on the ground shows each town's reach (`HaltReachView`: one mesh for all towns,
  built on the first show, rebuilt only when the towns or their ground change).
- **Halts share a town's people** (`peopleArrive`, QA): a town has one arrivals clock and one waiting cap across its
  station and halts, and each newcomer goes to the stop with the fewest waiting (the station on a tie). Halts spread
  a town's passengers along its lines; they don't add to them. A town with only its station is as before.
- **Tray:** Game mode's "Railway kit" shelf on the Track tab (signal skins, turntable, transfer table) and "Railway",
  "Halts" and "Lineside" shelves on the Industries tab. Their items are hidden (not shown Locked) until learned, so a
  new player's tray is as before.
- Cargo machines stay Sandbox's. Game's warehouse wears the goods shed's look (kits-game-p3): its Blender part
  (`industry-warehouse`, tools/blender/dressing.py, in industry.glb) is re-dressed with the goods shed's pieces, its
  dock facing the track; footprint, piles, crane and track as before.
- **Board pictures** (kits-game-p3): a blueprint's ticket shows each piece and prop it makes as its tray picture (the
  rendered model); a kit's or a prop's is drawn on demand as for the tray (`needPictures`, `pictureCame`).

### Order

1. Land kit-signals (in QA) and then p1-polish.
2. Rail and road: bridge styles and tunnels (their P1 and P2), then moving bridges.
3. Sandbox: the train lift and the loop show, on the turntable's ride.
4. Game Mode: Game availability once the user answers the three questions. Then the routes intent rules, once
   Scenery's `lineOfCar` is ready; that's a separate design.
