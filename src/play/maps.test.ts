import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { createWorld, type World } from "../game/world";
import { checkPlacement, checkSupport } from "../landscape";
import { connectorRef, findLowCrossing, findOverlap, getPieceDef, Layout } from "../track";
import { play, type Blocked } from "./player";

/**
 * Buildability on generated maps: from each depot to the nearest town's station, and between nearby towns, can a
 * casual player join them with straights and curves (and Auto), keeping to the game's placement rules? A map's
 * rivers and hills need bridges and ramps, which this player doesn't use yet: those failures are counted by what
 * blocked them, to see what the game asks of a player.
 */
function rulesFor(w: World): Blocked {
  return (type, flipped, pose, y, ignoreId) => {
    const c = checkPlacement(w.landscape, type, flipped, pose, y);
    if (c.kind === "blocked") return c.reason;
    if (findOverlap(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "piece";
    if (findLowCrossing(w.layout, type, flipped, pose, y, ignoreId) !== -1) return "headroom";
    if (checkSupport(w.landscape, w.layout, type, flipped, pose, y, ignoreId).kind === "unsupported") return "unsupported";
    return null;
  };
}

/** The free end of a fixed piece nearest a point (its two ends: the one facing that way). */
function endToward(layout: Layout, id: number, x: number, z: number): number {
  const p = layout.getPiece(id)!;
  let best = -1;
  let d = Infinity;
  getPieceDef(p.type, p.flipped).connectors.forEach((_, k) => {
    const ref = connectorRef(id, k);
    if (layout.joinedConnector(ref) !== -1) return;
    const w = layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    const dd = Math.hypot(w.x - x, w.z - z);
    if (dd < d) [best, d] = [ref, dd];
  });
  return best;
}

describe("buildability on generated maps", () => {
  it("reports how often a casual player joins depots and towns, and what stops it", () => {
    const tally = new Map<string, number>();
    let tried = 0;
    let joined = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const pairs: [number, number][] = [];
      const probe = createWorld(seed * 977 + 3);
      const stations = [...probe.stations.values()];
      const pos = (id: number) => probe.layout.getPiece(id)!.pose;
      const nearestStation = (id: number) => stations.filter((s) => s !== id).sort((a, b) => Math.hypot(pos(a).x - pos(id).x, pos(a).z - pos(id).z) - Math.hypot(pos(b).x - pos(id).x, pos(b).z - pos(id).z))[0];
      for (const d of probe.depots.values()) if (stations.length) pairs.push([d, nearestStation(d)]);
      if (stations.length > 1) pairs.push([stations[0], nearestStation(stations[0])]);
      for (const [a, b] of pairs) {
        // A fresh copy of the map for each try.
        const w = createWorld(seed * 977 + 3);
        const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
        const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
        const pb = w.layout.getPiece(b)!.pose;
        const pa = w.layout.getPiece(a)!.pose;
        const from = endToward(w.layout, a, pb.x, pb.z);
        const to = endToward(w.layout, b, pa.x, pa.z);
        if (from === -1 || to === -1) continue;
        const r = play(w.layout, editor, from, to, { blocked: rulesFor(w), maxPieces: 60 });
        tried++;
        if (r.ok) joined++;
        const key = r.ok ? "joined" : `${r.how}${r.blockedBy ? ` (${r.blockedBy})` : ""}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
    console.log(`maps: ${joined}/${tried} joined (${((100 * joined) / Math.max(1, tried)).toFixed(0)}%); ${JSON.stringify(Object.fromEntries(tally))}`);
    expect(tried).toBeGreaterThan(10);
  }, 300_000);
});
