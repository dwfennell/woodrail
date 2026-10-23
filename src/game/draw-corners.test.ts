import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { looseHeight } from "../landscape";
import { connectorRef, createWorldConnector, DrawLine, normalizeAngle } from "../track";
import { drawOptions } from "./draw-testing";
import { createWorld, fixedPieces } from "./world";

/**
 * QA (draw-long-pieces): tight corners drawn from open ground into a station's or depot's end closed with tight curves
 * and the straights bent onto the end (Otterbrook, r55: s216 s216 small~ small~, the straights 1.8° off; the sawmill,
 * r65: 2.6° and 19 mm). A line begun on open ground is free at its start: moved over as it is, standard pieces seat
 * exactly where, as it lay, only a bend or a tight curve did (`DrawLine.shiftOnto`).
 *
 * Every station's and depot's end on Sandbox seed 7, a corner of radius 55 to 130 mm into it from either side, from
 * open ground as DrawHand begins a line, the ghosts shown on the moves. Before: 34 of 46 closed, 31 with pieces bent
 * off the eighths; now 41 closed, none bent.
 *
 * Since the map's ruins (map-sites-2), four of those strokes begin on a ruin's stub, lay nothing and drop out: 37 of
 * 42 close (31 without the move-over), the same closes as before on every stroke left. The ruins are over 400 mm from
 * any end, so nothing crowds the ends; the bar is the old one, 40 of 46, as a share.
 */
const CLOSE_SHARE = 40 / 46;

/** A corner stroke into end e: from `run` mm off to the side `side` (±1), a quarter turn of radius r, in along its line and `over` on. */
function corner(e: { x: number; z: number; heading: number }, r: number, side: number, run = 450, over = 25) {
  const ht = e.heading + Math.PI; // into the end
  const [ux, uz] = [Math.cos(ht), Math.sin(ht)];
  const [nx, nz] = [-uz * side, ux * side];
  // the corner's arc ends at a point `lead` before the end on its line
  const lead = 60;
  const ax = e.x - ux * lead, az = e.z - uz * lead; // arc end
  const cx = ax + nx * r, cz = az + nz * r; // arc centre
  const pts: { x: number; z: number }[] = [];
  const sx = ax - ux * r + nx * (r + run), sz = az - uz * r + nz * (r + run);
  // straight run toward the arc start (ax - u*r + n*r)
  const bx = ax - ux * r + nx * r, bz = az - uz * r + nz * r;
  const L = Math.hypot(bx - sx, bz - sz);
  for (let s = 0; s <= L; s += 4) pts.push({ x: sx + ((bx - sx) * s) / L, z: sz + ((bz - sz) * s) / L });
  for (let a = 4 / r; a <= Math.PI / 2; a += 4 / r) {
    const dx = -nx * Math.cos(a) - ux * Math.sin(a), dz = -nz * Math.cos(a) - uz * Math.sin(a);
    pts.push({ x: cx + dx * r, z: cz + dz * r });
  }
  for (let s = 4; s <= lead + over; s += 4) pts.push({ x: ax + ux * s, z: az + uz * s });
  return pts;
}


describe("QA: tight corners into a station's end from open ground", () => {
  it("close more often, and with no piece bent off the eighths (the line moved over instead)", () => {
    let n = 0;
    let closed = 0;
    const bent: string[] = [];
    const proto = createWorld(7);
    const ends = [...proto.stations.values(), ...proto.depots.values()].flatMap((id) => [0, 1].map((k) => connectorRef(id, k)));
    for (const ref of ends)
      for (const r of [55, 65, 90, 130])
        for (const side of [1, -1]) {
          const world = createWorld(7);
          const e = world.layout.worldConnector(ref, createWorldConnector());
          const pts = corner(e, r, side);
          if (pts.some((p) => world.landscape.grid.cellAtWorld(p.x, p.z) === -1)) continue;
          const o = pts[0];
          let k = 1;
          while (Math.hypot(pts[k].x - o.x, pts[k].z - o.z) < 30) k++;
          const heading = Math.round(Math.atan2(pts[k].z - o.z, pts[k].x - o.x) / (Math.PI / 4)) * (Math.PI / 4);
          const sx = Math.round(o.x / 18) * 18;
          const sz = Math.round(o.z / 18) * 18;
          const y = looseHeight(world.landscape, world.layout, "straight-54", false, { x: sx, z: sz, heading }, -1);
          const line = new DrawLine({ x: sx, z: sz, heading, y, kind: "peg" }, drawOptions(world, false));
          pts.forEach((p, i) => {
            line.addPoint(p.x, p.z);
            if (i % 4 === 3) line.preview();
          });
          line.finish();
          const placed = line.placeable();
          if (!placed.length) continue;
          const fixed = fixedPieces(world);
          new Editor(world.layout, world.sim, () => {}, (id) => fixed.has(id)).placeRun(placed, line.fitted);
          const joined = world.layout.joinedConnector(ref) !== -1;
          const end = placed[placed.length - 1].end;
          if (!joined && Math.hypot(end.x - e.x, end.z - e.z) > 150) continue;
          n++;
          if (joined) closed++;
          const worst = Math.max(...placed.map((p) => Math.abs(normalizeAngle(8 * p.pose.heading) / 8)));
          const name = `${ref} r${r} ${side}: ${placed.map((p) => p.type + (p.flipped ? "~" : "")).join(" ")} ${((worst * 180) / Math.PI).toFixed(2)}°`;
          if (joined && worst > 1e-6) bent.push(name);
        }
    expect(n).toBeGreaterThanOrEqual(40);
    expect(closed / n, `${closed}/${n}`).toBeGreaterThanOrEqual(CLOSE_SHARE);
    expect(bent).toEqual([]);
  }, 60_000);
});
