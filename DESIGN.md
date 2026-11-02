---
name: Woodrail
description: A wooden toy railway on a table, its HUD made of the same beech as the track.
colors:
  ink: "#2b2118"
  ink-wood: "#3a2a1c"
  ink-soft: "#5e4128"
  ink-muted: "#74522f"
  paper: "#f6efe3"
  panel: "#faf3e6"
  beech: "#e7c89a"
  beech-light: "#f3dcb6"
  beech-dark: "#dcb682"
  beech-edge: "#b07a44"
  lacquer-red: "#c8442f"
  lacquer-blue: "#2f6fb5"
  lacquer-yellow: "#e2a12b"
  lacquer-green: "#3f8f4a"
  go-green-light: "#8fd08a"
  go-green: "#5aa35a"
  go-green-ink: "#13310f"
  attention: "#f0ae3c"
  focus: "#2f6fb5"
  page: "#cbbba3"
typography:
  family: "Nunito, system-ui, -apple-system, sans-serif"
  weights: [500, 700, 800, 900]
  title:
    fontSize: "20px"
    fontWeight: 900
  card-title:
    fontSize: "15px"
    fontWeight: 800
  button:
    fontSize: "15px"
    fontWeight: 800
  body:
    fontSize: "13.5px"
    fontWeight: 700
    lineHeight: 1.3
  small:
    fontSize: "11.5px"
    fontWeight: 700
  floor:
    fontSize: "11px"
rounded:
  tag: "8px"
  item: "10px"
  chip: "13px"
  tile: "14px"
  card: "18px"
  panel: "20px"
  pill: "999px"
spacing:
  hairline: "4px"
  tight: "6px"
  base: "8px"
  card: "12px 14px 14px"
  gutter: "12px"
components:
  chip:
    background: "linear-gradient(180deg, {colors.beech-light}, {colors.beech-dark})"
    textColor: "{colors.ink-wood}"
    rounded: "{rounded.chip}"
    height: "44px"
  chip-primary:
    background: "linear-gradient(180deg, {colors.go-green-light}, {colors.go-green})"
    textColor: "{colors.go-green-ink}"
  card:
    backgroundColor: "rgba(250, 243, 230, 0.97)"
    rounded: "{rounded.card}"
  tray-item:
    size: "84px x 90px"
    rounded: "{rounded.tile}"
---

# Design System: Woodrail

## Overview

A Brio-style wooden railway on a phone. The 3D table is the star; the HUD is the toy box around it: pale beech boards with their thickness showing, chunky rounded buttons like painted blocks, and lacquer colours (red, blue, yellow, green) borrowed from the letter blocks of the logo. It is warm, calm and tactile, never glassy or techy. Players include children, so words are short and plain, and every win is acknowledged like a toy clicking into place.

Mode: Operate (a game HUD). The map comes first; the HUD stays at the edges, costs nothing when nothing moves, and fits a 360 px phone in both orientations.

## Colors

### Primary
- **Beech** (`#e7c89a`, gradients `#f3dcb6` to `#dcb682`): every button, the tray, the tabs. Wood, not paint.
- **Ink wood** (`#3a2a1c`): text on wood and cream.

### Secondary
- **Lacquer** red `#c8442f`, blue `#2f6fb5`, yellow `#e2a12b`, green `#3f8f4a`: the logo's blocks, and status. Blue is focus and "researching"; green is go, on and done; yellow is attention and a goal to reach for; red is a warning or a destructive ask.

### Neutral
- **Panel cream** (`#faf3e6`, the `--wood-panel` grain): cards, the Journal, the research board.
- **Muted ink** `#5e4128` and `#74522f`: secondary text. On cream and beech these hold 4.5:1; anything paler is decoration only.

### Named Rules
- **Text holds 4.5:1.** Inactive tabs, labels and hints use `#5e4128`/`#74522f`, never a paler brown or an opacity below 0.7.
- **No glass.** Panels are near-opaque cream; no backdrop-filter (it re-blurs over the live canvas every frame a train moves).

## Typography

Nunito throughout, heavy: 700 for body, 800 for buttons and titles, 900 for big titles (town names, Research).

### Hierarchy
- Panel title 20–22px/900; card title 15px/800 (a town's card 20px/900).
- Buttons 15–17px/800; tray tabs 13–13.5px/800.
- Body and News rows 13.5px/700, line-height 1.3.
- Small (dates, tile labels) 11–12px/700. **11px is the floor** on a phone (9.5px only for a tray label squeezed to fit, with a short name as the fallback).

## Layout

- Top bar: brand/coins/date at the left, icon chips at the right, 12px from the safe-area edges, 6px apart.
- The Journal (goals) sits under the brand at the left; toasts sit under whatever is pinned below the top bar, clear of the tray.
- The tray docks at the bottom, centred, max 980px wide. Cards sit just clear of it (upright) or dock at the right under the top bar (a phone on its side).
- Group tightly (4–8px inside a group), separate generously (10–14px between groups).

## Elevation & Depth

Wood has a thickness: depth is an inset highlight on top (`inset 0 1px 0 #fff8`), a darker inset at the bottom edge (`inset 0 -3px 0 rgba(120, 80, 40, 0.25)`), and a soft brown drop shadow (`0 4px 14px rgba(60, 40, 20, 0.22)`). Cards float higher (`0 10px 34px rgba(60, 40, 20, 0.3)`). No zero-blur block shadows, no coloured halos.

## Shapes

Generous rounding: chips 13px, tiles 14px, cards 18px, panels 20px, pills for badges and counts. A toast is a paper luggage tag: 6px corners, a coloured left edge, a slight tilt.

## Components

### Buttons
- **Chip:** beech gradient, 44px tall at least, 13px corners, 800 weight. Pressed: down 1px and 2% smaller. Disabled: 0.45 opacity; in the top bar it stays solid wood with its picture faded.
- **Primary / on:** green lacquer gradient with dark green ink.
- **Toggle:** a label and a pill switch; off is outlined, on is filled green with the knob right.
- **Focus:** a 3px blue (`#2f6fb5`) outline drawn just inside the control (`outline-offset: -3px`), so a scrolling strip never clips it and it never laps a neighbour. Shown only while moving focus by Tab (`.kbd-nav` on the root, `src/ui/focus-ring.ts`), never after a click or tap, even when a key follows; a text box rings whenever it has focus.

### Cards / Containers
Cream, 18px corners, 12–14px padding, a bold `✕` (18px/900, `#6a4a2c`) in a 44px corner target. Cards pop in (0.24s, slight overshoot).

### Navigation
- **Tray tabs:** wood tabs hanging from the tray's top edge; the open one is cream and lifted.
- **Menu (☰):** a cream list in groups (playing, settings, help, leaving this map, the bug report) with faint 2px lines between them; items 44px tall.

### Tray tiles
84×90px cream tiles with the piece's picture, a two-line label, and corner badges: a green count, a brown "Locked", a gold ★ favourite. Ready: a green ring and a "ready" tag; carried: a blue ring and "placing".

### Research board
A web of wooden tickets on squared paper, banded by subject, with a lacquer rail on each node's left. The picked node is lifted with a wood ring; its ticket sits under the web (upright) or beside it (a phone on its side).
- **Bands:** each subject's name is a painted tab in a strip of its own above its tags (sticky sideways), never over a tag, with 10px above and below it in every band.
- **Tags by state, one slot each:** learned, a green dot with a ✓; researching, a blue card ring, a blue "📘 Researching" tag and its progress as a 4px bar along the bottom (as the top bar's pill); next up, a blue-ringed dot and "Next up" / "In line: N"; can research, a yellow dot and its price on a gold pill; later, a flat card and its price outlined; soon, a dashed card and a dashed "Soon". A "?" (not found yet) is a 44px dashed circle, centred in the slot of the tag it stands for; on a phone a band's "?"s are one "N more to find" chip.
- **Links, quiet to loud:** laid like track (straight, one rounded turn in the gap between columns, each card's links in a lane of their own, never through a card). Future: a faint dotted line, no arrow, and none across more than a column or between two "?"s. Learned to learned: soft solid. Learned into one you can research: solid with an arrow. The picked tag's path: blue.
- **Ticket:** the name (18px/900), its line under it, then a label column (Unlocks, Needs, Opens, Costs), and the foot (goods, study, button) torn off along a dashed perforation.
- **A research learned:** its ✓ is stamped on, a glint runs over the card, the track to what it opens is laid and those cards click up; once, on the open board or the next time it opens.

## Do's and Don'ts

### Do:
- Keep every tap target at least 44px (a small drawn chip gets an invisible `::after` reach).
- Use one-off CSS animations for wins (a coin flips, the goal chip rocks, a toast is stamped down), all off under `prefers-reduced-motion`.
- Rebuild and animate only on change: the HUD costs nothing when nothing happens.
- Write as you'd say it to a child: "Join two towns", "Show me", "Pick a reward".

### Don't:
- Don't use backdrop-filter, big blur filters, or animations that loop while the player isn't looking at them.
- Don't use grey text on wood, or opacity under 0.7 for readable text.
- Don't redesign the logo blocks, the wood or the lacquer: polish them.
- Don't put routine events (deliveries, goal ticks) in the News; it keeps growth, rewards, research, new goals and places, and problems.
