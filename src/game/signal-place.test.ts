import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, createSample, DOUBLE_TRACK_SPACING, getPieceDef, Layout, pathLength, samplePath, TRACK_WIDTH, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { blocksOf, hasRoom, jointPose, POST_ROOM, postAt, roomForPost, snapJoint, standAt } from "./signal-place";

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

  describe("where a post stands: never on track (the user's report: a signal by a crossover stood on its other road)", () => {
    /** The plan distance from (x, z) to the nearest centre line of any piece's paths (sampled every mm). */
    function nearestLine(layout: Layout, x: number, z: number): number {
      const smp = createSample();
      let best = Infinity;
      for (const id of layout.pieceIds()) {
        const p = layout.getPiece(id)!;
        const [ch, sh] = [Math.cos(p.pose.heading), Math.sin(p.pose.heading)];
        for (const path of getPieceDef(p.type, p.flipped).paths) {
          const len = pathLength(path.geom);
          for (let s = 0; s <= len; s += 1) {
            samplePath(path.geom, s, smp);
            best = Math.min(best, Math.hypot(p.pose.x + smp.x * ch - smp.z * sh - x, p.pose.z + smp.x * sh + smp.z * ch - z));
          }
        }
      }
      return best;
    }
    /** A straight into a crossover's first line, straights on its three other ends: the double track beyond it. */
    function byCrossover() {
      const layout = new Layout();
      const [a] = chain(layout, [S]);
      const x = appendPiece(layout, "crossover", false, connectorRef(a, 1));
      const [on] = chain(layout, [S], connectorRef(x, 1));
      const [back2] = chain(layout, [S], connectorRef(x, 2));
      const [on2] = chain(layout, [S], connectorRef(x, 3));
      return { layout, a, x, on, back2, on2 };
    }

    it("a signal at a crossover's joint stands off its board, on the left when the right is its other road", () => {
      const { layout, a, x } = byCrossover();
      // The crossover's first line, at its far end, guarding trains going on: its right is the board between the lines.
      const far = standAt(layout, connectorRef(x, 1))!;
      expect(far.room).toBe(true);
      expect(far.side).toBe(-1);
      // (Where it stood before: 26 mm out on the right, on the crossover's board, 46 mm from its second line's centre.)
      const j = jointPose(layout, connectorRef(x, 1))!;
      expect(roomForPost(layout, j.x - 10, j.y, j.z + 26)).toBe(false);
      // Its second line's start, guarding trains going back off it: its right is the board too.
      expect(standAt(layout, connectorRef(x, 2))!.side).toBe(-1);
      // The joint into it from the plain straight: the post on that straight, by the board's end, has room on the right.
      expect(standAt(layout, connectorRef(a, 1))!.side).toBe(1);
      // The other way there (trains leaving the crossover backward): its right is away from the second line.
      expect(standAt(layout, connectorRef(x, 0))!.side).toBe(1);
    });

    it("every joint end by the crossover: its post clear of every road and off the board", () => {
      const { layout, x } = byCrossover();
      const clear = TRACK_WIDTH / 2 + POST_ROOM;
      for (const id of layout.pieceIds())
        for (let c = 0; c < 4; c++) {
          const at = connectorRef(id, c);
          if (layout.joinedConnector(at) === -1 || !jointPose(layout, at)) continue;
          const p = standAt(layout, at)!;
          expect(p.room).toBe(true);
          expect(nearestLine(layout, p.px, p.pz)).toBeGreaterThanOrEqual(clear - 0.5);
          // (Off the crossover's board: not between its lines, in its own frame 0 ≤ z ≤ the spacing, along it.)
          const xp = layout.getPiece(x)!;
          const lx = (p.px - xp.pose.x) * Math.cos(xp.pose.heading) + (p.pz - xp.pose.z) * Math.sin(xp.pose.heading);
          const lz = -(p.px - xp.pose.x) * Math.sin(xp.pose.heading) + (p.pz - xp.pose.z) * Math.cos(xp.pose.heading);
          expect(lx > 0 && lx < 216 && lz > 0 && lz < DOUBLE_TRACK_SPACING).toBe(false);
        }
    });

    it("a line beside: the post on the other side; no room either side: none put there", () => {
      // A straight between two crossovers' boards (the middle of three lines): no room on either side.
      const layout = new Layout();
      const x1 = layout.addPiece("crossover", { x: 0, z: 0, heading: 0 });
      layout.addPiece("crossover", { x: 0, z: DOUBLE_TRACK_SPACING, heading: 0 });
      const [m] = chain(layout, [S], connectorRef(x1, 3));
      const at = connectorRef(x1, 3);
      expect(layout.joinedConnector(at)).toBe(connectorRef(m, 0));
      expect(standAt(layout, at)!.room).toBe(false);
      expect(hasRoom(layout, at)).toBe(false);
      // (Its other end, on the plain straight past the boards: room.)
      expect(hasRoom(layout, connectorRef(m, 0))).toBe(true);
      // A finger near that joint finds the straight's far joint instead (forgiving), and none if there's no other.
      const [n] = chain(layout, [S], connectorRef(m, 1));
      const ok = (e: number) => hasRoom(layout, e);
      expect(snapJoint(layout, { pieceId: m, pathIndex: 0, reversed: false, s: 10 }, 1, ok)).toBe(connectorRef(m, 1));
      expect(postAt(layout, connectorRef(n, 0))!.room).toBe(true);
    });

    it("costs little: a few hundred pieces, a pointer move's worth of checks in well under a millisecond each", () => {
      const layout = new Layout();
      const ids = chain(layout, Array<PieceTypeId>(400).fill(S));
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) hasRoom(layout, connectorRef(ids[i], 1));
      expect((performance.now() - t0) / 200).toBeLessThan(1);
    });
  });
});
