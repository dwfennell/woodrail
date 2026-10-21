import {
  addTrackPoints,
  adoptRegion,
  CELL,
  FEAT_BUILDING,
  FEAT_FIELD,
  FEAT_NONE,
  FEAT_RUIN,
  FEAT_STATION,
  freeName,
  generateLandscape,
  generatePlot,
  PLOT_DEPTH,
  plotKey,
  plotSlotOf,
  seaPlot,
  START_REGION,
  type DepotKind,
  type Landscape,
  type MapSite,
  type PlotCoord,
  type Town,
} from "../landscape";
import { Economy, type DepotRole } from "../economy";
import { Sim } from "../sim";
import { kitOf, Layout, type PieceTypeId } from "../track";
import { PropStore } from "../props/store";
import { isTownLot, SCHOOL_REACH } from "./town-lots";
import { addPlotExtras, addStartSites, type Extra } from "./map-sites";
import { addTownProps } from "../props/towns";

export const depotPieceType = (kind: DepotKind): PieceTypeId => (kind === "forest" ? "depot-forest" : "depot-sawmill");

export const DEPOT_NAMES: Record<Exclude<DepotRole, "town">, string> = {
  forest: "Forest yard",
  sawmill: "Sawmill",
  workshop: "Workshop",
  farm: "Farm yard",
  mill: "Mill",
  quarry: "Quarry",
  warehouse: "Warehouse",
  mine: "Mine",
  foundry: "Foundry",
  carpenter: "Carpenter's yard",
  smithy: "Smithy",
  power: "Power station",
  harbour: "Harbour",
  // (Named after its town: see `depotName`.)
  school: "School",
  // Sandbox's cargo machines (kit pieces): their own names are their kits' (`KitDef.name`).
  "loader-log": "Log loader",
  "loader-grain": "Grain loader",
  "loader-coal": "Coal loader",
  "loader-planks": "Crane",
  unloader: "Unloader",
};

/** Depot pieces and the work their economy depot does (the map's own, and industries the player places). */
export const INDUSTRY_ROLE: Partial<Record<PieceTypeId, DepotRole>> = {
  "depot-forest": "forest",
  "depot-sawmill": "sawmill",
  "depot-workshop": "workshop",
  "depot-farm": "farm",
  "depot-mill": "mill",
  "depot-quarry": "quarry",
  "depot-warehouse": "warehouse",
  "depot-mine": "mine",
  "depot-foundry": "foundry",
  "depot-carpenter": "carpenter",
  "depot-smithy": "smithy",
  "depot-power": "power",
  "depot-harbour": "harbour",
  "depot-school": "school",
};

/** A depot's name for cards, stops and the map: its kind's ("Workshop"), a school by its town ("Larkfield school"). */
export function depotName(world: Pick<World, "landscape">, d: { role: DepotRole; townId: number }): string {
  if (d.role === "school") {
    const town = world.landscape.towns.find((t) => t.id === d.townId);
    return town ? `${town.name} school` : DEPOT_NAMES.school;
  }
  return d.role === "town" ? (world.landscape.towns.find((t) => t.id === d.townId)?.name ?? "") : DEPOT_NAMES[d.role];
}

export { isTownLot, SCHOOL_REACH } from "./town-lots";

/**
 * The town a school at `pose` (its piece's origin) stands beside: the town of the nearest of its lots within
 * `SCHOOL_REACH` of the yard's middle (as `yardMiddle` puts it), and how many lots are that near; null if none. A
 * hundred-odd squares: cheap enough for every move of a held piece.
 */
export function schoolTown(land: Landscape, pose: { x: number; z: number; heading: number }): { town: Town; count: number } | null {
  const g = land.grid;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const mx = pose.x + c * 108 - s * 72;
  const mz = pose.z + s * 108 + c * 72;
  const r = Math.ceil(SCHOOL_REACH / CELL);
  const col = g.colAt(mx);
  const row = g.rowAt(mz);
  let count = 0;
  let best = Infinity;
  let at: { x: number; z: number } | null = null;
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i === -1 || !isTownLot(land, i)) continue;
      const x = g.centreX(col + dc);
      const z = g.centreZ(row + dr);
      const d = Math.hypot(x - mx, z - mz);
      if (d > SCHOOL_REACH) continue;
      count++;
      if (d < best) {
        best = d;
        at = { x, z };
      }
    }
  }
  if (!at) return null;
  let town: Town | null = null;
  let near = Infinity;
  for (const t of land.towns) {
    const d = Math.hypot(t.centre.x - at.x, t.centre.z - at.z);
    if (d < near) {
      near = d;
      town = t;
    }
  }
  return town ? { town, count } : null;
}

/**
 * Give every industry piece on the map an economy depot (one the player has just placed). A depot whose piece is
 * taken up stays, with its piles, until the piece comes back (undo); saving leaves it out. Returns true if any was
 * added.
 */
export function syncIndustries(world: World, halts = false): boolean {
  let added = false;
  for (const id of world.layout.pieceIds()) {
    const piece = world.layout.getPiece(id)!;
    const type = piece.type;
    if (halts && HALT_KITS.has(type)) {
      // A halt (Game mode): a passenger stop for the town nearest it, kept linked to the nearest as it moves.
      const town = haltTown(world.landscape, piece.pose);
      const d = world.economy.depotAtPiece(id);
      if (d) {
        if (town && d.townId !== town.id) d.townId = town.id;
      } else if (town) {
        world.economy.addDepot("town", id, town.id);
        added = true;
      }
      continue;
    }
    // An industry's piece, or a kit piece that's a cargo stop (Sandbox's loaders and unloaders).
    const role = INDUSTRY_ROLE[type] ?? kitOf(type)?.depot;
    if (!role) continue;
    // A school belongs to the town it's beside (kept as it moves: it's renamed with it).
    const school = role === "school" ? (schoolTown(world.landscape, piece.pose)?.town.id ?? -1) : -1;
    const have = world.economy.depotAtPiece(id);
    if (have) {
      if (role === "school" && have.townId !== school) have.townId = school;
      continue;
    }
    world.economy.addDepot(role, id, school);
    added = true;
  }
  return added;
}

/**
 * Game mode's halts: kit pieces that are passenger stops (`stop.who` "passengers", one road) and, placed within
 * `HALT_REACH` of a town, become another stop of that town's (an economy depot of role "town"): people wait there,
 * get on, and get off from other towns, exactly as at its station (see `Economy.isHalt`). Goods trains run through.
 */
export const HALT_KITS: ReadonlySet<PieceTypeId> = new Set<PieceTypeId>(["kit-country-halt", "kit-mountain-station", "kit-harbour-station", "kit-platform-furnished"]);

/** How far a halt may stand from a town's middle (mm): a plot's depth, about 23 squares. */
export const HALT_REACH = PLOT_DEPTH;

/** The town nearest a halt at `pose` (its piece's origin) within `HALT_REACH`, or null. A few towns: cheap. */
export function haltTown(land: Landscape, pose: { x: number; z: number; heading: number }): Landscape["towns"][number] | null {
  // Measured from the platform's middle (108 along a 216 halt).
  const x = pose.x + 108 * Math.cos(pose.heading);
  const z = pose.z + 108 * Math.sin(pose.heading);
  let best: Landscape["towns"][number] | null = null;
  let bestD = HALT_REACH;
  for (const t of land.towns) {
    const d = Math.hypot(t.centre.x - x, t.centre.z - z);
    if (d <= bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** A halt too far from every town: how far it may be, in squares (the land's, as the game names them elsewhere). */
export const HALT_TOO_FAR = `Build halts within ${Math.round(HALT_REACH / CELL)} squares of a town`;

/** Game mode's rule for a halt's place (`Interaction.siteRule`): near a town, or why not. */
export function haltWhy(land: Landscape, type: PieceTypeId, pose: { x: number; z: number; heading: number }): string | null {
  return HALT_KITS.has(type) && !haltTown(land, pose) ? HALT_TOO_FAR : null;
}

export interface World {
  layout: Layout;
  sim: Sim;
  landscape: Landscape;
  /** Town id → its station piece id. */
  stations: Map<number, number>;
  /** Depot id → its depot piece id. */
  depots: Map<number, number>;
  /** Piles, production and cargo; one economy depot per landscape depot and per town station (see `addSites`). */
  economy: Economy;
  /** Placed catalogue models (decorative). */
  props: PropStore;
  /** Old industries' sites (`Landscape.sites`) still standing: site id → its stub piece's id (fixed, like a depot's). */
  ruins: Map<number, number>;
}

/** The ruins' stub of track: a plain 216 mm straight (step 2's Restore swaps it for the industry's piece in place). */
export const RUIN_STUB: PieceTypeId = "straight-216";

/** The pieces that are the map's own and can't be moved or taken up: stations, depots and ruins' stubs. */
export function fixedPieces(w: Pick<World, "stations" | "depots" | "ruins">): Set<number> {
  return new Set([...w.stations.values(), ...w.depots.values(), ...w.ruins.values()]);
}

/** Where a town station's goods crane stops wagons: near its socket end, by the plank pile. */
export const STATION_CRANE_AT = 30;

/**
 * Put the fixed pieces (stations and depots) of some towns and depots on the layout, with their economy depots: the
 * landscape's depots first, then one goods depot per town station.
 */
function addSites(world: Omit<World, "landscape">, towns: Landscape["towns"], depots: Landscape["depots"], ruins: readonly MapSite[] = []): void {
  for (const town of towns) world.stations.set(town.id, world.layout.addPiece("station", town.station));
  for (const depot of depots) world.depots.set(depot.id, world.layout.addPiece(depotPieceType(depot.kind), depot.piece));
  for (const site of ruins) if (!site.cleared) world.ruins.set(site.id, world.layout.addPiece(RUIN_STUB, site.piece));
  for (const d of depots) world.economy.addDepot(d.kind, world.depots.get(d.id)!);
  for (const t of towns) world.economy.addDepot("town", world.stations.get(t.id)!, t.id, STATION_CRANE_AT);
}

export const STARTER_SEED = 7;

/**
 * A fresh map: generated landscape with a station piece in every town and no player track. Without `extras`, the map
 * as it was before its old industries' sites (`addStartSites`): for QA's recordings made on such maps.
 */
export function createWorld(seed: number, starter = false, extras = true): World {
  const landscape = extras ? startLand(seed, starter) : generateLandscape(seed, { starter });
  const layout = new Layout();
  const sim = new Sim(layout);
  const world: World = { layout, sim, landscape, stations: new Map(), depots: new Map(), economy: new Economy(layout, sim), props: new PropStore(), ruins: new Map() };
  addSites(world, landscape.towns, landscape.depots, landscape.sites);
  addTownProps(landscape, world.props);
  return world;
}

/** A new map's land: the start region, and its old industries' sites (`addStartSites`). */
export function startLand(seed: number, starter = false, coast = true): Landscape {
  const land = generateLandscape(seed, { starter, coast });
  addStartSites(land);
  return land;
}

/**
 * The map a new player sees: the starter landscape (two towns close together with a clear run between their
 * stations) and nothing else — joining them is the first thing to do.
 */
export function buildStarterWorld(): World {
  return createWorld(STARTER_SEED, true);
}

const GAMES_KEY = "woodrail.game.started";

/**
 * A new Game-mode map. The first game is on the starter map; after that each is a fresh starter-style map (two towns
 * with a clear run between them, a forest yard and a sawmill near them) from a new seed, so no two games are alike.
 */
export function freshGameWorld(random: () => number = Math.random): World {
  let first = true;
  try {
    first = localStorage.getItem(GAMES_KEY) === null;
    localStorage.setItem(GAMES_KEY, "1");
  } catch {
    // storage unavailable: every game is someone's first
  }
  return first ? buildStarterWorld() : createWorld(Math.floor(random() * 1_000_000), true);
}

/** Plots that can be added to the world: those sharing an edge with land it has (not the open sea). */
export function plotsForSale(land: Landscape): PlotCoord[] {
  const g = land.grid;
  const out = new Map<number, PlotCoord>();
  for (const p of g.plots) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = { px: p.px + dx, pz: p.pz + dz };
      if (!g.hasPlot(q.px, q.pz) && !seaPlot(land.coast ?? null, q.px, q.pz)) out.set(plotKey(q.px, q.pz), q);
    }
  }
  return [...out.values()];
}

/**
 * Plots shown around the world but not in it: every plot within one of the world's land (so any gap inside its
 * bounding box is filled too, and the scenery beyond starts on a rectangle).
 */
export function plotsAround(land: Landscape): PlotCoord[] {
  const g = land.grid;
  const px0 = Math.min(...g.plots.map((p) => p.px)) - 1;
  const pz0 = Math.min(...g.plots.map((p) => p.pz)) - 1;
  const px1 = Math.max(...g.plots.map((p) => p.px)) + 1;
  const pz1 = Math.max(...g.plots.map((p) => p.pz)) + 1;
  const out: PlotCoord[] = [];
  for (let pz = pz0; pz <= pz1; pz++) for (let px = px0; px <= px1; px++) if (!g.hasPlot(px, pz)) out.push({ px, pz });
  return out;
}

/** Land for sale, generated once per world and kept until it's bought: the plot, and whether it has its extras yet. */
const forSale = new WeakMap<Landscape, Map<number, { part: Landscape; extras: boolean }>>();

/** A plot's land as `generatePlot` makes it, then with the map's extras (`addPlotExtras`): towns and old sites. */
export function plotLand(seed: number, px: number, pz: number, coast: Landscape["coast"]): Landscape {
  const part = generatePlot(seed, px, pz, coast ?? null);
  addPlotExtras(part, px, pz);
  return part;
}

/** The land a plot would bring (generated on first ask, then kept). */
export function landForSale(land: Landscape, px: number, pz: number): Landscape {
  while (prepareLandForSale(land, px, pz));
  return forSale.get(land)!.get(plotKey(px, pz))!.part;
}

/**
 * Make a plot's land for sale a step at a time (for doing between frames): the plot, then its extras. True while
 * there's more to do.
 */
export function prepareLandForSale(land: Landscape, px: number, pz: number): boolean {
  let cache = forSale.get(land);
  if (!cache) forSale.set(land, (cache = new Map()));
  const key = plotKey(px, pz);
  const have = cache.get(key);
  if (!have) {
    cache.set(key, { part: generatePlot(land.seed, px, pz, land.coast ?? null), extras: false });
    return true;
  }
  if (!have.extras) {
    addPlotExtras(have.part, px, pz);
    have.extras = true;
  }
  return false;
}

/** Has this plot's land been made already, extras and all (see `landForSale`)? */
export function hasLandForSale(land: Landscape, px: number, pz: number): boolean {
  return forSale.get(land)?.get(plotKey(px, pz))?.extras ?? false;
}

/**
 * Buy a plot: its land joins the world, with station and depot pieces on its towns and depots. Returns the new plot's
 * slot and its towns' and depots' ids, or null if the plot can't be bought (already owned, or not beside the world's
 * land).
 */
export function unlockPlot(world: World, px: number, pz: number): { slots: number[]; towns: number[]; depots: number[]; sites: number[] } | null {
  const land = world.landscape;
  if (land.grid.hasPlot(px, pz) || !plotsForSale(land).some((p) => p.px === px && p.pz === pz)) return null;
  const part = landForSale(land, px, pz);
  forSale.get(land)!.delete(plotKey(px, pz));
  const townBase = land.towns.length;
  const depotBase = land.depots.length;
  land.sites ??= [];
  const siteBase = land.sites.length;
  const slots = adoptRegion(land, part);
  const towns = land.towns.slice(townBase);
  const depots = land.depots.slice(depotBase);
  const sites = land.sites.slice(siteBase);
  addSites(world, towns, depots, sites);
  addTownProps(land, world.props);
  return { slots, towns: towns.map((t) => t.id), depots: depots.map((d) => d.id), sites: sites.map((s) => s.id) };
}

/**
 * Clear an old industry's ruin away (its card's "Clear the ruin"): its stub taken up, its yard open ground again. Its
 * fields stay (they're any farm's). Returns the plot slots changed, or why it can't be cleared now.
 */
export function clearRuin(world: World, siteId: number): { slots: number[] } | { why: string } {
  const site = world.landscape.sites?.[siteId];
  if (!site || site.cleared) return { why: "It's gone already" };
  const stub = world.ruins.get(siteId);
  if (stub !== undefined && world.sim.pieceOccupied(stub)) return { why: "A train is on its track" };
  if (stub !== undefined) world.layout.removePiece(stub);
  world.ruins.delete(siteId);
  site.cleared = true;
  const g = world.landscape.grid;
  const slots = new Set<number>();
  g.forEachCell((i) => {
    if (g.feature[i] !== FEAT_RUIN || g.owner[i] !== siteId) return;
    g.feature[i] = FEAT_NONE;
    g.owner[i] = -1;
    slots.add(plotSlotOf(i));
  });
  for (const s of slots) g.touch(s);
  return { slots: [...slots] };
}

/**
 * The squares the player has something on, or near (a square round it): track, an industry's or a kit's yard (either
 * side of its piece), a placed model (not the map's own: its stations, depots and towns' houses). An older save's new
 * sites and towns keep off them (`addSitesToOldSave`).
 */
function playerSquares(world: World): Set<number> {
  const g = world.landscape.grid;
  const out = new Set<number>();
  const mark = (x: number, z: number, pad: number) => {
    const col = g.colAt(x);
    const row = g.rowAt(z);
    for (let dr = -pad; dr <= pad; dr++) for (let dc = -pad; dc <= pad; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i !== -1) out.add(i);
    }
  };
  const buckets = new Map<number, number[]>();
  // (The map's own pieces, stations and depots, were there when the extras were made: they kept clear of them.)
  const own = fixedPieces(world);
  for (const id of world.layout.pieceIds()) {
    if (own.has(id)) continue;
    const p = world.layout.getPiece(id)!;
    addTrackPoints(buckets, p.type, p.flipped, p.pose);
    // A yard (an industry's, a kit's) reaches about 150 mm out from its track, on one side or the other.
    if (INDUSTRY_ROLE[p.type] || kitOf(p.type)) {
      const c = Math.cos(p.pose.heading);
      const s = Math.sin(p.pose.heading);
      for (let t = -36; t <= 252; t += 36) for (let l = -150; l <= 150; l += 36) mark(p.pose.x + c * t - s * l, p.pose.z + s * t + c * l, 0);
    }
  }
  for (const list of buckets.values()) for (let k = 0; k < list.length; k += 2) mark(list[k], list[k + 1], 1);
  // (A town's houses are the map's: one moved changed its squares, which the extras check anyway.)
  for (const p of world.props.all()) if (p.building === undefined) mark(p.x, p.z, 1);
  return out;
}

/**
 * An older save's land gains the map's sites and extra towns (saved before there were any: `Landscape.sites` missing),
 * on the plots it owns, as a new map would have them there: each plot's land made again from the seed as it was
 * generated (`generatePlot`, or the start's `generateLandscape`) and its extras added (`addPlotExtras`,
 * `addStartSites`), then each extra copied in only where it fits as it stands. An extra is skipped if any of its
 * squares (those it stands on, keeps clear or changes) isn't exactly as generated (height, surface, feature, road:
 * so not where the land was edited, a town grew or a house moved, a field was planted, a lane laid) or has anything of
 * the player's on it or beside it (`playerSquares`: track, an industry's or a kit's yard, a placed model). Kept from
 * then on (saved with the land). Returns what was added and skipped.
 */
export function addSitesToOldSave(world: World): { towns: number; sites: number; skipped: number } {
  const land = world.landscape;
  land.sites ??= [];
  const used = playerSquares(world);
  const result = { towns: 0, sites: 0, skipped: 0 };
  const g = land.grid;
  const starts = g.plots.filter((p) => p.px >= START_REGION.px0 && p.px < START_REGION.px0 + START_REGION.w && p.pz >= START_REGION.pz0 && p.pz < START_REGION.pz0 + START_REGION.h);
  if (starts.length > 0) {
    const part = generateLandscape(land.seed, { starter: land.starter, coast: !!land.coast });
    patch(part, addStartSites(part));
  }
  for (const p of g.plots) {
    if (starts.includes(p)) continue;
    const part = generatePlot(land.seed, p.px, p.pz, land.coast ?? null);
    patch(part, addPlotExtras(part, p.px, p.pz));
  }
  addTownProps(land, world.props);
  return result;

  function patch(part: Landscape, extras: readonly Extra[]): void {
    const pg = part.grid;
    const to = (i: number) => g.index(pg.colOf(i), pg.rowOf(i));
    for (const extra of extras) {
      const fits = [...extra.before].every(([i, was]) => {
        const j = to(i);
        return j !== -1 && !used.has(j) && g.height[j] === was[0] && g.surface[j] === was[1] && g.feature[j] === was[2] && g.road[j] === was[3];
      });
      if (!fits) {
        result.skipped++;
        continue;
      }
      // Ids: the part's town, buildings, fields and site get the world's next ones.
      const townIds = new Map<number, number>();
      const buildingIds = new Map<number, number>();
      const fieldIds = new Map<number, number>();
      const siteIds = new Map<number, number>();
      if (extra.kind === "town") {
        const t = part.towns[extra.id];
        const id = land.towns.length;
        townIds.set(t.id, id);
        for (const b of t.buildings) buildingIds.set(b.id, land.nextBuildingId++);
        const town: Town = {
          ...t,
          id,
          name: freeName(new Set(land.towns.map((x) => x.name)), t.name, id),
          centre: { ...t.centre },
          station: { ...t.station },
          cells: t.cells.map(to),
          buildings: t.buildings.map((b) => ({ ...b, id: buildingIds.get(b.id)!, cells: b.cells.map(to) })),
        };
        land.towns.push(town);
        addSites(world, [town], []);
        result.towns++;
      } else {
        const site = part.sites![extra.id];
        for (const f of site.fields) {
          const field = part.fields[f];
          fieldIds.set(f, land.fields.length);
          land.fields.push({ ...field, id: land.fields.length, cells: field.cells.map(to) });
        }
        const copy: MapSite = { ...site, id: land.sites!.length, centre: { ...site.centre }, piece: { ...site.piece }, plot: { ...site.plot }, fields: site.fields.map((f) => fieldIds.get(f)!) };
        siteIds.set(site.id, copy.id);
        land.sites!.push(copy);
        addSites(world, [], [], [copy]);
        result.sites++;
      }
      const corridors = new Set(part.corridors);
      const have = new Set(land.corridors);
      const slots = new Set<number>();
      for (const i of extra.changed) {
        const j = to(i);
        g.height[j] = pg.height[i];
        g.surface[j] = pg.surface[i];
        g.feature[j] = pg.feature[i];
        g.road[j] = pg.road[i];
        const f = pg.feature[i];
        const o = pg.owner[i];
        const ids = f === FEAT_STATION ? townIds : f === FEAT_BUILDING ? buildingIds : f === FEAT_FIELD ? fieldIds : f === FEAT_RUIN ? siteIds : null;
        g.owner[j] = ids ? (ids.get(o) ?? -1) : -1;
        slots.add(plotSlotOf(j));
      }
      for (const i of extra.before.keys()) if (corridors.has(i) && !have.has(to(i))) land.corridors.push(to(i));
      for (const s of slots) g.touch(s);
    }
  }
}
