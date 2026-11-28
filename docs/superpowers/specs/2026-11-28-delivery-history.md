# Delivery history

2026-11-28. The user: "it would be interesting to see a history of a given train/boat's deliveries (pickups and
dropoffs) ... would be cool to know the intended destination of each delivery when available."

## Today

A train's card says what it carries now and where it's heading; a boat's card the same. Nothing says what it did: where
its logs came from, what a drop paid, whether a line pays its way. The economy already moves goods one unit a crane move
(`Economy.work`: `unloadOne`, `loadOne`), riders one a rider step (`ridersStep`), and a boat's goods all at once at a dock
(`Fleet.serve`). Those are the only events the log listens to.

## What's kept

A log a vehicle: a train's by its engine (`trainKey`, the lowest engine car id, which outlives turning, coupling and a
save), a boat's (a tug and its barges) by its id. `HaulLog`, `src/economy/history.ts`, owned by the economy
(`Economy.history`).

- **A visit** is one call at a stop: the game time it began (the session clock, `Game.simSeconds`: the Journal's and the
  calendar's), the stop (a depot), and its lines. A train's visit ends when it sets off (`departed`); a boat's is the dock
  it served. Only visits where something moved are kept.
- **A line** is one good moved one way at that visit: picked up or dropped, the good (any cargo, riders as people, mail
  and post as goods), the count, coins earned.
  - A pickup says where it's meant to go: on a line, the first later stop that drops it and takes it (the stops round
    from this one, as the line's plan reads them); a rider, their own place (`placePull`'s deal: `d.wants`); mail, the
    post office the line takes it to (mail and post have no addresses of their own: the line's stop is the address). A
    hand-run train or a good no later stop takes: none, and the row says nothing.
  - A drop says where it was picked up and how long it rode (seconds, averaged over the units): each loaded car (and a
    boat's each good) remembers the stop and time of its first unit aboard (`since`), a coach each stop its riders got
    on at and the first time.
  - Coins: a rider's fare as it's paid (`onAlight` returns it). A town pays for goods when it next looks at what it was
    given (`TownLife`, a moment later, by kind): each drop at a town is owed its share until then, and `paid` hands the
    coins to the drops waiting there for that good, by units.
- **Bounded.** The last 50 visits a vehicle (`LOG_VISITS`), a ring buffer that reuses the visit it overwrites; at most 8
  lines a visit (`LOG_LINES`: a ninth rider's place joins a line with no place). Drops owed coins: 32 a town at most.
- **Cost.** Nothing per frame and nothing per tick: a record is made on a crane move, a rider step, a dock. A move of the
  same good at the same visit adds to its line (no allocation); a new line is one small object; a full log reuses its
  oldest visit. The intended stop is worked out once a line, when it's made. `version` counts changes, for the view.

## Saved

Yes, bounded: a reload keeps it, and a train you've watched for an hour still has its story. On the engine car's entry
(`history`: visits as `[at, depot, lines]`, a line `[good, n, drop, place, coins, rode]`, good 31 for riders) and on a
boat's (`history`); a loaded car's or coach's `since` on the car (a boat's on the boat). Depots by their saved index, as
lines' stops are; a stop since taken up is −1 ("a place since taken up"). No new save version: older saves simply have
none. Measured on the user's map (docs/agents/reports/2026-11-27-warehouse2-full-muffin.txt): see the commit.

## The view

A sheet from the train card's and the boat card's **History** (44 px), in the sheets' look (`growth-sheet`, as Swap
engine's): its name, a summary of the last hour of game time ("Last hour: 14 loads · +212🪙"), then the visits newest
first, each a stop's row: the stop's name (a tap frames it on the map, the sheet stays), when ("2 min ago"), and its
lines: "Picked up 3 🪵 logs → Sawmill", "Dropped 3 🪵 logs from Forest · 2 min · +36🪙". Nothing yet: "Nothing moved yet:
loads picked up and dropped show here". It fits a 390×844 phone, scrolls under its head, and is drawn only when the log's
version changes while it's open (no frames: it's DOM, the map doesn't redraw for it).

## Tests

- `src/economy/history.test.ts`: recording (a line's pickups merged in a visit, the ring at 50, lines capped), the
  intended stop (a line forest → sawmill says Sawmill; a hand-run train none; riders their place; mail the post office),
  drops' origin and ride time, a town's coins shared between drops, the save round trip.
- `npm run e2e:history`: on a 390×844 phone, by taps: a train on a line forest → sawmill, its card's History, the pickup
  "→ Sawmill", the drop "from Forest" with its coins, kept after a reload; a boat's History the same.
