# HUD: four proposals for a less generic, more wooden HUD (2026-11-09)

The brief: the HUD "is giving AI UI": too soft, not opinionated. Lean into real wood. Proposals only: **no game code changed**.
A fourth direction (D, not wood) was added after the user said they're open to ideas beyond wood.

Every mock is the **real game's HUD, re-skinned by one stylesheet**: same DOM, same words, same 390×844 phone at 2x,
over a live Game-mode map (an oval with a forest, sawmill and workshop, two lines, three trains). So what you see is
what that CSS would ship, including where it breaks (see "goal title" below). Made by
`tools/shots/hud-wood-mocks/` (`node tools/shots/hud-wood-mocks/stage.mjs <out>`, `THEMES=toybox,…` for some; the
themes are `themes/*.css`; the grain tile is `grain.webp`, from `grain.py`).

Each direction has four screens: the main view with the tray open, the ☰ menu, a train card, a toast with the goals chip.
Shots: `docs/agents/shots/hud-wood-<direction>-<tray|menu|card|toast>.jpg`, and all four side by side in
`hud-wood-<direction>-sheet.jpg`.

| | |
|---|---|
| Today | `hud-wood-today-sheet.jpg` |
| A · Toy box lacquer | `hud-wood-toybox-sheet.jpg` |
| B · Workshop: raw wood and stamps | `hud-wood-workshop-sheet.jpg` |
| C · Station enamel | `hud-wood-enamel-sheet.jpg` |
| D · Picture book (not wood) | `hud-wood-picturebook-sheet.jpg` |

## 1. Critique: what reads as "AI UI" today

Looking at `hud-wood-today-*.jpg`:

- **One material for everything.** The brand, goals bar, top-bar buttons, menu, card, tray, tiles and toast are all
  the same cream-to-beech gradient. Nothing says "this one is a button, this one is a board". Generic UI kits do this:
  one surface colour, then elevation.
- **Soft, blurred elevation everywhere.** Every element floats on a 14–34 px brown blur (`0 4px 14px`, `0 10px 34px`).
  Wooden things on a table have short, dark contact shadows. The blur makes the HUD hover over the toy instead of
  being part of it.
- **The same rounding at every size**: 13, 14, 16, 18, 20 px corners. Pill shapes and big radii are the default of
  modern app UI. Nothing is cut, chamfered or squared off, so there's no sense of a tool having made it.
- **Nunito at heavy weights.** A rounded humanist sans is the safe "friendly app" choice. It is legible and kind but has
  no voice: nothing like the lettering on a toy box, a sign or a stamp.
- **Colour is pastel and timid.** The lacquer reds and blues of the logo appear only as faded fills: the Stop button
  is a salmon gradient, the goal count a mint pill, the toast a pale yellow with a 4 px left stripe (itself a generic
  "callout" habit). The world's own toys (red engines, blue roofs) are louder than the HUD.
- **No hierarchy of weight.** The ☰ menu is 15 rows of identical text, separated by faint lines; the top-bar buttons are
  five identical beige squares; tabs are text on a slightly darker strip. Everything is the same importance.
- **Toast reads as a notification, not a toy.** Pale card, soft shadow, slight tilt: the tilt is the one bit of
  character, and it's too subtle to land.

**Worth keeping** (all four directions keep them):

- **The icon font** (`src/icons/`, drawn in the palette, not emoji). It already looks made, not stock.
- **The thickness inset** (`inset 0 -3px 0`) on chips: the right idea, just too faint. Every direction makes it the
  main depth cue.
- **The lacquer palette and the logo's letter blocks**, the card's structure (name, status, Go/Stop, route, actions),
  the tray tiles with their real rendered pictures, 44 px targets and the short, plain words.
- **The HUD costs nothing when idle.** Nothing below animates or repaints by itself.

## 2. The directions

### A · Toy box lacquer
*The HUD is the toy.* Buttons are lacquered blocks in the logo's four colours, each with a gloss line and a darker
cut edge; boards (goals, card, menu, tray) are natural beech with real grain and their thickness cut square along the
bottom. Shadows are short and nearly hard: a block standing on a table. Lettering in **Lilita One**, the kind printed
on a toy box. Colour carries meaning: the top bar is a row of letter blocks (Research blue, Map green, Undo yellow,
Pause red, Menu dark), the open tray tab is painted all over while the others are unpainted wood with a coloured dot,
the menu has a red lacquer lid, wins are a green block clicked into place.

### B · Workshop: raw wood and stamps
*Offcuts from the toymaker's bench.* Unpainted birch ply with its layers showing along the cut edge, square or
chamfered corners, dowel pins, pencil-ruled dashed lines, and two inks: near-black and a rubber-stamp red. Headings
and tabs stencilled (**Stardos Stencil**, uppercase), body in **Bitter**, a slab serif. The goal count is a red stamp
set a little crooked; "MENU" is stamped onto its board; a toast is masking tape stuck on crooked, written in marker,
with a red DONE stamp for a win. The most "made by hand", the least colour.

### C · Station enamel
*The station's furniture.* Vitreous enamel signs (deep green, navy, signal red, cream) with the cream rule just inside
the edge, brass screw heads, set in dark-stained oak. Condensed uppercase (**Barlow Condensed**) as on a platform sign,
**Barlow** for body. The menu is a green departures board; a train's name sits on a green nameplate across the top of
its card; toasts are station notices. Wood here is the frame and the tray, not the signs. The most grown-up and
formal: it reads "railway" before it reads "toy".

### D · Picture book (not wood)
*The HUD is the book about the toy.* Cream paper, one confident 2.5 px ink line round every shape, flat print
colours (tomato, teal, mustard, leaf), a short ink "sticker" shadow, a halftone dot texture on the menu. **Bricolage
Grotesque**, a sans with character. A win is a speech bubble in leaf green. The clearest to read and the boldest
outline, but it says "illustration" while the map says "modelled toy".

## 3. Tokens per direction

All four keep the icon font, 44 px targets, the layout and the copy. Values are the ones in the mock stylesheets.

| | A · Toy box | B · Workshop | C · Enamel | D · Picture book |
|---|---|---|---|---|
| Surfaces | beech `#ebc995`→`#f6e2bd` + grain; tiles maple `#fbf1df` | birch ply `#efdfbf`→`#e2cb9f` + grain | enamel cream `#f5edd8`, green `#1f5a3d`, navy `#1d3461`; oak frame `#84552d`→`#5f3a1c` + grain | paper `#fbf5e6`, `#f3e8cd` |
| Ink | `#2a1a0e`; soft `#4f3418` | `#241a11`; soft `#4f3b26`; pencil `rgba(60,50,40,.55)` | `#15211b` on cream, cream on colour | `#1d1712` |
| Accents | red `#cf3a22`/`#8f2312`, blue `#2563b0`/`#143f78`, yellow `#f4b61a`/`#a97a00`, green `#2f8b3f`/`#1b5a26` (fill / cut edge) | stamp red `#b3301c`/`#7d1f10`, go green `#3b7a3a` | signal red `#b8281c`, brass `#c9a23f`, yellow `#e8b830` | tomato `#e2512d`, teal `#18748a`, mustard `#f1b22f`, leaf `#3f9a35` |
| Type | Lilita One 400 (titles, buttons, tabs, toasts); Nunito 800 body | Stardos Stencil 700 uppercase (titles, tabs, stamps); Bitter 700–800 body | Barlow Condensed 700–800 uppercase, +0.05em; Barlow 600 body | Bricolage Grotesque 600–800 |
| Radii | 9 px blocks, 10–12 px boards, 8 px tiles | 2–3 px, 7 px chamfers (clip-path) | 5–7 px | 12–18 px, pills for counts |
| Depth | gloss `inset 0 2px 0 #fff6`, cut edge `inset 0 -4px 0 <dark>`, drop `0 6px 6px -3px rgba(40,22,6,.45)` | ply edge: 5 stacked insets (`-2/-4/-6/-8/-9px`), drop `0 3px 0 rgba(50,30,10,.35)` + `0 6px 5px -2px` | rule `inset 0 0 0 3px <field>, inset 0 0 0 5px cream`, drop `0 3px 0 rgba(0,0,0,.25)` | ink line `0 0 0 2.5px`, sticker `0 3px 0 2.5px` ink |
| Texture | grain tile | grain tile; dowel pins (2 radial gradients) | grain tile (oak only); screws (2 radial gradients) | halftone dots (1 radial gradient) |

## 4. What it costs on a phone

- **Texture:** one 256×256 luminance grain tile, `grain.webp`, **1.5 kB**, tiled and tinted by each board's own colour
  with `background-blend-mode: multiply` (so the same tile is beech, ply or oak). Decoded once (256 kB of RAM); the
  HUD only repaints when it changes, as today. No new GPU textures: it's DOM, not the WebGL scene. D needs no image.
- **Everything else is CSS gradients and box-shadows**: gloss, cut edges, ply layers, rules, pins, screws, dots. No
  backdrop-filter, no blur filters. The shadows are *smaller* than today's 14–34 px blurs, so cheaper to paint.
- **Watch:** B's chamfered corners use `clip-path`, which clips outer shadows, so the mock uses `filter: drop-shadow`
  on the top-bar blocks, the Go/Stop row and the toast. That's a filter layer per element: fine while static, but it
  should be checked with `npm run perf` (tray drag, cards) before shipping; the cheaper path is plain 3 px corners.
- **Fonts** (Latin woff2, measured): A Lilita One **10 kB** (plus Nunito as now, 38 kB); B Stardos Stencil 13 kB +
  Bitter 33 kB (Nunito could go: about +8 kB net); C Barlow Condensed 43 kB + Barlow 22 kB (about +27 kB net);
  D Bricolage Grotesque 38 kB (replaces Nunito, about even). All would be self-hosted with the icon font, `font-display`
  as now, under `perf:check`'s bundle budget.
- **No per-frame work** in any direction. Wins keep their one-off CSS animations.

## 5. Accessibility

Contrast (WCAG, computed from the tokens):

| Pair | Ratio | |
|---|---|---|
| A ink on beech / brown on beech | 10.6 / 7.3 | ✓ |
| A cream on red / blue | 4.6 / 5.7 | ✓ |
| A cream on green | **4.1** | large text only (Go 24 px, toast 18 px are fine); the 14 px goal count needs green `#287a36` or darker |
| A ink on yellow | 9.2 | ✓ |
| B ink / soft ink on ply | 10.8 / 6.7 | ✓ |
| B stamp red on ply / cream on stamp red | 4.8 / 5.9 | ✓ |
| B ink on masking tape | 12.7 | ✓ |
| C cream on green / navy / red | 7.0 / 10.5 / 5.4 | ✓ |
| C body ink on cream | 10.2 | ✓ |
| D ink on paper / on mustard | 16.3 / 9.4 | ✓ |
| D white on leaf / tomato | **3.6 / 3.9** | large text only, helped by the ink text-shadow; darken to `#2f7d27` / `#c8401e` for small text |
| D white on teal | 5.4 | ✓ |

- **Tap targets** are unchanged: every control is still at least 44 px (the top-bar blocks are 46 px).
- **The goal title:** B, C and D's lettering is wider (uppercase or a wider face). With "Show me" spelled out, the goal
  truncated to "JOIN TW…". The mocks make Show me icon-only there (as `show-tight` already does on narrow phones).
  Anything uppercase also needs checking with the longest strings (goal names, menu items, tray labels at 9.5 px).
- **Uppercase** (B, C) is slower to read for children and early readers; keep it to short labels and titles, never
  body text or toasts with a sentence in them (C's toast in uppercase is the weakest point there).
- **Colour is never the only signal**: the open tab is also taller and differently shaped; Stop says "Stop".
- **Focus ring**: the 3 px blue ring stays, drawn inside; on C's navy plates it would need to be cream or yellow.

## 6. Recommendation

**A · Toy box lacquer, with two borrowings from B.**

- **Why A.** It fixes exactly what reads as generic: it gives the HUD a second material (glossy paint) beside the
  wood, makes colour mean something (which block, which tab, which state), replaces the soft blur with a block's short
  shadow, and gives the lettering a voice. It's the direction closest to the 3D world (the engines are lacquered
  wood on beech track) and to the logo's letter blocks, so the HUD finally looks like it belongs to the toy. It's
  also the cheapest: one 10 kB font, one 1.5 kB tile, no clip-paths or filters, and it keeps Nunito for body text.
- **Borrow from B:** the **rubber stamp** for small counts and badges (the goal count, costs, "Locked", the research
  ticket's price) and **pencil-ruled lines** for separators. They add the "made by hand" note in small places without
  turning the whole HUD beige-on-beige.
- **Why not the others as the base.** B is beautiful up close but it is wood on a wooden world: the HUD sinks into
  the track and the felt, and with one colour, states are harder to tell apart. C is the most distinct and the
  most "railway", but its dark plates cover more of the map, its uppercase costs width and reading ease, and it reads
  adult and formal for a toy that children play. D (not wood) is the most legible and the boldest outline, but a flat
  drawn HUD over a modelled 3D toy is two styles at once.
- **Before building:** fix A's small-text green (`#287a36`), decide the top bar's colour per button (the mock's
  Research blue, Map green, Undo yellow, Pause red, Menu dark), and run the `/impeccable` polish on the remaining
  surfaces (Journal, research board, line sheet, place cards) in the same language, then `npm run perf:check`.

## 7. Round two: A+ (Toy box with B's stamp and pencil)

After the first round the user picked A and asked for: B's stamp and pencil added, careful icon and text alignment,
the goal title not cut off, a clearer Clear icon, Show me without its word on a phone, a quieter sheen on the top-bar
blocks (the hard light-over-dark line through the middle), and the desktop HUD in this style.

Shots: `hud-wood-toybox-plus-<tray|menu|card|toast>.jpg` (phone), `hud-wood-toybox-plus-desktop-*.jpg` (1440×900),
with today's desktop HUD for comparison in `hud-wood-today-desktop-*.jpg`. Stylesheet: `themes/toybox.css` then
`themes/toybox-plus.css` (run with `THEMES=toybox-plus`, and `DESKTOP=1` for the desktop page).

What changed from A:

- **Sheen:** the lacquer's gloss is a soft lift at the top that fades by halfway (`rgba(255,255,255,.18)` to 0 at 55%),
  not a hard band at 46%. It applies to every painted block (top bar, tabs, Go/Stop, toasts), so they stay one family.
- **Stamps** (from B): the goal count is stamped in red on the wood, crooked by 3°; the counts on tray tiles are
  stamped in brown; Remove on a train card is stamped, not painted (a destructive action shouldn't be the loudest
  thing on the card); a goal done is a green block with a DONE stamp on it.
- **Pencil** (from B): dashed pencil rules between the menu's groups, round a train's line in its card, and
  between a card's buttons.
- **Goal title:** on a phone, Show me is its icon alone (the label stays for screen readers), so "Join two towns"
  fits; a longer goal takes a second line rather than an ellipsis. Desktop keeps the word.
- **Clear:** a new drawing proposed for the eraser: a pink-and-blue school eraser with crumbs, in the icon font's
  style (the sponge read as a yellow block at 22 px). In the mock it's swapped into the button; shipping it means
  drawing it in `src/icons/` per DESIGN.md. Desktop shows it with its word, "Clear".
- **Alignment:** icons in the top bar sit on the centre of the painted face, not the box (lifted half the 4 px cut
  edge); Undo and Redo's arrows, which carry their weight low, go up 2 px more (measured from the screenshot: 2 px
  below their neighbours before, level after). Tabs, Draw and Clear, the goal stamp and bell, the card's name and
  pencil, Go/Stop's mark and word, and route-stop numbers are each laid out as a centred row (`inline-flex`,
  `align-items: center`, `line-height: 1`), not left to their fonts' baselines.
- **Tabs:** the coloured dot beside each word is gone (it cost width); the colour is a painted strip along the tab's
  bottom edge, and the open tab is painted all over.
- **Desktop top bar:** nine buttons, coloured by kind so it reads as four groups: Research blue; Map and Add land
  green; Undo and Redo yellow; Pause red; Sound, Fullscreen and Menu dark.

Still to do before building: the expanded Journal (its Goals/News tabs and Show me / Got it buttons are only lightly
restyled here), the research board, the line sheet and place cards, then `npm run perf:check`.
