import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { solveParentPose, transformPose, type Pose } from "./math";
import { getPieceDef } from "./pieces";
import { appendPiece, findSnap, findSnapAtPoint } from "./snap";
import { RAMP_LENGTH, RISER_HEIGHT } from "./constants";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });
const deg = (d: number) => (d * Math.PI) / 180;

function curveChain(l: Layout, count: number): number[] {
  const ids = [l.addPiece("curve-large", P(0, 0))];
  for (let i = 1; i < count; i++) ids.push(appendPiece(l, "curve-large", false, connectorRef(ids[i - 1], 1)));
  return ids;
}

describe("findSnap", () => {
  it("snaps a nearby dragged piece exactly onto a free peg", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-144", false, P(150, 8, deg(10)), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.pose.x).toBeCloseTo(144);
    expect(r.pose.z).toBeCloseTo(0);
    expect(r.pose.heading).toBeCloseTo(0);
    expect(r.connector).toBe(0);
  });

  it("returns none when nothing is within the capture radius", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(400, 0), 0).kind).toBe("none");
  });

  it("snaps a piece's peg onto a free socket (attaching behind)", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnap(l, "straight-108", false, P(-100, 5), 0);
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.connector).toBe(1);
    expect(r.pose.x).toBeCloseTo(-108);
  });

  it("ignores the dragged piece's own connectors", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(5, 0), 0, a).kind).toBe("none");
  });

  it("snaps onto a raised connector and reports the resulting base height", () => {
    const l = new Layout();
    l.addPiece("ramp", P(0, 0)); // peg at x=RAMP_LENGTH, a level up
    const r = findSnap(l, "straight-144", false, P(RAMP_LENGTH + 4, 0), RISER_HEIGHT - 14);
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.y).toBeCloseTo(RISER_HEIGHT);
  });

  it("does not snap to joined connectors", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    l.addPiece("straight-144", P(144, 0));
    const r = findSnap(l, "straight-54", false, P(146, 0), 0);
    // nearest free connectors are at x=0 (socket) and x=288 (peg), both out of range
    expect(r.kind).toBe("none");
  });
});

describe("loop closure", () => {
  it("eight large curves close a circle", () => {
    const l = new Layout();
    curveChain(l, 8);
    expect(l.jointCount).toBe(8);
  });

  it("an oval of 8 curves and 2 matching straights closes", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-216"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(10);
  });

  it("an oval with mismatched straights does not close", () => {
    const l = new Layout();
    const ids = [l.addPiece("curve-large", P(0, 0))];
    const seq = ["curve-large", "curve-large", "curve-large", "straight-216", "curve-large", "curve-large", "curve-large", "curve-large", "straight-144"] as const;
    for (const t of seq) ids.push(appendPiece(l, t, false, connectorRef(ids[ids.length - 1], 1)));
    expect(l.jointCount).toBe(9);
  });

  it("joint play lets a slightly-off final piece close the loop (0.5° ≈ 1.2 mm)", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(0.5) });
    expect(l.jointCount).toBe(8);
    const errors = [...l.joints()].map((j) => j.posError);
    expect(Math.max(...errors)).toBeGreaterThan(1);
  });

  it("a loop that is ~3.6 mm off (1.5°) still closes, like real wooden track", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(1.5) });
    expect(l.jointCount).toBe(8);
  });

  it("a loop that is 6° off does not close", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(6) });
    // Turned about its socket, the piece holds at neither end.
    expect(l.jointCount).toBe(6);
  });
});

describe("findSnap capture radius", () => {
  it("accepts a larger capture radius (zoomed-out dragging)", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    expect(findSnap(l, "straight-144", false, P(184, 0), 0).kind).toBe("none");
    expect(findSnap(l, "straight-144", false, P(184, 0), 0, -1, 60).kind).toBe("snapped");
  });
});

describe("auto-fit (ends that don't match turn or mirror the piece to fit)", () => {
  /** A long straight from the origin along +x: hole (socket) at x = 0, peg at x = 216. */
  function base() {
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    return layout;
  }
  const centre = (type: Parameters<typeof getPieceDef>[0], flipped: boolean, pose: Pose) => {
    const d = getPieceDef(type, flipped);
    let x = 0;
    let z = 0;
    for (const c of d.connectors) {
      const w = transformPose(pose, c.pose, { x: 0, z: 0, heading: 0 });
      x += w.x;
      z += w.z;
    }
    return { x: x / d.connectors.length, z: z / d.connectors.length };
  };

  it("a straight held turned round, its peg against a peg, seats as held (peg to peg: any ends join)", () => {
    const layout = base();
    // Held turned round: its peg end at x = 216 (against the other peg), its hole end out at x = 432.
    const s = findSnap(layout, "straight-216", false, { x: 432, z: 0, heading: Math.PI }, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind !== "snapped") return;
    expect(s.pose.x).toBeCloseTo(432, 6);
    expect(Math.cos(s.pose.heading)).toBeCloseTo(-1, 6);
    expect(getPieceDef("straight-216", false).connectors[s.connector].kind).toBe("peg");
  });

  it("a curve held peg-to-peg seats as held: never mirrored, it bends the way it was held", () => {
    const layout = base();
    const peg = getPieceDef("curve-large", false).connectors[1];
    const held = solveParentPose(peg.pose, { x: 216, z: 0, heading: Math.PI }, { x: 0, z: 0, heading: 0 });
    const was = centre("curve-large", false, held);
    const s = findSnap(layout, "curve-large", false, held, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind !== "snapped") return;
    expect(s.flipped).toBe(false);
    const c = centre("curve-large", false, s.pose);
    expect(Math.hypot(c.x - was.x, c.z - was.z)).toBeLessThan(1);
  });

  it("an exact fit nearby seats as held", () => {
    const layout = base();
    const s = findSnap(layout, "straight-216", false, { x: 217, z: 0, heading: 0 }, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(s.flipped).toBe(false);
  });

  it("a ramp seats as held: never turned or its ends swapped (an up ramp stays up, a down ramp comes down)", () => {
    const layout = base();
    // Its high end against the straight's peg on the ground: the heights don't meet, so no seat.
    const held = { x: 216 + RAMP_LENGTH, z: 0, heading: Math.PI };
    expect(findSnap(layout, "ramp", false, held, 0).kind).toBe("none");
    // Held a level lower, its top meets the peg's height: it seats there as held, coming down.
    const down = findSnap(layout, "ramp", false, held, -RISER_HEIGHT);
    expect(down.kind).toBe("snapped");
    if (down.kind === "snapped") {
      expect(down.flipped).toBe(false);
      expect(getPieceDef("ramp", false).connectors[down.connector].y).toBe(RISER_HEIGHT);
    }
    // Held the right way round, rising away from the straight.
    const s = findSnap(layout, "ramp", false, { x: 220, z: 0, heading: 0 }, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(s.y).toBe(0);
  });

  it("a buffer held at a hole end seats as held (hole to hole)", () => {
    const layout = base();
    const s = findSnap(layout, "buffer-turnback", false, { x: -2, z: 0, heading: Math.PI }, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(s.flipped).toBe(false);
  });

  it("keeps the held heading: a switch held the wrong way round seats by the end that keeps it as held, not swung 45°", () => {
    const layout = base(); // free peg at x = 216 heading +x
    // Held turned right round (heading π), its straight-through end (1) a little past the peg: it seats by that end, as
    // held, though its branch end (2) is about as near.
    for (const flipped of [false, true]) {
      const held = solveParentPose(getPieceDef("switch", flipped).connectors[1].pose, { x: 222, z: 6, heading: Math.PI }, { x: 0, z: 0, heading: 0 });
      const s = findSnap(layout, "switch", flipped, held, 0);
      expect(s.kind).toBe("snapped");
      if (s.kind !== "snapped") continue;
      expect(s.connector).toBe(1);
      expect(Math.abs(Math.sin(s.pose.heading - held.heading))).toBeLessThan(0.02);
    }
  });

  it("a piece held across a track end (a quarter turn off) still seats, turned the least it can be", () => {
    const layout = base(); // free peg at x = 216 heading +x
    const across = solveParentPose(getPieceDef("straight-144", false).connectors[0].pose, { x: 218, z: 0, heading: Math.PI / 2 }, { x: 0, z: 0, heading: 0 });
    const s = findSnap(layout, "straight-144", false, across, 0);
    expect(s.kind).toBe("snapped");
    if (s.kind === "snapped") expect(Math.abs(Math.cos(s.pose.heading - across.heading))).toBeLessThan(0.02);
  });

  it("a switch rotated and mirrored by the player joins in that orientation, by whichever end is dropped on the track", () => {
    for (const flipped of [false, true]) {
      const def = getPieceDef("switch", flipped);
      for (let k = 0; k < def.connectors.length; k++) {
        const layout = base(); // free peg at x = 216 heading +x, free hole at x = 0 heading −x
        // Held so its end k sits a few mm off the straight's peg, facing it.
        const held = solveParentPose(def.connectors[k].pose, { x: 219, z: 2, heading: Math.PI }, { x: 0, z: 0, heading: 0 });
        const s = findSnap(layout, "switch", flipped, held, 0);
        expect(s.kind, `${flipped} ${k}`).toBe("snapped");
        if (s.kind !== "snapped") continue;
        expect(s.flipped, `${flipped} ${k}`).toBe(flipped);
        expect(s.connector, `${flipped} ${k}`).toBe(k);
        expect(Math.abs(Math.sin(s.pose.heading - held.heading)), `${flipped} ${k}`).toBeLessThan(0.02);
        // Put down there, it joins.
        const id = layout.addPiece("switch", s.pose, s.y, s.flipped);
        expect(layout.joinedConnector(connectorRef(id, k)), `${flipped} ${k}`).not.toBe(-1);
      }
    }
  });
});

describe("findSnapAtPoint", () => {
  it("seats the piece on the free end under the pointer, even with the held piece's ends far from it", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // free peg at x=144, free socket at x=0
    // Held centred on the pointer, at the peg: its own ends are 108 mm either side.
    const r = findSnapAtPoint(l, "straight-216", false, P(144 - 108, 0), 0, { x: 150, z: 6 });
    expect(r.kind).toBe("snapped");
    if (r.kind !== "snapped") return;
    expect(r.connector).toBe(0);
    expect(r.pose.x).toBeCloseTo(144);
    expect(r.pose.heading).toBeCloseTo(0);
    // The plain end-based snap finds nothing from here.
    expect(findSnap(l, "straight-216", false, P(144 - 108, 0), 0).kind).toBe("none");
  });

  it("picks the end nearest the pointer when two are in reach", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    const r = findSnapAtPoint(l, "straight-144", false, P(-72, 0), 0, { x: 4, z: 0 }, -1, 60);
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.pose.x).toBeCloseTo(-144);
  });

  it("a curve seats keeping its hand: it bends the way it's held, mirrored or not", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0));
    for (const flipped of [false, true]) {
      const r = findSnapAtPoint(l, "curve-large", flipped, P(150, 0, deg(10)), 0, { x: 146, z: 0 });
      expect(r.kind).toBe("snapped");
      if (r.kind !== "snapped") continue;
      expect(r.flipped).toBe(flipped);
      const def = getPieceDef("curve-large", r.flipped);
      const far = transformPose(r.pose, def.connectors[1 - r.connector].pose, P(0, 0));
      expect(Math.sign(far.z)).toBe(flipped ? -1 : 1);
    }
  });

  it("returns none away from any free end, and ignores the piece's own", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    expect(findSnapAtPoint(l, "straight-144", false, P(300, 0), 0, { x: 300, z: 0 }).kind).toBe("none");
    expect(findSnapAtPoint(l, "straight-144", false, P(0, 0), 0, { x: 144, z: 0 }, a).kind).toBe("none");
  });

  it("pointed at an end, a curve held nearly backward still meets it (by the end that turns it least)", () => {
    const layout = new Layout();
    layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 }, 0);
    // A curve's two ends seat it 135° apart: held about 247° round, each would turn it past a quarter turn.
    for (const deg of [235, 247.5, 260]) {
      const s = findSnapAtPoint(layout, "curve-large", false, { x: 230, z: 0, heading: (deg * Math.PI) / 180 }, 0, { x: 216, z: 0 });
      expect(s.kind, `${deg}°`).toBe("snapped");
    }
  });
});
