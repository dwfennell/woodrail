# Game mode expansion: goods chains, town baskets, a wider tech tree

Status: agreed direction (2026-10-14). Phases A and B are built (see "Built" at the end); later phases are a plan.

Builds on `2026-10-13-game-economy-design.md` (toy box, workshop, blueprints, coins, towns that want things).

## Why

Game mode has one chain (forest → sawmill → planks) and everything costs planks. The first city comes at about
20 minutes and then there is nothing new to want. Hoppers and coaches can be unlocked but have nothing to carry.
More kinds of goods give towns new wants, idle wagons a job, and the blueprint board new lines, without many more
track pieces.

## Decisions

1. **Town wants are one-off targets.** A level asks for a basket of goods; deliver it and the town grows. Towns never
   shrink and nothing is used up over time (★ levels may later "keep wanting" gently).
2. **Trains sharing a line wait for each other automatically** before any signals. Signals come later, optional.
3. **A kind of wagon per kind of goods** (Brio-like, a choice to make). Mixed wagons may come later.
4. **Phase A first** (recipes, the farm chain, town baskets, harvesters), then a wider expansion.

## One rule for industries: near their resource

An industry is placed from the Industries tab like the workshop and sawmill. Some must stand near a resource, and work
faster the more of it is around them. Each is a row of data:

| Industry | Must be near | Takes | Makes | Rate |
|---|---|---|---|---|
| Workshop | anywhere | planks | toys, blueprints | (crafting) |
| Sawmill | anywhere | logs | planks | fixed |
| **Harvester** (forest yard) | trees | — | logs | trees within reach |
| **Farm yard** | crop fields | — | grain | crop squares within reach |
| **Mill** | anywhere | grain | flour | fixed |
| Quarry (B) | rocks / hill sides | — | stone | rock squares within reach |
| Mine (C) | ore (new map feature) | — | coal, ore | ore squares |
| Foundry (C) | anywhere | coal + ore | iron | fixed |
| Toy factory (D) | anywhere | planks + iron | toys | fixed |

The placement card says why a spot won't do ("Needs trees nearby: 3 of 6"). The rate shows on the depot card.

## Goods and wagons

| Goods | Wagon | Picked up at | Wanted by |
|---|---|---|---|
| Logs | timber wagon | harvester | sawmill |
| Planks | timber wagon | sawmill | towns, workshop |
| **Grain** | hopper | farm yard | mill |
| **Flour** | **van** (new car) | mill | towns |
| Stone (B) | hopper | quarry | towns, workshop |
| Coal, ore (C) | hopper | mine | foundry |
| Iron (C) | flat wagon | foundry | towns, workshop, factory |
| Toys (D) | van | factory | cities, export |

Deliver to (on the engine card) works for every kind of goods.

## Town levels: a basket per level

Shown on the town sign as icons with bars. Phase A table (B–D add stone, iron, toys):

| Level | Wants | Houses |
|---|---|---|
| Hamlet → Village | 4 planks | 2 |
| Village → Town | 8 planks | 3 |
| Town → City | 14 planks, 6 flour | 3 |
| City → City★ | 22 planks, 12 flour | 4 |

Flour starts at Town → City (built that way): the early game stays the planks-only starter line, which reaches a town
in about 15 minutes; the farm chain is the mid-game goal rather than a wall at Village.
| ★ levels | ×1.5 each | 4 |

Rewards stay: a blueprint choice, coins per unit delivered (each kind of goods has a price), and later a landmark
building per level (town hall, market, school).

## The blueprint board: lines

Phase A adds an **Industry line** from the workshop: **Harvesters** → **Farming** (farm yard + hoppers) → **Mills**
(mill + vans). Hoppers move from Junctions to Farming. Later lines:

- Track: Switches → Loops → Junctions → Crossings → Signals → Tunnels
- Heights: Bridges and ramps → Risers → Viaducts → Tunnels
- Rolling stock: Timber → Hoppers → Vans → Coaches → Big engine
- Industry: Workshop → Harvesters → Farming → Mills → Quarry → Mine → Foundry → Toy factory → Rail link / Port
- Logistics: Deliver to (done) → Train orders → Signals → Warehouses

Costs climb the chains: early blueprints cost planks, later ones stone and iron.

## Mechanics, in build order

1. **Recipes as data (Phase A).** Depots take any inputs and make any outputs: a `RECIPES` table per depot role
   (inputs, outputs, seconds, pile caps), piles per kind of goods, and `canCarry(car, goods)` per wagon. A new
   industry is then a table row and a model. Shared with Sandbox (the economy is common): agreed with that session.
2. **Industries near resources (A).** A placement rule and a rate from the resource count within reach, cached per
   depot and recounted only when the land changes there.
3. **Town baskets (A).** Wants per kind of goods, signs with several bars, prices per kind.
4. **Train orders (B).** A list of stops with load / unload at each, building on Deliver to.
5. **Trains wait for each other (B/C).** A train stops short of another on its way instead of meeting it; signals
   later.
6. **Map-edge rail link and ports (D).** Sell goods for coins; import what the map lacks.

## Phases

- **A:** recipes, harvesters, farm yard → mill → flour, hoppers and vans, town baskets.
- **B:** quarry and stone, train orders, warehouses.
- **C:** mine, foundry and iron, trains waiting for each other, tunnels, the big engine.
- **D:** toy factory, rail link and port, ★ levels as the endgame.

Aim: two to three hours of play before a map runs out, the first city still at about 20 minutes.

## Models (Asset Gen)

Phase A: harvester yard hut (reuses the forest hut), farm yard (silo and grain chute), mill (windmill or watermill),
van (a closed wagon), grain load in a hopper (a heap, by fill), flour sacks (a unit, like a plank bundle).

## Performance

Production stays in whole sim ticks; resource counts are cached per depot and only recounted when their squares
change; town signs redraw when a count changes. No per-frame work is added.

## Built

**Phase A:** recipes as data; grain and flour; harvesters, farm yards and mills near their resource; hoppers and the
goods van; town baskets (flour from Town → City).

**Phase B:**
- Stone and quarries (by hillside); a city wants 10 stone to grow to City ★.
- Town landmarks (data: `game/landmarks.ts`), going up as a town grows: a **school** at Village (a blueprint idea
  every 4 minutes of play), a **market** at Town (half again for deliveries), a **library** at City (opens the
  advanced blueprints: Quarries). They're the research buildings: what you can learn grows with your towns.
- Train routes on the engine card: stops in order, each Drop / Pick up / Both. A routed train works only at its stops
  and sets the switches ahead toward its next one. Replaces "Deliver to".
- Warehouses: every good, 24 of each, for routed trains (Drop or Pick up stops).
- Towns take only what they still want for their next level (Game mode), so one train serves every town on a line.

**The grand tour** (`src/play/grand-tour.test.ts`) plays it all on the starter map: Larkfield a town at 5 min (school,
market), a city at 13 (flour from a farm yard and mill on the line; its library), 10 stone from a quarry on a switched
branch by a routed train in 6 min, flour kept in a warehouse and brought by a routed van, and City ★ at 52 min.

**Found on the way (to do):**
- Two trains on one line meet head on and turn each other back, again and again: the line needs passing places, or
  trains that wait for each other (Phase C's "trains wait").
- A train put down touching another couples to it, and the joined train follows the first engine's route.
- Coins pile up (markets pay most of them) with little to spend them on but land: something to buy (Phase D's trade).
- Fields are few on most maps, so farm yards often work at half speed.
