import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { checkYard } from "./depot-footprint";
import { restoredType } from "./map-sites";
import { restoreRuin, restoreWhy, RUIN_YARD_REACH } from "./restore";
import { createWorld, fixedPieces, plotsForSale, unlockPlot, type World } from "./world";

/** Seeds whose starts, and the two rings of plots round them (bought), are surveyed. */
const SEEDS = [7, 1, 2, 3, 42, 99, 1234, 2027];

/** A new Game map from `seed` with two rings of plots round its start bought: its ruins all standing, no player track. */
function boughtOut(seed: number): World {
  const w = createWorld(seed, true);
  for (let round = 0; round < 2; round++) for (const p of plotsForSale(w.landscape)) unlockPlot(w, p.px, p.pz);
  return w;
}

const worlds = new Map<number, World>();
const world = (seed: number) => worlds.get(seed) ?? worlds.set(seed, boughtOut(seed)).get(seed)!;

/** The yard check a ruin had before `RUIN_YARD_REACH`: the industry's whole pad on the ground. */
function wholePadRefuses(w: World, siteId: number): boolean {
  const site = w.landscape.sites![siteId];
  const stub = w.ruins.get(siteId)!;
  const piece = w.layout.getPiece(stub)!;
  site.cleared = true;
  try {
    return checkYard({ land: w.landscape, layout: w.layout, props: w.props, footprint: () => undefined }, restoredType(site.role), piece.pose, piece.y, stub) !== null;
  } finally {
    site.cleared = undefined;
  }
}

describe("restoring a ruin: every generated ruin can be", () => {
  it("every standing ruin round 8 starts (2 rings of plots bought, no player track) passes restoreWhy, but for a harbour whose water no longer leads off the land", () => {
    const refused: string[] = [];
    const boats: string[] = [];
    let n = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const s of w.landscape.sites ?? []) {
        if (s.cleared) continue;
        n++;
        const why = restoreWhy(w, s.id);
        const at = `seed ${seed} ${s.role} #${s.id} at ${s.centre.x},${s.centre.z} heading ${Math.round((s.piece.heading * 180) / Math.PI)}`;
        // (A harbour's boats must reach water leading off the player's land: a river that did when the plot was made
        // can end inside the land bought since. The rule, not the ruin's yard.)
        if (why && s.role === "harbour" && why.startsWith("Boats can't reach")) boats.push(at);
        else if (why) refused.push(`${at}: ${why}`);
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(refused).toEqual([]);
    expect(boats.length).toBeLessThanOrEqual(2);
  });

  it("restores a farm whose fields lie against its yard, every way round, and quarries, mines and harbours by their hillside or water: what the whole pad refused", () => {
    // Ruins the industry's whole pad would have refused (its few mm past the ruin's row of squares), by role and heading.
    const seen = new Map<string, number>();
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const s of w.landscape.sites ?? []) {
        if (s.cleared || !wholePadRefuses(w, s.id) || restoreWhy(w, s.id)) continue;
        const key = `${s.role} ${Math.round((s.piece.heading * 180) / Math.PI)}`;
        if (seen.has(key)) continue;
        // Restored for real, on its own world (a fresh one: the survey's worlds stay as made).
        const fresh = boughtOut(seed);
        const fixed = fixedPieces(fresh);
        const editor = new Editor(fresh.layout, fresh.sim, () => {}, (id) => fixed.has(id));
        const done = restoreRuin(fresh, editor, s.id);
        expect("pieceId" in done ? fresh.layout.getPiece(done.pieceId)!.type : done.why, key).toBe(`depot-${s.role}`);
        seen.set(key, seed);
      }
    }
    for (const heading of [0, 90, 180, -90]) expect(seen.has(`farm ${heading}`), `a farm heading ${heading}`).toBe(true);
    for (const role of ["quarry", "mine"]) expect([...seen.keys()].some((k) => k.startsWith(role)), role).toBe(true);
    expect(RUIN_YARD_REACH).toBe(108);
  });
});
