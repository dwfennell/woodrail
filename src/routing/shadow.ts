/**
 * The reservation core in shadow (routing redesign §4 step 2, docs/superpowers/specs/2026-11-07-routing-redesign.md):
 * what one reservation table would grant, worked out beside today's guards (sections, the router's locks, the sim's
 * gaps, signals) from where the trains are, and where the two disagree, counted by kind. It holds nothing and moves
 * nothing: it reads the sim, sections and the router, and changes none of them (trajectory hashes identical with it
 * on). Test and script only: nothing in the game imports it, so a production build has none of it.
 *
 * Every `CHECK_TICKS` it books afresh, from the trains as they stand (a snapshot: the core's answer for this moment,
 * not a second simulation that would drift from the real one):
 *
 * 1. Each train holds the pieces under it (`Sim.piecesUnder`).
 * 2. Trains in turn (moving ones first, as the core would keep what it had granted them; then those standing longest)
 *    book on from their front along their way, all or nothing, to the first waiting point (§3.3): the end of a slot
 *    they fit in (a loop road, a line end, a signal's waiting point going its way: `topologyOf`), the end of the
 *    track, or (rule 3) a joint on one-way track with a train's length of it behind, clear of points: track every train
 *    seen on it so far has run the same way (a circuit all go round one way; `dirs`). Not past a piece another train holds, a signal held at red (unless it's the waiting point's own), or
 *    `MAX_WALK` pieces. At points, a routed train's way (`planWay` to its target; another road that costs nearly as
 *    much if that one's held: a loop's other road), a hand-run one's as they lie. A train its line has no room for
 *    (the room rule, `heldForRoom`) books nothing: the rule stays in the core.
 *
 * Disagreements (`Kind`), each counted once an episode (a stand, a run, a sharing):
 * - **held-free:** a lever-on train standing `HELD_FREE_S`, not busy at a stop, that the core would let go (its booking
 *   reaches a waiting point). By what holds it today (`why`, its card's kind): #29's and #31's class.
 * - **ran-unbooked:** a train running outside any slot (between waiting points) that the core couldn't book a way on
 *   for: today let it into a stretch with no free waiting point ahead (it can't leave it).
 * - **shared-points:** two trains on one set of points or crossing (the `oneOwner` invariant's breaks, seen here too).
 * - **shared-piece:** a train come onto a plain piece another is still on (close following: the core frees track a
 *   piece at a time behind a tail, so it would wait a piece back). Granularity, not a danger.
 * - **green-unbooked:** a train at or coming to a signal that shows clear (within `SIGNAL_NEAR`), its booking failing
 *   past it: the core would show it red.
 * - **red-booked:** a train standing at a red signal `HELD_FREE_S` whose booking goes past it: the core would show it
 *   clear.
 * - **strayed:** a train's front came onto a piece off its last booking (it went another road at points than the core
 *   would have booked). Not a fault: how often the core's way and today's differ.
 */
import { CAR_SPECS, SIM_HZ, type Train } from "../sim";
import { connectorRef, getPieceDef, indexOfRef, pathExitConnector, pathLength, pieceOfRef, routeFrom } from "../track";
import { topologyOf, trainLength, type Topology } from "../economy/sections";
import type { InvariantWorld } from "../sim/invariants";
import { waysFrom } from "./graph";
import { planChoice, planWay, ROUTE_COSTS } from "./plan";

export const KINDS = ["held-free", "ran-unbooked", "shared-points", "shared-piece", "green-unbooked", "red-booked", "strayed"] as const;
export type Kind = (typeof KINDS)[number];

/** Books afresh every this many ticks (as sections' asks: 10 a second). */
export const CHECK_TICKS = 12;
/** How long (s) a train stands, free to go by the core, before it's a disagreement. */
export const HELD_FREE_S = 5;
/** The most pieces one booking walks (the doc's `RESERVE_MAX`): past it, no waiting point near enough. */
export const MAX_WALK = 80;
/** Another road at points costing up to this much more (mm) than the best is one the core may book instead (a loop's). */
const ROAD_SLACK = 2000;
/** green-unbooked: a signal this near ahead of a train's front axle (mm) is the one it's at or coming to. */
const SIGNAL_NEAR = 300;
/** How many tries (pieces walked, all roads) one booking may make. */
const MAX_STEPS = 400;

/** Why a booking failed: a piece another train holds (`by`, its key), a signal held at red, too far, or nowhere to go. */
export type Refusal = { kind: "train"; by: number; pieceId: number } | { kind: "signal"; pieceId: number } | { kind: "far" } | { kind: "room" };

/** One train's booking this check. */
export interface Booking {
  key: number;
  trainId: number;
  /** The pieces booked ahead of its front, in order, with the path along each (empty: it failed, or nothing to book). */
  pieces: { pieceId: number; path: number }[];
  ok: boolean;
  refusal: Refusal | null;
  /** Mm from its front axle to the end of the booking (ok bookings). */
  reach: number;
}

export interface ShadowOptions {
  /** The trains to book for, keyed as the invariants' (default: every train by its first engine's car id). */
  trains?: () => Iterable<{ key: number; engine: number }>;
  /** A train's card's kind (what holds it today), for held-free's `why` (default "standing"). */
  why?: (train: Train, engine: number) => string;
  /** Told of every disagreement (after it's counted). */
  onDisagree?: (d: Disagreement) => void;
}

export interface Disagreement {
  kind: Kind;
  key: number;
  tick: number;
  what: string;
  why?: string;
}

interface Memo {
  front: number;
  stoodFree: number;
  freeSaid: boolean;
  runSaid: boolean;
  redStood: number;
  redSaid: boolean;
  greenSaid: number;
  booked: Set<number>;
  shared: Set<string>;
  seen: number;
}

/** The reservation table in shadow. Call `tick()` after each sim and economy tick. */
export class ReservationShadow {
  readonly counts: Record<Kind, number> = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  /** held-free by what holds the train today (its card's kind). */
  readonly heldFreeBy = new Map<string, number>();
  /** ran-unbooked and green-unbooked by what the core's booking met (a train, a held signal, too far). */
  readonly refusedBy = new Map<string, number>();
  /** The first few of each kind, in words. */
  readonly first: Record<Kind, string[]> = Object.fromEntries(KINDS.map((k) => [k, [] as string[]])) as Record<Kind, string[]>;
  /** Bookings worked out (all trains, all checks), and the time they took (ms): the core's cost. */
  bookings = 0;
  ms = 0;
  /** The table as of the last check: each held piece's owner (a train's key). */
  readonly owner = new Map<number, number>();
  readonly last = new Map<number, Booking>();
  private readonly memo = new Map<number, Memo>();
  private ticks = 0;
  /** Rule 3: per piece, the ends trains have been seen heading for on it (a bit each): one bit, one-way so far. */
  private readonly dirs = new Map<number, number>();

  constructor(
    private readonly world: InvariantWorld,
    private readonly opts: ShadowOptions = {},
  ) {}

  /** One tick: every `CHECK_TICKS`, book afresh and compare. */
  tick(): void {
    if (this.ticks++ % CHECK_TICKS !== 0) return;
    const t0 = performance.now();
    this.check();
    this.ms += performance.now() - t0;
  }

  private check(): void {
    const { sim } = this.world;
    const now = this.ticks;
    const trains: { key: number; engine: number; t: Train }[] = [];
    for (const { key, engine } of this.opts.trains?.() ?? this.allTrains()) {
      const f = sim.findCar(engine);
      if (f && !f.train.derailed && f.train.bogies.length > 0) trains.push({ key, engine, t: f.train });
    }
    // 1. Under each train.
    this.owner.clear();
    const shares: { a: number; b: number; pieceId: number }[] = [];
    for (const x of trains)
      for (const p of sim.piecesUnder(x.t.id)) {
        const o = this.owner.get(p);
        if (o !== undefined && o !== x.key) shares.push({ a: o, b: x.key, pieceId: p });
        else this.owner.set(p, x.key);
      }
    // (Rule 3: the way each train is heading on the pieces its axles are on.)
    for (const x of trains) {
      const net = this.world.drive(x.t);
      if (net === 0) continue;
      for (const b of x.t.bogies) {
        const p = this.world.layout.getPiece(b.pieceId);
        if (!p) continue;
        const exit = pathExitConnector(getPieceDef(p.type, p.flipped), b.pathIndex, net > 0 ? b.reversed : !b.reversed);
        if (exit >= 0) this.dirs.set(b.pieceId, (this.dirs.get(b.pieceId) ?? 0) | (1 << exit));
      }
    }
    // 2. Bookings, moving trains first, then the longest standing.
    const order = trains.map((x) => ({ ...x, m: this.memoOf(x.key, now) }));
    order.sort((a, b) => (b.t.speed > 0 ? 1 : 0) - (a.t.speed > 0 ? 1 : 0) || b.m.stoodFree + b.m.redStood - (a.m.stoodFree + a.m.redStood) || a.key - b.key);
    this.last.clear();
    for (const x of order) {
      const booking = this.book(x.t, x.key, x.engine);
      this.bookings++;
      this.last.set(x.key, booking);
      if (booking.ok) for (const p of booking.pieces) this.owner.set(p.pieceId, x.key);
    }
    // 3. Compare.
    for (const x of order) this.compare(x.t, x.key, x.engine, x.m, this.last.get(x.key)!);
    this.compareShares(shares, trains, now);
    if (this.memo.size > 64) for (const [k, m] of this.memo) if (now - m.seen > 10 * SIM_HZ) this.memo.delete(k);
  }

  private memoOf(key: number, now: number): Memo {
    let m = this.memo.get(key);
    if (!m) this.memo.set(key, (m = { front: -1, stoodFree: 0, freeSaid: false, runSaid: false, redStood: 0, redSaid: false, greenSaid: 0, booked: new Set(), shared: new Set(), seen: now }));
    m.seen = now;
    return m;
  }

  /**
   * A train's booking: from its front, along its way, all or nothing, to the first waiting point past the slot it's in
   * (if any). Reads the table as it is (others' bookings this check, and what's under every train).
   */
  book(t: Train, key: number, engine: number): Booking {
    const out: Booking = { key, trainId: t.id, pieces: [], ok: false, refusal: null, reach: 0 };
    const { sections, layout } = this.world;
    if (sections.heldForRoom(engine)) {
      out.refusal = { kind: "room" };
      return out;
    }
    const topo = topologyOf(layout, trainLength(t));
    const forward = this.world.drive(t) >= 0;
    const b = forward ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    const reversed = forward ? b.reversed : !b.reversed;
    const p = layout.getPiece(b.pieceId);
    if (!p) return out;
    const def = getPieceDef(p.type, p.flipped);
    const len = pathLength(def.paths[b.pathIndex].geom);
    const startSlot = topo.slotOf.get(b.pieceId) ?? -1;
    const routed = this.world.routed(engine);
    const target = routed ? this.world.target(engine) : -1;
    const walk: Walk = { steps: 0, refusal: null, length: trainLength(t) };
    // (Rule 3: a train standing wholly on one-way plain track has its length of it behind its front already.)
    let run = walk.length;
    for (const id of this.world.sim.piecesUnder(t.id)) if (!this.oneWayPlain(id)) run = 0;
    const path: { pieceId: number; path: number }[] = [];
    const reach = { mm: forward ? len - b.s : b.s };
    const done = this.walkOn(topo, key, b.pieceId, b.pathIndex, reversed, startSlot, target, path, walk, reach, 0, run);
    out.ok = done;
    out.pieces = done ? path : [];
    out.refusal = done ? null : (walk.refusal ?? { kind: "far" });
    out.reach = reach.mm;
    return out;
  }

  /**
   * Walk on from a piece's exit (`pieceId`, `path`, `reversed`: as a cursor heading out), booking into `out`, till a
   * waiting point. Tries another road at points (routed trains, a road costing nearly the best) when one fails.
   */
  private walkOn(topo: Topology, key: number, pieceId: number, pathIndex: number, reversed: boolean, inSlot: number, target: number, out: { pieceId: number; path: number }[], walk: Walk, reach: { mm: number }, depth: number, run: number): boolean {
    const { layout } = this.world;
    const piece = layout.getPiece(pieceId)!;
    const def = getPieceDef(piece.type, piece.flipped);
    const exit = pathExitConnector(def, pathIndex, reversed);
    // (The end of the track: a buffer, an open end. Always a waiting point: the train turns there.)
    if (exit === -1) return true;
    // (Rule 3: one-way plain track, a train's length of it behind this joint: a waiting point.)
    if (depth > 0) {
      run = def.paths.length === 1 && !def.gated && this.dirs.get(pieceId) === 1 << exit ? run + pathLength(def.paths[pathIndex].geom) : 0;
      if (run >= walk.length) return true;
    }
    const ref = connectorRef(pieceId, exit);
    const mark = layout.signalAt(ref);
    // (Leaving a slot it fits in, not the one it started in, going its way: a waiting point reached.)
    const slotId = topo.slotOf.get(pieceId) ?? -1;
    if (slotId !== -1 && slotId !== inSlot && depth > 0) {
      const joined = layout.joinedConnector(ref);
      const nextSlot = joined === -1 ? -1 : (topo.slotOf.get(pieceOfRef(joined)) ?? -1);
      if (nextSlot !== slotId) {
        const slot = topo.slots[slotId];
        if (slot.kind !== "signal" || slot.mark === ref) return true;
      }
    }
    // (A signal held at red, or set Always red: the booking can't pass it, unless this is its waiting point's end.)
    if (mark && (mark.mode === "red" || mark.held)) {
      walk.refusal = { kind: "signal", pieceId };
      return false;
    }
    const joined = layout.joinedConnector(ref);
    if (joined === -1) return true;
    const nextId = pieceOfRef(joined);
    const entry = indexOfRef(joined);
    if (++walk.steps > MAX_STEPS || out.length >= MAX_WALK) {
      walk.refusal = { kind: "far" };
      return false;
    }
    const o = this.owner.get(nextId);
    if (o !== undefined && o !== key) {
      walk.refusal = { kind: "train", by: o, pieceId: nextId };
      return false;
    }
    const nextPiece = layout.getPiece(nextId);
    if (!nextPiece) return true;
    const nd = getPieceDef(nextPiece.type, nextPiece.flipped);
    const ways = waysFrom(layout, nextId, entry);
    if (ways.length === 0) return true;
    let tries: { path: number }[];
    if (ways.length === 1) tries = ways;
    else if (target === -1) {
      // (Hand-run: as the points lie, as the sim's `routeFrom` picks.)
      const step = { pieceId: 0, pathIndex: 0, reversed: false };
      tries = routeFrom(layout, pieceId, exit, step) ? [{ path: step.pathIndex }] : [];
    } else {
      const best = planWay(layout, nextId, entry, ways, target);
      tries = best === -1 ? [ways[0]] : [ways[best]];
      if (best !== -1) {
        const costs: number[] = [];
        planChoice(layout, nextId, true, ways, target, ROUTE_COSTS, costs);
        for (const w of ways) if (w.option !== best && costs[w.option] <= costs[best] + ROAD_SLACK) tries.push(w);
      }
    }
    const mark0 = out.length;
    const mm0 = reach.mm;
    for (const w of tries) {
      const path = nd.paths[w.path];
      const rev = path.from !== entry;
      out.push({ pieceId: nextId, path: w.path });
      reach.mm += pathLength(path.geom);
      if (this.walkOn(topo, key, nextId, w.path, rev, inSlot, target, out, walk, reach, depth + 1, run)) return true;
      out.length = mark0;
      reach.mm = mm0;
    }
    return false;
  }

  /** Rule 3: plain track (one path) every train seen on it has run the same way. */
  private oneWayPlain(pieceId: number): boolean {
    const p = this.world.layout.getPiece(pieceId);
    if (!p) return false;
    const def = getPieceDef(p.type, p.flipped);
    const d = this.dirs.get(pieceId) ?? 0;
    return def.paths.length === 1 && !def.gated && d !== 0 && (d & (d - 1)) === 0;
  }

  private compare(t: Train, key: number, engine: number, m: Memo, booking: Booking): void {
    const { sim, layout } = this.world;
    const net = this.world.drive(t);
    const busy = this.world.busy?.(t, engine) ?? false;
    const front = (net >= 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId;
    // strayed: its front onto a piece off its last booking.
    if (front !== m.front) {
      if (m.front !== -1 && m.booked.size > 0 && !m.booked.has(front) && t.speed > 0) this.say("strayed", key, `${this.label(t)} went onto piece ${front}, off its booking`);
      m.front = front;
    }
    if (booking.ok) m.booked = new Set(booking.pieces.map((p) => p.pieceId));
    const standing = t.speed === 0 && net !== 0 && !busy && t.turnback < 0;
    // held-free.
    if (standing && booking.ok && booking.pieces.length > 0) {
      m.stoodFree += CHECK_TICKS;
      if (!m.freeSaid && m.stoodFree >= HELD_FREE_S * SIM_HZ) {
        m.freeSaid = true;
        const why = this.opts.why?.(t, engine) ?? "standing";
        this.heldFreeBy.set(why, (this.heldFreeBy.get(why) ?? 0) + 1);
        this.say("held-free", key, `${this.label(t)} stood ${HELD_FREE_S} s (${why}) on piece ${front}; the core books it ${booking.pieces.length} pieces on`, why);
      }
    } else {
      m.stoodFree = 0;
      m.freeSaid = false;
    }
    // ran-unbooked: running between waiting points with no way on.
    const topo = topologyOf(layout, trainLength(t));
    const inSlot = topo.slotOf.has(front);
    if (t.speed > 0 && !booking.ok && !inSlot && booking.refusal?.kind !== "room") {
      if (!m.runSaid) {
        m.runSaid = true;
        this.refused(booking.refusal);
        this.say("ran-unbooked", key, `${this.label(t)} running on piece ${front} with no way on to a waiting point (${refusalText(booking.refusal)})`);
      }
    } else if (booking.ok || t.speed === 0) m.runSaid = false;
    // Signals: the one it's at or coming to.
    if (layout.signalCount === 0) return;
    const sig = this.signalAhead(t, net >= 0);
    const g = sig && sim.signalList().find((x) => x.key === sig.key);
    if (sig && g && g.clear && !booking.ok && booking.refusal?.kind !== "room" && this.pastSignal(booking, sig)) {
      if (m.greenSaid !== sig.key) {
        m.greenSaid = sig.key;
        this.refused(booking.refusal);
        this.say("green-unbooked", key, `${this.label(t)} ${Math.round(sig.dist)} mm from signal ${sig.key}, which shows clear; the core can't book past it (${refusalText(booking.refusal)})`);
      }
    } else if (!sig || sig.key !== m.greenSaid) m.greenSaid = 0;
    const atRed = t.speed === 0 && sim.redSignalKeyAhead(t.id) !== -1;
    if (atRed && booking.ok && booking.pieces.length > 0) {
      m.redStood += CHECK_TICKS;
      if (!m.redSaid && m.redStood >= HELD_FREE_S * SIM_HZ) {
        m.redSaid = true;
        this.say("red-booked", key, `${this.label(t)} stood ${HELD_FREE_S} s at red signal ${sim.redSignalKeyAhead(t.id)}; the core books it past`);
      }
    } else {
      m.redStood = 0;
      m.redSaid = false;
    }
  }

  /** Did the booking fail at or past this signal (its refusal beyond the signal's joint, not short of it)? */
  private pastSignal(booking: Booking, sig: { key: number; pieceId: number }): boolean {
    const r = booking.refusal;
    if (!r || r.kind === "room" || r.kind === "far") return true;
    // (Refused on a piece before the signal's: that's not the signal's to show.)
    return r.pieceId !== sig.pieceId || r.kind === "signal";
  }

  /** The signal (a mark) within `SIGNAL_NEAR` ahead of a train's leading axle, facing it, by key; or null. */
  private signalAhead(t: Train, forward: boolean): { key: number; pieceId: number; dist: number } | null {
    const { layout } = this.world;
    const b = forward ? t.bogies[0] : t.bogies[t.bogies.length - 1];
    let at = b.pieceId;
    let path = b.pathIndex;
    let rev = forward ? b.reversed : !b.reversed;
    let p = layout.getPiece(at);
    if (!p) return null;
    let def = getPieceDef(p.type, p.flipped);
    const inset = CAR_SPECS[(forward ? t.cars[0] : t.cars[t.cars.length - 1]).kind].bogieInset;
    let dist = (forward ? pathLength(def.paths[path].geom) - b.s : b.s) - inset - 6;
    for (let k = 0; k < 8 && dist <= SIGNAL_NEAR; k++) {
      const exit = pathExitConnector(def, path, rev);
      if (exit === -1) return null;
      const mark = layout.signalAt(connectorRef(at, exit));
      if (mark) return { key: -1 - mark.id, pieceId: at, dist: Math.max(0, dist) };
      const step = { pieceId: 0, pathIndex: 0, reversed: false };
      if (!routeFrom(layout, at, exit, step)) return null;
      at = step.pieceId;
      path = step.pathIndex;
      rev = step.reversed;
      p = layout.getPiece(at)!;
      def = getPieceDef(p.type, p.flipped);
      dist += pathLength(def.paths[path].geom);
    }
    return null;
  }

  /** shared-points and shared-piece: trains under the same piece, once a sharing. */
  private compareShares(shares: { a: number; b: number; pieceId: number }[], trains: { key: number; t: Train }[], now: number): void {
    const { layout } = this.world;
    const live = new Set<string>();
    for (const s of shares) {
      const k = `${s.pieceId}:${Math.min(s.a, s.b)}:${Math.max(s.a, s.b)}`;
      live.add(k);
      const m = this.memoOf(s.b, now);
      if (m.shared.has(k)) continue;
      m.shared.add(k);
      const p = layout.getPiece(s.pieceId);
      const def = p && getPieceDef(p.type, p.flipped);
      const points = !!def && def.paths.length > 1 && !def.gated && !def.signal;
      const name = (key: number) => {
        const x = trains.find((y) => y.key === key);
        return x ? this.label(x.t) : `train ${key}`;
      };
      this.say(points ? "shared-points" : "shared-piece", s.b, `${name(s.b)} and ${name(s.a)} both on ${points ? "points" : "piece"} ${s.pieceId}`);
    }
    for (const m of this.memo.values()) for (const k of m.shared) if (!live.has(k)) m.shared.delete(k);
  }

  private refused(r: Refusal | null): void {
    const k = r ? r.kind : "none";
    this.refusedBy.set(k, (this.refusedBy.get(k) ?? 0) + 1);
  }

  private say(kind: Kind, key: number, what: string, why?: string): void {
    this.counts[kind]++;
    if (this.first[kind].length < 4) this.first[kind].push(`${(this.world.sim.ticks / SIM_HZ).toFixed(1)} s: ${what}`);
    this.opts.onDisagree?.({ kind, key, tick: this.world.sim.ticks, what, why });
  }

  private label(t: Train): string {
    const e = t.cars.find((c) => c.kind === "engine");
    return `engine ${e?.id ?? t.cars[0].id}`;
  }

  private *allTrains(): Iterable<{ key: number; engine: number }> {
    const { sim } = this.world;
    for (const id of sim.trainIds()) {
      const t = sim.getTrain(id)!;
      const e = t.cars.find((c) => c.kind === "engine") ?? t.cars[0];
      yield { key: e.id, engine: e.id };
    }
  }

  /** Counts in words: each kind's count, held-free by what held it, refusals by what met the booking. */
  summary(): string {
    const kinds = KINDS.map((k) => `${k} ${this.counts[k]}`).join(", ");
    const by = [...this.heldFreeBy].map(([k, n]) => `${k} ${n}`).join(", ");
    const ref = [...this.refusedBy].map(([k, n]) => `${k} ${n}`).join(", ");
    return `${kinds}${by ? `; held-free by ${by}` : ""}${ref ? `; refused by ${ref}` : ""}`;
  }
}

interface Walk {
  steps: number;
  refusal: Refusal | null;
  /** The train's length (mm): rule 3's run of one-way track behind a joint. */
  length: number;
}

function refusalText(r: Refusal | null): string {
  if (!r) return "no way";
  if (r.kind === "train") return `piece ${r.pieceId} held by engine ${r.by}`;
  if (r.kind === "signal") return `a signal held at red on piece ${r.pieceId}`;
  if (r.kind === "far") return `no waiting point within ${MAX_WALK} pieces`;
  return "no room on its line";
}

