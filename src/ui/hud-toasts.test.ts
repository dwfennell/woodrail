import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hud } from "./hud";

/**
 * The toast queue's order, without a page: a Hud with only what its toasts touch (a stand-in toast element, no cards,
 * no help card), and fake timers.
 */
function toastHud(): { hud: Hud; shown: string[] } {
  const shown: string[] = [];
  const classes = new Set<string>();
  const toastEl = {
    textContent: "",
    style: {} as Record<string, string>,
    offsetWidth: 0,
    offsetHeight: 20,
    offsetTop: 0,
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
    classList: {
      add: (c: string) => {
        if (c === "show" && !classes.has("show")) shown.push(toastEl.textContent);
        classes.add(c);
      },
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
    },
  };
  const hud = Object.create(Hud.prototype) as Hud;
  Object.assign(hud, {
    toastEl,
    root: { querySelectorAll: () => [], classList: { contains: () => false } },
    help: { hidden: true },
    coach: { shown: false },
    // (No layout here: a tray of no size, which a toast needn't keep clear of.)
    tray: { getBoundingClientRect: () => ({ top: 0, height: 0 }) },
    toastQueue: [],
    toastTimer: 0,
    toastFlushTimer: 0,
    toastHeldUntil: 0,
    toastShownAt: 0,
    toastShowing: null,
    toastWaitsForCard: false,
    lastButtonAt: -Infinity,
    heldRefusal: null,
  });
  return { hud, shown };
}

describe("toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("come one at a time, in turn", () => {
    const { hud, shown } = toastHud();
    hud.toast("Joined");
    hud.toast("A hint");
    expect(shown).toEqual(["Joined"]);
    vi.advanceTimersByTime(10000);
    expect(shown).toEqual(["Joined", "A hint"]);
  });

  it("a card opened over a toast already read puts it away: it isn't shown again when the card closes (QA)", () => {
    const { hud, shown } = toastHud();
    const h = hud as unknown as { placeToast: (m: string) => boolean; refitToast: () => void; hideCards?: () => void };
    let room = true;
    const place = h.placeToast.bind(hud);
    h.placeToast = (m) => place(m) && room;
    hud.toast("2 goals done: Place your workshop · Bring planks to the workshop", true, 3200);
    vi.advanceTimersByTime(2000);
    // The workshop's card opens (and grows) over it: no room.
    room = false;
    h.refitToast();
    room = true;
    vi.advanceTimersByTime(20000);
    hud.toast("Next");
    vi.advanceTimersByTime(20000);
    expect(shown).toEqual(["2 goals done: Place your workshop · Bring planks to the workshop", "Next"]);
  });

  it("a toast a card covers as it comes on waits for the card, and shows then", () => {
    const { hud, shown } = toastHud();
    const h = hud as unknown as { placeToast: (m: string) => boolean; refitToast: () => void };
    let room = true;
    const place = h.placeToast.bind(hud);
    h.placeToast = (m) => place(m) && room;
    hud.toast("✓ Place your workshop", true, 3200);
    vi.advanceTimersByTime(200);
    room = false;
    h.refitToast();
    vi.advanceTimersByTime(20000);
    expect(shown).toEqual(["✓ Place your workshop"]);
    room = true;
    hud.toast("Next");
    vi.advanceTimersByTime(20000);
    expect(shown).toEqual(["✓ Place your workshop", "✓ Place your workshop", "Next"]);
  });

  it("a refusal goes first: never after the success toast of the same drop", () => {
    const { hud, shown } = toastHud();
    hud.toast("Made a switch: 3🪵 from the workshop");
    hud.refuse("That's a house — go around it");
    expect(shown.at(-1)).toBe("That's a house — go around it");
    vi.advanceTimersByTime(20000);
    // The success it pushed off (it had only just come on) shows again after it; the refusal never comes last.
    expect(shown).toEqual(["Made a switch: 3🪵 from the workshop", "That's a house — go around it", "Made a switch: 3🪵 from the workshop"]);
  });

  it("a refusal goes ahead of toasts waiting, and of a celebration that comes after it", () => {
    const { hud, shown } = toastHud();
    hud.toast("One");
    hud.toast("Two");
    vi.advanceTimersByTime(2000);
    hud.refuse("Can't go there");
    hud.toast("Goal done!", true);
    vi.advanceTimersByTime(30000);
    expect(shown.indexOf("Can't go there")).toBeLessThan(shown.indexOf("Two"));
    expect(shown.indexOf("Can't go there")).toBeLessThan(shown.indexOf("Goal done!"));
    expect(shown.filter((s) => s === "Can't go there")).toHaveLength(1);
  });

  it("knows a toast showing or waiting from one gone", () => {
    const { hud } = toastHud();
    hud.toast("✓ A", true, 3200);
    hud.toast("Joined");
    expect(hud.hasToast("✓ A")).toBe(true);
    expect(hud.hasToast("Joined")).toBe(true);
    expect(hud.hasToast("Other")).toBe(false);
    vi.advanceTimersByTime(30000);
    expect(hud.hasToast("✓ A")).toBe(false);
  });

  it("a held refusal that's then put down where it can't go stays up, shown once", () => {
    const { hud, shown } = toastHud();
    hud.setRefusal("That's a house — go around it");
    hud.setRefusal(null);
    hud.refuse("That's a house — go around it");
    hud.toast("A hint");
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual(["That's a house — go around it"]);
    vi.advanceTimersByTime(20000);
    expect(shown).toEqual(["That's a house — go around it", "A hint"]);
  });

  it("once the piece in hand can go, its held refusal gives way to the drop's toast at once", () => {
    const { hud, shown } = toastHud();
    hud.setRefusal("That's a house — go around it");
    hud.setRefusal(null);
    hud.toast("Joined");
    expect(shown).toEqual(["That's a house — go around it", "Joined"]);
  });
});
