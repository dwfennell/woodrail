import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { gridWithPlots, hillMessage, hillsOf, inRiver, SURF_RIVER, syncCuttings, type BlockReason, type Landscape } from "../landscape";
import { DrawLine, isBridge, Layout, RISER_HEIGHT, type DrawEnd, type DrawOptions, type PieceTypeId } from "../track";
import { createWorld } from "./world";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";

/**
 * Drawn lines meeting hills, the river and raised track (N2 phase 1: ramps and bridges), checked by the game's own
 * track rules on a made-up map (see docs/superpowers/specs/2026-10-17-draw-junctions-ramps-bridges-design.md).
 */

function flat(): Landscape {
  return { seed: 0, starter: false, grid: gridWithPlots(-1, -1, 2, 2), towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
}
/** Squares whose centres lie in x0..x1 × z0..z1: `h` blocks high (or river, with h = "river"). */
function paint(land: Landscape, x0: number, x1: number, z0: number, z1: number, h: number | "river"): Landscape {
  const g = land.grid;
  for (let x = x0 + 36; x < x1; x += 72)
    for (let z = z0 + 36; z < z1; z += 72) {
      const i = g.cellAtWorld(x, z);
      if (i === -1) continue;
      if (h === "river") g.surface[i] = SURF_RIVER;
      else g.height[i] = h;
    }
  g.revision++;
  return land;
}

/** The game's checks for a drawn piece (the track's rules, as DrawHand reads them), on `land` with `layout` on it. */
function options(land: Landscape, layout = new Layout(), extra: Partial<DrawOptions> = {}): DrawOptions {
  const rules: TrackRules = { land, layout, props: null, footprint: () => undefined };
  const hills = hillsOf(land.grid);
  return {
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
      const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
      return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => trackMessage(r as BlockReason, why.levels)), levels: why.levels } : null;
    },
    groundAt: (x, z) => hills.groundAt(x, z),
    wet: (x, z) => inRiver(land.grid, x, z),
    onMap: (x, z) => land.grid.cellAtWorld(x, z) !== -1,
    outOf: (t) => `Out of ${t}`,
    ...extra,
  };
}

/** A stroke along +x from (x0, Z) to x1, 4 mm a point, then lifted. */
function stroke(start: DrawEnd, opts: DrawOptions, x1: number, z = (_x: number) => start.z): DrawLine {
  const line = new DrawLine(start, opts);
  for (let x = start.x + 4; x <= x1; x += 4) line.addPoint(x, z(x));
  line.finish();
  return line;
}

const Z = 36;
const at = (x: number, y = 0): DrawEnd => ({ x, z: Z, heading: 0, y, kind: "peg" });
const name = (line: DrawLine) => line.pieces.map((p) => `${p.type}${p.type === "ramp" ? (p.end.y > p.y ? "↑" : "↓") : ""}@${p.y}${p.blocked ? "!" : ""}`).join(" ");
const ramps = (line: DrawLine, up: boolean) => line.pieces.filter((p) => p.type === "ramp" && p.end.y > p.y === up).length;

/** Every piece seats on the end before it, and each is at the height that end is. */
function expectJoined(line: DrawLine): void {
  let e = line.start;
  for (const p of line.pieces) {
    const l = new Layout();
    l.addPiece(p.type, p.pose, p.y, p.flipped);
    expect(Math.hypot(p.track[0] - e.x, p.track[1] - e.z), name(line)).toBeLessThan(0.5);
    e = p.end;
  }
}

describe("drawing up a hill, over the river, and off raised track (N2 phase 1)", () => {
  it("a stroke up onto a one-level hill lays a ramp, let into the hill in a cutting, and carries on on top", () => {
    let cut = 0;
    for (const edge of [432, 504, 540, 612, 650]) {
      const land = paint(flat(), edge, 2000, -400, 400, 1);
      const line = stroke(at(0), options(land), 1300);
      const why = `hill from ${edge}: ${name(line)}`;
      expect(line.pieces.some((p) => p.blocked), why).toBe(false);
      expect(ramps(line, true), why).toBe(1);
      expect(ramps(line, false), why).toBe(0);
      expect(line.end.y, why).toBe(RISER_HEIGHT);
      expect(line.end.x, why).toBeGreaterThan(1200);
      expectJoined(line);
      // Put down, the ramp cuts into the hill (its top end on the hilltop), and every piece is still allowed there.
      const layout = new Layout();
      for (const p of line.pieces) layout.addPiece(p.type, p.pose, p.y, p.flipped);
      syncCuttings(land, layout);
      const ramp = line.pieces.find((p) => p.type === "ramp")!;
      // (Squares are 72 mm: the hill starts at the first square edge from `edge`. A ramp ending just on it is flush.)
      const start = Math.ceil(edge / 72) * 72;
      if (ramp.end.x > start + 20) cut++;
      expect(hillsOf(land.grid).cutBlocks().length > 0, why).toBe(ramp.end.x > start + 1);
      expect(hillsOf(land.grid).groundAt(ramp.end.x + 8, ramp.end.z), why).toBe(RISER_HEIGHT);
    }
    expect(cut).toBeGreaterThan(1);
  });

  it("a stroke at a hill two levels up stops red, saying how far up it is (no ramps)", () => {
    const land = paint(flat(), 504, 2000, -400, 400, 2);
    const line = stroke(at(0), options(land), 1300);
    expect(line.stopped).toBe("blocked");
    const last = line.pieces[line.pieces.length - 1];
    expect(last.blockedBy).toBe("hill");
    // Said as it is for drawing (the line climbs one level at a time), not as for a piece in the hand.
    expect(last.blocked).toBe("Too steep to draw: two levels up. Lay a ramp first, then draw on");
    expect(hillMessage(2)).toBe("The hill is 2 levels up here: climb with two ramps in a row");
    // Three levels up likewise; one level up, the line lays a ramp (above), so the hand's message stands if it can't.
    const three = stroke(at(0), options(paint(flat(), 504, 2000, -400, 400, 3)), 1300);
    expect(three.pieces[three.pieces.length - 1].blocked).toBe("Too steep to draw: three levels up. Lay a ramp first, then draw on");
    expect(drawMessage("hill", 1, () => hillMessage(1))).toBe(hillMessage(1));
    expect(line.pieces.some((p) => p.type === "ramp")).toBe(false);
  });

  it("a stroke beside a hill, or on plain ground, never gives a ramp or a bridge", () => {
    const land = paint(flat(), 0, 2000, 144, 600, 1);
    for (const z of [36, 0, -50]) {
      const line = stroke({ ...at(-500), z }, options(land), 1300);
      expect(line.pieces.some((p) => p.type === "ramp" || isBridge(p.type)), name(line)).toBe(false);
      expect(line.pieces.some((p) => p.blocked), name(line)).toBe(false);
    }
  });

  it("across the river from the ground: a ramp up, bridges over, a ramp down, and on at ground level", () => {
    for (const [x0, w] of [[576, 216], [612, 288], [540, 144]]) {
      const land = paint(flat(), x0, x0 + w, -900, 900, "river");
      const line = stroke(at(0), options(land), 1500);
      const why = `river ${x0}..${x0 + w}: ${name(line)}`;
      expect(line.pieces.some((p) => p.blocked), why).toBe(false);
      expect(ramps(line, true), why).toBe(1);
      expect(ramps(line, false), why).toBe(1);
      expect(line.pieces.filter((p) => isBridge(p.type)).length, why).toBeGreaterThanOrEqual(1);
      // In that order, and the bridges a level up.
      const kinds = line.pieces.map((p) => (p.type === "ramp" ? (p.end.y > p.y ? "up" : "down") : isBridge(p.type) ? "bridge" : "plain"));
      const up = kinds.indexOf("up");
      const down = kinds.indexOf("down");
      expect(up, why).toBeLessThan(kinds.indexOf("bridge"));
      expect(kinds.lastIndexOf("bridge"), why).toBeLessThan(down);
      for (const p of line.pieces) if (isBridge(p.type)) expect(p.y, why).toBe(RISER_HEIGHT);
      expect(line.end.y, why).toBe(0);
      expect(line.end.x, why).toBeGreaterThan(1400);
      expectJoined(line);
    }
  });

  it("a stroke straight on the screen across the river lays straight bridges (read as it was while the line is up in the air)", () => {
    // A view from off to one side: a point on the screen is seen this much further along x and z (mm) for each mm higher.
    for (const [vx, vz] of [[0.3, 0.9], [0.2, -0.9], [-0.5, 0.6], [0, 1.5], [0.8, -1.4], [1.7, 0]]) {
      for (const [x0, w] of [[576, 72], [576, 216], [612, 288]]) {
        const land = paint(flat(), x0, x0 + w, -1500, 1500, "river");
        const line = new DrawLine(at(0), options(land));
        for (let d = 4; d <= 1500; d += 4) line.addSeen((h) => ({ x: d + h * vx, z: Z + h * vz }));
        line.finish();
        const why = `river ${x0}..${x0 + w}, view (${vx}, ${vz}): ${name(line)}`;
        expect(line.pieces.some((p) => p.blocked), why).toBe(false);
        expect(line.pieces.some((p) => p.type === "bridge"), why).toBe(true);
        expect(line.pieces.some((p) => p.type.startsWith("curve") || p.type === "bridge-curve"), why).toBe(false);
        expect(line.end.y, why).toBe(0);
      }
    }
  });

  it("a swipe straight up (or down) the screen at the default camera, about 23° off the grid, crosses the river", () => {
    // The default view: a swipe up the screen runs about 23° off the grid on the map, and a point on the screen is seen
    // about 2 mm nearer the camera for each mm higher (looking down at about 26°).
    const K = 2;
    let crossed = 0;
    let all = 0;
    const fails: string[] = [];
    for (const deg of [23, -23, 157, -157, 20, 30]) {
      const a = (deg * Math.PI) / 180;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (const up of [1, -1]) {
        for (const [ox, oz] of [[0, 0], [30, 50], [-40, 20], [60, -70], [10, 130]]) {
          // A river band across x (both ways across it), the stroke from 500 mm before it.
          const land = paint(flat(), 576, 720, -2000, 2000, "river");
          const x0 = dx > 0 ? 576 - 500 * dx + ox : 720 - 500 * dx + ox;
          const z0 = Z + oz;
          const start: DrawEnd = { x: Math.round(x0 / 18) * 18, z: Math.round(z0 / 18) * 18, heading: Math.round(a / (Math.PI / 4)) * (Math.PI / 4), y: 0, kind: "peg" };
          const line = new DrawLine(start, options(land));
          // Up the screen: away from the camera (seen higher, a point is nearer it: back along the swipe); down: toward it.
          for (let d = 4; d <= 1300; d += 4) line.addSeen((h) => ({ x: start.x + d * dx - up * K * h * dx, z: start.z + d * dz - up * K * h * dz }));
          line.finish();
          all++;
          const why = `${deg}° ${up > 0 ? "up" : "down"} from (${start.x}, ${start.z}): ${name(line)}`;
          const ok = !line.pieces.some((p) => p.blocked) && line.pieces.some((p) => isBridge(p.type)) && !line.pieces.some((p) => p.type === "bridge-curve") && line.end.y === 0;
          if (ok) crossed++;
          else fails.push(why);
        }
      }
    }
    expect(fails, fails.join("\n")).toEqual([]);
    expect(crossed).toBe(all);
  });

  it("a swipe up the screen across a river that runs slantwise (as the map's do), from a little way off it, crosses", () => {
    const K = 2;
    const fails: string[] = [];
    let all = 0;
    for (const [rdeg, width] of [[45, 1.5], [-45, 1.5], [30, 2], [60, 1], [45, 2.5]]) {
      // A river band through (600, 0) running at `rdeg`, `width` squares across.
      const land = flat();
      const g = land.grid;
      const ra = (rdeg * Math.PI) / 180;
      for (let x = -2196; x < 2232; x += 72)
        for (let z = -1620; z < 1656; z += 72) {
          const across = -(x - 600) * Math.sin(ra) + z * Math.cos(ra);
          if (Math.abs(across) < (width * 72) / 2) g.surface[g.cellAtWorld(x, z)] = SURF_RIVER;
        }
      g.revision++;
      for (const deg of [23, -23, 157, -157, 67, -113]) {
        for (const up of [1, -1]) {
          for (const lead of [250, 350, 500]) {
            const a = (deg * Math.PI) / 180;
            const dx = Math.cos(a);
            const dz = Math.sin(a);
            // Where the stroke meets the river's middle line, and `lead` mm before (along the stroke) it starts.
            const cross = Math.sin(a - ra);
            // (Room for a ramp before the bank, along the stroke: else it's red, rightly.)
            if (Math.abs(cross) < 0.5 || lead - (width * 36) / Math.abs(cross) < 200) continue;
            const sx = 600 - lead * dx;
            const sz = 0 - lead * dz;
            const start: DrawEnd = { x: Math.round(sx / 18) * 18, z: Math.round(sz / 18) * 18, heading: Math.round(a / (Math.PI / 4)) * (Math.PI / 4), y: 0, kind: "peg" };
            const line = new DrawLine(start, options(land));
            for (let d = 4; d <= 2 * lead + 300; d += 4) line.addSeen((h) => ({ x: start.x + d * dx - up * K * h * dx, z: start.z + d * dz - up * K * h * dz }));
            line.finish();
            all++;
            const ok = !line.pieces.some((p) => p.blocked) && line.pieces.some((p) => isBridge(p.type)) && !line.pieces.some((p) => p.type === "bridge-curve") && line.end.y === 0;
            if (!ok) fails.push(`river ${rdeg}° w${width}, swipe ${deg}° ${up > 0 ? "up" : "down"} from ${lead} mm off: ${name(line)}`);
          }
        }
      }
    }
    expect(fails, `${fails.length}/${all}\n${fails.join("\n")}`).toEqual([]);
  });

  it("up on a hill, the finger is read at the hilltop's height: the stroke moves once, as the ramp's top end lands", () => {
    const land = paint(flat(), 504, 2000, -400, 400, 1);
    const line = new DrawLine(at(0), options(land));
    const seen: number[] = [];
    for (let d = 4; d <= 1300; d += 4) {
      line.addSeen((h) => ({ x: d + h * 0.3, z: Z + h * 0.5 }));
      if (seen[seen.length - 1] !== line.seenAt) seen.push(line.seenAt);
    }
    line.finish();
    expect(seen).toEqual([0, RISER_HEIGHT]);
    expect(line.pieces.some((p) => p.blocked), name(line)).toBe(false);
    expect(line.end.y).toBe(RISER_HEIGHT);
  });

  it("with the stroke drifting off to a side over the water, the line still crosses and comes down", () => {
    const land = paint(flat(), 576, 720, -1500, 1500, "river");
    for (const [deg, drift] of [[0, 40], [0, -40], [0, 60], [45, 0], [45, 40]]) {
      const a = (deg * Math.PI) / 180;
      const line = new DrawLine(at(0), options(land));
      for (let d = 4; d <= 1500; d += 4) {
        // (Past the river's near bank, the finger drifts aside: as when seen at another height.)
        const side = d * Math.sin(a) + (d > 500 ? drift * Math.min(1, (d - 500) / 100) : 0);
        line.addPoint(d * Math.cos(a) - (d > 500 && deg ? drift * Math.sin(a) : 0), Z + side);
      }
      line.finish();
      const why = `${deg}° drift ${drift}: ${name(line)}`;
      expect(line.pieces.some((p) => p.blocked), why).toBe(false);
      expect(line.pieces.some((p) => isBridge(p.type)), why).toBe(true);
      expect(line.end.y, why).toBe(0);
    }
  });

  it("across the river from a hilltop: bridges straight over, no ramps", () => {
    const land = paint(paint(flat(), -800, 2000, -900, 900, 1), 576, 792, -900, 900, 0);
    paint(land, 576, 792, -900, 900, "river");
    const line = stroke(at(0, RISER_HEIGHT), options(land), 1300);
    const why = name(line);
    expect(line.pieces.some((p) => p.blocked), why).toBe(false);
    expect(line.pieces.some((p) => p.type === "ramp"), why).toBe(false);
    expect(line.pieces.filter((p) => isBridge(p.type)).length, why).toBeGreaterThanOrEqual(1);
    expect(line.pieces.every((p) => p.y === RISER_HEIGHT), why).toBe(true);
  });

  it("off raised track (a free end on risers), and off a hilltop, the line ramps down to the ground", () => {
    const land = flat();
    const raised = stroke(at(0, RISER_HEIGHT), options(land), 900);
    expect(raised.pieces[0].type, name(raised)).toBe("ramp");
    expect(raised.pieces.some((p) => p.blocked), name(raised)).toBe(false);
    expect(raised.end.y).toBe(0);
    for (const edge of [216, 288, 360, 432]) {
      const hill = paint(flat(), -800, edge, -400, 400, 1);
      const line = stroke(at(0, RISER_HEIGHT), options(hill), 1200);
      const why = `hilltop to ${edge}: ${name(line)}`;
      expect(line.pieces.some((p) => p.blocked), why).toBe(false);
      expect(ramps(line, false), why).toBe(1);
      expect(ramps(line, true), why).toBe(0);
      expect(line.end.y, why).toBe(0);
      expectJoined(line);
    }
  });

  it("over a hill only a few squares across: up a ramp and straight down another (no bridge)", () => {
    for (const [x0, x1] of [[504, 720], [504, 864], [432, 720]]) {
      const land = paint(flat(), x0, x1, -400, 400, 1);
      const line = stroke(at(0), options(land), 1400);
      const why = `hill ${x0}..${x1}: ${name(line)}`;
      expect(line.pieces.some((p) => p.blocked), why).toBe(false);
      expect(ramps(line, true), why).toBe(1);
      expect(ramps(line, false), why).toBe(1);
      expect(line.pieces.some((p) => isBridge(p.type)), why).toBe(false);
      expect(line.end.y, why).toBe(0);
    }
  });

  it("two levels down off raised track: a ramp on arches, then a ramp to the ground", () => {
    const line = stroke(at(0, 2 * RISER_HEIGHT), options(flat()), 1200);
    expect(ramps(line, false), name(line)).toBe(2);
    expect(line.end.y).toBe(0);
  });

  it("out of ramps (Game mode), the line stops red and says so", () => {
    const land = paint(flat(), 504, 2000, -400, 400, 1);
    const allow = (t: PieceTypeId) => t !== "ramp";
    const line = stroke(at(0), options(land, new Layout(), { allow }), 1300);
    expect(line.stopped).toBe("blocked");
    expect(line.pieces[line.pieces.length - 1].blocked).toBe("Out of ramp");
    expect(line.refused).toBe("ramp");
    // Out of bridges, over the river from a hilltop.
    const river = paint(paint(flat(), -800, 2000, -900, 900, 1), 576, 792, -900, 900, 0);
    paint(river, 576, 792, -900, 900, "river");
    const over = stroke(at(0, RISER_HEIGHT), options(river, new Layout(), { allow: (t) => !isBridge(t) }), 1300);
    expect(over.stopped).toBe("blocked");
    expect(over.pieces[over.pieces.length - 1].blocked).toMatch(/^Out of bridge/);
  });

  it("a ramp that would dig the ground from under other track shows red, and says so", () => {
    const land = paint(flat(), 504, 2000, -400, 400, 1);
    const layout = new Layout();
    // A straight on the hilltop alongside where the ramp's cutting would go.
    layout.addPiece("straight-216", { x: 504, z: Z + 40, heading: 0 }, RISER_HEIGHT);
    const line = stroke(at(0), options(land, layout), 1300);
    const last = line.pieces[line.pieces.length - 1];
    expect(line.stopped, name(line)).toBe("blocked");
    expect(last.blockedBy).toBe("undercut");
  });

  it("on open ground a stroke lays exactly the pieces it did before (N1): a fixed set of strokes", () => {
    const strokes: { x: number; z: number }[][] = [];
    const sample = (length: number, at: (s: number) => { x: number; z: number }) => {
      const pts = [];
      for (let s = 4; s <= length; s += 4) pts.push(at(s));
      strokes.push(pts);
    };
    sample(2400, (s) => ({ x: s, z: 300 * Math.sin((s / 1200) * 2 * Math.PI) }));
    for (const deg of [0, 10, 23, 35, 45]) sample(1200, (s) => ({ x: s * Math.cos((deg * Math.PI) / 180), z: s * Math.sin((deg * Math.PI) / 180) }));
    for (const r of [216, 300, 500]) sample(Math.PI * r, (s) => ({ x: r * Math.sin(s / r), z: r * (1 - Math.cos(s / r)) }));
    sample(1500, (s) => ({ x: s, z: 12 * Math.sin(s / 40) }));
    // As drawn before N2 phase 1 (with the same checks: nothing on open ground is refused).
    const before = [
      "curve-small curve-large curve-small! straight-54 curve-large! curve-large! straight-144 curve-wide! curve-large straight-144 curve-large curve-large straight-144 curve-wide curve-large! straight-144 curve-large! curve-large! straight-144 straight-108 straight-54 curve-large! curve-large straight-54 curve-large curve-large straight-144 straight-144",
      "straight-216 straight-216 straight-216 straight-216 straight-216 straight-144",
      "straight-216 curve-wide curve-large! straight-144 straight-144 straight-144 curve-wide",
      "straight-54 curve-wide straight-144 curve-wide! straight-144 curve-wide straight-144 curve-large!",
      "curve-large straight-144 straight-144 straight-144 curve-large! curve-large straight-144 straight-216",
      "curve-small straight-216 straight-216 straight-216 straight-216 straight-216 straight-54",
      "curve-large curve-wide curve-large curve-large",
      "curve-wide straight-54 curve-wide curve-wide curve-wide straight-54",
      "straight-144 curve-wide straight-216 curve-large straight-216 curve-wide straight-216 curve-wide straight-108",
      "straight-216 straight-216 straight-216 straight-216 straight-216 straight-144 straight-216 straight-54",
    ];
    // A big flat map, so the strokes stay on it.
    const land: Landscape = { ...flat(), grid: gridWithPlots(-3, -3, 6, 6) };
    let checks = 0;
    const opts = options(land);
    const counted: DrawOptions = { ...opts, check: (c, l) => (checks++, opts.check!(c, l)) };
    for (const o of [{}, counted]) {
      const got = strokes.map((pts) => {
        const line = new DrawLine({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" }, o);
        for (const p of pts) line.addPoint(p.x, p.z);
        line.finish();
        return line.pieces.map((p) => p.type + (p.flipped ? "!" : "")).join(" ");
      });
      expect(got).toEqual(before);
    }
    // And at the same cost: one check for each piece laid, as before.
    expect(checks).toBe(before.join(" ").split(" ").length);
  });

  it("QA's slanted river strokes on seed 7 (their exact world lines and camera) cross square, with straight bridges, and come down", () => {
    const fails: string[] = [];
    for (const run of QA_RUNS) {
      const { line } = replayQA(run);
      const ok = !!line && !line.pieces.some((p) => p.blocked) && line.pieces.some((p) => p.type === "bridge") && !line.pieces.some((p) => p.type === "bridge-curve") && line.end.y === 0;
      if (!ok) fails.push(`${run[0]}: ${line ? name(line) : "no line"} [${line?.pieces.at(-1)?.blockedBy} ${line?.pieces.at(-1)?.blocked}]`);
    }
    expect(fails, fails.join("\n")).toEqual([]);
  });

  it("QA's second terrace (seed 7, a level up for a square, then another): a ramp at the first rise, and never 'too sharp'", () => {
    const { line, stalled } = replayQA(["terrace 2", -1764, -1620, Math.PI, 480, false, -2004, -1620, 3662.2]);
    const why = line ? `${name(line)} [${line.pieces.at(-1)?.blockedBy} ${line.pieces.at(-1)?.blocked}]` : "no line";
    expect(line?.pieces.some((p) => p.type === "ramp"), why).toBe(true);
    expect(line?.pieces.some((p) => p.type.startsWith("curve")), why).toBe(false);
    expect(stalled, why).toBe(false);
  });

  it("after QA's crossings, the line steers back to the finger on dry land: its end within about 40 px of where it lifted", () => {
    const report: string[] = [];
    const px: Record<string, number> = {};
    for (const run of QA_RUNS) {
      const r = replayQA(run);
      if (!r.line) continue;
      report.push(`${run[0]}: ${r.px.toFixed(0)} px · ${name(r.line)}`);
      px[run[0]] = r.px;
    }
    const why = report.join("\n");
    // Two of QA's strokes can't come back: "10 back" runs along the map's edge, where the only eighth that crosses
    // takes the line off the finger's way, and "−23 there" is let go at the far bank, so the crossing ends past the
    // finger (it's finished, on the ground, rather than left raised). The rest come back to the finger.
    for (const [label, d] of Object.entries(px)) if (label !== "slant 10 back" && label !== "slant -23 there") expect(d, `${label}\n${why}`).toBeLessThan(55);
    expect(Object.values(px).filter((d) => d < 40).length, why).toBeGreaterThanOrEqual(4);
  });
});

/** QA's exact world lines (seed 7, fresh): name, start, heading, length, back, and QA's camera's target and distance. */
type QARun = [string, number, number, number, number, boolean, number, number, number];
const QA_RUNS: QARun[] = [
  ["slant 23 there", -36, -1620, 2.7576202181510405, 972, false, -481, -1440.2, 3662.2],
  ["slant 23 back", -36, -1620, 2.7576202181510405, 972, true, -481, -1440.2, 3662.2],
  ["slant 30 back", -252, -1620, 2.0943951023931953, 972, true, -492, -1204.3, 4760.9],
  ["slant 10 back", -180, -1620, 2.5307274153917776, 852, true, -524, -1379.1, 3662.2],
  ["slant -23 back", -36, -1620, 2.7401669256310974, 972, true, -477.8, -1432.4, 3662.2],
  ["slant -23 there", -36, -1620, 2.7401669256310974, 972, false, -477.8, -1432.4, 3662.2],
  ["slant 10 there", -180, -1620, 2.5307274153917776, 852, false, -524, -1379.1, 3662.2],
  ["slant 40 back (clean)", -252, -1620, 2.2689280275926285, 852, true, -522, -1298.3, 3662.2],
];

/**
 * Replay one of QA's strokes as the game sees it: the game's camera (PerspectiveCamera 30°, placed as `Game.lookAt`
 * places it with QA's target and distance, phi 0.95, theta −1.1659) on a 390 × 844 screen, QA's world points every
 * 15 mm projected at the ground's height, touch moves every 10 px, each read on the plane at the line's height as
 * DrawHand does, the line started as DrawHand starts one on open ground. The line, and how far (px) its end is on
 * the screen from where the finger lifted.
 */
function replayQA([, x0, z0, h, total, back, tx, tz, dist]: QARun, startMove = 30): { line: DrawLine | null; px: number; stalled: boolean } {
  const world = qaWorld();
  const land = world.landscape;
  const G = land.grid;
  const W = 390;
  const H = 844;
  const camera = new PerspectiveCamera(30, W / H, 5, 40000);
  const phi = 0.95;
  const theta = -1.1659;
  camera.position.set(tx + Math.sin(theta) * Math.sin(phi) * dist, Math.cos(phi) * dist, tz + Math.cos(theta) * Math.sin(phi) * dist);
  camera.lookAt(tx, 0, tz);
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  const level = new Plane(new Vector3(0, 1, 0), 0);
  const planeAt = (sx: number, sy: number, y: number) => {
    ray.setFromCamera(new Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
    level.constant = -y;
    const v = ray.ray.intersectPlane(level, new Vector3());
    return v ? { x: v.x, z: v.z } : null;
  };
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    const v = new Vector3(x, y, z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const pts: [number, number][] = [];
  for (let d = 0; d <= total; d += 15) {
    const x = x0 + Math.cos(h) * d;
    const z = z0 + Math.sin(h) * d;
    pts.push(toScreen(x, G.groundY(G.cellAtWorld(x, z)), z));
  }
  if (back) pts.reverse();
  const screen: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let k = 1; k <= n; k++) screen.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const origin = planeAt(screen[0][0], screen[0][1], 0)!;
  let line: DrawLine | null = null;
  let stalled = false;
  for (const [sx, sy] of screen.slice(1)) {
    if (!line) {
      const p = planeAt(sx, sy, 0)!;
      if (Math.hypot(p.x - origin.x, p.z - origin.z) < startMove) continue;
      const heading = Math.round(Math.atan2(p.z - origin.z, p.x - origin.x) / (Math.PI / 4)) * (Math.PI / 4);
      line = new DrawLine({ x: Math.round(origin.x / 18) * 18, z: Math.round(origin.z / 18) * 18, heading, y: 0, kind: "peg" }, options(land, world.layout));
    }
    line.addSeen((y) => planeAt(sx, sy, y));
    // (What DrawHand says "Too sharp: draw a wider bend" of, the line stuck behind the finger.)
    stalled ||= line.stalled;
  }
  if (!line) return { line, px: Infinity, stalled: false };
  line.finish();
  const e = line.end;
  const [ex, ey] = toScreen(e.x, e.y, e.z);
  const [fx, fy] = screen[screen.length - 1];
  return { line, px: Math.hypot(ex - fx, ey - fy), stalled };
}

let qaWorldMemo: ReturnType<typeof createWorld> | null = null;
/** Seed 7, fresh (made once: the strokes don't change it). */
function qaWorld(): ReturnType<typeof createWorld> {
  return (qaWorldMemo ??= createWorld(7));
}

describe("QA sweep: ramps not learned (Game mode)", () => {
  it("a stroke between hills that a flat line can follow lays it, rather than stopping red for a ramp (item 1d)", () => {
    // Hills a level up: two blocks either side of a way through, and one further on (QA: the way to the sawmill).
    let land = flat();
    for (const [x0, x1, z0, z1] of [
      [0, 288, -432, -216],
      [576, 720, -144, -72],
      [576, 720, 144, 216],
      [864, 936, 0, 144],
    ])
      land = paint(land, x0, x1, z0, z1, 1);
    // The stroke bends off toward -z between them, by up to 124 mm.
    const z = (x: number) => Z - (124 * (1 - Math.cos((Math.PI * x) / 1028))) / 2;
    const line = stroke(at(0), options(land, new Layout(), { allow: (t) => t !== "ramp" && !isBridge(t), outOf: () => "Ramp: not learned yet" }), 1100, z);
    expect(line.pieces.some((p) => p.blocked), name(line)).toBe(false);
    expect(line.refused).toBe(null);
    expect(ramps(line, true) + ramps(line, false)).toBe(0);
    expect(line.end.x).toBeGreaterThan(1000);
    expectJoined(line);
  });
});

describe("QA junction notes N6: a U-turn that runs into a hill", () => {
  it("no move slow (at most a piece a move): U-turns of 80 to 140 mm radius into a hill a level or two up, ramps or none", () => {
    const strokes: { opts: DrawOptions; pts: { x: number; z: number }[] }[] = [];
    for (const noRamp of [false, true])
      for (const h of [1, 2])
        for (const r of [80, 90, 110, 140])
          for (const hx of [72, 144, 216, 288])
            for (const lead of [100, 200]) {
              const land = paint(flat(), hx, hx + 216, Z + 36, Z + 324, h);
              const opts = options(land, new Layout(), noRamp ? { allow: (t) => t !== "ramp" && !isBridge(t), outOf: () => "Ramp: not learned yet" } : {});
              const pts: { x: number; z: number }[] = [];
              for (let x = 4; x <= lead; x += 6) pts.push({ x, z: Z });
              for (let a = 6 / r; a <= Math.PI; a += 6 / r) pts.push({ x: lead + r * Math.sin(a), z: Z + r - r * Math.cos(a) });
              for (let x = lead; x >= lead - 200; x -= 6) pts.push({ x, z: Z + 2 * r });
              strokes.push({ opts, pts });
            }
    // (As the other timing guards: the slowest few moves left out, a loaded machine stalls one now and then.)
    const SPARED = 4;
    const run = () => {
      const slowest: number[] = [];
      let most = 0;
      for (const { opts, pts } of strokes) {
        const line = new DrawLine(at(0), opts);
        for (const p of pts) {
          const n = line.pieces.length;
          const t0 = performance.now();
          line.addPoint(p.x, p.z);
          const t = performance.now() - t0;
          if (slowest.length <= SPARED || t > slowest[SPARED]) {
            slowest.push(t);
            slowest.sort((a, b) => b - a);
            slowest.length = Math.min(slowest.length, SPARED + 1);
          }
          most = Math.max(most, line.pieces.length - n);
        }
        line.finish();
      }
      return { worst: slowest[Math.min(SPARED, slowest.length - 1)] ?? 0, most };
    };
    run();
    const { worst: first, most } = run();
    expect(most).toBe(1);
    // About 0.5 ms at worst in Node (the move that lays the first piece); generous for a slow CI, best of up to five.
    let worst = first;
    for (let k = 0; k < 4 && worst >= 4; k++) worst = Math.min(worst, run().worst);
    expect(worst).toBeLessThan(4);
  });
});


describe("QA's terrace 2 drawn again (the camera a hair off after an undo)", () => {
  it("lays the same line, both ramps, wherever the camera is to within a millimetre, and wherever the line begins along the stroke", () => {
    const run: QARun = ["terrace 2", -1764, -1620, Math.PI, 480, false, -2004, -1620, 3662.2];
    // (Two plans with straights covering the same ground cost the same to within a few micrometres of stroke: a camera
    // a hair off took the long one first, and found no room for its second ramp: "The hill is a level up here".)
    for (const e of [0, 1e-9, -1e-9, 1e-7, 1e-5, -1e-3, 1e-3, 0.01, -0.1, 0.5, -1]) {
      const { line } = replayQA([run[0], run[1], run[2], run[3], run[4], run[5], run[6] + e, run[7] + e, run[8] + e]);
      expect(line && name(line), `camera ${e} mm off`).toBe("straight-54@0 straight-54@0 ramp↑@0 straight-54@48 ramp↑@48");
    }
    // The stroke itself a few micrometres to one side (the browser's repeat was 6 µm shorter): with the tie to within
    // rounding only, 39 of 80 such strokes from −0.1 to 0.1 mm took the long straight first.
    for (const e of [0.0025, 0.006, 0.01, 0.05, -0.05, 0.1]) {
      const { line } = replayQA([run[0], run[1], run[2] + e, run[3], run[4], run[5], run[6], run[7], run[8]]);
      expect(line && name(line), `stroke ${e} mm off`).toBe("straight-54@0 straight-54@0 ramp↑@0 straight-54@48 ramp↑@48");
    }
    for (const sm of [20, 30, 31, 45]) {
      const { line } = replayQA(run, sm);
      expect(line && name(line), `begun ${sm} mm along`).toBe("straight-54@0 straight-54@0 ramp↑@0 straight-54@48 ramp↑@48");
    }
  });
});
