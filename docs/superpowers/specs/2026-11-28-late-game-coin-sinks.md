# Coins over a whole game: late-game sinks, and the early pinch

Status: proposal, nothing built. 2026-11-28.

The user, in two messages: "money is too easy to make", then "the thing is: at a certain point you run out of
things to spend coins on", and "early game you are short coins, late game you are flush". So this spec covers the whole
curve: what coins buy today and when it runs out, sinks for the late game, a little help early, and whether late
income itself should grow more slowly.

Toy trains never bankrupt a child: no upkeep, no running costs, nothing that takes coins away unasked. Every sink
here is something a player chooses to buy because they want it.

## 1. What we measured

Three sources, all reproducible:

- **The user's own game, from its saves.** Ten of the report and reference maps are one game at different times
  (the session clock is saved: `clock` in the session key). From 2.2 h to 10.5 h of play: learned 22 → 96 of 127
  blueprints, best town City ★★, the same 9 towns and 12 plots from 8.5 h on.
- **The balance play-through** (`BALANCE=1 BALANCE_MINUTES=300 BALANCE_JSON=1`, seeds 0-7), coins in hand and
  coins earned every minute. The data and the scripts that read it are in
  `evidence/2026-11-28-late-game-coin-sinks/` (`curve.mjs`, `chart.mjs`, `playthrough-curves.json`).
- **Income by source on the late maps** (`INCOME_MAPS=1`, the follow-up of
  `2026-11-27-towns-buy-what-they-need.md`), plus a 15-minute split of fares into the plain distance fare and the
  bonuses, on the four latest maps.

### Coins in hand

![Coins in hand by hours of play](evidence/2026-11-28-late-game-coin-sinks/coins-in-hand.svg)

| Hours | User's game: coins in hand | Play-through (8 seeds): median (min-max) |
| ---: | ---: | ---: |
| 0.5 | — | 433 (380-548) |
| 1 | — | 295 (154-461) |
| 2 | — | 461 (255-1 010) |
| 2.2 | 689 | |
| 3 | — | 937 (423-1 281) |
| 4.4-5.1 | 4 010 → 4 899 | 1 909 (1 525-3 196) at 5 h |
| 5.9-6.5 | 7 186 → 8 920 | |
| 8.5 | 17 657 | |
| 9.0-9.6 | 21 642 → 28 944 | |
| 10.2-10.5 | 38 317 → 42 829 | |

### Coins an hour

![Coins an hour, log scale, with the target shape](evidence/2026-11-28-late-game-coin-sinks/coins-an-hour.svg)

- **The play-through's income falls in its second hour**: a median 790 an hour in the first half hour (the growth
  cards, the first-flour bonus), then 360-410 an hour from 1 h to 2.5 h, while it buys the mill (400) and its first
  tier-2 research. Coins in hand drop to 10-194 between minutes 20 and 150 on every seed, under 250 for 12-56 of
  those minutes. That is the early pinch the user describes.
- **The user's game, net of what they spent**, gained about 1 500 an hour from 2 to 4.5 h, 2 700-3 000 from 5 to 6.5 h,
  4 400 from 6.5 to 8.5 h, then 8 900, 11 100, 14 100 and 20 800 an hour through to 10.5 h. Coins in hand never fell
  between two saves after 2 h.
- The play-through earns 2.2-3.7 k in 5 hours, about 500 an hour late, against the user's 9-10 k an hour. It never
  builds a staple chain, runs one goods train a line and four towns. **It is a measure of the early game only.** Its
  late band (300-1 500 an hour) is far below what players make.

### Where late coins come from (the user's latest maps)

| Map (minute of play) | fares an hour | goods an hour | coaches | riders an hour | mean fare | plain distance fare |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| teal-line-planks-hint (509) | 5 480 | 6 052 | 4 | 1 384 | 4.0 | 2.0 |
| clover-pink3 (574) | 5 272 | 3 472 | 4 | 1 352 | 3.9 | 1.9 |
| rookhurst (614) | 5 216 | 4 776 | 4 | 1 352 | 3.9 | 1.9 |
| warehouse2 (627) | 4 900 | 6 004 | 4 | 1 240 | 4.0 | 2.0 |

All the fares come from **one train**: a diesel with two coaches, a first-class coach and a dining car, shuttling
between three big towns (levels 5, 6 and 4-5). The dining car (×1.5) and first class (×2) double the plain fare. The
towns send riders faster than the train can carry them: a level-6 town sends one every 1.7 s with Stations learned
(`riderSeconds`), about 2 100 an hour, so the limit is seats and trips, not people.

## 2. Everything coins buy today

Prices from the tables (`THING_RULES`, `BLUEPRINTS`, `PLACES`, `GRANDS`, `LIVERIES`, `plotPrice`, `fieldPrice`,
`lowerPrice`, `DIG_COINS`, `restorePrice`). **Track pieces, engines and every wagon cost planks only. Coins never buy a
train.**

| What | Coins | Other cost | Open from | One-off or repeatable |
| --- | --- | --- | --- | --- |
| Research, tier 1 (15 rows) | 0 | goods at a school | start | once |
| Research, tier 2 (60 rows) | 40-200 each, **6 540 in all** | goods | as learned | once |
| Research, tier 3 (52 rows) | 100-400 each, **10 080 in all** (6 720 with University) | goods, a school beside a city | City | once |
| Industries (33 kinds) | 90 (farm yard) to 480 (foundry, harbour), **8 870 for one of each** | planks, some stone or iron | their research | per building |
| Restoring a ruin | half the new industry's coins (45 for a farm) | half its goods | the research | per ruin |
| Clearing a ruin | 10 | | | per ruin |
| Coin-priced kits and props (16) | 10 (short rack) to 600 (metro stop), **2 510 for one of each** | planks, stone, iron | tier 2-3 research | per piece |
| A second school | 40 | | a village | per school |
| Town places, per town (14) | 60 (town hall) to 300, **2 480 a town** | planks, stone, iron brought to the town | their research, a town hall, town level 2-3 | once per town |
| Town places, one a map (bank, museum, stadium) | 300, 300, 500 | stone, iron | research, level 3 | once |
| Treats (5 kinds a town) | 100 + 50 × treats on the map | none | any City | once per town |
| Paint (10 liveries) | 60-80; gold 400; starlight, rainbow 600 | none | City | per engine |
| Paint your own colours | paint pots, no coins | | Dye works | per train |
| Grand projects (5) | 300-500, **2 000 for all** | 4 stages of goods each | City ★ | once a map |
| Land | 60 + 30 per plot past 4 (the 13th: 330) | | start | unlimited |
| Fields | 40 + 20 per field planted | | Farming | unlimited |
| Lowering a hill | 100 + 100 × height a step (a bank: −25%) | | Landscaping | unlimited |
| Digging under a town (metro) | 60 a square | | Metro | per square |
| Depot second and third tracks | 0 | 10 planks; 12 planks + 10 stone | Depot tracks | per depot |
| Big stations, station upgrades | 0 | 10-14 planks | Big stations | per station |
| Tunnels, viaduct, rack, lift bridge | 20-60 a piece | planks, stone, iron | their research | per piece |

### What the user bought, and what's left

At 10.5 h (warehouse2, 627 min, 42 829 coins in hand, income about 10 000 an hour):

| Left to buy | Coins | Minutes of income |
| --- | ---: | ---: |
| Research not learned (31 rows) | 4 680 | 28 |
| One of each industry not built | about 4 160 | 25 |
| One of each coin-priced kit | 2 510 | 15 |
| The two grand projects not started | 850 | 5 |
| Places in the three towns past level 1, and the one-a-map three | about 8 500 | 51 |
| **Everything that changes play** | **about 20 700** | **about 2 h** |
| Treats for every town at its level (21) | 12 600 | 76 |
| Gold or rainbow paint on all 12 engines | 7 200 | 43 |
| **Looks too** | **about 40 500** | **about 4 h** |

So the coins already in hand would buy everything still on sale, looks included, with nothing left to do but wait
for goods. And the user's choices say which kind of thing they want:

- **Bought:** research as it opened, industries, 3 of the 5 grand projects (the coins are small, the goods large),
  3 town places, and land to 12 plots.
- **Never bought:** paint (0 of 12 engines), treats (0), fields (0), lowered hills (0). Fewer than 1 in 30 of the
  town places open to them.

Things that only look nice, behind a town card, went unbought even with 40 k to spare. Things that change the railway
or make a project to work toward were bought. Late sinks should be the second kind, with the look as a bonus.

**Where it runs out.** Research and industries are what take coins in the first five hours, and they end. By 8-9 h
(City ★★, income passing 9 k an hour) every coin-priced thing that changes play costs less than an hour of income,
and from then coins only pile up: 3.5-4 h of income sat unspent at 10.5 h.

## 3. The target shape

Drawn dashed on the coins-an-hour chart:

- **Never broke early.** From minute 10 to 150 a new player always has coins for the next thing the goals point
  at, and never waits more than a few minutes on coins alone. In the play-through: coins in hand at least 150
  from minute 20, and the second hour's income not below the first's (today 360-410 against 790).
- **Something to save up for late.** From City ★ on there is always a priced goal 30-90 minutes of income away
  that changes the railway, and coins in hand rarely pass about 1.5 h of income except while saving for one.
- **Income grows more slowly late**, ideally 5-8 k an hour at 10 h on a map like the user's, rather than 10-20 k.
  This is the last lever to pull (section 6): the sinks should come first.

## 4. Late-game sinks, weighed

Prices are judged against 10 k an hour: 1 000 coins is 6 minutes of a late player's income.

### A. Grand projects again: one per city, coins rising — **recommended**

What the player sees: today each of the five projects can be built once a map. Instead, every City ★ can host each
project once, and the Achievements tab lists them per city ("Rookhurst: Cathedral ✓, Exhibition hall, …"). The 6th
project started on a map and later ones cost more coins and 1.5× the goods of each stage.

Rewards from the second time on are the city's own: the Exhibition grows that city a step; the Cathedral cuts its
goods to grow by a tenth and brings pilgrims (1.5× riders there); Grand Central makes it a second hub; the Ferris
wheel gives it a fair week; the Royal Train gives a second royal set in a new livery (still earned, never bought, as
the late-game spec asks of special trains).

How it ties into play: it is goods hauling, which the user is good at and chose to do 3 times out of 5, and it makes
the next city worth growing to City ★.

Prices (the first five as today; then rising by half each time, capped):

| Project started on the map | Coins | Minutes at 10 k/h |
| ---: | ---: | ---: |
| 1st-5th | 300-500 (as today) | 2-3 each |
| 6th | 4 000 | 24 |
| 7th | 6 000 | 36 |
| 8th | 9 000 | 54 |
| 9th | 13 500 | 81 |
| 10th and on | 20 000 | 120 |

On the user's map (3 cities at City ★ or more: 15 projects) that is about 260 k of coins, 26 hours, and 10 projects
of goods trains. Players with one big city get 5 projects as now.

Build: small to medium. `GRANDS` is data; the state is keyed by project (`economy.grandPlans: id → plan`) and must
become keyed by project and city, with a save version bump and an old-save fixture; rewards read "done anywhere" in
a few places (`earned`, `hubFare`, `GRAND_PULL`) and must read "done in this city". Models exist
(`grand-cathedral-4` and the others). No new UI beyond a per-city list on the Achievements tab.

Phone: each project is one static model a city, already budgeted for one of each; a map with 15 adds about 10 draw
calls and its triangles (`node tools/shots/yard-buildings.mjs` to measure). The Ferris wheel already turns only in
view (`AmbientEye`). 0 idle frames.

### B. The engine works: overhauls — **recommended**

What the player sees: with Engine shed learned, an engine's card has **Overhaul**. The engine goes to the shed (as
the breakdown crane drives out), stands a game day, and comes back better, with a look that shows it:

| Grade | What it gives | Look | Base coins |
| --- | --- | --- | ---: |
| 1, Tuned | 10% faster top speed | polished brass dome and bands | 1 200 |
| 2, Rebuilt | pulls one more car | a nameplate, lined paint | 3 500 |
| 3, Showroom | 10% faster again, and starts and stops quicker | gold lining, a bell | 8 000 |

Each overhaul done on the map adds 5% to the next one's price, so the work grows with the fleet. One engine fully
overhauled: 12 700 (76 min); the first three engines: about 42 k (4 h); all 12 of the user's: about 290 k.

How it ties into play: it makes the trains themselves better, the thing a train player cares most about, and it
answers "my trains are slow". A grade-2 engine on the user's fare train adds a fifth coach: about a quarter more
fares on that train, so it pays back in 2-3 hours, slower than anything else but never a loss.

Build: medium. A grade per car (saved, a save version bump, a fixture at the maximum); top speed, pull and
acceleration read it in the sim (`CAR_SPECS`, where `swapEngine` already changes an engine in place); the look on the
livery path (stripes and trim, as Lined and Rainbow, no new models); the card row and the trip to the shed (as the
crane's `Send the crane`). The balance and fuzz checks for routing must run, since faster engines change the timings.

Phone: no new meshes or materials (liveries change colours and stripes on the same programs); nothing per frame; 0
idle frames.

### C. Town fairs — **recommended**

What the player sees: a town card's **Hold a fair** (once a game year a town; a year is 24 minutes of play). For a
game month bunting goes up across its streets, stalls and an ice cream kiosk stand by its station, and a toast says
so. Riders to the town pay double that month, and the town keeps a fair's 😊 for the year (5% fewer goods to grow,
within the four smiles a town can have). A sticker for a fair in every town.

| Town | Coins | Minutes at 10 k/h |
| --- | ---: | ---: |
| Hamlet or village | 300 | 2 |
| Town | 600 | 4 |
| City | 1 200 | 7 |
| City ★ | 2 500 | 15 |
| City ★★ and up | 4 000 | 24 |

Every town once a year on the user's map would cost about 30 k an hour, more than they make: it can take all the
spare coins there are, and a player picks the towns they like. The double fares bring back about a tenth of the
price (one month of one town's riders, on a train that is already full), so it is a treat, not an investment.

How it ties into play: riders and growth, and it gives the small towns (6 of the user's 9 are still hamlets) a
reason to be visited.

Build: small. It is the circus without the cage wagons: `circusFare` and `circusRiders` already double a town's fares
and riders for a while, and the big top's prop going up and coming down is the same work as the bunting and stalls
(`scene-bunting`, `scene-market-stall`, `bldg-ice-cream-kiosk` exist). A smile that lasts a year needs a date on the
town (saved).

Phone: a handful of instanced props in one town for 2 minutes; bunting still or moving only in view; 0 idle frames.

### D. Research that costs more coins late — a quick knob, do it with A-C

Tier 3's coins doubled (10 080 → 20 160; with University 6 720 → 13 440). It moves research from about 40 minutes of
late income to about 80, where it begins (a school beside a City), and it doesn't touch the early game: tier 1 is
free and tier 2 unchanged. Research is finite, so it only helps the 5-9 h stretch. One table change; the balance
sweep (`npm run balance:sweep`) should be run to see that no band moves.

### E. Land past twelve plots, dearer — a quick knob

Today the 13th plot costs 330 and the 20th 540. From the 13th on, a third more each plot: 400, 530, 700, 940, 1 250,
1 660, 2 200, 2 900 (the 20th), so land stays a choice and not a sink to fill. Dearer land also slows a map's growth,
which phones need: each plot brings terrain, towns and their draw calls. Not a main sink for that reason.

### F. The museum's collection — the next one after A-C

The Museum (already a one-a-map place) gets a collection: a page of every engine, wagon, industry and grand project,
each pictured (the wiki's pictures, `src/wiki/pictures/`, drawn by the game). An exhibit is restored for coins, rising
along the page: 500 up to 8 000, 70-odd exhibits, about 150 k in all. A full row (all the engines, all the wagons) is
a sticker and more visitors (the museum's ×1.5 fares to its town rising to ×2). No map cost at all: the exhibits are
pictures in a sheet (0 frames while it's open). Medium build, mostly the sheet. A good long tail, but it changes play
only a little, so after A-C.

### Weighed and not first

| Candidate | Why not first |
| --- | --- |
| Town landmarks and decorations bought per town | They exist (treats, 100 + 50n) and went unbought with 40 k in hand. Fold the look into fairs (C) instead. |
| A toy shop of cosmetic pieces and special engines, rising prices | Cosmetics alone went unbought; special engines are "earned, never bought" (late-game spec). Could follow F as its shop. |
| Buying more land, new regions | A real sink only if unlimited, and unlimited map growth is what a phone can't afford. Kept as a price knob (E). A fixed region or two (an island, high hills) could come with new industries one day. |
| Repeatable commissions and contracts paying stickers or unique pieces | Mostly a goods sink, and grand projects per city (A) do that with what exists. A later step: a city's commission board of small orders. |
| Expanding stations, grand stations | Big stations and in-place upgrades exist, for planks. Giving them a coin price (800, 2 000) is a small one-off, not a sink that grows; fine to add with D. |
| Engine and wagon upgrades | Taken as B. Coach upgrades (more seats) left out: seats are the limit on fares, so they would raise income most of all. |
| Pay a town to grow a step | Skips the goods hauling that is the game. No. |
| Rolling stock that costs coins (my own) | Coins never buy a train today, and one train earns half a late player's income. Pricing coaches past the fourth in coins would tie fares to a sink, but it taxes every new line, early too, and this user's fares come from just four coaches. Kept as a fares lever, not a sink. |
| Garden props for coins in Game mode (my own) | Sandbox's trees, hedges and ponds priced in coins: cheap to build, but it is the cosmetic kind again. |

## 5. Early-game help

The pinch is the play-through's second hour: income halves after the first half hour while the mill (400) and the
first tier-2 research (40-200) come due. Two small changes, both bounded so they can't feed the late game:

1. **First loads pay a bonus**, as the first flour does now (`EARLY_FLOUR_PRICE`, `firstFlour`): the first 10 units
   of each kind of good a game's towns receive pay double. Over the first three hours that is a few hundred coins
   (planks, flour, grain, stone), and never anything again.
2. **The mill at 300 coins** (from 400). It is the price the second hour waits on.

Check: the play-through over seeds 0-40 with coins in hand at least 150 from minute 20, the second hour's income at
least the first's, and the 180-minute bands as they are (coins at 180 at least 100, City at 60-90). If they hold,
raise the nice-to-have coins at 180 from 150-600 to 300-900.

## 6. Do fares need a trim?

Not yet. Build A-C, then measure again: `INCOME_MAPS=1` on the late maps and the user's next saves, and coins in
hand against income an hour. If coins still pile past about 1.5 h of income at 8-10 h with the sinks there to buy,
then trim.

What we learned about where a trim would bite:

- Trimming how fast towns send riders (diminishing returns on a busy line) would change almost nothing: big towns
  send more people than the one train can carry. The limit is seats and trips.
- The plain fare is about 2 coins a rider; the dining car and first class double it. The bonuses multiply each other
  (a first-class rider on a train with a dining car pays ×3). Adding the bonuses instead of multiplying them (×2.5
  there) trims the late fares by about a tenth and leaves early fares, which have no bonuses, alone. That is the first
  trim to try.
- The bigger lever, if it's ever needed: fares that rise with distance more than with trips, so a short shuttle
  between two big towns earns less per hour than a long line (today the 1-coin minimum fare favours short hops).
  That is a change to how players lay out lines, so it would need its own proposal and a look at the user's maps.

## 7. Recommendation

Build first, in this order:

1. **Grand projects per city, coins rising** (A): the smallest build, and the sink this user already chose.
2. **Town fairs** (C): small, can take any amount of spare coins, and gives the hamlets a reason to be visited.
3. **Engine overhauls** (B): medium, the one most players will want, and it grows with the fleet.

With them, two table changes: tier-3 research's coins doubled (D) and land past 12 plots a third dearer each (E).
Early, the first-loads bonus and a cheaper mill (section 5). Fares left as they are until the sinks are in and
measured again (section 6).

| Sink | First price | Range | The user's map, all of it |
| --- | ---: | --- | ---: |
| Grand projects per city | 4 000 (the 6th) | 4 000-20 000 | about 260 k (26 h) |
| Town fairs | 300 (hamlet) | 300-4 000, once a year a town | up to about 30 k an hour |
| Overhauls | 1 200 | 1 200-8 000, +5% each done | about 290 k (29 h) |
| Tier-3 research | 200-800 a row | doubled | +6.7-10 k |
| Land, 13th plot on | 400 | +⅓ a plot | 2 900 at the 20th |

How we'll know it worked: in the user's next long game, from City ★ on there is always a priced thing on the
Achievements tab, a town card or an engine card that is 30-90 minutes away; coins in hand stay under about 1.5 h of
income except while saving; and some of the coins go into each of the three.

## 8. Testing, when built

- The play-through reaches each new sink by the player's path (a card's button, a price paid), never by writing
  state, and the balance sweep keeps its bands.
- Each saved addition (grand plans per city, a car's grade, a town's fair date) has a fixture at its maximum and an
  old-save fixture (`src/persist/corpus.test.ts`).
- An e2e for each asserts the payoff: a second Cathedral's reward in its own city only; a fair's double fares and its
  smile; an overhauled engine faster and pulling one more car on a line, with deliveries still made.
- `npm run perf:check` for A (models on the map) and C (props during a fair); 0 idle frames in each.
- `npm run jams` and the routing cases for B (faster engines change timings).
