import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { connectorRef, Layout, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { stretchBetween } from "./stretch";

const S: PieceTypeId = "straight-216";

/** A lone engine on `pieceId` (one piece holds it). */
function put(sim: Sim, pieceId: number, reversed: boolean) {
  const r = sim.addTrain(["engine"], { pieceId, pathIndex: 0, reversed, s: 100 });
  if (r.kind !== "placed") throw new Error("no room");
  return sim.getTrain(r.trainId)!;
}

describe("stretchBetween: the track between two trains (a stuck card's Show, for a passing loop)", () => {
  it("on a line, the pieces between them, in order from the first", () => {
    const layout = new Layout();
    const ids = chain(layout, Array<PieceTypeId>(10).fill(S));
    const sim = new Sim(layout);
    const a = put(sim, ids[1], false);
    const b = put(sim, ids[7], true);
    expect(stretchBetween(layout, a, sim.piecesUnder(b.id))).toEqual(ids.slice(2, 7));
    expect(stretchBetween(layout, b, sim.piecesUnder(a.id))).toEqual(ids.slice(2, 7).reverse());
  });

  it("whichever way the train faces (from either end)", () => {
    const layout = new Layout();
    const ids = chain(layout, Array<PieceTypeId>(10).fill(S));
    const sim = new Sim(layout);
    const a = put(sim, ids[1], true);
    const b = put(sim, ids[6], true);
    expect(stretchBetween(layout, a, sim.piecesUnder(b.id))).toEqual(ids.slice(2, 6));
  });

  it("through points either way they lie", () => {
    const layout = new Layout();
    const trunk = chain(layout, Array<PieceTypeId>(4).fill(S));
    const sw = chain(layout, ["switch"], connectorRef(trunk[3], 1))[0];
    const branch = chain(layout, [S, S, S], connectorRef(sw, 2));
    const main = chain(layout, [S, S], connectorRef(sw, 1));
    const sim = new Sim(layout);
    layout.setSwitchState(sw, 0);
    const a = put(sim, trunk[1], false);
    const b = put(sim, branch[2], false);
    expect(stretchBetween(layout, a, sim.piecesUnder(b.id))).toEqual([trunk[2], trunk[3], sw, branch[0], branch[1]]);
    expect(main.length).toBe(2);
  });

  it("[] where they touch, null where no track joins them", () => {
    const layout = new Layout();
    const ids = chain(layout, Array<PieceTypeId>(4).fill(S));
    const f0 = layout.addPiece(S, { x: 0, z: 3000, heading: 0 });
    const far = [f0, ...chain(layout, [S, S], connectorRef(f0, 1))];
    const sim = new Sim(layout);
    const a = put(sim, ids[1], false);
    expect(stretchBetween(layout, a, new Set([ids[1]]))).toEqual([]);
    const b = put(sim, far[1], false);
    expect(stretchBetween(layout, a, sim.piecesUnder(b.id))).toBeNull();
  });
});
