import { connectorRef, getPieceDef, indexOfRef, pieceOfRef, type Layout } from "../track";
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
/** How far back (mm) an engine following another train's engine holds. */
const FOLLOW_GAP = 10;
const hasEngine = (t: Train): boolean => t.cars.some((c) => c.kind === "engine");

/** How far along the track (mm) a re-railed train may be slid to find room, and in what steps. */
const RERAIL_SLIDE = 1200;
const RERAIL_STEP = 24;
/** How far (mm) a turned train is set down away from the buffer it turned at. */
const TURN_CLEARANCE = 0.05;

// Motion tuning (mm, s).
export const ENGINE_SPEED = 120;
/** How quickly (mm/s²) a train gets up to speed, or stops: half a second either way. */
const ACCELERATION = ENGINE_SPEED * 2;
const SIDE_HIT_DISTANCE = 12;
/** How far ahead (mm) a train looks for a signal at red, and in what steps: well past its stopping distance. */
const SIGNAL_LOOK = 300;
const SIGNAL_STEP = 12;
/** A block runs on through at most this many pieces (a loop with no signal in it ends somewhere). */
const MAX_BLOCK = 64;

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

export type SimEvent =
  | { readonly kind: "derailed"; readonly trainId: number }
  | { readonly kind: "coupled"; readonly trainId: number; readonly absorbedTrainId: number }
  | { readonly kind: "buffer"; readonly trainId: number }
  /** A train was lifted and turned round at a turnback buffer (it has a new id; its cars keep theirs). */
  | { readonly kind: "turned"; readonly trainId: number; readonly newTrainId: number }
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
const lookAdv = createAdvance();
const face = { x: 0, y: 0, z: 0 };
const otherFace = { x: 0, y: 0, z: 0 };

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

  /** The signal pieces on the layout (found again after the track changes: see `trackChanged`). */
  private signals: number[] | null = null;
  /** Each signal's aspect as of this tick: true at clear (its block's free), false at red. */
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
    // Whoever set the lever has decided where the train goes: a pending turnback no longer applies.
    found.train.turnback = -1;
    return true;
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
   * Call after the layout changes: trains on removed or lifted pieces derail, as do trains on any piece in
   * `moved` (rotated, moved or flipped out from under them).
   */
  trackChanged(moved: readonly number[] = []): void {
    // Signals are found again (their aspects worked out on the next tick).
    this.signals = null;
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

  /** Is any (railed) train standing on this piece? */
  pieceOccupied(pieceId: number): boolean {
    for (const train of this.trains.values()) {
      if (train.derailed) continue;
      for (const b of train.bogies) if (b.pieceId === pieceId) return true;
    }
    return false;
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

  /** Step a switch to its next route (two-way switches flip; a three-way steps round its three). */
  toggleSwitch(pieceId: number): void {
    const piece = this.layout.getPiece(pieceId);
    const routes = piece ? getPieceDef(piece.type, piece.flipped).paths.filter((p) => p.from === 0).length : 2;
    this.layout.setSwitchState(pieceId, (this.layout.switchState(pieceId) + 1) % Math.max(2, routes));
    // A signal held or let go shows it at once (even paused).
    this.updateSignals();
  }

  tick(): void {
    this.updateSignals();
    for (const train of this.trains.values()) {
      if (train.derailed) continue;
      // Waiting at the end of the line beside a crane with work for it (a depot at the line's end): the wait holds
      // until the crane's done (it's asked each tick, as when moving, so it can see the train has stopped).
      const craneHolds = train.turnback >= 0 && this.speedCap !== null && this.speedCap(train) === 0;
      if (train.turnback >= 0 && !craneHolds && --train.turnback < 0) {
        // Waited long enough at the end of the line: lift the train and turn it round, so it heads back out the way
        // it came, its engine leading as before.
        const turned = this.turnAround(train);
        if (turned) {
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

  /** Is this signal at clear (true), or red (false)? A signal not yet worked out shows clear. */
  signalClear(pieceId: number): boolean {
    return this.aspects.get(pieceId) ?? true;
  }

  /** Is this train standing at a red signal, waiting for it to clear (for the engine card)? */
  atRedSignal(trainId: number): boolean {
    const t = this.trains.get(trainId);
    return !!t && !t.derailed && t.speed < 1 && this.signalCap(t) === 0;
  }

  /** Held at red by hand (a tap; saved with the switch states), whatever the line ahead. */
  signalHeld(pieceId: number): boolean {
    return this.layout.switchState(pieceId) % 2 === 1;
  }

  /**
   * Each signal's aspect: red while it's held, or while any train stands on its block, the track from its far end up
   * to and including the next signal, switch or crossing (or to the end of the line). Worked out once a tick.
   */
  private updateSignals(): void {
    if (this.signals === null) {
      this.signals = [];
      for (const id of this.layout.pieceIds()) {
        const p = this.layout.getPiece(id)!;
        if (getPieceDef(p.type, p.flipped).signal) this.signals.push(id);
      }
      for (const id of this.aspects.keys()) if (!this.layout.getPiece(id)) this.aspects.delete(id);
    }
    if (this.signals.length === 0) return;
    const occupied = new Set<number>();
    for (const t of this.trains.values()) for (const b of t.bogies) occupied.add(b.pieceId);
    for (const id of this.signals) {
      if (!this.layout.getPiece(id) || this.layout.isLifted(id)) continue;
      const clear = !this.signalHeld(id) && !this.blockOccupied(id, occupied);
      if (this.aspects.get(id) !== clear) {
        this.aspects.set(id, clear);
        this.signalsVersion++;
      }
    }
  }

  /** Is any train on the block beyond this signal (see `updateSignals`)? */
  private blockOccupied(signalId: number, occupied: ReadonlySet<number>): boolean {
    let ref = connectorRef(signalId, 1);
    for (let n = 0; n < MAX_BLOCK; n++) {
      const next = this.layout.joinedConnector(ref);
      if (next === -1) return false;
      const id = pieceOfRef(next);
      if (id === signalId) return false;
      if (occupied.has(id)) return true;
      const p = this.layout.getPiece(id);
      if (!p) return false;
      const def = getPieceDef(p.type, p.flipped);
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
    if (!this.signals || this.signals.length === 0) return Infinity;
    let anyRed = false;
    for (const clear of this.aspects.values()) if (!clear) anyRed = true;
    if (!anyRed) return Infinity;
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
      if (stopAt !== undefined && !c.reversed && this.aspects.get(c.pieceId) === false) {
        // Short of the stop point: brake to it. Stepped onto the piece already past it: it was within this step.
        // (Already past it where the axle stands: that signal's behind; look on.)
        let dist = -1;
        if (c.s <= stopAt) dist = walked + stopAt - c.s;
        else if (k > 0 && c.pieceId !== piece) dist = walked - (c.s - stopAt);
        if (dist >= 0) return dist < 0.5 ? 0 : Math.sqrt(2 * ACCELERATION * (dist - 0.5));
      }
      if (k > 0 && (lookAdv.status !== ADV_OK || lookAdv.moved === 0)) return Infinity;
    }
    return Infinity;
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
    const cap = net !== 0 ? Math.min(this.speedCap ? this.speedCap(train) : Infinity, this.signalCap(train)) : Infinity;
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
      if (train.turnback < 0) train.turnback = TURNBACK_TICKS;
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
    for (const a of this.trains.values()) {
      if (a.derailed || a.speed <= 0) continue;
      this.endFace(a, true, face);
      for (const b of this.trains.values()) {
        if (b === a || b.derailed || !this.trains.has(a.id)) continue;
        const reach = Math.max(4, a.speed * SIM_DT + 2);
        // End to end (meeting, or touching as they part): not a blow to b's side.
        let ends = false;
        for (let side = 0; side < 2; side++) {
          const front = side === 1;
          this.endFace(b, front, otherFace);
          // An engine behind another train's engine holds back a little short of touching (it follows, it doesn't
          // couple), so it waits smoothly rather than stopping and starting.
          const follow = !front && hasEngine(a) && hasEngine(b) ? FOLLOW_GAP : 0;
          if (Math.hypot(face.x - otherFace.x, face.z - otherFace.z) > reach + follow || Math.abs(face.y - otherFace.y) > 20) continue;
          ends = true;
          const closing = a.speed + (front ? b.speed : -b.speed);
          if (closing <= 0) continue;
          if (front) {
            // Head on: like the end of the line, each stops, waits, and turns back (coupled, their engines would
            // only push against each other).
            this.meet(a);
            if (b.speed > 0) this.meet(b);
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
        // Running into a train's side (where lines meet at a switch or crossing): it stops there, and turns back.
        if (!ends && this.hitsSide(b)) this.meet(a);
      }
    }
  }

  /** A train stopped by another meeting it head on: it waits, then turns back (as at the end of the line). */
  private meet(t: Train): void {
    t.speed = 0;
    if (t.turnback < 0) {
      t.turnback = TURNBACK_TICKS;
      this.events.push({ kind: "buffer", trainId: t.id });
    }
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
