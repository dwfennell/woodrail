import { CARGO, CARGO_KINDS, capAt, RECIPES, type CargoKind, type DepotState } from "../economy";
import { CELL, isWater, shoreDistance, SURF_SEA, type Landscape } from "../landscape";
import type { Pose } from "../track";
import type { Bag } from "../economy/goods";
import type { Progress } from "./progress";
import { PRICES } from "./towns";
import type { World } from "./world";

/**
 * Harbours (Game mode, Phase D): a depot by the water whose quay boats call at by themselves. A boat comes in from the
 * edge of the land (up a river, or in from the sea) every few minutes, takes what's on the quay (so many loads a
 * visit) and pays for it, at half what a town pays, then sails away again. Nothing is steered: a boat follows the
 * water's own squares.
 */

/** Loads a boat takes a visit. */
export const BOAT_LOADS = 6;
/** Seconds between one boat leaving and the next arriving. */
export const BOAT_EVERY = 150;
/** Seconds a boat takes to sail in (or out). */
export const BOAT_SAIL = 12;
/** Seconds a boat stays at the quay. */
export const BOAT_DOCKED = 30;
/** What a dock shed costs to build (Game mode, once Dock sheds is learned). */
export const SHED_PRICE = 30;
/** The first boat to a new harbour comes this soon. */
const FIRST_BOAT = 40;

/** Where a boat ties up: just past the yard's far side (depot coordinates t, l), on the water. */
export const QUAY = { t: 108, l: 138 };

/** A point in depot coordinates (t along the track, l across it) for a piece at `pose`. */
export function depotPoint(pose: Pose, t: number, l: number): { x: number; z: number } {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + c * t - s * l, z: pose.z + s * t + c * l };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * The way a boat comes to a harbour at `pose`: world points from where it appears (past the edge of the land, or out
 * at sea) to the quay, or null if the water by the quay doesn't lead off the land or out to sea. Squares of water
 * only, the shortest way. `seaOnly`: only out to sea, not off the edge of the land (a way buying more land can't cut).
 */
export function waterWay(land: Landscape, pose: Pose, seaOnly = false): { x: number; z: number }[] | null {
  const g = land.grid;
  const q = depotPoint(pose, QUAY.t, QUAY.l);
  // Start from the water squares beside the quay.
  const starts: number[] = [];
  const col = g.colAt(q.x);
  const row = g.rowAt(q.z);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i !== -1 && isWater(g.surface[i])) starts.push(i);
    }
  }
  if (starts.length === 0) return null;
  const from = new Int32Array(g.cellCount).fill(-2);
  const queue: number[] = [];
  for (const i of starts) {
    from[i] = -1;
    queue.push(i);
  }
  /** Open sea (well out from the shore), or water at the edge of the land: a boat's way in. */
  const out = (i: number): { dc: number; dr: number } | null => {
    const c = g.colOf(i);
    const r = g.rowOf(i);
    if (g.surface[i] === SURF_SEA && shoreDistance(land.coast ?? null, c, r) <= -3) return { dc: 0, dr: 0 };
    if (!seaOnly) for (const [dc, dr] of DIRS) if (g.index(c + dc, r + dr) === -1) return { dc, dr };
    return null;
  };
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const exit = out(i);
    if (exit) {
      const cells: number[] = [];
      for (let j = i; j !== -1; j = from[j]) cells.push(j);
      const pts = cells.map((j) => ({ x: g.centreX(g.colOf(j)), z: g.centreZ(g.rowOf(j)) }));
      // In from beyond: past the edge of the land, or further out to sea.
      const away = exit.dc !== 0 || exit.dr !== 0 ? exit : seaward(land);
      pts.unshift({ x: pts[0].x + away.dc * CELL * 6, z: pts[0].z + away.dr * CELL * 6 });
      pts.push(q);
      return smooth(pts);
    }
    const c = g.colOf(i);
    const r = g.rowOf(i);
    for (const [dc, dr] of DIRS) {
      const j = g.index(c + dc, r + dr);
      if (j === -1 || from[j] !== -2 || !isWater(g.surface[j])) continue;
      from[j] = i;
      queue.push(j);
    }
  }
  return null;
}

/** Which way the open sea is (a step in squares). */
function seaward(land: Landscape): { dc: number; dr: number } {
  switch (land.coast?.side) {
    case "n":
      return { dc: 0, dr: -1 };
    case "e":
      return { dc: 1, dr: 0 };
    case "w":
      return { dc: -1, dr: 0 };
    default:
      return { dc: 0, dr: 1 };
  }
}

/** Rounded corners (one pass of corner cutting), keeping the ends. */
function smooth(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Why a harbour can't stand here, beyond its site rule (the boats' way in), or null. */
export function harbourWhy(land: Landscape, pose: Pose): string | null {
  return waterWay(land, pose) ? null : "Boats can't reach this water: it must lead off your land or out to sea";
}

/** Units bought at a time, and the most a harbour can have on order for its next boat. */
export const BUY_LOT = 3;
export const BUY_MAX = BOAT_LOADS;

/** What a boat charges for a unit: twice a town's price. */
export function buyPrice(kind: CargoKind): number {
  return 2 * (PRICES[kind] ?? 0);
}

/**
 * Goods a boat will sell you: only what you already make (what your industries on the map give), so buying fills a
 * gap rather than replacing a supply chain. In cargo order.
 */
export function goodsForSale(world: World): CargoKind[] {
  const made = new Set<CargoKind>();
  for (const d of world.economy.allDepots()) {
    if (d.role === "warehouse" || d.role === "harbour" || d.role === "town" || !world.layout.getPiece(d.pieceId)) continue;
    for (const k of RECIPES[d.role].gives) made.add(k);
  }
  return CARGO_KINDS.filter((k) => made.has(k) && buyPrice(k) > 0);
}

/** What a boat pays for goods: half a town's price. */
export function boatPays(goods: Bag): number {
  let n = 0;
  for (const k of CARGO_KINDS) n += (goods[k] ?? 0) * (PRICES[k] ?? 0);
  return Math.round(n / 2);
}

/**
 * Take up to `loads` from a harbour's quay, the biggest piles first (the dearest of equals); what was taken. Goods
 * `landed` there (bought, for trains to take away) aren't taken.
 */
export function loadBoat(d: DepotState, loads = BOAT_LOADS, landed?: Int32Array): Bag {
  const taken: Bag = {};
  let left = loads;
  const spare = (k: CargoKind) => d.piles[CARGO[k].index] - (landed?.[CARGO[k].index] ?? 0);
  while (left > 0) {
    let best: CargoKind | null = null;
    for (const k of CARGO_KINDS) {
      const n = spare(k);
      if (n <= 0) continue;
      if (!best || n > spare(best) || (n === spare(best) && (PRICES[k] ?? 0) > (PRICES[best] ?? 0))) best = k;
    }
    if (!best) break;
    d.piles[CARGO[best].index]--;
    taken[best] = (taken[best] ?? 0) + 1;
    left--;
  }
  return taken;
}

export type HarbourEvent =
  | { kind: "arrive" | "leave"; depotId: number; way: readonly { x: number; z: number }[] }
  | { kind: "sold"; depotId: number; goods: Bag; coins: number }
  /**
   * A boat unloaded goods you ordered, paid for as they came off. `short`: some went back, for want of coins or of
   * room on the quay (null: all came).
   */
  | { kind: "bought"; depotId: number; goods: Bag; coins: number; short: "coins" | "room" | null }
  /** The harbour went (taken up, or moved) while its boat was in: the boat's gone at once. */
  | { kind: "gone"; depotId: number };

interface Boat {
  phase: "away" | "in" | "docked" | "out";
  /** Seconds left in this phase. */
  left: number;
  /** The way it came in (it leaves the same way, backwards). */
  way: { x: number; z: number }[] | null;
  /** Where its harbour stood (the piece and its pose) when the boat set out: a moved harbour sends it away. */
  at: string;
}

/**
 * The boats of every harbour on the map. Call `update` once a second of play; it moves each harbour's boat on and says
 * what happened (for the view and the player). Boats aren't saved: after a load, each harbour's next boat comes soon.
 */
export class HarbourTrade {
  private readonly boats = new Map<number, Boat>();
  /** Goods on order at each harbour, for its next boat (not saved: nothing is paid till they come). */
  private readonly orders = new Map<number, Bag>();
  /** The way in for each harbour's piece, and the land's revision and pose it was found for. */
  private readonly ways = new Map<number, { key: string; way: { x: number; z: number }[] | null }>();

  update(world: World, p: Progress, seconds = 1): HarbourEvent[] {
    const events: HarbourEvent[] = [];
    const seen = new Set<number>();
    for (const d of world.economy.allDepots()) {
      if (d.role !== "harbour") continue;
      const piece = world.layout.getPiece(d.pieceId);
      if (!piece) continue;
      seen.add(d.id);
      const at = `${d.pieceId},${piece.pose.x},${piece.pose.z},${piece.pose.heading}`;
      let boat = this.boats.get(d.id);
      if (boat && boat.at !== at) {
        if (boat.phase !== "away") events.push({ kind: "gone", depotId: d.id });
        boat = undefined;
      }
      if (!boat) this.boats.set(d.id, (boat = { phase: "away", left: FIRST_BOAT, way: null, at }));
      boat.left -= seconds;
      if (boat.left > 0) continue;
      switch (boat.phase) {
        case "away": {
          const way = this.wayFor(world.landscape, d.pieceId, piece.pose);
          if (!way) {
            boat.left = BOAT_EVERY;
            break;
          }
          boat.way = way;
          boat.phase = "in";
          boat.left = BOAT_SAIL;
          events.push({ kind: "arrive", depotId: d.id, way });
          break;
        }
        case "in": {
          boat.phase = "docked";
          boat.left = BOAT_DOCKED;
          const goods = loadBoat(d, BOAT_LOADS, world.economy.landed.get(d.id));
          const coins = boatPays(goods);
          let n = 0;
          for (const v of Object.values(goods)) n += v ?? 0;
          if (n > 0) {
            p.coins += coins;
            p.counts.set("exported", (p.counts.get("exported") ?? 0) + n);
            events.push({ kind: "sold", depotId: d.id, goods, coins });
          }
          // Then what you ordered comes off onto the quay (after loading, so the boat doesn't take it back).
          const bought = this.unload(world, d, p);
          if (bought) events.push(bought);
          break;
        }
        case "docked":
          boat.phase = "out";
          boat.left = BOAT_SAIL;
          events.push({ kind: "leave", depotId: d.id, way: boat.way ?? [] });
          break;
        case "out":
          boat.phase = "away";
          boat.left = BOAT_EVERY;
          boat.way = null;
          break;
      }
    }
    for (const id of [...this.orders.keys()]) if (!seen.has(id)) this.orders.delete(id);
    for (const [id, boat] of [...this.boats]) {
      if (seen.has(id)) continue;
      if (boat.phase !== "away") events.push({ kind: "gone", depotId: id });
      this.boats.delete(id);
    }
    return events;
  }

  /** Order `BUY_LOT` more of `kind` for this harbour's next boat; false if its order is full. */
  order(depotId: number, kind: CargoKind): boolean {
    const o = this.orders.get(depotId) ?? {};
    let n = 0;
    for (const v of Object.values(o)) n += v ?? 0;
    if (n + BUY_LOT > BUY_MAX) return false;
    o[kind] = (o[kind] ?? 0) + BUY_LOT;
    this.orders.set(depotId, o);
    return true;
  }

  /** Is this harbour's order full (a boat brings no more)? */
  full(depotId: number): boolean {
    let n = 0;
    for (const v of Object.values(this.ordered(depotId))) n += v ?? 0;
    return n + BUY_LOT > BUY_MAX;
  }

  /** What's on order at this harbour (empty: nothing). */
  ordered(depotId: number): Bag {
    return this.orders.get(depotId) ?? {};
  }

  /** Cancel this harbour's order. */
  cancel(depotId: number): void {
    this.orders.delete(depotId);
  }

  /**
   * A boat in: what was ordered goes onto the quay, paid for unit by unit while the coins last and there's room, for
   * trains to take away (it's landed: the next boat won't take it back).
   */
  private unload(world: World, d: DepotState, p: Progress): HarbourEvent | null {
    const o = this.orders.get(d.id);
    if (!o) return null;
    this.orders.delete(d.id);
    const goods: Bag = {};
    let coins = 0;
    let short: "coins" | "room" | null = null;
    for (const k of CARGO_KINDS) {
      for (let n = o[k] ?? 0; n > 0; n--) {
        const price = buyPrice(k);
        if (d.piles[CARGO[k].index] >= capAt(d)) {
          short ??= "room";
          break;
        }
        if (p.coins < price) {
          short ??= "coins";
          break;
        }
        p.coins -= price;
        coins += price;
        world.economy.land(d, k, 1);
        goods[k] = (goods[k] ?? 0) + 1;
      }
    }
    return { kind: "bought", depotId: d.id, goods, coins, short };
  }

  /** Where this harbour's boat is (away, coming in, tied up, leaving) and the seconds left at that; null if none yet. */
  boatAt(depotId: number): { phase: Boat["phase"]; left: number } | null {
    const b = this.boats.get(depotId);
    return b ? { phase: b.phase, left: Math.max(0, Math.ceil(b.left)) } : null;
  }

  /** What a harbour's card says about its boats. */
  describe(depotId: number): string {
    const b = this.boatAt(depotId);
    const each = `A boat takes ${BOAT_LOADS} loads a visit, paying half a town's price.`;
    if (!b || b.phase === "away") {
      const s = b?.left ?? FIRST_BOAT;
      return `Next boat in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. ${each}`;
    }
    if (b.phase === "in") return `A boat is coming in. ${each}`;
    // It's taken its loads: what's put on the quay now waits for the next.
    const next = Math.round((b.left + (b.phase === "docked" ? BOAT_SAIL : 0) + BOAT_EVERY) / 60);
    const wait = `Goods put on the quay now wait for the next boat, in about ${next} min.`;
    if (b.phase === "docked") return `A boat is tied up at the quay. ${wait}`;
    return `The boat is sailing away. ${wait}`;
  }

  /** Start again (a new world was loaded): every harbour's next boat comes soon. */
  reset(): void {
    this.boats.clear();
    this.orders.clear();
    this.ways.clear();
  }

  private wayFor(land: Landscape, pieceId: number, pose: Pose): { x: number; z: number }[] | null {
    const key = `${land.grid.revision},${pose.x},${pose.z},${pose.heading}`;
    const had = this.ways.get(pieceId);
    if (had && had.key === key) return had.way;
    const way = waterWay(land, pose);
    this.ways.set(pieceId, { key, way });
    return way;
  }
}
