---
target_identity: "file:/workspace/woodrail/docs/superpowers/specs/situation-help"
timestamp: 2026-11-18T03-31-01Z
slug: docs-superpowers-specs-situation-help
---
### Critique (/impeccable critique)

Run as two isolated passes: a design review of the four pictures, and the detector with measurements on the row
rebuilt from the game's own CSS.

**Score: 25/40** on Nielsen's ten heuristics.

| Heuristic | Score | Heuristic | Score |
| --- | --- | --- | --- |
| Status | 3 | Recognition | 2 |
| Real world | 3 | Flexibility | 3 |
| Control | 2 | Minimal | 3 |
| Consistency | 2 | Recovery | 2 |
| Error prevention | 2 | Help | 3 |

**What the review found.**

- **It fits the game.** The pictures use the game's own parts: the lacquered yellow toast, a maple tile, printed
  chips. There is little new UI. Naming the line ("on the Red line") makes the tip feel specific to this railway, not
  generic advice.
- **Weakest part: Show me.** It drops the player 900 mm from bare track. The trains are out of view, the line has no
  colour, and the right tool isn't to hand.

**What the measurements found.**

- The detector reported 5 warnings, all false positives. They are the game's own look: the cut-wood inset edges read
  as "side tabs", the tile on a board as "nested cards", the toast's 1.2 display leading, and its clicked-into-place
  overshoot.
- Every button is 44 px tall.
- Contrast is 9.2 to 15:1.
- The legibility of the toast over the 3D scene was not measured.

**Changes taken into this spec** (they replace what the pictures show):

1. **Show me finishes the job.**
   - It frames the waiting trains and the spot together, with the ghost signal big enough to read as a signal.
   - It opens the Signals shelf with the Signal picked, so one drag places it.
   - A one-line caption says what to do: "Put a signal here".
2. **One painted button per sheet.** The goal keeps the blue Show me. The tip's button is a printed chip that says
   what it does: **Show where**.
3. **The folded chip keeps the goal.** A tip shows as a small 💡 badge beside the 🔔. The chip reads the tip only
   while its toast is up, then goes back to the goal.
4. **A stamp tells the two kinds apart.** A blueprint's tip keeps "New: …". A situation tip is stamped **Tip**.
5. **Learn more becomes a text link** under the line, not a chip. The row then has two buttons, Got it and Show
   where, with no gap where a button seems to be missing.
6. **Got it says what it does.** Its title is "Hide tips like this". ☰ **Tips** lists the hidden kinds, each with
   **Show again**, so a child's tap to clear the row isn't for ever.
7. **Plainer words** (the table above is updated):
   - Queuing: "Each train waits until the one ahead reaches the sawmill. A signal halfway lets the next one start
     sooner."
   - Piling: "No train collects its logs. Add the forest to a line."
   - The toast is one short line ("Red line trains are stuck in a queue") with a printed "Show where ›".

**Left open, for the user:**

- *If the game knows where the signal goes, should Show where offer "Place a signal here" (one tap, with undo)
  instead of teaching?* It would be quicker, but the player would learn less, and Signals are something the player
  makes at the workshop. A possible middle way: the ghost signal is tappable, and a tap places it.
- *Is a jam really a temporary goal?* It could appear in the goals list with a tick and a payoff when the trains
  flow again. This spec keeps it as a tip, with the "✓ They follow now" toast as the payoff.
