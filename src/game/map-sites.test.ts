import { describe, expect, it } from "vitest";
import {
  checkPlacement,
  coastOf,
  FEAT_RUIN,
  generateLandscape,
  generatePlot,
  MIN_TOWN_SPACING,
  seaPlot,
  shoreDistance,
  siteSquares,
  SURF_RIVER,
  SURF_SEA,
  type Landscape,
} from "../landscape";
import { harbourWhy } from "./harbours";
import { resourceAt, SITE_RULES } from "./industries";
import { addPlotExtras, CLEAR_PRICE, describeLand, MAX_SITES, ruinAt, ruinCard, ruinInWay, ruinNear, siteBlueprint } from "./map-sites";
import { buildStarterWorld, clearRuin, createWorld, fixedPieces, landForSale, plotLand, startLand, unlockPlot } from "./world";
import { deserializeWorld, serializeWorld, type SaveData } from "../persist/save";

/** The plots round the start (5 × 5 less the start's 2 × 2), not the open sea. */
function ring(seed: number, starter = false): { px: number; pz: number }[] {
  const coast = coastOf(seed, starter);
  const out: { px: number; pz: number }[] = [];
  for (let pz = -2; pz <= 2; pz++) for (let px = -2; px <= 2; px++) if (!(px >= -1 && px <= 0 && pz >= -1 && pz <= 0) && !seaPlot(coast, px, pz)) out.push({ px, pz });
  return out;
}

const SEEDS = [7, 1, 2, 42];

/** What a site must have: its yard and stub squares ruined, its resource (all of it, or half on a river's harbour). */
function siteProblems(land: Landscape): string[] {
  const out: string[] = [];
  const g = land.grid;
  for (const s of land.sites ?? []) {
    const sq = siteSquares(s.centre, s.piece.heading);
    if (!sq.yard.every(([c, r]) => g.feature[g.index(c, r)] === FEAT_RUIN && g.owner[g.index(c, r)] === s.id)) out.push(`${s.role} ${s.id}: yard not all ruin`);
    const r = resourceAt(land, s.role, s.piece)!;
    // All it needs, in full (restored, it runs at full speed).
    if (r.count < r.need) out.push(`${s.role} ${s.id}: ${r.count} of ${r.need}`);
    if (s.role === "farm" && (s.fields.length !== 2 || r.count < 8)) out.push(`farm ${s.id}: ${s.fields.length} fields, ${r.count} squares`);
    if (s.role === "harbour" && harbourWhy(land, s.piece)) out.push(`harbour ${s.id}: ${harbourWhy(land, s.piece)}`);
    // Its yard and stub on flat ground (the ruin stands level).
    if (!sq.yard.every(([c, r]) => g.height[g.index(c, r)] === 0)) out.push(`${s.role} ${s.id}: yard on a hill`);
  }
  return out;
}

describe("map sites: generation", () => {
  it("is the same every time for a seed and a plot", () => {
    for (const { px, pz } of ring(7, true).slice(0, 6)) {
      const a = plotLand(7, px, pz, coastOf(7, true));
      const b = plotLand(7, px, pz, coastOf(7, true));
      expect(a.sites).toEqual(b.sites);
      expect(a.towns).toEqual(b.towns);
      expect(Array.from(a.grid.feature)).toEqual(Array.from(b.grid.feature));
      expect(Array.from(a.grid.height)).toEqual(Array.from(b.grid.height));
    }
  });

  it("gives every plot one or two sites, each as its site rule wants, of the kind the plot is richest in first", () => {
    const problems: string[] = [];
    for (const seed of SEEDS) {
      for (const { px, pz } of ring(seed, seed === 7)) {
        const land = plotLand(seed, px, pz, coastOf(seed, seed === 7));
        const n = land.sites?.length ?? 0;
        if (n < 1 || n > MAX_SITES) problems.push(`${seed} (${px},${pz}): ${n} sites`);
        for (const p of siteProblems(land)) problems.push(`${seed} (${px},${pz}) ${p}`);
        // A plot by the sea with a harbour's room has one: water's the plot's richest.
        for (const s of land.sites ?? []) expect(s.plot).toEqual({ px, pz });
      }
    }
    expect(problems).toEqual([]);
  });

  it("leaves the land's own towns, fields and depots as they were (the extras are added after, from their own stream)", () => {
    for (const seed of SEEDS) {
      for (const { px, pz } of ring(seed, seed === 7).slice(0, 8)) {
        const coast = coastOf(seed, seed === 7);
        const plain = generatePlot(seed, px, pz, coast);
        const land = plotLand(seed, px, pz, coast);
        expect(land.towns.slice(0, plain.towns.length)).toEqual(plain.towns);
        expect(land.fields.slice(0, plain.fields.length)).toEqual(plain.fields);
        expect(land.depots).toEqual(plain.depots);
      }
      for (const starter of [true, false]) {
        const plain = generateLandscape(seed, { starter });
        const land = startLand(seed, starter);
        expect(land.towns).toEqual(plain.towns);
        expect(land.depots).toEqual(plain.depots);
        expect(land.fields.slice(0, plain.fields.length)).toEqual(plain.fields);
        expect(land.shed).toEqual(plain.shed);
      }
    }
  });

  it("gives the start one or two sites, an old farm first, off the starter line", () => {
    for (const seed of [7, 3, 12345]) {
      const land = startLand(seed, true);
      const sites = land.sites ?? [];
      expect(sites.length).toBeGreaterThanOrEqual(1);
      expect(sites.length).toBeLessThanOrEqual(2);
      expect(sites[0].role).toBe("farm");
      expect(siteProblems(land)).toEqual([]);
      // Clear of the strip between the first two towns, the sawmill and the forest yard (5 rows either side).
      const [a] = land.towns;
      const g = land.grid;
      for (const s of sites) {
        const sq = siteSquares(s.centre, s.piece.heading);
        for (const [c, r] of [...sq.yard, ...sq.approaches]) {
          const x = g.centreX(c);
          const inStrip = x > Math.min(...land.depots.map((d) => d.centre.x)) - 6 * 72 && x < Math.max(...land.depots.map((d) => d.centre.x)) + 6 * 72;
          if (inStrip) expect(Math.abs(g.centreZ(r) - a.centre.z)).toBeGreaterThanOrEqual(5 * 72 - 36);
        }
      }
    }
  });
});

describe("map sites: more towns beyond the start", () => {
  it("about one more town for every three plots, most by the sea, spaced as the generator spaces towns", () => {
    let plots = 0;
    let extra = 0;
    let coast = 0;
    let coastExtra = 0;
    let inlandExtra = 0;
    for (const seed of SEEDS) {
      const c = coastOf(seed, seed === 7);
      for (const { px, pz } of ring(seed, seed === 7)) {
        const plain = generatePlot(seed, px, pz, c);
        const land = plotLand(seed, px, pz, c);
        const added = land.towns.length - plain.towns.length;
        let sea = false;
        land.grid.forEachCell((i) => (sea ||= land.grid.surface[i] === SURF_SEA));
        plots++;
        extra += added;
        if (sea) {
          coast++;
          coastExtra += added;
        } else inlandExtra += added;
        for (const t of land.towns) for (const u of land.towns) if (t !== u) expect(Math.hypot(t.centre.x - u.centre.x, t.centre.z - u.centre.z)).toBeGreaterThanOrEqual(MIN_TOWN_SPACING);
        expect(new Set(land.towns.map((t) => t.name)).size).toBe(land.towns.length);
        // An extra town's station on grass, its houses grown.
        for (const t of land.towns.slice(plain.towns.length)) expect(t.buildings.length).toBeGreaterThanOrEqual(4);
      }
    }
    expect(extra / plots).toBeGreaterThan(0.2);
    expect(extra / plots).toBeLessThan(0.6);
    // By the sea far more often than inland.
    expect(coastExtra / coast).toBeGreaterThan(0.5);
    expect(coastExtra / coast).toBeGreaterThan((inlandExtra / (plots - coast)) * 2);
  });

  it("puts a town by the sea (or a river) where it can: the coast plots' extra towns are near the water", () => {
    for (const seed of SEEDS) {
      const c = coastOf(seed, seed === 7);
      for (const { px, pz } of ring(seed, seed === 7)) {
        const plain = generatePlot(seed, px, pz, c);
        const land = plotLand(seed, px, pz, c);
        let sea = false;
        land.grid.forEachCell((i) => (sea ||= land.grid.surface[i] === SURF_SEA));
        if (!sea) continue;
        for (const t of land.towns.slice(plain.towns.length)) {
          const g = land.grid;
          let near = shoreDistance(c, g.colAt(t.centre.x), g.rowAt(t.centre.z)) <= 12;
          g.forEachCell((i, col, row) => (near ||= g.surface[i] === SURF_RIVER && Math.hypot(g.centreX(col) - t.centre.x, g.centreZ(row) - t.centre.z) < 500));
          expect(near, `${seed} (${px},${pz}) ${t.name}`).toBe(true);
        }
      }
    }
  });

  it("buying a plot brings its extra towns and its ruins (each ruin's stub a fixed piece of track)", () => {
    const w = buildStarterWorld();
    const towns = w.landscape.towns.length;
    const bought = unlockPlot(w, -1, 1)!;
    expect(bought.sites.length).toBeGreaterThan(0);
    expect(w.landscape.towns.length).toBe(towns + bought.towns.length);
    for (const id of bought.sites) {
      const stub = w.ruins.get(id)!;
      expect(w.layout.getPiece(stub)!.type).toBe("straight-216");
      expect(fixedPieces(w).has(stub)).toBe(true);
    }
    expect(new Set(w.landscape.towns.map((t) => t.name)).size).toBe(w.landscape.towns.length);
  });
});

describe("map sites: what the player is told", () => {
  it("a locked ruin's card: its name, its fields, what opens it, and that you can build your own", () => {
    const w = buildStarterWorld();
    const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
    expect(ruinCard(w.landscape, farm, "game", () => false)).toEqual({
      title: "Old farm",
      resource: "🌾 Farm fields nearby: 8 of 8",
      status: "🔒 Learn Farming at a school to open this farm",
      open: false,
      restore: null,
      own: "Or build your own anywhere from the Industries tab.",
      clear: `Clear the ruin · ${CLEAR_PRICE}🪙`,
    });
    // Learned: Restore, at half a new farm yard's price (6🪵 90🪙), and building your own is still said.
    expect(ruinCard(w.landscape, farm, "game", (id) => id === "farming")).toMatchObject({ status: "🔧 Half the price of a new farm yard", open: true, restore: "Restore · 3🪵 45🪙", own: "Or build your own anywhere from the Industries tab." });
    // Sandbox: no blueprints, no Industries tab, no coins.
    expect(ruinCard(w.landscape, farm, "sandbox", () => false)).toMatchObject({ status: "🔧 Restore it to work again", restore: "Restore", own: null, clear: "Clear the ruin" });
  });

  it("names each kind's blueprint, and says how much of its resource is near", () => {
    expect(["farm", "quarry", "mine", "harbour"].map((r) => siteBlueprint(r as "farm")?.label)).toEqual(["Farming", "Quarries", "Mines", "Harbours"]);
    const land = plotLand(7, -2, 0, coastOf(7, true));
    for (const s of land.sites!) {
      const card = ruinCard(land, s, "game", () => false);
      expect(card.title).toBe(`Old ${s.role}`);
      expect(card.resource).toMatch(/^(🌾 Farm fields|⛰️ Hillside|🌊 Water) nearby: \d+ of \d+$/);
      expect(card.status).toBe(`🔒 Learn ${siteBlueprint(s.role)!.label} at a school to open this ${s.role}`);
    }
  });

  it("the land card lists a plot's towns (by the sea, if they are) and its old sites", () => {
    const c = coastOf(7, true);
    // The starter map's two coast plots to the south: "empty space" before; a town by the sea and a site each now.
    expect(describeLand(plotLand(7, -1, 1, c))).toBe("A town by the sea, an old harbour and a river.");
    expect(describeLand(plotLand(7, 0, 1, c))).toBe("A town by the sea and an old harbour.");
    // Words for two of a kind.
    const land = plotLand(7, -2, 0, c);
    const two = { ...land, sites: [...land.sites!, { ...land.sites![0], id: 9 }] };
    expect(describeLand(two)).toMatch(/2 old (farms|quarries|mines|harbours)/);
    // Inland, nothing but grass.
    const bare = generatePlot(7, -2, 0, c);
    bare.towns = [];
    bare.depots = [];
    bare.grid.height.fill(0);
    bare.grid.surface.fill(0);
    expect(describeLand(bare)).toBe("Open countryside.");
  });
});

describe("map sites: clearing a ruin", () => {
  it("takes its stub and its yard away (track can go there then), keeps its fields, and can't be done twice", () => {
    const w = buildStarterWorld();
    const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
    const stub = w.ruins.get(farm.id)!;
    const fields = farm.fields.map((f) => w.landscape.fields[f].cells.length);
    const g = w.landscape.grid;
    // A straight across its yard is refused while it stands.
    const across = { x: farm.centre.x - 108, z: farm.centre.z + 72, heading: farm.piece.heading };
    expect(checkPlacement(w.landscape, "straight-216", false, across, 0)).toEqual({ kind: "blocked", reason: "ruin" });
    expect(ruinAt(w.landscape, farm.centre.x, farm.centre.z)).toBe(farm.id);
    const done = clearRuin(w, farm.id);
    expect("slots" in done).toBe(true);
    expect(farm.cleared).toBe(true);
    expect(w.layout.getPiece(stub)).toBeUndefined();
    expect(w.ruins.has(farm.id)).toBe(false);
    let left = 0;
    g.forEachCell((i) => (left += g.feature[i] === FEAT_RUIN && g.owner[i] === farm.id ? 1 : 0));
    expect(left).toBe(0);
    expect(checkPlacement(w.landscape, "straight-216", false, across, 0)).toEqual({ kind: "clear" });
    expect(ruinAt(w.landscape, farm.centre.x, farm.centre.z)).toBe(-1);
    expect(farm.fields.map((f) => w.landscape.fields[f].cells.length)).toEqual(fields);
    expect(clearRuin(w, farm.id)).toEqual({ why: "It's gone already" });
  });

  it("track held over a ruin names it, and offers Restore once it can be restored", () => {
    const w = buildStarterWorld();
    const farm = w.landscape.sites!.find((s) => s.role === "farm")!;
    expect(ruinNear(w.landscape, farm.centre.x, farm.centre.z)).toBe(farm.id);
    expect(ruinNear(w.landscape, farm.centre.x + 3000, farm.centre.z + 3000)).toBe(-1);
    expect(ruinInWay(farm, false)).toBe("An old farm is in the way: tap it to clear it");
    expect(ruinInWay(farm, true)).toBe("An old farm is in the way: tap it to restore or clear it");
  });

  it("not while a train stands on its stub", () => {
    const w = buildStarterWorld();
    const site = w.landscape.sites![0];
    const placed = w.sim.addTrain(["engine"], { pieceId: w.ruins.get(site.id)!, pathIndex: 0, reversed: false, s: 100 });
    expect(placed.kind).toBe("placed");
    expect(clearRuin(w, site.id)).toEqual({ why: "A train is on its track" });
    expect(site.cleared).toBeFalsy();
  });

  it("a map made without its sites (QA's recordings) has none", () => {
    const w = createWorld(7, true, false);
    expect(w.landscape.sites).toEqual([]);
    expect(w.ruins.size).toBe(0);
    expect(addPlotExtras).toBeTypeOf("function");
    expect(SITE_RULES.farm!.need).toBe(8);
  });
});

describe("map sites: none in Sandbox", () => {
  it("a Sandbox map has no sites or ruins, on its start or on land added; its land card names none; it saves so", () => {
    for (const w of [createWorld(7, false, true, false), buildStarterWorld(false)]) {
      expect(w.landscape.sites).toEqual([]);
      expect(w.landscape.siteless).toBe(true);
      expect(w.ruins.size).toBe(0);
      for (const [px, pz] of [[-1, 1], [0, 1], [1, 0]] as const) {
        const land = landForSale(w.landscape, px, pz);
        expect(land.sites ?? []).toEqual([]);
        expect(describeLand(land)).not.toMatch(/old/);
        expect(unlockPlot(w, px, pz)!.sites).toEqual([]);
      }
      expect(w.landscape.sites).toEqual([]);
      let ruins = 0;
      w.landscape.grid.forEachCell((i) => (ruins += w.landscape.grid.feature[i] === FEAT_RUIN ? 1 : 0));
      expect(ruins).toBe(0);
      const again = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))), { sandbox: true });
      if (!again.ok) throw new Error(again.error);
      expect(again.value.landscape.siteless).toBe(true);
      expect(again.value.landscape.sites).toEqual([]);
    }
  });

  it("an old Sandbox save (no sites) gains none as it loads; the same save loaded for Game mode would", () => {
    const w = createWorld(7, true, false);
    const data = JSON.parse(JSON.stringify(serializeWorld(w))) as SaveData;
    delete data.landscape.sites;
    const sandbox = deserializeWorld(JSON.parse(JSON.stringify(data)), { sandbox: true });
    if (!sandbox.ok) throw new Error(sandbox.error);
    expect(sandbox.value.landscape.sites).toEqual([]);
    expect(sandbox.value.landscape.siteless).toBe(true);
    expect(sandbox.value.ruins.size).toBe(0);
    expect(sandbox.value.layout.pieceCount).toBe(w.layout.pieceCount);
    const game = deserializeWorld(data);
    if (!game.ok) throw new Error(game.error);
    expect(game.value.landscape.sites!.length).toBeGreaterThan(0);
  });

  it("a Sandbox plot still gets its extra town, as Game's does", () => {
    const c = coastOf(7, true);
    const sandbox = generatePlot(7, -1, 1, c);
    addPlotExtras(sandbox, -1, 1, false);
    expect(sandbox.sites ?? []).toEqual([]);
    expect(sandbox.towns.length).toBe(generatePlot(7, -1, 1, c).towns.length + 1);
  });
});
