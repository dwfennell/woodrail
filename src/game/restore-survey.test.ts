import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { checkYard } from "./depot-footprint";
import { HARBOUR_STRANDED, restoredType, ruinCard } from "./map-sites";
import { waterWay } from "./harbours";
import { isWater, SURF_GRASS } from "../landscape";
import { restoreRuin, restoreWhy, RUIN_YARD_REACH } from "./restore";
import { rateFor, resourceAt } from "./industries";
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
  it("every standing ruin round 8 starts (2 rings of plots bought, no player track) passes restoreWhy, harbours too (their way is out to sea)", () => {
    const refused: string[] = [];
    let n = 0;
    let harbours = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const s of w.landscape.sites ?? []) {
        if (s.cleared) continue;
        n++;
        if (s.role === "harbour") {
          harbours++;
          // (Out to sea, however much land is bought: not off its edge.)
          expect(waterWay(w.landscape, s.piece, true), `seed ${seed} harbour #${s.id}`).not.toBeNull();
        }
        const why = restoreWhy(w, s.id);
        if (why) refused.push(`seed ${seed} ${s.role} #${s.id} at ${s.centre.x},${s.centre.z} heading ${Math.round((s.piece.heading * 180) / Math.PI)}: ${why}`);
      }
    }
    expect(n).toBeGreaterThan(150);
    expect(harbours).toBeGreaterThan(5);
    expect(refused).toEqual([]);
  });

  it("every restorable ruin meets its site rule in full: restored, it runs at full speed (rate 1)", () => {
    const by = new Map<string, number[]>();
    const short: string[] = [];
    for (const seed of SEEDS) {
      const w = world(seed);
      for (const s of w.landscape.sites ?? []) {
        if (s.cleared || restoreWhy(w, s.id)) continue;
        const r = resourceAt(w.landscape, s.role, s.piece)!;
        const rate = Math.min(1, rateFor(r.count, r.need));
        (by.get(s.role) ?? by.set(s.role, []).get(s.role)!).push(rate);
        if (rate < 1) short.push(`seed ${seed} ${s.role} #${s.id} (plot ${s.plot.px},${s.plot.pz}): ${r.count} of ${r.need}`);
      }
    }
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SURVEY) {
      for (const [role, rates] of by) console.log(`${role}: ${rates.length}, rate min ${Math.min(...rates).toFixed(3)}, avg ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(3)}, under 1: ${rates.filter((x) => x < 1).length}`);
      console.log(short.join("\n"));
    }
    expect(short).toEqual([]);
  });

  it("a harbour ruin whose boats can't reach it (an old save's river harbour, its river ending in land bought since): its card says so, with no Restore", () => {
    const w = world(SEEDS[0]);
    const site = w.landscape.sites!.find((s) => s.role === "harbour" && !s.cleared)!;
    const g = w.landscape.grid;
    const learned = () => true;
    expect(ruinCard(w.landscape, site, "game", learned).restore).toMatch(/^Restore/);
    // Its water cut off two squares out from the quay, as a river ending inland is.
    const was = new Map<number, number>();
    const q = { col: g.colAt(site.centre.x), row: g.rowAt(site.centre.z) };
    g.forEachCell((i, col, row) => {
      if (isWater(g.surface[i]) && Math.max(Math.abs(col - q.col), Math.abs(row - q.row)) > 3) {
        was.set(i, g.surface[i]);
        g.surface[i] = SURF_GRASS;
      }
    });
    try {
      expect(waterWay(w.landscape, site.piece)).toBeNull();
      const card = ruinCard(w.landscape, site, "game", learned);
      expect(card.status).toBe(HARBOUR_STRANDED);
      expect(card.restore).toBeNull();
      expect(restoreWhy(w, site.id)).toMatch(/^Boats can't reach/);
    } finally {
      for (const [i, s] of was) g.surface[i] = s;
    }
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
