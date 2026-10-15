/**
 * Drops the stray click a tap leaves behind when what it pressed on has changed by the time the finger lifts.
 *
 * Many of the game's controls act on pointerdown or pointerup: a tap on the map selects on pointerup and opens a card,
 * a tray shelf opens on pointerup. The browser then sends that tap's click 10–20 ms later, hit-tested at the same
 * point, and on touch it lands on whatever is now under the finger: the card's Delete, an engine's Go or Remove, the
 * tray's Back. So a click only counts if it lands on the element its press started on (or one inside or around it),
 * or on the same control drawn afresh (a panel that redraws itself while the finger is down: the workshop's + and −).
 * Every pointer click follows its own press, so there's no time limit: a slow tap (a child's) is the same tap, and a
 * slow device delays the click without changing what was pressed. Each finger's press is its own, so quick second taps
 * and two thumbs work; keyboard and scripted clicks pass.
 */

/** What the shield needs of a DOM element (a stand-in in the tests). */
export interface ShieldNode {
  readonly isConnected: boolean;
  contains(other: ShieldNode | null): boolean;
  closest(selector: string): ShieldNode | null;
  readonly className?: unknown;
  readonly textContent?: string | null;
  readonly dataset?: Record<string, string | undefined>;
}

/** A press: where it started, when, what control that was (its signature), and whether it was on the map. */
export interface Press {
  target: ShieldNode | null;
  at: number;
  signature: string | null;
  onMap: boolean;
}

const CONTROL = "button, [role=button], .tray-item";

/** A control's signature: the same control drawn afresh has the same one (its class, data-* and text). */
export function signatureOf(node: ShieldNode | null): string | null {
  const control = node?.closest(CONTROL) ?? null;
  if (!control) return null;
  const data = control.dataset ? Object.entries(control.dataset).sort(([a], [b]) => (a < b ? -1 : 1)) : [];
  return `${String(control.className ?? "")}|${JSON.stringify(data)}|${control.textContent ?? ""}`;
}

export function pressOf(target: ShieldNode | null, at: number, map: ShieldNode | null): Press {
  return { target, at, signature: signatureOf(target), onMap: !!map && !!target && map.contains(target) };
}

/** Should this click be dropped? `down` is its finger's press (or the last press, if the click doesn't say). */
export function strayClick(down: Press | null, click: { target: ShieldNode | null; pointer: boolean }): boolean {
  // Keyboard (Enter, Space) and scripted clicks have no pointer behind them.
  if (!click.pointer || !down || !down.target || !click.target) return false;
  // On what was pressed, or around or inside it.
  if (down.target.contains(click.target) || click.target.contains(down.target)) return false;
  // A press on the map is never a click on the HUD.
  if (down.onMap) return true;
  // The pressed control was drawn afresh while the finger was down: the same control, at the same place, counts.
  return !(!down.target.isConnected && down.signature !== null && down.signature === signatureOf(click.target));
}

/**
 * Install the shield on `win` (capture phase, so it runs before any control's own click handler). `map` is the game's
 * canvas: a press there never makes a click on the HUD.
 */
export function installClickShield(map: HTMLElement | null, win: Window = window): void {
  const presses = new Map<number, Press>();
  let last: Press | null = null;
  win.addEventListener(
    "pointerdown",
    (e) => {
      last = pressOf(e.target as unknown as ShieldNode, e.timeStamp, map as unknown as ShieldNode);
      presses.set(e.pointerId, last);
    },
    { capture: true },
  );
  win.addEventListener(
    "click",
    (e) => {
      // A click is a PointerEvent (with its finger's id) in current browsers; else the latest press.
      const id = (e as PointerEvent).pointerId;
      const down = (id !== undefined && id >= 0 ? presses.get(id) : undefined) ?? last;
      // From a pointer: its type says (a touch tap's click can have detail 0); "" for keyboard and scripted clicks.
      const type = (e as PointerEvent).pointerType;
      const pointer = type !== undefined ? type !== "" : e.detail > 0;
      if (!strayClick(down, { target: e.target as unknown as ShieldNode, pointer })) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}
