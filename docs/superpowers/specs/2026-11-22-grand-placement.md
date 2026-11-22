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
`depot-footprint.ts`) and off roads and lanes (`siteWhy`). Tests: `grand.test.ts`, "keeps clear of a workshop the
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
  city's middle (the site's own reach added, as `siteSpot` looks), off roads and lanes; and, as any held prop, out of
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

### Step 2: choose before paying (about two days on top of step 1)

Start doesn't pay at once. It enters a placement mode (the drag machinery of step 1):

1. The card closes and the camera frames the suggested spot (`siteSpot`) with the site's ghost and green outline on
   it.
2. The player drags the ghost (a finger anywhere on it), turns it (R / two fingers / a ⟳ button on the bar), or leaves
   it where it is.
3. A bar at the foot (44 px, thumb reach): **Build here · 🪙 (its price)** and **Cancel**. Build here is off (with the reason
   under it) while the outline is red. Cancel or ✕ leaves no trace: no coins, no plot.
4. On Build here: the coins are paid, the plot put up (the same `startGrand`, its `spot` the chosen pose), the toast
   and News as today.
5. No room anywhere by the city: Start says so at once, as today ("No room by Rookhurst …"), and nothing opens.

Phone first: the bar sits under the sheet line so the ghost is never under the thumb; the camera keeps the site in the
top two-thirds at 390×844 and the left two-thirds on its side. Nothing is drawn while the player isn't touching it.

Why not put it on the tray as an industry (as Grand Central's kit is)? The tray is the toy box: things the player owns
and can take back. A project belongs to its city and has a fixed price at Start. A tray tile would need a "started but
not placed" state in the save, a tile that only fits by one city, and a way back if it's never placed. Grand Central
needs that because it joins track; a site doesn't.

## Not in this

- Moving a site to another city. It stays its city's.
- Any change to Grand Central (its kit is already placed by the player from the tray).
