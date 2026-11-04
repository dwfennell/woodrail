import type { Economy } from "../economy";
import { SURF_ROAD, type Landscape } from "../landscape";
import { roadAt } from "../roads/graph";
import { edgesOf, roadsJoin, type Edge } from "../roads/pieces";
import { findRoadSquares, KEEP_LEFT, RoadPathCache, roadPath, VAN_REACH } from "../roads/road-paths";
import type { RoadPath, RoadVehicle, RoadVehicles, VehicleKind } from "../roads/vehicles";
import type { Layout } from "../track";

/**
 * Road vehicles' trips (roads spec §3, step 4): where a station's van parks (`homeOf`), the ways out and back (searched
 * over the road graph and cached by the land's revision and the crossings: `RoadPathCache`), and, after a road edit,
 * each moving vehicle's way checked again: kept while it's still joined all the way, else a new way found from where
 * it is, else it turns back, else (no road home at all) it's put back home.
 *
 * Nothing here runs per frame: `check` is called once a tick only while a vehicle moves (`RoadVehicles.beforeTick`),
 * and costs two comparisons unless the land or the crossings changed.
 */

export interface VanWorld {
  readonly landscape: Landscape;
  readonly economy: Economy;
  readonly layout: Layout;
  /** Town id → its station's piece id. */
  readonly stations: ReadonlyMap<number, number>;
}

/** The crossings' road squares (and a version that goes up when they change: track edits move them). */
export interface CrossingSquares {
  readonly version: number;
  has(i: number): boolean;
}

/** What happens as a vehicle's trip goes. */
export interface TripEvents {
  /** It reached the far end (D5: it hands over its load). */
  arrive?(v: RoadVehicle, trip: Trip): void;
  /** Its trip ended at home (D5: what it brought back stays on the yard). */
  home?(v: RoadVehicle, trip: Trip): void;
  /** Its loading time at home is up (D5: it takes its load and goes). */
  ready?(v: RoadVehicle, trip: Trip): void;
}

/** A vehicle's trip: home (the square it parks on), and what it's going to. */
export interface Trip {
  readonly home: number;
  /** A key for the goal (paths are cached by it), and the goal itself: is this square where it's going? */
  readonly goalKey: string;
  readonly goal: (i: number) => boolean;
  readonly reach: number;
  /** The square it got to (or is heading for), once known. */
  to: number;
  /** What the game hangs on the trip (a van's load). */
  load?: unknown;
}

const ROAD_TOP = 4.3;

export class Vans {
  readonly paths = new RoadPathCache();
  private seenRevision = -1;
  private seenCrossings = -1;
  private seenVehicles: RoadVehicles | null = null;
  /** What the game does as each kind's trips go (D5's delivery vans, D6's buses). */
  readonly on: Partial<Record<VehicleKind, TripEvents>> = {};

  constructor(
    private readonly world: () => VanWorld,
    private readonly crossings: () => CrossingSquares,
  ) {}

  get vehicles(): RoadVehicles {
    const v = this.world().economy.roadVehicles;
    if (v !== this.seenVehicles) {
      this.seenVehicles = v;
      v.beforeTick = () => this.check();
      v.onArrive = (x) => {
        const trip = x.data as Trip;
        trip.to = this.world().landscape.grid.cellAtWorld(x.x, x.z);
        // The way back, from where it got to (worked out now: the land may have changed on the way).
        x.back = this.way([trip.to], (i) => i === trip.home, `home${trip.home}`, Infinity);
        this.on[x.kind]?.arrive?.(x, trip);
      };
      v.onHome = (x) => this.on[x.kind]?.home?.(x, x.data as Trip);
      v.onReady = (x) => this.on[x.kind]?.ready?.(x, x.data as Trip);
    }
    return v;
  }

  /** The street square a town's station van parks on: its town's street square nearest the station (−1: none). */
  homeOf(townId: number): number {
    const w = this.world();
    const town = w.landscape.towns.find((t) => t.id === townId);
    const pieceId = w.stations.get(townId);
    const piece = pieceId === undefined ? undefined : w.layout.getPiece(pieceId);
    if (!town || !piece) return -1;
    const g = w.landscape.grid;
    let best = -1;
    let near = Infinity;
    for (const i of town.cells) {
      if (g.surface[i] !== SURF_ROAD || roadAt(w.landscape, i) === 0) continue;
      const d = Math.hypot(g.centreX(g.colOf(i)) - piece.pose.x, g.centreZ(g.rowOf(i)) - piece.pose.z);
      if (d < near) {
        near = d;
        best = i;
      }
    }
    return best;
  }

  /** A way from one of `from` to the nearest square `goal` takes (cached by `key`), or null. */
  way(from: readonly number[], goal: (i: number) => boolean, key: string, reach = VAN_REACH): RoadPath | null {
    const w = this.world();
    const cross = this.crossings();
    return this.paths.get(w.landscape, cross.version, `${from.join(",")}>${key}>${reach}`, () => {
      const squares = findRoadSquares(w.landscape, from, goal, reach);
      return squares && squares.length > 1 ? roadPath(w.landscape, squares, (i) => cross.has(i)) : null;
    });
  }

  /** A vehicle parked on square `home` (a new one; null at the cap), facing along its road, at the kerb on its left. */
  park(kind: VehicleKind, home: number, data: Trip | null = null): RoadVehicle | null {
    const land = this.world().landscape;
    const g = land.grid;
    // (Along x if its road goes east or west, else along z.)
    const heading = edgesOf(roadAt(land, home)) & 5 ? 0 : -Math.PI / 2;
    const at = kerbOf(g.centreX(g.colOf(home)), g.centreZ(g.rowOf(home)), heading);
    return this.vehicles.add(kind, at.x, g.groundY(home) + ROAD_TOP, at.z, heading, data);
  }

  /** Send a parked vehicle on a trip from its home to the nearest square its goal takes; false if there's no way. */
  send(v: RoadVehicle, trip: Trip): boolean {
    const out = this.way([trip.home], trip.goal, trip.goalKey, trip.reach);
    if (!out) return false;
    v.data = trip;
    trip.to = out.squares[out.squares.length - 1];
    // (The way back is worked out on arriving.)
    this.vehicles.send(v, out, null);
    return true;
  }

  /**
   * For show (step 4): a van from a town's station along the road to another town's streets and back. Its own van
   * (one per station). False if there's no way within `reach`.
   */
  drive(fromTown: number, toTown: number, reach = 64): boolean {
    const home = this.homeOf(fromTown);
    const to = this.world().landscape.towns.find((t) => t.id === toTown);
    if (home === -1 || !to) return false;
    const g = this.world().landscape.grid;
    const cells = new Set(to.cells);
    const trip: Trip = { home, goalKey: `town${toTown}`, goal: (i) => cells.has(i) && g.surface[i] === SURF_ROAD, reach, to: -1 };
    let v = this.vehicles.list.find((x) => x.kind === "van" && (x.data as Trip | null)?.home === home) ?? null;
    if (v && v.leg !== "home") return false;
    v ??= this.park("van", home, trip);
    return !!v && this.send(v, trip);
  }

  /** After a road or track edit (once, on the next tick a vehicle moves): check each moving vehicle's way. */
  check(): void {
    const w = this.world();
    const cross = this.crossings();
    if (w.landscape.grid.revision === this.seenRevision && cross.version === this.seenCrossings) return;
    this.seenRevision = w.landscape.grid.revision;
    this.seenCrossings = cross.version;
    for (const v of this.vehicles.list) if (v.leg !== "home" && v.leg !== "loading") this.reroute(v);
  }

  private reroute(v: RoadVehicle): void {
    const trip = v.data as Trip | null;
    if (!trip) return;
    const land = this.world().landscape;
    const g = land.grid;
    const home = (i: number) => i === trip.home;
    if (v.leg === "there") {
      v.back = this.way([trip.to], home, `home${trip.home}`, Infinity);
      return;
    }
    const path = v.path!;
    const here = g.cellAtWorld(v.x, v.z);
    const k = path.squares.indexOf(here);
    if (k !== -1 && intact(land, path.squares, k)) {
      // Still joined all the way; but a crossing may have come or gone: the same squares, its holds afresh.
      const fresh = roadPath(land, path.squares, (i) => this.crossings().has(i));
      if (fresh.holds.length !== path.holds.length || fresh.holds.some((h, n) => h.square !== path.holds[n].square)) {
        // (Past the join it set off on, if any: the same place on the fresh path.)
        const t = v.t - (path.lead ?? 0);
        v.path = fresh;
        v.t = Math.max(0, Math.min(t, fresh.length));
      }
      return;
    }
    const at = here === -1 || roadAt(land, here) === 0 ? (k > 0 ? path.squares[k - 1] : trip.home) : here;
    if (v.leg === "out") {
      const on = this.way([at], trip.goal, trip.goalKey, trip.reach);
      if (on) {
        trip.to = on.squares[on.squares.length - 1];
        this.vehicles.follow(v, on);
        return;
      }
    }
    const back = this.way([at], home, `home${trip.home}`, Infinity);
    if (back) {
      this.vehicles.turnBack(v, back);
      return;
    }
    // No road home at all: it's put back home (at its kerb).
    const spot = kerbOf(g.centreX(g.colOf(trip.home)), g.centreZ(g.rowOf(trip.home)), v.heading);
    this.vehicles.park(v, spot.x, g.groundY(trip.home) + ROAD_TOP, spot.z, v.heading);
    this.on[v.kind]?.home?.(v, trip);
  }
}

/** Where a vehicle facing `heading` parks on a square whose middle is (x, z): in its lane, by the kerb on its left. */
function kerbOf(x: number, z: number, heading: number): { x: number; z: number } {
  // Left of the way it faces (dx, dz) = (cos, −sin): (dz, −dx), as the paths keep (`roadPath`).
  return { x: x - Math.sin(heading) * KEEP_LEFT, z: z - Math.cos(heading) * KEEP_LEFT };
}

/** Are squares `k` on of a path still road, each joined to the next? */
function intact(land: Landscape, squares: readonly number[], k: number): boolean {
  const g = land.grid;
  const nb = g.neighbours();
  for (let n = k; n < squares.length; n++) {
    const i = squares[n];
    const a = roadAt(land, i);
    if (a === 0) return false;
    if (n + 1 >= squares.length) break;
    const j = squares[n + 1];
    let e = -1;
    for (let d = 0; d < 4; d++) if (nb[i * 4 + d] === j) e = d;
    if (e === -1 || !roadsJoin(a, e as Edge, roadAt(land, j), g.height[j] - g.height[i])) return false;
  }
  return true;
}
