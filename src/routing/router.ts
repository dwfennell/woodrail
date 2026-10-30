/**
 * Routing: the one owner of which way a routed train goes, and of setting points for it (and of a lever tap on points).
 * Step 4 (docs/superpowers/specs/2026-10-30-train-routing.md §3.2, §13): route locks. Near its next points, a routed
 * train asks for every lock on its way up to the next clear point, all or none; a train behind needing the same road
 * shares a lock; each is let go behind the last axle, and the points then go back to the player's default (§3.4). The way
 * at each points is the plan's (`planWay`), or sections' granted way inside a granted move.
 */
import { getPieceDef, pathLength, type Layout } from "../track";
import { ACCELERATION, CAR_SPECS, COUPLER_GAP, flipCursor, type Cursor, type Sim, type Train } from "../sim";
import { next, waysFrom } from "./graph";
import { planWay } from "./plan";

/** How often (sim ticks) routed trains ask for the points ahead. */
const STEER_TICKS = 8;
/**
 * How far beyond its braking distance (mm) a train asks for the points ahead (§3.2's set distance): about 3 s at full
 * speed, past the farthest the sim looks ahead of a train through points (a signal at red, `SIGNAL_LOOK` 300), so points
 * are set before anything reads them.
 */
export const SET_LOOK = 400;
/** The most pieces a train's way ahead is followed for its locks (to the next clear point). */
const WALK = 64;

/** Pieces and paths a train has been given (sections' granted way: `follow`). */
export type AvoidTest = (pieceId: number, pathIndex: number) => boolean;

/** Is this piece points (a switch with a lever: not a signal, a deck or a lift)? */
function isPoints(layout: Layout, pieceId: number): boolean {
  const p = layout.getPiece(pieceId);
  const def = p && getPieceDef(p.type, p.flipped);
  return !!def?.isSwitch && !def.gated && !def.signal;
}

/** Switch defaults as saved: `[pieceId, state]`, only where the default differs from how the switch is set (§4). */
export type SavedDefaults = [number, number][];

/** What a lever tap on points came to: thrown, or refused while a car is on or over them (`Sim.pointsHeld`). */
export type LeverResult = { ok: true } | { refused: "under-train" };

/** What the router asks of the game (the economy): its routed trains and their stops, and sections' hints. */
export interface RouterHost {
  readonly layout: Layout;
  readonly sim: Pick<Sim, "findCar" | "piecesUnder" | "pointsHeld" | "toggleSwitch">;
  /** The routed engines, in the order they're steered (the economy's routes). */
  readonly routed: { readonly size: number; keys(): Iterable<number>; has(engine: number): boolean };
  /** The piece of a routed engine's next stop; −1 while it has none on the map. */
  goal(engine: number): number;
  /** A train's net drive toward its front (sign only matters; 0: not driven). */
  drive(train: Train): number;
  /** Sections' hint for a train holding a move: its way (`follow`), aimed at a piece of the slot it goes to. */
  granted(engine: number): { follow: AvoidTest; aim: number } | undefined;
  /**
   * Is this a train of a line sections manage with no move granted (§5.2)? It takes no locks: only a granted move's
   * train sets points on its line, so trains of one line never contend for them.
   */
  awaitingGrant(engine: number): boolean;
  /** Engines sections just granted a move (asked for at once, and cleared here). */
  readonly soon: Set<number>;
}

/** A route lock (§3.2): points set to `state` for the trains holding it; they don't move while anyone does. */
interface Lock {
  state: number;
  holders: Set<number>;
}

/** A routed train's side of its locks, and its way ahead as last seen. */
interface Holding {
  /** The points it holds, and whether it has been on them yet (let go once its last axle is off them again). */
  held: Map<number, { state: number; entered: boolean }>;
  /**
   * Points the player threw while they were set (or about to be) for it (§16 Q1): taken as they lie (as if pinned) till
   * it's by them (on them and off again), or it heads elsewhere (`goingTo` changes).
   */
  tapped: Map<number, boolean>;
  /** Where it was heading at its last look: its target, and which way (a turn or a new stop forgets `tapped`). */
  goingTo: string;
  /** The points on its way ahead and the state it wants each in, from its last look. */
  want: Map<number, number>;
}

/** A point on a train's way that it asks to be set: points, the option it takes, and how many it has. */
interface Want {
  pieceId: number;
  state: number;
  ways: number;
}

/**
 * The one owner of routing decisions: the way at points (the plan, or sections' grant), route locks, setting and
 * restoring points, and the lever gate. Costs nothing with no routed train and no lock; otherwise a short look ahead
 * per routed train every `STEER_TICKS`.
 */
export class Router {
  /** Called when routing has set a switch, or put one back (its piece id: the game swings its lever, with a soft click). */
  onSwitch: ((pieceId: number) => void) | null = null;
  /** Time in the router's looks and locks (ms) and the looks made, when `timing` is on. */
  timing = false;
  ms = 0;
  looks = 0;
  /** Locks granted (per point), asks refused (all or none), and points put back. */
  granted = 0;
  refused = 0;
  restored = 0;
  private steerTicks = 0;
  /**
   * Each switch's default (§3.4): the way the player last set it by hand, or as laid. Written by a lever tap the router
   * allowed and when points are laid, never by routing. Points not in it (not seen since laid) default to how they lie.
   */
  private readonly defaults = new Map<number, number>();
  /** The layout's `piecesVersion` the defaults were last brought up to date with (points laid and taken up). */
  private laidAt = -1;
  /** The layout's `piecesVersion` the locks were last checked against (locks on points taken up go). */
  private locksAt = -1;
  private readonly locks = new Map<number, Lock>();
  private readonly holding = new Map<number, Holding>();
  /** Points let go while a train (one with no lock: hand-run) stood on them: put back once it's off. */
  private readonly pending = new Set<number>();
  /** Loaded: each routed train takes the locks on the points it stands on, at the next look (§4). */
  private adopt = false;

  constructor(private readonly host: RouterHost) {}

  /** One sim tick: routed trains ask for the points ahead, a few times a second (a train covers a few mm a tick). */
  tick(): void {
    const h = this.host;
    if (h.routed.size === 0) {
      if (this.holding.size > 0 || this.pending.size > 0) this.steerTrains();
      return;
    }
    if (++this.steerTicks % STEER_TICKS === 0) this.steerTrains();
    // (And any just granted a move: the points on its way, now.)
    else if (h.soon.size > 0) this.steerTrains(h.soon);
    h.soon.clear();
  }

  /**
   * A lever tap on points (not a signal, a deck or a lift): thrown, unless a car is on or over them (the cars still to
   * come would take the other road, and the train would split). Points set for a train that hasn't reached them move
   * too (§16 Q1): its lock is dropped, and it goes the way they're now set till it's by them (they're never thrown back
   * for it).
   */
  lever(pieceId: number): LeverResult {
    const sim = this.host.sim;
    this.laid();
    if (sim.pointsHeld(pieceId) || !sim.toggleSwitch(pieceId)) return { refused: "under-train" };
    // (The player's new default for these points.)
    this.defaults.set(pieceId, this.host.layout.switchState(pieceId));
    this.pending.delete(pieceId);
    const lock = this.locks.get(pieceId);
    this.locks.delete(pieceId);
    for (const [engine, h] of this.holding) {
      if (lock?.holders.has(engine) || h.want.has(pieceId)) {
        h.held.delete(pieceId);
        h.tapped.set(pieceId, false);
      }
    }
    return { ok: true };
  }

  /** The way points go back to once trains have passed (§3.4): the player's last lever tap, or as laid. */
  defaultOf(pieceId: number): number {
    this.laid();
    return this.defaults.get(pieceId) ?? this.host.layout.switchState(pieceId);
  }

  /** Are these points locked for a train (set for its way, §3.2)? */
  locked(pieceId: number): boolean {
    return this.locks.has(pieceId);
  }

  /** How many trains hold the lock on these points (0: none). */
  holders(pieceId: number): number {
    return this.locks.get(pieceId)?.holders.size ?? 0;
  }

  /** Did the player throw these points while they were set for this engine's train (it goes as they lie, §16 Q1)? */
  tappedFor(engine: number, pieceId: number): boolean {
    return !!this.holding.get(engine)?.tapped.has(pieceId);
  }

  /**
   * Bring the defaults up to date with the track: points laid since take the way they lie as their default; points taken
   * up lose theirs (put back by undo, they're laid again). Only when pieces have come or gone (`piecesVersion`).
   */
  laid(): void {
    const layout = this.host.layout;
    if (this.laidAt === layout.piecesVersion) return;
    this.laidAt = layout.piecesVersion;
    for (const id of this.defaults.keys()) if (!layout.getPiece(id)) this.defaults.delete(id);
    for (const id of layout.pieceIds()) if (!this.defaults.has(id) && isPoints(layout, id)) this.defaults.set(id, layout.switchState(id));
  }

  /** The defaults to save: only those that differ from how their switch is set (the rest load as they lie). */
  save(): SavedDefaults | undefined {
    this.laid();
    const layout = this.host.layout;
    const out: SavedDefaults = [];
    for (const [id, state] of this.defaults) if (state !== layout.switchState(id)) out.push([id, state]);
    return out.length > 0 ? out : undefined;
  }

  /**
   * Loaded with the save (after its switches are set): its defaults; points it doesn't name default to how they lie.
   * Locks aren't saved: at the next look each routed train locks the points it stands on, and asks again for those
   * ahead (§4); then points off their default that no train holds go back. Nothing is put back in the load itself.
   */
  restore(saved?: readonly (readonly [number, number])[]): void {
    this.defaults.clear();
    this.laidAt = -1;
    this.locks.clear();
    this.holding.clear();
    this.pending.clear();
    this.adopt = true;
    const layout = this.host.layout;
    for (const [id, state] of saved ?? []) if (isPoints(layout, id)) this.defaults.set(id, state);
    this.laid();
  }

  /** Each routed train (or just `only`): let go the points behind it, and ask for those ahead. */
  private steerTrains(only?: ReadonlySet<number>): void {
    const t0 = this.timing ? performance.now() : 0;
    const { layout, sim } = this.host;
    if (!only) this.tidy();
    for (const engine of this.host.routed.keys()) {
      if (only && !only.has(engine)) continue;
      const found = sim.findCar(engine);
      if (!found || found.train.derailed) {
        this.drop(engine);
        continue;
      }
      const train = found.train;
      let h = this.holding.get(engine);
      if (this.adopt) h = this.adoptUnder(engine, train, h);
      if (h) this.behind(engine, train, h);
      const net = this.host.drive(train);
      const goal = this.host.goal(engine);
      // (Stopped, with no stop to go to, or a line's train with no move granted (§5.2): it sets nothing, and lets go
      // what it holds ahead.)
      if (net === 0 || goal === -1 || this.host.awaitingGrant(engine)) {
        if (h) {
          h.want.clear();
          this.keep(engine, train, h, null);
        }
        continue;
      }
      // (Holding a move (sections): its way, aimed past it into the slot it goes to.)
      const grant = this.host.granted(engine);
      h ??= this.holdingOf(engine);
      this.looks++;
      const target = grant?.aim ?? goal;
      const goingTo = `${train.id}:${Math.sign(net)}:${target}`;
      if (h.goingTo !== goingTo) {
        h.goingTo = goingTo;
        h.tapped.clear();
      }
      const want = this.walk(layout, train, net > 0, target, grant?.follow, h);
      h.want.clear();
      for (const w of want) h.want.set(w.pieceId, w.state);
      this.keep(engine, train, h, want);
      this.ask(engine, h, want);
    }
    if (!only) {
      if (this.adopt) this.adoptDone();
      this.retry();
    }
    if (this.timing) this.ms += performance.now() - t0;
  }

  private holdingOf(engine: number): Holding {
    let h = this.holding.get(engine);
    if (!h) this.holding.set(engine, (h = { held: new Map(), tapped: new Map(), want: new Map(), goingTo: "" }));
    return h;
  }

  /** Locks of trains no longer routed go; so do locks on points taken up. */
  private tidy(): void {
    const { layout, routed } = this.host;
    for (const engine of [...this.holding.keys()]) if (!routed.has(engine)) this.drop(engine);
    if (this.locksAt === layout.piecesVersion) return;
    this.locksAt = layout.piecesVersion;
    for (const id of [...this.locks.keys()]) {
      if (layout.getPiece(id)) continue;
      this.locks.delete(id);
      for (const h of this.holding.values()) h.held.delete(id);
    }
    for (const id of [...this.pending]) if (!layout.getPiece(id)) this.pending.delete(id);
  }

  /** A train gone (taken off, derailed, no longer routed): its locks go with it, and the points go back (§3.2). */
  private drop(engine: number): void {
    const h = this.holding.get(engine);
    if (!h) return;
    for (const id of [...h.held.keys()]) this.release(engine, h, id);
    this.holding.delete(engine);
  }

  /** Release behind (§3.2): each lock is let go once the train's last axle is off its points (having been on them). */
  private behind(engine: number, train: Train, h: Holding): void {
    if (h.held.size === 0 && h.tapped.size === 0) return;
    const under = this.host.sim.piecesUnder(train.id);
    for (const [id, l] of h.held) {
      if (under.has(id)) l.entered = true;
      else if (l.entered) this.release(engine, h, id);
    }
    for (const [id, entered] of h.tapped) {
      if (under.has(id)) h.tapped.set(id, true);
      else if (entered) h.tapped.delete(id);
    }
  }

  /**
   * Locks the train no longer wants (not under it, and not on its way ahead in the state it holds them: its way or
   * goal changed, it turned back): let go.
   */
  private keep(engine: number, train: Train, h: Holding, want: readonly Want[] | null): void {
    if (h.held.size === 0) return;
    const under = this.host.sim.piecesUnder(train.id);
    for (const [id, l] of h.held) {
      if (under.has(id)) continue;
      if (want?.some((w) => w.pieceId === id && w.state === l.state)) continue;
      this.release(engine, h, id);
    }
  }

  /**
   * Ask for every lock on the way ahead it doesn't hold yet: granted all or none (§3.2). Each is free, or held by others
   * for the same road (shared), and points that must move have no car on them. Refused, it holds nothing new and runs
   * over the points as they lie (step 5 makes it wait).
   */
  private ask(engine: number, h: Holding, want: readonly Want[]): void {
    const { layout, sim } = this.host;
    let missing = false;
    for (const w of want) {
      const mine = h.held.get(w.pieceId);
      if (mine?.state === w.state) continue;
      missing = true;
      const lock = this.locks.get(w.pieceId);
      const others = !!lock && [...lock.holders].some((e) => e !== engine);
      if (others && lock!.state !== w.state) {
        this.refused++;
        return;
      }
      if (!others && layout.switchState(w.pieceId) % w.ways !== w.state && sim.pointsHeld(w.pieceId)) {
        this.refused++;
        return;
      }
    }
    if (!missing) return;
    for (const w of want) {
      if (h.held.get(w.pieceId)?.state === w.state) continue;
      let lock = this.locks.get(w.pieceId);
      if (!lock || lock.state !== w.state) this.locks.set(w.pieceId, (lock = { state: w.state, holders: new Set() }));
      lock.holders.add(engine);
      h.held.set(w.pieceId, { state: w.state, entered: false });
      this.pending.delete(w.pieceId);
      this.granted++;
      if (layout.switchState(w.pieceId) % w.ways !== w.state) {
        layout.setSwitchState(w.pieceId, w.state);
        this.onSwitch?.(w.pieceId);
      }
    }
  }

  /**
   * Let a train's lock go. Shared, the others keep it. Otherwise the points go back to the player's default (§3.4):
   * at once, or once nobody stands on them; or, if another routed train is asking for them the way they're set, the lock
   * passes to it with no move (§3.2).
   */
  private release(engine: number, h: Holding, pieceId: number): void {
    h.held.delete(pieceId);
    const lock = this.locks.get(pieceId);
    if (!lock) return;
    lock.holders.delete(engine);
    if (lock.holders.size > 0) return;
    this.locks.delete(pieceId);
    for (const [e, o] of this.holding) {
      if (e === engine || o.want.get(pieceId) !== lock.state) continue;
      this.locks.set(pieceId, { state: lock.state, holders: new Set([e]) });
      o.held.set(pieceId, { state: lock.state, entered: false });
      return;
    }
    this.putBack(pieceId);
  }

  /** Points no train holds go back to their default, unless pinned; with a car on them, once it's off. */
  private putBack(pieceId: number): void {
    const { layout, sim } = this.host;
    if (!layout.getPiece(pieceId) || layout.isPinned(pieceId) || this.locks.has(pieceId)) return;
    const to = this.defaultOf(pieceId);
    if (layout.switchState(pieceId) === to) return;
    if (sim.pointsHeld(pieceId)) {
      this.pending.add(pieceId);
      return;
    }
    this.pending.delete(pieceId);
    layout.setSwitchState(pieceId, to);
    this.restored++;
    this.onSwitch?.(pieceId);
  }

  /** Points waiting to go back (a car was on them): now, if it's off. */
  private retry(): void {
    if (this.pending.size === 0) return;
    for (const id of [...this.pending]) {
      this.pending.delete(id);
      this.putBack(id);
    }
  }

  /** Just loaded: a routed train takes the locks on the points under it that aren't at their default (§4). */
  private adoptUnder(engine: number, train: Train, h: Holding | undefined): Holding | undefined {
    const layout = this.host.layout;
    for (const id of this.host.sim.piecesUnder(train.id)) {
      if (!isPoints(layout, id) || layout.isPinned(id) || layout.switchState(id) === this.defaultOf(id)) continue;
      h ??= this.holdingOf(engine);
      const state = layout.switchState(id);
      let lock = this.locks.get(id);
      if (!lock) this.locks.set(id, (lock = { state, holders: new Set() }));
      lock.holders.add(engine);
      h.held.set(id, { state, entered: true });
    }
    return h;
  }

  /**
   * After the first look since a load: points left off their default that no train holds (set for a route when saved,
   * the train since gone or heading elsewhere) go back.
   */
  private adoptDone(): void {
    this.adopt = false;
    const layout = this.host.layout;
    for (const id of layout.pieceIds()) if (isPoints(layout, id) && !this.locks.has(id)) this.putBack(id);
  }

  /**
   * The points a train asks for (§3.2): along its way from its front (the plan's choice at each points, or sections'
   * granted way), the first points within its set distance (braking distance + `SET_LOOK`) or already held for it, then
   * every points on to the next clear point: plain track as long as the train, its stop, or the slot its move ends at.
   * None if no points are that near. Points tapped for it are taken as they lie (as if pinned).
   */
  private walk(layout: Layout, train: Train, forward: boolean, target: number, follow: AvoidTest | undefined, h: Holding): Want[] {
    const want: Want[] = [];
    // The cursor at the train's front, pointing the way it goes.
    const b = forward ? train.bogies[0] : train.bogies[train.bogies.length - 1];
    const c: Cursor = { ...b };
    if (!forward) flipCursor(layout, c);
    const piece = layout.getPiece(c.pieceId);
    if (!piece || c.pieceId === target) return want;
    const tapped = h.tapped;
    const pinned = tapped.size > 0 ? (id: number) => tapped.has(id) || layout.isPinned(id) : undefined;
    const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
    let exit = c.reversed ? path.from : (path.to ?? -1);
    let at = c.pieceId;
    const v = train.speed;
    const set = (v * v) / (2 * ACCELERATION) + SET_LOOK;
    // (How far the next piece is from the front; and the plain track run since the last points asked for.)
    let d = pathLength(path.geom) - c.s;
    let clear = -1;
    const length = trainLength(train);
    // (Points it holds not reached yet, such as the far ones of the last ask: still asked for, however far.)
    let ahead = false;
    for (const l of h.held.values()) if (!l.entered) ahead = true;
    for (let k = 0; k < WALK && clear < length; k++) {
      if (want.length === 0 && d > set && !ahead) break;
      const n = next(layout, at, exit);
      if (!n || n.pieceId === target) break;
      const ways = waysFrom(layout, n.pieceId, n.entry, pinned);
      if (ways.length === 0) break;
      let w = ways[0];
      if (ways.length > 1) {
        const followed = follow ? ways.filter((x) => follow(n.pieceId, x.path)) : [];
        const best = followed.length === 1 ? followed[0].option : planWay(layout, n.pieceId, n.entry, ways, target, pinned);
        // (No way on leads there: nothing set, and nothing further asked for.)
        if (best === -1) break;
        want.push({ pieceId: n.pieceId, state: best, ways: ways.length });
        w = ways[best];
        clear = 0;
      }
      const p = layout.getPiece(n.pieceId)!;
      const len = pathLength(getPieceDef(p.type, p.flipped).paths[w.path].geom);
      if (clear >= 0 && ways.length === 1) clear += len;
      d += len;
      at = n.pieceId;
      exit = w.exit;
    }
    return want;
  }
}

/** A train's length (mm), as a clear point must hold it (as sections measure it). */
function trainLength(train: Train): number {
  let len = 0;
  for (const c of train.cars) len += CAR_SPECS[c.kind].length;
  return len + COUPLER_GAP * Math.max(0, train.cars.length - 1);
}
