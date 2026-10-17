# Draw track: lay a run of track by drawing it

Status: in progress (branch `claude/zen-lamport-ktlz8y`).

## Why

Laying track a piece at a time is slow and calm. That suits younger players, and it stays as it is: drag a piece
from the tray, watch it snap, hear the click. But to lay a long run of track you have to drag, or tap the waiting
ghost, once for every piece. Drawing is the quick way: put your finger on a track end, draw where the line should go,
and the pieces follow your finger. When you lift your finger they go down one after another, with a click-clack.

## How it works for the player

- **Draw** is a chip above the tray, shown while the Track tab is open, next to Turn and Flip. Tap it to turn drawing
  on; it stays lit. Tap it again, press Esc, or open another tab to turn it off.
- With drawing on, one finger (or a left drag) **draws** instead of moving the camera:
  - Starting on or near a free track end (within about 40 px) continues the line from that end.
  - Starting on empty ground starts a new line. Its first piece points the way you first move, rounded to an eighth
    of a turn, like pieces from the tray. Its first end lands on the quarter-square grid.
  - Two fingers still move the camera. Right drag and the wheel work as usual. The view pans at the screen edges
    while you draw, as it does while you hold a piece. The edge band is narrower than a held piece's (36 px on touch),
    so a phone keeps room to draw. A line started inside the band doesn't pan until the finger has left the band once.
  - On the ground, a tap that doesn't draw does what a tap there always does: it deselects, and a double tap focuses
    the view.
  - The first-time "Drag to move" hint for a selected piece isn't shown while drawing is on (a drag draws then); it
    waits for the next selection with drawing off.
- While you draw, **ghost pieces follow your finger**. A piece appears once your finger has gone far enough past it
  for it to be clear what you meant, so pieces don't flicker. Each new ghost makes a soft tick.
- **Going back over the line takes pieces off.** Move your finger back over any part of a ghost, heading back the way
  the line runs, and that ghost and every one after it lift away. Coming back exactly to a joint keeps the ghost before
  it. Once anything has come off, the line
  doesn't grow (while drawing, or when you lift) until your finger moves forward past the line's end again. So
  lifting partway through a retrace lays exactly the ghosts shown, and ghosts don't regrow and flicker on the way
  back. Otherwise, lifting grows the line only if the finger is ahead of its end and moving away, so the tip of a
  hairpin leaves no hook.
- **A ghost that can't go there shows red** (a hill, a river, other track in the way), and the line doesn't grow past
  it. Go back to before it and draw another way.
- **Closing up:** if the line's end comes close to a free track end that faces it, the last ghost meets it. It may
  shorten, or bend into a join, as the Auto piece does. The ghost turns green and the line is finished there.
- **Let go** and the green ghosts become track, from the start of the line outward, each with the usual settle and a
  click. One undo takes the whole line back up.
- **Game mode:** the line only uses pieces you have. Pieces you haven't learned, or have run out of, aren't offered. If
  you run out partway, the line stops there and a toast tells you which piece ran out.

## Turning a stroke into pieces

The stroke is the list of ground points under the finger, kept about 6 mm apart. The pieces it can become are:

- the long, medium, short and mini straights (216, 144, 108 and 54 mm);
- the curve, the wide curve and the tight curve, either way.

S-curves aren't used: two curves the opposite way make the same shift, and the scoring finds them. Switches, crossings
and ramps are left to the tray.

The line grows one piece at a time, from the end the line has reached so far:

1. **Candidates.** Each piece above, mirrored or not, is seated on the end. Any two ends join, but each of these
   pieces has a peg end and a hole end, so it's seated through the end of the other kind: through the same kind would
   be the same shape again. (A piece whose ends are both the same kind as the line's end would seat through either.)
2. **Look ahead two pieces.** For each candidate, and each candidate after it, measure how far the second end lies
   from the stroke, and how far its heading differs from the stroke's heading there. Measure at the first end too.
   Each piece adds a small cost, so a long straight beats two short ones on a straight run. The best pair wins, and
   only its first piece is laid. The next step looks again from there. This keeps a gentle curve from turning into a
   zig-zag, and lets the line drift back onto the stroke with an opposite pair of curves. To keep the choice calm
   (QA N3):
   - The stroke's heading is taken across 6 cm either side (less near its ends), and the first 5 mm and 0.1 rad
     (about 6°) off cost nothing, so a hand's wobble of up to ±10 mm doesn't break a straight run into short pieces.
   - Each piece's own turn is compared with how much the stroke turns along it. A straight run on into a wide arc,
     made up for by a tighter curve, can have both its ends on the stroke, but it doesn't turn the way the stroke does.
   - A piece bending another way from the one before costs a little (another radius or the other hand more, straight
     to curve or back less), so a steady arc stays one radius.
   - Each curve's radius is compared with how tightly the stroke bends over the stretch it covers. The stroke's
     curvature is measured over each half of that stretch (how far its smoothed heading turns along it), and the
     tighter half counts. So a curve that starts early, on the straight before a bend, is held to the bend's radius
     rather than to the average of the straight and the bend (a wider curve would fit that average with its ends on
     the stroke, and a tighter curve would then have to make up for it). The cost is the log of the ratio of the two radii:
     the first 0.1 (about 10%) is free, and one radius step off (the curve on a wide arc, or the wide curve on the
     curve's arc) costs about 4. A stroke bending tighter than the tight curve, such as a corner, asks for the tight curve,
     and one gentler than the wide curve asks for the wide curve. Where the stroke hardly bends at all (gentler than
     twice the wide curve's radius), no radius is asked, so curves can still steer the line back onto a straight run.
   - A mini straight next to a curve costs a little less (0.3 of its 0.9 extra). A lead-in that isn't a sum of the
     straights' lengths (300 mm, say) is then fitted with the straights: the line ends the lead-in a few cm short or
     long and the bend's curves keep their radius, instead of the bend starting early with a wider curve and a tighter
     one making up for it. The line ends within about 25 mm of the stroke's end.
   - While drawing, a second piece that runs on past the stroke drawn so far is scored only up to the stroke's end, and
     costs only the share of it used there. Gaining stroke counts only up to its end. (Beyond the end, nobody knows yet
     where the finger goes; scoring a straight carried on there used to favour straights on a curve.)
3. **Straight swipes (QA N1).** The default portrait camera is about 23° off the world grid, so a plain swipe on the
   screen is a straight line up to 22.5° off every eighth heading the track can run on. Scored as above, the line
   followed it with a snake of curves one way and the other. (A first attempt snapped near-straight strokes onto the
   line's heading within 25°; QA rejected it: the line drifted up to 586 mm off the finger, a wobble broke it, a
   deliberate slant was forced onto the grid, and the ghosts came late.) Now:
   - **Is the stroke straight?** From where the straight run began (or 6 cm behind where the line has got to on the
     stroke) to the stroke's end, at most 70 cm of it and at least 20 cm: no point more than 16 mm (or 3% of its length)
     off the chord between the mean points of its first and last quarters. The means average out a hand's wobble.
   - **A line already on the stroke and running its way** (within 0.06 rad of the chord and 15 mm of it) is left to the
     scoring above, which keeps it on and sees a bend coming soonest. So straight strokes along the grid, lead-ins and
     bends behave as before.
   - **Otherwise the line keeps to a band.** It runs on one of the two eighths either side of the stroke's way, anywhere
     within 50 mm of the stroke (each 5 mm further costs one unit). It steps onto the other eighth with a curve, or two
     curves turning opposite ways (an S-step), when going on straight would take it out of the band. So a 23° swipe is
     a staircase of straights along 0° and 45°, never more than about 60 mm from the finger, however long.
   - Plans of up to three pieces are scored: each piece's cost, plus 1 for a curve, 2 more for the tight curve (a kink
     in a straight line), 1.5 more for a curve straight after another (a run of them is the snake), 1 more for a mini;
     the band; less 1/120 per mm of stroke covered (up to its end). While drawing, a plan is taken as far as the
     stroke goes (stopping short would hide where going on leads), and where it leaves the line must let it run on
     straight another 100 mm in the band. Finishing, a plan may stop anywhere: short of the stroke's end costs
     (mm/20)², past it (mm/30)², and more than 25 mm to its side ((mm − 25)/25)². The best plan's first piece is laid.
     Each plan is worked out from the pieces' shapes against the chord (no stroke search), so a step is cheaper than
     the usual scoring.
   - The ghosts come at the usual look-ahead (250 mm behind the finger); the band doesn't wait for more stroke.
   - Pieces laid on the band may lie to the side of the finger, so going back over the stroke they were laid for takes
     them off too (retracing).
4. **Only grow behind the finger.** The next piece is chosen only once the stroke reaches at least one long piece past
   the line's end, so the look-ahead sees where the finger went. When the finger lifts, the line grows to the end of
   the stroke, choosing the best piece. Stopping is scored too (how far the line's end is from the stroke's end, and
   off its heading), so the line ends a little short of or past the finger, whichever fits, within about 2 cm.
5. **Stop** at the first piece that is blocked, or that the player has none of.
6. **Closing a loop on its own start.** When the line has come back round to its start, a piece that seats on the start
   is laid (and the line is closed) before any other is tried, so a stroke drawn a little past the start doesn't take
   the line on across its first piece. Finishing with the line's end within 40 mm of its start and running its way, it
   stops there (joint play may close it) rather than laying a piece across the start. A closed line never says "The
   line would cross itself".
7. **Too sharp.** The line is `stalled` (and DrawHand says "Too sharp: draw a wider bend") when the stroke has gone
   twice the look-ahead past the line's end with nothing laid, or when the stroke past the line's end, at least the
   look-ahead long, never gets further from the line's end than 0.4 of its length: a circle tighter than any curve
   (50 to 80 mm), which used to lay one curve silently. Out and straight back reaches 0.5, a quarter of the tight
   curve's circle about 0.9. A straight swipe never stalls (drift isn't a reason).

The stroke near the line's end is found with a windowed nearest-point search, so each step costs the same however
long the stroke is. A step tries 14 candidates × 14 pairs. That's fast enough for every pointer move on a phone
(target: under 2 ms a step; it is timed in the tests).

### Checks for each ghost

Each ghost is checked as a held piece is: the landscape, the track already there, and whether there's ground under it
(`Interaction.placement`). The line's own earlier pieces count as track already there, through a scratch `Layout` of
the line, so a line that crosses itself shows red. Risers aren't added: a drawn line stays at the height it started.
Ramps stay a tray piece.

## Code

- `src/track/draw-path.ts` (new, pure, tested): `DrawLine`, which holds the stroke and the chain, `extend(point)`,
  `finish()` and `trimTo(point)`. It works out candidate poses, scores them, and picks pieces. A `check(piece)` callback
  decides whether a piece may go down; the interaction passes it the landscape and track checks and the Game-mode
  stock.
- `src/game/interaction.ts`: a `drawing` mode with a `draw-track` drag mode. It handles the pointer: picking the start,
  the edge pan, and the ghosts (green or red, the same meshes a held piece uses). When the finger lifts it calls
  `Editor.placeRun`.
- `src/editor/editor.ts`: `placeRun(pieces)` puts down a list of pieces in one undo step. Joint play is taken up
  afterwards, as for any placement.
- `src/ui/hud.ts`: the Draw chip, and `HudHandlers.trayDraw()`.
- `src/main.ts`: Game mode's stock, through `interaction.drawStock`. Sound: a tick for each new ghost, and a click for
  each piece as it settles.

## Later

- Ramps in a drawn line, when the stroke goes up a hill.
- Holding on a free end, without the Draw chip on, to start drawing straight away.
- Drawing a branch from the middle of existing track (it would put in a switch).

## Favourites (built alongside)

Shelves are tidy, but the pieces you use most sit behind a tap. **Favourites** come first on the Track and Trains tabs,
ahead of the shelves (a thin divider between), ready to drag straight out.

- Every piece or train on an open shelf has a ☆ in its top-left corner (a 28 px target): tap it to add the item (★) or
  take it off. A ★ tapped on the favourites row takes it off there and then.
- Before the player picks any, the favourites are Auto, Medium, Curve, Switch and Buffer.
- They're kept per device in `localStorage` (`woodrail.favourites`, tray keys in order), not in the save: they're the
  player's way of working, not part of the layout. Without storage they last the session.
- Turn and Flip show above the tray while favourites are showing, as on an open shelf.
- Code: `favouriteItems` / `toggleFavourite` / `DEFAULT_FAVOURITES` in `src/ui/tray-catalogue.ts` (tested), the row and
  the ★ in `src/ui/hud.ts`, storage in `src/ui/prefs.ts`.
