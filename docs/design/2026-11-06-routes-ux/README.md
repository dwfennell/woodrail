# Routes UX: stop details, lines without trains, a Lines list (2026-11-06)

The user's ask: the stop details in route editing "could use some love"; a way to make a route without a train
running it; and a list of routes with what they're like and how many trains run them.

Two options, as in-game mocks: mock DOM injected into the real game on a 390×844 phone at @2x. The map, HUD and route
ribbons are the game's own. The numbers in the lists are placeholders. Today's UI: `today.jpg`. The mocks are made by
`tools/shots/routes-ux-mocks/` (`SCENES=mocks.mjs node stage.mjs <out>`).

## Option A: tidy the card, lines in the Journal

| | |
|---|---|
| `A1-stop.jpg` | The engine card keeps its strip of stop chips. The stop you pick opens a panel that points at its chip: its name with ← → ✕, what moves there in words ("Drops 🪵 logs from Forest yard 2 · Picks up planks for Workshop"), one segmented control (Drop & pick up · Drop only · Pick up only), and a Wait for a full load switch beside Pass by. |
| `A2-journal-lines.jpg` | A Lines tab in the Journal. Each line shows its colour bar, name, stops A → B → C, trains, the goods it carries, a health pill and loads a month, with + New line at the top. |
| `A3-line-card.jpg` | A line tapped in the list opens a line card. It has its stop chips, Edit stops, Show on map, its trains (each with what it's doing and ✕ to take it off the line) and + Add a train. |
| `A4-new-line.jpg` | A new line made with no train: tap places on the map, then "No train runs this line yet" and + Add a train. |

## Option B: a line sheet, lines from the map button

| | |
|---|---|
| `B1-line-sheet-stop.jpg` | Editing a route opens a line sheet with Stops and Trains tabs. The stops are a vertical line diagram: the line's colour as a spine, numbered discs, each stop's goods in and out, and drag handles. The stop you pick opens in place, with two ticks (Drop, Pick up; untick both and the train passes by), Wait to fill, and ✕. |
| `B2-map-lines.jpg` | The Lines list, opened from the 🗺 button. Each line shows a small metro diagram, its trains, goods, health and loads a month. |
| `B3-line-sheet-trains.jpg` | The Trains tab: its trains (◎ show, ✕ take off the line), and Add a train (a free train nearby, or a new one). Show on map, Copy and Reverse are here too. |
| `B4-new-line.jpg` | A new line with no train: its stops, "Tap places on the map to add stops, in order", then Next: add a train ›. |

## Impeccable critique

Two assessments: a design review run in isolation, and the detector run on the mocks' markup with hand checks.

### Heuristics: A 26/40, B 29/40

**A, strengths:**
- The sentences say what each stop does ("Drops logs from…, picks up planks for…").
- The card is compact, so the map stays in view.
- "No train runs this line yet" answers the ask plainly.

**A, issues:**
- Pass by sits outside the three modes, so Pass by, Drop only and Wait can all be on at once.
- The Journal is the wrong home for managing trains, and a 4th tab crowds it.
- The sideways strip doesn't scale past about 5 stops, and ← → is a slow way to reorder.
- The "Places you tap now go after…" hint is lost.
- The ✕ on a train is unclear: off the line, or gone?

**B, strengths:**
- The vertical diagram shows every stop's goods in order, and it scales.
- Two ticks can't reach a state that makes no sense.
- "Hazel · free, near Sawmill" and "Next: add a train ›" lead you through.
- Copy and Reverse are kept for players with many lines.

**B, issues:**
- The sheet covers about 60% of the screen while you tap stops on the map.
- Using the 🗺 button for Lines changes a button players already know.
- Too much green: ticks, Wait and Done all look the same.
- "+ Go by…" and the untick rule are jargon.
- The Trains tab is a wall of actions.

**Both:**
- "loads/mo" is jargon.
- The list should put problems first (stuck lines, lines with no trains).
- A Stuck pill needs a Show me.
- Hit areas need checking for the ⠿ handles and ◎ icons.
- Long lines will crowd B2's diagram: label only the ends, plus "+n stops".

### Detector and hand checks

Contrast:
- The number discs fail: white on red line `#e0533d` is 3.8:1, on green 3.5:1, and on yellow `#e6b52c` 1.9:1. (Today's filled "next" disc has the same flaw.) Fix: dark ink on light line colours, white only where it holds 4.5:1.
- The ⠿ handle is 2.5:1. Darken it to the muted ink.

Touch targets under 44 px:
- A1's ← → ✕ are 40 px.
- B's Stops and Trains tabs are 40 px.
- The ✎ rename is a bare glyph, not a button.

Structure:
- List rows are divs: make them buttons.
- Several "card in a card" boxes (the panel inside the engine card, train rows in a sheet): flatten where it can be done.

### Recommendation

B, with these borrowed from A and the fixes above:
- A sheet that peeks at about 45% height while you tap the map, framing the picked stop above it.
- A's "Drops … from … / Picks up … for …" sentences on the open stop.
- A's dashed empty state on the Trains tab.
- The Lines list behind its own entry, not the 🗺 button: the line's name on the engine card, and ☰ Lines, which exists today.
- Pass by shown as a "Passes by" tag rather than a paragraph.
- Wooden ticks with a green ✓, keeping solid green for Done.
- Copy and Reverse behind ⋯.
- Problems first in the list.

## Groundwork landed on `claude/routes-ux` (model only, no UI)

- Lines stand alone. `createLine`, `editLineById` and `deleteLine` exist. A line's last train leaving, or being taken off the map, keeps the line. A telegraph's call-home line is transient.
- Saves keep lines that no train runs. Old saves load as before, with each train's route as its line.
- `Economy.lineLoadsLately(id)` counts loads a month, and `lineHealth` gives a line's health.
- Tests are in `lines-standalone.test.ts`, `line-tally.test.ts` and `line-health.test.ts`.

## Both options: tap a place's building to add it (the user's addition)

| | |
|---|---|
| `C1-tap-places.jpg` | While you plan a route, every place a train can stop at gets a soft cream ring: industries' yards, and towns. Tapping the building (not just its station track) adds it as a stop. If it's already a stop, the tap picks that stop instead. The hint says so. |
| `C2-needs-station.jpg` | A town with no station nearby: its ring is dashed red, and a tap says "Larkfield needs a station first". |

These rings are drawn only while planning, and only where a place is in view. They would be built as world-space decals with the route's markers, not as per-frame DOM. A tap's hit test is the place's footprint (an industry's lot, a town's buildings), and a station within reach decides which stop it becomes.

## Built: option B (the user's pick, 2026-11-06)

The pick was B, with the recommended changes and the fixes for either option.

**The line sheet** (`src/ui/line-sheet.ts`)
- A bottom sheet at most 46% of the screen high, so the map above stays tappable. On a phone on its side it docks at the right.
- **Stops tab:**
  - A spine in the line's colour runs down the stops. Each stop shows its number, its name and its goods in and out.
  - Tapping a stop opens it in place. It says what moves there in sentences ("Drops 🪵 logs from Forest yard 2 · Picks up planks for Workshop").
  - Two wooden ticks, Drop and Pick up, sit under that. Unticking both makes the train pass by, shown as a "Passes by" row.
  - The open stop also has Wait to fill, ↑ ↓ and Take off. Stops can be dragged by their ⠿ handle.
- **Trains tab:** the line's trains, each with Show and Take off. Free trains that can reach the line are offered with "+ Add".
- **Header:** the name is a real button (rename). The swatch opens a palette. Copy, Reverse, Show and Delete sit behind ⋯. Solid green is kept for Done.
- **Numbers:** dark ink goes on light line colours (`inkOn`). The yellow line's numbers go from 1.9:1 to 8.3:1. Red (4.1:1) and green (4.5:1) stay just under or at 4.5:1 with either ink.

**Lines without a train**
- ☰ Lines → + New line opens the sheet with no line. The line is made at its first stop, and trains are added from its Trains tab.
- A line stays when its last train leaves or is removed. It only goes when deleted.
- Saves keep these lines, and old saves load as before.

**The Lines list** (`src/ui/lines-view.ts`)
- Reached from ☰ Lines and from the line's name on the engine card.
- Each row shows:
  - its colour and name;
  - a small line diagram with its ends named;
  - its trains and the goods it carries;
  - a health pill: Moving, Waiting, "Stuck: needs you" or No trains;
  - its loads a month, counted by the economy's `LineTally`.
- Problem lines come first. Tapping a row opens its sheet.

**Tapping a place** (C1, C2)
- While planning, a tap on an industry's building or yard adds that industry, and a tap on a town's house adds its station.
- A town with no station says "<town> needs a station first". An old industry's ruin says to restore it first.
- A soft cream ring with a thin dark edge marks each place a tap can add. They are two instanced draws, only while planning.

**Tests**
- `npm run e2e:routes-ux`: 29 checks on a 390×844 phone by taps.
- Unit tests: `lines-standalone`, `line-tally`, `line-health`, `line-sheet-text`.
- Pictures: `docs/agents/shots/routes-ux-*.jpg`.
