# Woodrail wiki: design

2026-11-07. Status: approved by the developer, 2026-11-07.

## Why

Another solo dev found that Google search brought their best-kept players, by way of a wiki generated from their game's
data (about 1,000 pages for Google to index). Woodrail's research board, industries and goods are already data, so a
wiki can be made from them for free and never drift from the code. Its job is evergreen discovery: someone searches
"woodrail jam kitchen" or "toy train game sawmill planks", lands on a page that answers them, and follows a link to
play. Traffic is tracked with `?ref=wiki` on every link to itch.

## Goals

- One page for each: research row, industry, good, engine, wagon (and coach) kind, explainer.
- An index page for each of those six, and a home page.
- Every page: a real `<title>` and `<meta name="description">` made from the data, a canonical URL, and a
  "Play Woodrail free" link to `https://dwfennell.itch.io/woodrail?ref=wiki`.
- `sitemap.xml` listing every page.
- Pages link to each other wherever the data does: a research row to what it unlocks and what it needs; an industry to
  its goods and the row that unlocks it; a good to who makes it, who takes it, and the wagons that carry it.
- Plain static HTML and one CSS file. No JavaScript, no framework, nothing to load but the page, its CSS, and small
  inline SVG pictures.
- Styled in the game's wooden-toy look: felt green, beech and walnut, rounded wooden "cards", the game's branch colours.

## Non-goals (for v1)

- Rendered 3D pictures of models. Later, maybe, from `tools/shots`-style headless renders.
- Pages for track pieces, kits, scenery props, towns, goals, stickers. (Easy to add later from the same tables.)
- Search, comments, editing by players. It's generated, not a community wiki.
- Any change to the game's runtime. Nothing in `src/main.ts`'s import graph changes; the game links nowhere new.

## Anti-goals

- Text that's wrong about the game. Everything a page says comes from the game's own tables, or is written once in the
  generator as plain glue ("Made at", "Takes").
- Thin, near-empty pages that look like spam to Google. Every page has at least its numbers, its links and a sentence.
- Spoiling the ending. Planned rows ("coming soon", the ending) are left out; see Questions.

## Where the data comes from

| Pages | Source |
|---|---|
| Research rows | `BLUEPRINTS`, `BRANCHES`, `describeNeed`, `describePrice` (`src/game/blueprints.ts`); `costOf`, `STUDY_SECONDS` (`src/game/research.ts`); `unlocksOf` (`src/game/tech.ts`); `THING_RULES` labels (`src/game/things.ts`) |
| Industries | `RECIPES` (`src/economy/economy.ts`): takes, gives, cycle; `THING_RULES["piece:depot-*"]`: name, cost, coins, blueprint; `SITE_RULES` (`src/game/industries.ts`): what it must stand near; `INDUSTRY_GROUPS` (`src/ui/tray-catalogue.ts`): which ones, in the tray's order. Kit depots (river landing, boatyard, shipyard, ferry slip) from `THING_RULES["piece:kit-*"]` with a depot role |
| Goods | `CARGO`, `GOODS_ICON`, `CARRIES` (`src/economy/cargo.ts`); `wagonsFor` (`src/economy/wagons.ts`); makers and takers worked out from `RECIPES` |
| Engines | `ENGINES` (`src/game/engines.ts`): pulls, speed, quick, electric, rack; `LOOK_TECH`, `THING_RULES["look:*"]`; the tray's train items (`src/ui/tray-catalogue.ts`) for names and `gameDetail` |
| Wagons and coaches | The tray's train items; `THING_RULES["car:*"]` (cost, blueprint, gift); `CARRIES` and `carriesLine` |
| Explainers | `EXPLAINERS` (`src/ui/explainers.ts`): title, intro, sections with their inline SVG pictures, see-also |

The asset catalogue (`src/catalogue/assets/index.ts`) is a developer's sketchbook (its `notes` are ideas for how a model
could play), so v1 doesn't publish its text. It's the source for pictures later.

## How it's built

- `src/wiki/` (never imported by the game): `data.ts` gathers the tables above into one plain model (`WikiData`: rows,
  industries, goods, engines, wagons, explainers, each with a slug and its links); `pages.ts` turns that into
  `{ path, title, description, html }[]`; `style.css` is the one stylesheet.
- `scripts/wiki.mjs` (`npm run wiki [-- --out dist/wiki]`): loads `src/wiki/pages.ts` through Vite's SSR module loader
  with the project's own config (the game's modules have extensionless imports and a worker chunk, which plain Node
  can't load; the same way Vitest loads them), writes each page, `style.css` and `sitemap.xml` into the out dir. Default out: `dist/wiki`.
- Slugs from the game's ids (`/wiki/research/junctions/`, `/wiki/industries/sawmill/`, `/wiki/goods/planks/`), each
  page an `index.html` in its folder so URLs are clean on GitHub Pages.
- Pictures in v1: each good's own drawing from `src/icons/*.svg` (the game's icon font sources), inlined; the
  explainers' SVG diagrams; each research row's branch colour as its band. An industry shows its goods' icons.
- Text is escaped; ids that aren't safe in a URL fail the build.

### Pages

- **Home** `/wiki/`: what Woodrail is in two lines, the Play button, the six sections with counts, and the goods
  chains drawn as a small tree (raw goods → made goods) from `RECIPES`.
- **Research row**: branch, tier, blurb; what it costs to research (goods, coins, study time); what it needs (other
  rows, linked) and what it requires (a town, 200 loads moved…); what it unlocks (linked where there's a page: an
  industry, an engine, a wagon); which rows it leads to.
- **Industry**: what it makes and how fast (1 planks every 8 s from 1 log); what it takes; what it must stand near
  (trees, farm fields, hillside, water); its price (planks, coins) and the row that unlocks it; for each good in and
  out, where else it comes from and goes (linked), and the wagon that carries it.
- **Good**: icon, made at, taken by (industries and towns), carried in (wagons), researched with (rows whose cost uses
  it).
- **Engine**: pulls, top speed and quickness against the classic engine, electric or rack, its row and price.
- **Wagon / coach**: what it carries, its row and price, a gift or made at the workshop.
- **Explainer**: the sheet as it is in the game, sections and pictures.
- **Index pages**: a card per item; research grouped by branch, industries by chain, goods by raw/made.

### Hosting

The Pages workflow (`.github/workflows/deploy-pages.yml`) builds the game into `dist` and uploads it. One added step
after the build, `npm run wiki -- --out dist/wiki`, puts the wiki at `https://dwfennell.github.io/woodrail/wiki/`.
Canonical URLs and the sitemap use that base. (A project site can't serve a root `robots.txt`; the sitemap is
submitted in Search Console by hand, a step for the developer.) The game itself is unchanged; the itch build doesn't
include the wiki.

### Testing

- `src/wiki/wiki.test.ts`: every built research row, every industry in `INDUSTRY_GROUPS`, every good and every
  explainer has a page; every page has a non-empty title and description, unique paths; every internal link points at
  a page that exists; every page links to itch with `?ref=wiki`.
- Checked by eye in the browser pane at 390 px and 1440 px.

## Decided

1. **Planned rows** ("coming soon", the ending) are left out: no promises the game doesn't keep yet, no spoilers.
2. **Deploy**: the wiki step goes in the Pages workflow in the same PR; it goes live on the first push to main after
   the developer merges it.

## Left to the builder

Exact copy of the glue text, the card layout, the order on index pages, and the font (a rounded system font stack, no
web font to load, unless the game's own is cheap to reuse).
