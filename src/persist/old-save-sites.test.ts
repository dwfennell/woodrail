import { describe, expect, it, vi } from "vitest";
import { addTrackPoints, coastOf, siteSquares } from "../landscape";
import { buildStarterWorld, clearRuin, fixedPieces, plotLand, startLand, unlockPlot, type World } from "../game/world";
import { deserializeWorld, serializeWorld, type SaveData } from "./save";

/** While `plain`, the map's extras (sites, extra towns) aren't made: worlds as they were before them, to save as old. */
const state = vi.hoisted(() => ({ plain: false }));
vi.mock("../game/map-sites", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../game/map-sites")>();
  return {
    ...orig,
    addPlotExtras: (...a: Parameters<typeof orig.addPlotExtras>) => (state.plain ? [] : orig.addPlotExtras(...a)),
    addStartSites: (...a: Parameters<typeof orig.addStartSites>) => (state.plain ? [] : orig.addStartSites(...a)),
  };
});

/** A world grown by three plots, as before the map had sites: none on it (saved, its land has no `sites`: `oldSave`). */
function oldWorld(): World {
  state.plain = true;
  try {
    const w = buildStarterWorld();
    for (const [px, pz] of [[-1, 1], [0, 1], [1, 0]] as const) expect(unlockPlot(w, px, pz)).not.toBeNull();
    return w;
  } finally {
    state.plain = false;
  }
}

/** A world saved as before the map had sites: no `sites` in its land. */
function oldSave(w: World): SaveData {
  const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
  delete data.landscape.sites;
  return data;
}

/** The squares a piece's track runs over, and those beside them. */
function trackSquares(w: World, id: number): Set<number> {
  const g = w.landscape.grid;
  const p = w.layout.getPiece(id)!;
  const buckets = new Map<number, number[]>();
  addTrackPoints(buckets, p.type, p.flipped, p.pose);
  const out = new Set<number>();
  for (const list of buckets.values())
    for (let k = 0; k < list.length; k += 2)
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const i = g.index(g.colAt(list[k]) + dc, g.rowAt(list[k + 1]) + dr);
          if (i !== -1) out.add(i);
        }
  return out;
}

describe("an older save gains the map's sites and extra towns as it loads", () => {
  it("on the plots it owns, as a new map has them there, except where the player's track is", () => {
    const old = oldWorld();
    expect(old.landscape.sites ?? []).toEqual([]);
    const coast = coastOf(7, true);
    // What a new map has on those plots (and the start).
    const want = new Map([[-1, 1], [0, 1], [1, 0]].map(([px, pz]) => [`${px},${pz}`, plotLand(7, px, pz, coast)]));
    const start = startLand(7, true);
    // The player's track lies where one of the coast plot's sites would be: that one is skipped.
    const blocked = want.get("-1,1")!.sites![0];
    const mine = old.layout.addPiece("straight-216", { x: blocked.piece.x, z: blocked.piece.z + 36, heading: blocked.piece.heading });
    const r = deserializeWorld(oldSave(old));
    if (!r.ok) throw new Error(r.error);
    const w = r.value;
    const sites = w.landscape.sites!;
    const at = (s: { centre: { x: number; z: number } }) => `${s.centre.x},${s.centre.z}`;
    const have = new Set(sites.map(at));
    // The start's, and each plot's but the blocked one.
    for (const s of start.sites!) expect(have.has(at(s))).toBe(true);
    expect(have.has(at(blocked))).toBe(false);
    for (const [key, land] of want) for (const s of land.sites!) if (s !== blocked) expect(have.has(at(s)), `${key} ${s.role}`).toBe(true);
    // Its extra towns too, each with its station and its goods depot.
    const extraTowns = [...want.values()].reduce((n, land) => n + land.towns.length, 0) - old.landscape.towns.length + 5;
    expect(w.landscape.towns.length).toBeGreaterThan(old.landscape.towns.length);
    expect(w.landscape.towns.length).toBeLessThanOrEqual(old.landscape.towns.length + extraTowns);
    for (const t of w.landscape.towns) {
      const st = w.stations.get(t.id)!;
      expect(w.layout.getPiece(st)!.type).toBe("station");
      expect(w.economy.allDepots().some((d) => d.role === "town" && d.townId === t.id && d.pieceId === st)).toBe(true);
    }
    expect(new Set(w.landscape.towns.map((t) => t.name)).size).toBe(w.landscape.towns.length);
    // Nothing new under the player's track: its squares (and those beside them) as they were saved.
    const g = w.landscape.grid;
    const og = old.landscape.grid;
    for (const i of trackSquares(w, mine)) {
      expect(g.feature[i]).toBe(og.feature[i]);
      expect(g.surface[i]).toBe(og.surface[i]);
      expect(g.height[i]).toBe(og.height[i]);
    }
    // The player's piece is still there, untouched, and not one of the map's.
    expect(w.layout.getPiece(mine)).toBeDefined();
    expect(fixedPieces(w).has(mine)).toBe(false);
    // Each standing site has its stub, fixed.
    for (const s of sites) expect(w.layout.getPiece(w.ruins.get(s.id)!)!.type).toBe("straight-216");
  });

  it("only once: saved again, it loads as it is (and a cleared ruin stays cleared)", () => {
    const old = oldWorld();
    const first = deserializeWorld(oldSave(old));
    if (!first.ok) throw new Error(first.error);
    const w = first.value;
    const site = w.landscape.sites![0];
    expect("slots" in clearRuin(w, site.id)).toBe(true);
    const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
    expect(data.landscape.sites!.length).toBe(w.landscape.sites!.length);
    const again = deserializeWorld(data);
    if (!again.ok) throw new Error(again.error);
    const v = again.value;
    expect(v.landscape.sites).toEqual(w.landscape.sites);
    expect(v.landscape.towns).toEqual(w.landscape.towns);
    expect([...v.ruins]).toEqual([...w.ruins]);
    expect(v.ruins.has(site.id)).toBe(false);
    expect(v.layout.pieceCount).toBe(w.layout.pieceCount);
    for (const k of ["height", "surface", "feature", "owner", "road"] as const) expect(Array.from(v.landscape.grid[k].subarray(0, v.landscape.grid.cellCount))).toEqual(Array.from(w.landscape.grid[k].subarray(0, w.landscape.grid.cellCount)));
  });

  it("an older save's land edited where a site would be: that site is skipped (its squares aren't as generated)", () => {
    const old = oldWorld();
    const coast = coastOf(7, true);
    const site = plotLand(7, 0, 1, coast).sites![0];
    // A square under its yard raised or lowered a level (as the Land tab does).
    const g = old.landscape.grid;
    const [c, r] = siteSquares(site.centre, site.piece.heading).yard[4];
    const was = g.height[g.index(c, r)];
    g.height[g.index(c, r)] = was === 0 ? 1 : was - 1;
    const loaded = deserializeWorld(oldSave(old));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.value.landscape.sites!.some((s) => s.centre.x === site.centre.x && s.centre.z === site.centre.z)).toBe(false);
    expect(loaded.value.landscape.grid.height[g.index(c, r)]).toBe(was === 0 ? 1 : was - 1);
  });
});
