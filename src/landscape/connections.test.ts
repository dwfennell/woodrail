import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { connectedPairs } from "./connections";

describe("connectedPairs", () => {
  function line() {
    const l = new Layout();
    const a = l.addPiece("station", { x: 0, z: 0, heading: 0 });
    let last = a;
    const mids: number[] = [];
    for (let i = 0; i < 3; i++) mids.push((last = appendPiece(l, "straight-216", false, connectorRef(last, 1))));
    const b = appendPiece(l, "station", false, connectorRef(last, 1));
    const c = l.addPiece("station", { x: 0, z: 900, heading: 0 });
    return { l, a, b, c, mids };
  }

  it("reports towns whose stations are joined by track", () => {
    const { l, a, b, c } = line();
    const stations = new Map([[0, a], [1, b], [2, c]]);
    expect(connectedPairs(l, stations)).toEqual([[0, 1]]);
  });

  it("disconnects when a piece in the middle is removed", () => {
    const { l, a, b, c, mids } = line();
    l.removePiece(mids[1]);
    expect(connectedPairs(l, new Map([[0, a], [1, b], [2, c]]))).toEqual([]);
  });

  it("ignores switch state", () => {
    const l = new Layout();
    const a = l.addPiece("station", { x: 0, z: 0, heading: 0 });
    const sw = appendPiece(l, "switch", false, connectorRef(a, 1));
    const branch = appendPiece(l, "straight-216", false, connectorRef(sw, 2));
    const b = appendPiece(l, "station", false, connectorRef(branch, 1));
    l.setSwitchState(sw, 0);
    expect(connectedPairs(l, new Map([[0, a], [1, b]]))).toEqual([[0, 1]]);
  });
});
