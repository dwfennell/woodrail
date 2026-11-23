# Grand projects: the player picks the site

2026-11-22. The user, on desktop, with a screenshot of Rookhurst: "the grand exhibition overlapped with our workshop ...
I wonder if we can improve how placement works, ideally the player has more control". Then: "similar issue with
dimbleby and the cathedral" (the cathedral on the front of the Dimbleby school), and "Game should let us move things
around too". The maps: `src/play/bugmaps/reports/2026-11-22-grand-exhibition-overlap.txt` and
`2026-11-22-cathedral-overlap.txt` (the same save).

## Today

Start on a City ★'s card (`buildGrand` in `main.ts`) pays the coins and puts the project's fenced plot at a spot the
game picks (`siteSpot`, `src/game/grand.ts`). It searches rings round the city's station, nearest first, and takes the
first pose (0° or 90°) where the whole site (every stage's footprint: `unionFootprint`) passes the props' own rule
(`checkProp`). The player never sees where it will go until it's paid for and there. After that it's locked: a press
on it opens the city's card, and it can't be lifted, turned or swept (`Interaction.grandSite`).

**The bug (fixed with this spec).** `checkProp` knows the map's own depots by their squares (`FEAT_DEPOT`) and the
track by its points, but a depot the player placed has no squares on the map: its yard lives with its piece
(`placedYard`). The tray's prop drop checks those yards separately (`Interaction.propInYard`); `siteSpot` didn't. So on
the report's map the exhibition (at 90, −158) went onto the yard of the player's workshop (piece 439) beside
Rookhurst's station, and the cathedral (at −858, −28) onto the yard of the player's school (piece 427) in Dimbleby.
`siteSpot` now also keeps out of every placed depot's and kit's yard (`worldYards` in
`depot-footprint.ts`), off roads and lanes, and off farms' fields (`siteWhy`). Tests: `grand.test.ts`, "keeps clear of a workshop the
player placed", "on the reported map …" (both maps), "never covers a road".

That fixes the overlap. It still leaves the player no say: the site can land on the one clear field they meant for a
second sawmill, or turned so it blocks a line they're about to lay.

## What the game does elsewhere

Things the player places come from the tray as a ghost under the finger, offset above it (`propDrag`). An outline
(`FootprintOutline`) is green where it fits and red where it doesn't, with a toast saying why once per reason
(`propMessage`: "That's the workshop's yard", "Needs level ground — not over a hill's edge"). R, Shift+R and a second finger turn it (eighths, 15° fine:
`headings.ts`). A drop where it doesn't fit puts nothing down, and a drop on the tray puts it back. Each drop is one
undo step. A town's house can be picked up and moved about its town (`movableBuilding`, `lotFor`), refused with
reasons.

## Proposal

Two steps. Each ships on its own.

### Step 1: move the site (built with this spec)

The site stays where `siteSpot` puts it on Start, but the player can pick it up and move it, as a movable house. A
project already standing (the reporter's exhibition and cathedral) moves too: they drag it off the yard.

- **A finger resting on the site** lifts it, as a town's house (`armHold`; a mouse drags it). A drag that doesn't rest
  first pans the view, since the site is big and often fills the screen. A tap still opens the city's card.
- **Its whole footprint.** The ghost and outline show the whole site (`unionFootprint` of every stage), not just this
  stage's model, so a spot that fits the plot also fits the finished building.
- **Its city's rule** (`siteMoveRule`, given to the drag by main as `Interaction.siteMove`): within `SITE_REACH` of its
  city's middle (the site's own reach added, as `siteSpot` looks), off roads, lanes and fields; and, as any held prop, out of
  yards (`propInYard`) and on clear, level ground (`checkProp`). Refused with a reason: "The Great Exhibition stays by
  Rookhurst", "That's the workshop's yard", "Not on a road: the Great Exhibition needs open ground".
- **Not into the toy box.** A drop over the tray puts it back where it was, saying "Grand projects stay on the map:
  drop it by its city" (it's the city's, not a thing the player owns). Never selected, so no Remove; the clearing sweep
  still leaves it ("Grand projects stay").
- **Turned** while held, by a second finger (or R), as any held prop, if the whole site still fits.
- **One undo step** per move (Undo, Redo). Saved with the props, as today (the plan keeps its prop id; `grandPlace` and
  the stage swaps read where it stands).
- Its stage models are asked for when it's first touched (`siteTown`), so the whole footprint is known by the time a
  finger has rested long enough to lift it.

Cost: nothing new per frame. The checks run on pointer moves while it's held: `checkProp` over the site's samples and
`footprintInYards` against a cached yard list (`playerYards`). That's a few hundred point tests, under a millisecond.
No new materials or draw calls: the ghost is the stage's own model.

Tests: `grand.test.ts`, "moved by the player, it keeps by its city and off roads". e2e:grand's step 2b, on a 390×844
phone by touch: a finger resting on the plot, held whole and green over a clear spot by the city (found by the game's
own rules), let go there; Undo and Redo; held over the station (red, told why), let go, and it stays; let go on the
tray, back where it stood, told so. Then the suite's stages are built by train where it now stands, 0 idle frames,
and the reload keeps it there.

### Step 2: choose before paying (built, 2026-11-22, after step 1 landed)

Start doesn't pay at once. It enters a placement mode (the drag machinery of step 1). As built:

1. The card closes, the site's stage-0 plot goes up at the suggested spot (`siteSpot`) as a **draft** (`Prop.draft`:
   never saved, so a reload mid-placing leaves no trace and nothing paid), and the camera frames its corners.
2. The player drags it: a finger anywhere on it moves it at once, no rest needed (`Interaction.sitePending`), green or
   red with a reason as in step 1, by the same rule (`siteMoveRule`, the yards, `checkProp`). Let go where it fits, it
   stands there; let go where it doesn't, it stays and the reason is said. These moves are no undo steps (Cancel takes
   them all back). Turned by ⟳ on the bar, a quarter at a time, if it fits that way (`Interaction.siteFits`; else
   told why), or by R and a second finger while held.
3. A bar at the foot (`src/ui/site-bar.ts`, each button 44 px): "Drag the Great Exhibition where you'd like it by
   Rookhurst", **⟳**, **Cancel** and **Build here · 🪙 (its price)**. The tray and the goals are put away while it's up
   (`.hud.siting`), so the thumb is on the bar and the site in view above it. The draft only ever rests where it fits,
   so Build here is never off; it checks again as it's tapped (something may have been put there since, by Undo).
   Cancel leaves no trace: no coins, no plot. A new map, or another Start, cancels it too.
4. On Build here: the coins are paid and the draft becomes the project's plot where it stands (the same `startGrand`,
   its `spot` the chosen pose), the toast and News as before.
5. No room anywhere by the city: Start says so at once, as before ("No room by Rookhurst …"), and nothing opens.

Nothing is drawn while the player isn't touching it: the bar is written when it opens, the draft is an ordinary prop.
Pictures: `docs/agents/shots/grand-siting.jpg` (Start: the draft, the bar, the trees clear of its fence),
`grand-siting-dragged.jpg` (dragged to another spot).

Tests: `save.test.ts`, "leave out a grand project's site still being placed"; e2e:grand step 2 by touch: Start, the
draft unpaid and unsaved, the bar (44 px, the tray hidden), ⟳, Cancel (nothing paid, the tray back), Start again, a
drag with no rest to a clear spot found by the game's rules, Build here (paid, saved there, no tree inside the fence).

Why not put it on the tray as an industry (as Grand Central's kit is)? The tray is the toy box: things the player owns
and can take back. A project belongs to its city and has a fixed price at Start. A tray tile would need a "started but
not placed" state in the save, a tile that only fits by one city, and a way back if it's never placed. Grand Central
needs that because it joins track; a site doesn't.

## Trees

The map's trees stepped aside for track (`treesAside`), never for props, so a site stood over them, showing inside
its fence (`docs/agents/shots/grand-site-moved.jpg`, before). Now they keep off every site's plot, its whole footprint,
as they do a yard (`TreeClearance.setAreas`; `Game.siteAreas` from main, read on each props change and keyed by the
plots' poses in `LandscapeView.setTreeAreas`, so they're worked out again only when a plot is put up, moved, turned
or taken away). A tree by the fence hops out; one in the middle, with nowhere near to go, is taken away; they come
back when a draft is cancelled. Tests: `trees-areas.test.ts`; e2e:grand step 2 counts none inside the fence.

## Not in this
- Moving a site to another city. It stays its city's.
- Any change to Grand Central (its kit is already placed by the player from the tray).
