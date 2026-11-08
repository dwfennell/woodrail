import { CARGO, type CargoKind, type DepotState, type YardBuild, type YardOrder } from "../economy";
import { isWater, SURF_SEA, type Landscape } from "../landscape";
import type { Pose } from "../track";
import { BARGE_LOADS, MAX_BARGES, MAX_BOATS, type Fleet, landingMoorL, landingWhy } from "./boats";
import { depotPoint } from "./harbours";
import type { World } from "./world";
import { addTo } from "../economy/goods";

/**
 * Yards (the user, 2026-11-05: "boats should come from yards, built from goods delivered by train, not bought
 * outright"). A boatyard on a river bank builds tugs and barges; a shipyard by the sea builds cargo ships and train
 * ferries. The player picks what a yard builds on its card; trains bring the goods (the yard's depot takes them, as a
 * workshop takes planks), and once a second they go into the hull, which stands half built on the yard's ways (a keel
 * and ribs, then planked) and slides down into the water when it's done. Orders are the economy's (saved with the map).
 */

/** What each build costs, in goods brought by train. */
export const YARD_COSTS: Record<YardBuild, Partial<Record<CargoKind, number>>> = {
  // (A tug comes with its first barge: 12 planks and 4 iron for the tug, 8 planks for the barge.)
  tug: { planks: 20, iron: 4 },
  barge: { planks: 8 },
  ship: { iron: 30, planks: 20, tools: 6 },
  ferry: { iron: 20, planks: 16, tools: 4 },
};

/** What each yard builds. */
export const YARD_BUILDS: Record<"boatyard" | "shipyard", readonly YardBuild[]> = { boatyard: ["tug", "barge"], shipyard: ["ship", "ferry"] };

/** Names on the cards. */
export const BUILD_LABEL: Record<YardBuild, string> = { tug: "Tug and a barge", barge: "Barge", ship: "Cargo ship", ferry: "Train ferry" };

/** Seconds a finished hull takes to slide down the ways into the water (drawn: `YardsView`). */
export const LAUNCH_SECONDS = 3;

export const isYard = (d: DepotState | undefined): d is DepotState => d?.role === "boatyard" || d?.role === "shipyard";

/** How much of an order is done (0 to 1), by goods. */
export function progressOf(order: YardOrder): number {
  let need = 0;
  let got = 0;
  for (const [k, n] of Object.entries(YARD_COSTS[order.build])) {
    need += n ?? 0;
    got += Math.min(n ?? 0, order.got[k as CargoKind] ?? 0);
  }
  return need > 0 ? got / need : 1;
}

/** What an order still needs, by good. */
export function stillNeeds(order: YardOrder): Partial<Record<CargoKind, number>> {
  const out: Partial<Record<CargoKind, number>> = {};
  for (const [k, n] of Object.entries(YARD_COSTS[order.build])) {
    const left = (n ?? 0) - (order.got[k as CargoKind] ?? 0);
    if (left > 0) out[k as CargoKind] = left;
  }
  return out;
}

export type YardEvent = { kind: "launched"; depotId: number; build: YardBuild; boatId?: number };

/** Why a yard can't take this order now (or null). */
export function whyNotOrder(world: Pick<World, "economy">, yard: DepotState, build: YardBuild): string | null {
  if (!isYard(yard) || !YARD_BUILDS[yard.role as "boatyard" | "shipyard"].includes(build)) return "This yard doesn't build that";
  if (world.economy.yardOrders.has(yard.id)) return "The yard is building already";
  if (build === "tug" && world.economy.boats.size >= MAX_BOATS) return `${MAX_BOATS} boats is the most`;
  if (build === "barge" && !bargeTaker(world, yard.id)) return "A barge needs a tug: build a tug and a barge first";
  return null;
}

/** The tug a new barge goes to: the one with the fewest barges that calls at this yard (or any, failing that). */
function bargeTaker(world: Pick<World, "economy">, yardId: number) {
  const boats = [...world.economy.boats.values()].filter((b) => b.barges < MAX_BARGES);
  const here = boats.filter((b) => b.home === yardId || b.stops.some((s) => s.depotId === yardId));
  const pool = here.length > 0 ? here : boats;
  return pool.sort((a, b) => a.barges - b.barges)[0] ?? null;
}

/** Start building at a yard (what it builds, from the card); false if it can't. */
export function order(world: Pick<World, "economy">, yard: DepotState, build: YardBuild): boolean {
  if (whyNotOrder(world, yard, build)) return false;
  world.economy.yardOrders.set(yard.id, { build, got: {} });
  return true;
}

/** Stop building (what went in stays in the hull's goods, lost: the card says so before). */
export function cancel(world: Pick<World, "economy">, yardId: number): void {
  world.economy.yardOrders.delete(yardId);
}

/**
 * Once a second of play: goods the yards' piles hold go into their orders; an order with all it needs is launched: a
 * tug and barge comes to life at its boatyard, a barge joins a tug, a ship or ferry is counted (cargo ships then call
 * at harbours, ferries sail from slips).
 */
export function tickYards(world: World, fleet: Fleet): YardEvent[] {
  const events: YardEvent[] = [];
  const { economy } = world;
  for (const [id, o] of [...economy.yardOrders]) {
    const d = economy.liveDepot(id);
    if (!isYard(d) || !YARD_BUILDS[d.role as "boatyard" | "shipyard"].includes(o.build)) {
      economy.yardOrders.delete(id);
      continue;
    }
    const need = YARD_COSTS[o.build];
    for (const [k, n] of Object.entries(need)) {
      const kind = k as CargoKind;
      const take = Math.min((n ?? 0) - (o.got[kind] ?? 0), d.piles[CARGO[kind].index]);
      if (take <= 0) continue;
      d.piles[CARGO[kind].index] -= take;
      addTo(o.got, kind, take);
    }
    if (progressOf(o) < 1) continue;
    economy.yardOrders.delete(id);
    economy.acceptsChanged();
    if (o.build === "tug") {
      const b = fleet.launch(id);
      events.push({ kind: "launched", depotId: id, build: o.build, ...(b ? { boatId: b.id } : {}) });
    } else if (o.build === "barge") {
      const b = bargeTaker(world, id);
      if (b) b.barges++;
      events.push({ kind: "launched", depotId: id, build: o.build, ...(b ? { boatId: b.id } : {}) });
    } else {
      if (o.build === "ship") economy.shipsBuilt++;
      else economy.ferriesBuilt++;
      events.push({ kind: "launched", depotId: id, build: o.build });
    }
  }
  return events;
}

/** Where a yard's hull lies being built (world), facing along its line, and which way it slides out (toward the water). */
export function berthOf(world: Pick<World, "economy" | "layout" | "landscape">, depotId: number): { x: number; z: number; heading: number; out: { x: number; z: number } } | null {
  const d = world.economy.depot(depotId);
  const piece = d && world.layout.getPiece(d.pieceId);
  if (!isYard(d) || !piece) return null;
  // (The model's berth, YARD_BERTH in water.ts, in the piece's frame: the model stands 40 across from the line.)
  const at = d.role === "boatyard" ? { t: 108 + 30, l: 40 + 52 } : { t: 108, l: 40 + 66 };
  const p = depotPoint(piece.pose, at.t, at.l);
  // Out to the water: across the line, as far as a boat ties up there.
  const moor = d.role === "boatyard" ? landingMoorL(world.landscape, piece.pose) + 20 : 40 + 66 + 70;
  const q = depotPoint(piece.pose, at.t, moor);
  return { ...p, heading: piece.pose.heading, out: q };
}

/** Why a shipyard can't stand here (its ways must reach the sea), or null. */
export function shipyardWhy(land: Landscape, pose: Pose): string | null {
  const g = land.grid;
  let sea = 0;
  for (const t of [40, 108, 176])
    for (const l of [100, 130, 160]) {
      const p = depotPoint(pose, t, l);
      const cell = g.cellAtWorld(p.x, p.z);
      if (cell !== -1 && g.surface[cell] === SURF_SEA) {
        sea++;
        break;
      }
    }
  return sea >= 2 ? null : "A shipyard goes on the shore, its ways down into the sea";
}

/** Why a boatyard can't stand here (its ways must reach the water, as a landing's jetty does), or null. */
export function boatyardWhy(land: Landscape, pose: Pose): string | null {
  return landingWhy(land, pose) ? "A boatyard goes on a bank, its ways down into the water" : null;
}

/** (For tests: is there water at a point.) */
export function wetAt(land: Landscape, x: number, z: number): boolean {
  const i = land.grid.cellAtWorld(x, z);
  return i !== -1 && isWater(land.grid.surface[i]);
}

/** A barge's loads, for the card. */
export const BARGE_WORDS = `${BARGE_LOADS} loads`;
