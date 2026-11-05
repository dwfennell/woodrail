import { describe, expect, it } from "vitest";
import { BatchedMesh, BoxGeometry, BufferAttribute, CylinderGeometry, MeshBasicMaterial, SphereGeometry, type BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { compact, compacted, makeRoom, unquantise, weld } from "./compact";
import { nonIndexed } from "./non-indexed";

/** Each drawn vertex's attributes as floats, in draw order. */
function drawn(g: BufferGeometry): number[][] {
  const n = g.index ? g.index.count : g.getAttribute("position").count;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const v = g.index ? g.index.getX(i) : i;
    const row: number[] = [];
    for (const name of Object.keys(g.attributes).sort()) {
      const a = g.getAttribute(name);
      for (let j = 0; j < a.itemSize; j++) row.push(a.getComponent(v, j));
    }
    out.push(row);
  }
  return out;
}

function painted(g: BufferGeometry, rgb: [number, number, number]): BufferGeometry {
  const n = g.getAttribute("position").count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute("color", new BufferAttribute(c, 3));
  return g;
}

const scenery = () =>
  mergeGeometries([
    painted(nonIndexed(new BoxGeometry(10, 20, 30).translate(5, 0, 0)), [0.2, 0.4, 0.6]),
    painted(nonIndexed(new CylinderGeometry(3, 3, 12, 12).translate(-20, 6, 4)), [0.9, 0.1, 0.05]),
    painted(nonIndexed(new SphereGeometry(4, 10, 8).translate(0, 30, 0)), [0.01, 0.02, 0.03]),
  ])!;

describe("compact", () => {
  it("welds exact duplicates: the same triangles drawn, in the same order, from far fewer vertices", () => {
    const g = scenery();
    const before = drawn(g);
    const count = g.getAttribute("position").count;
    weld(g);
    expect(g.index).not.toBeNull();
    expect(g.index!.array).toBeInstanceOf(Uint16Array);
    expect(g.index!.count).toBe(count);
    expect(g.getAttribute("position").count).toBeLessThan(count * 0.45);
    expect(drawn(g)).toEqual(before);
  });

  it("keeps vertices that differ in any attribute apart (a box's corners have three normals)", () => {
    const g = weld(nonIndexed(new BoxGeometry(1, 1, 1)));
    expect(g.getAttribute("position").count).toBe(24);
  });

  it("uses 32-bit indices past 65535 vertices", () => {
    const n = 70000 * 3;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < pos.length; i++) pos[i] = i;
    const g = new (scenery().constructor as typeof BoxGeometry)();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    weld(g);
    expect(g.index!.array).toBeInstanceOf(Uint32Array);
  });

  it("indexes even what has nothing to share, so every compacted geometry is alike", () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const g = new BoxGeometry();
    g.setIndex(null);
    for (const k of Object.keys(g.attributes)) g.deleteAttribute(k);
    g.setAttribute("position", new BufferAttribute(pos, 3));
    expect(weld(g).index!.count).toBe(3);
  });

  it("quantises normals within half a degree and colours exactly enough for 8-bit colour", () => {
    const g = scenery();
    const before = drawn(g);
    compact(g);
    expect(g.getAttribute("normal").array).toBeInstanceOf(Int8Array);
    expect(g.getAttribute("normal").normalized).toBe(true);
    expect(g.getAttribute("color").array).toBeInstanceOf(Uint16Array);
    const after = drawn(g);
    const names = Object.keys(g.attributes).sort();
    // Columns: color (3), normal (3), position (3), uv (2).
    expect(names).toEqual(["color", "normal", "position", "uv"]);
    let worstAngle = 0;
    let worstColour = 0;
    for (let i = 0; i < before.length; i++) {
      const a = before[i];
      const b = after[i];
      for (let j = 0; j < 3; j++) worstColour = Math.max(worstColour, Math.abs(a[j] - b[j]));
      const [ax, ay, az] = a.slice(3, 6);
      const [bx, by, bz] = b.slice(3, 6);
      const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
      worstAngle = Math.max(worstAngle, Math.acos(Math.min(1, cos)));
      // Positions and uvs exactly as they were.
      expect(b.slice(6)).toEqual(a.slice(6));
    }
    expect((worstAngle * 180) / Math.PI).toBeLessThan(0.6);
    expect(worstColour).toBeLessThan(1 / 65535);
  });

  it("keeps a draw range's meaning: the first n vertices merged are the first n indices", () => {
    const parts = [nonIndexed(new BoxGeometry(1, 1, 1)), nonIndexed(new BoxGeometry(1, 1, 1).translate(3, 0, 0))];
    const first = parts[0].getAttribute("position").count;
    const g = compact(mergeGeometries(parts)!);
    g.setDrawRange(0, first);
    for (let i = 0; i < first; i++) expect(g.getAttribute("position").getX(g.index!.getX(i))).toBeLessThan(1);
  });

  it("can be taken back to floats to merge with plain geometry (a catalogue model in a batcher)", () => {
    const g = unquantise(nonIndexed(compact(scenery())));
    const plain = scenery();
    const merged = mergeGeometries([g, plain]);
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute("normal").array).toBeInstanceOf(Float32Array);
  });

  it("compacted: the same geometry if it already is, else a compacted copy", () => {
    const g = compact(scenery());
    expect(compacted(g)).toBe(g);
    const plain = scenery();
    const c = compacted(plain);
    expect(c).not.toBe(plain);
    expect(plain.index).toBeNull();
    expect(c.index).not.toBeNull();
  });

  it("makeRoom grows a batch by half again, vertices and indices apart", () => {
    const mesh = new BatchedMesh(4, 100, 200, new MeshBasicMaterial());
    const room = { vertices: 100, indices: 200 };
    const g = compact(scenery());
    makeRoom(mesh, room, g);
    expect(room.vertices).toBeGreaterThanOrEqual(g.getAttribute("position").count);
    expect(room.indices).toBeGreaterThanOrEqual(g.index!.count);
    mesh.addGeometry(g);
    // Full: the next one grows it by half again (or what it needs, if that's more).
    const before = { ...room };
    const unused = mesh.unusedVertexCount;
    makeRoom(mesh, room, compact(scenery()));
    expect(room.vertices).toBe(Math.max(Math.ceil(before.vertices * 1.5), before.vertices - unused + g.getAttribute("position").count));
    mesh.addGeometry(compact(scenery()));
    mesh.dispose();
  });
});
