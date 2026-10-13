# Woodrail — Game Mode: Towns, Crafting and a Tech Tree (Brainstorm)

**Date:** 2026-10-13
**Status:** Brainstorm. Nothing here is locked in: it collects ideas from the chat so far, to react to and change.
§13 lists the starting points chosen on 2026-10-13, each to tune in play.
Numbers are placeholders, and §13 lists what's still open.
**Builds on:** `2026-10-12-title-and-modes-design.md` (modes, goals), `2026-10-11-depots-and-cargo-design.md` (cargo,
depots, automatic loading), `2026-10-12-expandable-world-design.md` (plots, buying land)

## 1. Intent

Woodrail is a good toy today. Game mode should make it a game, without losing the toy. It borrows from three games:

- **Factorio:** supply chains you build and then improve; the goods you make are what you spend.
- **OpenTTD:** towns that want things and grow when they get them; where to put the line and the industries is
  the game.
- **Minecraft:** a world to explore, where new land brings new things to find, and nothing stops you building.

Add a touch of trading: trains that leave the map and come back, and ships at a port. It also keeps a little of a
puzzle game: what's the best railway you can make from the pieces you have?

The players range from an 8-year-old to a 40-year-old. The rule for that is **low floor, high ceiling**: everyone plays
the same game, and depth comes from doing it *better*, never from rules that block you.

- **For an 8-year-old:** build a loop, watch logs turn into planks and planks into new track, see a town grow, and
  pick a shiny new thing.
- **For an adult:** choose what to unlock, where to put each industry, and how to make a limited box of pieces carry
  the most cargo.

**Sandbox stays the toy:** every piece, no costs, no rules.

### Rules every part keeps

1. **You can't lose, and there is no timer.** Things only get better.
2. **Everything you own is something you can see:** a pile of planks, a wagon load, a piece in the toy box, a town
   that has grown. No hidden numbers.
3. **You can't get stuck.** Forests regrow forever. Picking up a piece you laid puts it back in the toy box (a full
   refund). Coins can always import basic goods, and with nothing at all a free care package comes in (§8).
4. **Unlocking is not owning.** Unlocking something lets you make it; each one you make costs materials.

## 2. The loop

```
 supply chains  ──goods──▶  towns  ──growth──▶  a choice of what to learn next
      ▲                       │                          │
      │                     coins                        ▼
   build more  ◀──goods──  workshop / industries  ◀──  blueprint board (paid in goods)
```

1. Towns ask for goods.
2. You build a railway and industries to carry them there.
3. Deliveries grow towns. Each growth offers a choice of what to learn next.
4. Learning is paid in goods, at the blueprint board.
5. What you've learned, you make, at the workshop (pieces) or on the map (industries), again paid in goods.
6. The new things open new chains and new towns' needs. Repeat.

## 3. Three resources

| Resource | Earned by | Spent on |
|---|---|---|
| **Goods** (logs, planks, iron ore, iron, coal, …) | your supply chains | pieces at the workshop, industries, learning at the blueprint board |
| **Town growth** | delivering what towns want | each growth is a choice of what to learn next |
| **Coins** | towns pay for what they get; exports (§8) | land, and imports of goods you don't make yet (§8) |

Coins are the go-between, not the score. A pile of coins does nothing on its own. They're for getting past a gap
(no iron mine yet: import iron) or for growing the map.

### Where goods are kept

Goods are kept at the depots that hold them: a sawmill's plank pile, the workshop's yard. **The stock** is all of
them together. Spending takes from the nearest pile that has the goods. The cost card shows what will be taken and
from where, and the crane takes it (it's a visible move, not a number going down).

Goods that aren't in a pile can't be spent; on a wagon they're cargo. So a stock that has to be moved by train is
part of the game.

## 4. Goods and chains

Each chain is a few rows in the existing cargo table (depots-and-cargo §2: "later kinds are rows, not code paths").

| Chain | From (found, §6) | Made at (built, §7) | To |
|---|---|---|---|
| Timber | Forest → **logs** | Sawmill → **planks** | towns, workshop |
| Iron | Iron ore seam → **ore** | Smelter (ore + coal) → **iron** | workshop, towns (later) |
| Coal | Coal seam → **coal** | — | smelter, engine shed |
| Passengers | towns → **people** | — | other towns (no industry: a coach and two stations) |
| Mail (later) | towns → **mail** | — | other towns |
| Farm (later) | Fields → **grain**, **milk** | Mill, Dairy | towns |

The first release has timber, iron and coal, plus passengers as a side branch.

Wagons: the timber wagon (exists), the coal hopper (exists, decorative today; it becomes the ore and coal wagon) and
coaches (exist, they carry people).

## 5. Towns: needs and growth

- **Needs:** each town's sign shows what it wants now (one or two goods icons) and a fill bar. A small town wants
  planks; a grown one wants iron, coal or visitors.
- **Growth:** when the bar fills, the town grows a level.
  - Visibly: new houses from the catalogue appear on its streets, and the station gets longer or its canopy grows.
  - Its needs step up: more of the same, or a new good.
- **Levels:** hamlet → village → town → city, and on: demand keeps rising, and the number of levels follows the tech
  tree. The look of each level comes from the catalogue towns (`src/props/towns.ts`) and the roads branch's street
  plan (§12).
- **Later, growing up:** when a town runs out of room to spread, it could grow taller (bigger buildings on the same
  streets), which needs new goods. An avenue to explore once the first levels work.
- **Pay:** a town pays coins for each delivery. It pays more for something it needs now than for something it
  doesn't.
- **Visitors:** passengers who travel from one town to another pay a fare in coins when they arrive, alongside
  exports. They are a second way to earn, not what grows towns.
- **A choice:** each growth offers **two things to learn**, side by side on cards. Pick one and the other stays
  available later (§6). A child gets a fun choice; an adult gets a real one.
  - Example: "Iron mine + switches" or "Passengers + coaches".

## 6. Learning: the blueprint board

- The **blueprint board** opens from the HUD. It shows the tech tree as a drawing board: what you've learned is
  painted toys; what you can learn next is pencil sketches with their price; what's further off is faint outlines.
- **Learning costs goods,** delivered to the workshop (like Factorio's science packs, but they're your own cargo).
  - Example: Bridges: 10 planks + 5 iron.
- **What's offered:** a town's growth adds its two choices to the board. The one you didn't pick stays on the board,
  so nothing is lost by choosing. Choosing sets the order you get things in, not what you can ever have.

### First tree (a sketch to tune in play)

```
 Start: straights, curves, buffers, engine, timber wagon, sawmill (one placed)
  ├─ Turnback buffers ── Switches ── Three-way, Y, crossings
  ├─ Ramps and risers ── Bridges ── Curved bridges
  ├─ Iron: ore mine, coal mine, smelter, hopper wagons ── Diesel engine
  ├─ Passengers: coaches, longer platforms ── Mail
  └─ Second workshop line (makes pieces faster) ── Engine shed (makes engines)
```

### Finding resources (land)

- Natural resources are **generated**: forests, ore seams, coal seams, fields. Geography is fixed and makes each map
  different.
- Some are only on land you don't have yet. **Buying a plot** (expandable-world §7) now costs coins, and the plot's
  card says what it brings before you buy ("Iron ore, one town").
- Discoveries are announced: "New: iron ore near Ashcombe!"

## 7. Building industries

- **Industries are built** once learned: sawmill, smelter, workshop line, engine shed.
- **The first sawmill is generated** (as now), so the first chain works from the start.
- **Placing:** drag the industry from a new **Industries** tab onto flat ground. It snaps to the grid and faces a map
  direction like a station. It's a fixed track piece once placed, with both ends free to connect, as depots are now.
- **Where to put it is the decision.** A sawmill beside the forest means short log runs and long plank runs; one in
  the middle of the towns, the other way round. A second sawmill means faster planks, at a price.
- **Help for young players:** while you hold an industry, good spots glow faintly (near its inputs, flat, reachable).
  You don't have to use them.
- **Cost:** in goods, shown on the tray item. Example: sawmill 30 planks; smelter 20 planks + 10 ore.
- **Moving or removing** an industry gives everything back, along with its piles.

## 8. Coins, import and export

### Coins

- **Earned** from towns, per delivery (§5), from passengers' fares, and from exports.
- **Spent** on land (plot prices rise gently with the size of your land) and on imports.
- Coins show as a stack of toy coins by the logo, not just a number.

### The world beyond the map

The map isn't the whole world. Goods go out to it and come in from it, and you can watch it happen.

- **Rail links:** a few points on the edge of your land have a **portal** (a tunnel mouth in a hillside, or a
  signal box and a "To the city" sign).
  - It's a fixed track piece with one end free.
  - A train that drives in is off the map for a while (a whistle fades away), then comes back.
  - When you buy land beyond a portal, the portal moves out to the new edge.
- **Ports:** a harbour on a wide river, generated like a depot. Maps should also get a **sea edge** (a new kind of
  plot along one side), with a bigger harbour and bigger ships.
  - Ships sail in on the water, tie up and are loaded or unloaded by the harbour crane, then sail away. They're
    toy boats with a stack of cargo on deck.
  - A ship comes on its own schedule. It's a visitor you plan around, not something you drive.

### Export

Send surplus away for coins. Rail links and ports post **orders** on their card, for example "A ship is coming for 12
planks, paying 40". There's no deadline: the order waits until it's filled. Prices differ by place and change slowly,
so an adult can chase the best price while a child just sends a train of planks off the edge and gets coins.

### Import

Buy goods you don't make yet. They arrive **physically**:

- by a train that comes out of a portal and stops at its buffer;
- or in a ship's hold at the port.

You still carry them to where they're needed. This replaces a magic market: an import is a delivery to plan a
line for, and it's always dearer than making the goods yourself.

Imports also help with a missing resource. A map without iron ore can still build bridges, by importing iron through
the port, so every map can reach the whole tree. A map *with* iron ore is cheaper to build on, which is what makes maps
feel different.

### Never stuck

If you have no planks, no pieces and no coins, the nearest portal always offers a small free delivery of logs, a
"care package". That keeps rule 3.

## 9. The toy box and the workshop

- In Game mode, the tray is your **toy box**: each piece shows how many you have. The tray shows everything you've
  learned; a piece you have none of is faded, and dragging it shows what it costs to make.
- **The workshop** is a depot (generated near the starter towns, like the first sawmill). It takes planks (and later
  iron) and makes pieces, one every few seconds, into the toy box. A small queue card says what it makes next:
  "Keep 10 straights in the box", "Make 2 switches".
- **Free pieces (to start with):** straights, curves and buffers are free and unlimited, as in Sandbox. Only special
  pieces are made at the workshop and counted. If the opening feels too easy, plain track could cost a plank later.
- **Starting box:** two turnback buffers and one timber train.
- **Prices (a sketch):**
  - switch: 3 planks + 1 iron;
  - bridge: 4 planks + 2 iron;
  - timber wagon: 4 planks + 1 iron;
  - engine: made at the engine shed (§6): 4 iron + 2 coal.
- **Picking up** a piece puts it back in the box. Undo after a placement gives the piece back as well.

## 10. Seeing what's on the map

- **Map view:** a HUD button lifts the camera to a top-down view with large, clear icons over everything that matters:
  - towns, with what they want now;
  - resources (forest, ore, coal), and what's on unexplored land for sale;
  - your industries, with their stock.

  Tap an icon to fly there and open its card. This is the whole-map version of the goals' "Show me".
- **Stock card:** tap the coins or the toy box icon to see your goods by kind and where each is kept.

## 11. Tutorial, Challenges and the goals today

- **Tutorial:** today's 13 goals become a short tutorial of about six steps. It ends by pointing at the first town's
  need, and from then on the towns' needs lead the game:
  1. join two towns;
  2. put a train on and get it moving;
  3. load logs;
  4. deliver planks;
  5. make a piece at the workshop;
  6. choose what to learn.
- **"Show me"** stays on the tutorial steps and on town needs.
- **Challenges:** set aside for now (Sandbox and Game are enough to work on). The idea, for later: small hand-made
  maps with a fixed box of pieces and a task, scored one to three stars.

## 12. Coordination with other branches

- **Roads (`roads`):** town growth adds buildings on the town's street plan (`planTown`, `Building.front`). Growth
  should ask the street plan for the next building lot rather than place houses itself. Agree the interface before
  stage 2.
- **Sandbox assets (`claude/bold-bohr-fvqt5w`):** grown towns use catalogue houses (`src/props/towns.ts`), and the
  Industries tab joins the tray (`tray-catalogue.ts`, Game mode only). Changes to the tray are additive and gated by
  mode.
- **Saves:** Game mode's save gains the stock, coins, learned items, town levels and needs, and the workshop queue. It
  stays under `woodrail.game.v1` with a version bump; Sandbox's save is unchanged.

## 13. Starting points (2026-10-13), to tune in play

1. **Plain track is free.** Straights, curves and buffers are free and unlimited; only special pieces cost goods.
   Plain track could cost a plank later if the opening is too easy.
2. **Industries go anywhere** on flat ground. Marked lots stay an option if placing feels aimless.
3. **Towns grow from deliveries.** Passengers pay a fare in coins as visitors, a second way to earn beside exports.
4. **Demand keeps rising.** How many levels follows the tech tree; growing taller once a town runs out of room is a
   later avenue.
5. **No Challenges for now.** Puzzles aren't a priority.
6. **Ports on wide rivers first,** and add a sea edge to maps.

Still open: the first tree's exact contents and prices, how fast towns' demand rises, and whether coins buy land or
land opens up with growth.

## 14. Performance

The AGENTS.md rules hold:

- **Needs and growth** are checked on deliveries, not every frame.
- **The map view's icons** are a few sprites drawn only while it's open.
- **Growth rebuilds** only the town that grew (its buildings and, if its plan changed, its streets).
- **Stock, coins and costs** are plain numbers in the economy core, updated on events.
- **Trains and ships off the map** are a timer each, with nothing drawn or simulated while they're away. Ships move
  along a fixed water path, only while they're in view or due to arrive.
- **The good-spot glow** for placing an industry is worked out once when the industry is picked up, not on every
  pointer move; moving the piece only shows or hides it.
- Measure idle CPU and frame time before and after each stage, with the numbers in the commits.

## 15. A possible order of work

If this direction holds, one way to build it, each stage playable on its own:

1. **Map view + town needs and growth.** Towns show needs and grow visibly; Show me and the map view point at them.
   No costs yet.
2. **Stock and toy box.** Piece counts, the workshop making pieces from planks, refunds on pick-up, the starting box.
3. **Blueprint board.** Growth offers choices, learning is paid in goods, the first tree (switches, bridges,
   turnback).
4. **Iron and coal.** Ore and coal seams on the map, the smelter as the first buildable industry, the Industries tab.
5. **Coins, import and export.** Pay per delivery, land costs coins, rail portals with orders and imports.
6. **Ports and ships** on wide rivers, then a **sea edge** for maps (depots-and-cargo §11 and life-on-the-line's
   "Later" both list ships).
7. **Tutorial rewrite** from the goals.

Every stage keeps Sandbox as it is.
