import { describe, expect, it } from "vitest";
import { Layout, RISER_HEIGHT } from "../track";
import { gridWithPlots } from "./grid";
import type { Landscape } from "./generate";
import { bridgeLevels, checkSupport, looseHeight, riserStackAt } from "./support";

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
/** Raise every square whose centre lies in x0..x1 × z0..z1 to `h` blocks. */
function hill(land: Landscape, x0: number, x1: number, z0: number, z1: number, h = 1): void {
  const g = land.grid;
  for (let x = x0 + 1; x < x1; x += 8) for (let z = z0 + 1; z < z1; z += 8) {
    const i = g.cellAtWorld(x, z);
    if (i !== -1) g.height[i] = h;
  }
}
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });
// x = 0 is a square edge (the mat is 31 squares each side of the middle); z = 36 is a square's centre.
const Z = 36;

describe("checkSupport", () => {
  it("track on the felt is held", () => {
    expect(checkSupport(flat(), new Layout(), "straight-216", false, P(0, Z), 0, -1)).toEqual({ kind: "held", risers: [] });
  });

  it("a ramp from the felt up onto a hill edge is held at both ends", () => {
    const land = flat();
    hill(land, 216, 504, -144, 216);
    expect(checkSupport(land, new Layout(), "ramp", false, P(0, Z), 0, -1)).toEqual({ kind: "held", risers: [] });
  });

  it("track along the foot of a hill, ending on the hill's edge, rests on the felt", () => {
    const land = flat();
    hill(land, 216, 504, -144, 216);
    expect(checkSupport(land, new Layout(), "straight-216", false, P(0, Z), 0, -1)).toEqual({ kind: "held", risers: [] });
  });

  it("an end a whole riser above the felt gets a riser under it", () => {
    const land = flat();
    hill(land, 216, 504, -144, 216);
    // A straight from the felt (end at x 108) onto the hill, up at hill height.
    const s = checkSupport(land, new Layout(), "straight-216", false, P(108, Z), RISER_HEIGHT, -1);
    expect(s).toEqual({ kind: "held", risers: [{ pose: P(108, Z), y: 0 }] });
  });

  it("an end two risers up gets a stack of two", () => {
    const s = checkSupport(flat(), new Layout(), "straight-216", false, P(0, Z), 2 * RISER_HEIGHT, -1);
    expect(s.kind).toBe("held");
    if (s.kind !== "held") return;
    expect(s.risers.map((r) => [r.pose.x, r.y])).toEqual([
      [0, 0],
      [0, RISER_HEIGHT],
      [216, 0],
      [216, RISER_HEIGHT],
    ]);
  });

  it("a ramp's high end over the felt gets a riser", () => {
    const s = checkSupport(flat(), new Layout(), "ramp", false, P(0, Z), 0, -1);
    expect(s).toEqual({ kind: "held", risers: [{ pose: P(216, Z), y: 0 }] });
  });

  it("track joined to a bridge's end is held there (the bridge stands on its arches)", () => {
    const layout = new Layout();
    layout.addPiece("bridge", P(0, Z), RISER_HEIGHT);
    // Far end over the felt one riser up: needs a riser; the bridge end holds the near one.
    const s = checkSupport(flat(), layout, "straight-216", false, P(216, Z), RISER_HEIGHT, -1);
    expect(s).toEqual({ kind: "held", risers: [{ pose: P(432, Z), y: 0 }] });
  });

  it("track joined to a tall bridge's end is held at its deck height", () => {
    const layout = new Layout();
    layout.addPiece("bridge", P(0, Z), 3 * RISER_HEIGHT);
    // Near end on the bridge, three risers up; the far end over the felt gets a stack of three.
    const s = checkSupport(flat(), layout, "straight-216", false, P(216, Z), 3 * RISER_HEIGHT, -1);
    expect(s).toEqual({ kind: "held", risers: [0, 1, 2].map((k) => ({ pose: P(432, Z), y: k * RISER_HEIGHT })) });
  });

  it("a bridge stands on its own arches, one to four levels up, and needs no risers", () => {
    for (const type of ["bridge", "bridge-curve"] as const) {
      for (const levels of [1, 2, 3, 4]) {
        expect(checkSupport(flat(), new Layout(), type, false, P(0, Z), levels * RISER_HEIGHT, -1), `${type} ${levels}`).toEqual({ kind: "held", risers: [] });
        expect(bridgeLevels(flat(), type, false, P(0, Z), levels * RISER_HEIGHT)).toBe(levels);
      }
      for (const y of [0, RISER_HEIGHT / 2, 5 * RISER_HEIGHT]) {
        expect(checkSupport(flat(), new Layout(), type, false, P(0, Z), y, -1), `${type} at ${y}`).toEqual({ kind: "unsupported" });
      }
    }
  });

  it("a ramp up off the ground stands on arches; one on the ground is a plain ramp", () => {
    for (const levels of [1, 2, 3]) {
      expect(bridgeLevels(flat(), "ramp", false, P(0, Z), levels * RISER_HEIGHT)).toBe(levels);
      expect(checkSupport(flat(), new Layout(), "ramp", false, P(0, Z), levels * RISER_HEIGHT, -1)).toEqual({ kind: "held", risers: [] });
    }
    // Its high end would top the tallest a bridge goes.
    expect(bridgeLevels(flat(), "ramp", false, P(0, Z), 4 * RISER_HEIGHT)).toBe(0);
    expect(bridgeLevels(flat(), "ramp", false, P(0, Z), 0)).toBe(0);
    expect(checkSupport(flat(), new Layout(), "ramp", false, P(0, Z), 0, -1)).toEqual({ kind: "held", risers: [{ pose: P(216, Z), y: 0 }] });
  });

  it("track joined to the top of a ramp on arches rests there", () => {
    const layout = new Layout();
    layout.addPiece("ramp", P(0, Z), RISER_HEIGHT);
    // Near end on the ramp's high end, two levels up; the far end over the felt gets two risers.
    const s = checkSupport(flat(), layout, "straight-216", false, P(216, Z), 2 * RISER_HEIGHT, -1);
    expect(s).toEqual({ kind: "held", risers: [0, 1].map((k) => ({ pose: P(432, Z), y: k * RISER_HEIGHT })) });
  });

  it("a bridge's arches reach the lowest ground under it", () => {
    const land = flat();
    hill(land, 144, 504, -144, 216, 1);
    // The deck two levels up: its far end is over the hill, but the arches stand on the felt.
    expect(bridgeLevels(land, "bridge", false, P(0, Z), 2 * RISER_HEIGHT)).toBe(2);
    // Dropped loose, a bridge stands one level above the highest ground under it.
    expect(looseHeight(land, new Layout(), "bridge", false, P(0, Z), -1)).toBe(2 * RISER_HEIGHT);
    expect(looseHeight(flat(), new Layout(), "bridge", false, P(0, Z), -1)).toBe(RISER_HEIGHT);
  });

  it("an end resting on a riser is held", () => {
    const layout = new Layout();
    layout.addPiece("riser", P(5, Z + 4), 0);
    layout.addPiece("riser", P(216, Z), 0);
    expect(checkSupport(flat(), layout, "straight-216", false, P(0, Z), RISER_HEIGHT, -1)).toEqual({ kind: "held", risers: [] });
  });

  it("a riser added under an end already over a riser stacks on that riser", () => {
    const layout = new Layout();
    layout.addPiece("riser", P(5, Z + 4), 0);
    layout.addPiece("riser", P(216, Z), 0);
    layout.addPiece("riser", P(216, Z), RISER_HEIGHT);
    // Two risers up: the far end sits on its pair; the near end needs one more on its single riser.
    expect(checkSupport(flat(), layout, "straight-216", false, P(0, Z), 2 * RISER_HEIGHT, -1)).toEqual({
      kind: "held",
      risers: [{ pose: P(5, Z + 4), y: RISER_HEIGHT }],
    });
  });

  it("an end at an in-between height is unsupported", () => {
    expect(checkSupport(flat(), new Layout(), "straight-216", false, P(0, Z), 30, -1)).toEqual({ kind: "unsupported" });
  });

  it("no more than three risers are added under one end", () => {
    expect(checkSupport(flat(), new Layout(), "straight-216", false, P(0, Z), 4 * RISER_HEIGHT, -1)).toEqual({ kind: "unsupported" });
  });

  it("ignores the piece being moved", () => {
    const layout = new Layout();
    const id = layout.addPiece("riser", P(0, Z), 0);
    expect(riserStackAt(layout, 0, Z, id)).toBeNull();
    expect(riserStackAt(layout, 0, Z, -1)?.top).toBe(RISER_HEIGHT);
  });
});

describe("looseHeight", () => {
  it("a straight half over a hill edge sits on the hill (then needs a riser at its felt end)", () => {
    const land = flat();
    hill(land, 216, 504, -144, 216);
    expect(looseHeight(land, new Layout(), "straight-216", false, P(108, Z), -1)).toBe(RISER_HEIGHT);
  });

  it("a ramp reaching over a hill edge starts on the felt (so the hill blocks it, rather than it perching)", () => {
    const land = flat();
    hill(land, 216, 504, -144, 216);
    expect(looseHeight(land, new Layout(), "ramp", false, P(69, Z), -1)).toBe(0);
  });

  it("a riser dropped on a stack of two sits on top", () => {
    const layout = new Layout();
    layout.addPiece("riser", P(0, Z), 0);
    layout.addPiece("riser", P(0, Z), RISER_HEIGHT);
    expect(looseHeight(flat(), layout, "riser", false, P(3, Z), -1)).toBe(2 * RISER_HEIGHT);
    expect(riserStackAt(layout, 10, Z - 6, -1)).toEqual({ pose: P(0, Z), top: 2 * RISER_HEIGHT });
  });
});
