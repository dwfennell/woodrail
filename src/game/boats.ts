import { capAt, CARGO, RECIPES, storeLetsIn, storeLetsOut, type BoatState, type BoatStop, type BoatStopAction, type CargoKind, type DepotState, type Economy } from "../economy";
import { isWater, type Landscape } from "../landscape";
import type { Pose } from "../track";
import { depotPoint, QUAY } from "./harbours";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * Boats the player routes (Game mode's River barges; docs/superpowers/specs/2026-11-04-water-transport.md §3): a tug
 * and its barges, bought at a river landing, sailing between docks (landings, harbours) on the same water by the
 * water's own squares, dropping and picking up bulk goods at each as its stops say. Kinematic: a boat is a distance
 * along a way worked out once per pair of docks, moved on by game time (`tick`, once a second of play, as the harbours'
 * boats are). They pass under every bridge (toys on felt).
 */

/** What barges carry: what comes in heaps (spec §5, choice D1). */
export const BULK: readonly CargoKind[] = ["log", "stone", "coal", "ore", "grain"];
/** Loads one barge holds (a wagon holds 3). */
export const BARGE_LOADS = 4;
/** Most barges a tug tows. */
export const MAX_BARGES = 3;
/** A tug and one barge, bought at a landing (coins). */
export const BOAT_PRICE = 80;
/** Another barge for a tug (coins). */
export const BARGE_PRICE = 40;
/** Most boats on a map (draw calls: spec §8). */
export const MAX_BOATS = 12;
/** How fast a tug goes (mm/s): about half a goods engine's top speed. */
export const BOAT_SPEED = 45;
/** Seconds a boat stays tied up at a dock (its goods craned off and on). */
export const DOCK_SECONDS = 8;

/** Where a boat ties up beside a landing's jetty (depot coordinates: along the line, out across it). */
export const LANDING_MOOR = { t: 120, l: 100 };

/** Names for boats, in turn. */
const NAMES = ["Puffin", "Kingfisher", "Otter", "Heron", "Moorhen", "Teal", "Coot", "Swift", "Mallard", "Grebe", "Tern", "Wren"];

type Point = { x: number; z: number };

/** Can boats call at this kind of depot (a dock)? */
export const isDock = (d: DepotState | undefined): d is DepotState => d?.role === "landing" || d?.role === "harbour";

/** A good barges carry. */
export const isBulk = (kind: CargoKind): boolean => BULK.includes(kind);

/** How many loads a boat holds: its barges'. */
export const capacityOf = (b: BoatState): number => b.barges * BARGE_LOADS;

/** How many loads it has on. */
export function loaded(b: BoatState): number {
  let n = 0;
  for (const k of BULK) n += b.load[k] ?? 0;
  return n;
}

/** Where a boat ties up at a dock (world), and which way along the bank it lies, or null if the dock's piece is gone. */
export function mooring(world: World, depotId: number): (Point & { heading: number }) | null {
  const d = world.economy.depot(depotId);
  const piece = d && world.layout.getPiece(d.pieceId);
  if (!d || !piece) return null;
  const at = d.role === "harbour" ? QUAY : LANDING_MOOR;
  return { ...depotPoint(piece.pose, at.t, at.l), heading: piece.pose.heading };
}

// ——— Water: which squares join up, and the way along them ———

interface WaterFacts {
  revision: number;
  /** Each square's stretch of water (squares joined side to side), −1 on land. */
  region: Int32Array;
}

/** By grid: worked out again only when its squares change. */
const waterCache = new WeakMap<object, WaterFacts>();

function waterOf(land: Landscape): WaterFacts {
  const g = land.grid;
  const hit = waterCache.get(g);
  if (hit && hit.revision === g.revision) return hit;
  const region = new Int32Array(g.cellCount).fill(-1);
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < g.cellCount; i++) {
    if (region[i] !== -1 || !isWater(g.surface[i])) continue;
    region[i] = n;
    stack.push(i);
    while (stack.length > 0) {
      const c = stack.pop()!;
      const col = g.colOf(c);
      const row = g.rowOf(c);
      for (const [dc, dr] of DIRS) {
        const j = g.index(col + dc, row + dr);
        if (j !== -1 && region[j] === -1 && isWater(g.surface[j])) {
          region[j] = n;
          stack.push(j);
        }
      }
    }
    n++;
  }
  const facts = { revision: g.revision, region };
  waterCache.set(g, facts);
  return facts;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The water squares at and beside a point (the square it's on, and the 8 round it). */
function waterNear(land: Landscape, p: Point): number[] {
  const g = land.grid;
  const col = g.colAt(p.x);
  const row = g.rowAt(p.z);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i !== -1 && isWater(g.surface[i])) out.push(i);
    }
  // The square it's on first (the nearest).
  out.sort((a, b) => Math.hypot(g.centreX(g.colOf(a)) - p.x, g.centreZ(g.rowOf(a)) - p.z) - Math.hypot(g.centreX(g.colOf(b)) - p.x, g.centreZ(g.rowOf(b)) - p.z));
  return out;
}

/** The stretch of water a point is on or beside (−1: none: it's on dry land). */
export function waterAt(land: Landscape, p: Point): number {
  const near = waterNear(land, p);
  return near.length > 0 ? waterOf(land).region[near[0]] : -1;
}

/**
 * The way by water from `a` to `b` (world points): the shortest run of water squares between them, corners rounded,
 * starting at `a` and ending at `b`; null if no water joins them. Asked when a boat sets off (cached by `Fleet`).
 */
export function waterPath(land: Landscape, a: Point, b: Point): Point[] | null {
  const g = land.grid;
  const starts = waterNear(land, a);
  const ends = new Set(waterNear(land, b));
  if (starts.length === 0 || ends.size === 0) return null;
  const from = new Int32Array(g.cellCount).fill(-2);
  const queue: number[] = [];
  for (const i of starts) {
    from[i] = -1;
    queue.push(i);
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    if (ends.has(i)) {
      const cells: number[] = [];
      for (let j = i; j !== -1; j = from[j]) cells.push(j);
      cells.reverse();
      const pts: Point[] = [a, ...cells.map((j) => ({ x: g.centreX(g.colOf(j)), z: g.centreZ(g.rowOf(j)) })), b];
      return smooth(pts);
    }
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const [dc, dr] of DIRS) {
      const j = g.index(col + dc, row + dr);
      if (j === -1 || from[j] !== -2 || !isWater(g.surface[j])) continue;
      from[j] = i;
      queue.push(j);
    }
  }
  return null;
}

/** Rounded corners (two passes of corner cutting), keeping the ends. */
function smooth(pts: Point[]): Point[] {
  let out = pts;
  for (let pass = 0; pass < 2 && out.length >= 3; pass++) {
    const next = [out[0]];
    for (let k = 0; k < out.length - 1; k++) {
      const a = out[k];
      const b = out[k + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** A way's length (mm). */
export function wayLength(way: readonly Point[]): number {
  let n = 0;
  for (let k = 1; k < way.length; k++) n += Math.hypot(way[k].x - way[k - 1].x, way[k].z - way[k - 1].z);
  return n;
}

/** The point `d` mm along a way, and the way it faces there (radians: atan2(dz, dx)). */
export function alongWay(way: readonly Point[], d: number): Point & { heading: number } {
  let left = Math.max(0, d);
  for (let k = 1; k < way.length; k++) {
    const a = way[k - 1];
    const b = way[k];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || k === way.length - 1) {
      const f = len > 0 ? Math.min(1, left / len) : 0;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: Math.atan2(b.z - a.z, b.x - a.x) };
    }
    left -= len;
  }
  const p = way[0] ?? { x: 0, z: 0 };
  return { ...p, heading: 0 };
}

// ——— Events ———

export type BoatEvent =
  /** It tied up at a dock: what it dropped and picked up there. */
  | { kind: "docked"; boatId: number; depotId: number; dropped: number; picked: number }
  /** It set off for its next stop. */
  | { kind: "sailed"; boatId: number; depotId: number }
  /** Its next stop can't be reached by water (taken up, or on other water): it waits. */
  | { kind: "stuck"; boatId: number; depotId: number };

// ——— The fleet ———

/**
 * What the boats do, once a second of play (`tick`), and buying and changing them (from the cards). Their state is the
 * economy's (`Economy.boats`, saved with the map); this keeps only what's worked out from it: the ways between docks.
 */
export class Fleet {
  /** Ways between docks, by "from>to", with the docks' poses and the land's revision they were found for. */
  private readonly ways = new Map<string, { key: string; way: Point[] | null; length: number }>();
  /** When the boats were last moved on (game seconds), so the view can place them between ticks. */
  tickedAt = 0;

  constructor(private readonly world: () => World) {}

  private get economy(): Economy {
    return this.world().economy;
  }

  /** Every boat, by id order. */
  all(): BoatState[] {
    return [...this.economy.boats.values()];
  }

  /** The boats at a dock or calling there. */
  callingAt(depotId: number): BoatState[] {
    return this.all().filter((b) => b.home === depotId || b.stops.some((s) => s.depotId === depotId));
  }

  /** Why a boat can't be bought at this dock (or null): coins, or the most on the map. */
  whyNotBuy(depotId: number, p: Progress): string | null {
    if (!isDock(this.economy.depot(depotId))) return "Boats are bought at a landing";
    if (this.economy.boats.size >= MAX_BOATS) return `${MAX_BOATS} boats is the most`;
    if (p.coins < BOAT_PRICE) return `A tug and a barge cost ${BOAT_PRICE} coins`;
    return null;
  }

  /** Buy a tug and a barge at a dock: it waits there, its route that one stop, for the player to give it more. */
  buy(depotId: number, p: Progress): BoatState | null {
    if (this.whyNotBuy(depotId, p)) return null;
    p.coins -= BOAT_PRICE;
    const ids = [...this.economy.boats.keys()];
    const id = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const used = new Set(this.all().map((b) => b.name));
    const name = NAMES.find((n) => !used.has(n)) ?? `Boat ${id}`;
    const b: BoatState = { id, name, barges: 1, load: {}, stops: [{ depotId, action: "pick" }], from: 0, docked: true, t: 0, going: true, home: depotId, loadedAt: {} };
    this.economy.boats.set(id, b);
    return b;
  }

  /** Another barge for a tug (up to `MAX_BARGES`), for `BARGE_PRICE` coins; false if it can't. */
  addBarge(boatId: number, p: Progress): boolean {
    const b = this.economy.boats.get(boatId);
    if (!b || b.barges >= MAX_BARGES || p.coins < BARGE_PRICE) return false;
    p.coins -= BARGE_PRICE;
    b.barges++;
    return true;
  }

  /** Sell a boat (half what it cost back); what it carried goes with it. */
  sell(boatId: number, p: Progress): number {
    const b = this.economy.boats.get(boatId);
    if (!b) return 0;
    const back = Math.floor((BOAT_PRICE + (b.barges - 1) * BARGE_PRICE) / 2);
    p.coins += back;
    this.economy.boats.delete(boatId);
    return back;
  }

  /** Can this boat get to this dock by water from where it is (its home dock's water)? */
  reaches(boatId: number, depotId: number): boolean {
    const b = this.economy.boats.get(boatId);
    const there = mooring(this.world(), depotId);
    const home = b && this.anchorOf(b);
    if (!b || !there || !home || !isDock(this.economy.depot(depotId))) return false;
    const land = this.world().landscape;
    const w = waterAt(land, home);
    return w !== -1 && w === waterAt(land, there);
  }

  /** Add a dock to the end of a boat's route (planning: a tap on it); why not, or null. */
  addStop(boatId: number, depotId: number): string | null {
    const b = this.economy.boats.get(boatId);
    if (!b) return "No such boat";
    const d = this.economy.depot(depotId);
    if (!isDock(d)) return "Boats only call at landings and harbours";
    if (!this.reaches(boatId, depotId)) return `${b.name} can't get there: it's on other water`;
    const last = b.stops[b.stops.length - 1];
    if (last?.depotId === depotId) return null;
    b.stops.push({ depotId, action: b.stops.length === 0 ? "pick" : "drop" });
    return null;
  }

  /** Take a stop off a boat's route (it keeps at least one: where it is). */
  removeStop(boatId: number, index: number): void {
    const b = this.economy.boats.get(boatId);
    if (!b || b.stops.length <= 1 || index < 0 || index >= b.stops.length) return;
    b.stops.splice(index, 1);
    if (b.from >= b.stops.length || index < b.from) b.from = Math.max(0, b.from - 1);
    if (!b.docked) {
      // (Sailing, its way may have gone: it ties up again at the stop it left.)
      b.docked = true;
      b.t = 0;
    }
  }

  /** A stop's action, the next in turn: both, only pick up, only drop. */
  cycleAction(boatId: number, index: number): BoatStopAction | null {
    const s = this.economy.boats.get(boatId)?.stops[index];
    if (!s) return null;
    s.action = s.action === "both" ? "pick" : s.action === "pick" ? "drop" : "both";
    return s.action;
  }

  /** The dock it's at, or the one it sailed from. */
  private anchorOf(b: BoatState): Point | null {
    const s = b.stops[b.from] ?? b.stops[0];
    return mooring(this.world(), s?.depotId ?? b.home) ?? mooring(this.world(), b.home);
  }

  /** The way from stop `i`'s dock to stop `j`'s, cached by the docks, their poses and the land's revision. */
  wayBetween(fromDepot: number, toDepot: number): { way: Point[] | null; length: number } {
    const world = this.world();
    const a = mooring(world, fromDepot);
    const b = mooring(world, toDepot);
    const id = `${fromDepot}>${toDepot}`;
    const key = `${world.landscape.grid.revision}|${a?.x},${a?.z}|${b?.x},${b?.z}`;
    const hit = this.ways.get(id);
    if (hit && hit.key === key) return hit;
    const way = a && b ? waterPath(world.landscape, a, b) : null;
    const found = { key, way, length: way ? wayLength(way) : 0 };
    this.ways.set(id, found);
    return found;
  }

  /** The next stop's index after `from`. */
  private nextOf(b: BoatState): number {
    return (b.from + 1) % b.stops.length;
  }

  /** Where a boat is now (world), and which way it faces: `extra` seconds after the last tick, for drawing between ticks. */
  where(b: BoatState, extra = 0): (Point & { heading: number }) | null {
    if (b.docked || b.stops.length < 2) {
      const m = mooring(this.world(), b.stops[b.from]?.depotId ?? b.home) ?? mooring(this.world(), b.home);
      return m;
    }
    const to = b.stops[this.nextOf(b)];
    const { way, length } = this.wayBetween(b.stops[b.from].depotId, to.depotId);
    if (!way) return mooring(this.world(), b.stops[b.from].depotId);
    const d = Math.min(length, (b.t + (b.going ? extra : 0)) * BOAT_SPEED);
    return alongWay(way, d);
  }

  /** What it's doing, for its card. */
  status(b: BoatState): string {
    const name = (id: number) => this.world().economy.depot(id) && depotLabel(this.world(), id);
    if (b.stops.length < 2) return "Waiting for a route: tap ✎ Route, then landings on this river";
    if (!b.going) return "Stopped";
    if (b.docked) return `At ${name(b.stops[b.from].depotId) ?? "its dock"}`;
    return `Going to ${name(b.stops[this.nextOf(b)].depotId) ?? "its next stop"}`;
  }

  /**
   * Move every boat on by `seconds` of play: sailing ones along their way (tying up when they get there, dropping and
   * picking up as the stop says), tied-up ones setting off when their time at the dock is up. Stops whose dock has gone
   * are dropped from routes; a boat with no dock left at all goes too.
   */
  tick(seconds: number): BoatEvent[] {
    const events: BoatEvent[] = [];
    const economy = this.economy;
    const layout = this.world().layout;
    /** A dock still on the map (its depot outlives its piece till the economy tidies up). */
    const live = (id: number) => {
      const d = economy.depot(id);
      return isDock(d) && !!layout.getPiece(d.pieceId);
    };
    for (const b of [...economy.boats.values()]) {
      // Docks taken up: off its route (and its home, if that went: the first stop still standing).
      const kept = b.stops.filter((s) => live(s.depotId));
      if (kept.length !== b.stops.length) {
        const fromDepot = b.stops[b.from]?.depotId;
        b.stops = kept;
        const at = kept.findIndex((s) => s.depotId === fromDepot);
        b.from = at === -1 ? 0 : at;
        if (at === -1) {
          b.docked = true;
          b.t = 0;
        }
      }
      if (!live(b.home)) b.home = b.stops[0]?.depotId ?? -1;
      if (b.stops.length === 0) {
        economy.boats.delete(b.id);
        continue;
      }
      if (!b.going || b.stops.length < 2) {
        if (b.docked) b.t += seconds;
        continue;
      }
      if (b.docked) {
        b.t += seconds;
        if (b.t < DOCK_SECONDS) continue;
        const to = b.stops[this.nextOf(b)];
        const { way } = this.wayBetween(b.stops[b.from].depotId, to.depotId);
        if (!way) {
          events.push({ kind: "stuck", boatId: b.id, depotId: to.depotId });
          b.t = 0;
          continue;
        }
        b.docked = false;
        b.t = 0;
        events.push({ kind: "sailed", boatId: b.id, depotId: to.depotId });
        continue;
      }
      b.t += seconds;
      const next = this.nextOf(b);
      const { way, length } = this.wayBetween(b.stops[b.from].depotId, b.stops[next].depotId);
      if (way && b.t * BOAT_SPEED < length) continue;
      // There (or its way's gone: it ties up where it was going all the same, as a toy would be put there).
      b.from = next;
      b.docked = true;
      b.t = 0;
      const stop = b.stops[next];
      const done = this.serve(b, stop);
      events.push({ kind: "docked", boatId: b.id, depotId: stop.depotId, ...done });
    }
    return events;
  }

  /**
   * At a dock: drop what the dock takes (unless the stop says only pick up), then pick up bulk goods it gives (unless
   * only drop), up to what the barges hold. Goods it picked up here aren't dropped here again.
   */
  serve(b: BoatState, stop: BoatStop): { dropped: number; picked: number } {
    const d = this.economy.depot(stop.depotId);
    if (!d) return { dropped: 0, picked: 0 };
    let dropped = 0;
    let picked = 0;
    if (stop.action !== "pick") {
      for (const k of BULK) {
        const have = b.load[k] ?? 0;
        if (have <= 0 || !RECIPES[d.role].takes.includes(k)) continue;
        if (d.role === "landing" && !storeLetsIn(d, k)) continue;
        const i = CARGO[k].index;
        const n = Math.min(have, capAt(d) - d.piles[i]);
        if (n <= 0) continue;
        d.piles[i] += n;
        b.load[k] = have - n;
        dropped += n;
        if (b.loadedAt[k] !== undefined && b.loadedAt[k] !== d.id) this.economy.boatDelivered += n;
        if (b.load[k] === 0) delete b.loadedAt[k];
      }
    }
    if (stop.action !== "drop") {
      for (const k of BULK) {
        if (!RECIPES[d.role].gives.includes(k) || (d.role === "landing" && !storeLetsOut(d, k))) continue;
        const i = CARGO[k].index;
        const room = capacityOf(b) - loaded(b);
        const n = Math.min(room, d.piles[i]);
        if (n <= 0) continue;
        d.piles[i] -= n;
        b.load[k] = (b.load[k] ?? 0) + n;
        b.loadedAt[k] = d.id;
        picked += n;
      }
    }
    if (dropped + picked > 0) this.economy.acceptsChanged();
    return { dropped, picked };
  }
}

/** A dock's name for a boat's card: the landing or harbour, and the town it's near ("Foxley landing"). */
export function depotLabel(world: World, depotId: number): string {
  const d = world.economy.depot(depotId);
  const piece = d && world.layout.getPiece(d.pieceId);
  if (!d || !piece) return "a dock";
  const what = d.role === "harbour" ? "harbour" : "landing";
  let best: { name: string; dist: number } | null = null;
  for (const t of world.landscape.towns) {
    const dist = Math.hypot(t.centre.x - piece.pose.x, t.centre.z - piece.pose.z);
    if (!best || dist < best.dist) best = { name: t.name, dist };
  }
  return best ? `${best.name} ${what}` : what[0].toUpperCase() + what.slice(1);
}

/** Why a landing can't stand here (its jetty must reach the water), or null. */
export function landingWhy(land: Landscape, pose: Pose): string | null {
  const g = land.grid;
  let wet = 0;
  for (const t of [70, 120, 170]) {
    const p = depotPoint(pose, t, LANDING_MOOR.l);
    const cell = g.cellAtWorld(p.x, p.z);
    if (cell !== -1 && isWater(g.surface[cell])) wet++;
  }
  return wet >= 2 ? null : "A landing goes on a bank, its jetty out over the water";
}
