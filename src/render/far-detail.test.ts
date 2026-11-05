import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { compact } from "./compact";
import { nonIndexed } from "./non-indexed";
import { FAR_ASK_FRAMES, FAR_PX_PER_MM, farGeometry, farIndex, loadSimplifier, resetFarDetail, updateFarDetail, useFarDetail } from "./far-detail";

/**
 * A little town's worth of merged scenery, welded as the batcher leaves it: houses whose flat walls are cut into many
 * triangles (as a model's often are), a rounded one, and round trees (their curves kept: their normals turn).
 */
const town = () =>
  compact(
    mergeGeometries([
      ...[0, 60, 120].map((x) => nonIndexed(new BoxGeometry(40, 30, 30, 8, 6, 6).translate(x, 15, 0))),
      nonIndexed(new RoundedBoxGeometry(40, 30, 30, 2, 2.5).translate(180, 15, 0)),
      ...[0, 60].map((x) => nonIndexed(new SphereGeometry(12, 14, 10).translate(x, 20, 60))),
    ])!,
  );

const idle = () => new Promise((r) => setTimeout(r, 100));

describe("far detail", () => {
  it("a far index over the same vertices: far fewer triangles, every vertex within the error of the surface", async () => {
    await loadSimplifier();
    const g = town();
    const index = farIndex(g)!;
    expect(index).not.toBeNull();
    expect(index.length).toBeLessThan(g.index!.count * 0.5);
    for (const v of index) expect(v).toBeLessThan(g.getAttribute("position").count);
    // The bounds are the same: the outline is kept.
    const far = farGeometry(g)!;
    far.computeBoundingBox();
    g.computeBoundingBox();
    expect(far.boundingBox!.min.distanceTo(g.boundingBox!.min)).toBeLessThan(0.5);
    expect(far.boundingBox!.max.distanceTo(g.boundingBox!.max)).toBeLessThan(0.5);
    // Its own vertices only, in the same formats.
    expect(far.getAttribute("position").count).toBeLessThan(g.getAttribute("position").count);
    expect(far.getAttribute("normal").array).toBeInstanceOf(Int8Array);
  });

  it("nothing for a plain box (nothing to save)", async () => {
    await loadSimplifier();
    expect(farIndex(compact(nonIndexed(new BoxGeometry(10, 10, 10))))).toBeNull();
  });

  it("swaps a mesh to its far version under half a pixel a millimetre, back 10% nearer, made when idle", async () => {
    resetFarDetail();
    await loadSimplifier();
    const parent = new Group();
    const g = town();
    const mesh = useFarDetail(new Mesh(g, new MeshBasicMaterial()));
    parent.add(mesh);
    const pxScale = 1000;
    // Its nearest point (the box's +z face at about 72) seen from straight out along z.
    const at = (pxPerMm: number) => new Vector3(60, 15, 72 + pxScale / pxPerMm);
    expect(updateFarDetail(at(FAR_PX_PER_MM * 2), pxScale)).toBe(0);
    expect(mesh.geometry).toBe(g);
    // Far for a moment (a few frames drawn): not asked for.
    for (let i = 0; i < FAR_ASK_FRAMES - 1; i++) expect(updateFarDetail(at(FAR_PX_PER_MM * 0.9), pxScale)).toBe(0);
    updateFarDetail(at(FAR_PX_PER_MM * 2), pxScale);
    for (let i = 0; i < FAR_ASK_FRAMES - 1; i++) updateFarDetail(at(FAR_PX_PER_MM * 0.9), pxScale);
    await idle();
    expect(updateFarDetail(at(FAR_PX_PER_MM * 0.9), pxScale)).toBe(0);
    // Far for long enough (a camera moving out): asked for, drawn near until it's made.
    expect(updateFarDetail(at(FAR_PX_PER_MM * 0.9), pxScale)).toBe(0);
    await idle();
    expect(updateFarDetail(at(FAR_PX_PER_MM * 0.9), pxScale)).toBe(1);
    const far = mesh.geometry;
    expect(far).not.toBe(g);
    // Shares the real one's vertices: only its index is its own.
    expect(far.getAttribute("position")).toBe(g.getAttribute("position"));
    // A little nearer than the line: still far (hysteresis); 10% nearer: near again.
    expect(updateFarDetail(at(FAR_PX_PER_MM * 1.05), pxScale)).toBe(1);
    expect(updateFarDetail(at(FAR_PX_PER_MM * 1.15), pxScale)).toBe(0);
    expect(mesh.geometry).toBe(g);
    // Freed with it, and forgotten.
    let farFreed = false;
    far.addEventListener("dispose", () => (farFreed = true));
    g.dispose();
    expect(farFreed).toBe(true);
    expect(updateFarDetail(at(FAR_PX_PER_MM * 0.5), pxScale)).toBe(0);
  });

  it("leaves a mesh drawn in part (a draw range) as it is", async () => {
    resetFarDetail();
    await loadSimplifier();
    const parent = new Group();
    const g = town();
    g.setDrawRange(0, 36);
    const mesh = useFarDetail(new Mesh(g, new MeshBasicMaterial()));
    parent.add(mesh);
    for (let i = 0; i < FAR_ASK_FRAMES; i++) updateFarDetail(new Vector3(0, 0, 1e7), 1000);
    await idle();
    expect(updateFarDetail(new Vector3(0, 0, 1e7), 1000)).toBe(0);
    expect(mesh.geometry).toBe(g);
  });
});
