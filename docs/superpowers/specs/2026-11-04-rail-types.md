# New rail types: rack, metro, monorail (2026-11-04)

A design, not a build. Asked for: a rack railway (steep hills), a monorail and a metro; for each its pieces, how it
joins ordinary track, its trains, a real reason to use it, research gating and the phone UI; which to build first and
which to drop. Branch `claude/design-rail-types`. Tunnels are on `claude/tunnels` (not merged): the metro builds on them.

Read for this: `src/track/pieces.ts`, `constants.ts`, `src/landscape/clearance.ts` and `hill-shape.ts`,
`src/game/engines.ts`, `passengers.ts`, `blueprints.ts`, `src/sim/grade-guard.test.ts`, the specs for hill shapes
(ramp cuttings), low bridges, signals, the tech tree, and `claude/tunnels` (`tunnel-dig.ts`, `tunnels-view.ts`, its
clearance rules).

## Summary

| | Rack | Metro | Monorail |
|---|---|---|---|
| What | A steep ramp with a cog strip: two levels up in one ramp's length | A stop under a town, reached by tunnel | A beam on posts, its own cars |
| Joins ordinary track | **Yes**, end to end, like a ramp | **Yes**: it's ordinary track in a tunnel | **No**: a different gauge |
| Its trains | A rack engine (only trains with one climb a rack) | A metro unit (electric, three cars, passengers) | Monorail cars, only on the beam |
| Real reason in play | Up a hill in half the room; reach hilltops (a lookout halt, later the ski resort) | Serve a town's middle without using its ground; the town grows over the line; more riders | Crosses anything: but tunnels and bridges already do that |
| Research | Mid game, coins | Late game, after tunnels, City ★ | — |
| Build cost | **Medium** (about 3–4 sessions) | **Medium-large** after tunnels land (5–7) | **Large** (8–12), a second track system |
| Recommendation | **Build first** | **Build second**, once tunnels are on main | **Drop** as a rail type; maybe a monorail *ride* kit later |

Pictures (390×844, `tools/shots/rail-types.mjs`): `docs/agents/shots/rail-types-rack.jpg`, `rail-types-rack-close.jpg`,
`rail-types-rack-card.jpg`, `rail-types-metro.jpg`, `rail-types-metro-card.jpg`, `rail-types-monorail.jpg`. The rack
is a real prototype piece laid by the game's own track rules; its cog strip, the cards, and all the metro and monorail
objects are mocks drawn by the script.

## What the board has now

The research board already lists all three as "later" rows (`blueprints.ts`):

- `rack`, "Mountain railway", tier 3, needs tunnels and diesel, 30🪵 + 120🪙 + 20 iron.
- `monorail`, tier 3, needs electricity and viaduct (itself planned), 30🪵 + 200🪙 + 30 iron.
- `metro`, tier 3, needs tunnels and electricity, a City ★, 30🪵 + 200🪙 + 30 iron.
- `ski` (Leisure, later) needs `rack`.

Facts that shape the designs:

- **Slopes don't change speed.** The sim is a toy: a train on its lever runs at one speed, up or down (`sim.ts`). So a
  steep piece can't be "hard" for physics reasons: any rule has to be a toy rule, said plainly.
- **Levels** are 48 mm; hills are up to 3 levels (`MAX_HEIGHT`). A ramp climbs one level in 144 (two squares), eased,
  steepest slope 0.5. Two levels by ramps take four squares in a straight line, plus a landing on a riser or arches.
- **Track is kept out of towns** ("Keep the track out of town"), and towns grow only onto lots clear of track. A town's
  stops (its station, any halts) share its riders: halts spread people out; they don't make more (`peopleArrive`).
- **Tunnels** (branch): track two levels under the ground over it may run under anything, a town included; only plain
  track goes in (points, signals and stations "need daylight"). Cars in a tunnel are drawn as ghosts; the line is
  painted over it as dashes. Under the felt it starts with a 288 mm cut-and-cover mouth.
- **Engines** have kinds with rules already: "too heavy", electric "no power" (`engines.ts`). A new kind with an
  ability fits that pattern.
- **Coins pile up** late (1279 by minute 180 on seed 2027) and the tech tree's rule is: nothing new takes planks
  before the first City. Late rows should lean on coins.

---

## 1. Rack railway

A rack is a ramp so steep only a cog engine can climb it: two levels up in one ramp's length. On a wooden toy it's a
ramp with a toothed strip between the grooves. Kids get it at a glance.

### Pieces
- **Rack** (`rack`): straight, 144 long, rises two levels (96). Same easing as a ramp, so its steepest slope is 1.0
  (45°). Ends like a ramp's: a hole at the foot, a peg at the top; flipped, they swap. Stands on its own sloping
  viaduct, and may run into a hill's side as a ramp does (a cutting, two levels deep).
- **Short rack** (`rack-short`): 72 long, up one level: the same grade, for one-level hills and tight spots.
- Not proposed: curved racks, rack switches. Real rack lines rarely have them; each would be new art and new draw rules.

Prototype: `rack` is in `pieces.ts` (a `line` with `rise: 96`, in `isRamp` and `SWAPS_ENDS`), so the track rules,
supports and the sim take it as they take a ramp. `grade-guard.test.ts` finds it from the catalogue and passes: an
engine with three full wagons gets through it, up and down, pulling and pushing, from every kind of neighbour. The
prototype has no cog strip and no rule about who may climb it; both are below.

### Joining ordinary track
Yes, end to end, at a foot and a top, like a ramp. The two levels at its top meet a hilltop, risers, a bridge, or a
ramp's top on arches. There's no special joint, so nothing new in snapping, Draw or saves beyond a piece type.

### Trains
- **Rack engine** (Trains tab): a small tank engine with a cog box under it, pulls 2 cars, speed 0.7. Runs on ordinary
  track too (it's the same gauge), so it can work a whole line that has a rack in it.
- **The toy rule:** a train climbs or goes down a rack only if it has a rack engine. Any other train stops short of the
  rack's foot (or top) and waits, as a train waits short of points set against it; its card says why: "Can't climb the
  rack: add a rack engine, or go round by the ramps." A rack engine on a rack runs at half speed with a clack-clack.
- **Routes** refuse a stop past a rack for a train without one, saying so on the route card, before it sets off.
- **Draw never lays a rack** on its own: it would leave ordinary trains stuck. Racks come from the tray, by hand.

### Why a player would want it
1. **Room.** Two levels in two squares instead of four. Picture `rail-types-rack.jpg`: the rack and, beside it, the
   same climb by two ramps. On a busy map that's the difference between getting up a hill and not.
2. **Hilltops worth reaching.** Today nothing in Game mode is on a hilltop (map sites flatten their yard). So the rack
   comes with one destination:
   - **Lookout halt**: a small halt that only stands on a hilltop two levels or more up. Riders from towns go there
     for a day out and pay a sightseeing fare (twice the distance fare). It's the first built row in Leisure,
     which is empty today. Later, the planned **ski resort** (needs `rack`) is the bigger version.
3. **A reason to own a different engine.** The rack engine is weak (2 cars) and slow, so it's a choice: a short,
   steep branch to the lookout, or the long way round with a big train.

Honest caveat: without the lookout halt, the rack is only a space saver, and tunnels (going through) compete with it.
The lookout is what makes it more than a curiosity.

### Research
Replace the `rack` row: **tier 2, Track, needs Bridges and ramps and Tank engine, 8🪵 + 120🪙, requires a Town.**
Brings: rack, short rack, rack engine, lookout halt. It lands in the 60–120 minute window the tech tree spec set
aside for coin-heavy nodes, and spends coins, not planks. Iron and tunnels are dropped as needs: the rack doesn't use
them, and they would push it past the point where hills still matter.

### Phone UI
- **Tray:** two tiles on the Ups & downs shelf, locked (with how to unlock) until learned. The rack engine on the
  Trains tab, the lookout halt where halts are.
- **Placing:** as a ramp: its ghost snaps foot first; it goes red with the usual reasons. Its top must meet two levels
  (a hilltop or something standing there), else "Nothing to hold up the top of the rack", as ramps say today.
- **Piece card** (`rail-types-rack-card.jpg`): what it is, and if a train is waiting at it, which one and why, with
  the two ways out (add a rack engine, go round). Turn round, Flip, Put away as on other pieces.
- **Train card:** the waiting status above, in the engine-status line (as "too heavy" is).
- Nothing per frame: the rule is checked when a train's next piece changes, not every tick.

### Build cost (about 3–4 sessions)
| Part | Size |
|---|---|
| `rack`, `rack-short` pieces (prototype has `rack`), piece info, tray tiles | S |
| Cog strip in the carved geometry (a toothed bar between the grooves; one more material at most) | S |
| Ramp cuttings two levels deep (check `hill-shape` cuts and the watertight tests at 96) | S–M |
| Rack engine kind in `ENGINES` (`rack: true`), the wait at a rack's ends in the sim, half speed on a rack | M |
| Routes: refuse a stop past a rack for a train without a rack engine | S |
| Rack engine model (Blender, a tank engine with a cog box) | M (art) |
| Lookout halt: hilltop-only placement, sightseeing fare, Leisure row | M |
| Research row; play-through: the balance player doesn't pick it (SUMMARY should not move; check the crate draws, a new piece type shifts them) | S |
| `e2e:rack` on a 390×844 phone: learn it, lay a rack up a hill, an ordinary train waits at the foot (card says why), a rack-engine train climbs and carries riders to a lookout halt and they pay | M |
| Perf: no idle cost (nothing animates); `perf:check` unchanged | — |

---

## 2. Metro

Trains under a town. With tunnels, track can already run two levels under the felt beneath a town. What's missing is
a way to stop there, and a train that looks the part.

### Pieces
- **Metro stop** (`metro-stop`): a short underground platform, a straight 216 long two levels under the felt, plus an
  **entrance kiosk** on a town square above it (a green, a street corner: a square with no house on it). The only
  station allowed in a tunnel (the "daylight" rule makes an exception for it). The kiosk is a small red hut with a blue
  roof and an Ⓜ sign: the one thing the player sees of it.
- Everything else is the tunnels branch's: the cut-and-cover mouth (down two levels from the felt), plain straights
  and curves in the tunnel, the dashes painted over the line.
- Not proposed: underground points or interchange stations. Points stay in daylight, as tunnels have them: a metro is
  a line through, with its branches out in the open.

### Joining ordinary track
Yes. It is ordinary track in a tunnel: a mouth outside the town takes the line down, under the town, and up again on
the far side. Any train may run through it, and a metro unit may run out onto the surface. No second system, no
second gauge.

### Trains
- **Metro unit** (Trains tab): three cars that come as one, electric, 8 seats a car, speed 1.3, quick to start (1.5).
  Passengers only. Like the electric engine, it runs only while a power station has coal (the same rule and message).
- Other passenger trains can call at a metro stop too: the unit is a nicer fit, not a requirement.

### Why a player would want it
1. **Serve a town's middle without its ground.** Track is kept out of towns, and towns grow only onto clear lots. A
   metro line takes no town ground: the town keeps growing over it (`rail-types-metro.jpg`: the line painted through
   the houses, an entrance on a green).
2. **More riders.** Today a town's stops share its riders. Proposed: each metro stop is a *quarter* of its town with
   its own arrivals, at half the town's rate, up to two per town. So a big city with two metro stops makes twice the
   riders. This is the payoff that makes the metro worth its price; it is also a balance change (see decisions).
3. **Late-game goal.** City ★ towns, electricity and tunnels all come together: something big to build with the
   coins that pile up.

### Research
Keep the `metro` row's place: **tier 3, Track, needs Tunnels and Electricity, requires a City ★**, but price it in
coins: **10🪵 + 240🪙 + 20 iron** (from 30🪵 + 200🪙 + 30 iron). Brings: metro stop, metro unit.

### Phone UI
- **Tray:** a Metro stop tile with the tunnel pieces. Dragged over a town, the town's free squares light up; the ghost
  shows the kiosk on the square and the platform's outline painted under it. Dropped, it lays the platform two levels
  down, in line with a metro line already under there if there is one, else on its own (to be joined by tunnel).
- **Drawing the line:** Draw from a mouth's low end under a town, as tunnels' Draw goes under a hill, and through a
  metro stop's ends.
- **Card** (`rail-types-metro-card.jpg`): the stop's name ("Clatterford Metro, Market stop"), who's waiting, the next
  train, **Show the line** (lights the dashes and the ghost trains for a few seconds), Move entrance, Put away. Tap the
  kiosk to open it: it's a big target, unlike track two levels down.
- Seeing underground is the tunnels branch's job (ghost cars, dashes); the metro adds nothing per frame.

### Build cost (5–7 sessions, after tunnels land on main)
| Part | Size |
|---|---|
| `metro-stop` piece (platform in a tunnel) and its exception to the daylight rule | M |
| Entrance kiosk: placement on a free town square, kept by town growth and moved houses (`town-growth.ts` must treat the square as taken) | M |
| Passengers: a metro stop as a quarter with its own arrivals; nine-seed balance bands before and after | M |
| Metro unit: three-car electric set (new models), one item on the Trains tab | M (art) |
| Card, Show the line, Draw through a stop | M |
| `e2e:metro` on a phone: learn it, lay a line under a city from two mouths, two stops, a metro unit carries riders between them and they pay; the town grows a house over the line | M |

---

## 3. Monorail

A beam on posts, cars that straddle it, high over everything.

### Pieces
Beam straight, beam curve, beam ramp (from a station at the ground up to the beam's height), a beam station, and a beam
switch (a sliding beam, as real ones are). Posts placed by the game, every square.

### Joining ordinary track
It doesn't, and can't sensibly: the cars straddle a beam; they have no wheels in grooves. That means a second track
system: a gauge on every connector so beam and track never snap, its own Draw, its own overlap and headroom rules
(posts are solid, the beam must clear trains and houses), its own switch model and route planning.

### Trains
Monorail cars (two or three as one), passengers only, electric. They never leave the beam.

### Why a player would want it
To cross a town, a river or other lines high up without using ground. But that is the metro's job (under a town),
bridges' (over rivers and lines) and, planned, the viaduct's. Its posts also stand on town ground. Without a reason
of its own it would be a second, harder way to do what other pieces do.

### Build cost (8–12 sessions)
A second track system touches snapping, Draw, overlap, clearance, routing, the sim's car models, saves and every
e2e of track; plus new art for the beam, posts, switch and cars. The biggest of the three by far for the least new
play.

### Recommendation: drop it as a rail type
Take the `monorail` row off the board (or leave it "later" with no date). If a monorail is wanted for looks, the cheap
way is a **monorail ride kit**: a closed loop on posts with its own little car going round, set down whole like the
loop-the-loop, in Leisure (coins only). No joining, no routing; its motion follows the ambient rules (`AmbientEye`,
`AMBIENT_FRAME_MS`, still when zoomed out). About 2 sessions. `rail-types-monorail.jpg` shows the look.

---

## 4. Order

1. **Rack** first. It's the cheapest, needs nothing that isn't on main, the prototype already runs, and it fills the
   empty Leisure branch with the lookout halt. It also gives a later ski resort its way up.
2. **Metro** once tunnels are merged. It's mostly a station and a train on top of tunnels; the riders rule needs a
   balance pass.
3. **Monorail**: dropped; the ride kit only if wanted.

Each lands alone, with its e2e on the player's path (research → tray → lay → a train carries and is paid), and
`npm run perf:check` against the budgets (none of them should move: nothing new animates while idle).

## 5. Decisions for the user

1. **Rack: who may climb?**
   a. Only trains with a rack engine; others wait at the foot and say why. (Recommended: the engine matters, and it
      reads like the toy.)
   b. Any train climbs; a rack engine is just faster on it. (Simpler, no stuck trains, but the rack is then only a
      shorter ramp.)
2. **Rack: add the Lookout halt** (a hilltop halt with a sightseeing fare, the first Leisure row)?
   Recommended yes: without it the rack has little reason in Game mode.
3. **Metro: does a metro stop make more riders?**
   a. Yes: each stop is a quarter with its own arrivals, half rate, up to two per town. (Recommended: a real payoff;
      needs a balance pass.)
   b. No: metro stops share the town's riders like halts. (No balance risk; the only reason is reaching a town's
      middle without its ground.)
4. **Metro unit needs power** (a power station with coal), like the electric engine? Recommended yes, for one rule.
5. **Monorail:** drop it (recommended), keep it on the board as "later", or build only the ride kit?

## 6. Prototype on this branch

- `src/track/pieces.ts`: the `rack` piece (two levels up in 144), in `isRamp` and `SWAPS_ENDS`; `src/ui/piece-info.ts`
  names it. Not in any tray or research row: only reachable by code. `npm test` and `npm run typecheck` pass with it.
- `tools/shots/rail-types.mjs`: the pictures (`node tools/shots/rail-types.mjs [<out>]`, about 4 min). The rack and
  ramp lines are laid by the editor after the game's track rules accept each piece; the cog strip, the metro's kiosks,
  dashes and ghost cars, the monorail and the cards are meshes and HTML added by the script.
