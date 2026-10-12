import { Box3, Frustum, Matrix4, type Camera, type Object3D, type Vector3 } from "three";
import { PLOT_DEPTH, PLOT_WIDTH } from "../../landscape";

/**
 * Scenery is drawn in tiles of 2 × 2 plots, each its own meshes, so the camera skips the tiles out of view (three
 * culls whole objects by their bounds; one mesh for the whole world is never skipped). Big enough that a view of the
 * whole land doesn't cost many more draws; small enough that a close view leaves most of the world out.
 */
export const TILE_WIDTH = 2 * PLOT_WIDTH;
export const TILE_DEPTH = 2 * PLOT_DEPTH;

/** The tile a plan point is in, as one number. */
export function tileAt(x: number, z: number): number {
  return (Math.floor(x / TILE_WIDTH) + 32768) * 65536 + (Math.floor(z / TILE_DEPTH) + 32768);
}

/** Sort things into tiles (2 × 2 plots, or `width` × `depth`) by where they are. */
export function byTile<T>(items: readonly T[], at: (item: T) => { x: number; z: number }, width = TILE_WIDTH, depth = TILE_DEPTH): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const item of items) {
    const p = at(item);
    const key = (Math.floor(p.x / width) + 32768) * 65536 + (Math.floor(p.z / depth) + 32768);
    let list = out.get(key);
    if (!list) out.set(key, (list = []));
    list.push(item);
  }
  return out;
}

/**
 * How far past its own things a tile's box reaches: the low sun's shadows of the tallest hills (so a hill just out of
 * view still shades the ground in view), and room for trees stepping aside.
 */
export const CULL_PAD = 320;

/**
 * Three culls by bounding spheres, which for flat, wide tiles reach far up and down and so are nearly always "in
 * view". Tiles carry flat boxes instead (`userData.cullBoxes`), one per plot-sized patch of what they hold (so a tile
 * shaped like an L, or a stretch of the countryside's ring, doesn't claim the land inside it), and are shown only when
 * one of them is in view: see `cullTiles`.
 */
export function setCullBox(object: Object3D, points: Iterable<{ x: number; z: number }>, top: number): void {
  const boxes = new Map<string, Box3>();
  for (const p of points) {
    const key = `${Math.floor(p.x / PLOT_WIDTH)},${Math.floor(p.z / PLOT_DEPTH)}`;
    let box = boxes.get(key);
    if (!box) {
      boxes.set(key, (box = new Box3()));
      box.min.set(p.x, -1, p.z);
      box.max.set(p.x, top, p.z);
    }
    box.min.x = Math.min(box.min.x, p.x);
    box.min.z = Math.min(box.min.z, p.z);
    box.max.x = Math.max(box.max.x, p.x);
    box.max.z = Math.max(box.max.z, p.z);
  }
  if (boxes.size === 0) return;
  for (const box of boxes.values()) {
    box.min.x -= CULL_PAD;
    box.min.z -= CULL_PAD;
    box.max.x += CULL_PAD;
    box.max.z += CULL_PAD;
  }
  object.userData.cullBoxes = [...boxes.values()];
}

/**
 * Give an object cull boxes covering these rectangles (world mm) whole, padded like `setCullBox`'s. For things that
 * fill an area (a plot's blocks, a tile of felt): boxes made from a few corner points would cover only the corners.
 */
export function setCullRects(object: Object3D, rects: Iterable<{ x0: number; z0: number; x1: number; z1: number }>, top: number): void {
  const boxes: Box3[] = [];
  for (const r of rects) {
    const box = new Box3();
    box.min.set(r.x0 - CULL_PAD, -1, r.z0 - CULL_PAD);
    box.max.set(r.x1 + CULL_PAD, top, r.z1 + CULL_PAD);
    boxes.push(box);
  }
  if (boxes.length > 0) object.userData.cullBoxes = boxes;
}

/** A plot's rectangle (world mm). */
export const plotRect = (p: { px: number; pz: number }) => ({ x0: p.px * PLOT_WIDTH, z0: p.pz * PLOT_DEPTH, x1: (p.px + 1) * PLOT_WIDTH, z1: (p.pz + 1) * PLOT_DEPTH });

const frustum = new Frustum();
const viewProjection = new Matrix4();

/**
 * How far from the camera anything is drawn (mm): a multiple of the camera's distance from what it looks at, and at
 * least `MIN_REACH`. Land fades into the haze before it (see `haze.ts`), so nothing ends abruptly. The camera's
 * distance is capped, so however big the world grows, only so much of it is ever drawn.
 */
export const REACH_FACTOR = 1.6;
export const MIN_REACH = 5000;
export const viewReach = (cameraDistance: number): number => Math.max(MIN_REACH, REACH_FACTOR * cameraDistance);

/**
 * Things only seen close up (`userData.nearOnly`, such as the dark inside of hills, seen down the seams between
 * blocks) are drawn nearer the camera than this (mm). It grows with the zoom, so whatever is around the point the
 * camera looks at always has them.
 */
export const MIN_DETAIL_REACH = 6000;
export const DETAIL_FACTOR = 1.2;
export const detailReach = (cameraDistance: number): number => Math.max(MIN_DETAIL_REACH, DETAIL_FACTOR * cameraDistance);

/**
 * Show the tiles (children of `roots` with cull boxes) the camera sees within `reach`, and hide the rest. A tile with
 * `userData.lod = { near, far }` (two ways of drawing the same thing: one split up finer, culled better close up, one
 * in fewer draws) shows `near` within `userData.lodReach` of the camera, else `far`, and the tiles inside whichever it
 * shows are culled in turn. One marked `userData.nearOnly` is shown only within `detail` (see `detailReach`), one
 * with `userData.maxDistance` only within that. Returns true if any changed (their shadows need drawing again). A box
 * test or two per tile, only on frames that are drawn.
 */
export function cullTiles(roots: readonly Object3D[], camera: Camera, reach: number, detail: number): boolean {
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(viewProjection);
  return cullChildren(roots, camera.position, reach, detail);
}

function cullChildren(roots: readonly Object3D[], eye: Vector3, reach: number, detail: number): boolean {
  let changed = false;
  const show = (o: Object3D, on: boolean) => {
    if (o.visible === on) return;
    o.visible = on;
    changed = true;
  };
  for (const root of roots) {
    for (const tile of root.children) {
      const boxes = tile.userData.cullBoxes as Box3[] | undefined;
      if (!boxes) continue;
      let near = Infinity;
      for (const box of boxes) {
        const d = box.distanceToPoint(eye);
        if (d <= reach && d < near && frustum.intersectsBox(box)) near = d;
      }
      const limit = tile.userData.nearOnly ? detail : ((tile.userData.maxDistance as number | undefined) ?? Infinity);
      const seen = near < limit;
      show(tile, seen);
      const lod = tile.userData.lod as { near: Object3D; far: Object3D } | undefined;
      if (!lod || !seen) continue;
      // Which version: by the nearest of the whole tile (so all of it switches together).
      let closest = Infinity;
      for (const box of boxes) closest = Math.min(closest, box.distanceToPoint(eye));
      const fine = closest < ((tile.userData.lodReach as number | undefined) ?? detail);
      show(lod.near, fine);
      show(lod.far, !fine);
      if (cullChildren([fine ? lod.near : lod.far], eye, reach, detail)) changed = true;
    }
  }
  return changed;
}
