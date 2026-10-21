import { describe, expect, it } from "vitest";
import save from "./fixtures/draw-depot-948582.json";
import { Editor } from "../editor/editor";
import { TREE_CLEARANCE, trackPoints, treesAside } from "../landscape";
import { deserializeWorld } from "../persist/save";
import { treePlacements } from "../render/dressing/trees";
import { connectorRef, createWorldConnector, DrawLine, normalizeAngle, STANDARD_DRAW_TYPES, type DrawEnd } from "../track";
import { drawOptions } from "./draw-testing";
import type { World } from "./world";

/**
 * A player's report (seed 948582, the starter map, Game mode): "This draw result does not look so great". A line drawn
 * from Puddleby's west end along the straight and round a quarter turn into the sawmill's end came out as three long
 * straights, a short and a tight curve, the curve and a mini into the sawmill, the joints of the last five pieces bent
 * to close it: the straights 3 to 4 degrees off, 13 to 31 mm to the side, and two trees seemed to stand on the track.
 * The save (fixtures/draw-depot-948582.json) has the line as it was laid; the stroke is drawn again here over the map
 * with the line taken up. A corner drawn tighter than the curve (about 70 mm radius), the straight run 30 mm to its
 * side, lays exactly what the save has (main a4d7c99): the stroke reached the sawmill's end only after the tight
 * curve was down, and no two pieces from there seat on it, so a curve was bent onto it, five joints giving.
 */

/** The save, with the drawn line (pieces 15 to 21) taken up again. */
function mapWithoutLine(): World {
  const r = deserializeWorld(save);
  if (!r.ok) throw new Error(r.error);
  const w = r.value;
  for (let id = 15; id <= 21; id++) w.layout.removePiece(id);
  return w;
}

/** A hand's wobble: two slow waves and a quicker one, about `amp` mm either side, easing in from 0. */
const wobble = (amp: number, phase: number) => (s: number) =>
  amp * Math.min(1, s / 60) * (0.6 * Math.sin(s / 41 + phase) + 0.4 * Math.sin(s / 13 + 2 * phase));

/**
 * The stroke, as the player drew it: west from Puddleby's end along the line's own straight (z −180), round a quarter
 * turn of radius `r` to the north, and up into the sawmill's end (x −1476), on past it `over` mm; `amp` mm of wobble.
 */
function stroke(r: number, amp: number, phase: number, drift = 0, over = 30): { x: number; z: number }[] {
  const x0 = -648;
  const z0 = -180;
  const xTurn = -1476 + r;
  const run = x0 - xTurn;
  const arc = (r * Math.PI) / 2;
  const up = 0 - (z0 + r) + 28 + over;
  const w = wobble(amp, phase);
  const pts: { x: number; z: number }[] = [];
  for (let s = 4; s <= run + arc + up; s += 4) {
    let x: number;
    let z: number;
    let h: number;
    if (s <= run) [x, z, h] = [x0 - s, z0, Math.PI];
    else if (s <= run + arc) {
      const a = (s - run) / r;
      [x, z, h] = [xTurn - r * Math.sin(a), z0 + r * (1 - Math.cos(a)), Math.PI - a];
    } else [x, z, h] = [-1476, z0 + r + (s - run - arc), Math.PI / 2];
    const d = w(s) - drift * Math.min(1, s / run);
    pts.push({ x: x - d * Math.sin(h), z: z + d * Math.cos(h) });
  }
  return pts;
}

function drawLine(r: number, amp: number, phase: number, drift = 0, times?: number[]) {
  const w = mapWithoutLine();
  const free = [connectorRef(1, 0), connectorRef(1, 1)].find((ref) => w.layout.joinedConnector(ref) === -1)!;
  const e = w.layout.worldConnector(free, createWorldConnector());
  const start: DrawEnd = { x: e.x, z: e.z, heading: e.heading, y: e.y, kind: e.kind };
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const line = new DrawLine(start, drawOptions(w, true));
  for (const p of stroke(r, amp, phase, drift)) {
    const t0 = performance.now();
    line.addPoint(p.x, p.z);
    times?.push(performance.now() - t0);
  }
  line.finish();
  const ids = editor.placeRun(line.placeable());
  // The straight along z −180: how far each straight laid there is off it (mm), and off its way (radians).
  let side = 0;
  let turn = 0;
  for (const id of ids) {
    const p = w.layout.getPiece(id)!;
    if (!p.type.startsWith("straight") || p.pose.x < -1300) continue;
    side = Math.max(side, Math.abs(p.pose.z + 180));
    turn = Math.max(turn, Math.abs(normalizeAngle(2 * p.pose.heading) / 2));
  }
  const types = ids.map((id) => w.layout.getPiece(id)!.type);
  const name = `${types.map((t) => t.replace("straight-", "s").replace("curve-", "")).join(" ")} (${side.toFixed(1)} mm, ${((turn * 180) / Math.PI).toFixed(2)}°)`;
  return { types, closed: line.stopped === "closed", side, turn, name };
}

const BENCH = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DRAW_BENCH;

describe("the player's line from Puddleby into the sawmill (seed 948582)", () => {
  it("the player's stroke: three long straights and the curve twice into the sawmill, closed, the straight not bent", () => {
    // (Main: s216 s216 s216 s108 small large s54, the straights 27.5 mm to the side and 3.59° off.)
    const r = drawLine(70, 6, 4.8, -30);
    expect(r.types, r.name).toEqual(["straight-216", "straight-216", "straight-216", "curve-large", "curve-large"]);
    expect(r.closed, r.name).toBe(true);
    expect(r.side, r.name).toBeLessThan(0.01);
    expect(r.turn, r.name).toBeLessThan(1e-6);
  });

  it("strokes like it (corners of 70 to 250 mm, up to 40 mm to the side): more close, fewer odd pieces, fewer bent straights", () => {
    let n = 0;
    let pieces = 0;
    let open = 0;
    let odd = 0;
    let bent = 0;
    const times: number[] = [];
    for (const r of [70, 100, 130, 160, 190, 220, 250])
      for (const drift of [-40, -25, -10, 0, 10, 25, 40])
        for (const amp of [4, 8])
          for (const phase of [0, 1.7, 3.1]) {
            const q = drawLine(r, amp, phase, drift, times);
            n++;
            pieces += q.types.length;
            if (!q.closed) open++;
            if (q.types.some((t) => !STANDARD_DRAW_TYPES.includes(t))) odd++;
            if (q.side > 2 || q.turn > 0.01) bent++;
          }
    times.sort((a, b) => a - b);
    const at = (f: number) => times[Math.min(times.length - 1, Math.floor(f * times.length))].toFixed(3);
    if (BENCH) console.log(`${n} strokes: ${(pieces / n).toFixed(2)} pieces, ${open} open, ${odd} with odd pieces, ${bent} with the straight bent; addPoint p50 ${at(0.5)} p99 ${at(0.99)} p99.9 ${at(0.999)} max ${at(1)} ms`);
    // Main (a4d7c99): 5.53 pieces, 58 open, 131 with odd pieces, 80 with the straight bent. Now 5.37, 43, 75 and 39.
    expect(open).toBeLessThanOrEqual(48);
    expect(odd).toBeLessThanOrEqual(85);
    expect(bent).toBeLessThanOrEqual(45);
  });

  it("no tree stands on the track: the trees by the line stand clear of it, each at least its clearance from the track", () => {
    // (The two trees that seemed to stand on the straight are ball trees at (−973, −240) and (−1109, −256), where they
    // grew: 53 and 59 mm from the bent straights' middle, their crowns 11 and 17 mm clear of the track's edge. Between
    // the track and the camera, they hide it. Trees aren't planted after the map is made; they step aside from track.)
    const w = deserializeWorld(save);
    if (!w.ok) throw new Error(w.error);
    const { landscape, layout } = w.value;
    const trees = treePlacements(landscape);
    const spots = treesAside(landscape.grid, layout, trees);
    const pts = [...trackPoints(layout).values()].flat();
    let nearest = Infinity;
    for (const t of spots) {
      if (!t) continue;
      for (let i = 0; i < pts.length; i += 2) nearest = Math.min(nearest, Math.hypot(pts[i] - t.x, pts[i + 1] - t.z));
    }
    expect(nearest).toBeGreaterThanOrEqual(TREE_CLEARANCE - 1);
  });
});
