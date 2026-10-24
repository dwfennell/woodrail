import { describe, expect, it } from "vitest";
import { looseHeight } from "../landscape";
import { connectorRef, createWorldConnector, DrawLine, type DrawnPiece } from "../track";
import { drawOptions } from "./draw-testing";
import { createWorld, type World } from "./world";

/**
 * QA (draw-ghost-match, notes 1 and 4): the ghosts (`DrawLine.preview`) were worked out on the line itself and put
 * back after, keeping only some of its state: the fits found not to close, the height the finger was read at, the
 * straight stroke's chord and the caches went through as the preview left them. Now a preview works on a copy of the
 * line, and it's worked out a slice at a time (a pointer move's or a frame's worth), carrying on where it left off.
 *
 * Strokes that close onto stations' and depots' ends (and some that don't): corners into each end from open ground,
 * as in draw-corners, on Sandbox seed 7.
 */

/** A corner stroke into end e: from `run` mm off to the side `side` (±1), a quarter turn of radius r, in along its line and 25 on. */
function corner(e: { x: number; z: number; heading: number }, r: number, side: number, run = 450) {
  const ht = e.heading + Math.PI;
  const [ux, uz] = [Math.cos(ht), Math.sin(ht)];
  const [nx, nz] = [-uz * side, ux * side];
  const ax = e.x - ux * 60, az = e.z - uz * 60;
  const cx = ax + nx * r, cz = az + nz * r;
  const pts: { x: number; z: number }[] = [];
  const sx = ax - ux * r + nx * (r + run), sz = az - uz * r + nz * (r + run);
  const bx = ax - ux * r + nx * r, bz = az - uz * r + nz * r;
  const L = Math.hypot(bx - sx, bz - sz);
  for (let s = 0; s <= L; s += 4) pts.push({ x: sx + ((bx - sx) * s) / L, z: sz + ((bz - sz) * s) / L });
  for (let a = 4 / r; a <= Math.PI / 2; a += 4 / r) pts.push({ x: cx + (-nx * Math.cos(a) - ux * Math.sin(a)) * r, z: cz + (-nz * Math.cos(a) - uz * Math.sin(a)) * r });
  for (let s = 4; s <= 85; s += 4) pts.push({ x: ax + ux * s, z: az + uz * s });
  return pts;
}

const key = (ps: readonly DrawnPiece[]) => ps.map((p) => `${p.type}${p.flipped ? "~" : ""}@${p.pose.x},${p.pose.z},${p.pose.heading},${p.y}${p.blocked ? "!" : ""}`).join(" ");

/** Every corner stroke on seed 7 that stays on the map, with a line to draw it (begun as DrawHand begins one). */
function strokes(): { name: string; pts: { x: number; z: number }[]; line: (w: World) => DrawLine }[] {
  const proto = createWorld(7);
  const ends = [...proto.stations.values(), ...proto.depots.values()].flatMap((id) => [0, 1].map((k) => connectorRef(id, k)));
  const out: ReturnType<typeof strokes> = [];
  for (const ref of ends)
    for (const r of [55, 90, 130])
      for (const side of [1, -1]) {
        const e = proto.layout.worldConnector(ref, createWorldConnector());
        const pts = corner(e, r, side);
        if (pts.some((p) => proto.landscape.grid.cellAtWorld(p.x, p.z) === -1)) continue;
        const o = pts[0];
        let k = 1;
        while (Math.hypot(pts[k].x - o.x, pts[k].z - o.z) < 30) k++;
        const heading = Math.round(Math.atan2(pts[k].z - o.z, pts[k].x - o.x) / (Math.PI / 4)) * (Math.PI / 4);
        const [sx, sz] = [Math.round(o.x / 18) * 18, Math.round(o.z / 18) * 18];
        out.push({
          name: `${ref} r${r} ${side}`,
          pts,
          line: (w) => new DrawLine({ x: sx, z: sz, heading, y: looseHeight(w.landscape, w.layout, "straight-54", false, { x: sx, z: sz, heading }, -1), kind: "peg" }, drawOptions(w, false)),
        });
      }
  return out;
}

describe("a drawn line's ghosts (DrawLine.preview)", () => {
  const all = strokes();

  it("leave the line as it was: drawn with a preview after every move, it lays what it lays with none", () => {
    expect(all.length).toBeGreaterThan(30);
    let differ = 0;
    for (const s of all) {
      const world = createWorld(7);
      const [a, b] = [s.line(world), s.line(world)];
      for (const p of s.pts) {
        a.addPoint(p.x, p.z);
        a.preview();
        b.addPoint(p.x, p.z);
        if (key(a.pieces) !== key(b.pieces)) differ++;
      }
      a.finish();
      b.finish();
      expect(key(a.pieces), s.name).toBe(key(b.pieces));
    }
    expect(differ).toBe(0);
  }, 60_000);

  it("cut into slices come out as worked out whole, and a lift lays them", () => {
    let sliced = 0;
    const cut = DrawLine.cutShort;
    for (const s of all) {
      const world = createWorld(7);
      const [a, b] = [s.line(world), s.line(world)];
      s.pts.forEach((p, i) => {
        a.addPoint(p.x, p.z);
        b.addPoint(p.x, p.z);
        if (i % 3) return;
        // (A slice so short it's a piece at a time.)
        let calls = 0;
        let shown = a.preview(1e-6);
        while (!a.previewDone) {
          shown = a.preview(1e-6);
          calls++;
        }
        if (calls > 0) sliced++;
        expect(key(shown), `${s.name} at ${i}`).toBe(key(b.preview()));
      });
      const ghosts = key(a.preview());
      a.finish();
      expect(key(a.pieces), s.name).toBe(ghosts);
    }
    expect(sliced).toBeGreaterThan(100);
    // (Close searches among them, cut short part way and taken up again on the next slice: QA, one ran whole in a
    // frame, 9.6 to 66.7 ms drawing into a station.)
    expect(DrawLine.cutShort - cut).toBeGreaterThan(10);
  }, 60_000);

  it("while a slice is still being worked out, the last ones worked out are shown, and none is worked out at 0", () => {
    const s = all[0];
    const world = createWorld(7);
    const line = s.line(world);
    for (const p of s.pts.slice(0, 120)) line.addPoint(p.x, p.z);
    const was = line.preview();
    for (const p of s.pts.slice(120, 200)) line.addPoint(p.x, p.z);
    expect(line.previewDone).toBe(false);
    expect(line.preview(0)).toBe(was);
    expect(line.previewDone).toBe(false);
  });
});
