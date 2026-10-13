import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { rng } from "../lib/rng";
import { Sim } from "../sim";
import { connectorRef, Layout } from "../track";
import { play } from "./player";

/**
 * Buildability: can a player, laying track the ordinary way (straights and curves, then Auto to finish), join two
 * track ends placed as the map generator places stations' and depots' ends? On the 18 mm lattice, at quarter turns,
 * either kind (peg or hole), 0.4 to 1.6 m apart, on flat felt. The rate is the number to raise; the floor below is
 * today's, so it can only go up.
 */
function trial(seed: number): ReturnType<typeof play> {
  const r = rng(seed);
  const layout = new Layout();
  const quarter = () => (Math.floor(r() * 4) * Math.PI) / 2;
  // Each end is a fixed 216 mm piece (a station or depot) with its free end facing out.
  const lattice = (v: number) => Math.round(v / 18) * 18;
  const pieceAt = (x: number, z: number, heading: number) => layout.addPiece("straight-216", { x, z, heading });
  const a = pieceAt(0, 0, quarter());
  const dist = 400 + r() * 1200;
  const bearing = r() * Math.PI * 2;
  const b = pieceAt(lattice(Math.cos(bearing) * dist), lattice(Math.sin(bearing) * dist), quarter());
  const from = connectorRef(a, r() < 0.5 ? 0 : 1);
  const to = connectorRef(b, r() < 0.5 ? 0 : 1);
  const editor = new Editor(layout, new Sim(layout), () => {}, (id) => id === a || id === b);
  return play(layout, editor, from, to);
}

describe("buildability (a simulated player joining two ends)", () => {
  it("joins most pairs of station-like ends on flat felt", () => {
    const N = 300;
    const results = Array.from({ length: N }, (_, i) => trial(i * 7919 + 13));
    const ok = results.filter((r) => r.ok);
    const how = new Map<string, number>();
    for (const r of results) how.set(r.how, (how.get(r.how) ?? 0) + 1);
    const rate = ok.length / N;
    const pieces = ok.reduce((n, r) => n + r.pieces, 0) / Math.max(1, ok.length);
    console.log(`buildability: ${(rate * 100).toFixed(1)}% joined (${ok.length}/${N}), ${pieces.toFixed(1)} pieces on average; ${JSON.stringify(Object.fromEntries(how))}`);
    const failed = results.filter((r) => !r.ok).map((r) => ({ how: r.how, ...r.miss }));
    console.log("not joined (how it ended, distance mm, degrees from facing, ends alike):", JSON.stringify(failed.slice(0, 12)));
    // Today's rate: it may only go up.
    expect(rate).toBeGreaterThanOrEqual(0.7);
  });
});
