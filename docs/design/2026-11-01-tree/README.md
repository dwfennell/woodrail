# Research board: Impeccable critique, audit and polish (2026-11-01)

The Research board (`src/ui/blueprint-board.ts`, the `.bp-*` and `.board-*` rules in `src/style.css`), in a mid-game state: 12 learned, Mills under way, Passengers queued, others ready, later, soon and not found yet. Pictures from `node tools/design/research-board-shots.mjs <out>` at 390×844 and 844×390 (touch) and 1440×900. `*-before.webp` is main at 5d32dc8, `*-after.webp` is this branch.

## Critique (method: dual-agent, a design review and a detector/static audit in separate agents)

Before: 24/40 on Nielsen's heuristics. Status 2, real world 3, control 3, consistency 2, error prevention 3, recognition 2, efficiency 2, minimal design 2, recovery 3, help 2. Cognitive load high (4 of 8 checks fail).

What worked, and was kept: the punched ticket (tray pictures, goods chips, short ones red, one 44 px button, a plain "why"); `show()` redrawing only the ticket for progress; one layout per shape (lists upright, ticket beside the web on its side).

Priority issues and what was done:
1. **P1. Band names over the tags, and clipped at the top.** The sticky name floated over the first column when the web scrolled sideways, and the first scroll landed mid-band. Now each band's name is a tab in a strip of its own above its tags (sticky sideways only), and the board opens scrolled to the top of the picked tag's band, only as far right as shows it.
2. **P1. Tangled links.** Long dashed beziers crossed the web. Links are now laid like track (`routeLinks`): straight out, one rounded turn in the gap between columns, a lane per card, a gutter run under a row when the straight would go through cards. None between two "?"s, and no dotted future link across more than a column (the ticket names what a card needs). Four weights: future (faint dots, no arrow), laid (soft), open (solid with an arrow), the picked path (blue).
3. **P1. "Researching" unclear.** Now a blue ring round the card, a solid blue tag, and its progress as a bar along the bottom (as the top bar's pill), moved by a CSS variable without redrawing the web. The looping `bp-lamp` glow (a repaint every frame while open, and a coloured halo) is gone.
4. **P2. "?" noise.** A "?" is a 44 px dashed circle, not a 148 px box. On a phone a band's "?"s are one "N more to find" chip.
5. **P2. Inconsistent pills.** Every card not learned has a tag in the same slot, one height and shape: price on gold (can research), price outlined (later), "Next up" / "In line: N", "📘 Researching", "Soon". The cost text itself is unchanged (another branch owns it).

## Audit (static, and the detector)

The detector reads no markup inside TypeScript templates, so it found nothing in the board's code; on `style.css` it flagged token drift (hex literals, sizes off the ramp) and side-tabs that are the design's lacquer rails (false positives). Fixed from the static audit: text in `#b8a68c` (2.3:1) and `#7a6650` (4.7:1, below 4.5:1 on the gradient) moved to `#74522f`/`#5e4128`; the white ✓ on a pale green dot is now on a darker green; `.bp-tag` 10.5 px raised to 11 px; tags' accessible names say their state ("Mills, researching now") and the picked one has `aria-current`; the close button has an `aria-label`; tags have a focus ring; the legend says "Next up", as the tags do. Every button and summary on the board measures at least 44 px at all three sizes.

## Delight

A research learned: its ✓ is stamped on like a sticker, a glint runs over the card, the track to what it opens is laid (a stroke drawn in), and those cards click up. Once, on the open board or the next time it opens; off under reduced motion. CSS animations only, started by a class in a redraw that happens anyway.

## Cost

The web is laid out and routed once per redraw (when a tag's name, state, price or the selection changes); nothing runs per frame, and no animation loops.
