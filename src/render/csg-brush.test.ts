import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, MeshBasicMaterial, Shape } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { CSG_BVH_OPTIONS, CsgBrush, csgEvaluate } from "./csg-brush";
import { nonIndexed } from "./non-indexed";

afterEach(() => vi.restoreAllMocks());

const material = new MeshBasicMaterial();

function evaluator(): Evaluator {
  const e = new Evaluator();
  e.useGroups = true;
  e.attributes = ["position", "normal", "uv"];
  return e;
}

/** A box with a cylinder cut through it, then a smaller box cut from that (its result fed back in). */
function carve(make: (g: BufferGeometry) => Brush, evaluate: (e: Evaluator, a: Brush, b: Brush) => Brush): BufferGeometry {
  const e = evaluator();
  const a = make(new BoxGeometry(40, 20, 30).toNonIndexed());
  const b = make(new CylinderGeometry(6, 6, 50, 24).toNonIndexed());
  const c = make(new BoxGeometry(10, 30, 10).translate(15, 0, 0).toNonIndexed());
  for (const x of [a, b, c]) x.updateMatrixWorld();
  return evaluate(e, evaluate(e, a, b), c).geometry;
}

describe("CsgBrush", () => {
  it("builds its BVH with no deprecated option", () => {
    expect(CSG_BVH_OPTIONS).not.toHaveProperty("maxLeafSize");
    const warn = vi.spyOn(console, "warn");
    const brush = new CsgBrush(new BoxGeometry(10, 10, 10).toNonIndexed(), material);
    brush.prepareGeometry();
    expect((brush.geometry as BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });

  it("carves the same geometry as three-bvh-csg's own Brush, without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const theirs = carve((g) => new Brush(g, material), (e, a, b) => e.evaluate(a, b, SUBTRACTION));
    expect(warn).toHaveBeenCalled(); // the library's maxLeafSize deprecation, which CsgBrush avoids
    warn.mockClear();
    const ours = carve((g) => new CsgBrush(g, material), (e, a, b) => csgEvaluate(e, a, b, SUBTRACTION));
    expect(warn).not.toHaveBeenCalled();
    for (const name of ["position", "normal", "uv"]) expect(Array.from(ours.getAttribute(name).array)).toEqual(Array.from(theirs.getAttribute(name).array));
    expect(ours.groups).toEqual(theirs.groups);
  });
});

describe("nonIndexed", () => {
  it("leaves an already non-indexed geometry as it is, without a warning", () => {
    const warn = vi.spyOn(console, "warn");
    const shape = new Shape().moveTo(0, 0).lineTo(10, 0).lineTo(0, 10);
    for (const g of [new ExtrudeGeometry(shape), new RoundedBoxGeometry(10, 10, 10, 2, 1)]) {
      expect(g.index).toBeNull();
      expect(nonIndexed(g)).toBe(g);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("de-indexes an indexed geometry as toNonIndexed does", () => {
    const g = new BoxGeometry(10, 20, 30, 2, 2, 2);
    const flat = nonIndexed(g);
    expect(flat.index).toBeNull();
    expect(g.index).not.toBeNull();
    expect(Array.from(flat.getAttribute("position").array)).toEqual(Array.from(g.toNonIndexed().getAttribute("position").array));
  });
});
