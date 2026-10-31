import { connectorRef, createSample, DECK_GLIDE_S, getPieceDef, indexOfRef, MAX_CONNECTORS, normalizeAngle, pathExitConnector, pathLength, pieceOfRef, samplePath, TRACK_WIDTH, type Layout, type PieceDef } from "../track";
import { CAR_SPECS, COUPLER_GAP, opposite, type CarKind, type CarLook, type Pole } from "./cars";
import {
  ADV_BUFFER,
  ADV_OK,
  ADV_OPEN_END,
  advanceCursor,
  createAdvance,
  createWorldSample,
  cursorWorld,
  flipCursor,
  type Cursor,
  type RouteMemory,
  type WorldSample,
} from "./cursor";
import { nearestCursor } from "./nearest";

export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
/** A train stopped at the end of the line waits this long (2 s) before driving back. */
export const TURNBACK_TICKS = 2 * SIM_HZ;
/**
 * How far back (mm) an engine following another train's engine runs while that one moves (issue #6: about a wagon's
 * length, a gap that reads at a glance), easing down to it (`followCap`); how close it pulls up behind one standing
 * (the stop-short margin: the user's call on #6, it closes up once the one ahead has stopped); and how far apart two
 * engines met head on stand.
 */
const FOLLOW_GAP = 70;
const STOP_GAP = 10;
const NOSE_GAP = 40;
/** How far (mm) an end axle sits in from its car's end face, at most, for `aheadOnTrack`'s reach. */
const FOLLOW_LOOK_PAST = 24;
/**
 * The last resort in `resolveContacts`: within this (mm, and a tick's move) of another engine's back, a follower keeps
 * pace with it. Inside `STOP_GAP`, so it doesn't cut short `followCap`'s easing in (a sudden stop); and small, so
 * trains side by side on a loop's two roads (72 mm apart) never count.
 */
const CONTACT_FOLLOW = 4;
/** For this long (2 s) after coming off a lift, a train still has the right of way over one coming toward it. */
const LIFT_GRACE = 2 * SIM_HZ;
/** Slower than this (mm/s) a train is standing: it doesn't move (or ask for frames) at all. */
const MIN_SPEED = 0.01;
const hasEngine = (t: Train): boolean => t.cars.some((c) => c.kind === "engine");

/** How far along the track (mm) a re-railed train may be slid to find room, and in what steps. */
const RERAIL_SLIDE = 1200;
const RERAIL_STEP = 24;
/** How far (mm) a part uncoupled from its train is set back from the rest: a small visible gap. */
const DECOUPLE_GAP = 8;
/** How far (mm) a turned train is set down away from the buffer it turned at. */
const TURN_CLEARANCE = 0.05;

// Motion tuning (mm, s).
export const ENGINE_SPEED = 120;
/** How quickly (mm/s²) a train gets up to speed, or stops: half a second either way. */
export const ACCELERATION = ENGINE_SPEED * 2;
const SIDE_HIT_DISTANCE = 12;
/** How far ahead (mm) a train looks for a signal at red, and in what steps: well past its stopping distance. */
const SIGNAL_LOOK = 300;
const SIGNAL_STEP = 12;
/** A block runs on through at most this many pieces (a loop with no signal in it ends somewhere). */
const MAX_BLOCK = 64;
/**
 * Where paths meet (a crossing, a switch's roads by its stem: see `crossMasks`): how far (mm) past its stopping
 * distance a train looks for a piece another train is on or coming onto by a path that meets its own, and how far
 * (mm) short of that piece its front face stops.
 */
const CROSS_LOOK = 24;
const CROSS_GAP = 4;
/** Paths a piece may have, for keying a piece's path (`crossClaims`). */
const MAX_PATHS = 16;

export interface Car {
  readonly id: number;
  readonly kind: CarKind;
  /** +1 when the car's own front points toward the train's front. */
  facing: 1 | -1;
  /** Pole on the car's own front face; the rear face has the opposite pole. */
  readonly frontPole: Pole;
  /** Engines only: -1 reverse, 0 off, 1 forward, relative to the car's own front. */
  lever: -1 | 0 | 1;
}

export interface Train {
  readonly id: number;
  /** Ticks left before a train resting on a turnback buffer reverses; −1 when not waiting. */
  turnback: number;
  /**
   * Why it last turned back (a buffer, or track that just stops), the piece its front was on, and
   * when (`Sim.ticks`): the engine card says so while it waits and a while after.
   */
  lastTurn?: { cause: TurnCause; pieceId: number; tick: number };
  /** When an engine's lever was last set (`Sim.ticks`): a train just told to go isn't "waiting" yet. */
  leverTick?: number;
  cars: Car[];
  /** Two per car in train order: car0 front, car0 rear, car1 front, … */
  bogies: Cursor[];
  /** Speed along the train's front direction, always ≥ 0 (a negative result flips the train). */
  speed: number;
  derailed: boolean;
  memory: RouteMemory;
  /** World samples of each bogie, refreshed every tick. */
  world: WorldSample[];
}

/**
 * Why a train last turned back: a buffer, or track that just stops (an open end). Trains turn round only at the end of
 * the track (routing spec §16 Q3): one in another's way waits for it, however long (see `heldBy`).
 */
export type TurnCause = "buffer" | "open-end";

/**
 * How one train holds another where it stands (`Sim.heldBy`): short of a crossing or switch it's on or coming onto
 * ("cross"), close behind it ("follow"), nose to nose with it ("nose"), or against its side ("side").
 */
export type HeldHow = "cross" | "follow" | "nose" | "side";

export type SimEvent =
  | { readonly kind: "derailed"; readonly trainId: number }
  | { readonly kind: "coupled"; readonly trainId: number; readonly absorbedTrainId: number }
  | { readonly kind: "buffer"; readonly trainId: number }
  /** A train was lifted and turned round at a turnback buffer (it has a new id; its cars keep theirs). */
  | { readonly kind: "turned"; readonly trainId: number; readonly newTrainId: number }
  /** A train came onto a lift too long to fit on its platform: it runs to the platform's end and turns back. */
  | { readonly kind: "lift-refused"; readonly trainId: number; readonly pieceId: number; readonly carIds: readonly number[] }
  /** An axle rolled over a joint between pieces (the toy's clickety-clack). */
  | { readonly kind: "joint"; readonly trainId: number; readonly bogie: number };

/** Distance of each bogie behind the front one, for a train of these cars. */
function bogieOffsets(kinds: readonly CarKind[]): number[] {
  const offsets: number[] = [];
  let d = 0;
  for (let i = 0; i < kinds.length; i++) {
    const spec = CAR_SPECS[kinds[i]];
    if (i > 0) d += COUPLER_GAP + spec.bogieInset;
    offsets.push(d);
    d += spec.length - 2 * spec.bogieInset;
    offsets.push(d);
    d += spec.bogieInset;
  }
  return offsets;
}

export type AddTrainResult = { readonly kind: "placed"; readonly trainId: number } | { readonly kind: "no-room" };

/** Flat per-car state for the renderer. transforms stride 6: x, y, z, heading, pitch, roll. */
export interface SimSnapshot {
  count: number;
  ids: Int32Array;
  kinds: Uint8Array;
  trainIds: Int32Array;
  derailed: Uint8Array;
  /** Engine lever (-1, 0, 1); 0 for unpowered cars. */
  levers: Int8Array;
  transforms: Float32Array;
}

export function createSnapshot(capacity = 64): SimSnapshot {
  return {
    count: 0,
    ids: new Int32Array(capacity),
    kinds: new Uint8Array(capacity),
    trainIds: new Int32Array(capacity),
    derailed: new Uint8Array(capacity),
    levers: new Int8Array(capacity),
    transforms: new Float32Array(capacity * 6),
  };
}

const adv = createAdvance();
/** How far (mm) `coveredBy` steps over a piece's end onto the next. */
const COVER_OVER = 0.5;
const coverAdv = createAdvance();
const EMPTY_PIECES: ReadonlySet<number> = new Set();

/** A train's pieces (see `Sim.coveredBy`), and where its axles were then. */
interface Cover {
  bogies: readonly Cursor[];
  /** Each axle's piece and path (piece × 8 + path), when worked out. */
  at: readonly number[];
  /**
   * The track then (`Layout`'s revision, joints and switches versions): an edit, or a switch thrown under the train,
   * changes what's between its axles, so it's worked out again (QA N2).
   */
  track: number;
  joints: number;
  switches: number;
  pieces: ReadonlySet<number>;
}
const lookAdv = createAdvance();
const crossAdv = createAdvance();
const crossAt: Cursor = { pieceId: -1, pathIndex: 0, reversed: false, s: 0 };
const face = { x: 0, y: 0, z: 0 };
const otherFace = { x: 0, y: 0, z: 0 };
const followFace = { x: 0, y: 0, z: 0 };
const followOther = { x: 0, y: 0, z: 0 };

export class Sim {
  private nextTrainId = 1;
  private nextCarId = 1;
  private readonly trains = new Map<number, Train>();
  private events: SimEvent[] = [];
  /**
   * Optional speed limit for a powered train this tick (mm/s), set by the economy so trains crawl through depots and
   * halt with a wagon under the crane. Infinity for no limit; 0 holds the train where it is.
   */
  speedCap: ((train: Train) => number) | null = null;
  /** Optional top speed for a powered train (mm/s): a mode's faster engines. Null: every train runs at `ENGINE_SPEED`. */
  topSpeed: ((train: Train) => number) | null = null;
  /** Optional: how quickly a powered train gets up to speed and stops, against the usual (2: twice as quick). */
  quickness: ((train: Train) => number) | null = null;

  /**
   * The signals on the layout, as keys (`signalKey`: a signal piece and one of its roads), found again after the track
   * changes (see `trackChanged`).
   */
  private signals: number[] | null = null;
  /** Each signal's aspect as of this tick, by key (`signalKey`): true at clear (its block's free), false at red. */
  private readonly aspects = new Map<number, boolean>();
  /** Goes up whenever a signal's aspect changes, so the view redraws only then. */
  signalsVersion = 0;

  constructor(readonly layout: Layout) {}

  get trainCount(): number {
    return this.trains.size;
  }

  trainIds(): number[] {
    return [...this.trains.keys()];
  }

  getTrain(id: number): Train | undefined {
    return this.trains.get(id);
  }

  findCar(carId: number): { train: Train; index: number } | undefined {
    for (const train of this.trains.values()) {
      const index = train.cars.findIndex((c) => c.id === carId);
      if (index !== -1) return { train, index };
    }
    return undefined;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * Put a train down over a dropped point: centred on it, or slid along the track (still covering the point) when a
   * dead end or a switch is too close for it to be centred. `carIds` as for `addTrain`.
   */
  addTrainAround(kinds: readonly CarKind[], at: Cursor, carIds?: readonly number[]): AddTrainResult {
    const offsets = bogieOffsets(kinds);
    const span = offsets[offsets.length - 1];
    // Shifts of the front ahead of the point, nearest centred first; 0 lays the train out behind the point.
    const step = 6;
    const shifts = [span / 2];
    for (let k = step; k <= span / 2; k += step) shifts.push(span / 2 + k, span / 2 - k);
    shifts.push(0, span);
    for (const shift of shifts) {
      const front = { ...at };
      if (shift > 0 && advanceCursor(this.layout, front, shift, null, adv).status !== ADV_OK) continue;
      const r = this.addTrain(kinds, front, carIds);
      if (r.kind === "placed") return r;
    }
    return { kind: "no-room" };
  }

  /**
   * Place a train whose leading axle sits at `at`, cars trailing behind it. `carIds` reuses the ids of cars being put
   * back (picked up, re-railed), so anything keyed by car id (cargo) stays with them.
   */
  addTrain(kinds: readonly CarKind[], at: Cursor, carIds?: readonly number[]): AddTrainResult {
    const offsets = bogieOffsets(kinds);
    const bogies: Cursor[] = [];
    for (const off of offsets) {
      const c = { ...at };
      flipCursor(this.layout, c);
      advanceCursor(this.layout, c, off, null, adv);
      if (adv.status !== ADV_OK) return { kind: "no-room" };
      flipCursor(this.layout, c);
      bogies.push(c);
    }
    if (this.occupied(bogies)) return { kind: "no-room" };
    const train: Train = {
      id: this.nextTrainId++,
      turnback: -1,
      cars: kinds.map((kind, i) => ({ id: carIds?.[i] ?? this.nextCarId++, kind, facing: 1, frontPole: "N", lever: 0 })),
      bogies,
      speed: 0,
      derailed: false,
      memory: new Map(),
      world: bogies.map(() => createWorldSample()),
    };
    this.trains.set(train.id, train);
    this.refreshWorld(train);
    return { kind: "placed", trainId: train.id };
  }

  /** Would a train with these axles overlap a car already on the floor? */
  private occupied(bogies: Cursor[]): boolean {
    const w = createWorldSample();
    for (const b of bogies) {
      cursorWorld(this.layout, b, w);
      for (const t of this.trains.values()) {
        for (let c = 0; c < t.cars.length; c++) {
          const f = t.world[2 * c];
          const r = t.world[2 * c + 1];
          const inset = CAR_SPECS[t.cars[c].kind].bogieInset;
          const dx = f.x - r.x;
          const dz = f.z - r.z;
          const len = Math.hypot(dx, dz) || 1;
          const proj = ((w.x - r.x) * dx + (w.z - r.z) * dz) / len;
          if (proj < -inset - 10 || proj > len + inset + 10) continue;
          const lateral = Math.abs((w.x - r.x) * dz - (w.z - r.z) * dx) / len;
          if (lateral < 20 && Math.abs(w.y - f.y) < 30) return true;
        }
      }
    }
    return false;
  }

  removeTrain(id: number): boolean {
    return this.trains.delete(id);
  }

  /** Each car's look, by id (it follows the car when it's picked up and put down again, as ids do). */
  private readonly looks = new Map<number, CarLook>();

  setLook(carId: number, look: CarLook): void {
    if (look === "classic") this.looks.delete(carId);
    else this.looks.set(carId, look);
  }

  lookOf(carId: number): CarLook {
    return this.looks.get(carId) ?? "classic";
  }

  setLever(carId: number, lever: -1 | 0 | 1): boolean {
    const found = this.findCar(carId);
    if (!found || !CAR_SPECS[found.train.cars[found.index].kind].powered) return false;
    found.train.cars[found.index].lever = lever;
    found.train.leverTick = this.ticks;
    // Whoever set the lever has decided where the train goes: a pending turnback no longer applies.
    found.train.turnback = -1;
    return true;
  }

  /**
   * Turn a standing train round now, as it would be at the end of its wait at the end of the line (`turnAround`): its
   * pending turnback is dropped. Returns the turned train (a new id; its cars keep theirs), or null (nothing done) if
   * it's moving, derailed, riding a deck, or there's no room to set it down turned round.
   */
  turnNow(trainId: number): Train | null {
    const t = this.trains.get(trainId);
    if (!t || t.derailed || t.speed >= 1 || t.bogies.length === 0) return null;
    if (this.rides.size > 0 && this.riding(t)) return null;
    const turned = this.turnAround(t);
    if (!turned) return null;
    turned.lastTurn = t.lastTurn;
    this.events.push({ kind: "turned", trainId: t.id, newTrainId: turned.id });
    return turned;
  }

  /** Turn a car around in place (swaps which magnet faces which way). */
  flipCar(carId: number): boolean {
    const found = this.findCar(carId);
    if (!found) return false;
    const car = found.train.cars[found.index];
    car.facing = car.facing === 1 ? -1 : 1;
    found.train.turnback = -1;
    return true;
  }

  /**
   * Swap ends: the engine runs round its train to the other end and faces the new way, the wagons staying just where
   * they are on the track (as at the end of a real line), so it leads the other way instead of pushing. An engine on
   * its own, one in the middle of a train, or a train with an engine at each end just turns round. Only while the
   * train's stopped; refused where there's no room for the engine at the other end (a buffer, the end of the track,
   * another train). The train keeps its id (a depot working it carries on).
   */
  runAround(engineCarId: number): "ran-round" | "turned" | "moving" | "no-room" | "none" {
    const found = this.findCar(engineCarId);
    if (!found || found.train.derailed) return "none";
    const t = found.train;
    // Riding a turning deck: it's moving.
    if (this.rides.size > 0 && this.riding(t)) return "moving";
    const n = t.cars.length;
    const i = found.index;
    const engine = t.cars[i];
    const atFront = i === 0;
    const atRear = i === n - 1;
    if (n === 1 || !(atFront || atRear) || t.cars[atFront ? n - 1 : 0].kind === "engine") {
      // Nothing to run round: turn it (moving or not, as ever), and the train goes the other way (led by its other
      // engine, if it has one).
      this.flipCar(engineCarId);
      return "turned";
    }
    if (t.speed > 0) return "moving";
    const cars = atFront ? [...t.cars.slice(1), engine] : [engine, ...t.cars.slice(0, n - 1)];
    const offsets = bogieOffsets(cars.map((c) => c.kind));
    // The new front axle: the first wagon's (staying put) when the engine goes to the back; ahead of it by the
    // engine's length when the engine comes to the front.
    const at: Cursor = { ...t.bogies[atFront ? 2 : 0] };
    if (!atFront) {
      advanceCursor(this.layout, at, offsets[2], null, adv);
      if (adv.status !== ADV_OK) return "no-room";
    }
    const bogies: Cursor[] = [];
    for (const off of offsets) {
      const c = { ...at };
      flipCursor(this.layout, c);
      advanceCursor(this.layout, c, off, null, adv);
      if (adv.status !== ADV_OK) return "no-room";
      flipCursor(this.layout, c);
      bogies.push(c);
    }
    this.trains.delete(t.id);
    const blocked = this.occupied(bogies);
    this.trains.set(t.id, t);
    if (blocked) return "no-room";
    // Facing out from its new end, so it leads.
    engine.facing = atFront ? -1 : 1;
    engine.lever = 0;
    t.cars = cars;
    t.bogies = bogies;
    t.world = bogies.map(() => createWorldSample());
    t.memory = new Map();
    t.turnback = -1;
    this.rememberStraddledSwitches(t);
    this.refreshWorld(t);
    return "ran-round";
  }

  /**
   * Uncouple a car from its neighbour on the engine's side. An engine comes away from its cars (or, in the middle of
   * a train, keeps the ones in front of it). The part with an engine keeps the train's id; the other part becomes a
   * new train, set back a few mm so the gap shows. Only while the train's stopped. Neither part is moving, so they
   * stay apart until an engine drives them together again.
   */
  decouple(carId: number): { kind: "decoupled"; trainId: number } | { kind: "moving" } | { kind: "alone" } | { kind: "none" } {
    const found = this.findCar(carId);
    if (!found || found.train.derailed) return { kind: "none" };
    const t = found.train;
    // Riding a turning deck: it's moving.
    if (this.rides.size > 0 && this.riding(t)) return { kind: "moving" };
    const n = t.cars.length;
    const i = found.index;
    let k: number;
    if (t.cars[i].kind === "engine") {
      k = i === 0 ? 1 : i === n - 1 ? n - 1 : i + 1;
    } else {
      // The nearest engine decides which side is "the engine's side" (the front, if there's none).
      let e = -1;
      for (let j = 0; j < n; j++) {
        if (t.cars[j].kind === "engine" && (e < 0 || Math.abs(j - i) < Math.abs(e - i))) e = j;
      }
      k = e > i ? i + 1 : i;
    }
    if (k <= 0 || k >= n) return { kind: "alone" };
    if (t.speed > 0) return { kind: "moving" };
    const frontHas = t.cars.slice(0, k).some((c) => c.kind === "engine");
    const rearHas = t.cars.slice(k).some((c) => c.kind === "engine");
    const frontKeeps = frontHas || rearHas ? frontHas : i < k;
    const carsA = t.cars.slice(0, k);
    const carsB = t.cars.slice(k);
    const bogiesA = t.bogies.slice(0, 2 * k);
    const bogiesB = t.bogies.slice(2 * k);
    const part: Train = {
      id: this.nextTrainId++,
      turnback: -1,
      cars: frontKeeps ? carsB : carsA,
      bogies: frontKeeps ? bogiesB : bogiesA,
      speed: 0,
      derailed: false,
      memory: new Map(t.memory),
      world: (frontKeeps ? bogiesB : bogiesA).map(() => createWorldSample()),
    };
    t.cars = frontKeeps ? carsA : carsB;
    t.bogies = frontKeeps ? bogiesA : bogiesB;
    t.world = t.bogies.map(() => createWorldSample());
    t.speed = 0;
    t.turnback = -1;
    this.refreshWorld(t);
    // Set the part that went away from the other one: back if it's the rear part, forward if it's the front.
    const moved: Cursor[] = [];
    for (const b of part.bogies) {
      const c = { ...b };
      if (frontKeeps) flipCursor(this.layout, c);
      advanceCursor(this.layout, c, DECOUPLE_GAP, null, adv);
      if (adv.status !== ADV_OK) break;
      if (frontKeeps) flipCursor(this.layout, c);
      moved.push(c);
    }
    if (moved.length === part.bogies.length) {
      this.trains.delete(t.id);
      const blocked = this.occupied(moved);
      this.trains.set(t.id, t);
      if (!blocked) part.bogies = moved;
    }
    this.trains.set(part.id, part);
    this.rememberStraddledSwitches(t);
    this.rememberStraddledSwitches(part);
    this.refreshWorld(part);
    return { kind: "decoupled", trainId: part.id };
  }

  /**
   * Call after the layout changes: trains on removed or lifted pieces derail, as do trains on any piece in
   * `moved` (rotated, moved or flipped out from under them).
   */
  trackChanged(moved: readonly number[] = []): void {
    // Signals are found again (their aspects worked out on the next tick).
    this.signals = null;
    this.lifts = null;
    for (const train of this.trains.values()) {
      if (train.derailed) continue;
      for (const b of train.bogies) {
        if (!this.layout.getPiece(b.pieceId) || this.layout.isLifted(b.pieceId) || moved.includes(b.pieceId)) {
          this.derail(train);
          break;
        }
      }
    }
  }

  /**
   * Is any (railed) train on this piece? Under a car counts, not only under a wheel: a short piece between a car's
   * two bogies, or between two cars, is as taken as one a bogie stands on (see `coveredBy`).
   */
  pieceOccupied(pieceId: number): boolean {
    for (const t of this.trains.values()) if (!t.derailed && this.coveredBy(t).pieces.has(pieceId)) return true;
    return false;
  }

  /** The pieces under a train's cars, end to end (empty for one off the rails or not there). */
  piecesUnder(trainId: number): ReadonlySet<number> {
    const t = this.trains.get(trainId);
    return t && !t.derailed ? this.coveredBy(t).pieces : EMPTY_PIECES;
  }

  /** Per train: the pieces under its cars, and where its end axles were when worked out (see `coveredBy`). */
  private readonly covers = new Map<number, Cover>();

  /**
   * The pieces under a train, from its last axle to its first: its axles' pieces and those walked along the track
   * between (piece to piece), under its cars and their couplings. Not past its end axles: a switch just ahead under
   * the front's overhang is still its to throw. Worked out again only when an axle has come onto another piece, or
   * the train changed.
   */
  private coveredBy(train: Train): Cover {
    const b = train.bogies;
    const last = b[b.length - 1];
    // (Between two axles on given pieces the track between is given too: worked out again only when an axle has come
    // onto another piece, not as it rolls along one.)
    const hit = this.covers.get(train.id);
    const L = this.layout;
    if (hit && hit.bogies === b && hit.at.length === b.length && hit.track === L.revision && hit.joints === L.jointsVersion && hit.switches === L.switchesVersion) {
      let same = true;
      for (let i = 0; i < b.length && same; i++) if (hit.at[i] !== b[i].pieceId * 8 + b[i].pathIndex) same = false;
      if (same) return hit;
    }
    const pieces = new Set<number>();
    for (const x of b) pieces.add(x.pieceId);
    if (b.length > 0) {
      // (Piece to piece: to the end of the one it's on, just over onto the next, while the distance lasts.)
      const walk = (from: Cursor, dist: number) => {
        const c = { ...from };
        for (let done = 0, k = 0; k < 64; k++) {
          const piece = this.layout.getPiece(c.pieceId);
          if (!piece) break;
          const rest = pathLength(getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom) - c.s;
          if (done + rest >= dist) break;
          advanceCursor(this.layout, c, rest + COVER_OVER, null, coverAdv);
          if (coverAdv.status !== ADV_OK || coverAdv.moved === 0) break;
          done += coverAdv.moved;
          pieces.add(c.pieceId);
        }
      };
      // (Last axle to first: the cars' lengths and the gaps between, less the first's and last's overhangs.)
      let span = (train.cars.length - 1) * COUPLER_GAP - CAR_SPECS[train.cars[0].kind].bogieInset - CAR_SPECS[train.cars[train.cars.length - 1].kind].bogieInset;
      for (const car of train.cars) span += CAR_SPECS[car.kind].length;
      walk(last, span);
    }
    const cover: Cover = { bogies: b, at: b.map((x) => x.pieceId * 8 + x.pathIndex), track: L.revision, joints: L.jointsVersion, switches: L.switchesVersion, pieces };
    if (this.covers.size > this.trains.size + 8) for (const id of this.covers.keys()) if (!this.trains.has(id)) this.covers.delete(id);
    this.covers.set(train.id, cover);
    return cover;
  }

  /** Fresh car ids, for cars about to be put on the track (so anything shown for them beforehand can match). */
  newCarIds(count: number): number[] {
    const ids: number[] = [];
    for (let i = 0; i < count; i++) ids.push(this.nextCarId++);
    return ids;
  }

  /** Put a (derailed) train back on the nearest track, motor off. Returns the new train id, or -1 if there is no room. */
  rerail(trainId: number, maxDistance = 150, near?: { x: number; z: number }): number {
    const train = this.trains.get(trainId);
    if (!train) return -1;
    const lead = train.world[0];
    const at = near ?? lead;
    const kinds = train.cars.map((c) => c.kind);
    const ids = train.cars.map((c) => c.id);
    for (const heading of [lead.heading, lead.heading + Math.PI]) {
      const near = nearestCursor(this.layout, at.x, at.z, maxDistance, heading);
      if (!near) return -1;
      this.trains.delete(trainId);
      // Where it lies, or slid along the track either way to the nearest stretch that's free (another train may be
      // lying where it came off).
      for (let d = 0; d <= RERAIL_SLIDE; d += RERAIL_STEP) {
        for (const way of d === 0 ? [1] : [1, -1]) {
          const c = { ...near.cursor };
          if (d > 0) {
            if (way === -1) flipCursor(this.layout, c);
            if (advanceCursor(this.layout, c, d, null, adv).status !== ADV_OK) continue;
            if (way === -1) flipCursor(this.layout, c);
          }
          const placed = this.addTrainAround(kinds, c, ids);
          if (placed.kind === "placed") return placed.trainId;
        }
      }
      this.trains.set(trainId, train);
    }
    return -1;
  }

  /**
   * Step a switch to its next route (two-way switches flip; a three-way steps round its three; a turntable's deck turns
   * to its next road). False if it can't: a deck doesn't turn with a train on it, and points don't move under one.
   * `corner`: which of a wye's levers (one at each end: `PieceDef.cornerLevers`, its bit of the state).
   */
  toggleSwitch(pieceId: number, corner = 0): boolean {
    const piece = this.layout.getPiece(pieceId);
    const def = piece ? getPieceDef(piece.type, piece.flipped) : null;
    // A signal piece's lever holds its (first) signal at red, or lets it go.
    if (def?.signal) {
      this.toggleSignal(pieceId, 0);
      return true;
    }
    if (this.pointsHeld(pieceId)) return false;
    if (def?.gated && this.deckRefusal(pieceId)) return false;
    // A lift sends its platform to its other end, with any train standing on it.
    if (def?.lift) return this.carry(pieceId, (this.layout.switchState(pieceId) + 1) % def.paths.length, def.lift.seconds) !== null;
    if (def?.cornerLevers) {
      this.layout.setSwitchState(pieceId, this.layout.switchState(pieceId) ^ (1 << corner));
      this.updateSignals();
      return true;
    }
    const routes = !def ? 2 : def.gated ? def.paths.length : def.paths.filter((p) => p.from === 0).length;
    const was = this.layout.switchState(pieceId);
    this.layout.setSwitchState(pieceId, (was + 1) % Math.max(2, routes));
    // A deck joins nothing till it's turned to its next road, and carries round any train standing on it.
    if (def?.gated) {
      this.layout.setDeckTurning(pieceId, true);
      const done = this.ticks + Math.round(DECK_GLIDE_S * SIM_HZ);
      this.decksTurning.set(pieceId, done);
      this.startRide(pieceId, was % def.paths.length, this.layout.switchState(pieceId), done);
    }
    // A signal held or let go shows it at once (even paused).
    this.updateSignals();
    return true;
  }

  /**
   * Are these points held by a train on or over them (any car, `piecesUnder`)? Then they can't be thrown: the cars still
   * to come onto them would take the other road (a wye's or a crossover's choice from a branch isn't remembered), and the
   * train would split. Decks, lifts and signals aren't points.
   */
  pointsHeld(pieceId: number): boolean {
    const piece = this.layout.getPiece(pieceId);
    const def = piece && getPieceDef(piece.type, piece.flipped);
    return !!def?.isSwitch && !def.gated && !def.signal && this.pieceOccupied(pieceId);
  }

  /**
   * Why a deck (a turntable's) can't turn now: a train partly on it (it would be torn apart), or one on it that's
   * moving or waiting to turn back, or it's still carrying one round. Null if it can: empty, or carrying trains
   * standing wholly on it (they turn with it: an engine turned round).
   */
  deckRefusal(pieceId: number): DeckRefusal | null {
    // (Points: see `pointsHeld`. Signals are thrown whatever stands on them.)
    const piece = this.layout.getPiece(pieceId);
    const def = piece && getPieceDef(piece.type, piece.flipped);
    if (!def?.gated) return null;
    if (this.rides.has(pieceId) || (def.lift && this.layout.deckTurning(pieceId))) return "turning";
    for (const t of this.trains.values()) {
      if (t.derailed) continue;
      let on = 0;
      for (const b of t.bogies) if (b.pieceId === pieceId) on++;
      if (on === 0) continue;
      if (on < t.bogies.length) return "partly";
      if (t.speed > 0 || t.turnback >= 0) return "moving";
    }
    // A lift waits for a train coming in to its open end (it would run off the end of the line).
    if (def.lift && this.approaching(pieceId)) return "approaching";
    return null;
  }

  /** Ticks run so far (for how long ago something happened). */
  ticks = 0;

  /** Decks turning (see `toggleSwitch`): the tick each is at its next road. */
  private readonly decksTurning = new Map<number, number>();

  /**
   * Trains riding a turning deck, by deck: held still, set on the deck's new road at once (their axles), but drawn
   * carried round from where they stood (`world`), over the deck's glide: a turn by `angle` about (cx, cz), or a slide
   * by (dx, dz) where the deck slides.
   */
  private readonly rides = new Map<
    number,
    { trainIds: number[]; from: WorldSample[][]; angle: number; cx: number; cz: number; dx: number; dz: number; dy: number; start: number; done: number }
  >();

  /**
   * A deck turned from road `from` to `to`: the trains standing on it go with it. Each axle goes to the same place on
   * the new road (its start is the old one's turned or slid there); on a turntable turned past half round the new road
   * points the other way, so the train runs along it the other way.
   */
  private startRide(pieceId: number, from: number, to: number, done: number): void {
    const piece = this.layout.getPiece(pieceId)!;
    const def = getPieceDef(piece.type, piece.flipped);
    const riders = [...this.trains.values()].filter((t) => !t.derailed && t.bogies.length > 0 && t.bogies.every((b) => b.pieceId === pieceId));
    if (riders.length === 0 || from === to) return;
    const a = def.paths[from].geom;
    const b = def.paths[to].geom;
    if (a.kind !== "line" || b.kind !== "line") return;
    // The old road's start, turned onto the new road's: by the angle between them, or half round more if that's
    // nearer (then the new road runs the other way).
    let angle = normalizeAngle(b.start.heading - a.start.heading);
    const flip = Math.abs(angle) > Math.PI / 2;
    if (flip) angle = normalizeAngle(angle + Math.PI);
    const from0 = riders.map((t) => t.world.map((w) => ({ ...w })));
    for (const t of riders) {
      for (const c of t.bogies) {
        c.pathIndex = to;
        // (A cursor's `s` is from where it starts travelling: the same distance from the turned start, on the new
        // road run the other way.)
        if (flip) c.reversed = !c.reversed;
      }
      t.memory.clear();
      this.refreshWorld(t);
    }
    // The move as the world sees it: one axle from where it stood to where it is now gives the turn's centre (or, no
    // turn, the slide).
    const p = from0[0][0];
    const q = riders[0].world[0];
    const ch = Math.cos(angle);
    const sh = Math.sin(angle);
    let cx = 0;
    let cz = 0;
    if (Math.abs(angle) > 1e-9) {
      // q − c = R(p − c): c = (I − R)⁻¹ (q − R p).
      const rx = q.x - (ch * p.x - sh * p.z);
      const rz = q.z - (sh * p.x + ch * p.z);
      const m00 = 1 - ch;
      const m01 = sh;
      const m10 = -sh;
      const m11 = 1 - ch;
      const det = m00 * m11 - m01 * m10;
      cx = (m11 * rx - m01 * rz) / det;
      cz = (-m10 * rx + m00 * rz) / det;
    }
    this.rides.set(pieceId, { trainIds: riders.map((t) => t.id), from: from0, angle, cx, cz, dx: q.x - p.x, dz: q.z - p.z, dy: 0, start: this.ticks, done });
    for (let i = 0; i < riders.length; i++) this.drawCarried(riders[i], from0[i], 0, angle, cx, cz, q.x - p.x, q.z - p.z, 0);
  }

  /** A riding train drawn `e` (0 to 1) of the way round (or across, or up) from where it stood. */
  private drawCarried(t: Train, from: readonly WorldSample[], e: number, angle: number, cx: number, cz: number, dx: number, dz: number, dy: number): void {
    const turn = Math.abs(angle) > 1e-9;
    const ch = Math.cos(angle * e);
    const sh = Math.sin(angle * e);
    for (let i = 0; i < t.world.length && i < from.length; i++) {
      const f = from[i];
      const w = t.world[i];
      if (turn) {
        w.x = cx + ch * (f.x - cx) - sh * (f.z - cz);
        w.z = cz + sh * (f.x - cx) + ch * (f.z - cz);
        w.heading = normalizeAngle(f.heading + angle * e);
      } else {
        w.x = f.x + dx * e;
        w.z = f.z + dz * e;
        w.heading = f.heading;
      }
      w.y = f.y + dy * e;
      w.slope = f.slope;
    }
  }

  /** Riding trains carried on with their decks; a ride over, they're drawn where they now stand. */
  private updateRides(): void {
    this.ridesVersion++;
    for (const [id, r] of this.rides) {
      const over = this.ticks >= r.done;
      const u = over ? 1 : (this.ticks - r.start) / (r.done - r.start);
      const e = u * u * (3 - 2 * u);
      r.trainIds.forEach((tid, i) => {
        const t = this.trains.get(tid);
        // (One that came off the rails meanwhile, a deck picked up under it, lies where it fell.)
        if (!t || t.derailed) return;
        if (over) this.refreshWorld(t);
        else this.drawCarried(t, r.from[i], e, r.angle, r.cx, r.cz, r.dx, r.dz, r.dy);
      });
      if (over) this.rides.delete(id);
    }
  }

  /** Is a train standing on this deck (one it would carry round if it turned)? */
  /**
   * The deck (a turntable's: a gated piece) the train with this car stands still wholly on, or -1: moving or waiting to
   * turn back, partly on, derailed, or on ordinary track. (A tap there is the deck's: see `Interaction.pick`.)
   */
  deckUnder(carId: number): number {
    const found = this.findCar(carId);
    if (!found) return -1;
    const t = found.train;
    if (t.derailed || t.speed > 0 || t.turnback >= 0 || t.bogies.length === 0) return -1;
    const pieceId = t.bogies[0].pieceId;
    if (t.bogies.some((b) => b.pieceId !== pieceId)) return -1;
    const piece = this.layout.getPiece(pieceId);
    return piece && getPieceDef(piece.type, piece.flipped).gated ? pieceId : -1;
  }

  deckCarries(pieceId: number): boolean {
    for (const t of this.trains.values()) if (!t.derailed && t.bogies.some((b) => b.pieceId === pieceId)) return true;
    return false;
  }

  /** Is this train riding a turning deck (held still)? */
  private riding(train: Train): boolean {
    for (const r of this.rides.values()) if (r.trainIds.includes(train.id)) return true;
    return false;
  }

  // ---- lifts (a train lift: `PieceDef.lift`) ------------------------------------------------------------------

  /** Goes up on every tick a deck or lift is carrying (or moving empty), so its moving parts are redrawn only then. */
  ridesVersion = 0;
  /** The lifts on the layout (found again after the track changes), or null till then. */
  private lifts: number[] | null = null;
  /** Ticks each lift's been ready to go (a train halted on it, or one waiting at its far end): its dwell. */
  private readonly liftWaits = new Map<number, number>();
  /** Lifts a train is waiting at the far (closed) end of this tick: they come for it once empty. */
  private readonly liftCalls = new Set<number>();
  /** Trains told they're too long for a lift (once each time they come onto one). */
  private readonly liftRefused = new Set<number>();

  /**
   * The new move: carry the trains standing wholly on a deck from the road it lies on (end A) to road `to` (end B)
   * over `seconds`. Each axle goes at once to the same spot on the new road (straight roads: the spot across, or above,
   * from where it stood), running the same way, so a train driving in drives on out at the far end with its lever
   * left on; the trains are drawn carried there over the time (`ridesVersion`), held still, nothing coupling to them.
   * The deck joins nothing meanwhile (`Layout.deckTurning`: the far end holds trains like a red signal). It moves only
   * as the sim ticks, so paused, a ride holds where it is. A lift's tap, and its own ride once a train's halted on it,
   * come here. The riders' ids, or null if it can't (`deckRefusal`, or not straight roads).
   */
  carry(pieceId: number, to: number, seconds: number): number[] | null {
    const piece = this.layout.getPiece(pieceId);
    const def = piece && getPieceDef(piece.type, piece.flipped);
    if (!def?.gated || this.deckRefusal(pieceId)) return null;
    const from = this.layout.switchState(pieceId) % def.paths.length;
    const a = def.paths[from]?.geom;
    const b = def.paths[to]?.geom;
    if (from === to || a?.kind !== "line" || b?.kind !== "line") return null;
    const done = this.ticks + Math.max(1, Math.round(seconds * SIM_HZ));
    this.layout.setSwitchState(pieceId, to);
    this.layout.setDeckTurning(pieceId, true);
    this.decksTurning.set(pieceId, done);
    const riders = [...this.trains.values()].filter((t) => !t.derailed && t.bogies.length > 0 && t.bogies.every((c) => c.pieceId === pieceId));
    const from0 = riders.map((t) => t.world.map((w) => ({ ...w })));
    const lenA = a.length;
    const lenB = b.length;
    const bh = b.start.heading;
    for (const t of riders) {
      for (const c of t.bogies) {
        // Where it stands in the piece, and which way it runs; then the same on the new road.
        const u = c.reversed ? lenA - c.s : c.s;
        const px = a.start.x + u * Math.cos(a.start.heading);
        const pz = a.start.z + u * Math.sin(a.start.heading);
        const way = a.start.heading + (c.reversed ? Math.PI : 0);
        const ub = Math.min(lenB, Math.max(0, (px - b.start.x) * Math.cos(bh) + (pz - b.start.z) * Math.sin(bh)));
        c.pathIndex = to;
        c.reversed = Math.cos(way - bh) < 0;
        c.s = c.reversed ? lenB - ub : ub;
      }
      t.memory.clear();
      this.refreshWorld(t);
    }
    // The move as the world sees it (one axle from where it stood to where it is now; empty, the roads' own).
    const p = from0[0]?.[0];
    const q = riders[0]?.world[0];
    const dx = p && q ? q.x - p.x : 0;
    const dz = p && q ? q.z - p.z : 0;
    const dy = p && q ? q.y - p.y : b.y0 - a.y0;
    this.rides.set(pieceId, { trainIds: riders.map((t) => t.id), from: from0, angle: 0, cx: 0, cz: 0, dx, dz, dy, start: this.ticks, done });
    for (let i = 0; i < riders.length; i++) this.drawCarried(riders[i], from0[i], 0, 0, 0, 0, dx, dz, dy);
    this.updateSignals();
    return riders.map((t) => t.id);
  }

  /**
   * Where a lift's platform stands: 0 at its first end (path 0), 1 at its second, between while it's carrying (eased,
   * as its riders are drawn). Its switch state for any other piece.
   */
  liftPosition(pieceId: number): number {
    const piece = this.layout.getPiece(pieceId);
    const def = piece && getPieceDef(piece.type, piece.flipped);
    if (!def) return 0;
    const at = this.layout.switchState(pieceId) % Math.max(1, def.paths.length);
    const r = this.rides.get(pieceId);
    if (!r || !def.lift) return at;
    const u = Math.min(1, Math.max(0, (this.ticks - r.start) / (r.done - r.start)));
    const e = u * u * (3 - 2 * u);
    return 1 - at + (2 * at - 1) * e;
  }

  private readonly ridingOut: number[] = [];

  /**
   * The lifts riding now (carrying a train, or going empty), for their sound: none (a comparison) while nothing rides.
   * The list is reused: read it before the next call.
   */
  ridingLifts(): readonly number[] {
    this.ridingOut.length = 0;
    if (this.rides.size === 0) return this.ridingOut;
    for (const id of this.rides.keys()) if (this.liftDef(id)) this.ridingOut.push(id);
    return this.ridingOut;
  }

  /**
   * May this lift be taken up, moved, turned or flipped now? Not while it's carrying a train or going (it would leave
   * the train in mid-air), nor with a train on it: false then. True for any other piece.
   */
  liftFree(pieceId: number): boolean {
    if (!this.liftDef(pieceId)) return true;
    return !this.rides.has(pieceId) && !this.layout.deckTurning(pieceId) && !this.pieceOccupied(pieceId);
  }

  /** The lifts that mustn't be taken up or moved now (`liftFree`): none, at once, on a layout without a lift. */
  heldLifts(): number[] {
    if (this.lifts !== null && this.lifts.length === 0) return [];
    const out: number[] = [];
    for (const id of this.lifts ?? this.layout.pieceIds()) if (this.liftDef(id) && !this.liftFree(id)) out.push(id);
    return out;
  }

  /** A train at a lift, for its engine's card: being carried, waiting at it (held at its far end, or on it), or null. */
  liftState(trainId: number): "riding" | "waiting" | null {
    const t = this.trains.get(trainId);
    if (!t || t.derailed || !this.lifts || this.lifts.length === 0) return null;
    for (const [id, r] of this.rides) if (r.trainIds.includes(t.id) && this.liftDef(id)) return "riding";
    return t.speed < 1 && drive(t) !== 0 && this.liftCap(t, false) === 0 ? "waiting" : null;
  }

  /** A lift piece's def, or undefined. */
  private liftDef(pieceId: number): PieceDef | undefined {
    const p = this.layout.getPiece(pieceId);
    const def = p && getPieceDef(p.type, p.flipped);
    return def?.lift ? def : undefined;
  }

  /**
   * How fast a train may go for the lifts: on a platform, coming in, to halt with its front just short of its end (if
   * it fits: else it runs on to the end and turns back, told so once); coming up to a lift's end that's closed (its
   * platform away or moving) or busy (another train on it), to halt with its front face at the joint, as at a red
   * signal (and, standing there, it calls the platform: `record`). Infinity otherwise.
   */
  private liftCap(train: Train, record: boolean): number {
    const lead = train.bogies[0];
    const def = this.liftDef(lead.pieceId);
    if (def) {
      // Heading out (carried, or turned back at the end): away it goes.
      if (lead.reversed) return Infinity;
      const len = pathLength(def.paths[lead.pathIndex].geom);
      if (trainLength(train) > len - 2 * LIFT_FACE_GAP) {
        if (record && !this.liftRefused.has(train.id)) {
          this.liftRefused.add(train.id);
          this.events.push({ kind: "lift-refused", trainId: train.id, pieceId: lead.pieceId, carIds: train.cars.map((c) => c.id) });
        }
        return Infinity;
      }
      return brakeTo(len - LIFT_FACE_GAP - CAR_SPECS[train.cars[0].kind].bogieInset - lead.s);
    }
    if (record && this.liftRefused.size > 0) this.liftRefused.delete(train.id);
    const inset = CAR_SPECS[train.cars[0].kind].bogieInset;
    const v = train.speed;
    const look = (v * v) / (2 * ACCELERATION) + 2 * v * SIM_DT + LIFT_LOOK + inset;
    const c: Cursor = { ...lead };
    advanceCursor(this.layout, c, look, null, lookAdv);
    let liftId = -1;
    let dist = 0;
    let on: Train | null = null;
    if (lookAdv.status === ADV_OPEN_END) {
      // The end it runs to: a lift's, closed?
      const p = this.layout.getPiece(c.pieceId)!;
      const exit = pathExitConnector(getPieceDef(p.type, p.flipped), c.pathIndex, c.reversed);
      const joined = exit < 0 ? -1 : this.layout.joinedConnector(connectorRef(c.pieceId, exit));
      if (joined === -1 || !this.liftDef(pieceOfRef(joined))) return Infinity;
      liftId = pieceOfRef(joined);
      dist = lookAdv.moved;
    } else if (c.pieceId !== lead.pieceId && this.liftDef(c.pieceId) && (on = this.liftUser(c.pieceId, train))) {
      liftId = c.pieceId;
      dist = lookAdv.moved - c.s;
    } else return Infinity;
    const room = dist - inset - LIFT_FACE_GAP;
    if (record && v < 1 && room < 1) {
      this.liftCalls.add(liftId);
      // (Another train on the lift: it waits for that one, however long, saying who for.)
      if (on) this.holdBy(train, on, "follow");
    }
    return brakeTo(room);
  }

  /** Is this train coming off a lift: on its platform, or off it within the last `LIFT_GRACE` ticks? */
  private comingOffLift(t: Train): boolean {
    if (!this.lifts || this.lifts.length === 0) return false;
    if (this.onLift(t)) return true;
    const off = this.offLift.get(t.id);
    return off !== undefined && this.ticks - off < LIFT_GRACE;
  }

  /** When each train was last on a lift (`Sim.ticks`), for `comingOffLift`: kept a moment, then forgotten. */
  private readonly offLift = new Map<number, number>();
  /**
   * Who's on the way onto each piece where paths meet, by the path it'll take (`pieceId * MAX_PATHS + path`): the train,
   * and the tick it said so (good that tick and the next). See `crossCap`.
   */
  private readonly crossClaims = new Map<number, { trainId: number; tick: number }>();
  /**
   * Trains held where they stand by another train (`heldBy`): short of a piece where paths meet that it's on or coming
   * onto (`crossCap`), close behind it or nose to nose with it (`followCap`), or against its side; and the tick it was
   * last so (good that tick and the next).
   */
  private readonly held = new Map<number, { by: number; how: HeldHow; tick: number }>();

  /**
   * The train (its id) holding this one where it stands, this tick or the last: one it waits for short of a crossing or
   * switch, one it's close behind, or one it has met nose to nose; null if none. Nothing turns it back: it waits as long
   * as that train stays (routing spec §16 Q3), and wait chains (economy/stalls.ts) see who for.
   */
  heldBy(trainId: number): number | null {
    const h = this.held.get(trainId);
    return h && h.tick >= this.ticks - 1 && this.trains.has(h.by) ? h.by : null;
  }

  /** How `heldBy`'s train holds this one (null: none does). */
  heldHow(trainId: number): HeldHow | null {
    const h = this.held.get(trainId);
    return h && h.tick >= this.ticks - 1 && this.trains.has(h.by) ? h.how : null;
  }

  private holdBy(train: Train, by: Train, how: HeldHow): void {
    const h = this.held.get(train.id);
    if (h) {
      h.by = by.id;
      h.how = how;
      h.tick = this.ticks;
      return;
    }
    this.held.set(train.id, { by: by.id, how, tick: this.ticks });
    // (Trains come and go, and turn round as new ones: what's said of gone ones goes.)
    if (this.held.size > 4 * this.trains.size) for (const [id, x] of this.held) if (!this.trains.has(id) || x.tick < this.ticks - 1) this.held.delete(id);
  }

  /** Is any of this train on a lift's platform? */
  private onLift(t: Train): boolean {
    if (!this.lifts || this.lifts.length === 0) return false;
    for (const b of t.bogies) if (this.liftDef(b.pieceId)) return true;
    return false;
  }

  /** A train other than `me` on this lift, or null. */
  private liftUser(pieceId: number, me: Train): Train | null {
    for (const t of this.trains.values()) {
      if (t === me || t.derailed) continue;
      for (const b of t.bogies) if (b.pieceId === pieceId) return t;
    }
    return null;
  }

  /**
   * Is a train coming in to this lift within its braking distance (and a margin), so that if the lift went now it
   * would run up to the end it closes? Trains on it are looked at by the caller.
   */
  private approaching(pieceId: number): boolean {
    for (const t of this.trains.values()) {
      if (t.derailed || t.bogies.length === 0 || t.bogies.some((b) => b.pieceId === pieceId)) continue;
      const net = drive(t);
      if (t.speed === 0 && net === 0) continue;
      // Standing, held at a lift's end (waiting behind the train it's carrying) or at a red signal: it isn't coming.
      if (t.speed === 0 && (this.liftCap(t, false) === 0 || this.signalCap(t) === 0)) continue;
      // Standing, about to set off backwards: its back leads.
      const back = t.speed === 0 && net < 0;
      const c: Cursor = { ...(back ? t.bogies[t.bogies.length - 1] : t.bogies[0]) };
      if (back) flipCursor(this.layout, c);
      const inset = CAR_SPECS[t.cars[back ? t.cars.length - 1 : 0].kind].bogieInset;
      advanceCursor(this.layout, c, (t.speed * t.speed) / (2 * ACCELERATION) + LIFT_LOOK + inset, null, lookAdv);
      if (c.pieceId === pieceId) return true;
    }
    return false;
  }

  /**
   * Each lift, once a tick: a train halted on its platform (its lever on), or one waiting at its far end while it
   * stands empty, makes it ready; ready for `LIFT_DWELL` ticks, and no train coming in, it goes (`carry`).
   */
  private updateLifts(): void {
    if (this.lifts === null) {
      this.lifts = [];
      for (const id of this.layout.pieceIds()) if (this.liftDef(id)) this.lifts.push(id);
      for (const id of this.liftWaits.keys()) if (!this.lifts.includes(id)) this.liftWaits.delete(id);
    }
    for (const id of this.liftRefused) if (!this.trains.has(id)) this.liftRefused.delete(id);
    for (const id of this.lifts) {
      const def = this.liftDef(id);
      if (!def || this.layout.isLifted(id) || this.rides.has(id)) {
        this.liftWaits.delete(id);
        continue;
      }
      const at = this.layout.switchState(id) % def.paths.length;
      let partly = false;
      let ridersReady = true;
      let riders = 0;
      let halted = false;
      for (const t of this.trains.values()) {
        if (t.derailed) continue;
        let on = 0;
        for (const b of t.bogies) if (b.pieceId === id) on++;
        if (on === 0) continue;
        if (on < t.bogies.length) partly = true;
        riders++;
        if (t.speed !== 0 || t.turnback >= 0) ridersReady = false;
        const lead = t.bogies[0];
        if (drive(t) !== 0 && !lead.reversed && lead.pathIndex === at && this.liftCap(t, false) === 0) halted = true;
      }
      const ready = !partly && (riders > 0 ? ridersReady && halted : this.liftCalls.has(id));
      if (!ready) {
        this.liftWaits.delete(id);
        continue;
      }
      const n = (this.liftWaits.get(id) ?? 0) + 1;
      this.liftWaits.set(id, n);
      if (n < LIFT_DWELL || this.approaching(id)) continue;
      this.liftWaits.delete(id);
      this.carry(id, (at + 1) % def.paths.length, def.lift!.seconds);
    }
    this.liftCalls.clear();
  }

  tick(): void {
    this.ticks++;
    if (this.rides.size > 0) this.updateRides();
    if (this.lifts === null || this.lifts.length > 0) {
      this.updateLifts();
      // (Who's on a lift now, for `comingOffLift`; those long off it forgotten.)
      for (const t of this.trains.values()) if (!t.derailed && this.onLift(t)) this.offLift.set(t.id, this.ticks);
      for (const [id, at] of this.offLift) if (this.ticks - at >= LIFT_GRACE || !this.trains.has(id)) this.offLift.delete(id);
    }
    if (this.decksTurning.size > 0) {
      for (const [id, done] of this.decksTurning)
        if (done <= this.ticks) {
          this.layout.setDeckTurning(id, false);
          this.decksTurning.delete(id);
        }
    }
    this.updateSignals();
    for (const train of this.trains.values()) {
      if (train.derailed) continue;
      // Riding a turning deck: held where it stands till the deck's there.
      if (this.rides.size > 0 && this.riding(train)) continue;
      // Waiting at the end of the line beside a crane with work for it (a depot at the line's end): the wait holds
      // until the crane's done (it's asked each tick, as when moving, so it can see the train has stopped).
      const craneHolds = train.turnback >= 0 && this.speedCap !== null && this.speedCap(train) === 0;
      if (train.turnback >= 0 && !craneHolds && --train.turnback < 0) {
        // Waited long enough at the end of the line: lift the train and turn it round, so it heads back out the way
        // it came, its engine leading as before.
        const turned = this.turnAround(train);
        if (turned) {
          turned.lastTurn = train.lastTurn;
          this.events.push({ kind: "turned", trainId: train.id, newTrainId: turned.id });
          continue; // moves from next tick, as a new train
        }
        // No room to set it down turned round: just send it back.
        for (const car of train.cars) if (car.kind === "engine") car.lever = (-car.lever) as -1 | 0 | 1;
      }
      // Waiting to turn back, it stands still (not pressing on into a buffer or a train it met).
      if (train.turnback >= 0) continue;
      this.move(train);
    }
    this.resolveContacts();
  }

  // ---- signals: block working -----------------------------------------------------------------------------

  /**
   * Is this signal at clear (true), or red (false)? `road`: which of a signal piece's paths it guards (a gantry has one
   * on each of its roads; a plain signal just the one). A signal not yet worked out shows clear.
   */
  signalClear(pieceId: number, road = 0): boolean {
    return this.aspects.get(signalKey(pieceId, road)) ?? true;
  }

  /**
   * A signal piece's aspects as one number: a bit for each of its roads at red (road 0's is 1), so 0 when all are clear
   * (a signal skin's model shows it: `KitStateMotion.source`). 0 for any other piece.
   */
  redSignals(pieceId: number): number {
    const p = this.layout.getPiece(pieceId);
    const def = p && getPieceDef(p.type, p.flipped);
    if (!def?.signal) return 0;
    let red = 0;
    for (let road = 0; road < def.paths.length; road++) if (!this.signalClear(pieceId, road)) red += 1 << road;
    return red;
  }

  /** Hold one of a signal piece's signals at red by hand, or let it go (each road's hold is a bit of its state). */
  toggleSignal(pieceId: number, road = 0): void {
    this.layout.setSwitchState(pieceId, this.layout.switchState(pieceId) ^ (1 << road));
    // Shown at once (even paused).
    this.updateSignals();
  }

  /**
   * Is the way an engine's own front points (`way` 1), or its back (−1), up against the end of the line: a buffer or
   * track that just stops, within `within`? (For the engine card: a stopped train offers to go the open way.)
   */
  engineBlocked(engineCarId: number, way: 1 | -1, within = 6): boolean {
    const found = this.findCar(engineCarId);
    if (!found) return false;
    const t = found.train;
    // The train's leading end (bogie 0) is where an engine facing 1 points its front.
    const leading = way * found.train.cars[found.index].facing === 1;
    const c: Cursor = { ...(leading ? t.bogies[0] : t.bogies[t.bogies.length - 1]) };
    if (!leading) flipCursor(this.layout, c);
    advanceCursor(this.layout, c, within, null, lookAdv);
    return lookAdv.status === ADV_BUFFER || lookAdv.status === ADV_OPEN_END;
  }

  /** Is this train standing at a red signal, waiting for it to clear (for the engine card)? */
  atRedSignal(trainId: number): boolean {
    const t = this.trains.get(trainId);
    return !!t && !t.derailed && t.speed < 1 && this.signalCap(t) === 0;
  }

  /** Held at red by hand (a tap; saved with the switch states: a bit for each road), whatever the line ahead. */
  signalHeld(pieceId: number, road = 0): boolean {
    return ((this.layout.switchState(pieceId) >> road) & 1) === 1;
  }

  /**
   * Each signal's aspect: red while it's held, or while any train stands on its block, the track from its far end up
   * to and including the next signal, switch or crossing (or to the end of the line). Worked out once a tick.
   *
   * A signal piece has a signal on each of its paths (`PieceDef.signal`): a plain signal one, a gantry over two roads
   * two, each guarding its own road from the path's `from` end to its `to` end, with a block of its own beyond.
   */
  private updateSignals(): void {
    if (this.signals === null) {
      this.signals = [];
      for (const id of this.layout.pieceIds()) {
        const p = this.layout.getPiece(id)!;
        const def = getPieceDef(p.type, p.flipped);
        if (def.signal) for (let road = 0; road < def.paths.length; road++) this.signals.push(signalKey(id, road));
      }
      for (const key of this.aspects.keys()) if (!this.signals.includes(key)) this.aspects.delete(key);
    }
    if (this.signals.length === 0) return;
    // Pieces with a train on them: which of their paths (a bit each).
    const occupied = new Map<number, number>();
    for (const t of this.trains.values()) for (const b of t.bogies) occupied.set(b.pieceId, (occupied.get(b.pieceId) ?? 0) | (1 << b.pathIndex));
    for (const key of this.signals) {
      const id = signalPiece(key);
      const road = signalRoad(key);
      if (!this.layout.getPiece(id) || this.layout.isLifted(id)) continue;
      const clear = !this.signalHeld(id, road) && !this.blockOccupied(id, road, occupied);
      if (this.aspects.get(key) !== clear) {
        this.aspects.set(key, clear);
        this.signalsVersion++;
      }
    }
  }

  /** Is any train on the block beyond this signal (a signal piece's road: see `updateSignals`)? */
  private blockOccupied(signalId: number, road: number, occupied: ReadonlyMap<number, number>): boolean {
    const p0 = this.layout.getPiece(signalId)!;
    const far = getPieceDef(p0.type, p0.flipped).paths[road]?.to;
    // A road that ends at a buffer in the piece has no block beyond it.
    if (far === null || far === undefined) return false;
    let ref = connectorRef(signalId, far);
    for (let n = 0; n < MAX_BLOCK; n++) {
      const next = this.layout.joinedConnector(ref);
      if (next === -1) return false;
      const id = pieceOfRef(next);
      if (id === signalId) return false;
      const p = this.layout.getPiece(id);
      if (!p) return false;
      const def = getPieceDef(p.type, p.flipped);
      const on = occupied.get(id);
      // A train on the piece the block runs into holds it; on double track (roads side by side that never meet), only
      // one on the road the block runs onto does: a train on the other line is on another block.
      if (on !== undefined && (!pathsApart(def) || (on & pathsAt(def, indexOfRef(next))) !== 0)) return true;
      // The block ends here: at the next signal, or at a switch or crossing (where lines meet).
      if (def.signal || def.connectors.length !== 2) return false;
      ref = connectorRef(id, 1 - indexOfRef(next));
    }
    return false;
  }

  /**
   * How fast a train may go so as to stop at the next signal ahead showing red (its stop point, just short of the post),
   * braking as it does at the end of the line: Infinity when there's none within sight.
   */
  private signalCap(train: Train): number {
    const red = this.redAhead(train);
    return red === null ? Infinity : red.dist < 0.5 ? 0 : Math.sqrt(2 * ACCELERATION * (red.dist - 0.5));
  }

  /** The red signal (its piece) a train is held by or braking for, or −1 (for the engine card and reports). */
  redSignalAhead(trainId: number): number {
    const t = this.trains.get(trainId);
    return t ? (this.redAhead(t)?.pieceId ?? -1) : -1;
  }

  /** The red signal a train is running toward, and how far its stop point is ahead of the front axle; or null. */
  private redAhead(train: Train): { pieceId: number; dist: number } | null {
    if (!this.signals || this.signals.length === 0) return null;
    let anyRed = false;
    for (const clear of this.aspects.values()) if (!clear) anyRed = true;
    if (!anyRed) return null;
    // Walk ahead of the front axle a step at a time, looking for the stop point of a red signal it's running toward.
    const c: Cursor = { ...train.bogies[0] };
    let walked = 0;
    for (let k = 0; walked <= SIGNAL_LOOK; k++) {
      const piece = c.pieceId;
      if (k > 0) {
        advanceCursor(this.layout, c, SIGNAL_STEP, null, lookAdv);
        walked += lookAdv.moved;
      }
      const p = this.layout.getPiece(c.pieceId);
      const stopAt = p ? getPieceDef(p.type, p.flipped).signal?.stopAt : undefined;
      if (stopAt !== undefined && !c.reversed && this.aspects.get(signalKey(c.pieceId, c.pathIndex)) === false) {
        // Short of the stop point: brake to it. Stepped onto the piece already past it: it was within this step.
        // (Already past it where the axle stands: that signal's behind; look on.)
        let dist = -1;
        if (c.s <= stopAt) dist = walked + stopAt - c.s;
        else if (k > 0 && c.pieceId !== piece) dist = walked - (c.s - stopAt);
        if (dist >= 0) return { pieceId: c.pieceId, dist };
      }
      if (k > 0 && (lookAdv.status !== ADV_OK || lookAdv.moved === 0)) return null;
    }
    return null;
  }

  writeSnapshot(snap: SimSnapshot): SimSnapshot {
    let n = 0;
    for (const t of this.trains.values()) n += t.cars.length;
    if (snap.ids.length < n) Object.assign(snap, createSnapshot(Math.max(n, snap.ids.length * 2)));
    let i = 0;
    for (const train of this.trains.values()) {
      for (let c = 0; c < train.cars.length; c++) {
        const car = train.cars[c];
        const f = train.world[2 * c];
        const r = train.world[2 * c + 1];
        const dx = f.x - r.x;
        const dz = f.z - r.z;
        const flat = Math.hypot(dx, dz);
        const o = i * 6;
        snap.ids[i] = car.id;
        snap.kinds[i] = CAR_SPECS[car.kind].index;
        snap.trainIds[i] = train.id;
        snap.derailed[i] = train.derailed ? 1 : 0;
        snap.levers[i] = car.lever;
        snap.transforms[o] = (f.x + r.x) / 2;
        snap.transforms[o + 1] = (f.y + r.y) / 2;
        snap.transforms[o + 2] = (f.z + r.z) / 2;
        // Heading of the car's own front; pitch positive when its own front is higher.
        const heading = Math.atan2(dz, dx) + (car.facing === 1 ? 0 : Math.PI);
        snap.transforms[o + 3] = heading;
        snap.transforms[o + 4] = Math.atan2(f.y - r.y, flat) * car.facing;
        snap.transforms[o + 5] = 0;
        i++;
      }
    }
    snap.count = n;
    return snap;
  }

  private move(train: Train): void {
    // A toy, not a simulation: with its lever on a train runs at the one speed (slopes and loads don't change it),
    // easing up to it and, lever off, easing to a stop.
    let net = 0;
    for (const car of train.cars) if (car.kind === "engine") net += car.lever * car.facing;
    let target = net === 0 ? 0 : Math.sign(net) * (this.topSpeed ? this.topSpeed(train) : ENGINE_SPEED);
    const cap = net !== 0 ? Math.min(this.speedCap ? this.speedCap(train) : Infinity, this.signalCap(train), this.lifts && this.lifts.length > 0 ? this.liftCap(train, true) : Infinity) : Infinity;
    if (target > cap) target = cap;
    let v = train.speed;
    const step = ACCELERATION * (this.quickness ? this.quickness(train) : 1) * SIM_DT;
    v = Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
    // A crane holding the train (cap 0) holds it there and then.
    if (v > cap) v = cap;
    if (v < 0) {
      this.flipTrain(train);
      v = -v;
    }
    // Behind another train's engine, it eases down to the gap it holds back at, and keeps it (else it would step into it
    // each tick and be stopped after: a creep that reads as standing still).
    if (v > 0 && this.trains.size > 1 && hasEngine(train)) v = Math.min(v, this.followCap(train, v));
    // Coming to a crossing, or a switch, another train is on or coming onto by the other road: it stops short and waits.
    if (v > 0 && this.trains.size > 1) v = Math.min(v, this.crossCap(train, v));
    // (Too slow to see: standing.)
    if (v < MIN_SPEED) v = 0;
    train.speed = v;
    if (v === 0) return;

    const lead = train.bogies[0];
    let piece = lead.pieceId;
    advanceCursor(this.layout, lead, v * SIM_DT, train.memory, adv, train.bogies.length);
    const moved = adv.moved;
    const status = adv.status;
    if (lead.pieceId !== piece) this.events.push({ kind: "joint", trainId: train.id, bogie: 0 });
    for (let i = 1; i < train.bogies.length; i++) {
      piece = train.bogies[i].pieceId;
      advanceCursor(this.layout, train.bogies[i], moved, train.memory, adv, train.bogies.length);
      if (train.bogies[i].pieceId !== piece) this.events.push({ kind: "joint", trainId: train.id, bogie: i });
    }
    if (status === ADV_BUFFER || status === ADV_OPEN_END) {
      // The end of the line (a buffer, or track that just stops): the train stops there, waits, and turns back.
      train.speed = 0;
      if (train.turnback < 0) {
        train.turnback = TURNBACK_TICKS;
        train.lastTurn = { cause: status === ADV_BUFFER ? "buffer" : "open-end", pieceId: train.bogies[0].pieceId, tick: this.ticks };
      }
      this.events.push({ kind: "buffer", trainId: train.id });
    }
    this.refreshWorld(train);
  }

  private flipTrain(train: Train): void {
    train.cars.reverse();
    for (const car of train.cars) car.facing = car.facing === 1 ? -1 : 1;
    train.bogies.reverse();
    for (const b of train.bogies) flipCursor(this.layout, b);
    train.world.reverse();
    this.rememberStraddledSwitches(train);
    train.speed = -train.speed;
    this.refreshWorld(train);
  }

  /**
   * Turn a train end for end where it stands, as a child lifts a toy train and puts it back the other way round: the
   * same stretch of track, the cars in mirrored order (what was nearest the front is now at the far end, leading),
   * each car facing the other way. Cars keep their ids and levers, so the engine drives off away from where it was
   * heading. Returns the new train, or null (and leaves the train as it was) if it doesn't fit.
   */
  private turnAround(train: Train): Train | null {
    const n = train.bogies.length;
    // The new front axle goes where the old rear axle was, heading back the other way.
    const lead = { ...train.bogies[n - 1] };
    flipCursor(this.layout, lead);
    // Its axles span the same stretch as before (the far one where the old front one was, which is as far as the
    // track goes at a buffer); a whisker out from the buffer, so rounding never puts that axle past its end.
    advanceCursor(this.layout, lead, TURN_CLEARANCE, null, adv);
    const kinds = train.cars.map((c) => c.kind);
    const ids = train.cars.map((c) => c.id);
    const facings = train.cars.map((c) => c.facing);
    const levers = train.cars.map((c) => c.lever);
    this.trains.delete(train.id);
    // Mirrored: the old front car is the new front car, now at the other end of the stretch.
    const placed = this.addTrain(kinds, lead, ids);
    if (placed.kind !== "placed") {
      this.trains.set(train.id, train);
      return null;
    }
    const t = this.trains.get(placed.trainId)!;
    t.cars.forEach((car, i) => {
      car.facing = facings[i];
      car.lever = levers[i];
    });
    // Turned round with its new front on a switch it had trailed through from a branch (set the other way): the rest
    // follow its front's path, not the switch's setting, or the train splits across both roads.
    this.rememberStraddledSwitches(t);
    return t;
  }

  /**
   * After a train turns round, the switch choices it remembered no longer apply. But a train that turns round while
   * part of it is on a switch (heading out along one of its paths) must have the rest follow that same path when they
   * come onto the switch from its trunk, whichever way the switch is set now: otherwise the train splits.
   */
  private rememberStraddledSwitches(train: Train): void {
    train.memory.clear();
    const b = train.bogies;
    for (let i = b.length - 1; i >= 0; i--) {
      const c = b[i];
      // On a switch, travelling from its trunk end out along a path; the axles behind it (higher indices) follow.
      if (c.reversed || train.memory.has(c.pieceId)) continue;
      const piece = this.layout.getPiece(c.pieceId);
      if (!piece || !getPieceDef(piece.type, piece.flipped).isSwitch) continue;
      const behind = b.length - 1 - i;
      if (behind > 0) train.memory.set(c.pieceId, { path: c.pathIndex, remaining: behind });
    }
  }

  private derail(train: Train): void {
    if (train.derailed) return;
    train.derailed = true;
    this.events.push({ kind: "derailed", trainId: train.id });
  }

  private refreshWorld(train: Train): void {
    for (let i = 0; i < train.bogies.length; i++) cursorWorld(this.layout, train.bogies[i], train.world[i]);
  }

  /** End face of a train: its front (car 0, train-front side) or rear (last car, train-rear side). */
  private endFace(train: Train, front: boolean, out: { x: number; y: number; z: number }): Pole {
    const c = front ? 0 : train.cars.length - 1;
    const car = train.cars[c];
    const f = train.world[2 * c];
    const r = train.world[2 * c + 1];
    const len = Math.hypot(f.x - r.x, f.z - r.z) || 1;
    const inset = CAR_SPECS[car.kind].bogieInset;
    const sign = front ? 1 : -1;
    const from = front ? f : r;
    out.x = from.x + (sign * (f.x - r.x) * inset) / len;
    out.z = from.z + (sign * (f.z - r.z) * inset) / len;
    out.y = from.y;
    // Pole on the train-front side of the car is its own front pole when facing forward.
    const trainFrontPole = car.facing === 1 ? car.frontPole : opposite(car.frontPole);
    return front ? trainFrontPole : opposite(trainFrontPole);
  }

  private resolveContacts(): void {
    const riding = this.rides.size > 0;
    for (const a of this.trains.values()) {
      if (a.derailed || a.speed <= 0) continue;
      this.endFace(a, true, face);
      for (const b of this.trains.values()) {
        // (A train riding a turning deck is swept round past the roads' ends: nothing couples to it till it's there.)
        if (b === a || b.derailed || !this.trains.has(a.id) || (riding && this.riding(b))) continue;
        const reach = Math.max(4, a.speed * SIM_DT + 2);
        // End to end (meeting, or touching as they part): not a blow to b's side.
        let ends = false;
        for (let side = 0; side < 2; side++) {
          const front = side === 1;
          this.endFace(b, front, otherFace);
          // An engine behind another train's engine holds back a little short of touching (it follows, it doesn't
          // couple), so it waits smoothly rather than stopping and starting.
          const follow = !front && hasEngine(a) && hasEngine(b) ? CONTACT_FOLLOW : 0;
          if (Math.hypot(face.x - otherFace.x, face.z - otherFace.z) > reach + follow || Math.abs(face.y - otherFace.y) > 20) continue;
          ends = true;
          const closing = a.speed + (front ? b.speed : -b.speed);
          if (closing <= 0) continue;
          if (front && hasEngine(a) && hasEngine(b)) {
            // One of them coming off a lift (on it, or just off it): both stop, and the one coming off keeps its right of
            // way while it waits. Neither turns back (§16 Q3): they stand till one is moved.
            const aOff = this.comingOffLift(a);
            if (aOff !== this.comingOffLift(b)) {
              const yields = aOff ? b : a;
              const keeps = aOff ? a : b;
              keeps.speed = 0;
              // (Waiting for the other to go, it keeps its right of way however long that takes.)
              if (this.offLift.has(keeps.id)) this.offLift.set(keeps.id, this.ticks);
              this.meet(yields, keeps);
              continue;
            }
            // Head on, engine against engine: each stops and waits for the other (coupled, their engines would only
            // push against each other). Nothing turns either back: they stand nose to nose till one is moved (§16 Q3).
            // Wagons met end to end are coupled on (below), so an engine backing into the wagons it left picks them up.
            this.meet(a, b);
            if (b.speed > 0) this.meet(b, a);
            continue;
          }
          // Two trains each with an engine stay two (each has its own lever, and route): the one behind keeps pace
          // with the one ahead.
          if (follow > 0) {
            a.speed = Math.min(a.speed, Math.max(0, b.speed));
            continue;
          }
          // Catching up with wagons (or an engine catching wagons) couples on, whichever way the cars' magnets face
          // (a toy that never refuses), however fast: they go on together at their shared pace.
          this.couple(a, b, front);
          return this.resolveContacts();
        }
        // Running into a train's side (where lines meet at a switch or crossing): it stops there, and waits.
        if (!ends && this.hitsSide(b)) this.meet(a, b, "side");
      }
    }
  }

  /**
   * The speed this train may run at to keep `FOLLOW_GAP` behind another train with an engine ahead of it on its track
   * while that one moves, and to stop `STOP_GAP` behind it once it stands (its back), or `NOSE_GAP` short of one met head on (its front: each taking half the room while the other moves): braking
   * as it does for anything (`ACCELERATION`), and behind a moving train no slower than it while it has room. Looks no
   * further than its stopping distance and the gap; Infinity when there's none. Wagons with no engine aren't looked for:
   * an engine runs onto them and couples (`resolveContacts`). With no room left, it's held by that train (`heldBy`).
   */
  private followCap(train: Train, v: number): number {
    this.endFace(train, true, followFace);
    const look = FOLLOW_GAP + (v * v) / (2 * ACCELERATION) + 2 * v * SIM_DT + 8;
    let cap = Infinity;
    let least = Infinity;
    let by: Train | null = null;
    let nose = false;
    for (const b of this.trains.values()) {
      if (b === train || b.derailed || !hasEngine(b)) continue;
      for (let side = 0; side < 2; side++) {
        const front = side === 1;
        this.endFace(b, front, followOther);
        if (Math.abs(followFace.y - followOther.y) > 20) continue;
        const d = Math.hypot(followFace.x - followOther.x, followFace.z - followOther.z);
        if (d > look) continue;
        // (Close by in a straight line: is it on this train's track ahead, not on a loop's other road beside it?)
        if (!this.aheadOnTrack(train, b.bogies[front ? 0 : b.bogies.length - 1], d + 2 * FOLLOW_LOOK_PAST)) continue;
        let room = Math.max(0, d - (front ? NOSE_GAP : b.speed > 0 ? FOLLOW_GAP : STOP_GAP));
        if (front && b.speed > 0) room /= 2;
        const u = front ? 0 : b.speed;
        const c = Math.min(room / SIM_DT, Math.sqrt(u * u + 2 * ACCELERATION * room));
        if (c < cap) cap = c;
        if (room < least) {
          least = room;
          by = b;
          nose = front;
        }
      }
    }
    if (by && least < 0.5) this.holdBy(train, by, nose ? "nose" : "follow");
    return cap;
  }

  /**
   * Is this cursor (another train's end axle) on this train's track ahead of its front axle, within `reach` (mm) of it,
   * the way the points lie? A walk over the few pieces in reach, done only for a train already close by.
   */
  private aheadOnTrack(train: Train, other: Cursor, reach: number): boolean {
    const c = crossAt;
    Object.assign(c, train.bogies[0]);
    // How far ahead of the front axle the start of the piece c is on.
    let dist = -c.s;
    for (let k = 0; k < MAX_BLOCK; k++) {
      const piece = this.layout.getPiece(c.pieceId);
      if (!piece) return false;
      const len = pathLength(getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom);
      if (other.pieceId === c.pieceId && other.pathIndex === c.pathIndex) {
        // (Where along it, the way this train goes.)
        const at = other.reversed === c.reversed ? other.s : len - other.s;
        if (k > 0 || at > c.s) return true;
      }
      dist += len;
      if (dist > reach) return false;
      advanceCursor(this.layout, c, len - c.s + 0.01, null, crossAdv);
      if (crossAdv.status !== ADV_OK) return false;
      c.s = 0;
    }
    return false;
  }

  /**
   * The speed a train may run at to stop short of the next piece where its path meets another's (a crossing, a
   * switch's other road: `crossMasks`) that another train is on, or is coming onto (it said so this tick or last, in
   * `crossClaims`), by a path that meets its own: Infinity when there's none within its stopping distance. Else it
   * says it's coming onto each such piece it'll reach, so the first to come near one goes over and the other waits
   * (whichever lines they're on, or none). Only pieces where paths meet cost more than a lookup.
   */
  private crossCap(train: Train, v: number): number {
    const inset = CAR_SPECS[train.cars[0].kind].bogieInset;
    const look = (v * v) / (2 * ACCELERATION) + v * SIM_DT + CROSS_LOOK + inset + CROSS_GAP;
    const c = crossAt;
    Object.assign(c, train.bogies[0]);
    // How far ahead of the front axle the start of the piece c is on.
    let dist = -c.s;
    for (let k = 0; k < MAX_BLOCK; k++) {
      const piece = this.layout.getPiece(c.pieceId);
      if (!piece) break;
      const def = getPieceDef(piece.type, piece.flipped);
      const mask = crossMasks(def)[c.pathIndex] ?? 0;
      if (mask !== 0) {
        // (On it already: it goes on over, saying so.)
        const by = k === 0 ? null : this.crossHeld(train, c.pieceId, mask);
        if (by) {
          const room = dist - inset - CROSS_GAP;
          // (Claims long stale are forgotten now and then.)
          if (this.crossClaims.size > 64) for (const [key, cl] of this.crossClaims) if (cl.tick < this.ticks - 1) this.crossClaims.delete(key);
          if (room < 0.5) this.holdBy(train, by, "cross");
          return room < 0.5 ? 0 : Math.sqrt(2 * ACCELERATION * (room - 0.5));
        }
        const key = c.pieceId * MAX_PATHS + c.pathIndex;
        const claim = this.crossClaims.get(key);
        if (claim) {
          claim.trainId = train.id;
          claim.tick = this.ticks;
        } else this.crossClaims.set(key, { trainId: train.id, tick: this.ticks });
      }
      const len = pathLength(def.paths[c.pathIndex].geom);
      dist += len;
      if (dist - inset - CROSS_GAP > look) break;
      // (Onto the next piece, a whisker in.)
      advanceCursor(this.layout, c, len - c.s + 0.01, null, crossAdv);
      if (crossAdv.status !== ADV_OK) break;
      // (Measured from the piece's start.)
      c.s = 0;
    }
    return Infinity;
  }

  /** Another train on, or coming onto, a piece by one of the paths in `mask` (a bit each), or null. */
  private crossHeld(train: Train, pieceId: number, mask: number): Train | null {
    for (const t of this.trains.values()) {
      if (t === train || t.derailed) continue;
      for (const b of t.bogies) if (b.pieceId === pieceId && (mask >> b.pathIndex) & 1) return t;
    }
    for (let m = mask, p = 0; m !== 0; m >>= 1, p++) {
      if ((m & 1) === 0) continue;
      const claim = this.crossClaims.get(pieceId * MAX_PATHS + p);
      if (!claim || claim.trainId === train.id || claim.tick < this.ticks - 1) continue;
      const t = this.trains.get(claim.trainId);
      if (t && !t.derailed) return t;
    }
    return null;
  }

  /**
   * A train stopped against another (nose to nose, or against its side): it stands, and waits for it to go, however long
   * (routing spec §16 Q3: nothing turns it back short of the end of the track).
   */
  private meet(t: Train, by: Train, how: HeldHow = "nose"): void {
    t.speed = 0;
    this.holdBy(t, by, how);
  }

  /** Does the current `face` point strike the side of one of b's cars (not its end faces)? */
  private hitsSide(b: Train): boolean {
    for (let c = 0; c < b.cars.length; c++) {
      const f = b.world[2 * c];
      const r = b.world[2 * c + 1];
      const dx = f.x - r.x;
      const dz = f.z - r.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = ((face.x - r.x) * dx + (face.z - r.z) * dz) / len2;
      if (t < 0 || t > 1) continue;
      const px = r.x + t * dx;
      const pz = r.z + t * dz;
      if (Math.hypot(face.x - px, face.z - pz) < SIDE_HIT_DISTANCE && Math.abs(face.y - f.y) < 20) return true;
    }
    return false;
  }

  /** a's front touched b (b's front if `bFront`, else its rear). b ends up ahead of a in one train. */
  private couple(a: Train, b: Train, bFront: boolean): void {
    if (bFront) this.flipTrain(b);
    const massOf = (t: Train) => t.cars.reduce((m, c) => m + CAR_SPECS[c.kind].mass, 0);
    const ma = massOf(a);
    const mb = massOf(b);
    const v = (a.speed * ma + b.speed * mb) / (ma + mb);
    b.cars = [...b.cars, ...a.cars];
    b.bogies = [...b.bogies, ...a.bogies];
    b.world = [...b.world, ...a.world];
    for (const [k, m] of a.memory) if (!b.memory.has(k)) b.memory.set(k, m);
    b.speed = v;
    this.trains.delete(a.id);
    this.events.push({ kind: "coupled", trainId: b.id, absorbedTrainId: a.id });
  }
}

/** Why a deck (or a lift) won't go now: see `Sim.deckRefusal`. */
export type DeckRefusal = "partly" | "moving" | "turning" | "approaching";

/** A lift waits this long (ticks) with a train halted on it, or called, before it goes: a moment's pause. */
export const LIFT_DWELL = SIM_HZ;
/** How far (mm) short of a lift's platform end, or of a closed lift's end, a train's front face halts. */
const LIFT_FACE_GAP = 2;
/** How far (mm) past its braking distance a train looks for a lift's end, and counts as coming in to one. */
const LIFT_LOOK = 24;

/** How fast a train may go to stop within `d` mm (as at a red signal). */
const brakeTo = (d: number): number => (d < 0.5 ? 0 : Math.sqrt(2 * ACCELERATION * (d - 0.5)));

/** A train's length, buffer face to buffer face (mm). */
function trainLength(t: Train): number {
  let n = 0;
  for (const c of t.cars) n += CAR_SPECS[c.kind].length;
  return n + COUPLER_GAP * Math.max(0, t.cars.length - 1);
}

/** Which way a train's engines drive it: + toward its front, − its back, 0 not at all (levers off). */
function drive(t: Train): number {
  let net = 0;
  for (const car of t.cars) if (car.kind === "engine") net += car.lever * car.facing;
  return net;
}

/** A signal's key: its piece and which of the piece's paths (roads) it guards (as many as it has connectors, at most). */
export const signalKey = (pieceId: number, road: number): number => pieceId * MAX_CONNECTORS + road;
const signalPiece = (key: number): number => Math.floor(key / MAX_CONNECTORS);
const signalRoad = (key: number): number => key % MAX_CONNECTORS;

/** The paths (a bit each) that end at a piece's connector. */
function pathsAt(def: PieceDef, connector: number): number {
  let bits = 0;
  def.paths.forEach((p, i) => {
    if (p.from === connector || p.to === connector) bits |= 1 << i;
  });
  return bits;
}

const apartCache = new WeakMap<PieceDef, boolean>();
const apartA = createSample();
const apartB = createSample();

/**
 * Is a piece double track (or more): not a switch, with several paths that stay at least a track's width apart all
 * along (a double straight, a gantry's roads; not a crossing, whose lines meet)? Worked out once per piece def.
 */
function pathsApart(def: PieceDef): boolean {
  if (def.isSwitch || def.paths.length < 2) return false;
  let apart = apartCache.get(def);
  if (apart !== undefined) return apart;
  apart = true;
  for (let i = 0; i < def.paths.length && apart; i++) for (let j = i + 1; j < def.paths.length && apart; j++) if (pathsMeet(def, i, j)) apart = false;
  apartCache.set(def, apart);
  return apart;
}

/** Do two of a piece's paths come within a track's width of each other somewhere? */
function pathsMeet(def: PieceDef, i: number, j: number): boolean {
  const step = 8;
  const a = def.paths[i].geom;
  const b = def.paths[j].geom;
  const la = pathLength(a);
  const lb = pathLength(b);
  for (let s = 0; s <= la; s += step) {
    samplePath(a, Math.min(s, la), apartA);
    for (let t = 0; t <= lb; t += step) {
      samplePath(b, Math.min(t, lb), apartB);
      if (Math.hypot(apartA.x - apartB.x, apartA.z - apartB.z) < TRACK_WIDTH) return true;
    }
  }
  return false;
}

const crossCache = new WeakMap<PieceDef, readonly number[]>();

/**
 * For each of a piece's paths, the others (a bit each) that meet it (`pathsMeet`): a train on one would run into a
 * train on the other (a crossing's two lines, a switch's roads by its stem). None on a deck or lift (a train has it
 * to itself), or on double track. Worked out once per piece def.
 */
function crossMasks(def: PieceDef): readonly number[] {
  let masks = crossCache.get(def);
  if (masks) return masks;
  const n = def.paths.length;
  const out = new Array<number>(n).fill(0);
  if (n > 1 && n <= MAX_PATHS && !def.gated && !def.lift)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (pathsMeet(def, i, j)) {
          out[i] |= 1 << j;
          out[j] |= 1 << i;
        }
  crossCache.set(def, out);
  masks = out;
  return masks;
}
