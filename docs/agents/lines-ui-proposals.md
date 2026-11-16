# The lines UI: critique and three directions

The user, 2026-11-16: *"in general I think that UI is just passable... can you redesign it and do some passes with the
impeccable skills?"* Earlier the same day: *"it's still quite difficult to add a stop where you want to add one in an
existing route"*. That earlier fix (insert where it fits, and a + between stops) is on main and is the starting point
for everything here.

The scope is the whole routes/lines UI: the train card's line box, the line sheet (Stops and Trains), the Lines list,
and adding, removing and reordering stops.

Pictures: `docs/agents/shots/lines-ui/`, phone 390×844 and desktop 1440×900. `today-*` is the UI as it is on main.
The mocks are HTML/CSS laid over the running game in the game's own tokens; none of it is built.
`node tools/shots/lines-redesign/stage.mjs [<out>] [<scene,…>]` draws today's pictures, and
`SCENES=mocks.mjs node tools/shots/lines-redesign/stage.mjs` draws the mocks. `SIZE=phone|desktop` draws one size
(about 6 min a size).

## 1. Critique (impeccable, dual assessment)

Method: dual-agent. Assessment A was the design review. Assessment B was the detector on the source plus detect.js
injected into the staged game, with DOM measurements.

**The verdict.** The pieces are Toy box, but the structure is a generic list editor: segmented tabs, a vertical list,
⠿ handles and ⋯. The best thing the system has is the numbered pins on the map, with chevrons along each line's
ribbon. Those pins are not part of the editing. Editing happens in a list under the map.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | The stamps are good. The card's reason is cut off: "Waiting: the train on the Blue line is i…" is 284 px of text in 207 px. |
| 2 | Match to the real world | 2 | "Pass by…", "drop only", "fills up" vs "Wait to fill", and three ways to say remove |
| 3 | User control | 3 | Undo and Done work. An armed + can only be let go by tapping it again. |
| 4 | Consistency | 2 | Two editors for one line: the card's rail reads across, the sheet reads down. "Take off" means a stop in one place and a train in another. |
| 5 | Error prevention | 2 | "Where it fits" is a guess, said only afterwards |
| 6 | Recognition over recall | 2 | The + dots carry no word. Drop, Pick up, Wait and Move are hidden until a stop is opened. |
| 7 | Efficiency | 2 | Three ways to insert, none of them on the map where the player is looking |
| 8 | Minimalism | 2 | The engine card has about 11 targets. Wait to fill is lacquer green, so it reads as a second Done. |
| 9 | Error recovery | 3 | Problems are said plainly, but "No free train can reach this line" offers no action |
| 10 | Help | 2 | The only teacher is the foot hint, a two-line run-on at 13 px |
| | **Total** | **23/40** | |

**Priority issues.**
1. **Two editors for one line.** The card's horizontal rail (`showRoute`, `.route-stops`) and the sheet (`line-sheet.ts`)
   both edit stops. On a phone the rail scrolls 565 px of stops through 314 px, so stops 1 and 2 of the Red line are
   off to the left with no cue (`today-1-card-phone`). Make the card's box read-only, with one **Edit line**.
2. **Inserting happens off the map.** The + between rows is right in kind, but it's a dot between two list rows, away
   from the geography the player is reasoning about.
3. **An open stop spills and is weighted wrong.** In `today-3-open-stop-phone`, ↑, ↓ and Take off sit at y 822–868,
   under the foot (B measured it). Wait to fill is a green lacquer block, one of two green blocks on the panel.
4. **Words.** Leave line, Remove and Take off (a stop), Take off (a train), and Swap ends sit beside Remove on the card.
   Use **Remove stop** for a stop and **Take off line** for a train. Remove stays for the engine alone, behind its card's ⋯.
5. **Desktop.** The sheet is a 780 px board in the middle of the screen, its list capped at four stops with half the
   screen empty (`today-2-sheet-desktop`).

**Detector findings that are real.**
- Done (`#fff8ec` on `#3d934c`, 17 px) is 3.6:1. "+ New line" is 3.7:1. DESIGN.md says green carries large lettering
  only, so make these 19 px Lilita on a darker green.
- `.route-intent` "only ⬇" is 11 px.
- The ⠿ grip is 4.4:1.

**False positives.**
- `side-tab` is the board's own end-grain edge.
- `bounce-easing` is the card's deliberate overshoot.
- The next stop's number on its colour has a text outline.

**Strengths to keep.** The pins and ribbons on the map. The stop sentences ("Drops 🪵 logs from Forest yard 3 / Picks up
🗄 planks for Workshop"). The Lines list, the most finished surface. Every target measured is 44 px or more.

## 2. Shared by all three directions

- **The card's line box, read only** (`all-card-*`). The line's disc and name, its status stamp, and a mini line of
  pegs with the train between the stop it left and the one it's going to. Then one sentence, "Going to Sawmill 2 · the
  Blue line's train is in the way **Show**", and one **Edit line**. This removes the rail, its + pegs, and the second
  editor. Leave line moves into the sheet's Trains part as Take off line.
- **A stop's choices as three pegs in one row**: Drop, Pick up, Wait to fill. A peg sits in its hole when off and is
  painted when on, green for Drop and Pick up, gold for Wait. **Remove stop** is a red stamp. No lacquer inside a stop.
  ↑ ↓ give way to the grip; keyboard players keep ←/→ on a picked stop (B9).
- **Done** is legible: Lilita 19 px on a deeper green, 4.5:1.
- **On desktop** the sheet docks on the right, the height of the screen, and its list is never capped.
- Insert where it fits, the + between stops, and the "Added … between …" note with Move to end and Undo stay in all
  three.

## 3. Three directions

### A. A tidier board

`A-1-open-stop-*`, `A-2-slot-*`

Today's sheet, made to work.
- Stops and Trains tabs as now. Trains carries a gold dot when one is waiting or stuck.
- Rows are a stop each, the grip at the right, under the thumb.
- An open stop is a maple tile: its sentences, then the three pegs, then Remove stop. It fits in about 220 px with
  nothing under the foot.
- A tapped + grows into a full-width dashed slot on the line, "Tap a place on the map: it goes here". The foot then
  says between which stops, with **Cancel**.

- **For:** the smallest change, and the e2e and the code shape stay close.
- **Against:** it is still a list under the map. Inserting still means looking down at the list, then up at the map.

### B. The map is the editor

`B-1-map-*`, `B-2-armed-*`

- The sheet shrinks to a slim bar, about 150 px. It holds the name, status, 🚂 2 › (the trains, a drawer) and Done,
  and under them a strip of the stops as numbered pegs with a + between each pair.
- On the map, the stops' pins are joined by a **+ peg at the middle of each leg, on the ribbon itself**.
- Tap a + (on the map or in the strip) and it is painted, and a tag says "Now tap a place: it goes here".
- Tap a stop's pin or peg and its tile opens beside the pin: what it moves, the three pegs, Move and Remove stop.
- The list is gone. Order is the strip, and the map shows the way.

- **For:** it answers the user's complaint where it happens. Insert is where the geography is. The map stays big, with
  about 150 px of HUD against today's 390.
- **Against:**
  - It is the biggest build: map + pegs placed along ribbons, a tile that follows a pin, and pegs that must stay clear
    of pins and the top bar (the mock shows one sitting on a pin).
  - A long line (8+ stops) needs the strip to scroll.
  - Via points need a home on the map.
  - Desktop fits it well.

### C. One diagram, the trains on it

`C-1-diagram-*`

- No tabs. The sheet is the line drawn down a painted spine, the stops on it as today.
- **Its trains ride the spine** as small engine tokens between the stop they left and the one they're heading for.
- A waiting or stuck train is a gold tile on the spine, where it is, saying why, with **Show**.
- **+ Add a train** sits at the end of the line ("2 free trains can reach it"), and the line's loads a month go in the
  foot.
- Stops open and + insert as in A.

- **For:**
  - One picture answers "what is this line and how is it doing", and problems show where they happen.
  - It fixes the Trains tab's cut-off reasons, since there's room for a whole sentence.
  - It keeps the list's precision for ordering.
- **Against:**
  - The sheet gets taller with many trains (a train per stop gap at most; more than two in one gap fold into "3 trains").
  - Trains move, so the diagram changes as they run. That means a rebuild 4 times a second while open, like the Trains
    tab today.

## 4. Recommendation

**C, with B's map pegs.** C makes the sheet the one place a line is understood: stops, trains and problems. B's +
pegs on the ribbon add the on-map insert the user asked for, without giving up the list. A alone is too small a step
for "just passable".

Either way the build lands in steps:
1. The shared changes: the card's box, pegs, words, Done, the desktop dock.
2. The chosen sheet.
3. The map pegs, if wanted.
4. /impeccable polish and harden.

e2e:routes-ux is updated with each step, and e2e:route-insert still checks the payoff.
