import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { type Pose } from "./math";
import { findOverlap } from "./overlap";
import { appendPiece } from "./snap";
import { findSplice, isPlainStraight, straightLength } from "./splice";
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

  it("says when no run of straights there is its length (too short a straight between curves, too long a one)", () => {
    const l = new Layout();
    const [s144] = line(l, ["straight-144"]);
    appendPiece(l, "curve-large", false, connectorRef(s144, 1));
    expect(findSplice(l, "depot-workshop", false, { x: 72, z: 0 }, 0, 40)).toEqual({ kind: "misfit", onto: s144 });
    const m = new Layout();
    const [s288] = line(m, ["straight-288"]);
    expect(findSplice(m, "depot-workshop", false, { x: 144, z: 0 }, 0, 40)).toEqual({ kind: "misfit", onto: s288 });
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
