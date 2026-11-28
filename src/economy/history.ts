import { CARGO, CARGO_KINDS, type CargoKind } from "./cargo";

/**
 * Each train's and boat's delivery history (spec docs/superpowers/specs/2026-11-28-delivery-history.md): the stops it
 * called at lately and what it picked up and dropped at each, with where each pickup was meant to go and where each
 * drop came from, how long it rode, and what it paid. Recorded on the economy's own load, drop and rider events (never
 * per frame or per tick), bounded (the last `LOG_VISITS` visits a vehicle, a ring that reuses the visit it overwrites),
 * and saved with the vehicle.
 */

/** Visits kept a vehicle. */
export const LOG_VISITS = 50;
/** Lines kept a visit (a rider for a place past these joins a line with no place). */
export const LOG_LINES = 8;
/** Drops at a town waiting to hear what it paid, a town at most (the oldest go). */
const OWED_MAX = 32;
/** A line's good when it's people (riders): past the cargo indices. */
export const RIDERS = 40;

/** One good moved one way at a visit. */
export interface HaulLine {
  /** Dropped (true) or picked up. */
  drop: boolean;
  /** The good's cargo index (`CARGO[kind].index`), or `RIDERS`. */
  good: number;
  n: number;
  /** A pickup: the depot it's meant for; a drop: the depot it was picked up at. −1: not known (or anywhere). */
  place: number;
  coins: number;
  /** A drop: the seconds its units rode, in all (shown averaged over `n`). */
  rode: number;
}

/** One call at a stop where something moved. */
export interface HaulVisit {
  /** Game time it began (seconds of play: the session clock). */
  at: number;
  depotId: number;
  lines: HaulLine[];
}

/** A vehicle's log: a ring of its last visits. */
export class VehicleLog {
  /** The ring (at most `LOG_VISITS`); `head` is where the next visit goes once it's full. */
  readonly ring: HaulVisit[] = [];
  head = 0;
  /** The visit still under way (its train hasn't left), or null. */
  open: HaulVisit | null = null;

  /** Newest first, into `out` (cleared). */
  visits(out: HaulVisit[] = []): HaulVisit[] {
    out.length = 0;
    const n = this.ring.length;
    for (let k = 1; k <= n; k++) out.push(this.ring[(this.head - k + n) % n]);
    return out;
  }

  /** A new visit at `depotId`, `at`: the next slot of the ring (the oldest visit, reused, once it's full). */
  begin(depotId: number, at: number): HaulVisit {
    let v: HaulVisit;
    if (this.ring.length < LOG_VISITS) {
      v = { at, depotId, lines: [] };
      this.ring.push(v);
      this.head = this.ring.length % LOG_VISITS;
    } else {
      v = this.ring[this.head];
      v.at = at;
      v.depotId = depotId;
      v.lines.length = 0;
      this.head = (this.head + 1) % LOG_VISITS;
    }
    this.open = v;
    return v;
  }
}

/** Where a car's (or a boat's good's) load came aboard: the stop, and the time its first unit did. */
interface Since {
  from: number;
  at: number;
}

interface Owed {
  line: HaulLine;
  good: number;
  units: number;
}

export class HaulLog {
  /** Trains' logs, by engine (`trainKey`). */
  readonly trains = new Map<number, VehicleLog>();
  /** Boats' logs, by boat id. */
  readonly boats = new Map<number, VehicleLog>();
  /** Where each loaded car's goods came aboard, by car id. */
  readonly carSince = new Map<number, Since>();
  /** Where each coach's riders got on: the stop each lot boarded at, and when the first of them did, by car id. */
  readonly riderSince = new Map<number, Map<number, number>>();
  /** Where each boat's goods came aboard, by boat id, then cargo index. */
  readonly boatSince = new Map<number, Map<number, Since>>();
  /** Drops at a town owed their share of what it pays, by town id. */
  private readonly owed = new Map<number, Owed[]>();
  /** Game time now (seconds of play): the game sets it to its session clock; tests and headless runs to the ticks'. */
  clock: () => number = () => 0;
  /** Bumped on every change (the view draws again only then). */
  version = 0;

  private logOf(map: Map<number, VehicleLog>, id: number): VehicleLog {
    let log = map.get(id);
    if (!log) {
      log = new VehicleLog();
      map.set(id, log);
    }
    return log;
  }

  /** The visit under way at `depotId` (a new one if the vehicle's last has ended or was elsewhere). */
  private visit(log: VehicleLog, depotId: number): HaulVisit {
    const v = log.open;
    return v && v.depotId === depotId ? v : log.begin(depotId, Math.round(this.clock()));
  }

  /** The line at this visit for this good, way and place, if there is one (or one more may be made). */
  private line(v: HaulVisit, drop: boolean, good: number, place: number): HaulLine {
    for (const l of v.lines) if (l.drop === drop && l.good === good && l.place === place) return l;
    if (v.lines.length >= LOG_LINES) {
      // (Full: into a line of that good and way with no place, or the last line of that way.)
      for (const l of v.lines) if (l.drop === drop && l.good === good && l.place === -1) return l;
      for (let i = v.lines.length - 1; i >= 0; i--) if (v.lines[i].drop === drop && v.lines[i].good === good) return v.lines[i];
      return v.lines[v.lines.length - 1];
    }
    const l: HaulLine = { drop, good, n: 0, place, coins: 0, rode: 0 };
    v.lines.push(l);
    return l;
  }

  /** The train with engine key `engine` left the stop it was at: its next record is a new visit. */
  left(engine: number): void {
    const log = this.trains.get(engine);
    if (log) log.open = null;
  }

  /**
   * Does the train with key `engine` already have a pickup line of `kind` at its visit to `depotId`? (Then the place
   * it's meant for needn't be worked out again: `picked` adds to it.)
   */
  pickPlace(engine: number, depotId: number, kind: CargoKind): number | null {
    const v = this.trains.get(engine)?.open;
    if (!v || v.depotId !== depotId) return null;
    const good = CARGO[kind].index;
    for (const l of v.lines) if (!l.drop && l.good === good) return l.place;
    return null;
  }

  /** A unit of `kind` loaded onto car `carId` of the train `engine` at `depotId`, meant for depot `to` (−1: unknown). */
  picked(engine: number, carId: number, depotId: number, kind: CargoKind, to: number, wasEmpty: boolean): void {
    const log = this.logOf(this.trains, engine);
    this.line(this.visit(log, depotId), false, CARGO[kind].index, to).n++;
    if (wasEmpty || !this.carSince.has(carId)) this.carSince.set(carId, { from: depotId, at: this.clock() });
    this.version++;
  }

  /**
   * A unit of `kind` dropped off car `carId` of train `engine` at `depotId` (`emptied`: the car has none left). At a
   * town (`townId` ≥ 0) it's owed its share of what the town pays for it (`paid`).
   */
  dropped(engine: number, carId: number, depotId: number, kind: CargoKind, emptied: boolean, townId = -1): void {
    const since = this.carSince.get(carId);
    const good = CARGO[kind].index;
    const l = this.line(this.visit(this.logOf(this.trains, engine), depotId), true, good, since?.from ?? -1);
    l.n++;
    if (since) l.rode += Math.max(0, Math.round(this.clock() - since.at));
    if (emptied) this.carSince.delete(carId);
    if (townId >= 0) this.owe(townId, l, good, 1);
    this.version++;
  }

  /** A rider got on coach `carId` of train `engine` at `depotId`, for depot `to` (−1: anywhere). */
  boarded(engine: number, carId: number, depotId: number, to: number): void {
    this.line(this.visit(this.logOf(this.trains, engine), depotId), false, RIDERS, to).n++;
    let m = this.riderSince.get(carId);
    if (!m) this.riderSince.set(carId, (m = new Map()));
    if (!m.has(depotId)) m.set(depotId, this.clock());
    this.version++;
  }

  /**
   * A rider who got on at `from` got off coach `carId` of train `engine` at `depotId`, paying `fare`; `left` riders
   * from `from` are still aboard.
   */
  alighted(engine: number, carId: number, depotId: number, from: number, fare: number, left: number): void {
    const m = this.riderSince.get(carId);
    const at = m?.get(from);
    const l = this.line(this.visit(this.logOf(this.trains, engine), depotId), true, RIDERS, from);
    l.n++;
    l.coins += fare;
    if (at !== undefined) l.rode += Math.max(0, Math.round(this.clock() - at));
    if (m && left <= 0) {
      m.delete(from);
      if (m.size === 0) this.riderSince.delete(carId);
    }
    this.version++;
  }

  /**
   * A boat's call at a dock (`Fleet.serve`): `dropped` and `picked` by good. A pickup is meant for the next stop on its
   * route that takes it (`to`, −1: none).
   */
  boatServed(boatId: number, depotId: number, dropped: ReadonlyMap<CargoKind, number>, picked: ReadonlyMap<CargoKind, { n: number; to: number }>): void {
    if (dropped.size === 0 && picked.size === 0) return;
    const log = this.logOf(this.boats, boatId);
    const v = log.begin(depotId, Math.round(this.clock()));
    log.open = null;
    let since = this.boatSince.get(boatId);
    const now = this.clock();
    for (const [kind, n] of dropped) {
      const good = CARGO[kind].index;
      const s = since?.get(good);
      const l = this.line(v, true, good, s?.from ?? -1);
      l.n += n;
      if (s) l.rode += Math.max(0, Math.round(now - s.at)) * n;
      since?.delete(good);
    }
    for (const [kind, p] of picked) {
      const good = CARGO[kind].index;
      this.line(v, false, good, p.to).n += p.n;
      if (!since) this.boatSince.set(boatId, (since = new Map()));
      if (!since.has(good)) since.set(good, { from: depotId, at: now });
    }
    this.version++;
  }

  private owe(townId: number, line: HaulLine, good: number, units: number): void {
    let list = this.owed.get(townId);
    if (!list) this.owed.set(townId, (list = []));
    const last = list[list.length - 1];
    if (last && last.line === line) {
      last.units += units;
      return;
    }
    if (list.length >= OWED_MAX) list.shift();
    list.push({ line, good, units });
  }

  /** Town `townId` paid `coins` for `n` units of `kind` it was given: shared out among the drops there owed for it. */
  paid(townId: number, kind: CargoKind, n: number, coins: number): void {
    const list = this.owed.get(townId);
    if (!list || n <= 0) return;
    const good = CARGO[kind].index;
    let units = n;
    let left = coins;
    for (let i = 0; i < list.length && units > 0; ) {
      const o = list[i];
      if (o.good !== good) {
        i++;
        continue;
      }
      const take = Math.min(o.units, units);
      const share = take === units ? left : Math.round((coins * take) / n);
      o.line.coins += share;
      left -= share;
      units -= take;
      o.units -= take;
      if (o.units <= 0) list.splice(i, 1);
      else i++;
    }
    if (list.length === 0) this.owed.delete(townId);
    this.version++;
  }

  /** Loads (goods' units) and people dropped, and coins, over the visits since `from` (game time): a vehicle's summary. */
  static summary(log: VehicleLog | undefined, from: number): { loads: number; people: number; coins: number } {
    let loads = 0;
    let people = 0;
    let coins = 0;
    if (log)
      for (const v of log.ring) {
        if (v.at < from) continue;
        for (const l of v.lines) {
          if (l.drop && l.good === RIDERS) people += l.n;
          else if (l.drop) loads += l.n;
          coins += l.coins;
        }
      }
    return { loads, people, coins };
  }

  /** Forget a vehicle gone (a train taken off the map: its engine no longer on it). */
  forget(engine: number): void {
    this.trains.delete(engine);
  }

  clear(): void {
    this.trains.clear();
    this.boats.clear();
    this.carSince.clear();
    this.riderSince.clear();
    this.boatSince.clear();
    this.owed.clear();
    this.version++;
  }
}

/** The good of a line as a cargo kind (null for riders). */
export function goodKind(good: number): CargoKind | null {
  return good === RIDERS ? null : (CARGO_KINDS.find((k) => CARGO[k].index === good) ?? null);
}

/** A saved line: good, n, drop (1) or pickup (0), place (a saved depot index, −1), coins, seconds ridden in all. */
export type SavedLine = [number, number, 0 | 1, number, number, number];
/** A saved visit: game time, its depot (a saved index, −1: gone), its lines. */
export type SavedVisit = [number, number, SavedLine[]];

/** A log for the save, oldest first, depots renumbered (`index`: −1 for one not saved). */
export function saveLog(log: VehicleLog | undefined, index: (depotId: number) => number): SavedVisit[] | undefined {
  if (!log || log.ring.length === 0) return undefined;
  const out: SavedVisit[] = [];
  const vs = log.visits();
  for (let i = vs.length - 1; i >= 0; i--) {
    const v = vs[i];
    if (v.lines.length === 0) continue;
    out.push([v.at, index(v.depotId), v.lines.map((l) => [l.good, l.n, l.drop ? 1 : 0, l.place === -1 ? -1 : index(l.place), l.coins, l.rode])]);
  }
  return out.length > 0 ? out : undefined;
}

/** A saved log back (depot indices are the loaded depots' ids; one not on the map is −1). */
export function loadLog(saved: readonly SavedVisit[], depot: (id: number) => boolean): VehicleLog {
  const log = new VehicleLog();
  for (const [at, d, lines] of saved.slice(-LOG_VISITS)) {
    const v = log.begin(d >= 0 && depot(d) ? d : -1, at);
    for (const [good, n, drop, place, coins, rode] of lines.slice(0, LOG_LINES))
      v.lines.push({ good, n, drop: drop === 1, place: place >= 0 && depot(place) ? place : -1, coins, rode });
  }
  log.open = null;
  return log;
}
