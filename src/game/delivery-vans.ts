import { GOODS_ICON, type CargoKind, type DepotState } from "../economy";
import { kindsOf, total, type Bag } from "../economy/goods";
import { SURF_ROAD } from "../landscape";
import { VAN_REACH } from "../roads/road-paths";
import type { RoadVehicle, RoadVehicles } from "../roads/vehicles";
import { connectorRef, getPieceDef, type Layout } from "../track";
import type { Trip, Vans } from "./vans";
import type { World } from "./world";

/**
 * Delivery vans (roads spec D5): rail the long haul, a van the last stretch. Once Delivery vans is learned, a town's
 * station on the line with a town off the line (its station joined to no track) up to `VAN_REACH` road squares away
 * gets a van, parked on its street by the station. The station then takes from trains what that town wants, onto the
 * van's yard (`Economy.vanYard`): all of a good its own town doesn't want, else every other unit (`share`, as a school
 * shares a load with the towns). The van loads up, drives there, hands the goods over (the
 * town receives them as from a train: it grows, and pays), and comes back. Never between two stations on the line:
 * vans never compete with rail.
 *
 * Event-driven and cheap: the routes are worked out again only when the land, the track or what's learned changed
 * (`sync`, a few comparisons otherwise); goods on the yard start the van's loading time; its trips tick in the
 * economy (`RoadVehicles`), so a headless run plays them as the game does.
 */

/** Goods a van carries on a trip. */
export const VAN_LOAD = 4;
/** Most goods waiting on a station's van yard (the van's and the next trip's). */
export const VAN_YARD = 8;
/** Seconds a van waits after goods come on its yard before it leaves (more come off the train meanwhile). */
export const VAN_LOADING = 2;

/** A station's van run: its yard (the station depot), where its van parks, and the town off the line it serves. */
export interface VanRun {
  readonly depotId: number;
  readonly home: number;
  readonly townId: number;
}

/** A van's trip, with its load and its station. */
export interface VanTrip extends Trip {
  readonly depotId: number;
  readonly townId: number;
  /** What it carries now (counted on the yard too, until handed over). */
  load: Bag;
}

export interface DeliveryHost {
  readonly world: World;
  readonly vans: Vans;
  /** Is Delivery vans learned? */
  knows(): boolean;
  /** How many more of `kind` town `townId` wants for its next level. */
  lacks(townId: number, kind: CargoKind): number;
}

/** Is any track joined to this piece? */
export function joinedToTrack(layout: Layout, pieceId: number): boolean {
  const piece = layout.getPiece(pieceId);
  if (!piece) return false;
  const n = getPieceDef(piece.type, piece.flipped).connectors.length;
  for (let k = 0; k < n; k++) if (layout.joinedConnector(connectorRef(pieceId, k)) !== -1) return true;
  return false;
}

/**
 * The town a feeder from station `d` (a van or a bus parked on square `home`) serves: the nearest by road of the towns
 * off the line (their station joined to no track), within `VAN_REACH` road squares, `d`'s own station being on the line.
 * Null: none. Never one with a station on the line: feeders never compete with rail.
 */
export function feederTown(w: World, vans: Vans, d: DepotState, home: number): number | null {
  if (!joinedToTrack(w.layout, d.pieceId)) return null;
  const g = w.landscape.grid;
  let best: number | null = null;
  let length = Infinity;
  for (const t of w.landscape.towns) {
    if (t.id === d.townId) continue;
    const station = w.stations.get(t.id);
    if (station !== undefined && joinedToTrack(w.layout, station)) continue;
    const cells = new Set(t.cells);
    const path = vans.way([home], (i) => cells.has(i) && g.surface[i] === SURF_ROAD, `town${t.id}`, VAN_REACH);
    if (path && path.length < length) {
      length = path.length;
      best = t.id;
    }
  }
  return best;
}

export class DeliveryVans {
  /** Station depot id → its van run. */
  private runs = new Map<number, VanRun>();
  /** What the runs were worked out from. */
  private seen = { known: false, revision: -1, pieces: -1, joints: -1, towns: -1, depots: -1, economy: null as unknown };

  constructor(private readonly host: DeliveryHost) {
    // (Only a station's own van: a trip with a station. Step 4's show van, `Vans.drive`, has none.)
    const ours = (trip: Trip): trip is VanTrip => (trip as VanTrip).depotId !== undefined;
    host.vans.on.van = {
      ready: (v, trip) => ours(trip) && this.go(v, trip),
      arrive: (_v, trip) => ours(trip) && this.arrive(trip),
      home: (v, trip) => ours(trip) && this.backHome(v, trip),
    };
  }

  private get vehicles(): RoadVehicles {
    return this.host.vans.vehicles;
  }

  /** The van run from station depot `depotId`, if it has one. */
  runOf(depotId: number): VanRun | undefined {
    this.sync();
    return this.runs.get(depotId);
  }

  /** The van run serving town `townId` (from a station on the line), if any. */
  runTo(townId: number): VanRun | undefined {
    this.sync();
    for (const r of this.runs.values()) if (r.townId === townId) return r;
    return undefined;
  }

  /** Station `depotId`'s van, if it has one. */
  vanOf(depotId: number): RoadVehicle | undefined {
    return this.vehicles.list.find((v) => v.kind === "van" && (v.data as VanTrip | null)?.depotId === depotId);
  }

  /**
   * Does station `d`'s van take `kind` now: its run's town still wants more than its yard holds for it, and the yard
   * has room? (Asked as trains unload: a lookup.)
   */
  takes(d: DepotState, kind: CargoKind): boolean {
    if (d.role !== "town") return false;
    const run = this.runOf(d.id);
    if (!run || !this.vanOf(d.id)) return false;
    const yard = this.host.world.economy.vanYard.get(d.id);
    if (yard && total(yard) >= VAN_YARD) return false;
    return this.host.lacks(run.townId, kind) > (yard?.[kind] ?? 0);
  }

  /** Each station's turn, for goods both its town and its van want: the next goes on the van. */
  private readonly vanTurn = new Map<number, boolean>();

  /**
   * A unit both station `d`'s own town and its van's town want: every other one goes on the van (the station shares,
   * as a school shares a load with the towns). Asked once per unit as the crane lands it.
   */
  share(d: DepotState): boolean {
    const turn = this.vanTurn.get(d.id) ?? true;
    this.vanTurn.set(d.id, !turn);
    return turn;
  }

  /** Goods went on station `d`'s van yard: a parked van starts loading. */
  yardFilled(d: DepotState): void {
    const v = this.vanOf(d.id);
    if (v && v.leg === "home") this.vehicles.load(v, VAN_LOADING);
  }

  /**
   * Work out the van runs again if the land, the track, the towns, the depots or what's learned changed (a few
   * comparisons otherwise), and put each run's van in place.
   */
  sync(): void {
    const w = this.host.world;
    const s = this.seen;
    const known = this.host.knows();
    const depots = w.economy.allDepots().length;
    if (s.economy === w.economy && s.known === known && s.revision === w.landscape.grid.revision && s.pieces === w.layout.piecesVersion && s.joints === w.layout.jointsVersion && s.towns === w.landscape.towns.length && s.depots === depots) return;
    if (s.economy !== w.economy) this.runs.clear();
    Object.assign(s, { economy: w.economy, known, revision: w.landscape.grid.revision, pieces: w.layout.piecesVersion, joints: w.layout.jointsVersion, towns: w.landscape.towns.length, depots });
    this.runs = known ? this.findRuns() : new Map();
    this.placeVans();
  }

  private findRuns(): Map<number, VanRun> {
    const w = this.host.world;
    const out = new Map<number, VanRun>();
    for (const d of w.economy.allDepots()) {
      // A town's own station (not a halt: that's for people).
      if (d.role !== "town" || w.stations.get(d.townId) !== d.pieceId) continue;
      const home = this.host.vans.homeOf(d.townId);
      if (home === -1) continue;
      const to = feederTown(w, this.host.vans, d, home);
      if (to !== null) out.set(d.id, { depotId: d.id, home, townId: to });
    }
    return out;
  }

  /** Each run's van parked at its home (a new one if it has none); a van whose run is gone goes, once it's home. */
  private placeVans(): void {
    const rv = this.vehicles;
    for (const v of [...rv.list]) {
      if (v.kind !== "van") continue;
      const trip = v.data as VanTrip | null;
      // (Not a station's delivery van: a show van's trip, step 4.)
      if (!trip || trip.depotId === undefined) continue;
      const run = this.runs.get(trip.depotId);
      if (run && run.home === trip.home && run.townId === trip.townId) continue;
      // (Out on a trip: it finishes it, then this is looked at again.)
      if (v.leg !== "home" && v.leg !== "loading") continue;
      rv.remove(v);
      if (!run) this.yardToTown(trip.depotId);
    }
    for (const run of this.runs.values()) {
      if (this.vanOf(run.depotId)) continue;
      const town = this.host.world.landscape.towns.find((t) => t.id === run.townId);
      if (!town) continue;
      const g = this.host.world.landscape.grid;
      const cells = new Set(town.cells);
      const trip: VanTrip = { home: run.home, goalKey: `town${run.townId}`, goal: (i) => cells.has(i) && g.surface[i] === SURF_ROAD, reach: VAN_REACH, to: -1, depotId: run.depotId, townId: run.townId, load: {} };
      const v = this.host.vans.park("van", run.home, trip);
      // (Goods already waiting: it loads up.)
      if (v && total(this.host.world.economy.vanYard.get(run.depotId) ?? {}) > 0) rv.load(v, VAN_LOADING);
    }
  }

  /** A station with no van run any more: what's on its yard goes to its own town (nothing's lost). */
  private yardToTown(depotId: number): void {
    const e = this.host.world.economy;
    const yard = e.vanYard.get(depotId);
    const d = e.depot(depotId);
    if (!yard || !d) return;
    e.vanYard.delete(depotId);
    for (const k of kindsOf(yard)) for (let n = 0; n < yard[k]!; n++) e.receive(d.townId, k);
  }

  /** Loading time up: take up to a load off the yard and go (nothing there, or no way: it stays parked). */
  private go(v: RoadVehicle, trip: VanTrip): void {
    this.sync();
    const yard = this.host.world.economy.vanYard.get(trip.depotId);
    if (!yard || total(yard) === 0 || this.runs.get(trip.depotId)?.townId !== trip.townId) return;
    const load: Bag = {};
    let n = 0;
    for (const k of kindsOf(yard)) {
      const take = Math.min(yard[k]!, VAN_LOAD - n);
      if (take <= 0) break;
      load[k] = take;
      n += take;
    }
    trip.load = load;
    if (!this.host.vans.send(v, trip)) trip.load = {};
  }

  /** At the town off the line: the load is handed over (received as from a train). */
  private arrive(trip: VanTrip): void {
    const e = this.host.world.economy;
    const yard = e.vanYard.get(trip.depotId) ?? {};
    for (const k of kindsOf(trip.load)) {
      const n = Math.min(trip.load[k]!, yard[k] ?? 0);
      for (let u = 0; u < n; u++) e.receive(trip.townId, k);
      yard[k] = (yard[k] ?? 0) - n;
      if (yard[k]! <= 0) delete yard[k];
    }
    if (total(yard) === 0) e.vanYard.delete(trip.depotId);
    trip.load = {};
  }

  /** Home again: anything brought back (it turned back) is still on the yard; more waiting, it loads up again. */
  private backHome(v: RoadVehicle, trip: VanTrip): void {
    trip.load = {};
    this.seen.revision = -1;
    this.sync();
    if (this.vehicles.list.includes(v) && total(this.host.world.economy.vanYard.get(trip.depotId) ?? {}) > 0) this.vehicles.load(v, VAN_LOADING);
  }

  /**
   * The van's line on a town's card (Game mode): at a station with a van, "Van to Fernby (off the line): 3 🪵
   * waiting"; at the town it serves, "Goods by van from Ashby". Null: neither.
   */
  cardLine(d: DepotState): string | null {
    const w = this.host.world;
    const name = (id: number) => w.landscape.towns.find((t) => t.id === id)?.name ?? "";
    const run = this.runOf(d.id);
    if (run && this.vanOf(d.id)) {
      const v = this.vanOf(d.id)!;
      const trip = v.data as VanTrip;
      const yard = w.economy.vanYard.get(d.id) ?? {};
      const aboard = v.leg === "out" || v.leg === "there" ? trip.load : {};
      const words = (bag: Bag) => kindsOf(bag).filter((k) => bag[k]! > 0).map((k) => `${bag[k]} ${GOODS_ICON[k]}`).join(" ");
      const waiting: Bag = {};
      for (const k of kindsOf(yard)) waiting[k] = yard[k]! - (aboard[k] ?? 0);
      const on = total(aboard) > 0 ? `: on its way with ${words(aboard)}` : "";
      const wait = total(waiting) > 0 ? `${on ? "," : ":"} ${words(waiting)} waiting` : "";
      return `Van to ${name(run.townId)} (off the line)${on}${wait}`;
    }
    if (d.role === "town") {
      const to = this.runTo(d.townId);
      if (to) return `Goods by van from ${name(this.host.world.economy.depot(to.depotId)?.townId ?? -1)}`;
    }
    return null;
  }

  /** Changes whenever `cardLine` may (for the card's key): the yard, the van's trip. */
  cardKey(d: DepotState): number {
    let h = this.runs.size * 31 + (this.runOf(d.id)?.townId ?? -1);
    const yard = this.host.world.economy.vanYard.get(d.id);
    if (yard) for (const k of kindsOf(yard)) h = Math.imul(h ^ yard[k]!, 0x01000193);
    const v = this.vanOf(d.id);
    if (v) h = Math.imul(h ^ (v.leg.length * 7 + total((v.data as VanTrip).load)), 0x01000193);
    return h | 0;
  }
}
