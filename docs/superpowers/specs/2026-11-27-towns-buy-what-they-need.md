# Towns buy what they need (2026-11-27)

## The report

"rookhurst keeps taking bricks that dimbly needs for its cathedral... is it buying them? In general money is too easy
to make in the game, I think buying things you don't need to grow (or for projects) is probably something we can cut."
Map: `src/play/bugmaps/reports/2026-11-27-rookhurst-takes-cathedral-bricks.txt` (seed 770187, 11 trains, 38 317 coins;
grand projects: the Exhibition at Rookhurst done, the Cathedral at Dimbleby on stage 2 lacking 14 bricks, the Royal
train at Teasel End on stage 1).

## Diagnosis

- **Why Rookhurst takes bricks.** It isn't a stop's Drop tick (every town stop on the map is Automatic), nor a warehouse
  rule. Game mode's `accepts` (`TownLife.reset`) let a town take any good in `LUXURIES`: furniture, tools and
  everything in `FULL_PAY`, which held bricks, paint, glass, flowers, the foods, cars, oil, water, toys and the post.
  Rookhurst (City ★★★, lacking only 5 flour) took them as "luxury" every time a train offered them. Three lines (Blue 3,
  Purple 2, Teal 2) call at Rookhurst before Dimbleby, so Rookhurst had first pick of every brick.
- **Does it pay?** Yes, the full price (`payFor`: `FULL_PAY` goods at full price at any level), ×1.5 with a market:
  18 coins a brick at Rookhurst.
- **How much of the income.** Replayed 30 game minutes with Game mode's towns: 5 511 coins, every coin from goods no
  town needed to grow (bread 1 926, Dimbleby's bricks 1 098, paint 1 080, Rookhurst's bricks 702, tools 651, furniture
  54). Goods that go into a grand project or a place aren't paid at all (they skip `deliveredGoods`), so the only
  growth good in play, Rookhurst's flour, wasn't being carried. In the balance play-through: see the sweep below.
- **Priority for a grand project.** None. A town earlier on a line takes what it accepts; nothing holds goods back for
  a city further on whose grand project lacks them (as `reserved` does for a workshop's tray order). With this change
  an earlier town no longer takes a project's bricks, paint or glass unless it needs them itself. Two towns that
  both need the same good still take it in line order. Not changed here.

## The rule

A town (Game mode; Sandbox's towns are unchanged) takes from a train, and pays for:

1. what it still needs for its next level (full price, as before),
2. what its place under way lacks (`placeLacks`; unpaid, as before),
3. what its grand project's stage lacks (`grandLacks`; unpaid, as before),
4. the **staples** (`STAPLES`): everyday food (milk, bread, fruit, juice, cheese, ice cream, fish, sugar, jam,
   chocolate), cars, oil, water, toys and the post, at **half price**, the post at full price (`FULL_PAY` is now just
   the post). These are chain ends with no other use in a town; without this they'd have no buyer but a harbour.
5. what its station's delivery van takes for a town off the line (unchanged).

Everything else (bricks, paint, glass, flowers, and furniture, tools, planks, flour, stone and iron past its need)
stays on the train, which carries it on to a stop that takes it. A harbour still buys anything.

Treats take no goods (coins only), so they need nothing here.

## What the player sees

- The town card: "Buys only what it needs to grow, for a place it's building, or for a grand project. Trains carry the
  rest on", then "Also buys, at half price: 🥛 milk, …" for the staples learned.
- The line sheet: a town stop that a line's goods pass shows "Doesn't need 🧱 bricks" on its row, and, open,
  "Rookhurst doesn't need 🧱 bricks: they ride on" (`routePlan`'s `passes`).
- The engine card beside the town: "Not dropping bricks: Rookhurst doesn't need bricks" (`keptText`'s "unwanted").
- The News: the first of a staple says "Ashby buys it" (no "at full pay").

## Knock-on effects checked

- **Warehouses** take goods by their own rules (`storeLetsIn`); `accepts` says nothing for them. Unchanged.
- **Passengers and mail**: riders aren't goods; the post is a staple at full price and mail is the town's own. Unchanged.
- **Workshops** trade as before. Their "shares" is the yard keeping only its tray order's planks (or a few spare) while
  a town further on the line wants planks (`townWantsAhead`); a school's "shares" is its share of a load while a town
  ahead wants the good. Both ask whether a town *wants* the good, which is still the growth need. Unchanged.
- **Research rows that count goods delivered to towns** (Joinery: 30 furniture; Toy workshop: 20 furniture; Tool works:
  30 tools): furniture and tools now reach towns only while a City ★ or more needs them. See the sweep for whether the
  play-through still reaches them by 180 min.
- **Stickers** "Bring jam / chocolate / toys / cars / fish / ice cream to a town": staples, still reachable.

## Balance

`npm run balance:sweep -- --from 0 --to 40`, before and after; results in the commit and the hand-over report.
