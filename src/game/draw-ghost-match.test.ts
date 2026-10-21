import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { Editor } from "../editor/editor";
import { hillsOf, looseHeight } from "../landscape";
import { connectorRef, createWorldConnector, DrawLine, normalizeAngle, type DrawnPiece } from "../track";
import { drawOptions } from "./draw-testing";
import { createWorld, type World } from "./world";

/**
 * QA: what a drawn line put down when the finger lifted wasn't what its ghosts showed just before. A straight shown at
 * z −846 went down at −900 with a short straight added (Brambleton W), pieces moved 11 to 26 mm and pieces were added
 * (Elderwick W, Ashcombe W), the whole line over the river moved 44 to 53 mm (Fernhill). Three causes: the line laid
 * its last stretch (the look-ahead's worth of stroke) only on the lift, closing onto the station's end there another
 * way; the editor then spread the closing joint's play along the line once it was down; and a bend to close wasn't
 * checked again where it put the pieces. Now the ghosts are what the lift lays (`DrawLine.preview`), the play is taken
 * up before it's shown (`closedOnto`), and the editor puts the line down where it was shown (`placeRun`'s `fitted`).
 *
 * QA's strokes (scratchpad qa-ghost/README.md), drawn as the game draws them: the camera as QA framed it, the stroke's
 * world points seen on the ground and resampled every 14 px on the screen, each move read at the line's height, the
 * line begun on open ground as DrawHand begins one, the ghosts shown after each move, then lifted and put down.
 */

const R = (d: number) => (d * Math.PI) / 180;

function hermite(sx: number, sz: number, hs: number, tx: number, tz: number, ht: number, over = 0, every = 10): [number, number][] {
  const L = Math.hypot(tx - sx, tz - sz);
  const pts: [number, number][] = [[sx, sz]];
  const n = Math.ceil((L * 1.3) / every);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const [a, b, c, d] = [2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2];
    pts.push([a * sx + b * L * Math.cos(hs) + c * tx + d * L * Math.cos(ht), a * sz + b * L * Math.sin(hs) + c * tz + d * L * Math.sin(ht)]);
  }
  for (let o = every; o <= over + 1e-6; o += every) pts.push([tx + o * Math.cos(ht), tz + o * Math.sin(ht)]);
  return pts;
}

/** QA's approach to a station's end `e` (heading in radians): from `back` mm out and `lat` to the side, `off` mm off its line. */
function approach(e: { x: number; z: number; heading: number }, back = 500, lat = 120, off = 6, over = 25, startTurn = 0): [number, number][] {
  const ht = e.heading + Math.PI;
  const nx = -Math.sin(ht);
  const nz = Math.cos(ht);
  const tx = e.x + nx * off;
  const tz = e.z + nz * off;
  const sx = e.x - Math.cos(ht) * back + nx * lat;
  const sz = e.z - Math.sin(ht) * back + nz * lat;
  return hermite(sx, sz, ht + R(startTurn), tx, tz, ht, over);
}

/** A station's end: its piece's connector `k`, as the layout has it. */
function stationEnd(world: World, name: string, k: number) {
  const town = world.landscape.towns.find((t) => t.name === name)!;
  const id = world.stations.get(town.id)!;
  const ref = connectorRef(id, k);
  return { ref, ...world.layout.worldConnector(ref, createWorldConnector()) };
}

type Laid = { type: string; flipped: boolean; x: number; z: number; heading: number; y: number };
const asLaid = (p: Pick<DrawnPiece, "type" | "flipped" | "pose" | "y">): Laid => ({ type: p.type, flipped: p.flipped, x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });

/**
 * Draw `pts` (world points) on `world` as the game does on a `W` × `H` touch screen at device scale 1, QA's camera
 * centred on the stroke's box at `dist` mm; lift, and put the line down through the editor (stations fixed). The last
 * ghosts (the pieces that may go down) and what went down.
 */
function drawAsGame(world: World, pts: readonly [number, number][], W: number, H: number, dist: number) {
  const hills = hillsOf(world.landscape.grid);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const camera = new PerspectiveCamera(30, W / H, 5, 40000);
  const [phi, theta] = [0.95, -1.1659];
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
  const toScreen = (x: number, z: number): [number, number] => {
    const v = new Vector3(x, hills.groundAt(x, z), z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  // The polyline on the screen, resampled every 14 px.
  const screen: [number, number][] = [toScreen(...pts[0])];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = toScreen(...pts[i - 1]);
    const [bx, by] = toScreen(...pts[i]);
    const len = Math.hypot(bx - ax, by - ay);
    let t = 14 - carry;
    for (; t <= len; t += 14) screen.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
    carry = len - (t - 14);
  }
  // As DrawHand begins a line on open ground: once the finger is 30 mm off the press, on the grid, in eighths.
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
    // (The ghosts, after each move.)
    line.preview();
  }
  const shown = line!.preview();
  const ghosts = shown.slice(0, (shown.findIndex((p) => p.blocked) + 1 || shown.length + 1) - 1).map(asLaid);
  line!.finish();
  const fixed = new Set([...world.stations.values(), ...world.depots.values()]);
  const editor = new Editor(world.layout, world.sim, () => {}, (id) => fixed.has(id));
  const ids = editor.placeRun(line!.placeable(), line!.fitted);
  const laid = ids.map((id) => asLaid(world.layout.getPiece(id)!));
  return { ghosts, laid, line: line! };
}

/** How far what went down is from the ghosts (mm, or a degree counted as a mm), or Infinity if not the same pieces. */
function offGhosts(ghosts: readonly Laid[], laid: readonly Laid[]): number {
  if (ghosts.length !== laid.length) return Infinity;
  let worst = 0;
  for (let i = 0; i < laid.length; i++) {
    const [g, q] = [ghosts[i], laid[i]];
    if (g.type !== q.type || g.flipped !== q.flipped || g.y !== q.y) return Infinity;
    worst = Math.max(worst, Math.hypot(q.x - g.x, q.z - g.z), (Math.abs(normalizeAngle(q.heading - g.heading)) * 180) / Math.PI);
  }
  return worst;
}

const show = (ps: readonly Laid[]) => ps.map((p) => `${p.type}${p.flipped ? "~" : ""}@(${p.x.toFixed(1)}, ${p.z.toFixed(1)}, ${p.heading.toFixed(3)})`).join(" ");

describe("QA: what a drawn line puts down is what its ghosts showed", () => {
  type Case = { name: string; seed: number; W: number; H: number; d: number; pts: (w: World) => [number, number][]; end: (w: World) => { ref: number } };
  const brambleton = (w: World) => stationEnd(w, "Brambleton", 0);
  const elderwickW = (w: World) => stationEnd(w, "Elderwick", 0);
  const elderwickE = (w: World) => stationEnd(w, "Elderwick", 1);
  const ashcombe = (w: World) => stationEnd(w, "Ashcombe", 1);
  const fernhill = (w: World) => stationEnd(w, "Fernhill", 0);
  const cases: Case[] = [
    { name: "Brambleton W, 390", seed: 7, W: 390, H: 844, d: 805, pts: (w) => approach(brambleton(w), 320, 60), end: brambleton },
    { name: "Brambleton W, 360", seed: 7, W: 360, H: 740, d: 926, pts: (w) => approach(brambleton(w), 320, 60), end: brambleton },
    { name: "Elderwick W, 390", seed: 7, W: 390, H: 844, d: 1862, pts: (w) => approach(elderwickW(w), 450, -120, -6), end: elderwickW },
    { name: "Elderwick W, 360", seed: 7, W: 360, H: 740, d: 1862, pts: (w) => approach(elderwickW(w), 450, -120, -6), end: elderwickW },
    { name: "Ashcombe W, 390", seed: 7, W: 390, H: 844, d: 1065, pts: (w) => approach(ashcombe(w), 400, 160, 5, 20, -15), end: ashcombe },
    { name: "Ashcombe W, 360", seed: 7, W: 360, H: 740, d: 1224, pts: (w) => approach(ashcombe(w), 400, 160, 5, 20, -15), end: ashcombe },
    { name: "Elderwick E, 390", seed: 7, W: 390, H: 844, d: 1300, pts: (w) => approach(elderwickE(w), 480, 140, 8, 30), end: elderwickE },
    { name: "Elderwick E, 360", seed: 7, W: 360, H: 740, d: 1300, pts: (w) => approach(elderwickE(w), 480, 140, 8, 30), end: elderwickE },
  ];
  for (const off of [0, 9])
    for (const over of [0, 50])
      cases.push({ name: `Fernhill W, ${off} mm off, ${over} mm on`, seed: 21, W: 390, H: 844, d: 900, pts: (w) => hermite(-1548, -396, -Math.PI / 4, fernhill(w).x, fernhill(w).z + off, 0, over), end: fernhill });

  for (const c of cases)
    it(`${c.name}: the pieces put down are the last ghosts, within 1 mm and 1°, and joined to the station`, () => {
      const world = createWorld(c.seed, true);
      const { ghosts, laid } = drawAsGame(world, c.pts(world), c.W, c.H, c.d);
      const why = `ghosts ${show(ghosts)}\nlaid   ${show(laid)}`;
      expect(laid.length, why).toBeGreaterThan(0);
      expect(offGhosts(ghosts, laid), why).toBeLessThanOrEqual(1);
      expect(world.layout.joinedConnector(c.end(world).ref), why).not.toBe(-1);
    });
});
