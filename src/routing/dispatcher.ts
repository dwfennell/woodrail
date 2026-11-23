/**
 * The dispatcher, acting (dispatcher spec §8 step 2, docs/superpowers/specs/2026-11-18-dispatcher.md): behind a setting
 * (`Economy.useDispatcher`), off by default. With it on, the one place that grants track to routed trains:
 *
 * - **Holds.** Each routed, lever-on train has a hold: a node on its booked way (`stretch.ts`) it may run to. Its speed
 *   cap (`cap`) stands it `STAND_SHORT` short of the hold's end, braking as for anything. A hold never runs past a line
 *   end's turn (the sim turns it there), and v1 doesn't close up behind a tail (part pieces stay a judgement only).
 * - **Grants.** On an event (a train's piece, stand, stop or lever changed, as the shadow looks), each routed train
 *   standing at its hold's end, or coming within braking distance of it, not busy at a stop, asks: the per-stretch search
 *   (`search`, `withDetours`) decides, the trains granted counted where their holds end and the track up to there taken.
 *   A grant moves its hold's end to the move's waiting point (a detour or a loop's other road steered by `steerHint`'s
 *   aim), fair turns as the shadow's.
 * - **Signals** read the holds (§R 3.6): a signal at a train's hold's end shows red (`gateAt`).
 *
 * What it replaces while on: sections' cap, steering hint and signal gate (`Economy.capFor`, the router's `granted`,
 * `Sim.signalGate`). What stays: the depot's and kit stops' caps, the router's points waits and the sim's signal blocks
 * (a safety net), stall detection, line ends turning. Hand-run and parked trains are never held or steered (§4.4): they
 * stand in the search as track that's taken. Back-ups are not acted on yet.
 *
 * Event-driven: it looks every `LOOK_TICKS` for a change in what it reads, and decides only then; `cap` is a lookup. A
 * paused or idle game costs a signature compare a look.
 */
import { CAR_SPECS, flipCursor, stopDistance, type Cursor, type Sim, type Train } from "../sim";
import { ACCELERATION } from "../sim/brakes";
import { connectorRef, getPieceDef, pathExitConnector, pathLength, pieceOfRef, indexOfRef, pointsWayFrom, type Layout } from "../track";
import { next, waysFrom } from "./graph";
import { isPoints } from "./router";
import { passingOf } from "./blocks";
import { STAND_SHORT } from "../economy/sections";
import { blockerOf, bodyOf, buildTrain, PLAN_FROM_ROAD, DISPATCH_STATES, FAIR_TURNS, relocate, REROUTE_AFTER_S, search, snapsOf, stretchOf, withDetours, type DTrain, type RouteView, type Snap } from "./stretch";

/** §13.5 step 2, the dispatcher owning the points on its grants: on, unless OWNER=0 (for comparing runs). */
export const OWNER = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).OWNER !== "0" };

/** The head-on-ahead check (§13.5 step 3): on, unless HEAD_AHEAD=0. */
export const HEAD_AHEAD = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).HEAD_AHEAD !== "0" };

/** Single lines booked whole (§13.5 step 3, the spec's §2.2a one at a time): on, unless SINGLE=0. */
/** A train waits in a dead end of its own while the one it turns in is busy (`deadEndBy`, own-08); DEAD=0: not. */
export const DEAD = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).DEAD !== "0" };
export const SINGLE = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).SINGLE !== "0" };
/** The most pieces a single line runs (a longer run, or a ring of plain track with no points: not booked). */
const SINGLE_MAX = 400;

/** `headOnAhead`'s ways, per booked way (its `pos`, shared by the copies `relocate` makes) and node. */
/** `deadTarget` per booked way and node. */
const deadCache = new WeakMap<Int32Array[], Map<number, number>>();
const aheadCache = new WeakMap<Int32Array[], Map<number, Map<number, number>>>();

/** A stuck train searches for a detour at most this often (s). */
const DETOUR_EVERY_S = 6;
/** §13.6.2: how many pieces of another train's way on past its grant count as its (`heldOf`). */
const CLAIM_AHEAD = Number(((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).CLAIM_AHEAD ?? 8);
/**
 * §13.6.2: another train holds only what it stands on, is granted, and `CLAIM_AHEAD` pieces on (HELD_ONLY=1); else its
 * way on to its next passing place (the default, round 1's).
 */
export const HELD_ONLY = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).HELD_ONLY === "1" };
/** How long a train stands refused by the reservation book before it goes anyway (§13.6.2). */
const RESERVE_TIMEOUT_S = Number(((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).RESERVE_TIMEOUT_S ?? 10);
/** §13.6.2's reservation book (`reservedBy`): off unless RESERVE=1 (a prototype under measure). */
export const RESERVE = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).RESERVE === "1" };
/** §13.6's safety check over the stretch (`safeOrder`): off unless SAFE=1 (a prototype under measure). */
export const SAFE = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).SAFE === "1" };
/**
 * `headOnAhead`'s admission check on the leg after a move's stop: off unless ADMIT2=1 (measured: own-08, own-10,
 * complex-3 no better, rowan-2 −56, own-03 −5; dispatcher spec §13, the deeper lookahead).
 */
export const ADMIT2 = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).ADMIT2 === "1" };
/** `headOnAhead`: another's way runs on through the stop its hold ends at (NEXT_LEG=0: not). */
export const NEXT_LEG = { on: ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).NEXT_LEG !== "0" };
/** How long a train waits at a dead end of its own for another heading into the one it turns in (`deadEndBy`). */
const DEAD_PATIENCE_S = 20;

/** How often (ticks) it looks for events (sections' asks' rate). */
const LOOK_TICKS = 12;
/** A hold ending at a line end runs on this much (mm) past it: to the end of the track, where the sim turns it. */
const TO_END = 1000;
/** A granted train standing short of its hold's end this long (s) gives the rest back. */
const GIVE_BACK_S = 3;
/** A granted train standing short this long (s) has the signal it faces shown red (it isn't going yet). */
const GATE_SHORT_S = 2;
/** A waiting train counts once more in the search's goal for each this long (s) it has stood (fair turns). */
const WEIGH_S = 20;
/** A train asking, not decided this long (ticks), is decided again though nothing changed (2 s). */
const RETRY_TICKS = 240;
/** A train asks for its next move this far (mm) before it would have to brake for its hold's end. */
const ASK_LOOK = 200;

export interface DispatcherHost {
  readonly layout: Layout;
  readonly sim: Sim;
  route: RouteView;
  /** Busy where it stands by its own choice (at a stop loading, its dwell; turning back): it asks for nothing. */
  busy(train: Train, engine: number): boolean;
  /** A train's net drive toward its front. */
  drive(train: Train): number;
  /** Told of each grant (the router steers it at once). */
  granted?(engine: number): void;
  /**
   * What holds a train short of its grant, if anything does but the dispatcher: the router's points wait ("points"), or
   * the sim's own guards (its `HeldHow`: "signal", "follow", "nose", "side", "cross", "turn"); null: nothing seen. For
   * the count of grants overruled (`overruled`: dispatcher spec §13.5 step 1).
   */
  overruled?(train: Train): string | null;
  /** The train (its engine) the router's points wait for this one names, or −1 (none). */
  pointsWaitBy?(engine: number): number;
}

interface Hold {
  /** Its booked way, as last built (or moved along). */
  t: DTrain;
  sig: string;
  /** The node it may run to. */
  end: number;
  /** The nodes from where it stands to `end` (the granted way), and per front piece on them the run (mm) beyond that piece's far end to the hold's end. */
  path: number[];
  rem: Map<number, number>;
  /** Points on the way: the piece, the ends it's run in and out by, and its run (mm) to the hold's end from its near end. */
  points: { p: number; en: number; ex: number; from: number }[];
  /** Steered by: a piece on a loop road or detour it's granted, the router's aim till it's passed (−1: none). */
  aim: number;
  /** Standing waiting since (tick; −1: not). */
  stood: number;
  passed: number;
  trainId: number;
  /** Held with its move's way taken: the train (its key) in the way (−1: not so held). */
  waitsOn: number;
  /** When it was last decided (tick). */
  decided: number;
  /** Standing short of its hold's end since (tick; −1: not). */
  short: number;
  /** When it last searched for a detour (tick). */
  detourAt?: number;
  /** `pathRefs`, and the holds' version it was worked out at. */
  refs?: number[];
  refsVer?: number;
  /** The train it waits for to clear a single line it's not granted onto (−1: none), for its card. */
  singleWait?: number;
}

/** §13.6: a train's way (piece → the end its front comes onto it by) along its booked way from node `from`, its next two legs. */
const way2Cache = new WeakMap<Int32Array[], Map<number, Map<number, number>>>();
function way2(x: DTrain, from: number): Map<number, number> {
  let byAt = way2Cache.get(x.pos);
  if (!byAt) way2Cache.set(x.pos, (byAt = new Map()));
  const hit = byAt.get(from);
  if (hit) return hit;
  const out = new Map<number, number>();
  byAt.set(from, out);
  const stops = x.arrivals.filter((a) => x.order[a] > x.order[from]);
  let s = 0;
  let left = 2;
  for (let i = from, n = 0; i >= 0 && n < 600; n++) {
    for (const p of x.pos[i]) if (!out.has(p)) out.set(p, x.frontEn[i]);
    if (i === (s < stops.length ? stops[s] : x.main - 1) || (i !== from && x.turned[i])) {
      if (--left <= 0 || i === x.main - 1) break;
      if (s < stops.length && i === stops[s]) s++;
    }
    i = x.succ[i][0] ?? -1;
  }
  return out;
}

const capAt: Cursor = { pieceId: -1, pathIndex: 0, reversed: false, s: 0 };

export class Dispatcher {
  /** Decisions made, grants, and each decision's cost (ms). */
  decisions = 0;
  grants = 0;
  detours = 0;
  /** Grants refused by the reservation book (§13.6.2). */
  reservedRefused = 0;
  /** Grants refused by the safety check (§13.6). */
  unsafeRefused = 0;
  /** Grants refused as ending nose to nose with another train. */
  noseRefused = 0;
  /**
   * Seconds granted trains stood short of their grants, by what held them (`DispatcherHost.overruled`; "other": nothing
   * seen): where the layout's own guards and the dispatcher disagree (§13.5 step 1).
   */
  readonly overruled = new Map<string, number>();
  /** Holds by why: its move's way taken ("blocked"), or another goes first ("order"). */
  heldBlocked = 0;
  heldOrder = 0;
  /** A few decisions in words (for debugging a run). */
  readonly notes: string[] = [];
  /** Keep `notes` and `offNotes` (debugging a run: they cost a few strings a decision). */
  debug = false;
  offWay = 0;
  /** Holds given back (granted, but held short by something else). */
  givenBack = 0;
  readonly offNotes: string[] = [];
  /** Per train: grants, holds. */
  readonly perTrain = new Map<number, [number, number]>();
  readonly decisionMs: number[] = [];
  private readonly holdsBy = new Map<number, Hold>();
  private sigs = new Map<number, string>();
  /** The signal at each held train's hold's end (joint ref → train id), for `gateAt`. */
  private gate = new Map<number, number>();
  private gateVer = 0;
  /** The sim's trains (ids) at the last look: one new since (put down by hand, or made by a coupling) cuts back any hold over it. */
  private seen = new Set<number>();

  constructor(private readonly host: DispatcherHost) {}

  /** Call after each sim tick. */
  tick(): void {
    const { sim, layout } = this.host;
    if (sim.ticks % LOOK_TICKS) return;
    let changed = false;
    const live = new Set<number>();
    const asking: number[] = [];
    for (const t of sim.trains()) {
      if (t.derailed) continue;
      const engine = t.cars.find((c) => c.kind === "engine");
      if (!engine) continue;
      live.add(engine.id);
      const r = this.host.route(engine.id);
      const front = (t.speed >= 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]).pieceId;
      const busy = !!r && engine.lever !== 0 && this.host.busy(t, engine.id);
      const sig = `${front}.${t.bogies[t.bogies.length - 1].pieceId}.${t.speed > 0 ? 1 : 0}.${r ? `${r.next}.${r.at ? 1 : 0}` : "-"}.${engine.lever}.${busy ? 1 : 0}`;
      if (this.sigs.get(engine.id) !== sig) {
        this.sigs.set(engine.id, sig);
        changed = true;
      }
      const h = this.holdsBy.get(engine.id);
      // (Its train's id, kept current: it changes (a turn, a coupling), and signals ask by it (`clearFor`). Stale, a
      // granted train's signal fell back to the sim's own rule: red for good on own-07.)
      if (h && h.trainId !== t.id) {
        h.trainId = t.id;
        this.holdVer++;
      }
      if (!r || engine.lever === 0 || busy) {
        if (h) h.stood = -1;
        continue;
      }
      // (Granted but standing short of its hold's end (held by something else: a red signal's block, points): after
      // `GIVE_BACK_S` it gives the rest of its hold back, and asks again from where it stands.)
      if (h && t.speed === 0 && h.end !== h.t.at) {
        // (Overruled, counted: once a look, its share of the time.)
        if (this.host.overruled) {
          let why = this.host.overruled(t) ?? "other";
          // (At a signal the dispatcher itself shows red for it (standing short, `GATE_SHORT_S`): its own gate, not
          // the layout's.)
          if (why === "signal") for (const id of this.gate.values()) if (id === t.id) why = "own-gate";
          // (Nothing the layout's: its own cap. Short of points on its way that don't lie for it yet ("unset"), or not.)
          if (why === "other") {
            const g = this.gapTo(t, h);
            why = this.host.busy(t, engine.id) ? "busy" : h.points.some((q) => !this.liesFor(q.p, q.en, q.ex)) ? "unset" : g <= 30 ? "at-end" : g === Infinity ? "off-way" : "own-cap";
          }
          this.overruled.set(why, (this.overruled.get(why) ?? 0) + LOOK_TICKS / 120);
        }
        // (Held short by the router at points it couldn't have (another train took them first): the grant back at once,
        // waiting on that one. Its signal then shows red for it, as for any hold (user-2026-11-21: held at a green one).)
        // (Or by the sim's own guard nose to nose with another train (its grant ran up against that one's front): the
        // same, waiting on that one (user-2026-11-21 seed 3: held at a green signal by a train facing it beyond).)
        if (OWNER.on && sim.heldHow(t.id) === "nose") {
          const byId = sim.heldBy(t.id);
          const bt = byId === null ? undefined : sim.getTrain(byId);
          const be = bt?.cars.find((c) => c.kind === "engine");
          if (be && be.id !== engine.id) {
            this.setHold(h, h.t.at, []);
            h.waitsOn = be.id;
            this.givenBack++;
            h.short = -1;
            changed = true;
            continue;
          }
        }
        if (OWNER.on && this.host.pointsWaitBy) {
          const by = this.host.pointsWaitBy(engine.id);
          if (by >= 0 && by !== engine.id) {
            this.setHold(h, h.t.at, []);
            h.waitsOn = by;
            this.givenBack++;
            h.short = -1;
            changed = true;
            continue;
          }
        }
        if (h.short < 0) h.short = sim.ticks;
        else if (sim.ticks - h.short >= GIVE_BACK_S * 120) {
          this.setHold(h, h.t.at, []);
          this.givenBack++;
          h.short = -1;
          changed = true;
        }
      } else if (h) h.short = -1;
      // (Asks: standing at its hold's end, or coming within braking distance of it.)
      const gap = h ? this.gapTo(t, h) : 0;
      if (!h || gap <= stopDistance(t.speed) + ASK_LOOK) {
        if (h && t.speed === 0 && h.stood < 0) h.stood = sim.ticks;
        asking.push(engine.id);
      } else if (h) h.stood = -1;
    }
    if (this.cutForNew()) changed = true;
    for (const e of [...this.holdsBy.keys()])
      if (!live.has(e)) {
        this.holdsBy.delete(e);
        this.sigs.delete(e);
        changed = true;
      }
    // (No event: but a train asking that hasn't been decided for `RETRY_TICKS` asks again (a detour's or a fair turn's
    // time may have come; nothing else changes while every train stands).)
    this.refreshGate();
    if (asking.length === 0) return;
    if (!changed && !asking.some((e) => sim.ticks - (this.holdsBy.get(e)?.decided ?? -Infinity) >= RETRY_TICKS)) return;
    // The event: each asking train decided, longest waiter first.
    const snaps = snapsOf(layout, sim, this.host.route);
    const ts = this.trainsOf(snaps);
    this.oneWay = oneWayOf(ts);
    asking.sort((a, b) => (this.holdsBy.get(a)?.stood ?? Infinity) - (this.holdsBy.get(b)?.stood ?? Infinity) || a - b);
    for (const e of asking) this.decide(ts, snaps, e);
    this.refreshGate();
  }

  /** A train new on the track (put down by hand where another was granted the way): each hold over a piece it's on cut
   * back to the node before (the held train brakes for it, as for any hold's end). True if one was. */
  private cutForNew(): boolean {
    const now = new Set<number>();
    let fresh: Set<number> | null = null;
    for (const t of this.host.sim.trains()) {
      now.add(t.id);
      if (this.seen.has(t.id)) continue;
      fresh ??= new Set();
      for (const b of t.bogies) fresh.add(b.pieceId);
    }
    this.seen = now;
    if (!fresh) return false;
    let cut = false;
    for (const h of this.holdsBy.values()) {
      if (fresh.size === 0 || !now.has(h.trainId)) continue;
      const k = h.path.findIndex((i, n) => n > 0 && h.t.pos[i].some((x) => fresh!.has(x)));
      if (k < 0) continue;
      this.setHold(h, h.path[k - 1], h.path.slice(0, k));
      cut = true;
    }
    return cut;
  }

  /** Each train's booked way, moved along from the last, or built afresh; its hold kept (or started where it stands). */
  private trainsOf(snaps: Snap[]): DTrain[] {
    const { layout, sim } = this.host;
    return snaps.map((s) => {
      const sig = `${s.stops?.join(",") ?? "-"}.${s.next}.${s.at ? 1 : 0}.${s.lever ? 1 : 0}`;
      const h = this.holdsBy.get(s.key);
      if (h && h.sig === sig) {
        // (Along its granted way first: a detour and its booked way can stand alike where they part.)
        const body = bodyOf(layout, s);
        const onPath = h.path.find((n) => h.t.pos[n].length === body.length && body.every((p, q) => h.t.pos[n][q] === p));
        const moved = onPath !== undefined ? (onPath === h.t.at ? h.t : { ...h.t, at: onPath }) : relocate(h.t, body);
        // (Moved along to the end of its way as last built, with nowhere on (it ran its way out, its route the same): its
        // way built afresh. Kept, it was never granted anything again: rowan-1's Pepper, "held up" by nobody, 60 s.)
        // (Its front on points, its way out by a road its axles aren't on: built afresh, from the road it's on
        // (`buildTrain`; complex-1: kept, it stood at the signal on its own road for 20 minutes).)
        if (moved && moved.succ[moved.at].length > 0 && !(PLAN_FROM_ROAD.on && this.pinnedFront(moved) === null)) {
          h.t = moved;
          const k = h.path.indexOf(moved.at);
          if (k > 0) {
            h.path = h.path.slice(k);
            this.holdVer++;
          }
          else if (k < 0 && moved.at !== h.end) {
            // (Off its granted way: hold it where it is.)
            this.setHold(h, moved.at, []);
          }
          return moved;
        }
      }
      const t = buildTrain(layout, s);
      if (!s.stops || !s.lever) return t;
      const trainId = sim.findCar(s.key)?.train.id ?? -1;
      if (h) {
        const oldT = h.t;
        const oldPath = h.path;
        h.t = t;
        h.sig = sig;
        h.trainId = trainId;
        // (Rebuilt (its route moved on, it turned, it left its way): its old grant kept as far as the new way runs over
        // the same joints the same way (a train running on as its route moves on doesn't stand dead mid-way, past a
        // signal's stop point); never further: carried whole, an old end could hand it track it was never granted (a
        // turned train's old end lies the other way, and none of its joints match).)
        const refs = new Set<number>();
        // (The joints it was granted past: each node's but the last's, its hold's end.)
        for (let k = 0; k + 1 < oldPath.length; k++) if (oldT.frontRef[oldPath[k]] >= 0) refs.add(oldT.frontRef[oldPath[k]]);
        let end = t.at;
        for (let i = t.at; i + 1 < t.main && t.succ[i].includes(i + 1) && refs.has(t.frontRef[i]); i++) end = i + 1;
        // (Back to the last waiting point on it, if there's one: the new way's waits aren't the old one's (no longer its
        // stop; inside a path signal's block), and a hold ending between them left it standing where it may not wait.)
        // (None between: back to the last place clear of points, not on them (user-2026-11-21: kept to its front on points, a decision from there
        // ran it on into a train standing on the road the points lay for).)
        let w = end;
        while (w > t.at && !t.wait[w]) w--;
        if (w > t.at) end = w;
        else {
          // (Back to its last place clear of points. None, and it stands on points itself (a line end too short to turn
          // clear of them: it turns over them, as it must): the grant's end as kept, not where it stands (own-03: held
          // on points 5 on its way to turn at the buffer, it stood there for good).)
          let e = end;
          while (e > t.at && !t.rest[e]) e--;
          if (e > t.at || t.rest[t.at]) end = e;
        }
        this.setHold(h, end, end === t.at ? [] : this.pathTo(t, end));
      } else {
        const nh: Hold = { t, sig, end: t.at, path: [], rem: new Map(), points: [], aim: -1, stood: -1, passed: 0, trainId, waitsOn: -1, decided: -Infinity, short: -1 };
        this.holdsBy.set(s.key, nh);
        this.setHold(nh, t.at, []);
      }
      return t;
    });
  }

  /** The nodes from `t.at` to `end` along its way (any road), or [] if it isn't ahead. */
  private pathTo(t: DTrain, end: number): number[] {
    if (end === t.at) return [t.at];
    const prev = new Map<number, number>();
    const todo = [t.at];
    prev.set(t.at, -1);
    while (todo.length > 0) {
      const i = todo.shift()!;
      if (i === end) break;
      for (const x of t.succ[i])
        if (!prev.has(x)) {
          prev.set(x, i);
          todo.push(x);
        }
    }
    if (!prev.has(end)) return [];
    const out: number[] = [];
    for (let i = end; i >= 0; i = prev.get(i)!) out.unshift(i);
    return out;
  }

  /** Set a hold to end at node `end` along `path` (from where the train stands): the run left beyond each front piece. */
  private setHold(h: Hold, end: number, path: number[]): void {
    this.holdVer++;
    const t = h.t;
    // (Never past a turn: the run to the line end before it; the sim turns it there.)
    let stop = end;
    let p = path.length > 0 ? path : [t.at];
    const turn = p.findIndex((i, k) => k > 0 && t.turned[i]);
    // (Its way turns at a line end: on to the end of the track there (the buffer stops it, the sim turns it).)
    const toEnd = turn > 0;
    if (turn > 0) {
      stop = p[turn - 1];
      p = p.slice(0, turn);
    }
    // (v1: no closing up: a close-up node's hold ends a node back.)
    if (t.half[stop] && p.length > 1) {
      p = p.slice(0, -1);
      stop = p[p.length - 1];
    }
    h.end = stop;
    h.path = p;
    h.rem = new Map();
    // (Only where the track really ends past its hold's front piece: nothing beyond to run onto.)
    const ref = t.frontRef[stop];
    const beyond = ref >= 0 ? next(this.host.layout, pieceOfRef(ref), indexOfRef(ref)) : null;
    const ends = !beyond || (this.host.layout.getPiece(beyond.pieceId)?.type.startsWith("buffer") ?? false);
    let run = toEnd && ends ? TO_END : 0;
    let last = -1;
    h.points = [];
    for (let k = p.length - 1; k >= 0; k--) {
      const i = p[k];
      const fp = t.pos[i][t.pos[i].length - 1];
      if (fp === last) continue;
      if (!h.rem.has(fp)) h.rem.set(fp, run);
      // (Points its front runs over on the way: they must lie for it before it may run onto them.)
      // (Out by the exit toward the next front piece on the granted way: at a branch (a loop's other road, a detour) that
      // isn't the node's own joint, which runs the booked way (own-03: the points set for the booked road, the train
      // off its grant and nose to nose with another).)
      if (k > 0 && t.frontRef[i] >= 0 && waysFrom(this.host.layout, fp, t.frontEn[i]).length > 1) {
        let ex = indexOfRef(t.frontRef[i]);
        const nx = p[k + 1];
        if (nx !== undefined) {
          const nf = t.pos[nx][t.pos[nx].length - 1];
          if (nf !== fp) for (const w of waysFrom(this.host.layout, fp, t.frontEn[i], () => false)) if (next(this.host.layout, fp, w.exit)?.pieceId === nf) ex = w.exit;
        }
        h.points.push({ p: fp, en: t.frontEn[i], ex, from: run + t.frontLen[i] });
      }
      run += t.frontLen[i];
      last = fp;
    }
    // (Its aim: the first piece on the granted way that's off its booked one (a loop road, a detour).)
    h.aim = -1;
    const mainPieces = new Set<number>();
    for (let i = t.at; i < t.main; i++) for (const x of t.pos[i]) mainPieces.add(x);
    // (The furthest such piece on the way granted, not points: aimed at, the router sets every points short of it the
    // granted way; one at points was dropped as the train came onto them, and they were set the booked way.)
    for (const i of p) {
      const fp = t.pos[i][t.pos[i].length - 1];
      if (i >= t.main && !mainPieces.has(fp) && waysFrom(this.host.layout, fp, t.frontEn[i]).length < 2) h.aim = fp;
    }
  }

  private decide(tsIn: DTrain[], snaps: Snap[], engine: number): void {
    let ts = tsIn;
    const h = this.holdsBy.get(engine);
    const k = ts.findIndex((t) => t.key === engine);
    if (!h || k < 0 || ts[k].fixed) return;
    h.decided = this.host.sim.ticks;
    const t0 = performance.now();
    // (A train with its front on points goes the way they lie: they can't be thrown under it. Its moves out by another
    // road aren't moves (own-01: granted off points lying the other way, it stood at the signal on their other exit for
    // good; refused instead, rowan-2's train stood on them for good).)
    // (Ones whose booked way can't be followed from there at all (keys): as before, granted it, they go the way they
    // must and the router books them again (rowan-1: turned at its stop with its tail on points lying the other way).)
    let offWay: Set<number> | null = null;
    if (OWNER.on) {
      let copy: DTrain[] | null = null;
      for (let i = 0; i < ts.length; i++) {
        const pt = this.pinnedFront(ts[i]);
        if (pt === null) {
          offWay ??= new Set();
          offWay.add(ts[i].key);
          continue;
        }
        if (pt === ts[i]) continue;
        copy ??= ts.slice();
        copy[i] = pt;
      }
      if (copy) ts = copy;
    }
    // (Each held train where its hold ends: it'll get there. The track up to there is its own: taken.)
    const placed = ts.map((t) => {
      const o = this.holdsBy.get(t.key);
      return o && o.t.pos === t.pos && o.end !== t.at ? { ...t, at: o.end } : t;
    });
    const members = stretchOf(placed, k);
    // (Every other held train's track up to its hold's end, member or not: it's on its way over it.)
    const taken = new Set<number>();
    placed.forEach((t, i) => {
      const o = this.holdsBy.get(t.key);
      if (!o || i === k || o.t.pos !== t.pos) return;
      for (const n of o.path) for (const p of t.pos[n]) taken.add(p);
    });
    for (const p of placed[k].pos[ts[k].at]) taken.delete(p);
    const order = members.map((_, i) => i).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : (this.holdsBy.get(placed[members[a]].key)?.stood ?? Infinity) - (this.holdsBy.get(placed[members[b]].key)?.stood ?? Infinity)));
    // (Fair turns: a train counts for more the longer it has stood waiting, so an order that strands a long waiter loses.)
    const now = this.host.sim.ticks;
    const weights = members.map((i) => {
      const st = this.holdsBy.get(placed[i].key)?.stood ?? -1;
      return st < 0 ? 1 : 1 + Math.floor((now - st) / (WEIGH_S * 120));
    });
    let r = search(placed, members, { cap: DISPATCH_STATES, backUps: false, order, taken, weights, oneWay: this.oneWay });
    let ways = placed;
    let to = -1;
    if (r.first[0] >= 0 && r.first[0] >= r.plain) to = r.firstTo[0];
    // (At most every `DETOUR_EVERY_S` a train: a stuck one asks again every `RETRY_TICKS`, and the detour search is the
    // costliest part of a decision (rowan-1's p98).)
    else if (r.plain < r.of && h.stood >= 0 && this.host.sim.ticks - h.stood >= REROUTE_AFTER_S * 120 && r.states < DISPATCH_STATES && this.host.sim.ticks - (h.detourAt ?? -Infinity) >= DETOUR_EVERY_S * 120) {
      h.detourAt = this.host.sim.ticks;
      // (Stuck: with detours.)
      const dt = withDetours(this.host.layout, snaps, placed, members);
      if (dt) {
        const rd = search(dt, members, { cap: DISPATCH_STATES - r.states, backUps: false, order, taken, detours: true, weights, oneWay: this.oneWay });
        if (rd.detourValue > r.plain && rd.firstD[0] >= rd.detourValue && rd.firstToD[0] >= 0) {
          ways = dt;
          r = rd;
          to = rd.firstToD[0];
          this.detours++;
        }
      }
    }
    // (Fair turns: passed over `FAIR_TURNS` times in a row with its move free, it goes, at the cost of one delivery at most.)
    if (to < 0 && r.first[0] >= 0) {
      h.passed++;
      if (h.passed >= FAIR_TURNS && r.first[0] >= r.plain - Math.min(...weights) && r.first[0] > 0) to = r.firstTo[0];
    }
    // (One at a time on a single line (§2.2a): a move onto a stretch of plain track between points that another train
    // is on, or is granted onto, heading for its other end, isn't granted; it waits where it is (its last place clear of
    // points before the line), and the longest waiter goes first (asks are decided longest waiter first).)
    let singleBy = -1;
    if (to >= 0 && OWNER.on && SINGLE.on) {
      const w = ways[k];
      const tt = w === placed[k] ? ts[k] : { ...w, at: ts[k].at };
      singleBy = this.singleLineBy(engine, tt, this.pathTo(tt, to));
      if (singleBy < 0 && DEAD.on) singleBy = this.deadEndBy(engine, tt, ts);
      if (singleBy >= 0) to = -1;
    }
    // (Points on the move the router has locked for another train, or another train is on: not granted; it waits on that
    // one (dandelion: granted over points 301 held by Rowan, held short by the router at a green signal).)
    let lockedBy = -1;
    if (to >= 0 && OWNER.on && this.host.sim.pathLocks) {
      const w = ways[k];
      const tt = w === placed[k] ? ts[k] : { ...w, at: ts[k].at };
      const path = this.pathTo(tt, to);
      const pts: number[] = [];
      for (let q = 1; q < path.length; q++) {
        const i = path[q];
        const fp = tt.pos[i][tt.pos[i].length - 1];
        // (Facing or trailing: the router locks both (user-2026-11-21: granted over trailing points held for another).)
        if (fp !== tt.pos[path[q - 1]][tt.pos[path[q - 1]].length - 1] && isPoints(this.host.layout, fp)) pts.push(fp);
      }
      const train = this.host.sim.findCar(engine)?.train;
      if (train && pts.length > 0) {
        const by = this.host.sim.pathLocks.locks(train, pts, pts.map(() => false));
        if (by >= 0 && by !== engine) {
          lockedBy = by;
          to = -1;
        }
      }
    }
    // (Head-on ahead (§2.2a one at a time): a move that newly runs onto another train's way, the other way, while that
    // train stands on this one's way on, isn't granted: they'd meet with no way past (dandelion: Dandelion granted up to
    // the points at 426 with Conker standing on its way beyond them, coming the other way). Not for a train on the other's
    // way already: there, refusing it helps nobody (they've met), and the two would hold each other for good.)
    let headBy = -1;
    if (to >= 0 && OWNER.on && HEAD_AHEAD.on) headBy = this.headOnAhead(engine, ts, placed, ways[k] === placed[k] ? ts[k] : { ...ways[k], at: ts[k].at }, to);
    if (headBy >= 0) to = -1;
    let noseBy = -1;
    // (Never to stand nose to nose: a move ending with its front against another lever-on train's front on the next piece
    // isn't granted (the sim keeps a gap there and holds it short: netActed; and two noses together is a head-on with
    // no way past). The router's "a train is coming" rule kept them apart before it stood down for held trains.)
    if (to >= 0 && OWNER.on) {
      const w = ways[k];
      const ref = w.frontRef[to];
      const nx = ref >= 0 ? next(this.host.layout, pieceOfRef(ref), indexOfRef(ref)) : null;
      if (nx) {
        const fp = w.pos[to][w.pos[to].length - 1];
        // (A train's leading end on that piece, heading back across the same joint (standing there, or coming).)
        const layout = this.host.layout;
        const self = this.host.sim.findCar(engine)?.train;
        for (const o of this.host.sim.trains()) {
          if (o === self || o.derailed || noseBy >= 0) continue;
          const net = this.host.drive(o);
          const ends = net > 0 ? [o.bogies[0]] : net < 0 ? [o.bogies[o.bogies.length - 1]] : [];
          for (const b of ends) {
            if (b.pieceId !== nx.pieceId) continue;
            const bp = layout.getPiece(b.pieceId);
            if (!bp) continue;
            const ex = pathExitConnector(getPieceDef(bp.type, bp.flipped), b.pathIndex, net > 0 ? b.reversed : !b.reversed);
            if (ex >= 0 && next(layout, b.pieceId, ex)?.pieceId === fp) {
              const oe = o.cars.find((c) => c.kind === "engine");
              to = -1;
              noseBy = (oe ?? o.cars[0]).id;
              this.noseRefused++;
            }
          }
        }
        // (Another's hold ending with its front on that piece, facing back across the same joint.)
        for (const [key, o] of this.holdsBy) {
          if (key === engine) continue;
          const oe = o.t.pos[o.end];
          if (oe[oe.length - 1] !== nx.pieceId) continue;
          const oref = o.t.frontRef[o.end];
          const onx = oref >= 0 ? next(this.host.layout, pieceOfRef(oref), indexOfRef(oref)) : null;
          if (onx && onx.pieceId === fp) {
            to = -1;
            noseBy = key;
            this.noseRefused++;
            break;
          }
        }
      }
    }
    // (Its front on points already (they can't be thrown under it): a move out of them by a road they don't lie for
    // isn't granted; it would go the way they lie, off its grant, into another's (own-03: nose to nose).)
    if (to >= 0 && OWNER.on) {
      const w = ways[k];
      const tt = w === placed[k] ? ts[k] : { ...w, at: ts[k].at };
      const path = this.pathTo(tt, to);
      const fp = tt.pos[tt.at][tt.pos[tt.at].length - 1];
      for (let q = 1; q < path.length; q++) {
        const i = path[q];
        if (tt.pos[i][tt.pos[i].length - 1] === fp) continue;
        // (The first node whose front is past it: the way it leaves the points by, toward that node's front piece (at a
        // branch not the node's own joint, the booked way's: own-01, granted off points lying the other way, it stood at
        // the signal on their other exit for good).)
        const nf = tt.pos[i][tt.pos[i].length - 1];
        let ex = -1;
        for (const w of waysFrom(this.host.layout, fp, tt.frontEn[tt.at], () => false)) if (next(this.host.layout, fp, w.exit)?.pieceId === nf) ex = w.exit;
        const under = ex >= 0 && waysFrom(this.host.layout, fp, tt.frontEn[tt.at]).length > 1 ? this.exitsUnder(engine, fp, tt.frontEn[tt.at]) : null;
        if (under && !under.has(ex) && !offWay?.has(engine)) to = -1;
        break;
      }
    }
    // (§13.6.2, single-line working: a move whose claim (its way from where it stands to its next passing place, a road
    // of a loop or a yard) meets another train's claim the other way on any piece, or finds no road free there, isn't
    // granted. Both ways ask the same book: the train coming the other way waits at its own passing place.)
    let reservedBy = -1;
    // (Not for ever: refused `RESERVE_TIMEOUT_S` standing, it goes (a train holding the block may itself be held: at
    // its stop, at a signal; complex-2's refusals read as jams).)
    if (to >= 0 && RESERVE.on && !(h.stood >= 0 && this.host.sim.ticks - h.stood >= RESERVE_TIMEOUT_S * 120)) {
      reservedBy = this.reservedBy(engine, ts, ways, k, to);
      if (reservedBy >= 0) {
        to = -1;
        this.reservedRefused++;
      }
    }
    // (§13.6, the safety check: a grant that leaves no order in which each of the stretch's trains reaches its stop
    // after next isn't granted, unless the stretch had none before it either (it makes nothing worse).)
    let unsafeBy = -1;
    if (to >= 0 && SAFE.on) {
      // (Only where it can wait: safe with it standing where it is till the others are through; refused where it must
      // go first, its waiting helps nobody (rowan-2: refused alone, the trains it would meet came on to it anyway).)
      const before = this.safeOrder(ways, members, -1, -1, k);
      if (before < 0) {
        const after = this.safeOrder(ways, members, k, to);
        if (after >= 0) {
          unsafeBy = after;
          to = -1;
          this.unsafeRefused++;
        }
      }
    }
    if (unsafeBy >= 0) headBy = unsafeBy;
    if (reservedBy >= 0) headBy = reservedBy;
    this.decisions++;
    this.decisionMs.push(performance.now() - t0);
    h.singleWait = singleBy >= 0 ? singleBy : headBy;
    const pt = this.perTrain.get(engine) ?? [0, 0];
    this.perTrain.set(engine, pt);
    pt[to < 0 ? 1 : 0]++;
    // (Who it waits for: the train in its move's way, or (its turn not yet) the one the best order lets go first.)
    const firstOther = r.order.find((m) => m.k !== 0);
    h.waitsOn = to >= 0 ? -1 : singleBy >= 0 ? singleBy : headBy >= 0 ? headBy : lockedBy >= 0 ? lockedBy : noseBy >= 0 ? noseBy : r.first[0] < 0 ? this.blocker(placed, k) : firstOther ? placed[members[firstOther.k]].key : -1;
    if (to < 0) {
      if (r.first[0] < 0) this.heldBlocked++;
      else this.heldOrder++;
      if (this.debug && this.notes.length < 400)
        this.notes.push(`${(this.host.sim.ticks / 120).toFixed(0)}s train ${engine} held ${r.first[0] < 0 ? "blocked" : "order"}: at ${ts[k].at} end ${h.end} first ${r.first[0]} plain ${r.plain}/${r.of} members ${members.length} wait-ahead ${branchesSummary(placed[k])} taken-by ${takenBy(placed, k, this.holdsBy)}`);
      return;
    }
    h.passed = 0;
    this.grants++;
    // (Granted: its way (a detour's, if that's it) from where it stands to the move's waiting point.)
    const t = ways[k] === placed[k] ? ts[k] : { ...ways[k], at: ts[k].at };
    // (Its way now a detour's, if that's what it's granted: moved along it from here on, its route the same.)
    if (t.pos !== h.t.pos) h.t = t;
    const path = this.pathTo(t, to);
    if (path.length > 0) this.setHold(h, to, path);
    this.host.granted?.(engine);
  }

  /** The train in a held train's way: on its next move's track as it stands, where its hold ends, or on its way there. */
  private blocker(placed: DTrain[], k: number): number {
    const b = blockerOf(placed, k);
    if (b >= 0) return b;
    const mine = new Set<number>();
    const t = placed[k];
    for (let i = t.succ[t.at][0] ?? -1, n = 0; i >= 0 && n < 400; i = t.succ[i][0] ?? -1, n++) {
      for (const p of t.pos[i]) mine.add(p);
      if (t.wait[i]) break;
    }
    for (const p of t.pos[t.at]) mine.delete(p);
    for (const [key, o] of this.holdsBy) {
      if (key === t.key) continue;
      for (const n of o.path) for (const p of o.t.pos[n]) if (mine.has(p)) return key;
    }
    return -1;
  }

  /** How far (mm) the train's nose is from its hold's end, less `STAND_SHORT`; Infinity off its way (the next look sorts it). */
  private gapTo(train: Train, h: Hold): number {
    const net = this.host.drive(train);
    if (net === 0 || train.turnback >= 0) return Infinity;
    const layout = this.host.layout;
    const c = capAt;
    Object.assign(c, net > 0 ? train.bogies[0] : train.bogies[train.bogies.length - 1]);
    if (net < 0) flipCursor(layout, c);
    const rem = h.rem.get(c.pieceId);
    const piece = layout.getPiece(c.pieceId);
    // (Its front off its hold's way: it stands till the next look places it again.)
    if (rem === undefined || !piece) {
      this.offWay++;
      if (this.debug && this.offNotes.length < 20 && this.host.sim.ticks % 120 === 0) this.offNotes.push(`${(this.host.sim.ticks / 120).toFixed(0)}s train ${h.t.key} front on ${c.pieceId}; rem has ${[...h.rem.keys()].join(",")}; at ${h.t.at} end ${h.end} pos[at] ${[...h.t.pos[h.t.at]].join("/")}`);
      return 0;
    }
    const lead = net < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    const len = pathLength(getPieceDef(piece.type, piece.flipped).paths[c.pathIndex].geom);
    // (`s` runs the cursor's own way: what's left of the piece is the rest of it.)
    let gap = len - c.s + rem;
    // (Not short of points ahead that don't lie for it yet: the router sets them as it comes, and standing short of
    // them (when `liesFor` saw every road: it saw one before, and never did this) cost wren ~60 stops a run and broke
    // it twice in three: unset grants overruled 221.)
    // (Held where it stands (no move granted), another train on the piece just beyond its front: it stops now, not at
    // its front piece's end against that one (own-01: turned at its line's end, it ran on nose to nose: netActed).)
    if (h.end === h.t.at && OWNER.on) {
      const ref = h.t.frontRef[h.end];
      const nx = ref >= 0 ? next(layout, pieceOfRef(ref), indexOfRef(ref)) : null;
      if (nx) for (const o of this.host.sim.trains()) if (o !== train && o.bogies.some((b) => b.pieceId === nx.pieceId)) return 0;
    }
    return gap - CAR_SPECS[lead.kind].bogieInset - STAND_SHORT;
  }

  /** Does it hold this train (a routed one with its lever on)? */
  holds(train: Train): boolean {
    const engine = train.cars.find((c) => c.kind === "engine");
    return !!engine && engine.lever !== 0 && this.holdsBy.has(engine.id);
  }

  /** Do these points lie for a run in by `en` and out by `ex`? */
  /**
   * The exits from end `en` of points `fp` that `engine`'s train's bogies on them run to (null: none of its bogies on
   * them that way). A bogie on a piece keeps to its path: a train on points leaves by that, not by how they lie (rowan-2:
   * in trailing through points lying the other way, turned at the line's end, out the way it came).
   */
  private exitsUnder(engine: number, fp: number, en: number): Set<number> | null {
    const train = this.host.sim.findCar(engine)?.train;
    const bp = this.host.layout.getPiece(fp);
    if (!train || !bp) return null;
    const paths = getPieceDef(bp.type, bp.flipped).paths;
    let out: Set<number> | null = null;
    for (const b of train.bogies) {
      if (b.pieceId !== fp) continue;
      const p = paths[b.pathIndex];
      if (!p) continue;
      const ex = p.from === en ? p.to : p.to === en ? p.from : undefined;
      if (ex === undefined || ex === null || ex < 0) continue;
      (out ??= new Set()).add(ex);
    }
    return out;
  }

  /**
   * `t` with the moves off the points its front stands on by a road its bogies aren't on taken out (`t` if none; null:
   * none left, its booked way can't be followed from there).
   */
  private pinnedFront(t: DTrain): DTrain | null {
    if (t.fixed) return t;
    const layout = this.host.layout;
    const front = (i: number) => t.pos[i][t.pos[i].length - 1];
    const fp = front(t.at);
    if (!isPoints(layout, fp)) return t;
    const en = t.frontEn[t.at];
    const ways = waysFrom(layout, fp, en, () => false);
    if (ways.length < 2) return t;
    const out = this.exitsUnder(t.key, fp, en);
    if (!out) return t;
    let succ: Int32Array[] | null = null;
    let kept = 0;
    const seen = new Set<number>([t.at]);
    const todo = [t.at];
    while (todo.length > 0) {
      const i = todo.pop()!;
      const ss = t.succ[i];
      let keep: number[] | null = null;
      for (let q = 0; q < ss.length; q++) {
        const s = ss[q];
        const sf = front(s);
        if (sf === fp) {
          if (!seen.has(s)) (seen.add(s), todo.push(s));
          continue;
        }
        const w = ways.find((x) => next(layout, fp, x.exit)?.pieceId === sf);
        if (w && !out.has(w.exit)) {
          keep ??= Array.from(ss.subarray(0, q));
          continue;
        }
        kept++;
        keep?.push(s);
      }
      if (keep) {
        succ ??= t.succ.slice();
        succ[i] = Int32Array.from(keep);
      }
    }
    if (succ && kept === 0) return null;
    return succ ? { ...t, succ } : t;
  }

  private liesFor(p: number, en: number, ex: number): boolean {
    // (Every road from that end, pinned or not: asked as pinned there'd be just the set one, and any exit would "lie".)
    const ways = waysFrom(this.host.layout, p, en, () => false);
    if (ways.length < 2) return true;
    const set = ways[pointsWayFrom(this.host.layout, p, en, ways.length)];
    return !!set && set.exit === ex;
  }

  /** The speed limit a routed train's hold puts on it (Infinity: none: hand-run, parked, or not held). */
  cap(train: Train): number {
    const engine = train.cars.find((c) => c.kind === "engine");
    const h = engine ? this.holdsBy.get(engine.id) : undefined;
    if (!h || engine!.lever === 0) return Infinity;
    const room = this.gapTo(train, h);
    return room === Infinity ? room : room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
  }

  /** The router's steer for a train granted a loop road or detour: aim at a piece on it till it's passed. */
  steerHint(engine: number): { follow: (pieceId: number, path: number) => boolean; aim: number } | undefined {
    const h = this.holdsBy.get(engine);
    // (Owning the points (§13.5 step 2): every grant over points steers, by the exits it grants, aimed at its end.)
    // (Kept while it stands at its hold's end too: a grant ending on its points is still how they lie for it, as the train
    // runs onto them (rowan-1 seed 3: wrongRoad, judged by the plan once the hint had gone).)
    if (OWNER.on && h && h.points.length > 0) {
      const end = h.t.pos[h.end];
      const layout = this.host.layout;
      const byPiece = new Map(h.points.map((q) => [q.p, q]));
      // (Its aim on a loop's other road or a detour till it's on it, as below; else its hold's end.)
      // (By its engine: its train id can be stale.)
      const train = h.aim >= 0 ? this.host.sim.findCar(engine)?.train : undefined;
      if (train && train.bogies.some((b) => b.pieceId === h.aim)) h.aim = -1;
      return {
        // (Else its stop: the router's walk ends at its aim, so an aim on the grant's own last points never set them; the
        // walk is cut to the grant all the same: `grantedWay`.)
        aim: h.aim >= 0 ? h.aim : this.stopAhead(engine, end[end.length - 1]),
        follow: (pieceId, path) => {
          const q = byPiece.get(pieceId);
          if (!q) return true;
          // (The road out by the exit granted, from the end it comes on by: on a slip, a path from another end isn't it.)
          return waysFrom(layout, pieceId, q.en).find((x) => x.path === path)?.exit === q.ex;
        },
      };
    }
    if (!h || h.aim < 0) return undefined;
    // (On it: from there it's steered as booked again. By its engine: its train id can be stale.)
    const train = this.host.sim.findCar(engine)?.train;
    if (!train || train.bogies.some((b) => b.pieceId === h.aim)) {
      h.aim = -1;
      return undefined;
    }
    return { follow: () => true, aim: h.aim };
  }

  /**
   * The pieces of the way granted to a train it holds (from where it stands to its hold's end), for the router: it
   * asks for no points beyond them (§13.5 step 2). Null: not held. Cached by the holds' version.
   */
  grantedWay(engine: number): { pieces: ReadonlySet<number>; exits: ReadonlyMap<number, number> } | null {
    const h = this.holdsBy.get(engine);
    if (!h) return null;
    const c = this.wayCache.get(engine);
    if (c && c.ver === this.holdVer) return c.way;
    const pieces = new Set<number>();
    for (const i of h.path) for (const p of h.t.pos[i]) pieces.add(p);
    for (const p of h.t.pos[h.t.at]) pieces.add(p);
    // (How each points on it must lie: out by the exit its way takes.)
    const exits = new Map<number, number>();
    for (const q of h.points) exits.set(q.p, q.ex);
    const way = { pieces, exits };
    this.wayCache.set(engine, { ver: this.holdVer, way });
    return way;
  }
  private readonly wayCache = new Map<number, { ver: number; way: { pieces: Set<number>; exits: Map<number, number> } }>();

  /**
   * The single lines (§2.2a): each piece of plain track (no points, a crossing or a deck: one road through it) and the
   * stretch of such pieces it's in, joined end to end; per layout revision.
   */
  private singleOf(): Map<number, number> {
    const layout = this.host.layout;
    if (this.singles && this.singlesRev === layout.revision) return this.singles;
    const seg = new Map<number, number>();
    let id = 0;
    const plain = (p: number) => {
      const piece = layout.getPiece(p);
      if (!piece) return false;
      const def = getPieceDef(piece.type, piece.flipped);
      return def.paths.length === 1 && def.connectors.length === 2 && !isPoints(layout, p);
    };
    for (const p of layout.pieceIds()) {
      if (seg.has(p) || !plain(p)) continue;
      const todo = [p];
      const run: number[] = [];
      seg.set(p, id);
      while (todo.length > 0 && run.length <= SINGLE_MAX) {
        const q = todo.pop()!;
        run.push(q);
        for (let c = 0; c < 2; c++) {
          const n = next(layout, q, c);
          if (n && !seg.has(n.pieceId) && plain(n.pieceId)) {
            seg.set(n.pieceId, id);
            todo.push(n.pieceId);
          }
        }
      }
      if (run.length > SINGLE_MAX) for (const q of run) seg.set(q, -1);
      id++;
    }
    this.singles = seg;
    this.singlesRev = layout.revision;
    return seg;
  }
  private singles: Map<number, number> | null = null;
  private singlesRev = -1;

  /** The end a run along a single line from piece `p` out by connector `ex` comes to: the last piece's exit (a ref); −1: a ring. */
  private singleEnd(seg: Map<number, number>, p: number, ex: number): number {
    const s = seg.get(p);
    let cur = p;
    let out = ex;
    for (let n = 0; n < SINGLE_MAX + 2; n++) {
      const nx = next(this.host.layout, cur, out);
      if (!nx || seg.get(nx.pieceId) !== s) return connectorRef(cur, out);
      cur = nx.pieceId;
      out = nx.entry === 0 ? 1 : 0;
    }
    return -1;
  }

  /** Whether single line `s` is a dead end: one of its ends runs onto a buffer, or onto nothing; per layout revision. */
  private deadEnd(s: number): boolean {
    const layout = this.host.layout;
    if (this.deadRev !== layout.revision) {
      this.deads.clear();
      this.deadRev = layout.revision;
    }
    const hit = this.deads.get(s);
    if (hit !== undefined) return hit;
    const seg = this.singleOf();
    let out = false;
    for (const [p, id] of seg) {
      if (id !== s) continue;
      for (let c = 0; c < 2 && !out; c++) {
        const ref = this.singleEnd(seg, p, c);
        if (ref < 0) continue;
        const n = next(layout, pieceOfRef(ref), indexOfRef(ref));
        const np = n ? layout.getPiece(n.pieceId) : undefined;
        if (!n || !np || getPieceDef(np.type, np.flipped).connectors.length < 2) out = true;
      }
      break;
    }
    this.deads.set(s, out);
    return out;
  }
  private readonly deads = new Map<number, boolean>();
  private deadRev = -1;

  /**
   * The dead end (its single line) `t`'s way from node `from` next stops or turns in, before any other stop or turn
   * (−1: none). Cached per booked way and node.
   */
  private deadTarget(t: DTrain, from: number, turnOnly = false): number {
    let byAt = deadCache.get(t.pos);
    if (!byAt) deadCache.set(t.pos, (byAt = new Map()));
    const ck = from * 2 + (turnOnly ? 1 : 0);
    const hit = byAt.get(ck);
    if (hit !== undefined) return hit;
    const stops = t.arrivals.filter((a) => t.order[a] > t.order[from]);
    const stop = stops.length > 0 ? stops[0] : -1;
    let out = -1;
    for (let i = t.succ[from][0] ?? -1, n = 0; i >= 0 && n < 400; n++) {
      if (t.turned[i] || i === stop) {
        const s = this.singleOf().get(t.pos[i][t.pos[i].length - 1]);
        if (s !== undefined && s >= 0 && this.deadEnd(s) && (!turnOnly || i !== stop)) out = s;
        break;
      }
      i = t.succ[i][0] ?? -1;
    }
    byAt.set(ck, out);
    return out;
  }

  /**
   * A train in a dead end of its own whose way next turns in another dead end (no stop of its own there) isn't moved
   * out while another train is on that one, granted onto it, or heading there to stop or turn (−1: none; else that
   * train's engine): it waits where it is, out of everyone's way, not on the way in (own-08: the shuttle, let off its
   * stop on the branch toward the forest's buffer where it turns, as another went in there to its stop, stood in the
   * loop's last road). Of two waiting on each other, the one that asked first waits.
   */
  private deadEndBy(engine: number, t: DTrain, ts: readonly DTrain[]): number {
    if (!t.rest[t.at]) return -1;
    // (Only a train that turns there, with no stop of its own in it: one going to its stop there waits at the line
    // before as on any single line, and to hold it back at its last stop till the far end is clear runs a line with
    // passing loops one train at a time (own-01).)
    const s = this.deadTarget(t, t.at, true);
    if (s < 0) return -1;
    const seg = this.singleOf();
    // (In it already: it turns there and comes out.)
    if (t.pos[t.at].some((p) => seg.get(p) === s)) return -1;
    // (Only from a dead end of its own, out of everyone's way: one standing on a line elsewhere, at a stop or not, may
    // be in the way of the train coming out (own-01: the farm, on the line between two loops).)
    const inDead = t.pos[t.at].some((p) => {
      const q = seg.get(p);
      return q !== undefined && q >= 0 && this.deadEnd(q);
    });
    if (!inDead) return -1;
    const self = this.host.sim.findCar(engine)?.train;
    for (const o of this.host.sim.trains()) {
      if (o === self || o.derailed) continue;
      const key = (o.cars.find((c) => c.kind === "engine") ?? o.cars[0]).id;
      if (this.holdsBy.get(key)?.singleWait === engine) continue;
      if (o.bogies.some((b) => seg.get(b.pieceId) === s)) return key;
      const h = this.holdsBy.get(key);
      if (h && h.path.some((i) => h.t.pos[i].some((p) => seg.get(p) === s))) return key;
    }
    // (Heading for it, not yet on it: waited for `DEAD_PATIENCE_S` at most; that one may be stuck on this one in turn
    // (own-08: Through one in the far loop, waiting on a train that waits on the shuttle).)
    const st = this.holdsBy.get(engine)?.stood ?? -1;
    if (st >= 0 && this.host.sim.ticks - st >= DEAD_PATIENCE_S * 120) return -1;
    for (const o of ts) {
      if (o.key === engine || o.fixed) continue;
      if (this.holdsBy.get(o.key)?.singleWait === engine) continue;
      if (this.deadTarget(o, o.at) === s) return o.key;
    }
    return -1;
  }

  /**
   * Another train on a single line this move runs onto, or granted onto it, heading for its other end (−1: none). Its
   * engine. A train standing on it with no way on but towards this one counts as heading that way.
   */
  private singleLineBy(engine: number, t: DTrain, path: readonly number[]): number {
    const seg = this.singleOf();
    const layout = this.host.layout;
    const { sim } = this.host;
    // (The lines its move runs onto, and the end of each it heads for.)
    const mine = new Map<number, number>();
    for (let q = 1; q < path.length; q++) {
      const i = path[q];
      const fp = t.pos[i][t.pos[i].length - 1];
      const s = seg.get(fp);
      if (s === undefined || s < 0 || mine.has(s)) continue;
      const ex = t.frontRef[i] >= 0 && pieceOfRef(t.frontRef[i]) === fp ? indexOfRef(t.frontRef[i]) : t.frontEn[i] === 0 ? 1 : 0;
      const end = this.singleEnd(seg, fp, ex);
      if (end >= 0) mine.set(s, end);
    }
    if (mine.size === 0) return -1;
    const self = sim.findCar(engine)?.train;
    for (const o of sim.trains()) {
      if (o === self || o.derailed) continue;
      const oe = o.cars.find((c) => c.kind === "engine");
      const key = (oe ?? o.cars[0]).id;
      // (On the line: heading for the end its front runs to (its way, or as it faces standing).)
      const net = this.host.drive(o);
      // (Its axles from its leading end back: the first on such a line says which end it heads for.)
      const n = o.bogies.length;
      for (let j = 0; j < n; j++) {
        const b = net >= 0 ? o.bogies[j] : o.bogies[n - 1 - j];
        const s = seg.get(b.pieceId);
        if (s === undefined || !mine.has(s)) continue;
        const bp = layout.getPiece(b.pieceId);
        if (!bp) break;
        const ex = pathExitConnector(getPieceDef(bp.type, bp.flipped), b.pathIndex, net >= 0 ? b.reversed : !b.reversed);
        const end = ex >= 0 ? this.singleEnd(seg, b.pieceId, ex) : -1;
        if (end !== mine.get(s)) return key;
        break;
      }
      // (Granted onto it, heading the other way.)
      const h = this.holdsBy.get(key);
      if (!h) continue;
      for (let q = 1; q < h.path.length; q++) {
        const i = h.path[q];
        const fp = h.t.pos[i][h.t.pos[i].length - 1];
        const s = seg.get(fp);
        if (s === undefined || !mine.has(s)) continue;
        const ex = h.t.frontRef[i] >= 0 && pieceOfRef(h.t.frontRef[i]) === fp ? indexOfRef(h.t.frontRef[i]) : h.t.frontEn[i] === 0 ? 1 : 0;
        if (this.singleEnd(seg, fp, ex) !== mine.get(s)) return key;
        break;
      }
    }
    return -1;
  }

  /**
   * `headBy` above: the train (its engine) this move would run head-on into, or −1. `t` from where it stands, moving to
   * node `to`. Each other train by its booked way from where it stands (`ts`), to its next stop or a turn.
   */
  private headOnAhead(engine: number, ts: readonly DTrain[], placed: readonly DTrain[], t: DTrain, to: number): number {
    const wayOf = (x: DTrain, from: number, legs = 1): Map<number, number> => {
      // (Piece → the end its front comes onto it by, along its main way from `from`, to its next stop after or a turn.
      // Cached per booked way and node: a train's way is asked of in many decisions while it stands.)
      let byAt = aheadCache.get(x.pos);
      if (!byAt) aheadCache.set(x.pos, (byAt = new Map()));
      const ck = from * 4 + legs;
      const hit = byAt.get(ck);
      if (hit) return hit;
      const out = new Map<number, number>();
      byAt.set(ck, out);
      const stops = x.arrivals.filter((a) => x.order[a] > x.order[from]);
      let s = 0;
      let left = legs;
      for (let i = from, n = 0; i >= 0 && n < 400; n++) {
        const fp = x.pos[i][x.pos[i].length - 1];
        if (!out.has(fp)) out.set(fp, x.frontEn[i]);
        if (i === (s < stops.length ? stops[s] : x.main - 1) || (i !== from && x.turned[i])) {
          if (--left <= 0 || i === x.main - 1) break;
          if (s < stops.length && i === stops[s]) s++;
        }
        i = x.succ[i][0] ?? -1;
      }
      return out;
    };
    const myAhead = wayOf(t, to);
    const here = new Set(t.pos[t.at]);
    const path = this.pathTo(t, to);
    const fresh = new Map<number, number>();
    for (const i of path) {
      const fp = t.pos[i][t.pos[i].length - 1];
      if (!here.has(fp) && !fresh.has(fp)) fresh.set(fp, t.frontEn[i]);
    }
    if (fresh.size === 0) return -1;
    for (let m = 0; m < ts.length; m++) {
      const o = ts[m];
      if (o.key === engine || o.fixed) continue;
      // (Its hold ending at its stop: its way on is the leg after it too, it goes on from there next (complex-1: Willow
      // granted into a single stretch toward a stop another was granted into, its next leg back through that stretch).)
      const oEnd = placed[m].at;
      const oWay = wayOf(o, o.at, NEXT_LEG.on && oEnd !== o.at && o.arrivals.includes(oEnd) ? 2 : 1);
      // (This one already on its way: not refused here.)
      if ([...here].some((p) => oWay.has(p))) continue;
      // (Onto its way, the other way over a piece: its front onto it by another end than ours.)
      let against = false;
      for (const [p, en] of fresh) {
        const oen = oWay.get(p);
        if (oen !== undefined && oen !== en) {
          against = true;
          break;
        }
      }
      if (!against) continue;
      // (And it stands on our way on, or its hold runs onto it, with no other road round it: a loop's other road
      // free, they pass there (own-07: refused onto the line into a loop as the other stood in the loop's main road).)
      const stand = placed[m].pos[placed[m].at];
      if ((o.pos[o.at].some((p) => myAhead.has(p)) || stand.some((p) => myAhead.has(p))) && !this.wayRound(t, to, new Set([...o.pos[o.at], ...stand]))) return o.key;
    }
    // (Admission two stops on: a move ending at its stop, and the leg after it, from there to its next stop or turn,
    // taken (stood on, or granted onto) by trains coming the other way along it with no road round them all: not
    // granted. Once in, it could only meet them there (own-08, own-10, complex-3: let into a stretch toward its stop,
    // the train it would meet on the leg after already on it, the two held each other for good).)
    if (ADMIT2.on && t.arrivals.includes(to)) {
      const union = new Set<number>();
      let first = -1;
      for (const o of ts) {
        if (o.key === engine || o.fixed) continue;
        const oh = this.holdsBy.get(o.key);
        const pieces = new Set<number>(o.pos[o.at]);
        if (oh && oh.t.pos === o.pos) for (const i of oh.path) for (const p of oh.t.pos[i]) pieces.add(p);
        if (![...pieces].some((p) => myAhead.has(p))) continue;
        const oWay = wayOf(o, o.at);
        let opp = false;
        for (const [p, en] of oWay) {
          const mine = myAhead.get(p);
          if (mine !== undefined && mine !== en) {
            opp = true;
            break;
          }
        }
        if (!opp) continue;
        for (const p of pieces) union.add(p);
        if (first < 0) first = o.key;
      }
      if (first >= 0 && !this.wayRound(t, to, union)) return first;
    }
    return -1;
  }

  /**
   * Whether `t`, from node `to`, has a way by any road (its booked way's or a loop's other) to its next stop or a turn
   * that runs over none of `avoid`'s pieces.
   */
  private wayRound(t: DTrain, to: number, avoid: ReadonlySet<number>): boolean {
    const stops = t.arrivals.filter((a) => t.order[a] > t.order[to]);
    const until = stops.length > 0 ? stops[0] : t.main - 1;
    const seen = new Set<number>([to]);
    const todo = [to];
    while (todo.length > 0 && seen.size < 800) {
      const i = todo.pop()!;
      if (i !== to && (i === until || t.turned[i] || (i < t.main && t.order[i] >= t.order[until]))) return true;
      for (const j of t.succ[i]) {
        if (seen.has(j) || t.pos[j].some((p) => avoid.has(p))) continue;
        seen.add(j);
        todo.push(j);
      }
    }
    return false;
  }

  /** One road through (no points, crossing or deck). */
  private plainPiece(p: number): boolean {
    const piece = this.host.layout.getPiece(p);
    if (!piece) return false;
    const def = getPieceDef(piece.type, piece.flipped);
    return def.paths.length === 1 && def.connectors.length === 2;
  }

  /** §13.6.2: what a train holds: the pieces it stands on and those its hold grants it (piece → the end its front comes onto it by). */
  private heldOf(o: DTrain, ahead: number): { way: Map<number, number>; place: number } {
    const way = new Map<number, number>();
    const h = this.holdsBy.get(o.key);
    const nodes = h && h.t.pos === o.pos && h.path.length > 0 ? h.path : [o.at];
    for (const i of nodes) for (const p of o.pos[i]) if (!way.has(p)) way.set(p, o.frontEn[i]);
    let end = h && h.t.pos === o.pos ? h.end : o.at;
    // (And `ahead` pieces of its way on past that, short of its next passing place: it's on its way there.)
    if (this.placeOf(o, end) < 0)
      for (let i = o.succ[end][0] ?? -1, n = 0; i >= 0 && n < ahead; n++) {
        const fp = o.pos[i][o.pos[i].length - 1];
        if (!way.has(fp)) way.set(fp, o.frontEn[i]);
        end = i;
        if (this.placeOf(o, i) >= 0) break;
        i = o.succ[i][0] ?? -1;
      }
    return { way, place: this.placeOf(o, end) };
  }

  /** §13.6.2: the passing place (its road's group) node `i` of `t` stands wholly on, or −1. */
  private placeOf(t: DTrain, i: number): number {
    const { group } = passingOf(this.host.layout);
    const g = group.get(t.pos[i][0]);
    return g !== undefined && t.pos[i].every((p) => group.get(p) === g) ? g : -1;
  }

  /**
   * §13.6.2: the claim of `t` from node `from`: each piece of its booked way after the passing place it stands on (if
   * it does), to the first node it stands wholly on a passing place's road again (the piece → the end its front comes
   * onto it by; that place, −1: none within reach).
   */
  private claimOf(t: DTrain, from: number): { way: Map<number, number>; place: number } {
    const way = new Map<number, number>();
    const start = this.placeOf(t, from);
    let out = start < 0;
    for (let i = from, n = 0; i >= 0 && n < 600; n++) {
      const g = this.placeOf(t, i);
      if (!out && g !== start) out = true;
      if (out) {
        if (i !== from && g >= 0 && way.size > 0) return { way, place: g };
        for (const p of t.pos[i]) if (!way.has(p)) way.set(p, t.frontEn[i]);
      }
      i = t.succ[i][0] ?? -1;
    }
    return { way, place: -1 };
  }

  /**
   * §13.6.2: the train (its key) whose hold on a block a move of member `k` to node `to` out of the passing place it
   * stands on would meet, or that has the last road of the place it heads for; −1: none (or it isn't leaving one: in a
   * block already, refusing it helps nobody).
   */
  private reservedBy(engine: number, ts: readonly DTrain[], ways: readonly DTrain[], k: number, to: number): number {
    const t = ways[k];
    const start = this.placeOf(t, t.at);
    if (start < 0 || this.placeOf(t, to) === start) return -1;
    const mine = this.claimOf(t, t.at);
    // (No passing place within reach on: no block to book (rowan-2's network: a claim of 45 pieces met everyone).)
    if (mine.way.size === 0 || mine.place < 0) return -1;
    const { roads } = passingOf(this.host.layout);
    const roadUsed = new Set<number>();
    let heading = 0;
    let firstOnPlace = -1;
    for (const o of ts) {
      if (o.key === engine) continue;
      const here = o.pos[o.at];
      // (A road is used by a train waiting on it (held there): one running through leaves it (double track, own-05/06).)
      const oh0 = this.holdsBy.get(o.key);
      const waits = o.fixed || !oh0 || oh0.t.pos !== o.pos || oh0.end === o.at || this.placeOf(o, oh0.end) === mine.place;
      if (mine.place >= 0 && waits)
        roads[mine.place].forEach((r, ri) => {
          if (r.some((p) => here.includes(p))) {
            roadUsed.add(ri);
            if (firstOnPlace < 0) firstOnPlace = o.key;
          }
        });
      if (o.fixed) {
        // (A train that never moves: its pieces taken both ways.)
        if (here.some((p) => mine.way.has(p))) return o.key;
        continue;
      }
      // (Holding a block: in one, or granted out of its passing place into one.)
      const og = this.placeOf(o, o.at);
      if (og >= 0) {
        const oh = this.holdsBy.get(o.key);
        if (!oh || oh.t.pos !== o.pos || this.placeOf(o, oh.end) === og) continue;
      }
      // (Standing, held, waiting on this one: it isn't coming; this one goes first (own-05: the train leaving a line end
      // refused for one held short of it, waiting for it to leave).)
      const ohw = this.holdsBy.get(o.key);
      if (ohw && ohw.end === ohw.t.at && ohw.waitsOn === engine) continue;
      // (Head-on on plain track: crossing the same points the other way, one after the other, isn't meeting.)
      // (What it holds: where it stands and what it's granted, not its whole way on (own-11, the two-train map: a train
      // far off, its way on 20-30 pieces, held the asker back long before it came). First granted, first through.)
      const oc = HELD_ONLY.on ? this.heldOf(o, CLAIM_AHEAD) : this.claimOf(o, o.at);
      for (const [p, en] of oc.way) {
        const me = mine.way.get(p);
        if (me !== undefined && me !== en && !isPoints(this.host.layout, p) && this.plainPiece(p)) return o.key;
      }
      if (mine.place >= 0 && oc.place === mine.place && og !== mine.place && this.holdsBy.get(o.key)?.t.pos === o.pos && this.placeOf(o, this.holdsBy.get(o.key)!.end) === mine.place) heading++;
    }
    if (mine.place >= 0 && roadUsed.size + heading >= roads[mine.place].length) return firstOnPlace >= 0 ? firstOnPlace : -1;
    return -1;
  }

  /**
   * §13.6: whether there's an order in which each train of the stretch (`members` of `ways`, standing where `ways` has
   * them, member `k` moved to node `to` if `k` ≥ 0) reaches its stop after next: repeatedly, any train with a way there
   * by any road round the others still standing is taken off. −1: all were (safe); else a train (its key) left that
   * can't (the one to name). Hand-run, parked and other trains stand throughout.
   */
  private safeOrder(ways: readonly DTrain[], members: readonly number[], k: number, to: number, last = -1): number {
    // (Each train moves on a leg at a time, to its next stop (or a turn, or its booked way's end), when it has a way
    // there round the others where they stand; two legs and it's off the board (it runs on). Safe: all were.)
    const pos = ways.map((w, i) => (i === k ? to : w.at));
    // (The stops its move passes count as legs done: before and after the move, the same stops ahead are asked of.)
    const legs = ways.map((w, i) => (i === k && to >= 0 && to < w.main ? w.arrivals.filter((a) => w.order[a] > w.order[w.at] && w.order[a] <= w.order[to]).length : 0));
    if (k >= 0 && legs[k] >= 2) return -1;
    const left = members.filter((i) => !ways[i].fixed);
    const gone = new Set<number>();
    for (let round = 0, changed = true; changed && gone.size < left.length && round < 3 * left.length; round++) {
      changed = false;
      for (const i of left) {
        if (gone.has(i)) continue;
        // (`last`: it stays where it is till every other one is off the board.)
        if (i === last && left.some((j) => j !== i && !gone.has(j))) continue;
        // (In its way: trains standing on its next two legs whose own way runs over them the other way, and trains that
        // never move; one going its way moves on ahead of it.)
        const mine = way2(ways[i], pos[i]);
        const avoid = new Set<number>();
        for (let j = 0; j < ways.length; j++) {
          if (j === i || gone.has(j)) continue;
          const here = ways[j].pos[pos[j]];
          if (!here.some((p) => mine.has(p))) continue;
          let against = ways[j].fixed;
          if (!against) for (const [p, en] of way2(ways[j], pos[j])) if (mine.has(p) && mine.get(p) !== en) { against = true; break; }
          if (against) for (const p of here) avoid.add(p);
        }
        for (const p of ways[i].pos[pos[i]]) avoid.delete(p);
        const got = this.legTo(ways[i], pos[i], avoid);
        if (got < 0) {
          // (No leg on empty track either (its booked way ends, a close-up node): nothing known; not stuck.)
          if (avoid.size > 0 && this.legTo(ways[i], pos[i], new Set()) >= 0) continue;
          gone.add(i);
          changed = true;
          continue;
        }
        pos[i] = got;
        changed = true;
        if (++legs[i] >= 2 || got >= ways[i].main - 1) gone.add(i);
      }
    }
    for (const i of left) if (!gone.has(i)) return ways[i].key;
    return -1;
  }

  /**
   * Where `t` from node `from` gets to on its next leg (its next stop, a turn, or its booked way's end) by any road
   * over none of `avoid`'s pieces (the main node there), or −1.
   */
  private legTo(t: DTrain, from: number, avoid: ReadonlySet<number>): number {
    const stops = t.arrivals.filter((a) => t.order[a] > t.order[from]);
    const until = stops.length > 0 ? stops[0] : t.main - 1;
    if (from === until) return until;
    const seen = new Set<number>([from]);
    const todo = [from];
    while (todo.length > 0 && seen.size < 1200) {
      const i = todo.pop()!;
      if (i !== from && i < t.main && (i === until || t.order[i] >= t.order[until] || (t.turned[i] && t.order[i] > t.order[from]))) return i;
      for (const j of t.succ[i]) {
        if (seen.has(j) || t.pos[j].some((p) => avoid.has(p))) continue;
        seen.add(j);
        todo.push(j);
      }
    }
    return -1;
  }

  /** The train a held train waits for to clear a single line (its card), or −1. */
  singleLineWait(engine: number): number {
    const h = this.holdsBy.get(engine);
    return h && h.end === h.t.at ? (h.singleWait ?? -1) : -1;
  }

  /** The piece of the stop a routed train heads for (the one after, while it's at one), else `fallback`. */
  private stopAhead(engine: number, fallback: number): number {
    const r = this.host.route(engine);
    if (!r || r.stops.length === 0) return fallback;
    let i = r.at ? r.next + 1 : r.next;
    // (Its next stop under it already (come onto it, not yet "at" it): the one after; the router's walk ends at its aim.)
    const under = this.host.sim.findCar(engine)?.train.bogies;
    for (let n = 0; n < r.stops.length && under?.some((b) => b.pieceId === r.stops[i % r.stops.length]); n++) i++;
    return r.stops[i % r.stops.length];
  }

  /** Held where it stands (no move granted on): the router steers it nothing yet (its `awaitingGrant`). */
  awaiting(engine: number): boolean {
    const h = this.holdsBy.get(engine);
    return !!h && h.end === h.t.at;
  }

  /** The train (its engine) a held train waits for, its move's way taken by it (stall detection's wait graph). */
  waitingOn(engine: number): { engine: number } | null {
    const h = this.holdsBy.get(engine);
    return h && h.waitsOn >= 0 && h.stood >= 0 ? { engine: h.waitsOn } : null;
  }

  /**
   * The signals, owned (routing redesign §3.6, `Sim.signalOwner`): green for a train it holds iff its hold runs on past
   * that joint; null for a train it doesn't hold (the block decides, as before).
   */
  clearFor(ref: number, trainId: number): boolean | null {
    const h = this.byTrainId(trainId);
    if (!h) return null;
    const refs = this.pathRefs(h);
    for (let k = 0; k < refs.length - 1; k++) if (refs[k] === ref) return true;
    return false;
  }

  /**
   * The joint each node of a hold's path is left by, toward the next node on it: at a branch (a loop's other road, a
   * detour) that's the road granted, not the node's own joint (which runs the booked way: own-07, a signal on the loop
   * road's exit shown red for the train granted onto it). The last node's own joint. Cached by the holds' version.
   */
  private pathRefs(h: Hold): readonly number[] {
    if (h.refsVer === this.holdVer && h.refs) return h.refs;
    const t = h.t;
    const layout = this.host.layout;
    const out = h.path.map((i, k) => {
      const own = t.frontRef[i];
      const nx = h.path[k + 1];
      if (nx === undefined || own < 0) return own;
      const fp = t.pos[i][t.pos[i].length - 1];
      const nf = t.pos[nx][t.pos[nx].length - 1];
      if (nf === fp) return own;
      const ownNext = next(layout, fp, indexOfRef(own));
      if (ownNext?.pieceId === nf) return own;
      for (const w of waysFrom(layout, fp, t.frontEn[i], () => false)) if (next(layout, fp, w.exit)?.pieceId === nf) return connectorRef(fp, w.exit);
      return own;
    });
    h.refs = out;
    h.refsVer = this.holdVer;
    return out;
  }

  /** What a signal shows: green with a hold running past it, red with one ending at it; null: no hold there (as before). */
  aspect(ref: number): boolean | null {
    let red = false;
    for (const h of this.holdsBy.values()) {
      const refs = this.pathRefs(h);
      for (let k = 0; k < refs.length - 1; k++) if (refs[k] === ref) return true;
      if (h.t.frontRef[h.end] === ref) red = true;
    }
    return red ? false : null;
  }

  /** Goes up whenever a hold changes (the sim works its signals out again then). */
  ownerVersion(): number {
    return this.holdVer;
  }
  private holdVer = 0;
  /** The one-way pieces as of the last look (routing redesign §3.3 rule 3). */
  private oneWay: Uint8Array | undefined;

  private byTrainId(trainId: number): Hold | undefined {
    for (const h of this.holdsBy.values()) if (h.trainId === trainId) return h;
    return undefined;
  }

  /** The train held at the signal at this joint (its hold ends there), or −1: signals read the holds (§R 3.6). */
  gateAt(ref: number): number {
    return this.gate.get(ref) ?? -1;
  }

  gateVersion(): number {
    return this.gateVer;
  }

  private refreshGate(): void {
    const { layout, sim } = this.host;
    const next = new Map<number, number>();
    if (layout.signalCount > 0)
      for (const h of this.holdsBy.values()) {
        const ref = h.t.frontRef[h.end];
        if (ref >= 0 && layout.signalAt(ref)) next.set(ref, h.trainId);
        // (Standing, held where it stands (not granted on), or granted but standing short a while (something else holds
        // it: its grant goes back soon): the signal it faces there shows red too.)
        if (h.end !== h.t.at && !(h.short >= 0 && sim.ticks - h.short >= GATE_SHORT_S * 120)) continue;
        const train = sim.getTrain(h.trainId);
        if (!train || train.speed !== 0) continue;
        const net = this.host.drive(train);
        if (net === 0) continue;
        const b = net > 0 ? train.bogies[0] : train.bogies[train.bogies.length - 1];
        const piece = layout.getPiece(b.pieceId);
        if (!piece) continue;
        const exit = pathExitConnector(getPieceDef(piece.type, piece.flipped), b.pathIndex, net > 0 ? b.reversed : !b.reversed);
        if (exit < 0) continue;
        const at = connectorRef(b.pieceId, exit);
        if (layout.signalAt(at)) next.set(at, h.trainId);
      }
    let same = next.size === this.gate.size;
    if (same) for (const [k, v] of next) if (this.gate.get(k) !== v) same = false;
    if (!same) {
      this.gate = next;
      this.gateVer++;
    }
  }

}

/** Debug: where a train's next waiting points are, from where it stands. */
function branchesSummary(t: DTrain): string {
  const out: string[] = [];
  for (const x of t.succ[t.at]) {
    let i = x;
    let n = 0;
    while (!t.wait[i] && t.succ[i].length > 0 && n < 500) {
      i = t.succ[i][0];
      n++;
    }
    out.push(`${n + 1} nodes to ${i}${t.wait[i] ? "" : " (no wait)"}`);
  }
  return out.join("; ") || "none";
}

/** Debug: whose held track is on a train's next move. */
function takenBy(ts: DTrain[], k: number, holds: Map<number, Hold>): string {
  const mine = new Set<number>();
  const t = ts[k];
  for (let i = t.at + 1, n = 0; i < t.pos.length && n < 30; i = t.succ[i][0] ?? t.pos.length, n++) for (const p of t.pos[i]) mine.add(p);
  for (const p of t.pos[t.at]) mine.delete(p);
  const out: string[] = [];
  ts.forEach((o, j) => {
    if (j === k) return;
    const h = holds.get(o.key);
    for (const p of o.pos[o.at]) if (mine.has(p)) out.push(`${o.key} stands on ${p}`);
    if (h && h.t.pos === o.pos) for (const n of h.path) for (const p of o.pos[n]) if (mine.has(p)) out.push(`${o.key} holds ${p} (node ${n}, at ${o.at}, h.t.at ${h.t.at}, end ${h.end}, path ${h.path.join(",")})`);
  });
  return [...new Set(out)].slice(0, 4).join("; ") || "nobody";
}

/**
 * One-way pieces (routing redesign §3.3 rule 3): those every routed train's booked way runs over the same way (by the
 * end it comes onto them by), none of them under a train the dispatcher doesn't steer (hand-run, parked: who knows
 * which way it goes next).
 */
function oneWayOf(ts: readonly DTrain[]): Uint8Array {
  let max = 0;
  for (const t of ts) if (t.maxPiece > max) max = t.maxPiece;
  const seen = new Int32Array(max + 1).fill(-1);
  const two = new Uint8Array(max + 1);
  const mark = (p: number, en: number) => {
    if (seen[p] === -1) seen[p] = en;
    else if (seen[p] !== en) two[p] = 1;
  };
  for (const t of ts) {
    if (t.fixed) {
      for (const p of t.pos[t.at]) two[p] = 1;
      continue;
    }
    for (let i = t.at; i < t.main; i++) mark(t.pos[i][t.pos[i].length - 1], t.frontEn[i]);
  }
  const out = new Uint8Array(max + 1);
  for (let p = 0; p <= max; p++) out[p] = seen[p] !== -1 && !two[p] ? 1 : 0;
  return out;
}
