# The card system

The cards and sheets about a thing on the map (a train, a car, a boat, a place, a piece or signal, a line) follow one
layout. Player feedback (2026-11-26, the boat card while routing, at about 1180 px wide): "spacing and formatting off
here ... in general I find these modals not super polished. Always changing size and often obscuring things."

Pictures, before and after, at 390×844 and 1440×900: `docs/agents/shots/cards/cards-{before,after}-<size>-<screen>.jpg`,
taken by `node tools/shots/cards/cards.mjs <out> [screens]` (`TAG=before|after`). Beside them,
`cards-<tag>-<size>.json` gives each card's box in each state and whether its subject is visible, under the card, or
off screen.

## Parts

Every card is one beech board in four parts. The CSS is in `src/style.css`, "The card system" (at its end).

- **Head.** ✕ in a 44 px corner at the top right; a tool (Wiki, the camera) at the top left; the name in Lilita 19 px
  on one line (`.card-title`); what it is or its state under it, in body type (`.card-sub`). A title that says a state
  after " · " ("Signal · red: a train is on the line ahead") is split by `setStatedTitle` (`src/ui/hud.ts`): the name
  stays the title, the state goes under it in body type, and the text is kept whole for anything that reads it.
- **Body.** Lines in body type (`.card-line`, Nunito 14/700, soft ink); rows as maple tiles. A line that changes as the
  game runs (`.card-line.live`: a boat's status, a signal's state) keeps two lines' room, so the card doesn't jump.
- **Actions.** The buttons that do something, side by side (`.card-actions`, 48 px), with at most one painted block.
  While a boat's route is planned, Done is the painted one and Stop is maple.
- **Foot.** A hint under a pencil rule (`.card-foot`).

## Size

- **Width is set per screen size, never by the words:**
  - phones upright: the screen less its 12 px gutters (as before);
  - big screens (≥641×521): `--card-w`, 460 px, for the engine, car, place, piece, boat, land, ruin and secret cards;
  - phones on their side: 400 px (or 56% of the width), docked at the right. A town's card keeps its own, wider.

  The boat card's width used to change from 360 to 514 to 432 px as its route changed. It is now 460 in every state.
- **Height:** a card about a place is at most half an upright phone's height, as the engine's is, so the place keeps
  room above it. Taller, it scrolls under its head as before.

## Never covering its subject

`keepCardSubjectInView` (`src/main.ts`) frames the open card's subject in the map's room, above or beside the card,
when the card opens. It does this once each time the subject changes, never per frame. The subjects:

- a place (industry, town, station, workshop);
- a signal;
- a boat, plus each stop added while its route is planned;
- a stop opened on a line's sheet.

It keeps the camera's distance or goes further out, never in. The engine card already did this for its train and the
way ahead (`showWithEngine`).

The room is measured by `viewRoom` (`src/ui/view-room.ts`). The goals open in a tall panel at the left of a big screen
now narrow the room from the left. Before, they were taken for a bar along the top, the room became a strip below the
card's top edge, and a framed subject landed beside the card at its foot.

## The boat card's route

One row a stop on the river's blue rail: its number, the landing, what the boat does there (a tap changes it, a fixed
width, so the rows line up), and while planning its own ✕ at the row's end. A pencilled row says where the next tap
goes. ✎ Route / Done and Go / Stop sit together in the actions row.

New stops are **Drop and pick up**, as a train line's are. They used to be Only drop after the first, so a route whose
first stop was taken off never loaded. At a Drop and pick up stop, a boat:

- doesn't drop goods back where it picked them up;
- doesn't pick up again what it has just dropped;
- picks up only goods another stop on its route takes.

Without these rules, two landings would hand the same logs back and forth. The rules are in `Fleet.serve`
(`src/game/boats.ts`), tested in `src/game/boats.test.ts`.

(The `before` JSON was measured by the script's first version. Its engine points were the model's local position, and
its line-sheet points were the Red line's stops whichever line was open. Read those rows from the pictures instead. The
`after` JSON uses the engine's world position and the open line's stops.)
