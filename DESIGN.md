---
name: Woodrail
description: A wooden toy railway on a table; the HUD is the toy box it came in, lacquered blocks on beech boards.
colors:
  wood-ink: "#2a1a0e"
  wood-ink-soft: "#4f3418"
  paint-ink: "#fff8ec"
  beech-hi: "#f6e2bd"
  beech-lo: "#ebc995"
  end-grain: "#b98447"
  maple: "#fbf1df"
  maple-cut: "#dcbf94"
  red: "#cf3a22"
  red-cut: "#8f2312"
  blue: "#2563b0"
  blue-cut: "#143f78"
  yellow: "#f4b61a"
  yellow-cut: "#a97a00"
  green: "#2f8b3f"
  green-cut: "#1b5a26"
  dark: "#3a2a1c"
  dark-cut: "#1d140c"
  stamp-red: "#b3301c"
  stamp-brown: "#5a3a1a"
  stamp-green: "#2f7a38"
  stamp-green-ink: "#1f5a27"
  stamp-gold: "#a97a00"
  stamp-gold-ink: "#6b4300"
  pencil: "rgba(60, 46, 32, 0.5)"
  focus: "#2f6fb5"
  page: "#cbbba3"
typography:
  display: "Lilita One, Nunito, system-ui, sans-serif"
  family: "Nunito, system-ui, -apple-system, sans-serif"
  weights: [400 (Lilita), 700, 800, 900]
  title:
    fontFamily: "{typography.display}"
    fontSize: "26px"
  card-title:
    fontFamily: "{typography.display}"
    fontSize: "19px"
  painted-button:
    fontFamily: "{typography.display}"
    fontSize: "16-24px"
  button:
    fontSize: "15px"
    fontWeight: 800
  body:
    fontSize: "13.5px"
    fontWeight: 700
    lineHeight: 1.3
  small:
    fontSize: "11.5px"
    fontWeight: 800
  floor:
    fontSize: "11px"
rounded:
  stamp: "3px"
  tile: "8px"
  block: "9px"
  board: "10-12px"
  peg: "50%"
spacing:
  hairline: "4px"
  tight: "6px"
  base: "8px"
  card: "12px 14px 20px"
  gutter: "12px"
components:
  chip:
    background: "{colors.maple}, a soft sheen on top"
    edge: "inset 0 -4px 0 {colors.maple-cut}"
    textColor: "{colors.wood-ink}"
    rounded: "{rounded.block}"
    height: "44px"
  chip-primary:
    background: "{colors.green}, a soft sheen on top"
    edge: "inset 0 -4px 0 {colors.green-cut}"
    textColor: "{colors.paint-ink}"
  card:
    background: "beech board: grain over {colors.beech-hi} to {colors.beech-lo}"
    edge: "inset 0 -6px 0 {colors.end-grain}"
    rounded: "{rounded.board}"
  tray-item:
    size: "84px x 90px"
    background: "{colors.maple}"
    rounded: "{rounded.tile}"
---

# Design System: Woodrail

## Overview

A Brio-style wooden railway on a phone. The 3D table is the star; the HUD is the toy box it came in. Boards (the tray, cards, the Journal, the menu, the research board) are natural beech with the grain showing and their thickness cut square along the bottom. Rows on a board are maple tiles. The buttons that matter are lacquered blocks in the logo's four colours. State is a peg in a hole; counts, prices and statuses are rubber-stamped; rules between groups are pencil lines. Shadows are short and nearly hard, a block standing on a table, never a soft halo. It should look made, not generated: opinionated, sturdy and warm. Players include children, so words are short and plain, and every win is acknowledged like a toy clicking into place.

Mode: Operate (a game HUD). The map comes first; the HUD stays at the edges, costs nothing when nothing moves, and fits a 360 px phone in both orientations.

The proposals this came from, with the mocks and the critique of the look before it: `docs/agents/hud-wood-proposals.md` (branch `claude/hud-wood-proposals`).

## Materials

Five materials, each with one job. A new surface picks from these; it doesn't invent a sixth.

- **Beech board** (`--wood-panel`: the grain tile over `#f6e2bd` to `#ebc995`; `--wood-panel-edge`: a light top line and a 6px `--end-grain` cut along the bottom): every panel, card, sheet and bar. The grain is one 256px tile of brown with alpha (`src/assets/grain.webp`, about 7 kB, made by `scripts/grain.py`), laid over the board's colour: no blend mode, no per-frame cost.
- **Maple tile** (`--maple` `#fbf1df`, a 3-4px `--maple-cut` edge, `--tile-drop`): a row on a board (a goal, a news item, a research ticket, a line, an open stop, a tray tile) and an ordinary button.
- **Lacquer** (`--red`, `--blue`, `--yellow`, `--green`, `--dark`, each with its `-cut` edge, under `--sheen`): the one main action on a panel, the top bar's blocks, the open tray tab, toasts. Paint is for what matters; most buttons are maple.
- **Stamp** (ink in a ruled 3px-cornered box over `--mottle`, often 1.5-3 degrees crooked): counts, prices, dates, line statuses, the goal count, BETA, and a destructive ask before it's asked (Remove, Take off, Empty). Statuses stand upright (a reading); counts and marks lean.
- **Pencil** (`--pencil`, 1.5px dashed): rules between groups, the outline of something not made yet (a sticker not earned, Soon on the board), the frame round a train's line on its card.

And two marks of state: a **peg** (`--peg-green`, `--peg-yellow`, `--peg-blue`: painted domes) for done, ready and under way, and a **hole** (`--hole`, `--hole-sh`) for not yet. A switch is a peg in a routed slot (`.toggle-pill`), the slot painted green when on.

## Colors

### Lacquer, by meaning
Green is go, on, done and the main action; red is stop, a warning, and a destructive ask once asked; yellow is attention, a goal to reach for and a plain toast; blue is focus, researching and Show me; dark is the menu and the settings. The top bar is coloured by kind, so a wide bar reads as four groups: Research blue; Map and Add land green; Undo, Redo and the speed yellow; Pause red; Sound, Fullscreen and Menu dark.

### Ink
- **Wood ink** `#2a1a0e` on beech and maple (10.6:1); **soft** `#4f3418` for secondary text (7.3:1 on beech). Nothing paler for words.
- **Paint ink** `#fff8ec` on lacquer: 4.6:1 on red, 5.7:1 on blue. On green it's 4.1:1, so green blocks carry large lettering (Lilita 16px and up) only; small text on green uses `--stamp-green-ink` on a stamp instead. Yellow takes wood ink (9.2:1).
- **Stamps:** red `#b3301c` (4.8:1 on maple), green ink `#1f5a27`, gold ink `#6b4300`, brown `#5a3a1a`.

### Line colours
A train line's colour (`LINE_COLOURS`, src/game/lines.ts), in the order new lines take them: red `#e0533d`, blue `#2f6db5`, yellow `#e6b52c`, green `#3c9a5f`, purple `#8a4fb5`, orange `#e07b2e`, teal `#2fa3b5`, pink `#c2457a`. They are keys, not text colours: on a chip they're a ring, a cap or a painted disc, never the ink; on the map the ribbon has a dark edge so each holds 3:1 against the beech track.

### Named Rules
- **Text holds 4.5:1** (large lettering 3:1). No grey on wood, no opacity under 0.7 for words.
- **No glass.** Boards are opaque; no backdrop-filter (it re-blurs over the live canvas every frame a train moves).
- **No coloured side stripes** on cards, rows or toasts: colour goes on a tab, a peg, a stamp or the whole block.

## Typography

- **Lilita One** (`--display`) for what's printed on the toy box: titles (26-28px), card titles and names (19-23px), goal titles (19px), tabs (15-16px), painted buttons (16-24px), toasts (18px), stop numbers. One weight (400); set with 0.01-0.02em tracking, uppercase only for short labels ("GOALS") at 0.06em.
- **Nunito** for words you read: body 13.5px/700, buttons on maple 15px/800, small 11.5-12px/800. **11px is the floor** on a phone (9.5px only for a tray label squeezed to fit, with a short name as the fallback).
- **Icons and words share one centre line**: a row that holds both is `inline-flex; align-items: center; line-height: 1`, never left to two fonts' baselines. The ✎ beside a name is lifted to the name's centre.

## Layout

- Top bar: brand/coins/date at the left, icon chips at the right, 12px from the safe-area edges, 6px apart.
- The Journal (goals) sits under the brand at the left; toasts sit under whatever is pinned below the top bar, clear of the tray.
- The tray docks at the bottom, centred, max 980px wide. Cards sit just clear of it (upright) or dock at the right under the top bar (a phone on its side).
- Group tightly (4–8px inside a group), separate generously (10–14px between groups).

## Elevation & Depth

Wood has a thickness: a board's cut edge is an inset along the bottom (`inset 0 -6px 0 var(--end-grain)`); a tile's or a block's is `inset 0 -3px/-4px 0` of its own darker cut. Shadows are short and nearly hard, the contact shadow of a block on a table: `--block-drop` (`0 4px 4px -2px`), `--top-drop` for the top bar and chips over the map, `--board-drop` (`0 12px 12px -6px`) for boards. A button pressed goes down 2px and its edge shrinks to 2px. No big soft blurs, no coloured halos; a ring (3px, ink or lacquer) marks the picked or the ready.

## Shapes

Cut, not moulded: stamps 3px, tiles 8px, blocks 9px, boards 10-12px, pegs round. Pills (999px) are gone; a count is a stamp. A toast is a lacquered block set down slightly crooked (-1.5 degrees).

## Icons

The game's icons are its own drawings, not the phone's emoji: one small SVG per icon in `src/icons/`, the source of truth, compiled into one colour font, `src/assets/woodrail-icons.woff2` ("Woodrail Icons", about 15 kB for every icon). Each drawing is named for the character it stands for (`u1FA99-coin.svg` draws 🪙), so the game's text keeps its emoji ("40🪙", "📘 Mills") and screen readers their words, and the font draws them on screen at the text's size, on its baseline, in any text: labels, costs, chips, cards, toasts, tooltips. No DOM per icon, no per-frame work. Planks have no emoji, so they're U+E000 (`GOODS_ICON.planks`, written `"\uE000"`).

**Style:** a 24×24 viewBox; flat fills in the palette above (beech `#e3bf8c`/`#f6dfb4`/`#c9965a`, lacquer red, blue, yellow and green, ink `#3a2a1c` or a dark of the shape's own colour for outlines); an outline is a darker shape drawn under the shape, about 1.2 units wide; a light strip or two for the lit side; chunky shapes that still read at 14 px. `fill="currentColor"` takes the text's colour (the ✓ tick, ➕). No strokes, gradients, text or images: the compiler takes paths, rects (`rx`), circles, ellipses, polygons and `<g>` with `translate`/`rotate`/`scale`. A hole is an inner subpath wound the other way.

**To add or change an icon:**
1. Draw `src/icons/u<HEX>-<name>.svg` for the character it replaces (copy a neighbour for the palette and outline).
2. Run `npm run icons` (`python3 scripts/icon-font.py`; needs `pip install fonttools brotli`). It rebuilds the font and writes the face's `unicode-range` in `src/style.css`.
3. Check it at 14, 16 and 20 px on light and dark, beside its neighbours, and commit the SVG, the font and style.css together. `src/ui/icon-font.test.ts` fails if the range and the drawings differ.

**Loading:** index.html preloads the font, its face is `font-display: block`, and main.ts asks for it at start, so an icon is never an empty box; were the font to fail, the phone's own emoji would show instead (planks alone would be a box). Where colour fonts aren't drawn, each icon is its silhouette in the text's colour.

## Components

### Buttons
- **Chip:** a maple block, 44px tall at least, 9px corners, 800 weight. Pressed: down 2px, its edge shrinks. Disabled in a card: an empty pencil-brown outline with faded words; in the top bar: the block unpainted, its picture faded.
- **Primary / on:** green lacquer, cream Lilita lettering. One per panel (Go, Done, + New line, Research, Start).
- **Destructive:** asked first as a red stamp (Remove, Take off, Empty, Leave); once asked ("Forget …?"), red lacquer.
- **Toggle:** a label and a peg in a routed slot: off, a bare slot with the peg left; on, the slot painted green and the peg right.
- **Focus:** a 3px blue (`#2f6fb5`) outline drawn just inside the control (`outline-offset: -3px`), so a scrolling strip never clips it and it never laps a neighbour. Shown only while moving focus by Tab (`.kbd-nav` on the root, `src/ui/focus-ring.ts`), never after a click or tap, even when a key follows; a text box rings whenever it has focus.

### Boards and cards
A beech board, 12px corners, 12-14px padding and 20px at the foot (over the cut edge), a bold `✕` (18px/900) in a 44px corner target. The title in Lilita. Cards pop in (0.24s, slight overshoot). Rows on them are maple tiles; a group of facts is ruled round in pencil, not sunk into a second surface.

### Navigation
- **Top bar:** lacquered blocks, 46px, coloured by kind (see Colors). An icon sits on the painted face's centre (lifted half the cut edge, 2px; Undo and Redo, whose arrows carry their weight low, 4px). Its panel open: the block stays pressed in.
- **Tray tabs:** hang from the tray's top edge: bare wood with their colour painted along the foot (red, blue, green, yellow in turn); the open one painted all over and hanging lower.
- **View switches** (Goals/News, Stops/Trains): a groove routed in the board with a maple block slid to the open side. On a phone the Journal's ✕ stands outside the groove.
- **Menu (☰):** a beech board with a red lacquer lid printed "Menu"; items 44px, 16px/800; groups ruled apart in pencil.

### The Journal
The goals bar: the count stamped in red, the bell a small yellow block, the goal's title in Lilita (two lines rather than an ellipsis), Show me a blue block (its word on a wide screen; its ⌖ alone on a phone, where the goal's words need the room). Open: "GOALS", its stamp and the fold on one centre line, inset 14px both sides; each goal and tip a maple tile with its box a hole (a green peg when done), progress stamped in green, and its buttons at the tile's bottom right, the main one rightmost (Got it, then Show me).

### A town's card
- **Header and tabs:** its level stamped and its goods toward the next (a bar), then a groove of tabs: **Grow**, **Build** (places and treats), **Projects** (grand projects, from City), **Station** (its rows, lines, New route, upgrades, Automatic). A yellow peg on a tab with something ready there. Each pane about a phone's screen; on its side, a pane in two columns.
- **Next up:** a maple tile ("NEXT UP", its peg) saying what the town needs most, with the card's one painted button (green to make something, blue to go somewhere: the tray, Research). The card opens on its tab.
- **A project's ticket:** its reward first, its stages as pegs in holes (done green, under way blue) with their goods, then a pencil line and Start painted green. The other projects are maple rows with the price stamped in gold; a tap opens one's ticket.
- **Landing from the Journal:** the button it was opened for ringed in blue (3px) till the next tap. The Journal never picks the town: an achievement lists the towns it could be built in, and the player taps one.

### Tray tiles
84×90px maple tiles with the piece's picture, a two-line label, and corner marks: how many you have stamped in brown (a price to make one in gold), "Locked" stamped, a ★ favourite in yellow. Ready: a green ring and a painted "ready" tag; carried: a blue ring and "placing".
- **A locked tile, tapped:** a beech note over it (a notch pointing at the tile): 🔒 and the name, how to unlock it in plain words, and a green **📘 Show in Research** (44px). Gone with a tap elsewhere. Hover says the same in the tooltip.
- **Tabs on a narrow phone:** they always fit beside the tools, never scroll: tighter below 380px, then the tabs not open show only their picture, then all do (40×44px each).

### Lines and the line sheet
A line is a maple tile: its colour a painted square, its name in Lilita, its stops drawn as a bar, its state stamped (Moving, Waiting, Stuck, No trains). The sheet: the line's colour a painted disc, stop numbers maple pegs on a rail in the line's colour (the next one painted), an open stop a maple tile, tick boxes square holes painted green when ticked, Done the one painted block.

### Research board
A web of maple tickets on the beech board itself (no second surface), banded by subject, the bands ruled apart in pencil. The picked node is lifted and ringed in ink; its ticket sits under the web (upright) or beside it (a phone on its side).
- **Bands:** each subject's name is a lacquer tab painted in its colour (the only place that colour shows; no rail down each node) in a strip of its own above its tags (sticky sideways), never over a tag, with 10px above and below it in every band.
- **Tags by state, one slot each:** learned, a green peg with a ✓; researching, a blue peg, a blue ring round the tile, a painted "📘 Researching" tag and its progress as a 5px bar along the bottom; next up, a bare hole ringed in blue and "Next up" / "In line: N"; can research, a yellow peg and its price stamped in gold; later, a flatter, unsanded tile, a faded hole and its price stamped in brown; soon, a pencil outline and a pencilled "Soon". A "?" (not found yet) is a 44px pencilled circle, centred in the slot of the tag it stands for; on a phone a band's "?"s are one "N more to find" chip.
- **Links, quiet to loud:** laid like track (straight, one rounded turn in the gap between columns, each card's links in a lane of their own, never through a card). Future: a faint dotted line, no arrow, and none across more than a column or between two "?"s. Learned to learned: soft solid. Learned into one you can research: solid with an arrow. The picked tag's path: blue.
- **Ticket:** a maple card: the name (Lilita 22px), its line under it, then a label column (Unlocks, Needs, Opens, Costs), and the foot (goods, study, button) torn off along a pencil line. Its one button, when it can be pressed, is painted green.
- **Ticket buttons name what they do:** one that needs a blueprint not learned yet never says "Research now": "Queue Farming, then Mills", "Research Farming now". Taking one out of the queue that others need says so in a toast ("Removed Mills too").
- **A research learned:** its ✓ is stamped on, a glint runs over the card, the track to what it opens is laid and those cards click up; once, on the open board or the next time it opens.

## Do's and Don'ts

### Do:
- Pick a material for a new surface from the five above, and a state mark from peg, hole, stamp and pencil.
- Keep every tap target at least 44px (a small drawn chip gets an invisible `::after` reach).
- Put icon and word on one centre line, and check it by measuring the boxes, not by eye.
- Use one-off CSS animations for wins (a coin flips, the goal chip rocks, a toast is stamped down), all off under `prefers-reduced-motion`.
- Rebuild and animate only on change: the HUD costs nothing when nothing happens.
- Write as you'd say it to a child: "Join two towns", "Show me", "Pick a reward".
- Draw a new icon in `src/icons/` (see Icons) rather than reach for an emoji.

### Don't:
- Don't use backdrop-filter, big blur filters, or animations that loop while the player isn't looking at them.
- Don't paint more than one thing per panel; most buttons are maple.
- Don't use pills, soft rings (`inset 0 0 0 2px` of a pale tan) or coloured side stripes: they're the generic look this replaced.
- Don't use grey text on wood, or opacity under 0.7 for readable text.
- Don't put routine events (deliveries, goal ticks) in the News; it keeps growth, rewards, research, new goals and places, and problems.
