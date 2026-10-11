import { describe, expect, it } from "vitest";
import { RISER_HEIGHT } from "./constants";
import { connectorRef, Layout } from "./layout";
import { findOverlap } from "./overlap";
import { appendPiece } from "./snap";

const at = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("findOverlap", () => {
  it("refuses a piece dropped on top of another", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", at(0, 0));
    expect(findOverlap(l, "straight-216", false, at(10, 0), 0, -1)).toBe(a);
  });

  it("refuses two straights crossing without a crossing piece", () => {
    const l = new Layout();
    l.addPiece("straight-216", at(0, 0));
    expect(findOverlap(l, "straight-216", false, at(108, -108, Math.PI / 2), 0, -1)).not.toBe(-1);
  });

  it("allows a piece pushed into its neighbour by the joint's play, as when closing a run between two stations", () => {
    const l = new Layout();
    l.addPiece("straight-216", at(0, 0));
    // A run 9 mm too long, bent in by the 4° the joint allows.
    expect(findOverlap(l, "straight-144", false, at(207, 0, (4 * Math.PI) / 180), 0, -1)).toBe(-1);
  });

  it("allows pieces joined end to end, including curves", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", at(0, 0));
    const b = appendPiece(l, "curve-large", false, connectorRef(a, 1));
    const c = appendPiece(l, "straight-108", false, connectorRef(b, 1));
    for (const id of [a, b, c]) {
      const p = l.getPiece(id)!;
      expect(findOverlap(l, p.type, p.flipped, p.pose, p.y, id)).toBe(-1);
    }
  });

  it("allows parallel tracks side by side", () => {
    const l = new Layout();
    l.addPiece("straight-216", at(0, 0));
    expect(findOverlap(l, "straight-216", false, at(0, 40), 0, -1)).toBe(-1);
  });

  it("allows a piece a riser above another (a bridge over the line)", () => {
    const l = new Layout();
    l.addPiece("straight-216", at(0, 0));
    expect(findOverlap(l, "straight-216", false, at(108, -108, Math.PI / 2), RISER_HEIGHT, -1)).toBe(-1);
  });

  it("ignores the piece being moved", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", at(0, 0));
    expect(findOverlap(l, "straight-216", false, at(5, 0), 0, a)).toBe(-1);
  });

  it("refuses track through a riser at the same level", () => {
    const l = new Layout();
    const r = l.addPiece("riser", at(0, 0));
    expect(findOverlap(l, "straight-108", false, at(-54, 0), 0, -1)).toBe(r);
  });
});

import { buildStressLayout } from "./stress-layout";

describe("findOverlap on a big joined layout", () => {
  it("finds no overlaps between correctly joined pieces of every kind", () => {
    const l = buildStressLayout(4).layout;
    const hits: string[] = [];
    for (const id of l.pieceIds()) {
      const p = l.getPiece(id)!;
      const other = findOverlap(l, p.type, p.flipped, p.pose, p.y, id);
      if (other !== -1) hits.push(`${p.type}#${id} × ${l.getPiece(other)!.type}#${other}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("findOverlap with switches, crossings, ramps and bridges", () => {
  it("allows every arm joined to a switch and a crossing, and a ramp up to a bridge", () => {
    const l = new Layout();
    const sw = l.addPiece("switch", at(0, 0));
    for (let i = 1; i < 3; i++) appendPiece(l, i === 1 ? "straight-216" : "curve-large", false, connectorRef(sw, i));
    const x = l.addPiece("crossing", at(0, 600));
    for (let i = 0; i < 4; i++) appendPiece(l, "straight-108", false, connectorRef(x, i));
    const r = l.addPiece("ramp", at(0, -600));
    appendPiece(l, "bridge", false, connectorRef(r, 1));
    const hits: string[] = [];
    for (const id of l.pieceIds()) {
      const p = l.getPiece(id)!;
      const other = findOverlap(l, p.type, p.flipped, p.pose, p.y, id);
      if (other !== -1) hits.push(`${p.type}#${id} × ${l.getPiece(other)!.type}#${other}`);
    }
    expect(hits).toEqual([]);
  });
});
