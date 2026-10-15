import { describe, expect, it } from "vitest";
import { Presses, pressOf, strayClick, type ShieldNode } from "./click-shield";

/** A stand-in DOM element: `contains` and `closest` walk up its parents; it can be taken off the page. */
class Fake implements ShieldNode {
  isConnected = true;
  constructor(
    readonly parent: Fake | null,
    readonly tag = "div",
    readonly className = "",
    readonly textContent = "",
    readonly dataset: Record<string, string> = {},
  ) {}
  contains(other: ShieldNode | null): boolean {
    for (let x = other as Fake | null; x; x = x.parent) if (x === this) return true;
    return false;
  }
  closest(selector: string): ShieldNode | null {
    for (let x: Fake | null = this; x; x = x.parent) if (selector.split(", ").some((s) => s === x!.tag || (s.startsWith(".") && x!.className.split(" ").includes(s.slice(1))))) return x;
    return null;
  }
}

describe("click shield", () => {
  const body = new Fake(null, "body");
  const canvas = new Fake(body, "canvas");
  const card = new Fake(body);
  const del = new Fake(card, "button", "chip text danger", "Delete");
  const plus = new Fake(body, "button", "chip", "+", { recipe: "rail" });
  const label = new Fake(plus, "span");
  const tap = (target: Fake, _at: number) => ({ target, pointer: true });

  it("a tap on the map whose card opens under the finger: its click on the card is dropped (however slow)", () => {
    const down = pressOf(canvas, 1000, canvas);
    expect(strayClick(down, tap(del, 1015))).toBe(true);
    expect(strayClick(down, tap(del, 4000))).toBe(true);
  });

  it("a tap whose control is swapped for a different one (a shelf for Back): its click is dropped", () => {
    const shelf = new Fake(body, "button", "tray-item tray-group", "Straight");
    const down = pressOf(shelf, 1000, canvas);
    shelf.isConnected = false;
    const back = new Fake(body, "button", "tray-item tray-back", "‹ Back");
    expect(strayClick(down, tap(back, 1020))).toBe(true);
  });

  it("a tap on a control drawn afresh while the finger is down (the workshop's +): its click counts", () => {
    const old = new Fake(body, "button", "chip", "+", { recipe: "rail" });
    const down = pressOf(old, 1000, canvas);
    old.isConnected = false;
    const fresh = new Fake(body, "button", "chip", "+", { recipe: "rail" });
    expect(strayClick(down, tap(fresh, 1120))).toBe(false);
    // …but not one for another recipe drawn where it was.
    const other = new Fake(body, "button", "chip", "+", { recipe: "wheel" });
    expect(strayClick(down, tap(other, 1120))).toBe(true);
  });

  it("keeps a click on what was pressed, or around or inside it", () => {
    expect(strayClick(pressOf(plus, 1000, canvas), tap(plus, 1080))).toBe(false);
    expect(strayClick(pressOf(label, 1000, canvas), tap(plus, 1080))).toBe(false);
    expect(strayClick(pressOf(plus, 1000, canvas), tap(label, 1080))).toBe(false);
    expect(strayClick(pressOf(canvas, 1000, canvas), tap(canvas, 1080))).toBe(false);
  });

  it("keeps keyboard and scripted clicks (no pointer behind them)", () => {
    expect(strayClick(pressOf(canvas, 1000, canvas), { target: del, pointer: false })).toBe(false);
    expect(strayClick(null, tap(del, 1015))).toBe(false);
  });

  it("a slow tap is the same tap: no time limit either way", () => {
    const shelf = new Fake(body, "button", "tray-item tray-group", "Straight");
    const down = pressOf(shelf, 1000, canvas);
    shelf.isConnected = false;
    expect(strayClick(down, tap(new Fake(body, "button", "tray-item tray-back", "‹ Back"), 4000))).toBe(true);
    expect(strayClick(pressOf(plus, 1000, canvas), tap(plus, 4000))).toBe(false);
  });

  it("a quick second tap on a card button counts (it has its own press)", () => {
    expect(strayClick(pressOf(del, 1300, canvas), tap(del, 1350))).toBe(false);
  });

  it("keeps only a few presses: each goes once its click is judged, or its pointer is cancelled", () => {
    const presses = new Presses();
    // 100 taps, each a new touch pointer: press, then its click.
    for (let id = 1; id <= 100; id++) {
      presses.add(id, pressOf(plus, id, canvas));
      expect(presses.take(id)?.at).toBe(id);
    }
    expect(presses.size).toBe(0);
    // Taps whose clicks never come (drags, cancels): capped.
    for (let id = 200; id < 300; id++) presses.add(id, pressOf(plus, id, canvas));
    expect(presses.size).toBeLessThanOrEqual(8);
    presses.cancel(299);
    expect(presses.size).toBeLessThanOrEqual(7);
    // Two fingers down at once each keep their own press.
    const two = new Presses();
    two.add(1, pressOf(plus, 1, canvas));
    two.add(2, pressOf(del, 2, canvas));
    expect(two.take(1)?.target).toBe(plus);
    expect(two.take(2)?.target).toBe(del);
  });
});
