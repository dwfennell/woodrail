/**
 * `liveDepot` and `onMap`: the one check of "is this depot on the map". A depot whose piece is taken up is kept (piles
 * and all) but isn't live, isn't in `allDepots`, and is back when its piece is (redo).
 */
import { describe, expect, it } from "vitest";
import { Economy } from "./economy";
import { Sim } from "../sim";
import { Layout } from "../track";

describe("liveDepot", () => {
  it("gives a depot on the map, and nothing for one taken up or an unknown id", () => {
    const layout = new Layout();
    const pose = { x: 0, z: 0, heading: 0 };
    const piece = layout.addPiece("depot-mill", pose);
    const economy = new Economy(layout, new Sim(layout));
    const mill = economy.addDepot("mill", piece);
    expect(economy.liveDepot(mill.id)).toBe(mill);
    expect(economy.onMap(mill)).toBe(true);
    expect(economy.liveDepot(mill.id + 1)).toBeUndefined();

    layout.removePiece(piece);
    expect(economy.liveDepot(mill.id)).toBeUndefined();
    expect(economy.onMap(mill)).toBe(false);
    expect(economy.depot(mill.id)).toBe(mill);
    expect(economy.allDepots()).not.toContain(mill);

    layout.restorePiece(piece, "depot-mill", pose, 0, false);
    expect(economy.liveDepot(mill.id)).toBe(mill);
    expect(economy.allDepots()).toContain(mill);
  });
});
