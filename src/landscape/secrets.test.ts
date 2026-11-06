import { describe, expect, it } from "vitest";
import { HALT_Z, SHIPWRECK_SEA_Z } from "../catalogue/secret-frame";
import { createWorld, landForSale } from "../game/world";
import { coastOf } from "./coast";
import { CELL, FEAT_SECRET, PLOT_COLS, PLOT_ROWS, SURF_SAND, SURF_SEA } from "./grid";
import { approachCells, frameOf, frameToWorld, inSecretFootprint, planSecrets, ringOf, siteCells, type SecretSite } from "./secrets";
import type { Landscape } from "./generate";

const SEEDS = Array.from({ length: 14 }, (_, i) => 101 + i * 37);

/** Every secret of a map: the start's, and each planned plot's land for sale made (as the game makes it). */
function sitesOf(land: Landscape): { site: SecretSite; land: Landscape }[] {
  const out = (land.secrets ?? []).map((site) => ({ site, land }));
  for (const p of land.secretPlan ?? []) {
    if (ringOf(p.px, p.pz) === 0) continue;
    const part = landForSale(land, p.px, p.pz);
    for (const site of part.secrets ?? []) out.push({ site, land: part });
  }
  return out;
}

describe("secrets on the map: the plan", () => {
  for (const seed of [...SEEDS, 7]) {
    it(`seed ${seed}: one of each, apart, near the start, at most one in it, the shipwreck on the coast`, () => {
      const coast = coastOf(seed, seed === 7);
      const all = planSecrets(seed, coast);
      const plan = all.filter((p) => !p.alt);
      expect(plan.map((p) => p.kind).sort()).toEqual(["castle", "footprint", "lake", "lost-mine", "shipwreck", "stones"]);
      expect(plan.filter((p) => ringOf(p.px, p.pz) === 0).length).toBeLessThanOrEqual(1);
      // (Alternates too: whichever of a kind's choices it ends up on, it's apart from the rest.)
      for (const a of all) for (const b of all) if (a !== b) expect(Math.max(Math.abs(a.px - b.px), Math.abs(a.pz - b.pz)), `${a.kind} and ${b.kind}`).toBeGreaterThanOrEqual(2);
      // Near the start: the first rings, never far out.
      for (const p of plan) expect(ringOf(p.px, p.pz), p.kind).toBeLessThanOrEqual(3);
      expect(plan.filter((p) => ringOf(p.px, p.pz) <= 2).length).toBeGreaterThanOrEqual(5);
      const wreck = plan.find((p) => p.kind === "shipwreck")!;
      expect(coast.side === "n" || coast.side === "s" ? wreck.pz : wreck.px).toBe(coast.plot);
      // The same every time (it's saved, but a plot's land for sale is made from it).
      expect(planSecrets(seed, coast)).toEqual(all);
      // Each kind's alternates are later in its line, never in the start.
      for (const a of all.filter((p) => p.alt)) expect(ringOf(a.px, a.pz), a.kind).toBeGreaterThan(0);
    });
  }

  it("a map with no coast has the five inland secrets, each once", () => {
    const plan = planSecrets(5, null).filter((p) => !p.alt);
    expect(plan.map((p) => p.kind).sort()).toEqual(["castle", "footprint", "lake", "lost-mine", "stones"]);
  });

  it("an older save's plan keeps off the plots it has", () => {
    const owned = new Set(["-1,-1", "0,-1", "-1,0", "0,0", "1,0", "1,-1"]);
    const plan = planSecrets(9, coastOf(9), (px, pz) => owned.has(`${px},${pz}`));
    expect(plan.filter((p) => !p.alt)).toHaveLength(6);
    for (const p of plan) expect(owned.has(`${p.px},${p.pz}`)).toBe(false);
  });
});

describe("secrets on the map: placed as the land is made", () => {
  const maps = [...SEEDS.slice(0, 8).map((seed) => ({ seed, starter: false })), { seed: 7, starter: true }];
  for (const { seed, starter } of maps) {
    it(`seed ${seed}${starter ? " (the starter map)" : ""}: every planned secret stands on open, level ground with room for its line`, () => {
      const world = createWorld(seed, starter);
      const land = world.landscape;
      const sites = sitesOf(land);
      // (Every one placed, once: on its first choice of plot, or where that had no room, an alternate.)
      expect(sites.map((s) => s.site.kind).sort()).toEqual([...(land.secretPlan ?? [])].filter((p) => !p.alt).map((p) => p.kind).sort());
      for (const { site, land: l } of sites) {
        const g = l.grid;
        const f = frameOf(site.piece);
        for (const [c, r] of siteCells(f, site.kind)) {
          const i = g.index(c, r);
          expect(i, `${site.kind}: in its land`).not.toBe(-1);
          expect(g.feature[i], site.kind).toBe(FEAT_SECRET);
          expect(g.owner[i], site.kind).toBe(site.id);
          expect(g.height[i], `${site.kind}: level`).toBe(0);
        }
        // Two open squares on its halt's line, for a line to come in on.
        for (const [c, r] of approachCells(f)) {
          const i = g.index(c, r);
          expect(i).not.toBe(-1);
          // (Open, or the site's own corner square: its footprint, not the square, keeps track off.)
          expect(g.feature[i] === 0 || (g.feature[i] === FEAT_SECRET && g.owner[i] === site.id), `${site.kind}: its way in`).toBe(true);
          expect(g.road[i]).toBe(0);
        }
        // Its plot is the plan's.
        const m = frameToWorld(f, 0, HALT_Z);
        expect(Math.floor(m.x / (PLOT_COLS * CELL)) === site.plot.px || Math.floor(m.z / (PLOT_ROWS * CELL)) === site.plot.pz).toBe(true);
        // The footprint: its body and (not found) its halt's bed, and not past its join.
        const join = frameToWorld(f, -108 - 30, HALT_Z);
        expect(inSecretFootprint(l, site.id, join.x, join.z), `${site.kind}: its way in is open`).toBe(false);
        const halt = frameToWorld(f, 0, HALT_Z);
        expect(inSecretFootprint(l, site.id, halt.x, halt.z)).toBe(true);
        const body = frameToWorld(f, 0, 0);
        expect(inSecretFootprint(l, site.id, body.x, body.z)).toBe(true);
        if (site.kind === "shipwreck") {
          // On the beach: sand just inside its seaward edge, the sea just past it, all along.
          for (const fx of [-140, 0, 140]) {
            const land1 = frameToWorld(f, fx, SHIPWRECK_SEA_Z + 30);
            const sea = frameToWorld(f, fx, SHIPWRECK_SEA_Z - 30);
            expect(g.surface[g.cellAtWorld(land1.x, land1.z)], "sand inside the edge").toBe(SURF_SAND);
            expect(g.surface[g.cellAtWorld(sea.x, sea.z)], "the sea past it").toBe(SURF_SEA);
          }
        }
      }
    });
  }

  it("a plot's land for sale has the same secret, in the same place, however often it's made", () => {
    const a = createWorld(SEEDS[0]).landscape;
    const b = createWorld(SEEDS[0]).landscape;
    const p = a.secretPlan!.find((q) => ringOf(q.px, q.pz) > 0)!;
    // (b's other plots made first, in another order.)
    for (const q of [...b.secretPlan!].reverse()) if (ringOf(q.px, q.pz) > 0) landForSale(b, q.px, q.pz);
    expect(landForSale(a, p.px, p.pz).secrets).toEqual(landForSale(b, p.px, p.pz).secrets);
  });
});
