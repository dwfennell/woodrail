/**
 * Drag to reorder a route's stops on the engine card (the route UX audit's heuristic 7; F7's ← → stay, for a stop a
 * step at a time and for keys). Touch first: a finger held still on a stop's chip for `HOLD_MS` lifts it (a finger
 * that moves first scrolls the strip, as before); then it follows the finger along the strip, a bar shows where it
 * will go (struck red where it can't: the same place twice in a row), and letting go puts it there, through the
 * card's own edit (so Undo takes it back, and each train on the line keeps heading for the stop it was). A mouse
 * lifts a chip by dragging it a few pixels. Esc, or the touch taken over, puts it back.
 *
 * Per move: a translate on the chip and the bar's left, from chip positions measured once at the lift. No layout reads.
 */

/** How long a finger rests on a chip before it lifts (ms), and how far it may stray before that (px). */
export const HOLD_MS = 350;
export const SLOP_PX = 8;
/** Near either end of the strip (px), a lifted chip scrolls it, this fast (px a frame). */
const EDGE_PX = 36;
const EDGE_SPEED = 7;

/** Where a chip dropped at `x` goes: the slot (0…n, before stop `slot`) past every stop's middle left of `x`. */
export function dropSlot(middles: readonly number[], x: number): number {
  let slot = 0;
  for (const m of middles) if (m < x) slot++;
  return slot;
}

/** The index stop `from` ends at, put in `slot` (before the stop that was `slot`): `from` itself is no move. */
export function dropTarget(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** Would stop `from` moved to `to` put the same place twice in a row (that's one visit)? As the ← → arrows say. */
export function wouldRepeat(places: readonly number[], from: number, to: number): boolean {
  if (from === to) return false;
  const ids = [...places];
  ids.splice(to, 0, ids.splice(from, 1)[0]);
  return ids.some((id, i) => i > 0 && ids[i - 1] === id);
}

export interface StopDragHooks {
  /** The stops' places (depot ids), in order: to say where a drop can't go. */
  places: readonly number[];
  /** A chip lifted: the card holds still (no rebuild) till `end`. */
  start(): void;
  /** Dropped where it can go: stop `from` to index `to`. */
  move(from: number, to: number): void;
  /** Dropped where it can't (the same place twice in a row). */
  refused(): void;
  /** The drag is over (after `move` or `refused`, or put back). */
  end(): void;
}

/** Make the stop chips (`.route-chip[data-stop]`) in `strip` draggable. Listeners go with the strip. */
export function stopDrag(strip: HTMLElement, hooks: StopDragHooks): void {
  let press: { id: number; chip: HTMLElement; from: number; x0: number; y0: number; touch: boolean; timer: number } | null = null;
  let lifted: {
    middles: number[];
    slots: number[];
    mark: HTMLElement;
    scroll0: number;
    left: number;
    width: number;
    x: number;
    target: number;
    blocked: boolean;
    moved: boolean;
    raf: number;
  } | null = null;

  const lift = () => {
    if (!press || lifted) return;
    const chips = [...strip.querySelectorAll<HTMLElement>(".route-chip[data-stop]")];
    // Each stop's middle, and the slots between them (in the strip's scrolled content): before each stop's chip, and
    // after the last stop's group (its via chips).
    const middles = chips.map((c) => c.offsetLeft + c.offsetWidth / 2);
    const slots = chips.map((c) => c.offsetLeft - 2);
    const last = chips[chips.length - 1];
    let end = last;
    for (let e = last.nextElementSibling as HTMLElement | null; e && e.classList.contains("route-via"); e = e.nextElementSibling as HTMLElement | null) end = e;
    slots.push(end.offsetLeft + end.offsetWidth + 2);
    const mark = document.createElement("i");
    mark.className = "route-drop-mark";
    mark.hidden = true;
    mark.setAttribute("aria-hidden", "true");
    strip.append(mark);
    const r = strip.getBoundingClientRect();
    lifted = { middles, slots, mark, scroll0: strip.scrollLeft, left: r.left, width: r.width, x: press.x0, target: press.from, blocked: false, moved: false, raf: 0 };
    press.chip.classList.add("lifted");
    strip.classList.add("dragging");
    if (!press.touch) strip.setPointerCapture?.(press.id);
    navigator.vibrate?.(12);
    window.addEventListener("keydown", onKey, true);
    hooks.start();
  };

  const place = () => {
    if (!press || !lifted) return;
    const L = lifted;
    const x = L.x - L.left + strip.scrollLeft;
    press.chip.style.transform = `translateX(${L.x - press.x0 + strip.scrollLeft - L.scroll0}px)`;
    const slot = dropSlot(L.middles, x);
    L.target = dropTarget(press.from, slot);
    L.blocked = wouldRepeat(hooks.places, press.from, L.target);
    const none = L.target === press.from;
    L.mark.hidden = none;
    if (!none) L.mark.style.left = `${L.slots[slot] - 2}px`;
    L.mark.classList.toggle("blocked", L.blocked);
  };

  // Near an end, the strip scrolls under the chip (a frame at a time, only while it's held there).
  const edgeScroll = () => {
    if (!lifted) return;
    const L = lifted;
    const dx = L.x < L.left + EDGE_PX ? -EDGE_SPEED : L.x > L.left + L.width - EDGE_PX ? EDGE_SPEED : 0;
    const before = strip.scrollLeft;
    if (dx !== 0) strip.scrollLeft += dx;
    if (strip.scrollLeft !== before) {
      place();
      L.raf = requestAnimationFrame(edgeScroll);
    } else L.raf = 0;
  };

  const finish = (drop: boolean) => {
    const p = press;
    const L = lifted;
    if (p) window.clearTimeout(p.timer);
    press = null;
    lifted = null;
    if (!p || !L) return;
    cancelAnimationFrame(L.raf);
    window.removeEventListener("keydown", onKey, true);
    L.mark.remove();
    p.chip.classList.remove("lifted");
    p.chip.style.transform = "";
    strip.classList.remove("dragging");
    // (A lift let go where it was, unmoved, is a slow tap: its click picks the stop. Moved, the click is swallowed.)
    if (L.moved) {
      const swallow = (e: Event) => (e.stopPropagation(), e.preventDefault());
      strip.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => strip.removeEventListener("click", swallow, { capture: true }), 400);
    }
    if (drop && L.target !== p.from) {
      if (L.blocked) hooks.refused();
      else hooks.move(p.from, L.target);
    }
    hooks.end();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    finish(false);
  };

  strip.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || press) return;
    const chip = (e.target as Element).closest<HTMLElement>(".route-chip[data-stop]");
    if (!chip || hooks.places.length < 2) return;
    const touch = e.pointerType !== "mouse";
    press = { id: e.pointerId, chip, from: Number(chip.dataset.stop), x0: e.clientX, y0: e.clientY, touch, timer: 0 };
    if (touch) press.timer = window.setTimeout(lift, HOLD_MS);
  });
  strip.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!lifted) {
      if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) <= SLOP_PX) return;
      // A finger that moves before the hold scrolls the strip; a mouse dragged lifts the chip.
      if (press.touch) return finish(false);
      lift();
    }
    const L = lifted!;
    L.x = e.clientX;
    if (Math.abs(e.clientX - press.x0) > SLOP_PX) L.moved = true;
    place();
    if (!L.raf) edgeScroll();
  });
  strip.addEventListener("pointerup", (e) => {
    if (press && e.pointerId === press.id) finish(true);
  });
  strip.addEventListener("pointercancel", (e) => {
    if (press && e.pointerId === press.id) finish(false);
  });
  // While a chip is lifted, the finger drags it, not the strip (nor the page).
  strip.addEventListener(
    "touchmove",
    (e) => {
      if (lifted) e.preventDefault();
    },
    { passive: false },
  );
  // (A long press is a lift, not the phone's own menu.)
  strip.addEventListener("contextmenu", (e) => {
    if (press || lifted) e.preventDefault();
  });
}
