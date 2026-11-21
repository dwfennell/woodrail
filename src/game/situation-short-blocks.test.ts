import { describe, expect, it } from "vitest";
import { chain, loopOn } from "../economy/loop-fixtures";
import { ROAD_MARGIN } from "../economy/sections";
import { loadBugMap } from "../play/bugmap";
import { signal } from "../routing/harness";
import { CAR_SPECS, COUPLER_GAP } from "../sim/cars";
import { trainLength } from "../sim/train-cars";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { shortBlocks } from "./situation-tips";
import wren from "../play/bugmaps/reference/wren.txt?raw";
import complex1 from "../play/bugmaps/reference/complex-1.txt?raw";

/**
 * Situation help step 2 (spec docs/superpowers/specs/2026-11-18-situation-help.md, detector #4a): signal blocks and
 * passing loops too short for a line's trains to wait in clear of the points, by sections' own topology.
 */
const S: PieceTypeId = "straight-216";
/** An engine and two timber wagons, as the routing tests' trains. */
const LEN = CAR_SPECS.engine.length + 2 * CAR_SPECS.timber.length + 2 * COUPLER_GAP;

/**
 * `⊐ A ══ ══ (loop) ══ × long ══ (loop) ══ ══ B ⊏`, the first loop's roads as given. (A loop at each end: the track
 * from a loop to a line's end is that line end's, which holds one train, and a signal there is no waiting point.)
 */
function line(layout: Layout, long: number, loopMain: readonly PieceTypeId[] = [S, S], loopSide: readonly PieceTypeId[] = [S]) {
  const [a, , w2] = chain(layout, ["depot-forest", S, S]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(a, 0));
  const l1 = loopOn(layout, connectorRef(w2, 1), loopMain, loopSide);
  const mid = chain(layout, Array<PieceTypeId>(long).fill(S), connectorRef(l1.s2, 0));
  const l2 = loopOn(layout, connectorRef(mid[mid.length - 1], 1), [S, S, S], [S, S]);
  const [, , b] = chain(layout, [S, S, "depot-sawmill"], connectorRef(l2.s2, 0));
  appendPiece(layout, "buffer-turnback", false, connectorRef(b, 1));
  return { mid, l1 };
}

describe("situation tips: blocks too short to wait in", () => {
  it("signals a train apart make waiting points: nothing said", () => {
    const layout = new Layout();
    const { mid } = line(layout, 12);
    signal(layout, mid[5], 1);
    expect(shortBlocks(layout, LEN)).toEqual([]);
  });

  it("signals closer than a train: that block is said, with its signal and length", () => {
    const layout = new Layout();
    const { mid } = line(layout, 12);
    // (A pair of signals one straight apart: the block between them is 216 mm, short of a three-car train.)
    signal(layout, mid[5], 1);
    const near = signal(layout, mid[6], 1);
    const short = shortBlocks(layout, LEN);
    expect(short.length).toBeGreaterThan(0);
    const b = short.find((x) => x.markId === near) ?? short[0];
    expect(b.kind).toBe("signal");
    expect(b.length).toBeLessThan(LEN + ROAD_MARGIN);
    expect(b.pieces.length).toBeGreaterThan(0);
    // (An engine alone fits in it: for it, nothing is too short.)
    expect(shortBlocks(layout, CAR_SPECS.engine.length).filter((x) => x.kind === "signal")).toEqual([]);
  });

  it("a passing loop that fits an engine but not the train is said, with its shorter road", () => {
    const layout = new Layout();
    line(layout, 6, [S], []);
    const loops = shortBlocks(layout, LEN).filter((x) => x.kind === "loop");
    expect(loops).toHaveLength(1);
    expect(loops[0].length).toBeLessThan(LEN + ROAD_MARGIN);
    // A long enough loop isn't.
    const ok = new Layout();
    line(ok, 6, [S, S, S], [S, S]);
    expect(shortBlocks(ok, LEN).filter((x) => x.kind === "loop")).toEqual([]);
  });

  it("is cached: the same track and length, the same answer without looking again", () => {
    const layout = new Layout();
    const { mid } = line(layout, 12);
    signal(layout, mid[5], 1);
    signal(layout, mid[6], 1);
    expect(shortBlocks(layout, LEN)).toBe(shortBlocks(layout, LEN));
    // (A signal more: looked at again.)
    const before = shortBlocks(layout, LEN);
    signal(layout, mid[9], 1);
    expect(shortBlocks(layout, LEN)).not.toBe(before);
  });

  // The dispatcher spec's maps (§1.1): Wren's 134 signals make 42 waiting points; the complex map's one loop holds
  // trains up to about 420 mm, its longest are 440 and 456.

  it("Wren's map: most of its signals' blocks are too short for its longest train", async () => {
    const { world } = await loadBugMap(wren);
    let longest = 0;
    for (const t of world.sim.trains()) longest = Math.max(longest, trainLength(t));
    const short = shortBlocks(world.layout, longest).filter((x) => x.kind === "signal");
    expect(short.length).toBeGreaterThan(10);
  });

  it("the complex map: its loop is too short for its longest trains", async () => {
    const { world } = await loadBugMap(complex1);
    let longest = 0;
    for (const t of world.sim.trains()) longest = Math.max(longest, trainLength(t));
    expect(longest).toBeGreaterThan(430);
    const loops = shortBlocks(world.layout, longest).filter((x) => x.kind === "loop");
    expect(loops.length).toBeGreaterThan(0);
    expect(Math.min(...loops.map((l) => l.length))).toBeLessThan(longest + ROAD_MARGIN);
  });
});
