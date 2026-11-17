# Passenger destinations

2026-11-15. The user: "real destinations sounds good, also … possibly motivated by attractions in cities".

## Today

People turn up at a town's station (`peopleArrive`, src/game/passengers.ts), board any coach with a seat
(`Economy.canBoard`), and get off at the first stop in another town that the train drops riders at (`canAlight`). The
fare is the straight-line distance between the two stops / 800 mm, times the multipliers (first class, dining, sleeper,
observation, royal, lookout and observatory, visitors, Grand Central, circus). So no one chooses where to go, a long line
A → B → C pays only short hops, and a town's attractions only change what its arrivals pay.

## The change

**Each waiting person wants one place.** A place is a town (its station and halts), a metro quarter, or a stop of its
own: a lookout, an observatory, a found secret's halt, an airport, an airship mast. A *place key* names it: a town's id,
or −2 − the depot's id for the rest (`Economy.placeKey`, the same keys `quarterOf` uses for metro stops and airports).

**Only places a coach can take them to.** A stop's *reach* is the places of the later stops, round the line, of every
routed train with a coach whose line picks riders up at that stop (and drops them at the later one). Worked out from
the lines (`laterOf`'s cache gains the later stops' place keys) and kept until the lines, the trains' cars or the map
change: not per tick. Nothing in reach (no line with a coach stops here, only hand-run trains): people want *anywhere*
and do what they do today (on at any coach, off at the first other town). So a hand-run train still carries people
where no line runs, and a game before Routes plays as it did.

**Who wants where: pull, not nearness.** Each place in reach gets a share of the stop's newcomers by its pull:

| Place | Pull |
| --- | --- |
| A town | 1 + its level (a hamlet 1, a city 4) |
| … its places | +10% for each civic or leisure place or treat standing in it (town hall, park, fountain, museum…), at most +50% |
| … its visitors | × its best leisure place's visitor factor now (a museum 1.5, a theatre 2, the beach 2 in summer) |
| … the circus in town | × 2 |
| … a finished grand project | × 1.5 |
| A lookout halt | 2 |
| An observatory, a found secret, an airport, an airship mast | 3 |

Distance plays no part, so a far city draws as many as a near one of its size: long trips happen. The share is dealt
out in turn (a weighted round, the place furthest behind its share next), not by dice: deterministic, steady, and the
same on every replay. The counts reset when the reach changes.

**On and off.** A coach on a line takes someone only if one of the line's later stops is their place; they stay aboard
past other towns and get off at their own (any stop of that town: station or halt). A coach's riders may now come from
different stops (each rider keeps where they got on); the old rule, a coach holds only one town's riders, made a coach
full of A's riders for C pass B's waiting people with empty seats. A hand-run train (no route) takes only people who want
anywhere. No transfers: a person waits for a line that goes to their place. (Changing at a hub is a later step if it's
wanted.)

**Fare.** As today, by the straight-line distance from where they got on to where they get off: now the real trip, so a
long line pays for its length. The multipliers stay as they are. A town's visitor factor is still paid on arrival (the
museum's card promises it); its pull only decides how many of the newcomers go there, so the town's attractions bring
more people *and* they pay more. That is the point the user asked for, and it isn't counted twice: the number of
people turning up is unchanged, only where they go.

**What the player sees.**

- The town card's Station row: who's waiting, by place (chips: "Ashby 3 · Brook 2 · 🔭 Lookout 1"), or "anywhere".
- A train's card: its coaches' riders by place ("3 to Ashby, 1 to Brook").
- The town card: what draws people ("Draws people: 🖼️ Museum, 🌳 Park"), when it has any.

**Saves.** People waiting are saved as a count, as now: on load they get places by the same rule. Riders on a coach
save their places and where they got on (renumbered with the depots); an old save's riders want anywhere and get off at
the first other town, as they did.

## Balance

Arrivals are unchanged; fares grow with trip length. On a two-town line nothing changes (everyone wants the other
town). On A → B → C, A's riders who want C used to get off at B and pay the A–B fare; now they pay A–C. A
coach's seats are taken longer, so a busy line carries fewer riders a minute, but each pays more: income a minute rises
on long lines with seats to spare and stays about level on full ones. Short lines are as before. The `BALANCE=1`
play-through and `npm run balance:sweep` must stay inside their bands; the numbers go in the commit.

Measured (`npm run balance:sweep -- --from 0 --to 15`, main at 22bf05b against this branch, at 180 min): all
16 seeds inside every band on both. Means: riders carried 324 → 231 (−29%: they ride farther, so a coach takes fewer),
coins 973 → 877 (−10%: each pays more, not quite enough to make up for it in the play-through, whose coaches ride on
the goods line's long loop), blueprints researched 14.1 → 13.8. Seed by seed the play diverges (which cars the player
picks, when), so single seeds swing both ways (seed 1: 352 → 1103 coins; seed 5: 1536 → 1022).

## Cost

The reach is rebuilt only on a signature change (lines, trains' coaches, pieces), a few lines × stops². A waiting
person's place is an int in an array kept on the depot (grown in place, never per tick); a coach's riders' places and
origins likewise. Boarding scans a stop's waiting list (at most 12) against a line's later places (a handful). No
per-frame work; the cards read it when they're rebuilt.

## Tests

- Unit: place choice by pull (a city with a museum gets more than a hamlet; only places in reach; nothing in reach →
  anywhere); boarding (only a coach whose line reaches the place); riding past a nearer town; alighting at a halt of the
  right town; fares by the trip; old saves.
- The play-through and the balance sweep inside their bands.
- e2e (`npm run e2e:destinations`, 390×844 by taps): two lines from one town, people waiting for each place, a coach
  carrying riders past a nearer town to their own, the fare paid by the trip's length, and the cards showing places.
