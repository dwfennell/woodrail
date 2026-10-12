import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, Layout } from "./layout";
import { appendPiece } from "./snap";
import { LARGE_CURVE_RADIUS, RISER_HEIGHT } from "./constants";
import { angleDiff } from "./math";
import { createSample, pathLength, samplePath } from "./path";
import { getPieceDef, MAX_CONNECTORS, PIECE_TYPES } from "./pieces";

const variants = PIECE_TYPES.flatMap((type) => [false, true].map((flipped) => ({ type, flipped })));

describe("piece catalog invariants", () => {
  it.each(variants)("$type flipped=$flipped: paths start and end exactly at their connectors", ({ type, flipped }) => {
    const def = getPieceDef(type, flipped);
    expect(def.connectors.length).toBeLessThanOrEqual(MAX_CONNECTORS);
    for (const p of def.paths) {
      const from = def.connectors[p.from];
      const start = samplePath(p.geom, 0, createSample());
      expect(start.x).toBeCloseTo(from.pose.x, 9);
      expect(start.z).toBeCloseTo(from.pose.z, 9);
      expect(start.y).toBeCloseTo(from.y, 9);
      expect(angleDiff(start.heading, from.pose.heading + Math.PI)).toBeCloseTo(0, 9);
      if (p.to === null) continue;
      const to = def.connectors[p.to];
      const end = samplePath(p.geom, pathLength(p.geom), createSample());
      expect(end.x).toBeCloseTo(to.pose.x, 9);
      expect(end.z).toBeCloseTo(to.pose.z, 9);
      expect(end.y).toBeCloseTo(to.y, 9);
      expect(angleDiff(end.heading, to.pose.heading)).toBeCloseTo(0, 9);
    }
  });
});

describe("specific pieces", () => {
  it("straights have a socket at the origin and a peg at the far end", () => {
    const d = getPieceDef("straight-144", false);
    expect(d.connectors.map((c) => c.kind)).toEqual(["socket", "peg"]);
    expect(d.connectors[1].pose.x).toBe(144);
  });

  it("large curve turns 45° left; flipped turns 45° right", () => {
    const left = getPieceDef("curve-large", false);
    const right = getPieceDef("curve-large", true);
    expect(left.connectors[1].pose.z).toBeCloseTo(LARGE_CURVE_RADIUS * (1 - Math.SQRT1_2));
    expect(right.connectors[1].pose.z).toBeCloseTo(-LARGE_CURVE_RADIUS * (1 - Math.SQRT1_2));
  });

  it("switch has one trunk and two branches, and is a switch", () => {
    const d = getPieceDef("switch", false);
    expect(d.isSwitch).toBe(true);
    expect(d.paths.map((p) => p.from)).toEqual([0, 0]);
    expect(d.paths.map((p) => p.to)).toEqual([1, 2]);
  });

  it("ramp climbs one riser height", () => {
    const d = getPieceDef("ramp", false);
    expect(d.connectors[1].y - d.connectors[0].y).toBe(RISER_HEIGHT);
  });

  it("riser is a support with no track", () => {
    const d = getPieceDef("riser", false);
    expect(d.connectors).toHaveLength(0);
    expect(d.supportHeight).toBe(RISER_HEIGHT);
  });

  it("buffer path ends inside the piece", () => {
    expect(getPieceDef("buffer", false).paths[0].to).toBeNull();
  });

  it("adapters have matching connector kinds at both ends", () => {
    expect(getPieceDef("adapter-peg", false).connectors.map((c) => c.kind)).toEqual(["peg", "peg"]);
    expect(getPieceDef("adapter-socket", false).connectors.map((c) => c.kind)).toEqual(["socket", "socket"]);
  });

  it("returns the same cached object on repeat calls; non-flippable ignores flip", () => {
    expect(getPieceDef("switch", true)).toBe(getPieceDef("switch", true));
    expect(getPieceDef("straight-54", true)).toBe(getPieceDef("straight-54", false));
  });
});

describe("station piece", () => {
  it("is a 216 mm straight with socket and peg", () => {
    const d = getPieceDef("station", false);
    expect(d.connectors.map((c) => c.kind)).toEqual(["socket", "peg"]);
    expect(d.connectors[1].pose.x).toBe(216);
    expect(PIECE_TYPES).toContain("station");
  });
});

describe("large curves on the grid", () => {
  it("two large curves turn track centred on a row into track centred on a column, ending on a square edge", () => {
    const layout = new Layout();
    // x = 0 is a square edge and z = 36 a square centre (72 mm squares from the mat's middle).
    const a = layout.addPiece("curve-large", { x: 0, z: 36, heading: 0 });
    const b = appendPiece(layout, "curve-large", false, connectorRef(a, 1));
    const end = layout.worldConnector(connectorRef(b, 1), createWorldConnector());
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;
    expect(whole((end.x - 36) / 72)).toBe(true);
    expect(whole(end.z / 72)).toBe(true);
  });
});


describe("S-curves", () => {
  it("shift the line sideways and end on the heading they started on", () => {
    for (const [type, length, offset] of [["s-curve", 216, 72], ["s-curve-short", 144, 36]] as const) {
      for (const flipped of [false, true]) {
        const def = getPieceDef(type, flipped);
        const g = def.paths[0].geom;
        const s = createSample();
        samplePath(g, pathLength(g), s);
        expect(s.x, type).toBeCloseTo(length, 6);
        expect(s.z, type).toBeCloseTo(flipped ? -offset : offset, 6);
        expect(Math.cos(s.heading), type).toBeCloseTo(1, 9);
        // Halfway, it's turned the most and is halfway across.
        samplePath(g, pathLength(g) / 2, s);
        expect(s.z, type).toBeCloseTo((flipped ? -offset : offset) / 2, 6);
        expect(Math.abs(s.heading), type).toBeGreaterThan(0.3);
        const peg = def.connectors[1].pose;
        expect(peg.x).toBeCloseTo(length, 6);
        expect(peg.z).toBeCloseTo(flipped ? -offset : offset, 6);
      }
    }
  });

  it("the full S uses the large curve's radius", () => {
    const g = getPieceDef("s-curve", false).paths[0].geom;
    expect(g.kind === "s" && g.radius).toBeCloseTo(LARGE_CURVE_RADIUS, 6);
  });
});
