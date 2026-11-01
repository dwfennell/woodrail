# Design polish, 2026-11-01

An Impeccable pass (`critique` and `audit`, then `polish`, then `delight`) on Game mode's HUD. The pictures are `<view>-<surface>-before.webp` / `-after.webp`, at 390×844 (portrait), 844×390 (landscape) and 1440×900 (desktop), taken with `node tools/design/capture.mjs <out>`. The News pictures (`*-news-after.webp`) come from `node tools/design/news-check.mjs`, which puts 14 long entries in and checks that no row overflows.

## Critique (dual assessment: design review, and detector plus browser audit)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Locked tiles don't say why; nothing shows research needs a school until it's tapped |
| 2 | Match with the real world | 3 | Mostly kid words; some jargon ("20 s study", "Sawmills II, after 100 planks sawn") |
| 3 | User control and freedom | 3 | Undo, ✕ and Skip are all there; New game wasn't set apart in the menu |
| 4 | Consistency and standards | 2 | The landscape town card's ✕ at the bottom left; different tools in portrait and landscape |
| 5 | Error prevention | 3 | New game asks twice; Research is disabled with its reason |
| 6 | Recognition over recall | 2 | The Research button read as an "A" in a box |
| 7 | Flexibility and efficiency | 3 | Favourites and Show me |
| 8 | Aesthetic and minimalist design | 3 | Coherent wood; a flat 10-item menu |
| 9 | Error recovery | 2 | "Locked" and "Needs a school" give no next step |
| 10 | Help and documentation | 3 | The coach, Show me, and the research key |
| | **Total** | **27/40** | Good |

**Design specificity:** strong. The letter blocks, the beech panels and the toy-art tiles belong to this game alone.

**Detector:** 24 findings. Most were false positives for this world: the logo blocks' coloured letters, wood grain stripes, and the inset wood bevel read as "side tabs". Real findings were 10 px research tags, a 6 px coloured rail on the research ticket, and the contrast failures below.

## Fixed

- **The News** (from play-testing): rows ran into each other once the list scrolled (flex rows shrinking to 44 px). Routine deliveries, boat trades and goal ticks are left out now, and "Learned … · New goal: …" is two lines.
- **Contrast:**
  - inactive tray tabs 3.2:1 → about 5:1;
  - the "Locked" badge 2.4:1 → 4.6:1;
  - the Goals label, the research subtitle and its key 4.1:1 → about 5:1;
  - the next goal's line 3.1:1 → about 5:1.
- **Research on its side:** its ticket now sits beside the web. Before, it covered all but a 20 px strip.
- **Research button:** an open book now, matching the 📘 on the pill.
- **Menu:** grouped, with lines between the groups, and items 44 px tall.
- **Industries tab:** shows in full at 390 px.
- **Focus ring:** a designed blue focus ring, and thin wood scroll bars.
- **Show me:** 44 px tall (was 40).
- **Top bar:** a disabled button stays solid wood.
- **Cards:** a bolder ✕.
- **No backdrop blur:** removed from the cards, menu and logo.
- **Delight:** a coin flip, the goal chip rocking, a toast stamped down, stickers pressed on, and tabs that give under a finger. Each is a one-off animation, and all are off under reduced motion.

## Left for later

- **The landscape town card:** about 146 px tall, with a scrolling ledger and the ✕ in its footer. This layout was tuned by QA. A two-column layout (the ledger beside the switches) needs its own pass with `e2e:station-upgrade`.
- **Locked tiles:** say how to unlock ("Learn it in Research", "after the goal …"), and fold the run of locked industries into one tile.
- **The ☰ menu's bug-report items:** could move to a submenu.
- **At 360 px:** the tray tabs still scroll beside Turn and Flip on the Industries tab.
