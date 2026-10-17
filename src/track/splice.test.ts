import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { type Pose } from "./math";
import { findOverlap } from "./overlap";
import { appendPiece } from "./snap";
import { findSplice, gapFill, isPlainStraight, straightLength, straightsFor } from "./splice";
import type { PieceTypeId } from "./pieces";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });

/** Straights laid end to end from the origin along +x, each joined to the last. */
function line(l: Layout, types: PieceTypeId[]): number[] {
  const ids = [l.addPiece(types[0], P(0, 0))];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(l, types[i], false, connectorRef(ids[i - 1], 1)));
  return ids;
}

describe("straightLength / isPlainStraight", () => {
  it("knows straight-shaped pieces (depots and stations too), and only plain straights are dropped onto", () => {
    expect(straightLength("straight-216", false)).toBe(216);
    expect(straightLength("depot-workshop", false)).toBe(216);
    expect(straightLength("station", false)).toBe(216);
    expect(straightLength("curve-large", false)).toBe(0);
    expect(straightLength("ramp", false)).toBe(0);
    expect(isPlainStraight("straight-108")).toBe(true);
    expect(isPlainStraight("signal")).toBe(false);
    expect(isPlainStraight("bridge")).toBe(false);
    expect(isPlainStraight("depot-workshop")).toBe(false);
  });
});

describe("findSplice", () => {
  it("a depot held over a long straight takes its place 1:1, lying along the line", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // Held a little off the middle straight's centre, turned a little from the line.
    const s = findSplice(l, "depot-workshop", false, { x: 330, z: 12 }, 0.3, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(216);
    expect(s.pose.z).toBeCloseTo(0);
    expect(s.pose.heading).toBeCloseTo(0);
    expect(s.y).toBe(0);
    // It doesn't overlap the straights either side once the one it covers is left out.
    expect(findOverlap(l, "depot-workshop", false, s.pose, s.y, new Set(s.covers))).toBe(-1);
    expect(findOverlap(l, "depot-workshop", false, s.pose, s.y, -1)).toBe(mid);
  });

  it("held the other way round, it lies along the line the other way (its building on the other side)", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    const s = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, Math.PI - 0.2, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(432);
    expect(s.pose.z).toBeCloseTo(0);
    expect(Math.abs(s.pose.heading)).toBeCloseTo(Math.PI);
  });

  it("held square across the line, turning it right round (Flip) always swaps which way it lies", () => {
    const l = new Layout();
    line(l, ["straight-216", "straight-216", "straight-216"]);
    for (const held of [Math.PI / 2, -Math.PI / 2, 0.3, 2]) {
      const s = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, held, 40);
      const t = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, held + Math.PI, 40);
      if (s.kind !== "splice" || t.kind !== "splice") throw new Error("no splice");
      expect(Math.abs(Math.abs(s.pose.heading - t.pose.heading) - Math.PI)).toBeLessThan(1e-9);
    }
  });

  it("looks for the held centre at each straight's own height (the finger points elsewhere higher up)", () => {
    const l = new Layout();
    const low = l.addPiece("straight-216", P(0, 0));
    const high = l.addPiece("straight-216", P(0, 300), 48);
    // Seen from the side: at the ground the finger is over the low straight, 48 up it's over the high one.
    const ground = findSplice(l, "depot-workshop", false, (y) => (y === 0 ? { x: 100, z: 5 } : { x: 100, z: 200 }), 0, 40);
    expect(ground.kind === "splice" && ground.covers).toEqual([low]);
    const up = findSplice(l, "depot-workshop", false, (y) => (y === 0 ? { x: 100, z: 150 } : { x: 100, z: 296 }), 0, 40);
    expect(up.kind === "splice" && up.covers).toEqual([high]);
    expect(up.kind === "splice" && up.y).toBe(48);
  });

  it("over two short straights, it takes the place of both (a run its length)", () => {
    const l = new Layout();
    const ids = line(l, ["straight-216", "straight-108", "straight-108", "straight-216"]);
    const s = findSplice(l, "depot-workshop", false, { x: 290, z: 0 }, 0, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([ids[1], ids[2]]);
    expect(s.pose.x).toBeCloseTo(216);
  });

  it("of the runs its length, it takes the one centred nearest where it's held", () => {
    const l = new Layout();
    const ids = line(l, ["straight-108", "straight-108", "straight-108", "straight-108"]);
    // Over the second straight, nearer its far end: the second and third (centred at 216), not the first two (108).
    const s = findSplice(l, "depot-workshop", false, { x: 200, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.covers).toEqual([ids[1], ids[2]]);
    // Nearer its near end: the first two.
    const t = findSplice(l, "depot-workshop", false, { x: 120, z: 0 }, 0, 40);
    expect(t.kind === "splice" && t.covers).toEqual([ids[0], ids[1]]);
  });

  it("says when no run of straights there is its length (too short a straight between curves)", () => {
    const l = new Layout();
    const [s144] = line(l, ["straight-144"]);
    appendPiece(l, "curve-large", false, connectorRef(s144, 1));
    expect(findSplice(l, "depot-workshop", false, { x: 72, z: 0 }, 0, 40)).toEqual({ kind: "misfit", onto: s144 });
  });

  it("on too long a straight, takes its length of it and a shorter straight fills the rest (a 216 depot on a 288: a 72)", () => {
    const m = new Layout();
    const [s288] = line(m, ["straight-288"]);
    const s = findSplice(m, "depot-workshop", false, { x: 100, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.covers).toEqual([s288]);
    expect(s.kind === "splice" && s.rest?.map((r) => r.type)).toEqual(["straight-72"]);
  });

  it("won't take up a straight a train stands on, nor reach past one", () => {
    const l = new Layout();
    const ids = line(l, ["straight-108", "straight-108", "straight-108"]);
    expect(findSplice(l, "depot-workshop", false, { x: 54, z: 0 }, 0, 40, (id) => id !== ids[0])).toEqual({ kind: "busy", onto: ids[0] });
    // Over the middle with the first busy: only the run ahead (middle and last) will do.
    const s = findSplice(l, "depot-workshop", false, { x: 150, z: 0 }, 0, 40, (id) => id !== ids[0]);
    expect(s.kind === "splice" && s.covers).toEqual([ids[1], ids[2]]);
  });

  it("finds nothing away from straights, or for a piece that isn't straight", () => {
    const l = new Layout();
    line(l, ["straight-216"]);
    expect(findSplice(l, "depot-workshop", false, { x: 108, z: 90 }, 0, 40).kind).toBe("none");
    expect(findSplice(l, "curve-large", false, { x: 108, z: 0 }, 0, 40).kind).toBe("none");
    const c = new Layout();
    c.addPiece("curve-large", P(0, 0));
    expect(findSplice(c, "depot-workshop", false, { x: 100, z: 10 }, 0, 40).kind).toBe("none");
  });

  it("held across a straight with its middle 100 mm off the line, its track crosses it: it takes that straight", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // Square across, and slanting either way (steep enough that its track, 216 mm long, reaches the line).
    for (const heading of [Math.PI / 2, -Math.PI / 2, 0.42 * Math.PI, 0.6 * Math.PI, -0.4 * Math.PI]) {
      // Its middle 100 mm to the side of the line, on whichever side its track crosses.
      const side = Math.sin(heading) > 0 ? 100 : -100;
      const s = findSplice(l, "depot-workshop", false, { x: 324 + side / Math.tan(heading), z: side }, heading, 40);
      expect(s.kind === "splice" && s.covers).toEqual([mid]);
      if (s.kind !== "splice") continue;
      expect(s.pose.z).toBeCloseTo(0);
      expect(Math.min(Math.abs(s.pose.x - 216), Math.abs(s.pose.x - 432))).toBeCloseTo(0);
    }
    // A train on it says so, rather than nothing.
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 100 }, Math.PI / 2, 40, (id) => id !== mid)).toEqual({ kind: "busy", onto: mid });
    // Its track ending short of the line (slanting too little to reach it): nothing.
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 100 }, Math.PI / 6, 40).kind).toBe("none");
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 160 }, Math.PI / 2, 40).kind).toBe("none");
  });

  it("of straights under its track, it takes the one met nearest its middle", () => {
    const l = new Layout();
    const near = l.addPiece("straight-216", P(0, 0));
    const far = l.addPiece("straight-216", P(0, 90));
    // Held square across both lines, its middle 20 mm from the first and 70 from the second.
    const s = findSplice(l, "depot-workshop", false, { x: 108, z: 20 }, Math.PI / 2, 40);
    expect(s.kind === "splice" && s.covers).toEqual([near]);
    const t = findSplice(l, "depot-workshop", false, { x: 108, z: 70 }, Math.PI / 2, 40);
    expect(t.kind === "splice" && t.covers).toEqual([far]);
  });

  it("follows the line round any turn (a line along z)", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", P(0, 0, Math.PI / 2));
    const b = appendPiece(l, "straight-216", false, connectorRef(a, 1));
    const s = findSplice(l, "depot-workshop", false, { x: 3, z: 330 }, Math.PI / 2, 40);
    expect(s.kind === "splice" && s.covers).toEqual([b]);
    if (s.kind !== "splice") return;
    expect(s.pose.x).toBeCloseTo(0);
    expect(s.pose.z).toBeCloseTo(216);
    expect(s.pose.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe("gapFill (the gap a depot leaves in a line)", () => {
  /** Straight, depot, straight along +x; then the depot taken out (lifted, as when it's picked up). */
  function inline() {
    const l = new Layout();
    const [a, d, b] = line(l, ["straight-216", "depot-workshop", "straight-216"]);
    const ends = [l.joinedConnector(connectorRef(d, 0)), l.joinedConnector(connectorRef(d, 1))] as const;
    l.liftPiece(d);
    return { l, a, d, b, ends };
  }

  it("fills it 1:1 with a long straight, from one end to the other, aligned to the gap", () => {
    const { l, a, b, ends } = inline();
    expect(ends).toEqual([connectorRef(a, 1), connectorRef(b, 0)]);
    const fill = gapFill(l, ends[0], ends[1]);
    expect(fill).toHaveLength(1);
    expect(fill![0].type).toBe("straight-216");
    expect(fill![0].pose.x).toBeCloseTo(216);
    expect(fill![0].pose.z).toBeCloseTo(0);
    expect(fill![0].pose.heading).toBeCloseTo(0);
    expect(fill![0].y).toBe(0);
    // Put down, it joins both ends.
    const id = l.addPiece(fill![0].type, fill![0].pose, fill![0].y);
    expect(l.joinedConnector(connectorRef(id, 0))).toBe(connectorRef(a, 1));
    expect(l.joinedConnector(connectorRef(id, 1))).toBe(connectorRef(b, 0));
  });

  it("on a line running any way round, the fill lies along it", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", P(0, 0, 2.2));
    const d = appendPiece(l, "depot-workshop", false, connectorRef(a, 1));
    const b = appendPiece(l, "straight-216", false, connectorRef(d, 1));
    const ends = [l.joinedConnector(connectorRef(d, 0)), l.joinedConnector(connectorRef(d, 1))];
    l.liftPiece(d);
    const fill = gapFill(l, ends[0], ends[1])!;
    const id = l.addPiece(fill[0].type, fill[0].pose, fill[0].y);
    expect(l.joinedConnector(connectorRef(id, 0))).toBe(connectorRef(a, 1));
    expect(l.joinedConnector(connectorRef(id, 1))).toBe(connectorRef(b, 0));
  });

  it("not once the gap is closed again, or an end has gone, or the ends don't face along one line", () => {
    const { l, d, b, ends } = inline();
    // Put back where it was: nothing to fill.
    l.dropPiece(d, P(216, 0), 0);
    expect(gapFill(l, ends[0], ends[1])).toBeNull();
    l.liftPiece(d);
    expect(gapFill(l, ends[0], ends[1])).not.toBeNull();
    // The far straight taken away, or one turned off the line.
    l.removePiece(b);
    expect(gapFill(l, ends[0], ends[1])).toBeNull();
    const c = l.addPiece("straight-216", P(432, 0, 0.3));
    expect(gapFill(l, ends[0], connectorRef(c, 0))).toBeNull();
  });

  it("uses straights the splice takes: one its length, else two, as even as can be; none for lengths they can't make", () => {
    expect(straightsFor(216)).toEqual(["straight-216"]);
    expect(straightsFor(216.3)).toEqual(["straight-216"]);
    expect(straightsFor(288)).toEqual(["straight-288"]);
    expect(straightsFor(432)).toEqual(["straight-216", "straight-216"]);
    expect(straightsFor(20)).toBeNull();
    expect(straightsFor(1000)).toBeNull();
    expect(straightsFor(360)).toEqual(["straight-180", "straight-180"]);
  });
});

describe("findSplice: a short kit on a longer straight", () => {
  it("takes the half of a 216 nearer where it's held, and a 108 straight fills the other half", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // The middle straight runs 216..432. Held over its first half: the kit there, the rest from 324.
    const s = findSplice(l, "kit-water-tower", false, { x: 260, z: 6 }, 0, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(216, 3);
    expect(s.rest?.map((r) => r.type)).toEqual(["straight-108"]);
    expect(s.rest![0].pose.x).toBeCloseTo(324, 3);
    // Held over its second half: the rest at the start, the kit from 324.
    const t = findSplice(l, "kit-water-tower", false, { x: 400, z: 6 }, 0, 40);
    expect(t.kind === "splice" && t.rest![0].pose.x).toBeCloseTo(216, 3);
    expect(t.kind === "splice" && t.pose.x).toBeCloseTo(324, 3);
    // Neither overlaps the other: kit and rest end to end over the straight.
    if (t.kind === "splice") expect(findOverlap(l, "kit-water-tower", false, t.pose, 0, mid)).toBe(-1);
  });

  it("a kit as long as a run still takes the run (no rest)", () => {
    const l = new Layout();
    line(l, ["straight-108", "straight-108", "straight-108"]);
    const s = findSplice(l, "kit-water-tower", false, { x: 160, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.rest).toBeUndefined();
  });
});
