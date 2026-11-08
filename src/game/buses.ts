import type { DepotState } from "../economy";
import { SURF_ROAD } from "../landscape";
import { roadAt } from "../roads/graph";
import { VAN_REACH } from "../roads/road-paths";
import type { RoadVehicle, RoadVehicles } from "../roads/vehicles";
import { feederTown } from "./delivery-vans";
import type { Trip, Vans } from "./vans";
import type { World } from "./world";

/**
 * Buses (roads spec D6), on D5's machinery: a bus stop (the catalogue's `scene-bus-stop`, free once Buses is learned)
 * beside a town's station on the line, with a town off the line (its station joined to no track) up to `VAN_REACH`
 * road squares away, gets a bus. While people wait at that town's station (no train will come for them) and there's
 * room on the platform at home, the bus goes, brings up to `BUS_SEATS` of them back, and they wait there for a
 * passenger train like anyone else. Never between two stations on the line.
 *
 * Event-driven and cheap: the runs are worked out again only when the land, the track, the props or what's learned
 * changed; `update` (once a second, with people arriving) is a look per bus; its trips tick in the economy.
 */

/** The bus stop's catalogue model. */
export const BUS_STOP = "scene-bus-stop";
/** People a bus brings a trip. */
export const BUS_SEATS = 4;
/** A bus stop serves the station whose piece is nearest it, within this (mm). */
export const BUS_STOP_REACH = 260;
/** Street squares (nearest the stop first) tried for where a bus parks: each a search of at most `VAN_REACH`. */
const BUS_HOMES_TRIED = 8;
/** Seconds a bus waits at its stop before leaving. */
export const BUS_LOADING = 1.5;

/** A station's bus run: its station depot, the bus stop (prop id), where the bus parks, and the town it fetches from. */
export interface BusRun {
  readonly depotId: number;
  readonly stop: number;
  readonly home: number;
  readonly townId: number;
}

export interface BusTrip extends Trip {
  readonly depotId: number;
  readonly townId: number;
  /** People on board, coming back. */
  riders: number;
}

export interface BusHost {
  readonly world: World;
  readonly vans: Vans;
  /** Is Buses learned? */
  knows(): boolean;
  /** Most people waiting at a town's stops (the platform's room: `waitingCap`). */
  room(): number;
}

export class Buses {
  private runs = new Map<number, BusRun>();
  private seen = { known: false, revision: -1, pieces: -1, joints: -1, props: -1, towns: -1, depots: -1, economy: null as unknown };

  constructor(private readonly host: BusHost) {
    host.vans.on.bus = {
      ready: (v, trip) => this.go(v, trip as BusTrip),
      arrive: (_v, trip) => this.board(trip as BusTrip),
      home: (_v, trip) => this.alight(trip as BusTrip),
    };
  }

  private get vehicles(): RoadVehicles {
    return this.host.vans.vehicles;
  }

  runOf(depotId: number): BusRun | undefined {
    this.sync();
    return this.runs.get(depotId);
  }

  runFrom(townId: number): BusRun | undefined {
    this.sync();
    for (const r of this.runs.values()) if (r.townId === townId) return r;
    return undefined;
  }

  busOf(depotId: number): RoadVehicle | undefined {
    return this.vehicles.list.find((v) => v.kind === "bus" && (v.data as BusTrip | null)?.depotId === depotId);
  }

  /** Work out the bus runs again if the land, the track, the props, the towns or what's learned changed. */
  sync(): void {
    const w = this.host.world;
    const s = this.seen;
    const known = this.host.knows();
    const depots = w.economy.allDepots().length;
    if (s.economy === w.economy && s.known === known && s.revision === w.landscape.grid.revision && s.pieces === w.layout.piecesVersion && s.joints === w.layout.jointsVersion && s.props === w.props.version && s.towns === w.landscape.towns.length && s.depots === depots) return;
    if (s.economy !== w.economy) this.runs.clear();
    Object.assign(s, { economy: w.economy, known, revision: w.landscape.grid.revision, pieces: w.layout.piecesVersion, joints: w.layout.jointsVersion, props: w.props.version, towns: w.landscape.towns.length, depots });
    this.runs = known ? this.findRuns() : new Map();
    this.placeBuses();
  }

  /** Each bus stop: the town station nearest it (within reach); then that station's run to a town off the line. */
  private findRuns(): Map<number, BusRun> {
    const w = this.host.world;
    const g = w.landscape.grid;
    const out = new Map<number, BusRun>();
    const stations = w.economy.allDepots().filter((d) => d.role === "town" && w.stations.get(d.townId) === d.pieceId);
    for (const p of w.props.all()) {
      if (p.asset !== BUS_STOP) continue;
      let best: DepotState | null = null;
      let near = BUS_STOP_REACH;
      for (const d of stations) {
        const pose = w.layout.getPiece(d.pieceId)!.pose;
        const dist = Math.hypot(pose.x - p.x, pose.z - p.z);
        if (dist < near) {
          near = dist;
          best = d;
        }
      }
      if (!best || out.has(best.id)) continue;
      // The bus parks on its town's street square nearest the stop that has a way to a town off the line (a town that
      // grew can have a street by the stop that isn't joined to the road out: the next nearest is tried).
      const town = w.landscape.towns.find((t) => t.id === best!.townId);
      if (!town) continue;
      const streets: [number, number][] = [];
      for (const i of town.cells) {
        if (g.surface[i] !== SURF_ROAD || roadAt(w.landscape, i) === 0) continue;
        streets.push([Math.hypot(g.centreX(g.colOf(i)) - p.x, g.centreZ(g.rowOf(i)) - p.z), i]);
      }
      streets.sort((x, y) => x[0] - y[0]);
      for (const [, home] of streets.slice(0, BUS_HOMES_TRIED)) {
        const to = feederTown(w, this.host.vans, best, home);
        if (to === null) continue;
        out.set(best.id, { depotId: best.id, stop: p.id, home, townId: to });
        break;
      }
    }
    return out;
  }

  private placeBuses(): void {
    const rv = this.vehicles;
    for (const v of [...rv.list]) {
      if (v.kind !== "bus") continue;
      const trip = v.data as BusTrip | null;
      if (!trip || trip.depotId === undefined) continue;
      const run = this.runs.get(trip.depotId);
      if (run && run.home === trip.home && run.townId === trip.townId) continue;
      if (v.leg !== "home" && v.leg !== "loading") continue;
      rv.remove(v);
    }
    for (const run of this.runs.values()) {
      if (this.busOf(run.depotId)) continue;
      const town = this.host.world.landscape.towns.find((t) => t.id === run.townId);
      if (!town) continue;
      const g = this.host.world.landscape.grid;
      const cells = new Set(town.cells);
      const trip: BusTrip = { home: run.home, goalKey: `town${run.townId}`, goal: (i) => cells.has(i) && g.surface[i] === SURF_ROAD, reach: VAN_REACH, to: -1, depotId: run.depotId, townId: run.townId, riders: 0 };
      this.host.vans.park("bus", run.home, trip);
    }
  }

  /** People waiting at all of a town's stops. */
  private waitingIn(townId: number): number {
    let n = 0;
    for (const d of this.host.world.economy.allDepots()) if (d.role === "town" && d.townId === townId) n += d.waiting;
    return n;
  }

  /** The station of the town a bus fetches from (where its people wait). */
  private farStation(townId: number): DepotState | undefined {
    const w = this.host.world;
    return w.economy.allDepots().find((d) => d.role === "town" && d.townId === townId && w.stations.get(townId) === d.pieceId);
  }

  /** Room for more people at a bus's station (its town's stops' room, less those waiting and those the bus is bringing). */
  private roomAt(depotId: number): number {
    const d = this.host.world.economy.depot(depotId);
    if (!d) return 0;
    let coming = 0;
    for (const v of this.vehicles.list) if (v.kind === "bus" && (v.data as BusTrip).depotId === depotId && v.leg !== "home") coming += BUS_SEATS;
    return Math.max(0, this.host.room() - this.waitingIn(d.townId) - coming);
  }

  /** Once a second: a parked bus whose far town has people waiting, with room for them at home, gets ready to go. */
  update(): void {
    this.sync();
    for (const run of this.runs.values()) {
      const bus = this.busOf(run.depotId);
      if (!bus || bus.leg !== "home") continue;
      if ((this.farStation(run.townId)?.waiting ?? 0) > 0 && this.roomAt(run.depotId) > 0) this.vehicles.load(bus, BUS_LOADING);
    }
  }

  private go(v: RoadVehicle, trip: BusTrip): void {
    this.sync();
    if (this.runs.get(trip.depotId)?.townId !== trip.townId) return;
    if ((this.farStation(trip.townId)?.waiting ?? 0) === 0) return;
    trip.riders = 0;
    this.host.vans.send(v, trip);
  }

  /** At the town off the line: its waiting people get on (as many as there are seats and room for at home). */
  private board(trip: BusTrip): void {
    const far = this.farStation(trip.townId);
    const d = this.host.world.economy.depot(trip.depotId);
    if (!far || !d) return;
    const room = Math.max(0, this.host.room() - this.waitingIn(d.townId));
    const n = Math.min(BUS_SEATS, far.waiting, room);
    far.waiting -= n;
    trip.riders = n;
  }

  /** Home: its riders get off and wait on the platform for a train (back at their own station if it turned back). */
  private alight(trip: BusTrip): void {
    const w = this.host.world;
    const d = w.economy.depot(trip.depotId);
    if (trip.riders > 0 && d) d.waiting += trip.riders;
    trip.riders = 0;
    this.seen.revision = -1;
    this.sync();
  }

  /** The bus's line on a town's card: "Bus from Elderwick: brings people to your trains", or "Bus to Larkfield station". */
  cardLine(d: DepotState): string | null {
    const w = this.host.world;
    const name = (id: number) => w.landscape.towns.find((t) => t.id === id)?.name ?? "";
    const run = this.runOf(d.id);
    if (run && this.busOf(d.id)) {
      const bus = this.busOf(d.id)!;
      const riders = (bus.data as BusTrip).riders;
      return `Bus from ${name(run.townId)}: brings people to your trains${riders > 0 ? ` (${riders} on board)` : ""}`;
    }
    if (d.role === "town") {
      const to = this.runFrom(d.townId);
      if (to) return `Bus to ${name(w.economy.depot(to.depotId)?.townId ?? -1)} station`;
    }
    return null;
  }

  cardKey(d: DepotState): number {
    const bus = this.busOf(d.id);
    return ((this.runOf(d.id)?.townId ?? -1) * 31 + (bus ? (bus.data as BusTrip).riders * 7 + bus.leg.length : 0) + this.runs.size * 1009) | 0;
  }
}
