import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { looseHeight } from "../landscape";
import { DrawLine } from "../track";
import { drawOptions } from "./draw-testing";
import { createWorld } from "./world";

/**
 * QA (N5): terrace 2 (Sandbox seed 7, a square a level up, then another, by the map's west edge) drawn as QA's harness
 * drew it: the world line x −1764 − d (d 0 to 480, every 15 mm) at z −1620, each point seen on its square's ground,
 * QA's camera (on (−2004, −1620) at 3662.2 mm, tilted 0.95, from −1.1659), a 390 × 844 screen, resampled every 10 px,
 * the line begun on open ground as DrawHand begins one, its ghosts shown on each move. The last point, x −2244, is past
 * the map's edge (no square there: its ground height comes out NaN). QA saw s54 s54 curve-small on a4d7c99, with
 * "That's past the edge of the map"; on main, kept or dropped, the line climbs both levels and stops at the edge:
 * s54 s54 ramp s54 ramp (what fits on the map; the piece past the edge is refused and said).
 */
function terrace2(keepOffMap: boolean) {
  const W = 390;
  const H = 844;
  const world = createWorld(7);
  const G = world.landscape.grid;
  const camera = new PerspectiveCamera(30, W / H, 5, 40000);
  const [cx, cz, dist, phi, theta] = [-2004, -1620, 3662.2, 0.95, -1.1659];
  camera.position.set(cx + Math.sin(theta) * Math.sin(phi) * dist, Math.cos(phi) * dist, cz + Math.cos(theta) * Math.sin(phi) * dist);
  camera.lookAt(cx, 0, cz);
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  const level = new Plane(new Vector3(0, 1, 0), 0);
  const planeAt = (sx: number, sy: number, y: number) => {
    ray.setFromCamera(new Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
    level.constant = -y;
    const v = ray.ray.intersectPlane(level, new Vector3());
    return v ? { x: v.x, z: v.z } : null;
  };
  const path: [number, number][] = [];
  let offMap = 0;
  for (let d = 0; d <= 480; d += 15) {
    const x = -1764 - d;
    const cell = G.cellAtWorld(x, -1620);
    const ground = cell === -1 ? NaN : G.groundY(cell);
    if (cell === -1) offMap++;
    if (!Number.isFinite(ground) && !keepOffMap) continue;
    const v = new Vector3(x, Number.isFinite(ground) ? ground : 0, -1620).project(camera);
    path.push([((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]);
  }
  const screen: [number, number][] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let k = 1; k <= n; k++) screen.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const origin = planeAt(...screen[0], 0)!;
  const before: { x: number; z: number }[] = [];
  let line: DrawLine | null = null;
  for (const [sx, sy] of screen.slice(1)) {
    if (!line) {
      const p = planeAt(sx, sy, 0)!;
      if (Math.hypot(p.x - origin.x, p.z - origin.z) < 30) {
        before.push(p);
        continue;
      }
      const heading = Math.round(Math.atan2(p.z - origin.z, p.x - origin.x) / (Math.PI / 4)) * (Math.PI / 4);
      const x = Math.round(origin.x / 18) * 18;
      const z = Math.round(origin.z / 18) * 18;
      const y = looseHeight(world.landscape, world.layout, "straight-54", false, { x, z, heading }, -1);
      line = new DrawLine({ x, z, heading, y, kind: "peg" }, drawOptions(world, false));
      for (const q of before) line.addPoint(q.x, q.z);
    }
    line.addSeen((h) => planeAt(sx, sy, h));
    line.preview();
  }
  const shown = line!.preview().map((p) => p.type);
  line!.finish();
  return { offMap, shown, laid: line!.placeable().map((p) => p.type), all: line!.pieces.map((p) => p.type + (p.blocked ? `[${p.blocked}]` : "")) };
}

describe("QA N5: terrace 2 by the map's edge", () => {
  for (const keep of [false, true])
    it(`climbs both levels and stops at the edge (the off-map point ${keep ? "kept" : "dropped"})`, () => {
      const r = terrace2(keep);
      expect(r.offMap).toBe(1);
      expect(r.laid, r.all.join(" ")).toEqual(["straight-54", "straight-54", "ramp", "straight-54", "ramp"]);
      // (What went down is what the ghosts showed, a refused piece past the edge apart.)
      expect(r.shown.slice(0, r.laid.length)).toEqual(r.laid);
      expect(r.all.slice(r.laid.length).every((t) => /past the edge/.test(t))).toBe(true);
    });
});
