import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import type { Pose } from "./math";
import { appendPiece, findSnap } from "./snap";

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
    l.addPiece("ramp", P(0, 0)); // peg at x=216, y=64
    const r = findSnap(l, "straight-144", false, P(220, 0), 50);
    expect(r.kind).toBe("snapped");
    if (r.kind === "snapped") expect(r.y).toBeCloseTo(64);
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

  it("a loop that is ~3.6 mm off (1.5°) does not close", () => {
    const l = new Layout();
    const ids = curveChain(l, 7);
    const exact = l.getPiece(appendPiece(l, "curve-large", false, connectorRef(ids[6], 1)))!;
    l.removePiece(exact.id);
    l.addPiece("curve-large", { ...exact.pose, heading: exact.pose.heading + deg(1.5) });
    expect(l.jointCount).toBe(7);
  });
});
