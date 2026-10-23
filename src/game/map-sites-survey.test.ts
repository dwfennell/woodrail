import { describe, expect, it } from "vitest";
import { coastOf, generatePlot, seaPlot, SURF_RIVER, SURF_SEA } from "../landscape";
import { rateFor, resourceAt } from "./industries";
import { addPlotExtras, EXTRA_TOWN_CHANCE } from "./map-sites";

/**
 * A survey of the map's extras (towns and sites) on the plots round the start, for choosing how many extra towns there
 * are (`EXTRA_TOWN_CHANCE`): how many plots are by the sea or a river, how many towns they have of their own, how
 * often an extra one fits, and what sites they get. Prints a table; slow-ish, so only when asked:
 *   SURVEY=1 npx vitest run src/game/map-sites-survey.test.ts
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.runIf(!!ENV.SURVEY)("map sites survey", () => {
  it("extra towns and sites on the plots round the start", () => {
    const seeds = [7, 1, 2, 3, 42, 99, 1234, 2027];
    const rows: string[] = [];
    const sum = { plots: 0, coast: 0, river: 0, own: 0, extra: 0, extraCoast: 0, extraRiver: 0, extraInland: 0, sites: 0, noSite: 0, ms: 0, gen: 0, ownCoast: 0, ownRiver: 0 };
    const roles: Record<string, number> = {};
    /** Each role's sites' rates (their resource on the plot as made, against their need: capped at 1). */
    const rates: Record<string, number[]> = {};
    for (const seed of seeds) {
      const coast = coastOf(seed, seed === 7);
      for (let pz = -3; pz <= 2; pz++) {
        for (let px = -3; px <= 2; px++) {
          if (px >= -1 && px <= 0 && pz >= -1 && pz <= 0) continue;
          if (seaPlot(coast, px, pz)) continue;
          const g0 = performance.now();
          const land = generatePlot(seed, px, pz, coast);
          sum.gen += performance.now() - g0;
          const own = land.towns.length;
          let sea = false;
          let river = false;
          land.grid.forEachCell((i) => {
            if (land.grid.surface[i] === SURF_SEA) sea = true;
            if (land.grid.surface[i] === SURF_RIVER) river = true;
          });
          const t0 = performance.now();
          addPlotExtras(land, px, pz);
          sum.ms += performance.now() - t0;
          const extra = land.towns.length - own;
          sum.plots++;
          sum.own += own;
          sum.extra += extra;
          if (sea) {
            sum.coast++;
            sum.extraCoast += extra;
            sum.ownCoast += own;
          } else if (river) {
            sum.river++;
            sum.extraRiver += extra;
            sum.ownRiver += own;
          } else sum.extraInland += extra;
          const sites = land.sites ?? [];
          sum.sites += sites.length;
          if (sites.length === 0) sum.noSite++;
          for (const s of sites) {
            roles[s.role] = (roles[s.role] ?? 0) + 1;
            const r = resourceAt(land, s.role, s.piece)!;
            (rates[s.role] ??= []).push(Math.min(1, rateFor(r.count, r.need)));
          }
          rows.push(`${seed} (${px},${pz}) ${sea ? "coast" : river ? "river" : "inland"} towns ${own}+${extra} sites ${sites.map((s) => s.role).join(",") || "-"}`);
        }
      }
    }
    const inland = sum.plots - sum.coast - sum.river;
    console.log(
      [
        ...rows,
        `plots ${sum.plots} (coast ${sum.coast}, river ${sum.river}, inland ${inland}); chances ${JSON.stringify(EXTRA_TOWN_CHANCE)}`,
        `own towns ${sum.own} (${(sum.own / sum.plots).toFixed(2)} a plot: coast ${sum.ownCoast}, river ${sum.ownRiver}, inland ${sum.own - sum.ownCoast - sum.ownRiver}); extra ${sum.extra} (${(sum.extra / sum.plots).toFixed(2)} a plot): coast ${sum.extraCoast}/${sum.coast}, river ${sum.extraRiver}/${sum.river}, inland ${sum.extraInland}/${inland}`,
        ...Object.entries(rates).map(([role, r]) => `${role}: ${r.length}, rate min ${Math.min(...r).toFixed(3)}, avg ${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(3)}, under 1: ${r.filter((x) => x < 1).length}`),
        `sites ${sum.sites} (${(sum.sites / sum.plots).toFixed(2)} a plot), plots with none ${sum.noSite}; ${JSON.stringify(roles)}; extras ${(sum.ms / sum.plots).toFixed(1)} ms a plot (the plot itself: ${(sum.gen / sum.plots).toFixed(1)} ms)`,
      ].join("\n"),
    );
    expect(sum.plots).toBeGreaterThan(0);
  }, 600_000);
});
