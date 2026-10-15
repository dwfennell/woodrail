/**
 * Drops the stray click a tap leaves behind when what it pressed on has changed by the time the finger lifts.
 *
 * Many of the game's controls act on pointerdown or pointerup: a tap on the map selects on pointerup and opens a card,
 * a tray shelf opens on pointerup. The browser then sends that tap's click 10–20 ms later, hit-tested at the same
 * point, and on touch it lands on whatever is now under the finger: the card's Delete, an engine's Go or Remove, the
 * tray's Back. So a click only counts if it lands on the element its press started on (or one inside or around it).
 * Each tap has its own press, so quick second taps still work; keyboard and scripted clicks (no pointer) aren't touched.
 */

/** A click this long (ms) after its press is no longer a tap's leftover. */
const WINDOW_MS = 600;

/** Should this click be dropped? `down` is what the last press started on, and when (ms). */
export function strayClick(down: { target: Node | null; at: number } | null, click: { target: Node | null; at: number; detail: number }): boolean {
  // Keyboard (Enter, Space) and scripted clicks have no pointer behind them.
  if (click.detail === 0 || !down || !down.target || !click.target) return false;
  if (click.at - down.at > WINDOW_MS) return false;
  return !(down.target.contains(click.target) || click.target.contains(down.target));
}

/** Install the shield on `win` (capture phase, so it runs before any control's own click handler). */
export function installClickShield(win: Window = window): void {
  let down: { target: Node | null; at: number } | null = null;
  win.addEventListener("pointerdown", (e) => (down = { target: e.target as Node | null, at: e.timeStamp }), { capture: true });
  win.addEventListener(
    "click",
    (e) => {
      if (!strayClick(down, { target: e.target as Node | null, at: e.timeStamp, detail: e.detail })) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
