import { describe, expect, it } from "vitest";
import { blocksOf } from "../../game/signal-place";
import { markKey } from "../../sim";
import { connectorRef } from "../../track";
import { loadBugMap } from "../bugmap";
import MAP from "./signals-mill-wait.txt?raw";

/**
 * The user's mill-wait map (2026-11-06, copied with "Copy map for a bug report"): 37 signals, nearly all in pairs. Every
 * pair's block was empty (its partner on the same joint ended it), so they showed green whatever stood past them. Each
 * signal's block, as the sim works it out, is the one its tint shows (`blocksOf`), and the post facing the green engine
 * at the pair before the mill (piece 221, end 1) guards the way on past its partner, onto the mill's points.
 */
describe("the user's mill-wait map: its signals' blocks", () => {
  it("every signal's block is the tint's, none empty where track runs on, and the pair before the mill guards the mill's points", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, layout } = world;
    sim.tick();
    let marks = 0;
    for (const m of layout.signals()) {
      marks++;
      const tint = [...blocksOf(layout, m.at, m.id).ahead.keys()].sort((a, b) => a - b);
      const block = [...sim.signalBlock(markKey(m.id))].sort((a, b) => a - b);
      expect(block, `signal ${m.id}`).toEqual(tint);
      if (layout.joinedConnector(m.at) !== -1) expect(block.length, `signal ${m.id}`).toBeGreaterThan(0);
    }
    expect(marks).toBe(37);
    const before = layout.signalAt(connectorRef(221, 1))!;
    const block = sim.signalBlock(markKey(before.id));
    expect(block).toEqual(expect.arrayContaining([220, 219, 206, 124]));
    expect(sim.signalList().find((g) => g.key === markKey(before.id))!.junction).toBe(true);
  });
});
