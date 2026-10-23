import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { inRiver, looseHeight } from "../landscape";
import { connectorRef, createWorldConnector, DrawLine, JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, normalizeAngle, type DrawEnd } from "../track";
import { DrawNotice, UNJOINED_START } from "./draw-notice";
import { drawOptions } from "./draw-testing";
import { createWorld } from "./world";

/**
 * QA: "Draw mode seems to have some troubles connecting to stations". A line drawn over the river and down into
 * Fernhill's west end stopped just short of it, buffers facing. No one piece from where the line had got to landed
 * within the joint's play of the station's end, so the line stopped there (often at a red "The station is in the way"
 * piece), 30 to 140 mm short: further than the editor's near-miss closing reaches, so nothing pulled it shut.
 *
 * Drawn here as DrawHand draws (its options, Sandbox's pieces) and put down through the game's editor, stations and
 * depots fixed. The sweeps say how often a stroke into a station's or depot's end closes (of those that came to it,
 * closed or left facing it): before the fix, the Fernhill strokes over the bridge 64 of 70, strokes into seed 7's ends
 * 312 of 385, station to station 194 of 234; after, 79 of 79, 424 of 432 and 287 of 291; with the bends checked again
 * (a few had bent a curve into a house) and the close made while drawing, 73 of 73, 414 of 429 and 281 of 289.
 *
 * In every sweep, what goes down is what the ghosts showed as the finger lifted (`DrawLine.preview`): before, 944 of
 * the 1,788 strokes, the rest laying more pieces on the lift (714) or moving them (130); now all of them.
 */

/** A smooth stroke from (sx, sz) setting off at `hs` to (tx, tz) arriving at `ht`, then `over` mm on: points 4 mm apart. */
function stroke(sx: number, sz: number, hs: number, tx: number, tz: number, ht: number, over: number): { x: number; z: number }[] {
  const L = Math.hypot(tx - sx, tz - sz);
  const pts: { x: number; z: number }[] = [];
  const n = Math.ceil((L * 1.3) / 4);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const [a, b, c, d] = [2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2];
    pts.push({ x: a * sx + b * L * Math.cos(hs) + c * tx + d * L * Math.cos(ht), z: a * sz + b * L * Math.sin(hs) + c * tz + d * L * Math.sin(ht) });
  }
  for (let o = 4; o <= over; o += 4) pts.push({ x: tx + o * Math.cos(ht), z: tz + o * Math.sin(ht) });
  return pts;
}

type Outcome = "closed" | "open" | "elsewhere";

/**
 * Draw `pts` from `start` on a fresh map of `seed` and put the line down: did it join the end `ref` (closed), stop
 * facing it a little way off (open: the bug), or end somewhere else (a stroke through a town, say: not counted)?
 */
function drawInto(seed: number, ref: number, start: DrawEnd, pts: readonly { x: number; z: number }[], startHeld: boolean) {
  const world = createWorld(seed, true);
  const fixed = new Set([...world.stations.values(), ...world.depots.values()]);
  const homes = new Map([...fixed].map((id) => [id, { ...world.layout.getPiece(id)!.pose }]));
  const editor = new Editor(world.layout, world.sim, () => {}, (id) => fixed.has(id));
  const at = { ...start, y: looseHeight(world.landscape, world.layout, "straight-54", false, start, -1) };
  const line = new DrawLine(at, drawOptions(world, startHeld));
  // (DrawHand shows the ghosts after each move, a few mm of stroke apart: see `DrawLine.preview`.)
  pts.forEach((p, i) => {
    line.addPoint(p.x, p.z);
    if (i % 5 === 4) line.preview();
  });
  // The ghosts as the finger lifts: what goes down must be exactly these (QA: a straight shown at z −846 went down at −900).
  const shown = line.preview();
  const ghosts = shown.slice(0, (shown.findIndex((p) => p.blocked) + 1 || shown.length + 1) - 1).map((p) => ({ type: p.type, flipped: p.flipped, pose: { ...p.pose }, y: p.y }));
  line.finish();
  const placed = line.placeable();
  const describe = `${line.pieces.map((p) => p.type + (p.blocked ? `[${p.blocked}]` : "")).join(" ")} (${line.stopped})`;
  if (placed.length === 0) return { outcome: "elsewhere" as Outcome, describe, world, homes, shift: ghosts.length ? Infinity : 0, clear: true };
  // Every piece passes the checks where it goes down, bent to close or not (QA: a bend wasn't checked again, and could
  // put a curve into a house beside the station).
  const fresh = drawOptions(world, startHeld);
  const clear = placed.every((p, i) => !fresh.check!({ ...p, length: 0 }, placed.slice(0, i)));
  const ids = editor.placeRun(placed, line.fitted);
  // How far what went down is from the ghosts (mm, a degree counted as a mm), or Infinity if not the same pieces.
  let shift = ghosts.length === ids.length ? 0 : Infinity;
  for (let i = 0; i < ids.length && shift < Infinity; i++) {
    const q = world.layout.getPiece(ids[i])!;
    const g = ghosts[i];
    if (q.type !== g.type || q.flipped !== g.flipped || q.y !== g.y) shift = Infinity;
    else shift = Math.max(shift, Math.hypot(q.pose.x - g.pose.x, q.pose.z - g.pose.z), (Math.abs(normalizeAngle(q.pose.heading - g.pose.heading)) * 180) / Math.PI);
  }
  const e = world.layout.worldConnector(ref, createWorldConnector());
  const last = placed[placed.length - 1].end;
  const facing = Math.hypot(last.x - e.x, last.z - e.z) < 150 && Math.abs(normalizeAngle(last.heading - e.heading - Math.PI)) < (12 * Math.PI) / 180;
  const outcome: Outcome = world.layout.joinedConnector(ref) !== -1 ? "closed" : facing ? "open" : "elsewhere";
  return { outcome, describe, world, homes, shift, clear };
}

/** What went down is what the ghosts showed (within 1 mm and 1°, the same pieces), every piece clear where it went. */
function expectAsShown(r: ReturnType<typeof drawInto>, why: string): void {
  expect(r.shift, why).toBeLessThanOrEqual(1);
  expect(r.clear, why).toBe(true);
}

/** Every joint within the joint's play, and the stations and depots where the map put them. */
function expectSnug(r: ReturnType<typeof drawInto>, why: string): void {
  for (const j of r.world.layout.joints()) {
    expect(j.angleError, why).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE + 1e-9);
    expect(j.posError, why).toBeLessThanOrEqual(JOINT_POS_TOLERANCE + 1e-9);
  }
  for (const [id, pose] of r.homes) expect(r.world.layout.getPiece(id)!.pose, why).toEqual(pose);
}

/** Tally of outcomes, and the close rate of the strokes that came to the end (closed or left open). */
function rate(outcomes: readonly Outcome[]): { closed: number; open: number; rate: number } {
  const closed = outcomes.filter((o) => o === "closed").length;
  const open = outcomes.filter((o) => o === "open").length;
  return { closed, open, rate: closed / Math.max(1, closed + open) };
}

describe("QA: drawing into a station's end closes", () => {
  // Seed 21: Fernhill's station at (−864, −900), its west end facing the river about 450 mm off.
  const SEED = 21;
  const fernhill = () => {
    const w = createWorld(SEED, true);
    const id = w.stations.get(w.landscape.towns.findIndex((t) => t.name === "Fernhill"))!;
    return { ref: connectorRef(id, 0), end: w.layout.worldConnector(connectorRef(id, 0), createWorldConnector()) };
  };

  it("over the bridge and down a ramp, a curve into Fernhill's west end: closed, every joint snug (QA's line)", () => {
    const { ref, end } = fernhill();
    expect(end.x).toBe(-864);
    // From the far bank south-west, heading north-east: up a ramp, a bridge, down a ramp, a curve in to the station.
    // (Main: straight-54 ramp bridge ramp curve-wide, then a red straight "The station is in the way", 98 mm short.)
    for (const over of [0, 50])
      for (const off of [0, 9]) {
        const r = drawInto(SEED, ref, { x: -1548, z: -396, heading: -Math.PI / 4, y: 0, kind: "peg" }, stroke(-1548, -396, -Math.PI / 4, end.x, end.z + off, 0, over), false);
        const why = `${off} mm off, ${over} mm on: ${r.describe}`;
        expect(r.describe, why).toMatch(/bridge/);
        expect(r.outcome, why).toBe("closed");
        expectSnug(r, why);
        expectAsShown(r, why);
      }
  });

  it("strokes over the river into Fernhill's west end from all round the far bank: at least 97% close (91% before)", () => {
    const { ref, end } = fernhill();
    const land = createWorld(SEED, true).landscape;
    const outcomes: Outcome[] = [];
    const left: string[] = [];
    for (let sx = -2052; sx <= -1404; sx += 36)
      for (let sz = -1404; sz <= -396; sz += 72) {
        if (land.grid.cellAtWorld(sx, sz) === -1 || inRiver(land.grid, sx, sz)) continue;
        const hs = Math.round(Math.atan2(end.z - sz, end.x - sx) / (Math.PI / 4)) * (Math.PI / 4);
        for (const off of [0, 9]) {
          const r = drawInto(SEED, ref, { x: sx, z: sz, heading: hs, y: 0, kind: "peg" }, stroke(sx, sz, hs, end.x, end.z + off, 0, 0), false);
          // (Only the lines that went over the river.)
          if (!/bridge/.test(r.describe)) continue;
          expectAsShown(r, r.describe);
          outcomes.push(r.outcome);
          if (r.outcome === "open") left.push(`(${sx}, ${sz}) ${off}: ${r.describe}`);
          if (r.outcome === "closed") expectSnug(r, r.describe);
        }
      }
    const t = rate(outcomes);
    expect(t.closed + t.open).toBeGreaterThan(60);
    expect(t.rate, `${t.closed}/${t.closed + t.open}\n${left.join("\n")}`).toBeGreaterThanOrEqual(0.97);
  }, 120_000);

  it("plain strokes into each station's and depot's end on seed 7, at several angles and offsets: at least 95% close (81% before)", () => {
    const proto = createWorld(7, true);
    const ends = [...proto.stations.values(), ...proto.depots.values()].flatMap((id) => [0, 1].map((i) => connectorRef(id, i)));
    const outcomes: Outcome[] = [];
    const left: string[] = [];
    for (const ref of ends) {
      const e = proto.layout.worldConnector(ref, createWorldConnector());
      for (const theta of [0, 15, -15, 30, -30])
        // (The line's start a little off the grid's eighths, as it is from track that has taken up joint play.)
        for (const dh of [0, 1.5, -3])
          for (const off of [0, 10])
            for (const over of [0, 60]) {
              const a = e.heading + (theta * Math.PI) / 180;
              const sx = Math.round((e.x + 620 * Math.cos(a)) / 18) * 18 + (dh ? 5 : 0);
              const sz = Math.round((e.z + 620 * Math.sin(a)) / 18) * 18 + (dh ? 3 : 0);
              if (proto.landscape.grid.cellAtWorld(sx, sz) === -1) continue;
              const hs = Math.round((a + Math.PI) / (Math.PI / 4)) * (Math.PI / 4) + (dh * Math.PI) / 180;
              const tx = e.x - off * Math.sin(e.heading);
              const tz = e.z + off * Math.cos(e.heading);
              const r = drawInto(7, ref, { x: sx, z: sz, heading: hs, y: 0, kind: "peg" }, stroke(sx, sz, hs, tx, tz, e.heading + Math.PI, over), false);
              outcomes.push(r.outcome);
              expectAsShown(r, `end ${ref} at ${theta}°, ${dh}° off, ${off} mm, ${over} mm on: ${r.describe}`);
              const why = `end ${ref} at ${theta}°, ${dh}° off, ${off} mm, ${over} mm on: ${r.describe}`;
              if (r.outcome === "open") left.push(why);
              if (r.outcome === "closed") expectSnug(r, why);
            }
    }
    const t = rate(outcomes);
    expect(t.closed + t.open).toBeGreaterThan(200);
    expect(t.rate, `${t.closed}/${t.closed + t.open}\n${left.join("\n")}`).toBeGreaterThanOrEqual(0.95);
  }, 120_000);

  it("station to station (and depot), the line held at both ends: at least 97% close (83% before)", () => {
    const outcomes: Outcome[] = [];
    const left: string[] = [];
    for (const seed of [7, 21, 16, 41]) {
      const proto = createWorld(seed, true);
      const ends = [...proto.stations.values(), ...proto.depots.values()].flatMap((id) => [0, 1].map((i) => ({ id, ref: connectorRef(id, i), e: proto.layout.worldConnector(connectorRef(id, i), createWorldConnector()) })));
      for (const A of ends)
        for (const B of ends) {
          const d = Math.hypot(A.e.x - B.e.x, A.e.z - B.e.z);
          if (A.id === B.id || d < 300 || d > 1800) continue;
          const ab = Math.atan2(B.e.z - A.e.z, B.e.x - A.e.x);
          if (Math.cos(ab - A.e.heading) < 0.2 || Math.cos(ab + Math.PI - B.e.heading) < 0.2) continue;
          for (const off of [0, 8, -8, 16])
            for (const over of [0, 60]) {
              const tx = B.e.x - off * Math.sin(B.e.heading);
              const tz = B.e.z + off * Math.cos(B.e.heading);
              const r = drawInto(seed, B.ref, { x: A.e.x, z: A.e.z, heading: A.e.heading, y: A.e.y, kind: A.e.kind }, stroke(A.e.x, A.e.z, A.e.heading, tx, tz, B.e.heading + Math.PI, over), true);
              outcomes.push(r.outcome);
              expectAsShown(r, `seed ${seed}, ${A.ref} to ${B.ref}, ${off} mm, ${over} mm on: ${r.describe}`);
              const why = `seed ${seed}, ${A.ref} to ${B.ref}, ${off} mm, ${over} mm on: ${r.describe}`;
              if (r.outcome === "open") left.push(why);
              if (r.outcome === "closed") expectSnug(r, why);
            }
        }
    }
    const t = rate(outcomes);
    expect(t.closed + t.open).toBeGreaterThan(150);
    expect(t.rate, `${t.closed}/${t.closed + t.open}\n${left.join("\n")}`).toBeGreaterThanOrEqual(0.97);
  }, 120_000);

  it("a bend that would put a piece into a house beside the station isn't made (QA: bends weren't checked again)", () => {
    // Seed 7, Larkfield's east end, from 30° off its line: the line's best fit bends its wide curve into a house (main
    // put it down so: s216 s54 s54 wide s108, the curve refused "That's a house" where it went); now that bend is
    // refused, and what goes down is clear.
    const proto = createWorld(7, true);
    const ref = 9;
    const e = proto.layout.worldConnector(ref, createWorldConnector());
    expect([e.x, e.z]).toEqual([-432, 108]);
    const a = e.heading + Math.PI / 6;
    const sx = Math.round((e.x + 620 * Math.cos(a)) / 18) * 18;
    const sz = Math.round((e.z + 620 * Math.sin(a)) / 18) * 18;
    const hs = Math.round((a + Math.PI) / (Math.PI / 4)) * (Math.PI / 4);
    const r = drawInto(7, ref, { x: sx, z: sz, heading: hs, y: 0, kind: "peg" }, stroke(sx, sz, hs, e.x, e.z, e.heading + Math.PI, 0), false);
    expect(r.clear, r.describe).toBe(true);
    expectAsShown(r, r.describe);
  });

  it("a line left facing a station's end it couldn't join says why", () => {
    const n = new DrawNotice((t) => `Out of ${t}`, (t) => t);
    const say = n.unjoined("the station");
    expect(say.startsWith(UNJOINED_START)).toBe(true);
    expect(say).toMatch(/the station: no pieces fit the gap/);
  });
});
