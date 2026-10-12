import { describe, expect, it } from "vitest";
import { fitAutoStraight } from "./auto-straight";
import { connectorRef, Layout } from "./layout";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("auto straight", () => {
  it("seated by its hole, shrinks to meet a hole facing back along its line", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // peg end at x = 144
    l.addPiece("straight-144", P(270, 0)); // hole end at x = 270: a 126 gap
    expect(fitAutoStraight(l, P(144, 0), 0, 0, [])).toEqual({ length: 126, type: "straight-126", pose: P(144, 0) });
    // Within the joint play either way.
    const l2 = new Layout();
    l2.addPiece("straight-144", P(144 + 95, 0));
    expect(fitAutoStraight(l2, P(144, 0), 0, 0, [])?.length).toBe(90);
  });

  it("seated by its peg, shrinks back to meet a peg facing it, and moves its hole end up", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // peg end at 144, pointing +x
    // Held as a long straight whose peg seats on a hole at 144 + 72 = 216 (so its hole end would be at 0).
    const r = fitAutoStraight(l, P(0, 0), 0, 1, []);
    expect(r).toEqual({ length: 72, type: "straight-72", pose: P(144, 0) });
  });

  it("stays long when nothing is in reach, off its line, the wrong way round, or at another height", () => {
    const empty = new Layout();
    expect(fitAutoStraight(empty, P(0, 0), 0, 0, [])).toBeNull();
    const off = new Layout();
    off.addPiece("straight-144", P(126, 30));
    expect(fitAutoStraight(off, P(0, 0), 0, 0, [])).toBeNull();
    const wrong = new Layout();
    wrong.addPiece("straight-144", P(270, 0, Math.PI)); // its peg end faces us: can't join a peg
    expect(fitAutoStraight(wrong, P(0, 0), 0, 0, [])).toBeNull();
    const high = new Layout();
    high.addPiece("straight-144", P(126, 0), 64);
    expect(fitAutoStraight(high, P(0, 0), 0, 0, [])).toBeNull();
  });

  it("meets the nearest of several ends, and the placed piece joins at both", () => {
    const l = new Layout();
    const a = l.addPiece("straight-144", P(0, 0));
    const near = l.addPiece("straight-54", P(144 + 108, 0));
    l.addPiece("straight-54", P(144 + 198, 30));
    const r = fitAutoStraight(l, P(144, 0), 0, 0, [])!;
    expect(r.length).toBe(108);
    const id = l.addPiece(r.type, r.pose);
    expect(l.joinedConnector(connectorRef(id, 0))).toBe(connectorRef(a, 1));
    expect(l.joinedConnector(connectorRef(id, 1))).toBe(connectorRef(near, 0));
  });
});
