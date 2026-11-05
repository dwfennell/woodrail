import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { deadEndsOf } from "./dead-ends";

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";

/** A ring with a wye (the town-ring fuzz's), its stem a line out to points, a branch and a spur, each to a buffer. */
function town(loop = false) {
  const layout = new Layout();
  const ring = chain(layout, ["depot-farm", S, S, C, C, C, C, "depot-dairy"]);
  const wye = appendPiece(layout, "wye", false, connectorRef(ring[7], 1), 1);
  const back = chain(layout, ["straight-72", C, C, C, C], connectorRef(wye, 2));
  const line = chain(layout, [S, S], connectorRef(wye, 0));
  let last = line[1];
  const inLoop: number[] = [];
  if (loop) {
    const l = loopOn(layout, connectorRef(last, 1), [S, S], [S]);
    inLoop.push(l.s1, l.s2, ...l.main, ...l.side);
    const after = chain(layout, [S], connectorRef(l.s2, 0));
    last = after[0];
    line.push(after[0]);
  }
  const sw = appendPiece(layout, "switch", false, connectorRef(last, 1), 0);
  const br = chain(layout, [S, S, S], connectorRef(sw, 1));
  const b1 = appendPiece(layout, "buffer-turnback", false, connectorRef(br[2], 1));
  const sp = chain(layout, [C, S, S], connectorRef(sw, 2), [true]);
  const b2 = appendPiece(layout, "buffer-turnback", false, connectorRef(sp[2], 1));
  return { layout, ring, back, wye, line, sw, br, sp, buffers: [b1, b2], inLoop };
}

describe("dead-end regions (routing spec §5 rule 8)", () => {
  it("a ring's wye out to points and two dead ends: the line, points and both dead ends are one region, its mouth at the wye", () => {
    const m = town();
    const d = deadEndsOf(m.layout);
    expect(d.mouths.length).toBe(1);
    const r = d.mouths[0];
    expect(r.outer).toBe(m.wye);
    expect([...r.pieces].sort((a, b) => a - b)).toEqual([...m.line, m.sw, ...m.br, ...m.sp, ...m.buffers].sort((a, b) => a - b));
    for (const p of [...m.ring, ...m.back, m.wye]) expect(d.regionOf.has(p)).toBe(false);
    expect(d.intoAt.get(r.outerEnd)).toBe(0);
  });

  it("a passing loop on the line splits it: the region is only what's beyond the loop", () => {
    const m = town(true);
    const d = deadEndsOf(m.layout);
    expect(d.mouths.length).toBe(1);
    const r = d.mouths[0];
    for (const p of m.inLoop) expect(r.pieces.has(p)).toBe(false);
    expect(r.pieces.has(m.sw)).toBe(true);
    expect(r.pieces.has(m.line[0])).toBe(false);
  });

  it("a shuttle line with no cycle at all has no mouth: no region", () => {
    const layout = new Layout();
    const ids = chain(layout, Array<PieceTypeId>(5).fill(S));
    appendPiece(layout, "buffer-turnback", false, connectorRef(ids[4], 1));
    expect(deadEndsOf(layout).mouths.length).toBe(0);
  });

  it("cached per layout revision", () => {
    const m = town();
    expect(deadEndsOf(m.layout)).toBe(deadEndsOf(m.layout));
  });
});
