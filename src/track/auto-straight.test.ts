import { describe, expect, it } from "vitest";
import { fitAutoStraight } from "./auto-straight";
import { connectorRef, Layout } from "./layout";

const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

describe("auto straight", () => {
  it("seated by its hole, shrinks to meet a hole facing back along its line", () => {
    const l = new Layout();
    l.addPiece("straight-144", P(0, 0)); // peg end at x = 144
    l.addPiece("straight-144", P(270, 0)); // hole end at x = 270: a 126 gap
    expect(fitAutoStraight(l, P(144, 0), 0, 0, [])).toEqual({ length: 126, type: "straight-126", pose: P(144, 0), flipped: false });
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
    expect(r).toEqual({ length: 72, type: "straight-72", pose: P(144, 0), flipped: false });
  });

  it("stays long when nothing is in reach, too far to one side, the wrong way round, or at another height", () => {
    const empty = new Layout();
    expect(fitAutoStraight(empty, P(0, 0), 0, 0, [])).toBeNull();
    const off = new Layout();
    off.addPiece("straight-144", P(126, 120));
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

  it("bends into a join to meet an end a little to one side, either side, seated by either end", () => {
    // A hole facing back, 144 along and 36 to the left (+z): a join 144 long shifting 36 left.
    const left = new Layout();
    left.addPiece("straight-144", P(144, 36));
    expect(fitAutoStraight(left, P(0, 0), 0, 0, [])).toEqual({ length: 144, type: "join-144-36", pose: P(0, 0), flipped: false });
    // To the right: the same join, mirrored; within the joint play too.
    const right = new Layout();
    right.addPiece("straight-144", P(146, -40));
    expect(fitAutoStraight(right, P(0, 0), 0, 0, [])).toMatchObject({ type: "join-144-36", flipped: true });
    // Seated by its peg on a hole at x = 216: the peg it meets is 144 back and 36 over, so it starts there (and, run
    // from that start, it shifts 36 to the right: mirrored).
    const back = new Layout();
    back.addPiece("straight-144", P(-72, 36)); // peg end at (72, 36), pointing +x
    const r = fitAutoStraight(back, P(0, 0), 0, 1, []);
    expect(r).toMatchObject({ length: 144, type: "join-144-36", flipped: true });
    expect(r!.pose.x).toBeCloseTo(72);
    expect(r!.pose.z).toBeCloseTo(36);
  });

  it("the join it becomes ends exactly on the end it meets", async () => {
    const { getPieceDef } = await import("./pieces");
    const { transformPose } = await import("./math");
    const l = new Layout();
    l.addPiece("straight-144", P(162, -54));
    const r = fitAutoStraight(l, P(0, 0), 0, 0, [])!;
    const end = transformPose(r.pose, getPieceDef(r.type, r.flipped).connectors[1].pose, P(0, 0));
    expect(end.x).toBeCloseTo(162);
    expect(end.z).toBeCloseTo(-54);
    expect(end.heading).toBeCloseTo(0);
  });
});
