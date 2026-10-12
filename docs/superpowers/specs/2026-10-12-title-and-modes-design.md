# Woodrail — Title Screen and Game Modes Design

**Date:** 2026-10-12
**Status:** Approved direction (goals-only Game mode, one save per mode); building

## 1. Goal

A title screen that opens onto two ways to play:

- **Sandbox:** what the game is today. Any piece, any time, on any map. More assets will be added here first.
- **Game (Beta):** the start of something more game-like. For now the building is the same as Sandbox, with no
  limits. What's new is a list of **goals** to work through. Resources and a tech tree may come later; the mode is
  labelled Beta until then.

Each mode keeps **its own autosave**, so switching modes never loses the other's railway.

## 2. Title screen

- **Backdrop:** shown over the 3D scene. The camera glides out to a wide view and stops, and the game pauses, so the
  title costs nothing while it waits (a slow orbit was tried: it redraws the widest, costliest view every frame). The
  map behind it is the last mode you played, or the starter map on a first visit. It loads behind the title, so
  choosing a mode that continues that map is instant.
- **Title:** "Woodrail" spelled in wooden alphabet blocks (see 2a), dropping in one by one, with a one-line tagline.
- **Two cards, side by side** (stacked on a phone):
  - **Sandbox:** "Build anything, anywhere." Buttons: **Continue** (if there's a save) and **New map**.
  - **Game, with a Beta badge:** "Connect the towns and keep them supplied." Buttons: **Continue** (if there's a save)
    and **New game**. A new game starts on the starter map; its goals begin from scratch.
- Choosing an option hides the title, flies the camera in, and starts play. First-time players then see the
  existing "How to play" card, as now.
- **Getting back:** the Menu gets a **Title screen** item. The game is saved first.
- **Links:** a seed link (`#seed-123`) skips the title and opens that map in Sandbox, as now.

## 2a. Wooden-block look

The UI takes on a toy wooden-block theme:

- **Big words** are spelled in alphabet blocks: one beech cube per letter, the letter painted in a framed face in a
  toy lacquer colour (red, blue, yellow, green), each set down slightly askew. They're drawn in CSS (no images), by
  `blockWord()` in `src/ui/blocks.ts`.
- **Loading screen:** the same blocks spell "Woodrail" and hop in a wave while the pieces are carved. Its styles are
  in `index.html`, so it shows before the scripts load.
- **Panels** (title cards, help card) are pale beech boards with a faint grain and their thickness showing along the
  bottom edge (`--wood-panel`, `--wood-panel-edge`).

## 3. Modes and saves

- `GameMode = "sandbox" | "game"`.
- Saves:
  - Sandbox keeps the existing key (`woodrail.autosave.v2`), so today's railways carry over as Sandbox saves.
  - Game saves under `woodrail.game.v1`.
  - The goals done are kept beside it, under `woodrail.game.goals.v1`.
  - `woodrail.lastMode` remembers the mode for the title backdrop.
- The Menu's map items follow the mode:
  - Sandbox: Starter map, New map.
  - Game: New game, which starts on the starter map with goals reset.
- In play, a small chip by the logo shows the mode: "Sandbox", or "Game · Beta".

## 4. Goals (Game mode)

A pure module (`src/game/goals.ts`), tested in Node:

- **Definitions:** each goal has an id, a short title, a hint, and a check `(world) → done | progress`. Checks read
  only the world state (layout, sim, economy, stations), so they work after loading too.
- **Completion:** a goal, once done, stays done (saved by id). It's checked about once a second (wall-clock, so slow
  frames don't stretch it) and after every track change. Goals can be done out of order; the panel shows the first
  not yet done.
- **Order:** goals are worked through in order. The panel shows the current goal and the next one, plus how many are
  done (e.g. "3 / 13").
- **Completing a goal:** a tick animation, a chime, and a toast with the goal's title. The next goal then slides up.

First goals, all using mechanics that already exist:

1. Join two towns with track
2. Put a train on the track
3. Get a train moving
4. Run a train into a station
5. Make up a timber train (an engine and a timber wagon)
6. Load logs at the forest
7. Deliver planks to a town
8. Lay a switch
9. Build a bridge
10. Connect three towns
11. Deliver 10 bundles of planks
12. Run two trains at once
13. Connect every town on the map

When all are done, the panel says so and offers "New game" for a fresh map.

**Panel:** a small card under the logo (top left). It folds to a single line (count and current goal) when its header
is tapped, and starts folded on a phone. It shows only in Game mode.

## 5. Steps

- **M1:** modes and saves, title screen, Menu "Title screen", mode chip.
- **M2:** goals module and tests, goals panel, completion flourish.

## 6. Coordination

The map expansion branch (`expandable-world`) also changes boot in `main.ts` and saving in `save.ts`. This work
keeps its changes to those files small and separate:

- the mode is a parameter of `saveToStorage` and `loadFromStorage`;
- the title screen lives in its own `src/ui/title.ts`.

That leaves the merge to a few call sites.
