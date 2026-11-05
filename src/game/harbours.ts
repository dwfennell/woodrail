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
/**
 * Fish a boat lands at a harbour each visit once Fishing boats is learned (tech tree 3): free, for trains to take to
 * towns (they buy it at full pay). Only while the quay has room for them.
 */
export const FISH_CATCH = 3;
/**
 * Sacks of cocoa a boat lands each visit once Chocolate factory is learned (the goods chains, 2026-11-04): cocoa comes
 * from abroad, for a chocolate factory (towns don't buy it as it is). Landed as fish are, while the quay has room.
 */
export const COCOA_LANDED = 3;
/** ", and lands 3 fish and 3 sacks of cocoa", for what a boat brings each visit (nothing: ""). */
function landsText(fishing: boolean, cocoa: boolean): string {
  const what = [...(fishing ? [`${FISH_CATCH} fish`] : []), ...(cocoa ? [`${COCOA_LANDED} sacks of cocoa`] : [])];
  return what.length > 0 ? `, and lands ${what.join(" and ")}` : "";
}

/** Seconds between one boat leaving and the next arriving. */
export const BOAT_EVERY = 150;
/** Loads a cargo ship takes a visit (once Cargo ships is learned: it calls instead of the rowing boat). */
export const SHIP_LOADS = 24;
/**
 * A lighthouse this near a harbour (mm, from the harbour's quay to the lighthouse) brings its boats twice as often
 * (Lighthouse, water spec §5): about five squares.
 */
export const LIGHTHOUSE_REACH = 380;
/** The lighthouse's model (a prop the player places, Game mode's Lighthouse). */
export const LIGHTHOUSE_ASSET = "bldg-lighthouse";
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

/** What a boat pays for goods: half a town's price (a cargo ship, `ship`: a town's full price). */
export function boatPays(goods: Bag, ship = false): number {
  let n = 0;
  for (const k of CARGO_KINDS) n += (goods[k] ?? 0) * (PRICES[k] ?? 0);
  return ship ? n : Math.round(n / 2);
}

/** Is there a lighthouse near this harbour's quay (its boats come twice as often)? A look through the props. */
export function lighthouseNear(world: World, pose: Pose): boolean {
  const q = depotPoint(pose, QUAY.t, QUAY.l);
  for (const p of world.props.all()) if (p.asset === LIGHTHOUSE_ASSET && Math.hypot(p.x - q.x, p.z - q.z) <= LIGHTHOUSE_REACH) return true;
  return false;
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
  /** A boat sailing in or out (`ship`: a cargo ship, once Cargo ships is learned). */
  | { kind: "arrive" | "leave"; depotId: number; way: readonly { x: number; z: number }[]; ship?: boolean }
  | { kind: "sold"; depotId: number; goods: Bag; coins: number; ship?: boolean }
  /**
   * A boat unloaded goods you ordered, paid for as they came off. `short`: some went back, for want of coins or of
   * room on the quay (null: all came).
   */
  | { kind: "bought"; depotId: number; goods: Bag; coins: number; short: "coins" | "room" | null }
  /** A boat landed its catch of fish on the quay (Fishing boats): `n` crates. */
  | { kind: "caught"; depotId: number; n: number; good?: "cocoa" }
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
      // (Cargo ships, once learned: 24 loads at a town's full price. A lighthouse near: the wait between boats halved.)
      // (Once one's been built at a shipyard: src/game/yards.ts.)
      const ship = p.learned.has("cargo-ships") && world.economy.shipsBuilt > 0;
      const every = this.everyFor(world, piece.pose, p);
      boat.left -= seconds;
      if (boat.left > 0) continue;
      switch (boat.phase) {
        case "away": {
          const way = this.wayFor(world.landscape, d.pieceId, piece.pose);
          if (!way) {
            boat.left = every;
            break;
          }
          boat.way = way;
          boat.phase = "in";
          boat.left = BOAT_SAIL;
          events.push({ kind: "arrive", depotId: d.id, way, ...(ship ? { ship } : {}) });
          break;
        }
        case "in": {
          boat.phase = "docked";
          boat.left = BOAT_DOCKED;
          const goods = loadBoat(d, ship ? SHIP_LOADS : BOAT_LOADS, world.economy.landed.get(d.id));
          const coins = boatPays(goods, ship);
          let n = 0;
          for (const v of Object.values(goods)) n += v ?? 0;
          if (n > 0) {
            p.coins += coins;
            p.counts.set("exported", (p.counts.get("exported") ?? 0) + n);
            if (ship) world.economy.shipLoads += n;
            events.push({ kind: "sold", depotId: d.id, goods, coins, ...(ship ? { ship } : {}) });
          }
          // Then what you ordered comes off onto the quay (after loading, so the boat doesn't take it back).
          const bought = this.unload(world, d, p);
          if (bought) events.push(bought);
          // And, once Fishing boats is learned, its catch: landed, so the next boat won't take it back.
          const caught = p.learned.has("fishing") ? Math.min(FISH_CATCH, capAt(d) - d.piles[CARGO.fish.index]) : 0;
          if (caught > 0) {
            world.economy.land(d, "fish", caught);
            events.push({ kind: "caught", depotId: d.id, n: caught });
          }
          // And, once Chocolate factory is learned, sacks of cocoa from abroad, landed the same way.
          const cocoa = p.learned.has("chocolate") ? Math.min(COCOA_LANDED, capAt(d) - d.piles[CARGO.cocoa.index]) : 0;
          if (cocoa > 0) {
            world.economy.land(d, "cocoa", cocoa);
            events.push({ kind: "caught", depotId: d.id, n: cocoa, good: "cocoa" });
          }
          break;
        }
        case "docked":
          boat.phase = "out";
          boat.left = BOAT_SAIL;
          events.push({ kind: "leave", depotId: d.id, way: boat.way ?? [], ...(ship ? { ship } : {}) });
          break;
        case "out":
          boat.phase = "away";
          boat.left = every;
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
    let n = 0;
    for (const v of Object.values(goods)) n += v ?? 0;
    if (n > 0) p.counts.set("imported", (p.counts.get("imported") ?? 0) + n);
    return { kind: "bought", depotId: d.id, goods, coins, short };
  }

  /** Where this harbour's boat is (away, coming in, tied up, leaving) and the seconds left at that; null if none yet. */
  boatAt(depotId: number): { phase: Boat["phase"]; left: number } | null {
    const b = this.boats.get(depotId);
    return b ? { phase: b.phase, left: Math.max(0, Math.ceil(b.left)) } : null;
  }

  /** What a harbour's card says about its boats. */
  /** Seconds between boats at a harbour: `BOAT_EVERY`, halved with a lighthouse near (once Lighthouse is learned). */
  everyFor(world: World, pose: Pose, p: Progress): number {
    return p.learned.has("lighthouse") && lighthouseNear(world, pose) ? BOAT_EVERY / 2 : BOAT_EVERY;
  }

  describe(depotId: number, fishing = false, cocoa = false, ship = false, lighthouse = false): string {
    const b = this.boatAt(depotId);
    const boatWord = ship ? "cargo ship" : "boat";
    const each = `${ship ? `A cargo ship takes ${SHIP_LOADS} loads a visit, paying a town's full price` : `A boat takes ${BOAT_LOADS} loads a visit, paying half a town's price`}${landsText(fishing, cocoa)}.${lighthouse ? " The lighthouse brings them twice as often." : ""}`;
    if (!b || b.phase === "away") {
      const s = b?.left ?? FIRST_BOAT;
      return `Next ${boatWord} in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}. ${each}`;
    }
    if (b.phase === "in") return `A ${boatWord} is coming in. ${each}`;
    // It's taken its loads: what's put on the quay now waits for the next.
    const next = Math.round((b.left + (b.phase === "docked" ? BOAT_SAIL : 0) + (lighthouse ? BOAT_EVERY / 2 : BOAT_EVERY)) / 60);
    const wait = `Goods put on the quay now wait for the next boat, in about ${next} min.`;
    if (b.phase === "docked") return `A ${boatWord} is tied up at the quay. ${wait}`;
    return `The ${boatWord} is sailing away. ${wait}`;
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
