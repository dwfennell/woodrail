import { adoptRegion, generateLandscape, generatePlot, plotKey, seaPlot, type DepotKind, type Landscape, type PlotCoord } from "../landscape";
import { Economy, type DepotRole } from "../economy";
import { Sim } from "../sim";
import { kitOf, Layout, type PieceTypeId } from "../track";
import { PropStore } from "../props/store";
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
};

/**
 * Give every industry piece on the map an economy depot (one the player has just placed). A depot whose piece is
 * taken up stays, with its piles, until the piece comes back (undo); saving leaves it out. Returns true if any was
 * added.
 */
export function syncIndustries(world: World): boolean {
  let added = false;
  for (const id of world.layout.pieceIds()) {
    const type = world.layout.getPiece(id)!.type;
    // An industry's piece, or a kit piece that's a cargo stop (Sandbox's loaders and unloaders).
    const role = INDUSTRY_ROLE[type] ?? kitOf(type)?.depot;
    if (!role || world.economy.depotAtPiece(id)) continue;
    world.economy.addDepot(role, id);
    added = true;
  }
  return added;
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
}

/** Where a town station's goods crane stops wagons: near its socket end, by the plank pile. */
export const STATION_CRANE_AT = 30;

/**
 * Put the fixed pieces (stations and depots) of some towns and depots on the layout, with their economy depots: the
 * landscape's depots first, then one goods depot per town station.
 */
function addSites(world: Omit<World, "landscape">, towns: Landscape["towns"], depots: Landscape["depots"]): void {
  for (const town of towns) world.stations.set(town.id, world.layout.addPiece("station", town.station));
  for (const depot of depots) world.depots.set(depot.id, world.layout.addPiece(depotPieceType(depot.kind), depot.piece));
  for (const d of depots) world.economy.addDepot(d.kind, world.depots.get(d.id)!);
  for (const t of towns) world.economy.addDepot("town", world.stations.get(t.id)!, t.id, STATION_CRANE_AT);
}

export const STARTER_SEED = 7;

/** A fresh map: generated landscape with a station piece in every town and no player track. */
export function createWorld(seed: number, starter = false): World {
  const landscape = generateLandscape(seed, { starter });
  const layout = new Layout();
  const sim = new Sim(layout);
  const world: World = { layout, sim, landscape, stations: new Map(), depots: new Map(), economy: new Economy(layout, sim), props: new PropStore() };
  addSites(world, landscape.towns, landscape.depots);
  addTownProps(landscape, world.props);
  return world;
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

/** Land for sale, generated once per world and kept until it's bought. */
const forSale = new WeakMap<Landscape, Map<number, Landscape>>();

/** The land a plot would bring (generated on first ask, then kept). */
export function landForSale(land: Landscape, px: number, pz: number): Landscape {
  let cache = forSale.get(land);
  if (!cache) forSale.set(land, (cache = new Map()));
  const key = plotKey(px, pz);
  let part = cache.get(key);
  if (!part) cache.set(key, (part = generatePlot(land.seed, px, pz, land.coast ?? null)));
  return part;
}

/** Has this plot's land been generated already (see `landForSale`)? */
export function hasLandForSale(land: Landscape, px: number, pz: number): boolean {
  return forSale.get(land)?.has(plotKey(px, pz)) ?? false;
}

/**
 * Buy a plot: its land joins the world, with station and depot pieces on its towns and depots. Returns the new plot's
 * slot and its towns' and depots' ids, or null if the plot can't be bought (already owned, or not beside the world's
 * land).
 */
export function unlockPlot(world: World, px: number, pz: number): { slots: number[]; towns: number[]; depots: number[] } | null {
  const land = world.landscape;
  if (land.grid.hasPlot(px, pz) || !plotsForSale(land).some((p) => p.px === px && p.pz === pz)) return null;
  const part = landForSale(land, px, pz);
  forSale.get(land)!.delete(plotKey(px, pz));
  const townBase = land.towns.length;
  const depotBase = land.depots.length;
  const slots = adoptRegion(land, part);
  const towns = land.towns.slice(townBase);
  const depots = land.depots.slice(depotBase);
  addSites(world, towns, depots);
  addTownProps(land, world.props);
  return { slots, towns: towns.map((t) => t.id), depots: depots.map((d) => d.id) };
}
