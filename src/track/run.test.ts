import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "./layout";
import { runOf } from "./run";
import { appendPiece } from "./snap";

/** A line of `n` straights from a station-like start piece; returns their ids (start first). */
function line(l: Layout, n: number): number[] {
  const ids = [l.addPiece("straight-216", { x: 0, z: 0, heading: 0 })];
  for (let k = 1; k < n; k++) ids.push(appendPiece(l, "straight-216", false, connectorRef(ids[k - 1], 1)));
  return ids;
}

describe("runOf (what comes along when a piece is pulled)", () => {
  it("a tail ending free follows; the way back to something that stays put bends", () => {
    const l = new Layout();
    const ids = line(l, 6); // ids[0] stays put
    const r = runOf(l, ids[3], (id) => id === ids[0]);
    expect(r.followers.sort()).toEqual([ids[4], ids[5]].sort());
    expect(r.benders.sort()).toEqual([ids[1], ids[2]].sort());
  });

  it("a line free at both ends follows whole; one held at both ends only bends", () => {
    const l = new Layout();
    const ids = line(l, 5);
    expect(runOf(l, ids[2], () => false).followers.sort()).toEqual([ids[0], ids[1], ids[3], ids[4]].sort());
    const r = runOf(l, ids[2], (id) => id === ids[0] || id === ids[4]);
    expect(r.followers).toEqual([]);
    expect(r.benders.sort()).toEqual([ids[1], ids[3]].sort());
  });

  it("stops before a switch", () => {
    const l = new Layout();
    const ids = line(l, 2);
    const sw = appendPiece(l, "switch", false, connectorRef(ids[1], 1));
    const after = appendPiece(l, "straight-216", false, connectorRef(sw, 1));
    const r = runOf(l, ids[1], () => false);
    expect(r.followers).toEqual([ids[0]]);
    expect(r.benders).toEqual([]);
    expect([...r.followers, ...r.benders]).not.toContain(after);
  });
});
