import { describe, expect, it } from "vitest";
import { RISER_HEIGHT, TRAIN_CLEARANCE } from "./constants";
import { connectorRef, Layout } from "./layout";
import { findLowCrossing, findOverlap } from "./overlap";
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

describe("findOverlap with bridges' arches", () => {
  // A bridge along x from 0 to 216, its deck at `deck`, its arches reaching down to the felt.
  const withBridge = (deck: number) => {
    const l = new Layout();
    const id = l.addPiece("bridge", at(0, 0), deck);
    const arches = (mine = 0) => ({ mine, of: (p: { id: number }) => (p.id === id ? deck : 0) });
    return { l, id, arches };
  };
  // Arch openings are centred at 0.28 and 0.72 of the bridge (x = 60 and 156); a pier stands at x = 108.

  it("lets track pass under a bridge through an arch opening", () => {
    const { l, arches } = withBridge(RISER_HEIGHT);
    expect(findOverlap(l, "straight-216", false, at(60, -108, Math.PI / 2), 0, -1, arches())).toBe(-1);
  });

  it("refuses track run into a bridge's pier, from the felt or a level up", () => {
    const { l, id, arches } = withBridge(2 * RISER_HEIGHT);
    expect(findOverlap(l, "straight-216", false, at(108, -108, Math.PI / 2), 0, -1, arches())).toBe(id);
    // A level up (on a hill): still into the pier; but the tall arch openings of a two-level bridge let it through.
    expect(findOverlap(l, "straight-216", false, at(108, -108, Math.PI / 2), RISER_HEIGHT, -1, arches())).toBe(id);
    expect(findOverlap(l, "straight-216", false, at(60, -108, Math.PI / 2), RISER_HEIGHT, -1, arches())).toBe(-1);
  });

  it("refuses a bridge whose pier would stand on track", () => {
    const l = new Layout();
    const track = l.addPiece("straight-216", at(108, -108, Math.PI / 2));
    expect(findOverlap(l, "bridge", false, at(0, 0), RISER_HEIGHT, -1, { mine: RISER_HEIGHT, of: () => 0 })).toBe(track);
    // Without arches (as before), only the deck counts: a riser above is clear.
    expect(findOverlap(l, "bridge", false, at(0, 0), RISER_HEIGHT, -1)).toBe(-1);
  });

  it("still joins track end to end with a bridge", () => {
    const { l, id, arches } = withBridge(RISER_HEIGHT);
    expect(findOverlap(l, "straight-216", false, at(216, 0), RISER_HEIGHT, -1, arches())).toBe(-1);
    appendPiece(l, "straight-216", false, connectorRef(id, 1));
    expect(findOverlap(l, "straight-216", false, at(-216, 0), RISER_HEIGHT, -1, arches())).toBe(-1);
  });
});

describe("findLowCrossing (headroom for trains)", () => {
  it("refuses track crossing over track less than two levels above it, and allows it at two", () => {
    const l = new Layout();
    const below = l.addPiece("straight-216", at(0, 0));
    const across = at(108, -108, Math.PI / 2);
    expect(TRAIN_CLEARANCE).toBe(2 * RISER_HEIGHT);
    expect(findLowCrossing(l, "straight-216", false, across, RISER_HEIGHT, -1)).toBe(below);
    expect(findLowCrossing(l, "bridge", false, across, RISER_HEIGHT, -1)).toBe(below);
    expect(findLowCrossing(l, "bridge", false, across, 2 * RISER_HEIGHT, -1)).toBe(-1);
    // Below it is the same: track a level under a bridge has no room either.
    const high = new Layout();
    const deck = high.addPiece("bridge", at(0, 0), RISER_HEIGHT);
    expect(findLowCrossing(high, "straight-216", false, across, 0, -1)).toBe(deck);
  });

  it("leaves track that only joins (a ramp up to raised track), side by side, or at one height to the others", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", at(0, 0));
    const ramp = appendPiece(l, "ramp", false, connectorRef(a, 1));
    const top = appendPiece(l, "straight-216", false, connectorRef(ramp, 1));
    for (const id of [a, ramp, top]) {
      const p = l.getPiece(id)!;
      expect(findLowCrossing(l, p.type, p.flipped, p.pose, p.y, id)).toBe(-1);
    }
    expect(findLowCrossing(l, "straight-216", false, at(0, 60), RISER_HEIGHT, -1)).toBe(-1);
    expect(findLowCrossing(l, "riser", false, at(400, 0), 0, -1)).toBe(-1);
  });
});
