# Game mode: direction (rewards, how towns grow apart, the long game)

Status: brainstorm, revised with the user on 2026-10-15. Nothing here is built yet.

## The blueprint tree is the roadmap

The full web lives in the game's catalogue, `src/game/blueprints.ts`; `npm run blueprints:page` makes [docs/blueprints.html](../../blueprints.html) from it. It is also published as a
claude.ai page: https://claude.ai/artifact/JobSRZPvoV9qCExAL5G68z

- **Size:** about 105 blueprints in 12 branches.
- **Status:** each is in game, next, coming soon or someday.
- **In the game:** what isn't built yet shows on the board as "coming soon".
- **A rough plan:** nothing is committed until we build it.

## Principles

- **The heart of the game: unlock new buildings and things, and see them change how you play.** Every step should
  reveal something you haven't seen: a building, a car, a piece, a specialty. Where it can, it should also change how
  the railway plays. Plan content so each unlock has a model and, ideally, an effect.

- **Cozy.** Nothing fails, expires or wears out.
- **A clear early game.** The opening is the same on every map: timber, then planks, then a workshop, then towns that
  want planks. Variety grows from there.
- **Your choices shape your towns** more than geography does. Geography nudges; what you bring a town decides what it
  becomes.
- **Specialize, don't lock out.** Leaning into something is rewarded. Everything stays reachable.
- **Building up to something big:** a rocket (the asset exists). The details come later. You can keep playing after it.
- **Maps:** the first game is on the starter map, and later games are generated. Map generation is Game mode's, taken
  back from Roads.

## 1. Town rewards

When a town grows, it offers a reward suited to its new size:

- a village offers track
- a town offers industries and logistics
- a city offers advanced blueprints

The reward is one of:

- **One of two blueprints.** The one you pass on goes onto the blueprint board (the tech tree screen), to learn later
  at its own price.
- **A crate:** a few things you already know, free into your toy box.

Your first village, first town and first city each also give a one-off gift.

## 2. How towns grow apart

**Most hamlets start the same,** wanting planks. A few are rare towns with an unusual want and their own growth path:

- a fishing hamlet that wants planks for boats, then stone for a harbour wall
- a miners' camp that wants timber props and, later, grows around a mine
- a mill village beside a stream that wants grain from the start

Rare towns are uncommon (about one per map, sometimes none) and always reachable in the early game.

**Then towns become what you bring them.** As a town grows, each new level adds a minor specialty from what it has
received and how it's served:

- **Flour** makes a bakers' town: it wants more flour and pays well for it.
- **Stone** makes a builders' town: bigger buildings, and it grows faster with stone.
- **Many passengers** makes a market town, or a resort if it's far from industry: more people wait, and fares are
  higher.
- **Beside working industries** makes an industrial town: industries near it work faster.
- **Goods passing through a warehouse there** makes a trading town: in Phase D, better prices.

A big town collects several minor specialties over its life, its strongest first. **Each city has one major
specialty:** its strongest, which earns it a building of its own that goes up in the city (a tech building, like the
school, market and library now). For example:

- an engine works: a better workshop for trains
- a grand station
- a trading house

Rewards for specializing:

- the major specialty's bonuses are bigger
- a city's major building unlocks its advanced blueprints
- a second city with the same major specialty builds its building sooner

There's no pivot. A city keeps growing minor specialties as you bring it new things.

**Geography only nudges.** A town by fields starts slightly ahead toward baking, but your trains decide.

### Specialties to discover

**Discovery is part of the fun.** The town book lists every specialty, unseen ones as silhouettes. Your first town of a
new kind reveals it and puts up a building you've never seen.

**The major specialty is automatic:** a city's strongest. Some specialties come from what you bring a town:

| Specialty | From | Its city building |
|---|---|---|
| Bakers' | flour | Grand bakery |
| Builders' | stone | Stonemason's yard |
| Carpenters' | lots of planks | Furniture works |
| Market | passengers between towns | Grand station |
| Resort | passengers, far from industry (by water or hills) | Pier or spa |
| Industrial | working industries nearby | Engine works |
| Trading | goods through its warehouse | Trading house |
| Mining (C) | coal | Pithead |
| Ironworks (C) | iron | Foundry |
| Harbour (D) | trade by water | Harbour |
| Scholars' | many blueprints learned (its school busy) | Observatory, a step toward the rocket |

Some are rare **combinations of two minor specialties:**

- Bakers' + Market makes a festival town: a fairground with a carousel.
- Carpenters' + Trading makes a toymakers' town: a toy factory.
- Ironworks + Scholars' makes a clockmakers' town: a clock tower.

Combinations are found by experimenting and are shown only once found.

The list grows with each phase. Each new specialty is mostly data plus one model.

## 3. Blueprints with varied requirements

Each blueprint has its own mix of requirements, not one currency per line. So you can specialize and still need some
of everything:

- **Track:** mostly planks.
- **Industries:** planks and coins.
- **Advanced blueprints:** planks, plus something you've achieved. For example: an express engine needs 250 passengers
  carried and a town with a grand station; a foundry needs coins, a library, and 40 stone delivered.

This "something achieved" brings every player up to a minimum in each area, while the cheapest path follows what you
specialize in.

## 4. Building up to the rocket

Not planned in detail yet. Phases C (mining: coal, iron, a foundry) and D (trade, ports) add the goods and towns it
will need. Then the rocket asks for several major cities' specialties.

## 5. Maps (taken back from Roads)

- **Resources sometimes cluster:** forests mostly on one side, fields along a river, hills at one end. Only some seeds,
  so it stays fresh.
- **Rare towns are placed by the map** (see 2).

## 6. The tech tree, reshaped as we go

- **Three tiers by town size:**
  - village: track
  - town: industries and logistics
  - city: advanced blueprints and the major buildings' lines
- **Fold in the small blueprints:** Risers go into Bridges, and Turning loops into Junctions.

## Crafting (agreed: 1 and 2 are in the plan; 4 and 5 are optional, for later)

Leaning further into the workshop:

1. **Crafted goods as cargo.** The workshop also makes goods that leave by train:
   - furniture from planks
   - toys from planks and paint
   - tools from iron (Phase C)

   Towns at town level and up want some, so the workshop becomes part of the network, not just a menu.
2. **Benches.** A workshop gets benches, each a recipe set:
   - a carpenter's bench (planks)
   - a paint shop (paint, from a dye works using flowers or fields)
   - a smithy (iron)

   Benches are blueprints. A city's major building can be a bigger bench: an engine works is a smithy for trains.
3. **Recipes of more than planks.** Better wagons need planks and iron, and signals need iron and paint. This gives
   the later goods a use beyond towns.
4. **Craft your scenery.** Lamps, fences, flower beds, signals, tunnels, level crossings. Mostly decoration, some
   useful (signals, crossings). It's cozy, and makes the layout yours.
5. **Paint.** Paint your trains and stations with paints you've made (cosmetic).
6. **Getting better at it.** The first of a new thing takes longer; each one after is quicker (a cozy kind of
   mastery).

Recommended first: 1 and 2. They fit the specialties (carpenters', toymakers') and the rocket's parts later. 4 and 5
are a gentler side branch for later.

## Phase D: trade by water and rail (proposal, not built)

Agreed so far: harbours are depots that ships visit by themselves; goods can be bought and sold beyond the map, at
harbours and at the map's edge. Player-steered boats come later.

**Why:** coins get a use (buying goods), surplus gets somewhere to go (selling it), and a map without hills or fields
can still get iron or flour. It also opens the goods from abroad that later blueprints want: cocoa, zoo animals, rocket
parts.

### D1. Harbours

- **A depot by a river.** Its site rule is river squares within reach, the way a quarry needs hillside. It has a quay
  and a crane on the water side and a track on the land side.
- **Boats come by themselves.** A boat comes up the river from the map's edge every few minutes, stays about half a
  minute, then leaves. There's no steering or pathfinding: a boat follows the river's own line of squares. The catalogue
  already has rowing boats, tugboats, fishing boats and a cargo ship.
- **The trade happens on the quay.** A boat takes what's on the export pile and leaves what was ordered. Trains bring
  goods to the harbour and take them away like any other depot (routes work there too).
- **Boats have a capacity.** A small boat takes about 6 loads a visit. Later blueprints bring more (bigger boats, a
  lighthouse for more visits, cargo ships).
- **Dock sheds (buildable):** storage beside the quay, so goods can wait for the next boat. A harbour on its own holds
  a pile like any depot; each dock shed placed beside it adds about 12 more, up to three sheds. Trains drop into the
  sheds, and boats load from them.
- **Performance:** a boat is one animated model. Frames are drawn only while a boat is moving and in view.

### D2. Selling and buying

- **Selling:** goods dropped at a harbour go out on the boats, as much as each boat takes, paid at about half a town's
  price. Towns stay the better buyer; a harbour is for what they don't want.
- **Buying:** on the harbour's card you order goods ("6 iron, 96 coins") and they come on the next boat, at about twice
  a town's price. A standing order ("keep 6 iron here") makes it a supply line.

### D3. The mainline siding (trade at the map's edge)

- **For maps without a river.** A depot that must sit at the edge of your land, track running off the mat: "the big
  railway calls here". A mainline train comes by on its own and trades just like a boat does.
- **Different prices:** it pays a little less for selling than a harbour, so harbours stay worth building.

### D4. The trading house

- **The city building for trade.** A landmark (like the college) that goes up in a city with a harbour or siding and a
  warehouse.
- **What it does:** better prices at its town's harbour or siding (a quarter better each way), and it unlocks the next
  trade blueprints.
- **Fits the plan:** it's the Trading specialty's building, ahead of the specialties being built.

### Boats in the blueprint tree

- **Harbours:** rowing boats, 6 loads a visit.
- **Dock sheds:** storage for the next boat.
- **River barges** (after Two-arm cranes): a tugboat and barges, 12 loads a visit.
- **Lighthouse:** boats call twice as often.
- **Cargo ships** (after barges, trade and Grab cranes): 24 loads a visit, with a container crane.
- **Fishing boats** (food branch): boats go out from your harbours and bring back fish. Towns take fish as well as flour
  (a town's flour want can be met by either), so a town by the water can grow without a farm: an alternative to the
  farm chain, not a replacement.

### Later in D, or after

- A lighthouse (boats come more often), a fishing harbour (fish for towns), a lift bridge, a train ferry.
- Cargo ships and gantry cranes (containers), and an airport.
- Goods only from abroad: cocoa for a chocolate factory, animals for a zoo.
- Player-steered boats.

### Blueprint changes

- **Harbours:** keep as they are (tier 3, after warehouses and bridges, stone in the price, a town by water).
- **Imports and exports:** comes with Harbours. Buying is still open (see below).
- **New:** Dock sheds (with Harbours), Mainline siding (logistics, tier 2–3: the river-less way in), and Trading house
  (civic).

### Models wanted (Asset Gen)

- A harbour quay depot (crane, bollards), and a dock shed.
- A mainline siding: a signal box and a long platform running off the mat.
- A trading house.
- Boats are already in the catalogue.

### Order

1. Harbour, boats and selling (D1, and D2's selling).
2. Buying and standing orders (D2).
3. The mainline siding (D3).
4. The trading house and its prices (D4).

The grand tour plays each step on the starter map (it has a river).

### Decided (2026-10-15)

- Boats have a capacity; dock sheds store goods for export.
- "Wanted this season" is cut.

### Still open: when buying comes

- **Recommended: with harbours, limited to goods you've already made**, at about twice a town's price. A harbour pays
  off from the first boat, coins get a use early, and a map short of hills can still get iron once you've seen it. The
  trading house then lowers prices and adds goods from abroad (cocoa, animals), so it still unlocks something new.
- **Or: with the trading house.** Harbours start as export only, and buying is the trading house's reward. It's simpler
  to begin with, but the first harbour does less.

## Parked

- Coin rewards for growth.
- Town requests.
- Optional goals, par times and an end-of-game summary.
- Planning the rocket in detail.

## Order

1. Rewards (1).
2. Minor specialties from what towns receive (2), then major specialties and their city buildings.
3. Varied blueprint requirements (3), with the tree reshape.
4. Rare towns and map variety (2, 5).
5. Crafting 1 and 2: crafted goods as cargo, and workshop benches. These can come alongside 2, as carpenters' and
   toymakers' towns want furniture and toys.
6. Phase C, Phase D, then the rocket.
