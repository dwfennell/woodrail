import { describe, expect, it } from "vitest";
import { candidatesFrom, DrawLine, type DrawEnd } from "./draw-path";
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

  it("stops at a piece that can't go there, and lays only up to it", () => {
    const line = draw(new DrawLine(START, { check: (c) => c.pose.x < 400 }), 1000, (s) => ({ x: s, z: 0 }));
    expect(line.stopped).toBe("blocked");
    expect(line.pieces[line.pieces.length - 1].blocked).toBe(true);
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
});
