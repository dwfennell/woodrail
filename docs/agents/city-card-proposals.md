# The city card: critique and three directions

The user's note, on the Journal's Achievements tab beside Rookhurst's City ★ card: *"'Show me a City ★' doesn't really make a lot of sense? And then it's not clear what you should do once you are on the city card... city card in general could use a redesign... not very discoverable right now. Lots of cool features here, but we are hiding them!"*

Pictures: `docs/agents/shots/city-card-*.jpg`, phone at 390×844 and desktop at 1440×900, in the Toy box style (branch `claude/hud-wood`, `DESIGN.md`). The mocks are HTML and CSS laid over the running game, nothing built yet: `node tools/shots/city-card-mocks/stage.mjs [<out>] [<scene,…>]` draws them all again (about 15 min).

## 1. Critique: the card and the flow today

`city-card-today-phone-1-top` … `-5-after-show-me`, and the same for `desktop`.

Larkfield is a City ★ with 1,240 coins. It can start any of five grand projects, plan a town hall, buy four treats and grow toward ★★. On the card that comes out as:

| Order on the card | What it is | The problem |
|---|---|---|
| 1 | **New route from here** | It's the first thing on the card, though it's about trains, not the town. |
| 2 | City ★, "29 of 82 goods to grow bigger", a bar, five goods bars, each with its wagon | Useful, but it fills the whole first screen on a phone. |
| 3 | "Needs flour: there's no mill yet. Build one from the tray" | It says what to do but isn't a button. The player has to find the tray, the Industries tab and the mill shelf alone. |
| 4 | Always buys …, Market, Post, (School, Station) | Rows of facts, some of them actions in disguise ("once there's a post office"). |
| 5 | Places: four empty smile rings, Town hall *Build · 60 + 6* | Second screen. |
| 6 | Treats: four tiles, four green *Buy · 100* | Third screen. |
| 7 | **Grand projects**: five tiles, five green *Build · 300–500* | Fourth screen. That's the end-game feature, and nothing above it says it exists. |
| sticky | Automatic (on) | Not clear what's automatic: it's whether the station loads and unloads by itself. It takes the foot of every screen, and the tiles show through below it (`today-phone-3-grand`: World's Fair peeks out under the board). |

**What's hidden.** A phone shows about a quarter of the card. Grand projects, the best thing a City ★ unlocks, are four scrolls down. Nothing on the first screen says a City ★ can build them: no count, no tab, no hint. On desktop the card scrolls inside itself, and its scrollbar is the only sign there's more.

**What's unclear.** Every action has the same weight. A City ★ card has **ten green painted buttons** (town hall, four treats, five projects), against the Toy box rule of one painted block per panel, so none of them reads as *the* next step. The grand project tiles put their 25-word rewards above the price, and none of them says the city has to be fed goods in stages after you pay.

**What order the player needs.** At this point the player wants (1) how big the town is and what it needs to grow, (2) the one thing worth doing next, (3) the big things it can now build, then (4) the station and lines. The card puts the station first and the big builds last.

**The Journal flow.** The Achievements tab (`today-phone-4-journal`) says "Start it from a City ★'s card" while Larkfield *is* a City ★, and doesn't name it. Its button, **Show me a City ★**, names a kind of thing, not an action. A tap flies the camera to Larkfield and opens its card at the top, or on desktop wherever it was last scrolled (`today-*-5-after-show-me`), with no word about the project the player just tapped. The player then has to scroll four screens to find the Exhibition's Build button. With no City ★ on the map, the same button flies to the biggest town and says why only in a toast.

Scores, by heuristic (Nielsen, 0–4; a single-context review, not the impeccable skill's two-agent critique): system status 3 (the bars are good) · match to the world 3 · control 3 · consistency 2 (ten painted buttons; Automatic with no subject) · error prevention 3 · recognition over recall 1 (the Journal makes you remember which town is a City ★; the projects are out of sight) · efficiency 1 (four scrolls to the main action) · minimalism 2 · recovery 3 · help 2. **23/40.**

## 2. Three directions

All three keep the town's facts and the game's rules as they are. They share three changes:

- **A header** that's always in view: the name, the level stamped (City ★), and the bar to the next star ("29 of 82 goods to grow", ★ → ★★).
- **Next up**: one maple tile saying the one thing the city needs most, with the card's **one painted button**. It changes with the town:

  | The town | Next up says | The button |
  |---|---|---|
  | No line calls at its station | Trains bring what it needs | **New route from here** |
  | Short of a good with nothing on the map making it | Bring flour: Larkfield has no mill | **Find a mill on the tray ›** (opens Industries at the mill shelf) |
  | Town and up, no town hall | A town hall lets it plan places | **Build a town hall · 60** |
  | A City ★ with no project and the coins | Larkfield can build a grand project | **Pick a grand project ›** |
  | A project under way | Great Exhibition, stage 2 of 4: 6/16 🔩 | **Show the site** (maple; nothing to start) |
  | Otherwise | 53 more goods to City ★★ | none: the goods bars say it |

- **"Needs flour" becomes a row with its button** (Find a mill ›, which opens the tray at the right shelf), as do Post's "once there's a post office" (Find one ›) and the school row. "Automatic" becomes **Load automatically** and moves into the Station part.

### A. One scroll, Next up first, a jump strip

`city-card-A-phone.jpg`, `city-card-A-desktop.jpg`

Below the header and Next up sits a strip of four maple chips, **Grow · Projects · Places · Station**. A tap scrolls the card to that part. A yellow peg on a chip marks something ready there, such as a project you can start. The parts come in the order the player needs them: Grow (the goods in two columns, so five fit in three rows), Grand projects (one compact row each: picture, name, its reward in six words, its price stamped in gold; a tap opens it), Places and Treats, then Station and lines.

- **For:** the smallest change: one column, nothing behind a tab, every feature named on the first screen.
- **Against:** it's still long. A phone still scrolls three screens, and the chips are only shortcuts through a long list.

### B. Tabs: Grow · Build · Projects · Station

`city-card-B-phone-grow.jpg`, `city-card-B-phone-projects.jpg`, and the same for `desktop`

Under the header, a groove view switch like the Journal's (Goals/News) and the line sheet's (Stops/Trains): **Grow** (goods, what it buys, the missing-good rows), **Build** (Places and Treats), **Projects** (grand projects; the tab shows from City, pencilled "At City ★" until then, so the player sees them coming), and **Station** (station, lines, New route, Load automatically, market, post, school). Each tab is about one phone screen.

- **The card opens on the tab of its Next up.** A town short of flour opens on Grow, with Next up at the top of that tab. A City ★ ready for a project opens on Projects. A yellow peg on a tab marks something ready there.
- **Projects** shows the picked project as a ticket, like a research ticket: the reward first (🎁 *Every town grows a step*), its stages as holes that become pegs, each with its goods, then a pencil line and the one green **Start · 400**, with "Trains bring each stage's goods to Larkfield's station" beside it. The others are compact rows with their prices stamped; a tap picks one. Once a project is under way, its ticket shows the stage under way with its goods bars and **Show the site**.
- **For:** every feature is named at the top of the card and is one tap away. Each tab fits a phone without scrolling. One painted button per tab. It uses a control the player already knows.
- **Against:** a tap to see each part. Four tabs at 360 px need short words (they fit: 44 px tall, 15 px Lilita).

### C. A short card and a town board

`city-card-C-phone-card.jpg`, `city-card-C-phone-board.jpg`, `city-card-C-desktop-board.jpg`

A tap on a town gives a **short card**: the header, Next up, three doors (Grow "1 good missing", Projects "5 to start", Station "2 lines") and **Open Larkfield's board ›**. The map stays in view. The **board** is a full-screen sheet on a phone (B's tabs inside it) and a wide board on desktop with three columns: Grow and Places | Grand projects | Station, lines and services.

- **For:** the quickest look at a town while playing, and on desktop everything at once, using the width.
- **Against:** two surfaces to build and keep in step, and one more tap to reach anything. It's the most work, and the phone board is B anyway.

## 3. The Journal: the player picks the city, and lands on its Start

`city-card-journal-phone-1-button.jpg`, `city-card-journal-phone-2-landed.jpg`, and the same for `desktop`

The Journal is about the project, so the player picks *where* to build it, not the game. (The first draft named one city for them, "Start it in Larkfield", which made a choice for the player out of maybe several.) An open achievement lists **Build it in**: a maple row for each town that is or is nearly a City ★, each with its level stamped and what it can do:

| The town | Its row says | Its mark |
|---|---|---|
| A City ★ that can start it now | Ready: start it for 400 🪙 | a yellow peg (ready); listed first |
| A City ★ short of coins | Needs 400 🪙 (you have 250) | a hole |
| A City ★ building another project | Building the Cathedral: one at a time | a hole, flatter row |
| A City, not yet ★ | 41 of 60 goods to City ★ | a hole, flatter row |
| Where it's under way | Stage 2 of 4: the iron hall | a blue peg; the only row, with Show me the site |

With no City ★ on the map, the list is the same towns nearest to it, so the line is never a dead end. A tap on a row closes the Journal on a phone, flies to that town and opens its card on **Projects** with this project picked: its **Start** ringed in blue (DESIGN.md: a ring marks the picked or the ready) if it can start, or the reason it can't. A town that isn't a City ★ yet opens on **Grow** instead. A tap never starts the project by itself: the player sees the price and the stages on the card, then taps Start.

## 4. Recommendation

**B, tabs**, with Next up deciding which tab the card opens on, and the Journal fix in §3.

**Picked: B** (the user, 2026-11-09), with the Journal's city list in §3.

- It answers the note directly: every feature is named at the top of the card (Grow, Build, Projects, Station), and the Journal's city rows land on the Start of the city picked.
- It follows the house style: the groove switch, the research ticket, one painted block per panel.
- It's one surface on both screens. The card's size and position stay as they are, so the e2e suites that open town cards need their selectors moved but not their flow. The town ledger's data (`game/town-ledger.ts`), places (`game/place-row.ts`) and grand row (`game/grand.ts`) stay as they are; only `ui/town-ledger.ts`, `ui/places-row.ts`, `ui/grand-row.ts` and the card's frame change.
- It stays cheap: a tab redraws only when its key changes, as the rows do now, and nothing runs per frame.

C's desktop board is a good later step if desktop players want everything at once. B's tabs would be its columns.
