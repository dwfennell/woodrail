import { describe, expect, it } from "vitest";
import { candidatesFrom, DrawLine, startHeading, type DrawEnd } from "./draw-path";
import { Layout } from "./layout";
import { getPieceDef } from "./pieces";
import { angleDiff } from "./math";

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

  /** A straight stroke from the origin at `deg` degrees, `noise` mm of jitter to either side (the same each run). */
  const slanted = (deg: number, noise = 0) => {
    const a = (deg * Math.PI) / 180;
    let seed = 12345;
    return (s: number) => {
      seed = (seed * 16807) % 2147483647;
      const n = noise * ((2 * seed) / 2147483647 - 1);
      return { x: s * Math.cos(a) - n * Math.sin(a), z: s * Math.sin(a) + n * Math.cos(a) };
    };
  };
  const eighth = Math.PI / 4;

  it("a straight swipe slanted off the line's heading lays straights along an eighth heading, not curves chasing it (QA N1)", () => {
    for (const deg of [0, 10, 20, 23, 30, 40])
      for (const length of [600, 750, 900]) {
        const name = `${deg}°, ${length} mm`;
        const line = draw(new DrawLine(START), length, slanted(deg));
        const types = line.pieces.map((p) => p.type);
        // Up to 22.5° and a little over: straights all along the end's heading.
        if (deg <= 23) {
          expect(types.every((t) => t.startsWith("straight")), `${name}: ${types}`).toBe(true);
          for (const p of line.pieces) expect(angleDiff(p.end.heading, 0), name).toBeLessThan(1e-6);
        } else {
          // Further off: one eighth-turn curve first, then straights along the next eighth.
          expect(types[0].startsWith("curve"), `${name}: ${types}`).toBe(true);
          expect(types.slice(1).every((t) => t.startsWith("straight")), `${name}: ${types}`).toBe(true);
          for (const p of line.pieces) expect(angleDiff(p.end.heading, eighth), name).toBeLessThan(1e-6);
        }
        // As far along that heading as the stroke reaches.
        const h = line.end.heading;
        const reach = length * Math.cos((deg * Math.PI) / 180 - h);
        expect(Math.abs(line.end.x * Math.cos(h) + line.end.z * Math.sin(h) - reach), `${name}: ${types}`).toBeLessThan(50);
        expectJoined(line);
      }
  });

  it("a straight swipe from open ground lays straights along the nearest eighth heading (QA N1)", () => {
    for (const deg of [0, 10, 20, 23, 30, 40, 60, 80])
      for (const length of [600, 900]) {
        // A new line starts heading the way the finger set off, rounded to an eighth (as DrawHand starts it).
        const heading = startHeading(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180));
        const line = draw(new DrawLine({ ...START, heading }), length, slanted(deg));
        const types = line.pieces.map((p) => p.type);
        expect(types.every((t) => t.startsWith("straight")), `${deg}°: ${types}`).toBe(true);
        expect(angleDiff(line.end.heading, Math.round(deg / 45) * eighth), `${deg}°`).toBeLessThan(1e-6);
      }
  });

  it("a wobbly straight swipe (±6 mm jitter) at 20° still lays only straights (QA N1)", () => {
    for (const length of [600, 900]) {
      const line = draw(new DrawLine(START), length, slanted(20, 6));
      const types = line.pieces.map((p) => p.type);
      expect(types.every((t) => t.startsWith("straight")), `${length}: ${types}`).toBe(true);
      expect(angleDiff(line.end.heading, 0)).toBeLessThan(1e-6);
    }
  });

  it("a straight lead-in then a real quarter turn still lays the bend", () => {
    for (const sign of [1, -1] as const) {
      const lead = 300;
      const r = 180;
      const at = (s: number) => (s < lead ? { x: s, z: 0 } : { x: lead + r * Math.sin((s - lead) / r), z: sign * r * (1 - Math.cos((s - lead) / r)) });
      const line = draw(new DrawLine(START), lead + (r * Math.PI) / 2, at);
      const types = line.pieces.map((p) => p.type);
      expect(types.filter((t) => t.startsWith("curve")), `${types}`).toEqual(["curve-large", "curve-large"]);
      expect(angleDiff(line.end.heading, (sign * Math.PI) / 2)).toBeLessThan(0.01);
    }
  });

  it("going back over a slanted swipe takes off the straights laid for it, though they lie off to its side", () => {
    const at = slanted(23);
    const line = new DrawLine(START);
    for (let s = 4; s <= 900; s += 4) line.addPoint(at(s).x, at(s).z);
    expect(line.pieces.length).toBeGreaterThan(1);
    for (let s = 900; s >= 0; s -= 4) line.addPoint(at(s).x, at(s).z);
    line.finish();
    expect(line.pieces).toHaveLength(0);
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
    const line = draw(new DrawLine(START, { check: (c) => (c.pose.x < 400 ? null : "in the way") }), 1000, (s) => ({ x: s, z: 0 }));
    expect(line.stopped).toBe("blocked");
    expect(line.pieces[line.pieces.length - 1].blocked).toBe("in the way");
    expect(line.placeable().every((p) => p.pose.x < 400)).toBe(true);
  });

  it("uses only the pieces allowed (Game mode stock)", () => {
    const line = draw(new DrawLine(START, { allow: (t, l) => t === "straight-144" && l.length < 3 }), 1000, (s) => ({ x: s, z: 0 }));
    expect(line.pieces.map((p) => p.type)).toEqual(["straight-144", "straight-144", "straight-144"]);
    expect(line.refused).not.toBeNull();
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
