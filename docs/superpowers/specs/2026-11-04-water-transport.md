# Water transport: barges, landings, cargo ships, a lighthouse and a train ferry (2026-11-04)

A design, not code. The ask: boats the player routes, docks, how water joins the railway, what goes by water and
why, research gating, and the phone and perf rules. Toy-like and simple. Where there's a real choice there are options
and a recommendation; the decisions for the user are collected in §10.

Sources: `src/game/harbours.ts` (`HarbourTrade`, `waterWay`, `loadBoat`, `boatPays`), `src/render/boats-view.ts`
(`BoatsView`), `src/game/across-river.ts`, `src/render/ambient.ts`, `src/economy/economy.ts` (`Route`,
`RouteStopDef`, `DepotState`), `src/game/blueprints.ts` (the Water branch), the tech-tree proposal
(`2026-10-31-tech-tree.md`), the route UX roadmap (`2026-11-02-route-ux.md`), the catalogue boats
(`src/catalogue/assets/vehicles.ts`: tugboat, paddle steamer, car ferry, cargo ship; `bldg-lighthouse`).

Mock pictures (390×844, `node tools/shots/water-mock.mjs`; boats, cards and the dock are mocked over a real Game map,
a harbour standing in for the smaller landing):

| | |
|---|---|
| `docs/agents/shots/water-1-landing.jpg` | A landing on the river: a tug and two barges of logs tied up, the landing's card with "Boats here" and "+ New barge" |
| `docs/agents/shots/water-2-plan-route.jpg` | Planning a boat's route: landings on the same river are the stops, the way is drawn on the water |
| `docs/agents/shots/water-3-barges.jpg` | The boat's card while it sails: tug and 3 barges, 12 loads, its route |
| `docs/agents/shots/water-4-sea.jpg` | The sea: a harbour, a cargo ship at the quay, a lighthouse on the beach |
| `docs/agents/shots/water-5-ferry.jpg` | The train ferry steaming out from its slip with a train on deck, "⛴ Abroad" as a route stop |

## 1. What there is today

- **Water on the map.** 1–3 rivers per map, about one and a half squares wide (`SURF_RIVER`), running edge to edge;
  the sea along one side, one or two plots out (`coastOf`), so a purchase away. Rivers split the land into stretches
  (`across-river.ts` finds what's across one worth a bridge). Bridges are learned early (minute 8 in seed 2027).
- **Harbours** (tier 3, ← warehouses, bridges): a depot with track and a quay by the water. Boats aren't the
  player's: one calls by itself every 150 s (`BOAT_EVERY`), sails in along the shortest water from the land's edge or
  the open sea (`waterWay`), takes up to 6 loads off the quay (biggest piles first) and pays half a town's price, and
  sails out. You can order goods you already make for the next boat (2× town price), and once Fishing boats is learned
  each boat lands 3 fish. Dock sheds raise the quay's cap. Boats aren't saved.
- **The view.** `BoatsView` sails a rowing-boat model along the way by the clock (`performance.now`), asks for frames
  only while one is in view and big enough (`AMBIENT_MIN_PX.boat`), marks shadows stale when one moves unseen.
- **Planned rows**, all tier 3: barges (12 loads a visit), trade (soon), ferry ("trains ride a ferry across wide
  water"), lighthouse ("boats call twice as often"), cargo ships (24 loads, ← barges, trade, cranes3), lift bridge.
- **Models** that already exist: `veh-tugboat`, `veh-paddle-steamer`, `veh-car-ferry`, `veh-cargo-ship`,
  `veh-sailing-boat`, `veh-fishing-boat`, `bldg-lighthouse` (beam and lamp animate), `bldg-harbour-station`.

Two facts shape the design. **Rivers are narrow**: a boat a bit longer than a wagon fits along one, but nothing can
turn across one, so a ferry *across* a river doesn't fit (and a bridge is cheaper and already learned). **The sea has
no far shore**: plots past the coast are all sea, so there's nowhere across it to go, only "abroad", off the map.

## 2. The idea in one line

**Rivers are free lines; the sea is the way abroad.** On a river, a tug with barges carries a lot of bulk goods
slowly between landings, with no track to lay. At the sea, big ships buy what you send abroad at a full price, a
lighthouse brings them more often, and a train can ride the ferry abroad and come home with goods.

## 3. Boats the player routes

### Choice A: how a boat is told where to go

| | How | For | Against |
|---|---|---|---|
| **A1. Routes, as trains have** (recommended) | A boat has the train's route card: tap ✎ Route, tap landings in order, each stop Pick up and drop / Only drop / Wait to fill. A boat's stops can only be docks on the same water. | One thing to learn: Train routes is learned well before any water. Reuses `Route`, `RouteStopDef`, the stop chips, modes, undo, the route ribbon. Two stops cover nearly every use; more just work. | Routes are a mid-game idea, so water can't come before them (it doesn't: §6). |
| A2. A landing's partner | Each landing's card has "Boats go to: [landing ▾]"; its boats shuttle there and back. | Very simple to read. | A second way of saying where things go; no three-stop runs; a card that edits boats it doesn't show. |
| A3. Boats stay automatic | Like today's harbour boats: they call by themselves; research only makes them bigger or more often. | No new UI at all. | Not "boats the player routes"; rivers stay scenery. |

**Recommendation: A1.** A boat card is an engine card with a boat on it. Planning shows only what a boat can use:
docks on the boat's water get numbered discs and the ribbon follows the water (`water-2-plan-route.jpg`); a tap on a
dock on other water says "Puffin can't get there: it's on another river." No vias (the water's way is the only way).

### Getting a boat

**Bought at a dock, not dragged from the tray.** Water has no track to snap to, and a boat dropped on a 108 mm river
on a phone is fiddly. A landing's card has **+ New barge** (a tug and one barge, 80 🪙): the boat appears at its
jetty and route planning opens with this landing as stop 1 (as the route roadmap's C1 "New route from here"). The
boat's card has **+ Barge** (40 🪙, up to three) and **Sell** (half back). A harbour's card does the same once
Cargo ships is learned (§5), with a ship instead of a tug.

### How boats move

- **Along the water's squares**, the shortest way (`waterWay`'s search, from dock to dock instead of from the edge),
  smoothed as today. Worked out when the route changes or the land changes, and cached by (from dock, to dock, land
  revision): never per frame.
- **Kinematic, not physics.** A boat is a distance along a polyline, moved on the sim tick by its speed. No Rapier
  bodies, no collisions; boats on the same water pass through each other (they're toys on felt), and at a busy jetty
  the second waits its turn a boat's length back.
- **Slow and big.** A tug goes at half a goods engine's top speed. Each barge holds 4 loads (a wagon holds 3), so a
  tug and three barges carry 12: four wagons' worth, on one trip, with no track.
- **Under bridges, always** (toy logic). See choice F for the lift bridge.
- **By the sim clock**, not `performance.now`: a paused game holds boats still (today's harbour boats keep sailing
  while paused; routed boats must not).
- **Saved**, with their route and load (they're the player's, unlike today's visiting boats).

## 4. Docks, and how water meets the railway

### Choice B: what a dock is

| | What | For | Against |
|---|---|---|---|
| **B1. A landing, plus the harbour** (recommended) | A **landing**: a new small depot, one siding beside a wooden jetty, placed on a river bank (or the shore). The **harbour** stays the big one, for the sea and its ships. | A cheap, small thing that fits any river bend; rivers matter before the harbour's tier 3. Clear roles: landings for barges, harbours for ships. | A new depot model (small: a jetty, a crane, bollards; parts exist in the harbour). |
| B2. Harbours only | Barges call at harbours. | Nothing new to build. | A harbour is big (a whole yard), dear, tier 3, and wants a way off the land: rivers stay unused until late. |
| B3. Industries by water load boats themselves | A forest or quarry on a bank fills a moored barge directly, no dock. | Magic and direct. | Hidden rule; a child can't see why one forest loads boats and another doesn't. Can come later as a landing's "next to a forest" bonus. |

**Recommendation: B1.** The landing is placed from the tray like any depot. Its ghost snaps to a bank with the jetty
over the water and turns red with a reason off the water ("A landing goes on a river bank, its jetty over the
water"). Placement checks stay cheap: the bank test is one grid lookup per pose.

### Choice C: how goods change between train and boat

| | How | For | Against |
|---|---|---|---|
| **C1. One shared jetty pile** (recommended) | A landing is a depot with piles, like a warehouse: trains drop and take by the crane, boats drop and take at the jetty. Its Takes filter (warehouse controls) works as on a warehouse. | Exactly how harbours and warehouses work today; nothing new to explain; trains and boats never have to meet. | None worth naming. |
| C2. Ship to train, side by side | Goods move only while a train and a boat are both there. | Lively. | A timing puzzle; one waits for the other; hard to see why nothing moved. |

**Recommendation: C1.** A landing is "a warehouse with a jetty". The route modes mean the same for a boat as for a
train: a boat set to Pick up at the mill's landing and Only drop at the town's carries logs one way, and anything the
landing's Takes filter refuses stays on the train.

## 5. What goes by water, and why it's worth it

### Choice D: which goods go on barges

| | Rule | For | Against |
|---|---|---|---|
| **D1. Bulk on barges, anything on ships** (recommended) | Barges carry what comes in heaps: logs, stone, coal, ore, grain (the hopper goods, plus logs). Cargo ships take anything. | A story a child gets ("raw stuff floats, made stuff goes by train or ship"); barges show a heap, as hoppers do (`e2e:hopper-load`'s heaps). | One more rule on the card ("Barges carry logs, stone, coal, ore and grain"). |
| D2. Barges carry anything | Same as a wagon. | No rule. | Barges just become slow wagons; nothing special about water. |

**Recommendation: D1.**

### Why it pays

- **Barges: a free line.** No track to buy along the river (track costs planks, the scarce good), and one trip moves
  12 loads. A river past a forest or quarry and on to a town's landing is a whole supply line for 80 🪙. Rivers stop
  being something to bridge and start being something to use. Slow, so a train still wins on a short hop.
- **Cargo ships: the best price for what you can't sell.** Today's boats pay half a town's price for 6 loads. A cargo
  ship takes 24 and pays **a town's full price**, for anything, however full the towns are: the place for the surplus
  that stalls a late railway (planks, iron, bricks). It calls every 150 s like today's boats.
- **The lighthouse: more ships.** One near a harbour (within 4 squares, a ring shown while placing) and ships call
  twice as often. Its beam turns (an ambient motion). One counts per harbour.
- **The train ferry: abroad, for a whole train** (choice E).

### Choice E: the ferry

Rivers are too narrow for a ferry to turn across, and across the sea there's no far shore, so a ferry "across wide
water" has nowhere to go on these maps.

| | What | For | Against |
|---|---|---|---|
| **E1. A ferry abroad** (recommended) | A **ferry slip**: a short pier with a buffer, on the shore. "⛴ Abroad" becomes a route stop: a train runs onto the slip, the ferry carries it out to sea, and after a few minutes it comes back with its wagons full of goods from abroad (goods none of your industries make yet, the "trade" row's imports), having been paid full price for what it took. | A real spectacle (a whole train on a boat), a reason to buy the coast plot, and trade without a new screen. In the sim it's simple: the train leaves the track while away (parked off the map), so routing needs no ferry edge. | The train is away for minutes; a child might wonder where it went (its card says, with a timer, `water-5-ferry.jpg`). |
| E2. A ferry between two slips on the same water | The ferry carries a train along a river or the coast between two slips. | Literal "trains ride a ferry". | Routing needs a moving edge in the track graph; a ferry that turns can't fit a river; on these maps a bridge or track along the shore does the same job. Large work for little play. |
| E3. Not now | Keep the row "later" until the map has islands or lakes. | No cost. | The user asked for a ferry. |

**Recommendation: E1.** A train on the ferry has room for an engine and two wagons (the ferry is 250 mm long); a
longer train waits at the slip and its card says "Too long for the ferry: an engine and two wagons fit".

### Choice F: low bridges and boats

| | |
|---|---|
| **F1. Boats pass under every bridge** (recommended) | Toy logic; nothing to explain. The lift bridge stays a "later" row, a moving toy rather than a rule. |
| F2. Low bridges stop barges | A barge route under a low bridge needs a lift bridge or a higher one. A real puzzle, but a frustrating one for a child, and it ties water to the low-bridge work. |

## 6. Research gating

Water is all tier 3 today and two of its rows are built, so nothing on the water branch is learnable before the long
part of the game. The tech-tree proposal's rule: nothing new takes planks before the first City; coin-heavy tier 2
nodes soak the coins that pile up from 60 to 120 minutes.

### Choice G: when water opens

| | |
|---|---|
| **G1. Rivers at tier 2, the sea at tier 3** (recommended) | **River barges** moves to tier 2, needs Train routes and Cranes 1; brings the landing, the tug and barges; 6 🪵 + 120 🪙. Lands about 60–120 minutes. The sea stays tier 3 after harbours. |
| G2. All water at tier 3, after harbours | Simplest change (as the rows are now), but rivers stay unused until late, and the long part gets five new rows at once. |

The rows, with G1:

| Row | Tier | Needs | Price | Brings | Change |
|---|---|---|---|---|---|
| **River barges** (`barges`) | 2 | routes, cranes1 | 6 🪵 + 120 🪙 | Landing, tug and barges | was tier 3 ← harbours, cranes2 |
| Harbours (`harbours`) | 3 | warehouses, bridges | as now | Harbour | unchanged |
| **Cargo ships** (`cargo-ships`) | 3 | harbours, barges | 10 🪵 + 200 🪙 + 10 iron | Cargo ship (bought at a harbour), full-price trade | was ← barges, trade, cranes3 (cranes3 needs City ★: too deep) |
| **Lighthouse** (`lighthouse`) | 3 | harbours | 8 🪵 + 80 🪙 + 10 stone | Lighthouse | price eased |
| **Train ferry** (`ferry`) | 3 | cargo-ships, junctions | 12 🪵 + 160 🪙 + 10 iron | Ferry slip, "⛴ Abroad" | E1's meaning |
| Imports and exports (`trade`) | 3 | harbours | as now | Ordering goods from abroad at a harbour | stays "soon"; the ferry's imports use the same list |

Goals: "Float goods down the river" (a boat delivers at a landing it didn't load at) after River barges, and "Send a
ship abroad" after Cargo ships. Both reached in the play-through (`balance.test.ts`) by the player's path: the
landing from the tray, + New barge on its card (coins paid), a route by the route card's own calls; never by writing
boats or piles.

Balance: barges move a lot of bulk for coins, not planks, so they ease the plank stall a little; full-price ships give
the long part's surplus a home. Both shift bands: run `npm run balance:sweep` before and after, a table in the commit,
never loosen a band. Card luck: the landing is a new piece in `crateFor`'s pool once learned; try
`BALANCE_CARD_SEED`.

## 7. The phone UI

- **Tray.** A **Water** shelf in Industries (Landing, Harbour, Lighthouse, Ferry slip), locked tiles saying how to
  unlock them as `e2e:locked` checks. No boats in the tray (bought at docks).
- **Dock card** (`water-1-landing.jpg`): what's on the jetty, Automatic, **Boats here** (one chip per boat, its
  route colour, tap to open it) and **+ New barge**. Same card as a warehouse's, one row more.
- **Boat card** (`water-3-barges.jpg`): the engine card's layout: name (tap to rename, as engines), "tug and 3
  barges", "Carrying 12 of 12" with goods icons, a status line ("Going to Foxley Quay"), route chips, ✎ Route, + Barge,
  Go/Stop. Every target 44 px; fits at 360 px.
- **Route planning** (`water-2-plan-route.jpg`): the route roadmap's planning bar unchanged; only docks on the boat's
  water are tappable and numbered; the ribbon is drawn on the water. Undo works as for trains.
- **Harbour card at sea** (`water-4-sea.jpg`): "Cargo ship in, loading: takes 24 loads, and pays a town's full price.
  Next ship in 1:15", and the lighthouse's effect when one is near.
- **A train on the ferry** (`water-5-ferry.jpg`): its card says where it is and when it's back; "⛴ Abroad" is a stop
  chip like a town's. The map's markers (`map-markers.ts`) show it at the slip while it's away.
- **The Lines view** lists boat routes with trains, a ⛴ on their row.
- **Words** for children: "landing", "jetty", "barge", "tug", "ship", "abroad". Never "dock node", "cargo transfer".

## 8. Performance

Everything follows AGENTS.md: render on change, ambient only when seen, nothing while paused or idle.

- **Sim.** A boat is a number (distance along a cached polyline) moved on the sim tick: no physics body, no per-frame
  allocation. Water ways are found when a route or the land changes, cached by (dock, dock, land revision) as
  `HarbourTrade.ways` does today. A train on the ferry is taken off the track (`removeTrain`, kept aside) and put back
  on its return, so it costs nothing while away.
- **Frames.** A moving boat in view asks for frames at `AMBIENT_FRAME_MS` (15 a second) when nothing else moves:
  boats are slow, so 15 is smooth enough, and trains and the camera keep 30. A boat too small on screen
  (`AMBIENT_MIN_PX.boat`) or out of view asks for none, and marks shadows stale for the next drawn frame, as
  `BoatsView` does. A tied-up boat costs nothing. The lighthouse beam is a `blade`-class ambient motion.
- **Draws.** A tug and three barges: the tug model (shared geometry) plus one merged mesh per barge with its heap
  (the hoppers' heap geometry, the shared wood material): about 5 draw calls a boat, no new shader program. A cap of
  4 boats per dock and 12 on a map bounds it. A cargo ship and the ferry are one model each.
- **Paused**: boats are placed from the sim's time, so nothing moves and nothing is drawn.
- **Measure**: add a river with two landings and a tug sailing to the perf harness's `late` map; idle frames 0 with
  every boat tied up; pan and paused numbers within `tools/perf/budgets.json`, or the budgets updated in the same
  commit with why.

## 8b. The assets (design pass, 2026-11-04)

The user liked the direction (the recommended picks included) and asked for a pass on the models before the build,
with one note: **the blue felt under boats should be smaller.** The models are built in code, as catalogue assets
(`src/catalogue/assets/water.ts`, prefix `water-`, on Sandbox's Vehicles → "River and sea" shelf), and the pictures
show them at their own size on a real Game map (`SCENES=./water-assets.mjs node tools/shots/water-mock.mjs`, with
`FELT=before` for the before pictures).

**The felt.** Every boat used to stand on a round felt pond (`water(k, r)`, 42–76 mm across) that spilled over a
river's banks and onto the sand. Now `boatFelt` (`boat-parts.ts`) lays blue felt in the hull's own shape, 5 mm past it
all round. The round pond stays only in the catalogue's viewer (an underlay, left out in the game). This applies to
all nine existing boats too (rowing, sailing and fishing boats, tug, paddle steamer, car ferry, cargo ship, submarine,
seaplane), so Sandbox's boats on rivers change with it.

| Before | After |
|---|---|
| `docs/agents/shots/water-felt-before.jpg` | `docs/agents/shots/water-felt-after.jpg` |
| `docs/agents/shots/water-sea-before.jpg` | `docs/agents/shots/water-sea-after.jpg` |

**Sizes.** Boats are at the trains' scale: a wagon is 80–96 mm, so a barge is 88 mm and holds 4 loads (a wagon 3).
The river is about 108 mm wide.

| Asset | Size (mm) | Look | Picture |
|---|---|---|---|
| River tug (`water-river-tug`) | 70 × 30, 25 high | Red hull with a black band, low cream cabin with a red lid (low enough for any bridge), stubby funnel, rope bow fender, tyre fenders, a towing post and a train's magnet coupler at the stern, a yellow flag | `water-asset-tow.jpg` |
| Barge (`water-barge`, `-logs`, `-stone`, `-coal`, `-grain`) | 88 × 34 | Green hull with a beech rim and a dark open hold, magnet couplers at both ends (they couple as wagons do), four bollards. Loads: logs with pale cut ends, loose rocks, a heap of coal or grain (the hoppers' heap idea) | `water-asset-tow.jpg`, `water-asset-landing.jpg` |
| River landing (`water-landing`) | 168 along the track, 110 deep | A siding (the slab real track joins), a plank quay level with the rails, a stone edge, a jetty on piles over the water, a yellow hand crane swinging over it, a cream goods shed with a red roof, crates and logs waiting, a lifebuoy and a lamp | `water-asset-landing.jpg` |
| Cargo ship (`water-cargo-ship`) | 240 × 56 | Navy hull with a red bottom and a beech deck, 40 containers in eight colours, a white bridge at the stern, an orange funnel, a bow mast. About a train long, so 24 loads looks right (the old 130 mm one stays for Sandbox) | `water-sea-after.jpg` |
| Train ferry (`water-train-ferry`) | 320 × 72 | White hull with a blue stripe; 270 mm of track on deck (an engine and two wagons) between white sides, open at the stern with yellow ends, a red buffer; a tall wheelhouse at the bow over the train, a yellow funnel | `water-asset-ferry.jpg` |
| Ferry slip (`water-ferry-slip`) | pier 150, ramp 60 | Stone pier carrying the track out, a hinged ramp (yellow sides) on chains from a red frame, three-pile dolphins each side, a red/green light, a hut beside | `water-asset-ferry.jpg` |
| Lighthouse (`bldg-lighthouse`) | as is | Red-and-white striped, on a stone base; its beam already turns. It fits the toy look as it stands, so no change | `water-sea-after.jpg` |

Points for the build: the landing and slip models replace the harbour stand-in of the first mocks; the barges' loads
are a named child (`load`) so the game swaps it as a hopper's heap; the ferry's deck track is a `trackSlab`, so the
game's real track and train sit on it (the picture puts the game's own car models on it). Draw cost: each model is
baked by the prop library into a few merged parts with shared materials (no new shader programs).

## 9. Build order (each lands alone, with an e2e on the player's path that checks the payoff)

1. **Boats under routes (M).** A `Boat` in the economy (id, dock, barges, load `Bag`, `Route`), moved on the sim tick
   along cached water ways; loading and unloading at a dock through the same rules as a car at a depot. Unit tests:
   a boat delivers logs from one landing to another; it waits at a busy jetty; paused, it holds still; saved and
   loaded, it's where it was.
2. **Landing and River barges (M).** The landing depot (model, bank snap, Takes filter), + New barge on its card, the
   boat card, planning limited to its water, the tray's Water shelf, the row moved to tier 2, the goal. e2e
   `e2e:water`: a landing dragged out, a barge bought, a route of two landings by taps, logs carried and delivered to a
   town by a train from the far landing (the payoff), 0 idle frames with the boat tied up.
3. **Cargo ships (S–M).** A ship bought at a harbour; the harbour's visiting boat replaced by the ship once learned
   (24 loads, full price). e2e: planks dropped at the harbour, the ship takes them, coins rise by the town's price.
4. **Lighthouse (S).** Placed near a harbour; its next ship comes at half the wait. Unit test on the timer; the beam
   under the ambient rule.
5. **Train ferry (M–L).** The slip, "⛴ Abroad" as a stop, the train lifted off while away, paid on leaving, filled
   with imports on return. e2e: a train with planks routed to Abroad comes back with goods and coins rose.
6. **Balance (with 2, 3 and 5).** Sweeps and tables as §6.

## 10. Decisions for the user

1. **How boats are routed.** A1 the same route card as trains (recommended), A2 a landing picks a partner, A3 boats
   stay automatic.
2. **Docks.** B1 a small new landing for rivers plus the harbour for the sea (recommended), B2 harbours only.
3. **What barges carry.** D1 bulk only (logs, stone, coal, ore, grain), ships take anything (recommended), D2
   anything.
4. **The ferry.** E1 a ferry that takes a whole train abroad and back with goods (recommended), E2 a ferry between
   two slips, E3 not now.
5. **When water opens.** G1 river barges at tier 2 (about an hour in), the sea at tier 3 (recommended), G2 all at
   tier 3.
6. **Low bridges.** F1 boats pass under every bridge (recommended), F2 low bridges stop barges.

Settled without asking (say if not): goods change at a shared jetty pile (C1); boats are bought at a dock, not
dragged from the tray; boats are kinematic, saved, and paused with the game.

## 11. As built (2026-11-05, `claude/water`)

The user picked A for all six (§10) and asked the cargo ship to hold its containers better (raised sides and a hold:
`docs/agents/shots/water-ship-{before,after}.jpg`). What changed from the design while building:

- **The landing is a kit** (`kit-landing`, src/track/kits.ts): the catalogue model on real track, its depot a store
  (`landing`, as a warehouse: its Takes rows on its card). Its quay's back needs dry land; its edge and jetty may stand
  on water (`LANDING_WET`), and its jetty must reach the water (`landingWhy`, a few steps out): so a finger's drop
  anywhere the bank fits takes, not a millimetre's. Boats tie up at the first water out from its jetty.
- **A boat's card is its own** (src/ui/boat-card.ts), laid out as the engine card, not the engine card itself: route
  chips (a tap changes Drop and pick up / Pick up / Only drop; ✕ while planning), ✎ Route / Done, + Barge, Go/Stop,
  Sell. Planning goes through the train planner's own hook (`Interaction.onPickPlace`). New stops: the first Pick up,
  the rest Only drop. No undo for boat routes yet, and no ribbon on the water (the stops' chips say the route).
- **The ferry holds the train where it stands** (`Economy.held`: its speed cap 0) and draws a copy on the ferry's deck,
  rather than taking it off the track: nothing in the sim or the routing changes for a trip. Imports are paid for at
  a town's price (as many as the coins go to), so a trip isn't free money.
- **Goals**: both are allowlisted in the goals play-through (its player builds no landing, and Cargo ships needs River
  barges): their player's path is `npm run e2e:water`'s.
- **Not built**: Lines view rows for boats, the map markers for a train abroad, a landing's goods drawn on its jetty
  (the card counts them), the perf harness's river map (the e2e checks 0 idle frames with boats tied up instead).
- **Yards (added 2026-11-05, the user):** boats are built, not bought. A boatyard on a river bank builds a tug and a
  barge (20 planks, 4 iron) or a barge (8 planks); a shipyard by the sea builds cargo ships (30 iron, 20 planks, 6
  tools) and train ferries (20 iron, 16 planks, 4 tools), from goods trains bring. The yard's card says what's being
  built and what's still to come by train; the hull stands on the ways (keel and ribs, then planked) and slides
  sideways into the water when it's done. River barges brings the boatyard; a new Shipyards row (tier 3) brings the
  shipyard, and Cargo ships and Train ferry need it. Pictures: `docs/agents/shots/water-build-03-yard-building.jpg`,
  `-04-launched.jpg`, `-09-shipyard-building.jpg`.

