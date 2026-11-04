/**
 * Draw makes slips (tech-tree T4): a stroke on a 45° crossing along a turn from one of its lines onto the other swaps a
 * single slip in (`findSlip`), the one whose curve is that turn; on a single slip, along its other turn, a double.
 */
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, createSample, getPieceDef, Layout, samplePath, transformPose, type PieceSwap, type Pose } from ".";
import { findSlip } from "./splice";

/** A 45° crossing (or `type`) at the origin with a straight off each end. */
function crossing(type: "crossing-45" | "slip-single" = "crossing-45") {
  const layout = new Layout();
  const id = layout.addPiece(type, { x: 0, z: 0, heading: 0.3 });
  for (let c = 0; c < 4; c++) appendPiece(layout, "straight-144", false, connectorRef(id, c));
  return { layout, id };
}

/** World point `d` mm along path `k` of the piece of type `type` standing at `at`. */
function along(type: "crossing-45" | "slip-single" | "slip-double", at: Pose, k: number, d: number): { x: number; z: number } {
  const s = createSample();
  samplePath(getPieceDef(type, false).paths[k].geom, d, s);
  return transformPose(at, { x: s.x, z: s.z, heading: 0 }, { x: 0, z: 0, heading: 0 });
}

describe("findSlip", () => {
  it("a stroke along the turn from end 0 onto the other line: a single slip as the crossing lies, set to turn", () => {
    const { layout, id } = crossing();
    const at = layout.getPiece(id)!.pose;
    const w = findSlip(layout, id, along("slip-single", at, 2, 15), along("slip-single", at, 2, 100)) as PieceSwap;
    expect(w.kind).toBe("swap");
    expect(w.covers).toEqual([id]);
    expect(w.pieces[0].type).toBe("slip-single");
    expect(w.pieces[0].pose.x).toBeCloseTo(0, 6);
    expect(w.pieces[0].pose.heading).toBeCloseTo(0.3, 6);
    expect(w.pieces[0].state).toBe(1);
  });

  it("along the other turn (end 2 onto end 1): the single slip turned end for end, its every joint kept", () => {
    const { layout, id } = crossing();
    const at = layout.getPiece(id)!.pose;
    // (The double slip's second curve is that turn, on the crossing as it lies.)
    const w = findSlip(layout, id, along("slip-double", at, 3, 20), along("slip-double", at, 3, 110)) as PieceSwap;
    expect(w.kind).toBe("swap");
    const p = w.pieces[0];
    expect(p.type).toBe("slip-single");
    const end1 = layout.worldConnector(connectorRef(id, 1), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    expect(p.pose.x).toBeCloseTo(end1.x, 6);
    expect(p.pose.z).toBeCloseTo(end1.z, 6);
    // Put down in the crossing's place: all four ends joined again.
    layout.removePiece(id);
    const slip = layout.addPiece(p.type, p.pose, p.y, p.flipped);
    for (let c = 0; c < 4; c++) expect(layout.joinedConnector(connectorRef(slip, c)), `end ${c}`).not.toBe(-1);
  });

  it("a stroke along either straight is no slip", () => {
    const { layout, id } = crossing();
    const at = layout.getPiece(id)!.pose;
    for (const k of [0, 1]) expect(findSlip(layout, id, along("crossing-45", at, k, 15), along("crossing-45", at, k, 100)).kind).toBe("none");
  });

  it("on a single slip, along its other turn: a double slip, set as the single was; along the turn it has: none", () => {
    const { layout, id } = crossing("slip-single");
    const at = layout.getPiece(id)!.pose;
    layout.setSwitchState(id, 1);
    const w = findSlip(layout, id, along("slip-double", at, 3, 20), along("slip-double", at, 3, 110)) as PieceSwap;
    expect(w.kind).toBe("swap");
    expect(w.pieces[0].type).toBe("slip-double");
    expect(w.pieces[0].pose.heading).toBeCloseTo(0.3, 6);
    expect(w.pieces[0].state).toBe(1);
    expect(findSlip(layout, id, along("slip-single", at, 2, 15), along("slip-single", at, 2, 100)).kind).toBe("none");
  });

  it("not on a train, nor on other pieces", () => {
    const { layout, id } = crossing();
    const at = layout.getPiece(id)!.pose;
    expect(findSlip(layout, id, along("slip-single", at, 2, 15), along("slip-single", at, 2, 100), () => false).kind).toBe("busy");
    const straight = layout.addPiece("straight-216", { x: 2000, z: 0, heading: 0 });
    expect(findSlip(layout, straight, { x: 2010, z: 0 }, { x: 2100, z: 0 }).kind).toBe("none");
  });
});
