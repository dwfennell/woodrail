import { Box3, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { getPieceDef } from "../track";
import { buildPieceGeometry } from "./track-geometry";
import { pieceGeometry } from "./track-view";

const box = (g: BufferGeometry) => new Box3().setFromObject(new Mesh(g, new MeshBasicMaterial()));

/** Signed volume: positive when the faces point outward. */
function volume(g: BufferGeometry): number {
  const p = g.getAttribute("position");
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  const v = (i: number) => new Vector3().fromBufferAttribute(p, idx ? idx.getX(i) : i);
  let sum = 0;
  for (let i = 0; i < n; i += 3) sum += v(i).dot(v(i + 1).cross(v(i + 2))) / 6;
  return sum;
}

describe("mirrored pieces", () => {
  it("are their plain shape reflected, the same shape the carving would make, still facing outward", () => {
    for (const type of ["curve-large", "switch", "s-curve"] as const) {
      const fromMirror = pieceGeometry(type, true);
      const carved = buildPieceGeometry(getPieceDef(type, true));
      const a = box(fromMirror);
      const b = box(carved);
      for (const k of ["min", "max"] as const) for (const axis of ["x", "y", "z"] as const) expect(a[k][axis], `${type} ${k}.${axis}`).toBeCloseTo(b[k][axis], 1);
      expect(volume(fromMirror) / volume(carved), type).toBeCloseTo(1, 2);
      // Same material groups, so the cut grooves stay the dark wood.
      expect(fromMirror.groups.map((g) => g.materialIndex)).toEqual(pieceGeometry(type, false).groups.map((g) => g.materialIndex));
    }
  }, 60000);
});
