import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { CoverIndex, engineOf, isOn, trainOn, underByEnds } from "./occupancy";
import { walkTrack } from "./track-walk";
import { ADV_BUFFER, ADV_OK, ADV_OPEN_END } from "./cursor";
import { Sim } from "./sim";

/** 216, 36, 216, 36 in a line, a buffer on the end. */
function line() {
  const layout = new Layout();
  const sim = new Sim(layout);
  const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const b = appendPiece(layout, "straight-36", false, connectorRef(a, 1));
  const c = appendPiece(layout, "straight-216", false, connectorRef(b, 1));
  const d = appendPiece(layout, "straight-36", false, connectorRef(c, 1));
  const end = appendPiece(layout, "buffer", false, connectorRef(d, 1));
  return { layout, sim, a, b, c, d, end };
}

describe("track walk: the one loop along the track ahead", () => {
  it("visits each piece with the stretch walked on it, and stops when the distance is used", () => {
    const { layout, a, b, c } = line();
    const seen: [number, number, number][] = [];
    const end = walkTrack(layout, { pieceId: a, pathIndex: 0, reversed: false, s: 200 }, 100, (p, _path, _rev, from, to) => void seen.push([p, from, to]));
    expect(end).toBe(ADV_OK);
    expect(seen).toEqual([
      [a, 0, 16],
      [b, 16, 52],
      [c, 52, 100],
    ]);
  });

  it("ends at a buffer, or at an open end", () => {
    const { layout, c } = line();
    expect(walkTrack(layout, { pieceId: c, pathIndex: 0, reversed: false, s: 0 }, 10_000, () => {})).toBe(ADV_BUFFER);
    const open = new Layout();
    const x = open.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    expect(walkTrack(open, { pieceId: x, pathIndex: 0, reversed: false, s: 0 }, 10_000, () => {})).toBe(ADV_OPEN_END);
  });

  it("stops where the visitor says", () => {
    const { layout, a, b } = line();
    const seen: number[] = [];
    walkTrack(layout, { pieceId: a, pathIndex: 0, reversed: false, s: 0 }, 10_000, (p) => (seen.push(p), p !== b));
    expect(seen).toEqual([a, b]);
  });
});

describe("occupancy: which train is on these pieces", () => {
  it("by axles and by cars: a short piece between a car's two axles is under its car, not under an axle", () => {
    const { sim, a, b, c } = line();
    const r = sim.addTrain(["engine"], { pieceId: c, pathIndex: 0, s: 15, reversed: false });
    if (r.kind !== "placed") throw new Error("no train");
    const t = sim.getTrain(r.trainId)!;
    expect(isOn(sim, t, b, "axles")).toBe(false);
    expect(isOn(sim, t, b, "cars")).toBe(true);
    expect(trainOn(sim, new Set([b]))).toBeUndefined();
    expect(trainOn(sim, new Set([b]), { by: "cars" })).toBe(t);
    expect(trainOn(sim, new Set([a, c]))).toBe(t);
    expect(trainOn(sim, new Set([a, c]), { except: t })).toBeUndefined();
    expect(trainOn(sim, (p) => p === c, { standing: true })).toBe(t);
    expect(engineOf(t)).toBe(t.cars[0].id);
    const idx = new CoverIndex();
    expect(idx.over(sim, 0, b)).toBe(t.id);
    expect(idx.otherOver(sim, 0, b, t.id)).toBe(false);
    expect(idx.otherOver(sim, 0, b, t.id + 1)).toBe(true);
  });

  it("under by car ends: a piece under the front car's overhang, past its front axle, is held", () => {
    const { layout, sim, c, d } = line();
    // (Front axle 8 mm short of the 36 mm piece: the engine's nose (20 mm overhang) reaches onto it.)
    const r = sim.addTrain(["engine"], { pieceId: c, pathIndex: 0, s: 208, reversed: false });
    if (r.kind !== "placed") throw new Error("no train");
    const t = sim.getTrain(r.trainId)!;
    expect(t.bogies[0].pieceId).toBe(c);
    expect(sim.piecesUnder(t.id).has(d)).toBe(false);
    const under = underByEnds(layout, t);
    expect(under.has(d)).toBe(true);
    expect(under.get(c)).toBe(1);
  });

  it("under by car ends: one each side of a double straight's roads, by path", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const x = layout.addPiece("double-straight", { x: 0, z: 0, heading: 0 });
    const t0 = appendPiece(layout, "straight-216", false, connectorRef(x, 1));
    const t1 = appendPiece(layout, "straight-216", false, connectorRef(x, 3));
    const r0 = sim.addTrain(["engine"], { pieceId: t0, pathIndex: 0, s: 30, reversed: false });
    const r1 = sim.addTrain(["engine"], { pieceId: t1, pathIndex: 0, s: 30, reversed: false });
    if (r0.kind !== "placed" || r1.kind !== "placed") throw new Error("no train");
    const m0 = underByEnds(layout, sim.getTrain(r0.trainId)!).get(x);
    const m1 = underByEnds(layout, sim.getTrain(r1.trainId)!).get(x);
    expect(m0).toBeDefined();
    expect(m1).toBeDefined();
    expect(m0! & m1!).toBe(0);
  });
});
