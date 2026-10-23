import { describe, expect, it } from "vitest";
import { Matrix4, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
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
 * "That's past the edge of the map"; here, kept or dropped, the line climbs both levels and stops at the edge (what
 * fits on the map; the piece past the edge is refused and said). Before the finger was read on the hills it's over
 * nearer the camera (`DrawLine.onGround`), that was s54 s54 ramp s54 ramp; now the stroke runs straight on as drawn,
 * and it's s108 ramp ramp (and an s54 on the top, the off-map point dropped).
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
      // (Kept, the finger's let go past the edge, and the piece toward it is refused and says so.)
      expect(r.laid, r.all.join(" ")).toEqual(keep ? ["straight-108", "ramp", "ramp"] : ["straight-108", "ramp", "ramp", "straight-54"]);
      // (What went down is what the ghosts showed, a refused piece past the edge apart.)
      expect(r.shown.slice(0, r.laid.length)).toEqual(r.laid);
      expect(r.all.slice(r.laid.length).every((t) => /past the edge/.test(t))).toBe(true);
    });
});

/**
 * QA's browser run of terrace 2 (their script on main, 2fc79a3: Draw switched on by its chip, the 390 × 844 phone,
 * touches every 16 ms, the screen line resampled every 10 px, the off-map point kept, the finger lifted 16 ms after the
 * last move), as the page saw it: the camera, the press and the moves DrawHand.move was given. On 2fc79a3 this laid
 * s54 s54 curve-small (a curve-large after it refused, "That's past the edge of the map"), 8 runs out of 8.
 *
 * Seen from the west, the terrace's top hides most of its lower step and the ground at its foot: read on the line's
 * level, the finger over the top was seen past the hill on the low ground in front of it, and the stroke jogged back
 * along the view and 55 mm off to the side, so the line curved away before it reached the rise. Now it's read on the
 * level its ray meets there (`DrawLine.onGround`), and the stroke runs on as drawn.
 */
const QA_CAMERA = [0.3939, 0, 0.9191, 0, 0.5347, 0.8134, -0.2291, 0, -0.7476, 0.5817, 0.3204, 0, -4742.0269, 2130.2398, -446.5452, 1];
const QA_PRESS: [number, number] = [233.7585, 369.3953];
const QA_MOVES: [number, number][] = [
  [227.827, 377.446], [221.895, 385.497], [215.963, 393.548], [210.032, 401.598], [204.1, 409.649], [198.168, 417.7], [194.128, 417.424],
  [191.874, 409.259], [185.884, 417.266], [181.305, 419.024], [179.335, 409.22], [173.517, 416.173], [167.467, 424.136], [161.417, 432.098],
  [155.367, 440.061], [153.933, 449.722], [153.378, 459.706], [152.822, 469.691], [152.267, 479.676],
];

describe("QA N5: terrace 2 as QA's browser run drew it", () => {
  it("climbs both levels, the ghosts as it goes down, and says only that the finger went past the edge", () => {
    const [W, H] = [390, 844];
    const world = createWorld(7);
    const camera = new PerspectiveCamera(30, W / H, 5, 40000);
    const m = new Matrix4().fromArray(QA_CAMERA);
    m.decompose(camera.position, camera.quaternion, camera.scale);
    camera.updateMatrixWorld(true);
    const ray = new Raycaster();
    const level = new Plane(new Vector3(0, 1, 0), 0);
    const planeAt = (sx: number, sy: number, y: number) => {
      ray.setFromCamera(new Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
      level.constant = -y;
      const v = ray.ray.intersectPlane(level, new Vector3());
      return v ? { x: v.x, z: v.z } : null;
    };
    // As DrawHand begins a line on open ground: once the finger is 30 mm off the press, on the grid, in eighths.
    const origin = planeAt(...QA_PRESS, 0)!;
    const before: { x: number; z: number }[] = [];
    let line: DrawLine | null = null;
    for (const [sx, sy] of QA_MOVES) {
      if (!line) {
        const p = planeAt(sx, sy, 0)!;
        if (Math.hypot(p.x - origin.x, p.z - origin.z) < 30) {
          before.push(p);
          continue;
        }
        const heading = Math.round(Math.atan2(p.z - origin.z, p.x - origin.x) / (Math.PI / 4)) * (Math.PI / 4);
        const [x, z] = [Math.round(origin.x / 18) * 18, Math.round(origin.z / 18) * 18];
        line = new DrawLine({ x, z, heading, y: looseHeight(world.landscape, world.layout, "straight-54", false, { x, z, heading }, -1), kind: "peg" }, drawOptions(world, false));
        for (const q of before) line.addPoint(q.x, q.z);
      }
      line.addSeen((h) => planeAt(sx, sy, h));
      line.preview();
    }
    expect(line!.start).toMatchObject({ x: -1764, z: -1620, y: 0 });
    const shown = line!.preview().map((p) => `${p.type}@${p.y}${p.blocked ? "!" : ""}`);
    line!.finish();
    const laid = line!.placeable().map((p) => `${p.type}@${p.y}`);
    const all = line!.pieces.map((p) => `${p.type}@${p.y}${p.blocked ? "!" : ""}`);
    expect(laid, all.join(" ")).toEqual(["straight-108@0", "ramp@0", "ramp@48"]);
    expect(all).toEqual(shown);
    expect(line!.pieces.slice(laid.length).every((p) => /past the edge/.test(p.blocked ?? ""))).toBe(true);
    expect(line!.pieces.every((p) => !p.type.startsWith("curve"))).toBe(true);
  });
});
