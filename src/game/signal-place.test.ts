import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { blocksOf, jointPose, postAt, snapJoint } from "./signal-place";

const S: PieceTypeId = "straight-216";

describe("placing signal marks", () => {
  it("a joint's pose is the end of the approach piece, heading the way trains cross it", () => {
    const layout = new Layout();
    const [a, b] = chain(layout, [S, S]);
    const fwd = jointPose(layout, connectorRef(a, 1))!;
    const back = jointPose(layout, connectorRef(b, 0))!;
    expect(Math.hypot(fwd.x - back.x, fwd.z - back.z)).toBeLessThan(0.5);
    expect(Math.abs(Math.cos(fwd.heading - back.heading) + 1)).toBeLessThan(1e-6);
    // (Its post on the driver's right: the two facings' posts stand on opposite sides.)
    const pf = postAt(layout, connectorRef(a, 1))!;
    const pb = postAt(layout, connectorRef(b, 0))!;
    expect(Math.hypot(pf.px - pb.px, pf.pz - pb.pz)).toBeGreaterThan(40);
    // (An open end is no joint: no mark there.)
    expect(jointPose(layout, connectorRef(b, 1))).not.toBe(null);
  });

  it("snaps to the nearer joint of the piece under the finger, facing the way the finger moves", () => {
    const layout = new Layout();
    const [a, b, c] = chain(layout, [S, S, S]);
    // Near b's far end (connector 1), moving from its start to its end: guards trains crossing from b to c.
    expect(snapJoint(layout, { pieceId: b, pathIndex: 0, reversed: false, s: 180 }, 1)).toBe(connectorRef(b, 1));
    // The other way: trains crossing from c into b.
    expect(snapJoint(layout, { pieceId: b, pathIndex: 0, reversed: false, s: 180 }, -1)).toBe(connectorRef(c, 0));
    // Near b's start: the joint with a.
    expect(snapJoint(layout, { pieceId: b, pathIndex: 0, reversed: false, s: 20 }, 1)).toBe(connectorRef(a, 1));
    // (A cursor running backward measures s from the other end.)
    expect(snapJoint(layout, { pieceId: b, pathIndex: 0, reversed: true, s: 20 }, 1)).toBe(connectorRef(b, 1));
    // An end piece's open end: the joint at its other end instead.
    expect(snapJoint(layout, { pieceId: c, pathIndex: 0, reversed: false, s: 200 }, 1)).toBe(connectorRef(b, 1));
  });

  it("blocks: ahead to the next mark, through points; behind back to the one before", () => {
    const layout = new Layout();
    const ids = chain(layout, [S, S, S, S]);
    const l = loopOn(layout, connectorRef(ids[3], 1), [S, S], [S]);
    const tail = chain(layout, [S, S], connectorRef(l.s2, 0));
    appendPiece(layout, "buffer-turnback", false, connectorRef(tail[1], 1));
    layout.addSignal(connectorRef(ids[0], 1));
    const { ahead, behind } = blocksOf(layout, connectorRef(ids[2], 1));
    // Ahead: ids[3], both points, both loop roads, the tail and its buffer.
    expect(ahead.has(ids[3])).toBe(true);
    expect(ahead.has(l.s1) && ahead.has(l.s2)).toBe(true);
    for (const p of [...l.main, ...l.side, ...tail]) expect(ahead.has(p)).toBe(true);
    expect(ahead.has(ids[2])).toBe(false);
    // Behind: ids[2] and ids[1], up to the mark at ids[0]'s far joint.
    expect([...behind.keys()].sort()).toEqual([ids[1], ids[2]].sort());
  });
});
