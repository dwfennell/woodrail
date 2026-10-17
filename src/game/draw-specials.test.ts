import { describe, expect, it } from "vitest";
import { gridWithPlots, hillMessage, hillsOf, SURF_RIVER, syncCuttings, type BlockReason, type Landscape } from "../landscape";
import { DrawLine, isBridge, Layout, RISER_HEIGHT, type DrawEnd, type DrawOptions, type PieceTypeId } from "../track";
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
});
