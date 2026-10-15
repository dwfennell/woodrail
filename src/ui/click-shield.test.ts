import { describe, expect, it } from "vitest";
import { strayClick } from "./click-shield";

/** A stand-in DOM node: `contains` walks up its parents. */
function node(parent: FakeNode | null = null): FakeNode {
  const n: FakeNode = {
    parent,
    contains: (o) => {
      for (let x = o as unknown as FakeNode | null; x; x = x.parent) if (x === n) return true;
      return false;
    },
  };
  return n;
}
interface FakeNode {
  parent: FakeNode | null;
  contains(other: Node | null): boolean;
}
const N = (n: FakeNode) => n as unknown as Node;

describe("click shield", () => {
  const body = node();
  const canvas = node(body);
  const card = node(body);
  const del = node(card);
  const button = node(body);
  const label = node(button);

  it("drops a tap's click that lands on something else than its press (a card opened under the finger)", () => {
    expect(strayClick({ target: N(canvas), at: 1000 }, { target: N(del), at: 1015, detail: 1 })).toBe(true);
  });

  it("drops it when the pressed element has gone (a shelf swapped for Back)", () => {
    const gone = node(null);
    expect(strayClick({ target: N(gone), at: 1000 }, { target: N(button), at: 1020, detail: 1 })).toBe(true);
  });

  it("keeps a click on what was pressed, or around or inside it", () => {
    expect(strayClick({ target: N(button), at: 1000 }, { target: N(button), at: 1080, detail: 1 })).toBe(false);
    expect(strayClick({ target: N(label), at: 1000 }, { target: N(button), at: 1080, detail: 1 })).toBe(false);
    expect(strayClick({ target: N(button), at: 1000 }, { target: N(label), at: 1080, detail: 1 })).toBe(false);
  });

  it("keeps keyboard and scripted clicks, and clicks long after the press", () => {
    expect(strayClick({ target: N(canvas), at: 1000 }, { target: N(del), at: 1015, detail: 0 })).toBe(false);
    expect(strayClick(null, { target: N(del), at: 1015, detail: 1 })).toBe(false);
    expect(strayClick({ target: N(canvas), at: 1000 }, { target: N(del), at: 1700, detail: 1 })).toBe(false);
  });

  it("a quick second tap on a card button counts (it has its own press)", () => {
    expect(strayClick({ target: N(del), at: 1300 }, { target: N(del), at: 1350, detail: 1 })).toBe(false);
  });
});
