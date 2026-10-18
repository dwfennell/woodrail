import { describe, expect, it } from "vitest";
import { candidatesFrom, DRAW_LOOKAHEAD, DrawLine, type DrawCandidate, type DrawEnd } from "./draw-path";
import { Layout } from "./layout";
import { findOverlap } from "./overlap";
import type { Pose } from "./math";
import { getPieceDef, type PieceTypeId } from "./pieces";
import { angleDiff, normalizeAngle } from "./math";
import { RISER_HEIGHT } from "./constants";
import { gridWithPlots, hillsOf, inRiver, SURF_RIVER, type BlockReason, type Landscape } from "../landscape";
import { drawRefusal, trackMessage, trackPlacement } from "../game/track-rules";

const START: DrawEnd = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" };

/** Draw a stroke given as a function of distance along it, a few mm at a time, then lift the finger. */
function draw(line: DrawLine, length: number, at: (s: number) => { x: number; z: number }, finish = true): DrawLine {
  for (let s = 4; s <= length; s += 4) {
    const p = at(s);
    line.addPoint(p.x, p.z);
  }
  if (finish) line.finish();
  return line;
}

/** An arc starting at the origin heading +x, turning toward +z (sign 1) or −z (sign −1). */
const arc = (r: number, sign: 1 | -1) => (s: number) => ({ x: r * Math.sin(s / r), z: sign * r * (1 - Math.cos(s / r)) });

/** Every piece seats on the end before it (the line is joined all the way). */
function expectJoined(line: DrawLine): void {
  const l = new Layout();
  for (const p of line.pieces) l.addPiece(p.type, p.pose, p.y, p.flipped);
  expect(l.jointCount).toBe(line.pieces.length - 1);
}


/** A straight stroke from `from` at `deg` degrees, with a sideways wobble of ±`wobble` mm (a wave `wave` mm long). */
const swipe = (from: { x: number; z: number }, deg: number, wobble = 0, phase = 0, wave = 150) => {
  const a = (deg * Math.PI) / 180;
  return (s: number) => {
    const w = wobble * (Math.sin((2 * Math.PI * s) / wave + phase) - Math.sin(phase));
    return { x: from.x + s * Math.cos(a) - w * Math.sin(a), z: from.z + s * Math.sin(a) + w * Math.cos(a) };
  };
};

/** Draw a stroke (4 mm a point) and lift: how the line came out against the finger. */
function follow(start: DrawEnd, length: number, at: (s: number) => { x: number; z: number }, deg: number) {
  const line = new DrawLine(start);
  const pts: { x: number; z: number }[] = [];
  let stalled = false;
  let lag = 0;
  for (let s = 4; s <= length; s += 4) {
    const p = at(s);
    pts.push(p);
    line.addPoint(p.x, p.z);
    stalled ||= line.stalled;
    lag = Math.max(lag, Math.hypot(p.x - line.end.x, p.z - line.end.z));
  }
  line.finish();
  stalled ||= line.stalled;
  const a = (deg * Math.PI) / 180;
  const e = at(length);
  const dx = line.end.x - e.x;
  const dz = line.end.z - e.z;
  // The finger's furthest from the line laid (its pieces' tracks, as a polyline).
  const track: number[] = [start.x, start.z];
  for (const p of line.pieces) for (let i = 0; i < p.track.length; i += 3) track.push(p.track[i], p.track[i + 1]);
  let off = 0;
  for (const p of pts) {
    let d = Infinity;
    for (let i = 0; i + 3 < track.length; i += 2) {
      const sx = track[i + 2] - track[i];
      const sz = track[i + 3] - track[i + 1];
      const l2 = sx * sx + sz * sz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - track[i]) * sx + (p.z - track[i + 1]) * sz) / l2)) : 0;
      d = Math.min(d, Math.hypot(track[i] + sx * t - p.x, track[i + 1] + sz * t - p.z));
    }
    off = Math.max(off, d);
  }
  // Each curve's turn (+1 or −1; 0 for a straight).
  const turns: number[] = [];
  let h = start.heading;
  for (const p of line.pieces) {
    turns.push(p.type.startsWith("curve") ? Math.sign(normalizeAngle(p.end.heading - h)) : 0);
    h = p.end.heading;
  }
  // The furthest the line lies to the side of the swipe (its pieces' tracks, all but the last: laid as the finger
  // lifts, it may round off a step toward the finger).
  let band = 0;
  for (const p of line.pieces.slice(0, -1))
    for (let i = 0; i < p.track.length; i += 3) band = Math.max(band, Math.abs(-(p.track[i] - start.x) * Math.sin(a) + (p.track[i + 1] - start.z) * Math.cos(a)));
  const name = line.pieces.map((p, i) => p.type.replace("straight-", "s").replace("curve-", "") + (turns[i] > 0 ? "+" : turns[i] < 0 ? "−" : "")).join(" ");
  return { line, along: dx * Math.cos(a) + dz * Math.sin(a), side: -dx * Math.sin(a) + dz * Math.cos(a), off, band, turns, stalled, lag, name };
}

/**
 * A staircase, not a snake: curves come one at a time, or two turning opposite ways (a step), with a straight run
 * between one step and the next.
 */
function expectStaircase(r: ReturnType<typeof follow>, name: string): void {
  const why = `${name}: ${r.name}`;
  // (The last piece, laid as the finger lifts, may round off a step.)
  const turns = r.turns.slice(0, -1);
  let steps = 0;
  for (let i = 0; i < turns.length; i++) {
    if (!turns[i]) continue;
    let j = i;
    while (j + 1 < turns.length && turns[j + 1]) j++;
    expect(j - i + 1, why).toBeLessThanOrEqual(2);
    if (j > i) expect(turns[j], why).toBe(-turns[i]);
    steps++;
    i = j;
  }
  expect(steps, why).toBeLessThanOrEqual(turns.filter((t) => t === 0).length + 1);
}

describe("draw path", () => {
  it("offers each piece through an end of the other kind, mirrored for curves", () => {
    const c = candidatesFrom(START);
    // 4 straights, 3 curves × 2 hands.
    expect(c).toHaveLength(10);
    for (const k of c) expect(getPieceDef(k.type, k.flipped).connectors[k.entry].kind).toBe("socket");
    const fromHole = candidatesFrom({ ...START, kind: "socket" });
    for (const k of fromHole) expect(getPieceDef(k.type, k.flipped).connectors[k.entry].kind).toBe("peg");
  });

  it("a straight stroke becomes long straights", () => {
    const line = draw(new DrawLine(START), 1000, (s) => ({ x: s, z: 0 }));
    const types = line.pieces.map((p) => p.type);
    expect(types.filter((t) => t === "straight-216").length).toBeGreaterThanOrEqual(4);
    expect(types.every((t) => t.startsWith("straight"))).toBe(true);
    const end = line.end;
    expect(Math.abs(end.x - 1000)).toBeLessThan(40);
    expect(Math.abs(end.z)).toBeLessThan(1);
    expectJoined(line);
  });

  it("a diagonal stroke from a diagonal end stays straight", () => {
    const h = Math.PI / 4;
    const line = draw(new DrawLine({ ...START, heading: h }), 700, (s) => ({ x: s * Math.cos(h), z: s * Math.sin(h) }));
    expect(line.pieces.every((p) => p.type.startsWith("straight"))).toBe(true);
  });

  it("a quarter circle of the curve's radius becomes two curves, turning the right way", () => {
    for (const sign of [1, -1] as const) {
      const line = draw(new DrawLine(START), (180 * Math.PI) / 2, arc(180, sign));
      expect(line.pieces.map((p) => p.type)).toEqual(["curve-large", "curve-large"]);
      expect(angleDiff(line.end.heading, (sign * Math.PI) / 2)).toBeLessThan(0.01);
      expectJoined(line);
    }
  });

  it("a wider turn uses the wide curve, a tight one the tight curve", () => {
    const wide = draw(new DrawLine(START), (270 * Math.PI) / 2, arc(270, 1));
    expect(wide.pieces.map((p) => p.type)).toEqual(["curve-wide", "curve-wide"]);
    const tight = draw(new DrawLine(START), (90 * Math.PI) / 2, arc(90, -1));
    expect(tight.pieces.map((p) => p.type)).toEqual(["curve-small", "curve-small"]);
  });

  it("a full circle closes on itself with eight curves", () => {
    const line = draw(new DrawLine(START), 180 * Math.PI * 2, arc(180, 1));
    expect(line.pieces.map((p) => p.type)).toEqual(Array(8).fill("curve-large"));
    expect(Math.hypot(line.end.x, line.end.z)).toBeLessThan(1);
  });

  it("a wobbly hand-drawn straight still lays straights", () => {
    const line = draw(new DrawLine(START), 900, (s) => ({ x: s, z: 10 * Math.sin(s / 40) }));
    expect(line.pieces.every((p) => p.type.startsWith("straight"))).toBe(true);
  });

  /** Straight on `lead` mm along +x, then a quarter circle of radius r turning toward +z (sign 1) or −z (sign −1). */
  const leadThenArc = (lead: number, r: number, sign: 1 | -1) => (s: number) => {
    if (s < lead) return { x: s, z: 0 };
    const a = (s - lead) / r;
    return { x: lead + r * Math.sin(a), z: sign * r * (1 - Math.cos(a)) };
  };

  it("a wide arc after a straight lead-in is wide curves, not straights and tighter curves in turn (QA N3)", () => {
    for (const lead of [100, 150, 200])
      for (const sign of [1, -1] as const) {
        const name = `lead ${lead}, sign ${sign}`;
        const line = draw(new DrawLine(START), lead + (270 * Math.PI) / 2, leadThenArc(lead, 270, sign));
        const types = line.pieces.map((p) => p.type);
        const curves = types.filter((t) => t.startsWith("curve"));
        expect(curves.filter((t) => t === "curve-wide").length, `${name}: ${types}`).toBeGreaterThan(curves.length / 2);
        // At most one straight among the curves.
        const first = types.findIndex((t) => t.startsWith("curve"));
        const last = types.length - 1 - [...types].reverse().findIndex((t) => t.startsWith("curve"));
        expect(types.slice(first, last + 1).filter((t) => t.startsWith("straight")).length, `${name}: ${types}`).toBeLessThanOrEqual(1);
        expect(angleDiff(line.end.heading, (sign * Math.PI) / 2), name).toBeLessThan(0.01);
        expectJoined(line);
      }
  });

  it("the curve's own radius after a lead-in is still the curve", () => {
    for (const lead of [100, 150, 200]) {
      const line = draw(new DrawLine(START), lead + (180 * Math.PI) / 2, leadThenArc(lead, 180, 1));
      const types = line.pieces.map((p) => p.type);
      expect(types.filter((t) => t.startsWith("curve")), `lead ${lead}: ${types}`).toEqual(["curve-large", "curve-large"]);
      expect(angleDiff(line.end.heading, Math.PI / 2)).toBeLessThan(0.01);
    }
  });

  it("a lead-in that isn't a sum of straights is fitted with the straights, and the bend keeps the stroke's radius", () => {
    const cases: [number, number, string][] = [
      [250, 180, "curve-large"],
      [300, 180, "curve-large"],
      [350, 180, "curve-large"],
      [250, 270, "curve-wide"],
      [300, 270, "curve-wide"],
    ];
    for (const [lead, r, curve] of cases)
      for (const sign of [1, -1] as const) {
        const name = `lead ${lead}, r${r}, sign ${sign}`;
        const at = leadThenArc(lead, r, sign);
        const length = lead + (r * Math.PI) / 2;
        const line = draw(new DrawLine(START), length, at);
        const types = line.pieces.map((p) => p.type);
        // One radius all through the bend: the stroke's.
        const curves = types.filter((t) => t.startsWith("curve"));
        expect(curves.length, `${name}: ${types}`).toBeGreaterThan(0);
        expect(new Set(curves), `${name}: ${types}`).toEqual(new Set([curve]));
        // At most one (short) straight among the curves.
        const first = types.findIndex((t) => t.startsWith("curve"));
        const last = types.length - 1 - [...types].reverse().findIndex((t) => t.startsWith("curve"));
        const among = types.slice(first, last + 1).filter((t) => t.startsWith("straight"));
        expect(among.length, `${name}: ${types}`).toBeLessThanOrEqual(1);
        expect(among.every((t) => t === "straight-54" || t === "straight-108"), `${name}: ${types}`).toBe(true);
        // Ending within about 25 mm of the stroke's end (the lead-in's error, taken up by the straights), heading its way.
        const end = at(length);
        expect(Math.hypot(line.end.x - end.x, line.end.z - end.z), `${name}: ${types}`).toBeLessThan(26);
        expect(angleDiff(line.end.heading, (sign * Math.PI) / 2), name).toBeLessThan(0.01);
        expectJoined(line);
      }
  });

  it("a 200 mm straight is one long piece (ending within joint play of the stroke's end), not a long one and minis (QA N3)", () => {
    const line = draw(new DrawLine(START), 200, (s) => ({ x: s, z: 0 }));
    const types = line.pieces.map((p) => p.type);
    expect(types.length, `${types}`).toBeLessThanOrEqual(2);
    expect(types, `${types}`).not.toContain("straight-54");
    expect(Math.abs(line.end.x - 200)).toBeLessThanOrEqual(20);
  });

  it("a hand's wobble (±8 mm, ±10 mm) doesn't break a long straight into short pieces (QA N3)", () => {
    for (const amp of [8, 10])
      for (const phase of [0, 1, 2, 3, 4, 5]) {
        const name = `±${amp} mm, phase ${phase}`;
        const at = (s: number) => ({ x: s, z: amp * (Math.sin((2 * Math.PI * s) / 150 + phase) - Math.sin(phase)) });
        const line = draw(new DrawLine(START), 900, at);
        const types = line.pieces.map((p) => p.type);
        // Long and medium straights only, but for one shorter piece at the end.
        expect(types.slice(0, -1).every((t) => t === "straight-216" || t === "straight-144"), `${name}: ${types}`).toBe(true);
        expect(types[types.length - 1].startsWith("straight"), `${name}: ${types}`).toBe(true);
        expect(Math.abs(line.end.x - 900), name).toBeLessThan(30);
      }
  });

  it("an L with a rounded corner: straights, two curves, straights", () => {
    const pts = (s: number) => {
      if (s < 400) return { x: s, z: 0 };
      const r = 180;
      const a = (s - 400) / r;
      if (a < Math.PI / 2) return { x: 400 + r * Math.sin(a), z: r * (1 - Math.cos(a)) };
      return { x: 400 + r, z: r + (s - 400 - (r * Math.PI) / 2) };
    };
    const line = draw(new DrawLine(START), 400 + (180 * Math.PI) / 2 + 400, pts);
    const types = line.pieces.map((p) => p.type);
    // Two eighth-turn curves (which radii depends on where the straights left off).
    expect(types.filter((t) => t.startsWith("curve"))).toHaveLength(2);
    expect(angleDiff(line.end.heading, Math.PI / 2)).toBeLessThan(0.01);
    expect(Math.abs(line.end.x - 580)).toBeLessThan(40);
    expectJoined(line);
  });

  it("pieces wait behind the finger while drawing, then the rest go down on lift", () => {
    const line = draw(new DrawLine(START), 600, (s) => ({ x: s, z: 0 }), false);
    expect(line.pieces.length).toBeGreaterThan(0);
    expect(line.end.x).toBeLessThan(600);
    line.finish();
    expect(Math.abs(line.end.x - 600)).toBeLessThan(40);
  });

  it("going back over the line takes pieces off", () => {
    const line = draw(new DrawLine(START), 1200, (s) => ({ x: s, z: 0 }), false);
    const before = line.pieces.length;
    expect(before).toBeGreaterThan(2);
    // Back to the start of the second piece.
    const joint = line.pieces[0].end;
    for (let x = 1200; x >= joint.x; x -= 4) line.addPoint(x, 0);
    expect(line.pieces.length).toBe(1);
    // And on again a different way: it bends.
    draw(line, (180 * Math.PI) / 2, (s) => ({ x: joint.x + 180 * Math.sin(s / 180), z: 180 * (1 - Math.cos(s / 180)) }));
    expect(line.pieces.slice(1).map((p) => p.type)).toEqual(["curve-large", "curve-large"]);
  });

  it("going all the way back to the start and lifting lays nothing", () => {
    const line = new DrawLine(START);
    for (let x = 4; x <= 900; x += 4) line.addPoint(x, 0);
    expect(line.pieces.length).toBeGreaterThan(0);
    for (let x = 900; x >= 6; x -= 3) line.addPoint(x, 0);
    line.finish();
    expect(line.pieces).toHaveLength(0);
  });

  /** Out along +x to `out`, then back to `back` (dense points, as a finger gives), and lift. */
  const outAndBack = (out: number, back: number, step = 2) => {
    const line = new DrawLine(START);
    for (let x = step; x <= out; x += step) line.addPoint(x, 0);
    for (let x = out; x >= back; x -= step) line.addPoint(x, 0);
    line.finish();
    return line;
  };

  it("retracing to cancel lays nothing: back to the start, past it, or a little short of it (dense points)", () => {
    expect(outAndBack(600, 0).pieces).toHaveLength(0);
    expect(outAndBack(600, -30).pieces).toHaveLength(0);
    expect(outAndBack(600, 40).pieces).toHaveLength(0);
    expect(outAndBack(900, 0, 1).pieces).toHaveLength(0);
  });

  /**
   * Out along +x, then back along it `offset` mm to the side, `step` mm a point, stopping at `stop`: how many ghosts
   * showed just before the finger lifted, the most there were on the way back after the first trim, and how many pieces
   * went down when it lifted.
   */
  const retraceCase = (out: number, stop: number, offset: number, step: number) => {
    const line = new DrawLine(START);
    for (let x = step; x <= out; x += step) line.addPoint(x, 0);
    let trimmed = false;
    let regrew = false;
    let low = line.pieces.length;
    for (let x = out; x >= stop; x -= step) {
      line.addPoint(x, offset);
      if (line.pieces.length < low) trimmed = true;
      // No growth on the way back at all (not even a ghost flashing up as the finger turns, before the first trim).
      if (line.pieces.length > low) regrew = true;
      low = Math.min(low, line.pieces.length);
    }
    line.addPoint(stop, offset);
    const shown = line.pieces.length;
    line.finish();
    return { shown, laid: line.pieces.length, regrew, trimmed };
  };

  it("lifting during a retrace lays exactly what the ghosts showed, and ghosts don't regrow on the way back (QA sweep)", () => {
    for (const step of [4, 8, 15, 30])
      for (const stop of [300, 200, 60, 40, 20, 0, -30, -60])
        for (const offset of [0, 5, 12]) {
          const r = retraceCase(600, stop, offset, step);
          const name = `step ${step}, stop ${stop}, offset ${offset}`;
          expect(r.laid, name).toBe(r.shown);
          expect(r.regrew, name).toBe(false);
        }
  });

  it("after a partial retrace, a sharp turn draws on (75° and 90°, either way)", () => {
    for (const deg of [75, 90, -75, -90]) {
      const a = (deg * Math.PI) / 180;
      const line = new DrawLine(START);
      for (let x = 4; x <= 700; x += 4) line.addPoint(x, 0);
      for (let x = 700; x >= 300; x -= 4) line.addPoint(x, 0);
      const kept = line.pieces.length;
      for (let d = 4; d <= 400; d += 4) line.addPoint(300 + d * Math.cos(a), d * Math.sin(a));
      line.finish();
      expect(line.pieces.length, `${deg}°`).toBeGreaterThan(kept + 1);
      expect(line.pieces.slice(kept).some((p) => p.type.startsWith("curve")), `${deg}°`).toBe(true);
      // It ends near the finger.
      const e = line.end;
      expect(Math.hypot(e.x - (300 + 400 * Math.cos(a)), e.z - 400 * Math.sin(a)), `${deg}°`).toBeLessThan(140);
    }
  });

  it("QA's cases: 40 mm short of the start, halfway back, and a hairpin back over the line lay nothing", () => {
    for (const offset of [2, 5, 8]) expect(retraceCase(600, 40, offset, 4).laid, `40 short, offset ${offset}`).toBe(0);
    expect(retraceCase(600, 200, 8, 4).laid).toBe(0);
    expect(retraceCase(400, 200, 15, 4).laid).toBe(0);
  });

  it("retracing part way takes off the pieces gone back over, mid-piece too, and keeps the rest", () => {
    const line = outAndBack(1100, 300);
    // Nothing reaches past where the finger came back to.
    const far = Math.max(...line.pieces.map((p) => p.end.x));
    expect(far).toBeLessThanOrEqual(300);
    expect(line.pieces.length).toBeGreaterThan(0);
  });

  it("coming back part way and turning, the line turns there (not at the next joint on)", () => {
    const line = new DrawLine(START);
    for (let x = 2; x <= 700; x += 2) line.addPoint(x, 0);
    for (let x = 700; x >= 300; x -= 2) line.addPoint(x, 0);
    for (let s = 2; s <= 400; s += 2) line.addPoint(300 + 180 * Math.sin(s / 180), 180 * (1 - Math.cos(s / 180)));
    line.finish();
    const firstCurve = line.pieces.findIndex((p) => p.type.startsWith("curve"));
    expect(firstCurve).toBeGreaterThan(-1);
    const turnAt = firstCurve === 0 ? 0 : line.pieces[firstCurve - 1].end.x;
    // Within a piece of where the finger turned (the next joint on was at 432).
    expect(turnAt).toBeLessThanOrEqual(360);
  });

  it("a hairpin drawn without retracing ends where the finger did, heading back (no hook at its tip)", () => {
    const line = new DrawLine(START);
    for (let x = 2; x <= 500; x += 2) line.addPoint(x, 0);
    for (let a = 0; a <= Math.PI; a += 0.01) line.addPoint(500 + 180 * Math.sin(a), 180 * (1 - Math.cos(a)));
    for (let x = 500; x >= 400; x -= 2) line.addPoint(x, 360);
    line.finish();
    const end = line.end;
    expect(angleDiff(end.heading, Math.PI)).toBeLessThan(0.05);
    expect(Math.abs(end.z - 360)).toBeLessThan(30);
    expect(end.x).toBeGreaterThan(330);
  });

  it("each piece's track runs from where it joins the line to its free end", () => {
    for (const c of candidatesFrom({ ...START, kind: "socket" })) {
      const line = new DrawLine({ ...START, kind: "socket" }, { meet: () => c });
      line.addPoint(c.end.x, c.end.z);
      line.addPoint(c.end.x + 1, c.end.z + 300);
      line.finish();
      const t = line.pieces[0]?.track;
      if (!t) continue;
      expect(Math.hypot(t[0], t[1])).toBeLessThan(0.01);
      expect(Math.hypot(t[t.length - 3] - c.end.x, t[t.length - 2] - c.end.z)).toBeLessThan(0.01);
    }
  });

  it("stops at a piece that can't go there, and lays only up to it", () => {
    const line = draw(new DrawLine(START, { check: (c) => (c.pose.x < 400 ? null : { reason: "piece", message: "in the way" }) }), 1000, (s) => ({ x: s, z: 0 }));
    expect(line.stopped).toBe("blocked");
    expect(line.pieces[line.pieces.length - 1].blocked).toBe("in the way");
    expect(line.placeable().every((p) => p.pose.x < 400)).toBe(true);
  });

  it("uses only the pieces allowed (Game mode stock)", () => {
    const line = draw(new DrawLine(START, { allow: (t, l) => t === "straight-144" && l.length < 3 }), 1000, (s) => ({ x: s, z: 0 }));
    expect(line.pieces.map((p) => p.type)).toEqual(["straight-144", "straight-144", "straight-144"]);
    expect(line.refused).not.toBeNull();
  });

  it("a straight swipe off the grid stays under the finger: a staircase of straights, not a snake of curves (QA N1)", () => {
    for (const length of [300, 600, 900, 1500])
      for (const deg of [0, 5, 10, 15, 20, 23, 30, 35, 40, -10, -23, -35]) {
        const name = `${deg}°, ${length} mm`;
        const r = follow(START, length, swipe(START, deg), deg);
        // The line ends near the finger (along the swipe and to its side), and the finger was never far from it.
        expect(Math.hypot(r.along, r.side), `${name}: ${r.name}`).toBeLessThan(70);
        expect(r.off, `${name}: ${r.name}`).toBeLessThan(70);
        // The line keeps to the band either side of the swipe (50 mm), a few mm over at most.
        expect(r.band, `${name}: ${r.name}`).toBeLessThan(55);
        expect(r.stalled, name).toBe(false);
        expectStaircase(r, name);
        // The ghosts keep up: a piece or so behind the look-ahead, all the way.
        expect(r.lag, name).toBeLessThan(DRAW_LOOKAHEAD + 260);
        expectJoined(r.line);
      }
  });

  it("a hand's wobble (±8 mm) on a straight swipe off the grid doesn't bring the snake back (QA N1)", () => {
    for (const length of [600, 900, 1500])
      for (const deg of [5, 10, 15, 20, 23, 30, 35, 40])
        for (const phase of [0, 1.5, 3, 4.5])
          for (const wave of [100, 150, 250]) {
            const name = `${deg}°, ${length} mm, phase ${phase}, wave ${wave}`;
            const r = follow(START, length, swipe(START, deg, 8, phase, wave), deg);
            expect(Math.hypot(r.along, r.side), `${name}: ${r.name}`).toBeLessThan(70);
            expect(r.off, `${name}: ${r.name}`).toBeLessThan(75);
            // The band is kept about the swipe drawn, not the wobble: the wobble may take the line up to 8 mm further.
            expect(r.band, `${name}: ${r.name}`).toBeLessThan(64);
            expect(r.stalled, name).toBe(false);
            expectStaircase(r, name);
          }
  });

  it("a 23° swipe of 600 mm: straights along the grid with one step, not three curves (QA N1)", () => {
    const r = follow(START, 600, swipe(START, 23), 23);
    const types = r.line.pieces.map((p) => p.type);
    expect(types.filter((t) => t.startsWith("straight")).length, r.name).toBeGreaterThanOrEqual(2);
    expect(types.filter((t) => t.startsWith("curve")).length, r.name).toBeLessThanOrEqual(2);
    // Every piece runs along the grid's eighths either side of the swipe (0° and 45°).
    for (const p of r.line.pieces) expect([0, Math.PI / 4].some((h) => angleDiff(p.end.heading, h) < 0.01), r.name).toBe(true);
  });

  it("from open ground, a straight swipe at 23° or 35° stays under the finger (QA N1)", () => {
    for (const deg of [23, 35, -23, -35, 113]) {
      const origin = { x: 7, z: -5 };
      const a = (deg * Math.PI) / 180;
      // As DrawHand starts a line: its first end on the grid, pointing the way the finger set off, in eighths.
      const start: DrawEnd = { x: 0, z: 0, heading: Math.round(a / (Math.PI / 4)) * (Math.PI / 4), y: 0, kind: "peg" };
      for (const length of [600, 1200]) {
        const at = swipe(origin, deg);
        const r = follow(start, length, at, deg);
        const name = `${deg}°, ${length} mm`;
        expect(Math.hypot(r.along, r.side), `${name}: ${r.name}`).toBeLessThan(70);
        expect(r.off, `${name}: ${r.name}`).toBeLessThan(70);
        expect(r.stalled, name).toBe(false);
        expectStaircase(r, name);
      }
    }
  });

  it("going back over a staircase takes its pieces off, though they lie to the side of the finger", () => {
    const at = swipe(START, 23);
    const line = new DrawLine(START);
    for (let s = 4; s <= 1100; s += 4) line.addPoint(at(s).x, at(s).z);
    const before = line.pieces.length;
    expect(before).toBeGreaterThan(3);
    for (let s = 1100; s >= 300; s -= 4) line.addPoint(at(s).x, at(s).z);
    line.finish();
    expect(line.pieces.length).toBeLessThan(before);
    // Nothing reaches far past where the finger came back to.
    const back = at(300);
    for (const p of line.pieces) expect((p.end.x - back.x) * Math.cos(0.4) + (p.end.z - back.z) * Math.sin(0.4)).toBeLessThan(60);
  });

  it("a straight swipe off the grid that then bends still bends", () => {
    // 23° for 500 mm, then a quarter circle of the curve's radius.
    const a = (23 * Math.PI) / 180;
    const at = (s: number) => {
      if (s < 500) return { x: s * Math.cos(a), z: s * Math.sin(a) };
      const t = (s - 500) / 180;
      const cx = 500 * Math.cos(a) - 180 * Math.sin(a);
      const cz = 500 * Math.sin(a) + 180 * Math.cos(a);
      return { x: cx + 180 * Math.sin(a + t), z: cz - 180 * Math.cos(a + t) };
    };
    const length = 500 + (180 * Math.PI) / 2;
    const r = follow(START, length, at, 23 + 90);
    expect(Math.hypot(r.along, r.side), r.name).toBeLessThan(70);
    expect(r.off, r.name).toBeLessThan(70);
    // It ends heading round the way the finger went (113°: the eighth at 90° or 135°).
    expect(Math.min(angleDiff(r.line.end.heading, Math.PI / 2), angleDiff(r.line.end.heading, (3 * Math.PI) / 4)), r.name).toBeLessThan(0.01);
    expect(r.stalled).toBe(false);
  });

  it("going round in a circle tighter than any curve (r50 to r80) leaves the line stalled, so it says so", () => {
    for (const r of [50, 65, 80]) {
      const line = new DrawLine(START);
      let stalled = false;
      for (let s = 4; s <= 2 * Math.PI * r; s += 4) {
        line.addPoint(r * Math.sin(s / r), r * (1 - Math.cos(s / r)));
        stalled ||= line.stalled;
      }
      expect(stalled, `r${r}`).toBe(true);
    }
    // The curves' own circles don't (nor a quarter of the tight curve's).
    for (const r of [180, 270]) {
      const line = new DrawLine(START);
      for (let s = 4; s <= 2 * Math.PI * r; s += 4) {
        line.addPoint(r * Math.sin(s / r), r * (1 - Math.cos(s / r)));
        expect(line.stalled, `r${r}`).toBe(false);
      }
    }
    const tight = new DrawLine(START);
    for (let s = 4; s <= (90 * Math.PI) / 2; s += 4) {
      tight.addPoint(90 * Math.sin(s / 90), 90 * (1 - Math.cos(s / 90)));
      expect(tight.stalled).toBe(false);
    }
  });

  it("a loop drawn a little past its start closes there, and isn't taken on across its first piece", () => {
    for (const [r, over, step] of [[200, 60, 15], [200, 30, 15], [200, 60, 4], [180, 60, 4], [180, 90, 30]]) {
      const own = new Layout();
      const sync = (pieces: readonly { type: PieceTypeId; pose: Pose; y: number; flipped: boolean }[]) => {
        for (const id of [...own.pieceIds()]) own.removePiece(id);
        for (const p of pieces) own.addPiece(p.type, p.pose, p.y, p.flipped);
      };
      const line: DrawLine = new DrawLine(START, {
        check: (c, l) => {
          sync(l);
          return findOverlap(own, c.type, c.flipped, c.pose, c.y, -1) !== -1 ? { reason: "self", message: "The line would cross itself" } : null;
        },
        // Closing on its own start (as DrawHand asks it: the line as it was before the piece just laid).
        closes: (e) => {
          sync(line.pieces.slice(0, -1));
          return line.pieces.length > 2 && Math.hypot(e.x - START.x, e.z - START.z) <= 9 && angleDiff(e.heading, START.heading) < 0.07;
        },
      });
      for (let s = step; s <= 2 * Math.PI * r + over; s += step) line.addPoint(r * Math.sin(s / r), r * (1 - Math.cos(s / r)));
      line.finish();
      const name = `r${r}, ${over} mm past, ${step} mm a point`;
      expect(line.pieces.some((p) => p.blocked), name).toBe(false);
      expect(Math.hypot(line.end.x, line.end.z), name).toBeLessThan(40);
    }
  });

  it("a pointer move costs well under a millisecond", () => {
    const wave = (s: number) => ({ x: s, z: 300 * Math.sin((s / 1200) * 2 * Math.PI) });
    draw(new DrawLine(START), 2400, wave); // warm up
    const line = new DrawLine(START);
    const t0 = performance.now();
    draw(line, 2400, wave);
    const per = (performance.now() - t0) / (2400 / 4);
    expect(line.pieces.length).toBeGreaterThan(10);
    expect(per).toBeLessThan(0.5);
  });

  it("no one pointer move is slow: straight, wobbly, slow and wandering strokes, and bends too sharp to follow", () => {
    // A seeded random walk, and strokes as a hand draws them (`step` mm a point, give or take).
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const strokes: { x: number; z: number }[][] = [];
    const sample = (length: number, at: (s: number) => { x: number; z: number }, step: () => number = () => 4) => {
      const pts = [];
      for (let s = step(); s <= length; s += step()) pts.push(at(s));
      strokes.push(pts);
    };
    sample(2400, (s) => ({ x: s, z: 300 * Math.sin((s / 1200) * 2 * Math.PI) }));
    for (const length of [300, 900, 1500]) for (let deg = 0; deg <= 40; deg += 5) sample(length, swipe(START, deg));
    for (const wobble of [8, 20]) for (const deg of [10, 23, 35]) for (const phase of [0, 3]) for (const wave of [100, 250]) sample(900, swipe(START, deg, wobble, phase, wave));
    // Slow: 2 to 4 mm a point.
    for (const deg of [8, 23, -15]) sample(1200, swipe(START, deg, 4, 1, 200), () => 2 + 2 * rnd());
    for (let k = 0; k < 8; k++) {
      let x = 0;
      let z = 0;
      let h = (rnd() - 0.5) * 1.2;
      let turn = 0;
      const pts = [];
      for (let i = 0; i < 400; i++) {
        turn = turn * 0.9 + (rnd() - 0.5) * 0.02;
        h += turn;
        const st = 2 + 3 * rnd();
        x += st * Math.cos(h);
        z += st * Math.sin(h);
        pts.push({ x, z });
      }
      strokes.push(pts);
    }
    // Waves too sharp at their crests: the line waits there, then the stroke comes back within its reach a metre or
    // more on (this used to lay 20 pieces on one move).
    for (const [amp, wave, deg] of [[300, 600, 0], [400, 1200, 10], [300, 900, 10], [300, 1200, 0]]) {
      const a = (deg * Math.PI) / 180;
      sample(5000, (s) => {
        const v = amp * Math.sin((2 * Math.PI * s) / wave);
        return { x: s * Math.cos(a) - v * Math.sin(a), z: s * Math.sin(a) + v * Math.cos(a) };
      });
    }
    const run = () => {
      let worst = 0;
      let most = 0;
      let moves = 0;
      for (const pts of strokes) {
        const line = new DrawLine(START);
        for (const p of pts) {
          const n = line.pieces.length;
          const t0 = performance.now();
          line.addPoint(p.x, p.z);
          worst = Math.max(worst, performance.now() - t0);
          most = Math.max(most, line.pieces.length - n);
          moves++;
        }
        line.finish();
      }
      return { worst, most, moves };
    };
    run(); // warm up
    const { worst: first, most, moves } = run();
    expect(moves).toBeGreaterThan(20000);
    // At most a piece a move (the rest come on the moves after) ...
    expect(most).toBe(1);
    // ... and no move slow: about 0.3 ms at worst in Node, 4 to 5 ms when one laid 20 pieces (generous, for a slow CI).
    // A loaded machine (the whole suite at once) can stall one move, so the best of up to five runs counts.
    let worst = first;
    for (let k = 0; k < 4 && worst >= 8; k++) worst = Math.min(worst, run().worst);
    expect(worst).toBeLessThan(8);
  });

  it("the stroke ahead of the line moves when it's seen at another height (the line went up a level), and runs on from there", () => {
    const line = new DrawLine(START);
    for (let x = 4; x <= 600; x += 4) line.addPoint(x, 0);
    const before: number[] = [];
    const n = line.ahead(before);
    expect(n).toBeGreaterThan(10);
    line.shiftAhead(0, -40);
    const after: number[] = [];
    expect(line.ahead(after)).toBe(n);
    // The line's end stays; the points ahead of it move.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    for (let i = 2; i < 2 * n; i += 2) expect([after[i], after[i + 1]]).toEqual([before[i], before[i + 1] - 40]);
    // Drawn on from where the finger now is (seen at the new height), the line follows the moved stroke (anywhere in
    // the band either side of a straight one).
    for (let x = 604; x <= 1200; x += 4) line.addPoint(x, -40);
    line.finish();
    expect(line.end.x).toBeGreaterThan(1100);
    expect(Math.abs(line.end.z + 40)).toBeLessThanOrEqual(50);
  });

  it("over hills and the river (ramps and bridges come in), no pointer move is slow either, and none lays more than a piece", () => {
    // A map with a level-1 hill, a level-2 hill and a river across it (as the game checks them: the track's rules).
    const grid = gridWithPlots(-1, -1, 2, 2);
    const land: Landscape = { seed: 0, starter: false, grid, towns: [], corridors: [], fields: [], shed: null, depots: [], nextBuildingId: 0 };
    for (let x = -2196; x < 2232; x += 72)
      for (let z = -1620; z < 1656; z += 72) {
        const i = grid.cellAtWorld(x, z);
        if (x > 500 && x < 1300 && z > -700 && z < 300) grid.height[i] = z > -100 && x > 900 ? 2 : 1;
        if (x > -700 && x < -480) grid.surface[i] = SURF_RIVER;
      }
    grid.revision++;
    const layout = new Layout();
    const rules = { land, layout, props: null, footprint: () => undefined };
    const hills = hillsOf(grid);
    const options = {
      check: (c: DrawCandidate) => {
        const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
        const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
        return why ? { reason: why.reason, message: trackMessage(why.reason as BlockReason, why.levels), levels: why.levels } : null;
      },
      groundAt: (x: number, z: number) => hills.groundAt(x, z),
      wet: (x: number, z: number) => inRiver(grid, x, z),
    };
    // Strokes from the ground and from raised track, across the river, onto and off the hills, at a few angles.
    const strokes: { start: DrawEnd; pts: { x: number; z: number }[] }[] = [];
    for (const [x0, z0, y] of [[-1100, -200, 0], [-1100, 100, 0], [0, -300, 0], [-200, -200, RISER_HEIGHT], [700, -400, RISER_HEIGHT]])
      for (const deg of [0, 10, 23, 45, 180, -30]) {
        const a = (deg * Math.PI) / 180;
        const pts = [];
        for (let s = 4; s <= 1800; s += 4) pts.push({ x: x0 + s * Math.cos(a), z: z0 + s * Math.sin(a) + 20 * Math.sin(s / 90) });
        strokes.push({ start: { x: x0, z: z0, heading: Math.round(a / (Math.PI / 4)) * (Math.PI / 4), y, kind: "peg" }, pts });
      }
    const run = () => {
      let worst = 0;
      let most = 0;
      let specials = 0;
      const laying: number[] = [];
      for (const { start, pts } of strokes) {
        const line = new DrawLine(start, options);
        for (const p of pts) {
          const n = line.pieces.length;
          const t0 = performance.now();
          const changed = line.addPoint(p.x, p.z);
          const dt = performance.now() - t0;
          worst = Math.max(worst, dt);
          if (changed) laying.push(dt);
          most = Math.max(most, line.pieces.length - n);
        }
        line.finish();
        specials += line.pieces.filter((p) => p.type === "ramp" || p.type.startsWith("bridge")).length;
      }
      laying.sort((p, q) => p - q);
      return { worst, most, specials, median: laying[laying.length >> 1], p95: laying[Math.floor(laying.length * 0.95)] };
    };
    // Warmed up twice: the engine compiles the drawing code in tiers over the first runs (a move of 10 ms or more then).
    run();
    run();
    const first = run();
    // The ramps and bridges were met (else this times nothing new) ...
    expect(first.specials).toBeGreaterThan(10);
    // ... a piece a move at most (taking a straight back for a ramp counts as the one) ...
    expect(first.most).toBeLessThanOrEqual(1);
    // ... and no move slow: a laying move about 0.1 ms (median) and 0.3 ms (p95) in Node, the worst about 1 ms (generous,
    // for a slow CI; the best of up to three runs counts, as above).
    let worst = first.worst;
    let median = first.median;
    // A loaded machine (the whole suite at once) stalls a move now and then: the best of up to five runs counts.
    for (let k = 0; k < 4 && (worst >= 8 || median >= 1); k++) {
      const again = run();
      worst = Math.min(worst, again.worst);
      median = Math.min(median, again.median);
    }
    expect(worst).toBeLessThan(8);
    expect(median).toBeLessThan(1);
  });

  it("a corner sharper than any piece turns leaves the line stalled (so the player can be told), not a straight on", () => {
    const line = new DrawLine({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let x = 0; x <= 300; x += 4) line.addPoint(x, 0);
    expect(line.stalled).toBe(false);
    // Back at 150° from the way it was going, and on.
    const h = (150 * Math.PI) / 180;
    let stalled = false;
    for (let d = 4; d <= 700; d += 4) {
      line.addPoint(300 + d * Math.cos(h), d * Math.sin(h));
      stalled ||= line.stalled;
    }
    expect(stalled).toBe(true);
    // A gentle line never stalls.
    const easy = new DrawLine({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    let ever = false;
    for (let x = 0; x <= 1500; x += 4) {
      easy.addPoint(x, 20 * Math.sin(x / 200));
      ever ||= easy.stalled;
    }
    expect(ever).toBe(false);
  });
});
