import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { normalizeAngle, type Pose } from "./math";
import { findOverlap } from "./overlap";
import { appendPiece } from "./snap";
import { findBranch, findCrossing, findCurveSwap, findMerge, findThreeWay, findSplice, findSpliceThatFits, gapFill, isPlainStraight, straightLength, straightsFor, type PieceSwap } from "./splice";
import { getPieceDef, type PieceTypeId } from "./pieces";

const P = (x: number, z: number, heading = 0): Pose => ({ x, z, heading });

/** Straights laid end to end from the origin along +x, each joined to the last. */
function line(l: Layout, types: PieceTypeId[]): number[] {
  const ids = [l.addPiece(types[0], P(0, 0))];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(l, types[i], false, connectorRef(ids[i - 1], 1)));
  return ids;
}

describe("straightLength / isPlainStraight", () => {
  it("knows straight-shaped pieces (depots and stations too), and only plain straights are dropped onto", () => {
    expect(straightLength("straight-216", false)).toBe(216);
    expect(straightLength("depot-workshop", false)).toBe(216);
    expect(straightLength("station", false)).toBe(216);
    expect(straightLength("curve-large", false)).toBe(0);
    expect(straightLength("ramp", false)).toBe(0);
    expect(isPlainStraight("straight-108")).toBe(true);
    expect(isPlainStraight("signal")).toBe(false);
    expect(isPlainStraight("bridge")).toBe(false);
    expect(isPlainStraight("depot-workshop")).toBe(false);
  });
});

describe("findSplice", () => {
  it("a depot held over a long straight takes its place 1:1, lying along the line", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // Held a little off the middle straight's centre, turned a little from the line.
    const s = findSplice(l, "depot-workshop", false, { x: 330, z: 12 }, 0.3, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(216);
    expect(s.pose.z).toBeCloseTo(0);
    expect(s.pose.heading).toBeCloseTo(0);
    expect(s.y).toBe(0);
    // It doesn't overlap the straights either side once the one it covers is left out.
    expect(findOverlap(l, "depot-workshop", false, s.pose, s.y, new Set(s.covers))).toBe(-1);
    expect(findOverlap(l, "depot-workshop", false, s.pose, s.y, -1)).toBe(mid);
  });

  it("held the other way round, it lies along the line the other way (its building on the other side)", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    const s = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, Math.PI - 0.2, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(432);
    expect(s.pose.z).toBeCloseTo(0);
    expect(Math.abs(s.pose.heading)).toBeCloseTo(Math.PI);
  });

  it("held square across the line, turning it right round (Flip) always swaps which way it lies", () => {
    const l = new Layout();
    line(l, ["straight-216", "straight-216", "straight-216"]);
    for (const held of [Math.PI / 2, -Math.PI / 2, 0.3, 2]) {
      const s = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, held, 40);
      const t = findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, held + Math.PI, 40);
      if (s.kind !== "splice" || t.kind !== "splice") throw new Error("no splice");
      expect(Math.abs(Math.abs(s.pose.heading - t.pose.heading) - Math.PI)).toBeLessThan(1e-9);
    }
  });

  it("looks for the held centre at each straight's own height (the finger points elsewhere higher up)", () => {
    const l = new Layout();
    const low = l.addPiece("straight-216", P(0, 0));
    const high = l.addPiece("straight-216", P(0, 300), 48);
    // Seen from the side: at the ground the finger is over the low straight, 48 up it's over the high one.
    const ground = findSplice(l, "depot-workshop", false, (y) => (y === 0 ? { x: 100, z: 5 } : { x: 100, z: 200 }), 0, 40);
    expect(ground.kind === "splice" && ground.covers).toEqual([low]);
    const up = findSplice(l, "depot-workshop", false, (y) => (y === 0 ? { x: 100, z: 150 } : { x: 100, z: 296 }), 0, 40);
    expect(up.kind === "splice" && up.covers).toEqual([high]);
    expect(up.kind === "splice" && up.y).toBe(48);
  });

  it("over two short straights, it takes the place of both (a run its length)", () => {
    const l = new Layout();
    const ids = line(l, ["straight-216", "straight-108", "straight-108", "straight-216"]);
    const s = findSplice(l, "depot-workshop", false, { x: 290, z: 0 }, 0, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([ids[1], ids[2]]);
    expect(s.pose.x).toBeCloseTo(216);
  });

  it("of the runs its length, it takes the one centred nearest where it's held", () => {
    const l = new Layout();
    const ids = line(l, ["straight-108", "straight-108", "straight-108", "straight-108"]);
    // Over the second straight, nearer its far end: the second and third (centred at 216), not the first two (108).
    const s = findSplice(l, "depot-workshop", false, { x: 200, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.covers).toEqual([ids[1], ids[2]]);
    // Nearer its near end: the first two.
    const t = findSplice(l, "depot-workshop", false, { x: 120, z: 0 }, 0, 40);
    expect(t.kind === "splice" && t.covers).toEqual([ids[0], ids[1]]);
  });

  it("says when no run of straights there is its length (too short a straight between curves)", () => {
    const l = new Layout();
    const [s144] = line(l, ["straight-144"]);
    appendPiece(l, "curve-large", false, connectorRef(s144, 1));
    expect(findSplice(l, "depot-workshop", false, { x: 72, z: 0 }, 0, 40)).toEqual({ kind: "misfit", onto: s144 });
  });

  it("on too long a straight, takes its length of it and a shorter straight fills the rest (a 216 depot on a 288: a 72)", () => {
    const m = new Layout();
    const [s288] = line(m, ["straight-288"]);
    const s = findSplice(m, "depot-workshop", false, { x: 100, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.covers).toEqual([s288]);
    expect(s.kind === "splice" && s.rest?.map((r) => r.type)).toEqual(["straight-72"]);
  });

  it("won't take up a straight a train stands on, nor reach past one", () => {
    const l = new Layout();
    const ids = line(l, ["straight-108", "straight-108", "straight-108"]);
    expect(findSplice(l, "depot-workshop", false, { x: 54, z: 0 }, 0, 40, (id) => id !== ids[0])).toEqual({ kind: "busy", onto: ids[0] });
    // Over the middle with the first busy: only the run ahead (middle and last) will do.
    const s = findSplice(l, "depot-workshop", false, { x: 150, z: 0 }, 0, 40, (id) => id !== ids[0]);
    expect(s.kind === "splice" && s.covers).toEqual([ids[1], ids[2]]);
  });

  it("finds nothing away from straights, or for a piece that isn't straight", () => {
    const l = new Layout();
    line(l, ["straight-216"]);
    expect(findSplice(l, "depot-workshop", false, { x: 108, z: 90 }, 0, 40).kind).toBe("none");
    expect(findSplice(l, "curve-large", false, { x: 108, z: 0 }, 0, 40).kind).toBe("none");
    const c = new Layout();
    c.addPiece("curve-large", P(0, 0));
    expect(findSplice(c, "depot-workshop", false, { x: 100, z: 10 }, 0, 40).kind).toBe("none");
  });

  it("held across a straight with its middle 100 mm off the line, its track crosses it: it takes that straight", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // Square across, and slanting either way (steep enough that its track, 216 mm long, reaches the line).
    for (const heading of [Math.PI / 2, -Math.PI / 2, 0.42 * Math.PI, 0.6 * Math.PI, -0.4 * Math.PI]) {
      // Its middle 100 mm to the side of the line, on whichever side its track crosses.
      const side = Math.sin(heading) > 0 ? 100 : -100;
      const s = findSplice(l, "depot-workshop", false, { x: 324 + side / Math.tan(heading), z: side }, heading, 40);
      expect(s.kind === "splice" && s.covers).toEqual([mid]);
      if (s.kind !== "splice") continue;
      expect(s.pose.z).toBeCloseTo(0);
      expect(Math.min(Math.abs(s.pose.x - 216), Math.abs(s.pose.x - 432))).toBeCloseTo(0);
    }
    // A train on it says so, rather than nothing.
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 100 }, Math.PI / 2, 40, (id) => id !== mid)).toEqual({ kind: "busy", onto: mid });
    // Its track ending short of the line (slanting too little to reach it): nothing.
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 100 }, Math.PI / 6, 40).kind).toBe("none");
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 160 }, Math.PI / 2, 40).kind).toBe("none");
  });

  it("of straights under its track, it takes the one met nearest its middle", () => {
    const l = new Layout();
    const near = l.addPiece("straight-216", P(0, 0));
    const far = l.addPiece("straight-216", P(0, 90));
    // Held square across both lines, its middle 20 mm from the first and 70 from the second.
    const s = findSplice(l, "depot-workshop", false, { x: 108, z: 20 }, Math.PI / 2, 40);
    expect(s.kind === "splice" && s.covers).toEqual([near]);
    const t = findSplice(l, "depot-workshop", false, { x: 108, z: 70 }, Math.PI / 2, 40);
    expect(t.kind === "splice" && t.covers).toEqual([far]);
  });

  it("follows the line round any turn (a line along z)", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", P(0, 0, Math.PI / 2));
    const b = appendPiece(l, "straight-216", false, connectorRef(a, 1));
    const s = findSplice(l, "depot-workshop", false, { x: 3, z: 330 }, Math.PI / 2, 40);
    expect(s.kind === "splice" && s.covers).toEqual([b]);
    if (s.kind !== "splice") return;
    expect(s.pose.x).toBeCloseTo(0);
    expect(s.pose.z).toBeCloseTo(216);
    expect(s.pose.heading).toBeCloseTo(Math.PI / 2);
  });
});

describe("gapFill (the gap a depot leaves in a line)", () => {
  /** Straight, depot, straight along +x; then the depot taken out (lifted, as when it's picked up). */
  function inline() {
    const l = new Layout();
    const [a, d, b] = line(l, ["straight-216", "depot-workshop", "straight-216"]);
    const ends = [l.joinedConnector(connectorRef(d, 0)), l.joinedConnector(connectorRef(d, 1))] as const;
    l.liftPiece(d);
    return { l, a, d, b, ends };
  }

  it("fills it 1:1 with a long straight, from one end to the other, aligned to the gap", () => {
    const { l, a, b, ends } = inline();
    expect(ends).toEqual([connectorRef(a, 1), connectorRef(b, 0)]);
    const fill = gapFill(l, ends[0], ends[1]);
    expect(fill).toHaveLength(1);
    expect(fill![0].type).toBe("straight-216");
    expect(fill![0].pose.x).toBeCloseTo(216);
    expect(fill![0].pose.z).toBeCloseTo(0);
    expect(fill![0].pose.heading).toBeCloseTo(0);
    expect(fill![0].y).toBe(0);
    // Put down, it joins both ends.
    const id = l.addPiece(fill![0].type, fill![0].pose, fill![0].y);
    expect(l.joinedConnector(connectorRef(id, 0))).toBe(connectorRef(a, 1));
    expect(l.joinedConnector(connectorRef(id, 1))).toBe(connectorRef(b, 0));
  });

  it("on a line running any way round, the fill lies along it", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", P(0, 0, 2.2));
    const d = appendPiece(l, "depot-workshop", false, connectorRef(a, 1));
    const b = appendPiece(l, "straight-216", false, connectorRef(d, 1));
    const ends = [l.joinedConnector(connectorRef(d, 0)), l.joinedConnector(connectorRef(d, 1))];
    l.liftPiece(d);
    const fill = gapFill(l, ends[0], ends[1])!;
    const id = l.addPiece(fill[0].type, fill[0].pose, fill[0].y);
    expect(l.joinedConnector(connectorRef(id, 0))).toBe(connectorRef(a, 1));
    expect(l.joinedConnector(connectorRef(id, 1))).toBe(connectorRef(b, 0));
  });

  it("not once the gap is closed again, or an end has gone, or the ends don't face along one line", () => {
    const { l, d, b, ends } = inline();
    // Put back where it was: nothing to fill.
    l.dropPiece(d, P(216, 0), 0);
    expect(gapFill(l, ends[0], ends[1])).toBeNull();
    l.liftPiece(d);
    expect(gapFill(l, ends[0], ends[1])).not.toBeNull();
    // The far straight taken away, or one turned off the line.
    l.removePiece(b);
    expect(gapFill(l, ends[0], ends[1])).toBeNull();
    const c = l.addPiece("straight-216", P(432, 0, 0.3));
    expect(gapFill(l, ends[0], connectorRef(c, 0))).toBeNull();
  });

  it("uses straights the splice takes: one its length, else two, as even as can be; none for lengths they can't make", () => {
    expect(straightsFor(216)).toEqual(["straight-216"]);
    expect(straightsFor(216.3)).toEqual(["straight-216"]);
    expect(straightsFor(288)).toEqual(["straight-288"]);
    expect(straightsFor(432)).toEqual(["straight-216", "straight-216"]);
    expect(straightsFor(20)).toBeNull();
    expect(straightsFor(1000)).toBeNull();
    expect(straightsFor(360)).toEqual(["straight-180", "straight-180"]);
  });
});

/** Put a swap down in a copy of what it's in: covers up, its pieces down (to see that it joins up). */
function apply(l: Layout, w: PieceSwap): number[] {
  for (const id of w.covers) l.removePiece(id);
  return w.pieces.map((p) => l.addPiece(p.type, p.pose, p.y, p.flipped));
}

describe("findBranch (a switch swapped into a line, for a drawn branch)", () => {
  it("off a straight, its branch to the side the stroke leaves (both hands), facing the way it goes, joined in", () => {
    for (const [deg, side, facing] of [[45, 1, 1], [-45, -1, 1], [135, 1, -1], [-135, -1, -1], [60, 1, 1], [-30, -1, 1]] as const) {
      const l = new Layout();
      line(l, ["straight-216", "straight-216", "straight-216"]);
      const joints = l.jointCount;
      const w = findBranch(l, 1, 324, 0, (deg * Math.PI) / 180);
      expect(w.kind, `${deg}°`).toBe("swap");
      if (w.kind !== "swap") continue;
      expect(w.pieces[0].type).toBe("switch");
      // The branch end is to the stroke's side, its leg running off at 45° the stroke's way.
      expect(Math.sign(w.end.z), `${deg}°`).toBe(side);
      expect(Math.sign(Math.cos(w.end.heading)), `${deg}°`).toBe(facing);
      expect(Math.abs(Math.abs(w.end.heading) - (facing === 1 ? Math.PI / 4 : (3 * Math.PI) / 4))).toBeLessThan(1e-6);
      // Put down, the run is whole again: every joint as before, and the branch end free.
      const ids = apply(l, w);
      expect(ids.length).toBe(w.pieces.length);
      expect(l.jointCount, `${deg}°`).toBe(joints + 1 - w.covers.length + w.pieces.length - 1);
    }
  });

  it("covers whole straights where that's nearly as near, and fills what's left with plain straights otherwise", () => {
    const l = new Layout();
    line(l, ["straight-144", "straight-144", "straight-144"]);
    const w = findBranch(l, 1, 216, 0, Math.PI / 4);
    expect(w.kind).toBe("swap");
    if (w.kind !== "swap") return;
    expect(w.pieces.map((p) => p.type)).toEqual(["switch"]);
    const m = new Layout();
    line(m, ["straight-216", "straight-216", "straight-216"]);
    const v = findBranch(m, 1, 300, 0, Math.PI / 4);
    if (v.kind !== "swap") throw new Error(v.kind);
    // Lengths left over are plain straights, 36 mm or more.
    for (const p of v.pieces.slice(1)) expect(isPlainStraight(p.type)).toBe(true);
    const total = v.pieces.slice(1).reduce((t, p) => t + straightLength(p.type, false), 144);
    expect(total).toBe(v.covers.length * 216);
  });

  it("square off the line, it faces the line's nearer free end", () => {
    for (const far of [1, -1]) {
      const l = new Layout();
      const ids = line(l, ["straight-216", "straight-216", "straight-216"]);
      // More track beyond one end (curves: not part of the run), so the other end is nearer.
      let ref = far === 1 ? connectorRef(ids[2], 1) : connectorRef(ids[0], 0);
      for (let k = 0; k < 3; k++) {
        const id = appendPiece(l, "curve-large", false, ref, far === 1 ? 0 : 1);
        ref = connectorRef(id, far === 1 ? 1 : 0);
      }
      const w = findBranch(l, ids[1], 324, 0, Math.PI / 2);
      if (w.kind !== "swap") throw new Error(w.kind);
      expect(Math.sign(Math.cos(w.end.heading)), `more track ${far === 1 ? "on" : "back"}`).toBe(-far);
    }
  });

  it("is refused when a train is on the straight it would take up", () => {
    const l = new Layout();
    line(l, ["straight-216", "straight-216", "straight-216"]);
    expect(findBranch(l, 1, 324, 0, Math.PI / 4, (id) => id !== 1)).toEqual({ kind: "busy", onto: 1 });
  });
});

describe("findMerge (a drawn line coming in to a line at 45°)", () => {
  it("meets the branch end of a switch swapped in there, straight away or through a straight on the line's heading", () => {
    for (const link of [0, 36, 108, 216]) {
      const l = new Layout();
      line(l, ["straight-216", "straight-216", "straight-216", "straight-216"]);
      const b = findBranch(l, 1, 324, 0, Math.PI / 4);
      if (b.kind !== "swap") throw new Error(b.kind);
      // A line's end that far out along the branch, coming in.
      const e = { x: b.end.x + Math.cos(b.end.heading) * link + 3, z: b.end.z + Math.sin(b.end.heading) * link - 2, heading: b.end.heading + Math.PI, y: 0 };
      const m = findMerge(l, e, 330, 10);
      expect(m, `${link}`).not.toBeNull();
      if (!m) continue;
      expect(m.links.map((l) => l.type)).toEqual(link ? [`straight-${link}`] : []);
      expect(Math.hypot(m.swap.end.x - b.end.x, m.swap.end.z - b.end.z)).toBeLessThan(10);
    }
  });

  it("not when the finger was let go away from the line, or the line comes in square to it", () => {
    const l = new Layout();
    line(l, ["straight-216", "straight-216", "straight-216"]);
    const b = findBranch(l, 1, 324, 0, Math.PI / 4);
    if (b.kind !== "swap") throw new Error(b.kind);
    const e = { x: b.end.x + Math.cos(b.end.heading) * 72, z: b.end.z + Math.sin(b.end.heading) * 72, heading: b.end.heading + Math.PI, y: 0 };
    expect(findMerge(l, e, 330, 200)).toBeNull();
    expect(findMerge(l, { ...e, heading: -Math.PI / 2 }, 330, 10)).toBeNull();
    expect(findMerge(l, e, 330, 10, () => false)).toBeNull();
  });
});

describe("findSplice: a short kit on a longer straight", () => {
  it("takes the half of a 216 nearer where it's held, and a 108 straight fills the other half", () => {
    const l = new Layout();
    const [, mid] = line(l, ["straight-216", "straight-216", "straight-216"]);
    // The middle straight runs 216..432. Held over its first half: the kit there, the rest from 324.
    const s = findSplice(l, "kit-water-tower", false, { x: 260, z: 6 }, 0, 40);
    expect(s.kind).toBe("splice");
    if (s.kind !== "splice") return;
    expect(s.covers).toEqual([mid]);
    expect(s.pose.x).toBeCloseTo(216, 3);
    expect(s.rest?.map((r) => r.type)).toEqual(["straight-108"]);
    expect(s.rest![0].pose.x).toBeCloseTo(324, 3);
    // Held over its second half: the rest at the start, the kit from 324.
    const t = findSplice(l, "kit-water-tower", false, { x: 400, z: 6 }, 0, 40);
    expect(t.kind === "splice" && t.rest![0].pose.x).toBeCloseTo(216, 3);
    expect(t.kind === "splice" && t.pose.x).toBeCloseTo(324, 3);
    // Neither overlaps the other: kit and rest end to end over the straight.
    if (t.kind === "splice") expect(findOverlap(l, "kit-water-tower", false, t.pose, 0, mid)).toBe(-1);
  });

  it("a kit as long as a run still takes the run (no rest)", () => {
    const l = new Layout();
    line(l, ["straight-108", "straight-108", "straight-108"]);
    const s = findSplice(l, "kit-water-tower", false, { x: 160, z: 0 }, 0, 40);
    expect(s.kind === "splice" && s.rest).toBeUndefined();
  });
});

describe("findCrossing (a drawn line going on across a line at 90° or 45°)", () => {
  it("swaps a crossing into the line where the drawn line meets it, the drawn line in at one end of its cross path and on from the other", () => {
    for (const [deg, type] of [[90, "crossing"], [-90, "crossing"], [45, "crossing-45"], [135, "crossing-45"], [-45, "crossing-45"]] as const) {
      for (const gap of [72, 144, 216]) {
        const l = new Layout();
        line(l, ["straight-216", "straight-216", "straight-216", "straight-216"]);
        const a = (deg * Math.PI) / 180;
        // The line's end `gap` mm short of the crossing's near end (half the crossing short of where its heading meets
        // the run's centre line).
        const hit = { x: 432 + 7, z: 0 };
        const back = gap + 72;
        const e = { x: hit.x - Math.cos(a) * back, z: hit.z - Math.sin(a) * back, heading: a, y: 0 };
        const c = findCrossing(l, e);
        expect(c, `${deg}° ${gap}`).not.toBeNull();
        if (!c) continue;
        expect(c.swap.pieces[0].type, `${deg}° ${gap}`).toBe(type);
        // In facing the line's end; out the far side, the same way.
        expect(Math.abs(normalizeAngle(c.swap.end.heading - a - Math.PI)), `${deg}° ${gap}`).toBeLessThan(0.05);
        expect(Math.abs(normalizeAngle(c.swap.exit!.heading - a)), `${deg}° ${gap}`).toBeLessThan(0.05);
        expect(Math.sign(c.swap.exit!.z * Math.sign(Math.sin(a)))).toBe(1);
        // Put down with its straights, the old line and the drawn line are both whole.
        const ids = apply(l, c.swap);
        expect(ids.length).toBe(c.swap.pieces.length);
      }
    }
  });

  it("not along the line, nor where it would take up a straight a train is on", () => {
    const l = new Layout();
    line(l, ["straight-216", "straight-216", "straight-216"]);
    expect(findCrossing(l, { x: 0, z: 100, heading: 0, y: 0 })).toBeNull();
    expect(findCrossing(l, { x: 324, z: -150, heading: Math.PI / 2, y: 0 }, () => false)).toBeNull();
  });
});

describe("findCurveSwap (a branch off a large curve) and findThreeWay (off a switch's open side)", () => {
  /** A straight, a large curve (either hand), a straight: the curve's id. */
  function curved(l: Layout, flipped: boolean): number {
    const a = l.addPiece("straight-216", P(0, 0), 0);
    const c = appendPiece(l, "curve-large", flipped, connectorRef(a, 1));
    appendPiece(l, "straight-216", false, connectorRef(c, 1));
    return c;
  }

  it("a curve becomes a switch (the new line straight on) or a Y (the new line curving the other way), joints kept, set to the old line", () => {
    for (const flipped of [false, true]) {
      const turn = flipped ? -1 : 1;
      // Straight on from where the curve starts: a switch, its branch the old curve.
      let l = new Layout();
      let c = curved(l, flipped);
      const joints = l.jointCount;
      const w = findCurveSwap(l, c, 260, 0, 0);
      if (w.kind !== "swap") throw new Error(w.kind);
      expect(w.pieces[0].type).toBe("switch");
      expect(w.pieces[0].state).toBe(1);
      expect(Math.abs(normalizeAngle(w.end.heading))).toBeLessThan(1e-6);
      apply(l, w);
      expect(l.jointCount).toBe(joints);
      // Curving the other way: a Y, one leg the old curve.
      l = new Layout();
      c = curved(l, flipped);
      const y = findCurveSwap(l, c, 260, -turn * 20, (-turn * Math.PI) / 4);
      if (y.kind !== "swap") throw new Error(y.kind);
      expect(y.pieces[0].type).toBe("switch-y");
      expect(Math.sign(normalizeAngle(y.end.heading))).toBe(-turn);
      apply(l, y);
      expect(l.jointCount).toBe(joints);
    }
  });

  it("a switch becomes a three-way when the stroke leaves on its open side, joints kept, set as it was", () => {
    for (const flipped of [false, true]) {
      for (const state of [0, 1]) {
        const l = new Layout();
        const a = l.addPiece("straight-216", P(0, 0), 0);
        const sw = appendPiece(l, "switch", flipped, connectorRef(a, 1));
        appendPiece(l, "straight-216", false, connectorRef(sw, 1));
        appendPiece(l, "curve-large", flipped, connectorRef(sw, 2));
        l.setSwitchState(sw, state);
        const joints = l.jointCount;
        const open = flipped ? Math.PI / 4 : -Math.PI / 4;
        // Not on the branch's own side.
        expect(findThreeWay(l, sw, -open).kind).toBe("none");
        const w = findThreeWay(l, sw, open);
        if (w.kind !== "swap") throw new Error(w.kind);
        expect(w.pieces[0].type).toBe("switch-3way");
        expect(Math.abs(normalizeAngle(w.end.heading - open))).toBeLessThan(1e-6);
        // Set as it was: straight on, or the same curve.
        const id = apply(l, w)[0];
        if (w.pieces[0].state) l.setSwitchState(id, w.pieces[0].state);
        expect(l.jointCount).toBe(joints);
        const path = getPieceDef("switch-3way", false).paths[l.switchState(id)];
        expect(path.to).toBe(state === 0 ? 1 : flipped ? 3 : 2);
      }
    }
  });
});

describe("findSpliceThatFits: held at a joint, the straight it can go on", () => {
  // A line of three 216s from x 0: joints at 216 and 432. A Harvester held along the line.
  const setup = () => {
    const l = new Layout();
    const ids = line(l, ["straight-216", "straight-216", "straight-216"]);
    return { l, ids };
  };
  const covered = (s: ReturnType<typeof findSplice>) => (s.kind === "splice" ? s.covers : s.kind);

  it("where it fits, it's the straight findSplice picks (the other side isn't asked about)", () => {
    const { l, ids } = setup();
    const asked: number[][] = [];
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 324, z: 0 }, 0, 40, () => true, (f) => (asked.push([...f.covers]), true));
    expect(covered(s)).toEqual([ids[1]]);
    expect(asked).toEqual([[ids[1]]]);
  });

  it("at a joint, where the straight picked won't do (too few trees), it takes the one the other side", () => {
    const { l, ids } = setup();
    const first = findSplice(l, "depot-forest", false, { x: 216, z: 0 }, 0, 40);
    expect(first.kind).toBe("splice");
    if (first.kind !== "splice") return;
    const other = first.covers[0] === ids[0] ? ids[1] : ids[0];
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 216, z: 0 }, 0, 40, () => true, (f) => f.covers[0] === other);
    expect(covered(s)).toEqual([other]);
    // A little either side of the joint too (the finger's never exactly on it).
    for (const x of [200, 230]) {
      const t = findSpliceThatFits(l, "depot-forest", false, { x, z: 0 }, 0, 40, () => true, (f) => f.covers[0] === ids[0]);
      expect(covered(t), `held at ${x}`).toEqual([ids[0]]);
      const u = findSpliceThatFits(l, "depot-forest", false, { x, z: 0 }, 0, 40, () => true, (f) => f.covers[0] === ids[1]);
      expect(covered(u), `held at ${x}`).toEqual([ids[1]]);
    }
  });

  it("on touch, the finger on the joint counts (the piece is drawn above the finger, its middle off the joint)", () => {
    const { l, ids } = setup();
    // Held with its middle 80 mm into the second straight; the finger on the joint, or a finger's width (60) off it.
    const fits = (f: { covers: readonly number[] }) => f.covers[0] === ids[0];
    expect(covered(findSpliceThatFits(l, "depot-forest", false, { x: 296, z: 0 }, 0, 40, () => true, fits))).toEqual([ids[1]]);
    expect(covered(findSpliceThatFits(l, "depot-forest", false, { x: 296, z: 0 }, 0, 40, () => true, fits, { x: 220, z: 30 }))).toEqual([ids[0]]);
    expect(covered(findSpliceThatFits(l, "depot-forest", false, { x: 296, z: 0 }, 0, 40, () => true, fits, { x: 260, z: 0 }, 60))).toEqual([ids[0]]);
    expect(covered(findSpliceThatFits(l, "depot-forest", false, { x: 296, z: 0 }, 0, 40, () => true, fits, { x: 290, z: 0 }, 60))).toEqual([ids[1]]);
  });

  it("held square across the line, its track over one straight only, the finger on the joint: the other side too", () => {
    const { l, ids } = setup();
    const fits = (f: { covers: readonly number[] }) => f.covers[0] === ids[0];
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 290, z: 0 }, Math.PI / 2, 40, () => true, fits, { x: 216, z: 40 }, 60);
    expect(covered(s)).toEqual([ids[0]]);
    // Its building on the side it was held to, as on any straight.
    const plain = findSplice(l, "depot-forest", false, { x: 108, z: 0 }, Math.PI / 2, 40);
    expect(s.kind === "splice" && plain.kind === "splice" && s.pose).toEqual(plain.kind === "splice" && plain.pose);
  });

  it("not onto another line beside it, however near (only the other side of a joint)", () => {
    const l = new Layout();
    const a = l.addPiece("straight-216", P(0, 0));
    const b = l.addPiece("straight-216", P(0, 30));
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 108, z: 15 }, 0, 40, () => true, (f) => f.covers[0] !== a && f.covers[0] !== b);
    expect(s.kind).toBe("splice");
    const t = findSpliceThatFits(l, "depot-forest", false, { x: 108, z: 15 }, 0, 40, () => true, (f) => !(s.kind === "splice" && f.covers[0] === s.covers[0]));
    expect(t).toEqual(s);
  });

  it("held over a straight's middle, it never hops along to the next: it's refused there (the reason is said)", () => {
    const { l, ids } = setup();
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 324, z: 0 }, 0, 40, () => true, (f) => f.covers[0] !== ids[1]);
    expect(covered(s)).toEqual([ids[1]]);
  });

  it("where neither side fits, it's the straight findSplice picks (and that one's reason is said)", () => {
    const { l } = setup();
    const first = findSplice(l, "depot-forest", false, { x: 216, z: 0 }, 0, 40);
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 216, z: 0 }, 0, 40, () => true, () => false);
    expect(s).toEqual(first);
  });

  it("never the other side of a joint onto a straight a train stands on", () => {
    const { l, ids } = setup();
    const s = findSpliceThatFits(l, "depot-forest", false, { x: 216, z: 0 }, 0, 40, (id) => id !== ids[0], (f) => f.covers[0] === ids[0]);
    expect(covered(s)).not.toEqual([ids[0]]);
  });
});

describe("findSplice: skip", () => {
  it("leaves the straights skipped out, as if not there (the next nearest is taken)", () => {
    const l = new Layout();
    const ids = line(l, ["straight-216", "straight-216", "straight-216"]);
    const s = findSplice(l, "depot-workshop", false, { x: 216, z: 0 }, 0, 40, () => true, new Set([ids[0]]));
    expect(s.kind === "splice" && s.covers).toEqual([ids[1]]);
    expect(findSplice(l, "depot-workshop", false, { x: 324, z: 0 }, 0, 40, () => true, new Set(ids)).kind).toBe("none");
  });
});
