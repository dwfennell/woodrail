/**
 * Keyboard focus shows a ring only while the player is moving focus with the keyboard (Tab or Shift+Tab).
 *
 * :focus-visible alone isn't enough here: in Chrome, a button focused by a click starts matching it as soon as any
 * key is pressed, and the game takes keys all the time (the camera, shortcuts). So a clicked tray tab grew the ring
 * on the next key. The root carries `kbd-nav` from a Tab press until the next pointer press; the CSS draws the ring
 * only under it (text boxes keep their own focus look either way).
 */
export const KBD_NAV = "kbd-nav";

type Target = Pick<Window, "addEventListener">;

export function installFocusRing(win: Target, root: { classList: { add(c: string): void; remove(c: string): void } }): void {
  win.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Tab") root.classList.add(KBD_NAV);
  }, { capture: true, passive: true });
  win.addEventListener("pointerdown", () => root.classList.remove(KBD_NAV), { capture: true, passive: true });
}
