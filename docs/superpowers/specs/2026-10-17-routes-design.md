# Routes you can see: lines on the map, cargo that knows where it's wanted

Status: proposed, design only (no code yet). Owner: Scenery (the train side: engine card, status, decouple). The
economy and depots are Game Mode's; signals and pathing are Rail and road's.

The user asked: *"I would love to improve how our route system works too... can we borrow some ideas from OpenTTD for
this? I want a loveable and powerful system for this."* They have also said they want goods hauling to be **less
finicky, not more**. The depots design set the direction long ago: **automatic by default, manual if desired**
(2026-10-11-depots-and-cargo-design.md). The game direction note adds: *cozy; nothing fails, expires or wears out*.

So this design borrows OpenTTD's **ideas** (orders, shared lines, cargo that goes where it's wanted, trains that wait
for each other) but not its **work**. Each idea has to make the railway nicer to watch and easier to run, or it stays
out.

## 1. Today's system

### How a train is told where to go

- **Routes are per engine.** A route (`economy.ts:101-115`) is an ordered list of stops, each a depot with an action:
  *Both*, *Drop* or *Pick up*. Routes live in `Economy.routes`, keyed by the engine car's id.
  - The train uses the first car that has one (`routeOfTrain`). A train with two routed engines silently uses one.
- **A routed train works only at its next stop** (`stopAt`, `:885`), plus following stops at the same depot.
  - It drives through every other depot.
  - `next` moves on when the train **leaves the stop's piece** (`advanceRoutes`), not when the work is done. A train
    run through a stop by hand still counts as having called there.
- **An unrouted train is served at every automatic depot it passes** and takes switches as they are set. The engine
  card says "Goes anywhere, works at every stop". This is the default, and it is what makes the early game
  "hands-off, satisfying".
- **Steering** (`steer.ts`) runs every 8 ticks for routed, moving trains.
  - It finds the **first** switch within 6 pieces ahead, searches for the shortest way to the next stop (turning
    back at an end costs 12 pieces), and throws that switch.
  - It throws switches for everyone. It ignores what the player set and other trains near the switch.
  - If no way leads to the stop it does nothing, and nothing tells the player.

### Depots and cargo

- **Each depot has two settings** (on its card): **Automatic** (on by default) and **Wait for a full load** (off).
  With Automatic off, trains run straight through and cargo moves only by hand.
- **Servicing** (`capFor`, `work`): a train crawls in, stops each wagon under the crane, and is unloaded then loaded,
  one unit per 0.6 s (faster with crane upgrades). Reversing the lever lets it go at once.
- **What a wagon loads** (`loadKind`): a part-filled wagon tops up with the same good. An empty wagon takes whatever
  good the train has least of, among what its kind carries (`CARRIES`).
  - Game mode towns take only what they still want for their next level (`accepts`).
  - Planks are kept back for the workshop (`reserved`).
- **Sandbox's kit stops** (track props): platforms stop passenger trains for 4 s, and services stop steam engines.
  Loaders and unloaders are depots with endless heaps or sinks.

### Editing a route

- **Where:** the engine card's route rows (`main.ts:1716-1791`). They show in Sandbox, and in Game mode once the
  **Train routes** blueprint is learned (tier 2, needs Switches; Warehouses need Routes).
- **Each stop row:** a number, a **name chip that cycles through every depot on the map**, an action chip (Both → Drop
  → Pick up), and ✕. **+ Stop** adds the first depot not yet on the route.

### What the player can and can't express

- **Can:**
  - "Visit these depots in this order, dropping and/or picking up at each."
  - "Wait for a full load at this depot", which applies to **every** train there.
  - "Don't touch trains here" (Automatic off).
- **Can't:**
  - Pick a stop on the map.
  - Reorder stops.
  - See where the train will go: there is no route drawn anywhere, and no map of the track.
  - Share a route between trains.
  - Keep a switch where they set it: routed trains throw it back. Pinning is proposed in
    2026-10-15-switch-clarity-design.md but not built.
  - Ask for "only what's wanted here".
  - Make two trains on one line wait for each other instead of bouncing.
  - Make a train skip a stop that has nothing to do.

### Where it feels finicky

1. **Choosing a stop means cycling a chip through every depot on the map.** With 12 depots, reaching the one you want
   takes up to 11 taps, and you can't see where any of them is.
2. **There is no reordering, and removing a stop can quietly change which stop the train heads for** (`next` is
   clamped, not shifted).
3. **Both / Drop / Pick up is bookkeeping.** The player has to think "drop the logs at the sawmill, pick up planks,
   drop at town", but the game already knows what each depot takes and gives. QA's Phase C fix (73bc96a) shows the
   trap: a routed train dropped coal at the foundry that was meant for the power station.
4. **Invisible routes.** You can't see that a stop is unreachable (a switch facing the wrong way, a missing piece).
   The train just runs about, and its card says "On its way to Mill" for ever.
5. **Steering fights the player.** Routed trains throw switches back with no explanation (switch-clarity note).
6. **Trains on one line bounce off each other.** The tip is "add a passing loop", but the trains still meet head on
   and turn back, so a line with two trains is messy.
7. **Wait-for-full is per depot, and it can hold a train that isn't allowed to load there.**
   - `waitsForLoad` doesn't check the route, so a train can wait at a Drop-only stop, or at a depot that isn't its
     stop at all.
   - It's untested with routes. **This is a bug to fix regardless of this design.**
8. **There's a known hole in steering:** a switch closer to the end of a line than the train is long can't send that
   train down its branch after it turns back (73bc96a).

**What works and must be kept:**
- Automatic depots.
- Unrouted trains serving everything they pass.
- Towns taking only what they want.
- "The layout is the program" for players who never open a route.

## 2. Ideas from OpenTTD, judged for a wooden toy on a phone

Scale for "fits": ✓ yes, ◐ in a small toy form, ✗ no.

| Idea | What it brings | What it costs in clarity | Fits? |
| --- | --- | --- | --- |
| **Order lists** (go to, go via, non-stop) | A train with a purpose: "this is the timber train". | Go-via and non-stop are invisible distinctions on a phone. | ✓ The stop list exists; keep it to "stop at", with "via" only implied by the drawn path. |
| **Load/unload options** (full load, any, transfer, unload all, no loading) | Precise control for chains. | A lot: four or five options per stop is spreadsheet play. | ◐ Replace with **automatic intent** (below). Keep "wait to fill" as the one visible option, per stop. |
| **Shared orders / route groups** | Add trains to a line in one tap; the line is a thing you can name and colour. | Low: it's one idea ("this train runs the Blue line"). | ✓ Lines. |
| **Conditional orders** (skip if…, go to depot if…) | Clever networks. | High: it's programming. | ◐ One built-in condition only: *skip a stop with nothing to do*, on by default. |
| **Timetables, auto-separation** | Evenly spaced trains, no bunching. | Timetables are clocks and numbers. Auto-separation is invisible and just nice. | ◐ Auto-spacing for trains on one line, with no timetables. |
| **Depot servicing, breakdowns** | Upkeep. | Adds failure and chores. | ✗ "Nothing wears out." Our sheds, water towers and wash are visits for fun. A line *may* include a service stop like any other. |
| **Path signals, one-way blocks** | Trains reserve their way through junctions and wait instead of colliding. Passing loops just work. | Medium for the builder, invisible for the watcher. | ✓ As **behaviour**, not new pieces: trains wait for each other at signals and loops. Rail and road owns the pathing. |
| **Cargo destinations** (cargodist) | Goods want a particular place. | Heavy in OpenTTD: flows, graphs, link statistics. | ◐ We already have the toy version: towns want specific goods. Make the **train** follow it, so a line picks up only what a later stop on it wants. |
| **Route colours / lines on the map** | You see the network and every train's purpose. | Low, and it's the most loveable thing here. | ✓ The heart of this design. |
| **Vehicle lists, profits, statistics** | Management. | Screens of numbers. | ✗ No profit charts. A line card may say "Blue line: 2 trains, 14 planks delivered today". |

## 3. Recommended design

The shape the CoS suggested, and I agree: **a train's route is a coloured line drawn on the track, edited by tapping
places on the map.** Underneath it is a small core that is lovely by default, with more power that turns up as the
player grows.

### 3.1 The line you can see

- **Showing it.** When a train is selected (its engine card open), its route is drawn on the track as a soft coloured
  ribbon. It follows the actual path the train will take between stops, worked out the way `steer` does but along
  the whole way. Round wooden **stop discs** stand at each stop with its number. The stop the train is heading for
  gently pulses.
- **No route yet:** the card shows the **way the switches send it**, the next few pieces ahead as a faint dotted
  ribbon. This answers "where will this train go?" for every train from the first minute of Game mode. It needs no
  blueprint and helps the switch-clarity problem directly.
- **An unreachable stop:** the ribbon ends where the way runs out, with a red dashed gap. The stop's disc gets a
  little ✕, and the card says *"Can't reach Mill: no track leads there"* (or *"…set the switch at the junction"*
  when a pinned switch or one-way signal is what blocks it). No more silent wandering.
- **Cost:** the ribbon is one mesh per line, built only when the route, the track or a switch changes. Nothing is
  drawn per frame, and only the "next stop" disc animates, while the card is open.

### 3.2 Editing by touch

- **Edit mode.** The card's **Route** button (or **Plan a route**, the first time) enters edit mode. The camera eases
  out to show the line, and depots and stations get big round tap targets (their footprints, as with
  `inStationFootprint`).
- **Changing stops:**
  - **Tap a place to add it** as the next stop. The ribbon grows to it at once, so the player sees the way.
  - **Tap a stop disc to remove it.** Long-press a disc and drag it along the list chips to **reorder**.
- **Done** (or tapping empty ground) leaves edit mode.
- **In the card:** the stop list stays as a compact strip of chips (*1 Sawmill · 2 Larkfield · 3 Forest*) for anyone
  who prefers lists. A tap on a chip flies the camera there.
- **One thumb:** every action is a tap on something big. Reordering, the one drag, is optional. The card sits at the
  bottom where the thumb is.

### 3.3 Cargo that knows where it's wanted (the "less finicky" part)

- **The default is automatic intent:** a train on a route **picks up only what a later stop on its route will take,
  and drops what this stop takes**. No more Both/Drop/Pick: the game already knows what every depot takes and gives
  (`RECIPES`, town `accepts`).
  - A Forest → Sawmill → Larkfield line just works: logs at the forest; logs off and planks on at the sawmill;
    planks off at Larkfield.
  - Coal for the power station is never dropped at the foundry unless the foundry is on the line and wants coal.
- **The old explicit actions stay as an override:** tap a stop chip, then "Only drop here" or "Only pick up here", for
  players who want them and for old saves. Most players never see them.
- **Wait to fill** becomes **per stop on a line** ("Wait here till full"), rather than per depot for every train. The
  depot keeps its own Automatic switch.
- **Skip the visit when there's nothing to do:** on by default. If the next stop has nothing to give and the train
  carries nothing it takes, the train runs through at speed, and the stop disc shows a little "nothing to do" puff.
  Lines don't crawl into empty depots.
- **Unrouted trains are unchanged.** They are served everywhere, as now. Lines are an option, never a requirement.
- **The intent rules, as Game Mode signed them off** (they own them in `economy.ts`):
  - **Later stops** are the line's other stops in cyclic order from this one, excluding this one. A loop doesn't
    pick up at A what only A takes.
  - **At a warehouse** (or any stop that takes everything), drop only what *no later stop* takes, and pick up what a
    later stop takes. Without this, logs bound for the sawmill would sit in the warehouse.
  - **The workshop's first claim on planks holds:** a train doesn't drop planks at a town while a workshop later on
    its line is short (`reserved`). With no workshop on the line, towns get them as usual.
  - **Wait to fill** is read per stop for trains on a line; the depot's own setting stays for unrouted trains.
  - **Skip-if-nothing never skips a wait-to-fill stop.** Passengers count as something to do. It's decided as the
    train comes up to the stop (a loader's pile fills over time), not once a lap.
  - **Drop and Pick override intent** per stop.

### 3.4 Lines: many trains, one route

- **What a line is.** A route belongs to a **line** (OpenTTD's shared orders): a colour, an auto name such as "Blue
  line" (renamable), and its stops. A train runs a line.
  - "Add a train to this line" is a button on the line's card.
  - Dropping a new train from the tray onto a line's track while a line is selected offers *"Run it on the Blue
    line?"*.
- **Auto-spacing.** Two or more trains on a line spread out: a train that would arrive within a short gap behind
  another waits at its stop a moment longer (up to a cap). No timetables are ever shown.
- **The Lines view.** A **Lines** button in the map view shows every line's ribbon at once, for the "look at my
  railway" moment. Otherwise ribbons show only for the selected train or line, so the toy stays a toy.

### 3.5 Trains that wait instead of bounce (with Rail and road)

Today two trains meeting head on both turn back, and the fix is a passing loop the player must understand. The
lovely version:

- **A train about to enter a single-track section another train is in (between two switches, or a signal block)
  waits at the switch** before it, its card saying *"Waiting for the timber train to pass"*.
  - With a passing loop, one takes the loop and they pass.
  - Without one, the first to arrive goes and the other waits. Nobody bounces.
- **Steering respects pinned switches** (the switch-clarity pin) and won't throw a switch that a train is on or about
  to cross.
- These are pathing and signal behaviours, Rail and road's area. This design only asks for them; they can follow the
  line work. Rail and road will write the Phase 3 detail as its own note. Their points to settle first:
  - **No deadlock.** A train claims the section ahead before it enters, first come first served. A timeout turns the
    newest waiter back (as trains turn back today), so nothing ever freezes.
  - **What a section is.**
    - Between two switches, for plain lines.
    - A dead-end stub or siding blocks entry while it's occupied, but a train inside can always come out.
    - A waiting train stands short of the switch, never on it, so it doesn't foul the other leg.
    - Turntables, depots and stations inside a section need a rule of their own.
  - **Pinned switches against passing loops.** A pinned loop switch makes trains wait rather than pass. That's
    correct, and the card says so: *"Waiting: the switch is pinned"*.
  - **Cost.** Claims are checked when a train enters a section, not every tick. The shared path search behind the
    ribbon is cached per layout revision.
  - **The card's waiting state** comes from the sim, hooked into the engine card's existing status words.
- **Built so far (Phase 3a, branch routes-cross): waiting at stops.** A routed train of a line with two or more trains,
  ready to leave its stop, waits there till its way to the next stop (route-path's `legFromCursor`) is clear of the
  line's trains coming the other way; claims are per piece and direction, let go behind the tail (see
  `src/economy/crossing.ts`). Trains cross at a stop where their ways part: a stop one direction passes without
  calling (on the other road of a loop), or two platforms. With no passing place the card says *"The Red line needs a
  passing loop"*; after 30 s the first-ready train is let go and they turn back as before (or sooner: nothing on the
  line moving for 20 s, or *Go now*). The player's line is never changed.
- **Phase 3b (built, branch routes-loops): waiting in a passing loop.** The usual line runs there and back and calls
  at every station both ways, so a loop beside a one-platform station, or mid-way between stops, can't let two trains
  cross under 3a: both must stop at the same platform. 3b splits a way into sections at passing loops between stops:
  - a way is cut at each loop it runs through (in by one switch's stem, out by the other's) where the train fits on
    the road it takes with both switches clear (its length plus 6 mm each end) and neither switch is pinned (a pinned
    switch wins: no cut, so the train waits as in 3a);
  - a train claims one section at a time: its first when it leaves its stop, the next as it comes up to the loop's
    far switch (a virtual signal: refused, it brakes at the sim's acceleration to stand on the loop's road, its front
    6 mm short of the switch). A section into a loop also needs the road it would stand on clear of the line's other
    trains, either way (so a follower doesn't run up behind a train already waiting there), and a train out of a loop
    waits for one coming out by the other road;
  - steering is given a hint (Rail and road's `steer(…, avoid)`): a loop road a train of the line coming the other
    way is on or holds, or the other road of a loop the train already holds its road in. The walks that make claims
    use the same hint, so claims match what steering does. A lone train gets none;
  - the card says *"Waiting at the loop for the Red line train"*; claims, release behind the tail, the 30 s and 20 s
    releases, Go now, and the re-leg rules carry over from 3a. Nothing is saved: a loaded train between stops claims
    from its tail (a way that starts in a loop is cut at its far switch).
  - No jam lasts (QA's B1 on 3a): a hold also ends when the awaited train turns back from meeting another, and after
    30 s in which the awaited train made no progress along its claim (moving or not); a mutual wait no longer runs
    the 20 s line-still clock. On a line with no passing place two trains then follow each other rather than one
    holding while the other bounces off it. The "Lay a passing loop" goal ticks only for a loop the line's trains can
    cross in as above (a way through it, unpinned, the road long enough for the line's longest train).
  - Not handled: a stop whose platform is itself on a loop road and every train calls there (they can't pass on one
    platform), and a train standing at a stop with its front over a loop's switch (it fouls the loop: they wait as in
    3a, then the 30 s release).
- **Phase 3c (built, branch routes-blocks): block working.** Under 3b a line with no passing place, or more trains
  than loops, still ended in the 30 s release and a head-on meeting. 3c claims whole blocks, as on a real single line:
  - **A passing place** is a usable passing loop as in 3b (a way through it, both switches unpinned, the road long
    enough for the train: its length plus 6 mm each end; steering can hold the train on it). A loop too short for the
    line's trains, or pinned, is plain track.
  - **A block** runs from where a train stands (its stop, or the loop it waits in) through every stop on single track
    to the next passing place along its route, and ends at the far switch of that loop's road. A line with no passing
    place is one block, end to end. A lift and the track either side of it are plain track in a block, never a passing
    place; a dead-end branch beyond a stop is one block with the stop.
  - **Termini and turn-backs.** A terminus is a stop where the next leg reverses (a buffer turn-back, or the route
    turning round over the stop's piece). A block that reaches a terminus ends there and includes the turn-back, so a
    train always holds the track it needs to turn round and head out again: it is never stuck unable to turn back
    into its own block. On a line with no passing place, a block that would run up to a line-mate already standing
    at the terminus stops short of it (off any switch): the train calls at the stop where it stands, turns back there
    (`Sim.turnBack`, turn cause "short") and waits for its next block like any train at a stop.
  - **Where trains wait**: at their stop when the block starts there; inside the loop, standing short of its far
    switch, when they come up to a loop; never on a switch, and never short of a stop they have work at. A stop inside
    a train's own block (on single track) keeps the claim: it calls there and goes on without asking again.
  - **First come, first served**, re-asked at the end of each tick in the order trains became ready; a tie (two ready
    in the same tick, opposite ends) goes to the lower engine id. No train enters a block holding nothing: an empty
    claim means hold. A train facing the wrong way after a meeting turns where it stands (or backs off from a mutual
    wait if its way behind is clear) and asks again. A third train is kept out of a loop when the loop's other road is
    held and a train is coming in from the other end (three trains, two roads).
  - **Stubs**: a stub is the stretch from a line end (buffer or open end) back to the first switch. A train turns
    back in it, so a train's way into a stub (from outside it) is granted only while no other train of the line holds
    or stands on any part of it, either way: one train in a stub at a time, the others waiting at the passing place
    before it. While a train is in a stub, one road of the loop fronting it is kept for its way back: a train of the
    line coming to that loop from the other end waits back at the passing place before (one waiter in the loop at
    most). Lines with no passing place for a train keep the end-to-end turn-taking above.
  - **Claims between stops** are only ever granted in `settle`: a train with none (or one gone stale) is held where
    it is and asks, like any other.
  - **The 30 s release** is only the safety net (a train held at red by hand, a lever left at stop): every release is
    logged (`Crossing.releases`, `released`) with its reason. In normal running on loop lines and no-loop lines alike
    there are none.
  - **Cards**: *"Waiting for the Red line train from X"*, *"Waiting at the loop for the Red line"* (short enough for one
    line at 360 px), and with no passing place *"Waiting its turn: the Red line has no passing loop"*.
  - **Cost**: block extents (legs) are cached per claim and target, cleared when `Layout.revision` or
    `routingVersion` changes; nothing walks track per tick. Measured crossing cost with 3 trains: 3-6 µs per tick.
  - **Saves**: nothing new is saved; a loaded train mid-block claims its block from its tail.
  - Train ids: the sim makes a new train at every turn-back (by design); crossing keys every claim by the engine's car
    id, so a turn-back never loses a claim.
  - The "Run two trains at once" goal ticks only when two trains can pass: two of a line that runs through a passing
    loop they cross in, or two on separate track (lines whose ways share no piece).

### 3.6 Game mode and Sandbox

- **Sandbox:** everything is open from the start: lines, colours, the Lines view.
- **Game mode:**
  - **From the start:** "where the switches send it" (dotted path ahead) and "can't reach" messages. Clarity is free.
  - **Train routes** (existing blueprint): lines with automatic intent, editing on the map, skip-if-nothing.
  - **Telegraph** (planned "see every train on the map"): the Lines view.
  - **Signals** blueprint: trains wait for each other at signals, and auto-spacing.
- **Warehouses still serve only routed trains.** Automatic intent makes them easy: a warehouse on a line takes what
  later stops don't want, and gives what they do.

### 3.7 Saves and existing trains

- **Old saves are not kept** (the user's call, 2026-10-17: "we can discard old saves"). A save from before lines is
  turned away with a friendly *"This save is from an older version"*, and no migration is written.
- **Save format.** It gains `lines: [{id, colour, name, stops: [[depot, intent, waitFill?]]}]` and `line` on engine
  cars (keyed by engine car id, as routes are today, since a train's id changes when it turns back). The version is
  bumped.

## 4. Phasing

**Phase 1, the smallest version that changes how the game feels.** About a week, Scenery with Game Mode reviewing the
economy part:
1. **See it:**
   - the selected train's route as a ribbon with numbered stop discs;
   - "where the switches send it" for unrouted trains;
   - "can't reach X" on the card and the map.
2. **Edit it on the map:** tap places to add, tap discs to remove, chips to reorder. The chip-cycling editor goes.
3. **Automatic intent** replaces Both/Drop/Pick by default, with Drop/Pick kept as overrides. The bug where a train
   waits under a crane it may not load from is fixed.
4. **The new save format,** with old saves turned away (no migration).

**Phase 2: lines.**
- Colours and names.
- Several trains per line, and "add a train to this line".
- Per-stop "wait to fill".
- Skip-if-nothing.
- Auto-spacing.
- The Lines view (Game mode: with the Telegraph).

**Phase 3: trains that wait for each other** (Rail and road leads):
- wait before an occupied single-track section instead of meeting head on;
- passing loops that just work;
- steering that respects pinned switches and occupied junctions.

**Not planned:** timetables, conditional orders beyond skip-if-nothing, profit charts, breakdowns, servicing
requirements.

## 5. Open questions for the user

1. **Should the game choose what to load and unload by itself** (automatic intent), with Drop/Pick only as an
   override?
   - *Recommendation: yes.* It's the biggest cut to finickiness, and old routes keep working.
2. **Should route lines show only when you select a train**, plus a Lines view to see them all?
   - *Recommendation: yes.* An always-on overlay would make the toy look like a transit map.
3. **In Game mode, should "where the switches send it" and "can't reach" be free from the start**, with routes still
   a blueprint?
   - *Recommendation: yes.* Clarity shouldn't be a reward; routes stay something to earn.

## Coordination

- **Game Mode** owns the economy. The intent rules, per-stop wait, skip-if-nothing and the new save format change
  `economy.ts`, so Phase 1 needs their sign-off. (Bug 7, "wait for a full load" ignoring the route, is already fixed
  on main: 0c07401.) They also own the Telegraph.
- **Rail and road** own signals and pathing: Phase 3, the switch-clarity pin, and the path search shared by the ribbon
  and `steer`.
- **Scenery** (this author): lines, the ribbon and discs, edit mode, the engine and line cards, the save format, and
  the Lines view.
- **The interface between the two:** Scenery provides
  `lineOfCar(carId) → { stops: [{ depot, intent: "auto" | "drop" | "pick", waitFill }] } | null`. Game Mode builds
  the economy's side behind it, stacked on Scenery's Phase 1 branch.
