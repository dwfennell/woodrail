import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { waysFrom } from "./graph";
import { plan, planWay } from "./plan";
import { stubRule } from "./stubs";

const S: PieceTypeId = "straight-216";

/**
 * Points with a dead end off their toe (two straights to a buffer) and two roads: road A out to a line end, road B on to
 * a stop. From A, a train gets to B only by going into the dead end, turning at its buffer, and coming out onto B.
 */
function kickback() {
  const layout = new Layout();
  const stub = chain(layout, [S, S]);
  const buffer = appendPiece(layout, "buffer-turnback", false, connectorRef(stub[0], 0));
  const sw = appendPiece(layout, "switch", false, connectorRef(stub[1], 1), 0);
  const a = chain(layout, [S, S], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(a[1], 1));
  const b = chain(layout, [S, S, S], connectorRef(sw, 2));
  return { layout, stub, buffer, sw, a, b };
}

describe("line ends too short to turn and take another road (stubs.ts)", () => {
  it("a train that fits the dead end turns in it and comes out onto the other road; one too long for it has no way there", () => {
    const { layout, sw, a, b } = kickback();
    // (From road A's end, toward the points: the way to B is in, turn, and out.)
    const start = { pieceId: a[1], entry: 1, lead: true };
    const short = plan(layout, start, b[2]);
    expect(short, "a way, turning in the dead end").not.toBeNull();
    expect(short!.steps.some((s) => s.reverse)).toBe(true);
    // (A train the dead end holds clear of the points: no rule, the plan as it was.)
    expect(stubRule(layout, 200)).toBeUndefined();
    // (One too long for it: turned at its buffer, its tail is over the points, and it comes out onto road A again.)
    const rule = stubRule(layout, 900);
    expect(rule).toBeDefined();
    expect(plan(layout, start, b[2], undefined, undefined, undefined, rule)).toBeNull();
    // (Coming out of the dead end at its mouth: the road the points lie for, only.)
    const out = waysFrom(layout, sw, 0);
    expect(out.length).toBe(2);
    const lie = layout.switchState(sw);
    expect(planWay(layout, sw, 0, out, b[2], undefined, undefined, undefined, undefined, rule)).toBe(lie === 1 ? 1 : -1);
    expect(planWay(layout, sw, 0, out, b[2])).toBe(1);
    // (Going into the dead end from B, and on to a stop in it: there, whatever its length.)
    expect(plan(layout, { pieceId: b[2], entry: 1, lead: true }, a[0], undefined, undefined, undefined, rule)).toBeNull();
    expect(plan(layout, { pieceId: b[0], entry: 1, lead: true }, b[2], undefined, undefined, undefined, rule)).not.toBeNull();
  });
});
