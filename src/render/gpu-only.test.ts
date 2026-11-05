import { BoxGeometry, type BufferAttribute, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it, vi } from "vitest";
import { gpuOnly, gpuOnlyGeometry } from "./gpu-only";

/** What three's WebGLAttributes does on first sight of an attribute: upload the array, then call back. */
function upload(a: { array: ArrayLike<number>; onUploadCallback: () => void }): number {
  const bytes = (a.array as unknown as { byteLength: number }).byteLength;
  a.onUploadCallback();
  return bytes;
}

describe("gpuOnly", () => {
  it("frees a drawn geometry's arrays after upload, keeping its counts and bounds", () => {
    const g = new BoxGeometry(10, 20, 30);
    const count = g.getAttribute("position").count;
    const indexCount = g.index!.count;
    gpuOnlyGeometry(g);
    expect(g.boundingSphere).not.toBeNull();
    expect(g.boundingBox!.max.y).toBe(10);
    // Nothing freed before the upload.
    expect(g.getAttribute("position").array.length).toBe(count * 3);
    for (const name of Object.keys(g.attributes)) expect(upload(g.getAttribute(name) as never)).toBeGreaterThan(0);
    upload(g.index as never);
    expect(g.getAttribute("position").array.length).toBe(0);
    expect(g.getAttribute("position").array).toBeInstanceOf(Float32Array);
    expect(g.index!.array.length).toBe(0);
    expect(g.getAttribute("position").count).toBe(count);
    expect(g.index!.count).toBe(indexCount);
  });

  it("says so when a freed geometry is uploaded again (disposed, then drawn)", () => {
    const g = new BoxGeometry(1, 1, 1);
    gpuOnlyGeometry(g);
    const pos = g.getAttribute("position") as never as { array: ArrayLike<number>; onUploadCallback: () => void };
    upload(pos);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    upload(pos);
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("keeps what's updated in place, and geometry shared with models", () => {
    const dynamic = new BoxGeometry(1, 1, 1);
    (dynamic.getAttribute("position") as BufferAttribute).setUsage(DynamicDrawUsage);
    const shared = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    shared.userData.sharedGeometry = true;
    const own = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const root = new Group().add(new Mesh(dynamic, new MeshBasicMaterial()), shared, own);
    gpuOnly(root);
    upload(dynamic.getAttribute("position") as never);
    expect(dynamic.getAttribute("position").array.length).toBeGreaterThan(0);
    expect(shared.geometry.userData.gpuOnly).toBeUndefined();
    expect(own.geometry.userData.gpuOnly).toBe(true);
  });
});

describe("gpuOnly, pickable", () => {
  it("keeps positions and index (a raycast's) and frees the rest", () => {
    const g = new BoxGeometry(1, 1, 1);
    gpuOnlyGeometry(g, { pickable: true });
    for (const name of Object.keys(g.attributes)) upload(g.getAttribute(name) as never);
    upload(g.index as never);
    expect(g.getAttribute("position").array.length).toBeGreaterThan(0);
    expect(g.index!.array.length).toBeGreaterThan(0);
    expect(g.getAttribute("normal").array.length).toBe(0);
    expect(g.getAttribute("uv").array.length).toBe(0);
  });

  it("makes normals compact before the upload", () => {
    const g = new BoxGeometry(1, 1, 1);
    gpuOnlyGeometry(g);
    expect(g.getAttribute("normal").array).toBeInstanceOf(Int8Array);
    expect((g.getAttribute("normal") as BufferAttribute).normalized).toBe(true);
  });
});
