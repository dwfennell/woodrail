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
import { STAND_SHORT } from "../economy/sections";
import { blockerOf, bodyOf, buildTrain, DISPATCH_STATES, FAIR_TURNS, relocate, REROUTE_AFTER_S, search, snapsOf, stretchOf, withDetours, type DTrain, type RouteView, type Snap } from "./stretch";

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
}

const capAt: Cursor = { pieceId: -1, pathIndex: 0, reversed: false, s: 0 };

export class Dispatcher {
  /** Decisions made, grants, and each decision's cost (ms). */
  decisions = 0;
  grants = 0;
  detours = 0;
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
      if (!r || engine.lever === 0 || busy) {
        if (h) h.stood = -1;
        continue;
      }
      // (Granted but standing short of its hold's end (held by something else: a red signal's block, points): after
      // `GIVE_BACK_S` it gives the rest of its hold back, and asks again from where it stands.)
      if (h && t.speed === 0 && h.end !== h.t.at) {
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
    asking.sort((a, b) => (this.holdsBy.get(a)?.stood ?? Infinity) - (this.holdsBy.get(b)?.stood ?? Infinity) || a - b);
    for (const e of asking) this.decide(ts, snaps, e);
    this.refreshGate();
  }

  /** Each train's booked way, moved along from the last, or built afresh; its hold kept (or started where it stands). */
  private trainsOf(snaps: Snap[]): DTrain[] {
    const { layout, sim } = this.host;
    return snaps.map((s) => {
      const sig = `${s.stops?.join(",") ?? "-"}.${s.next}.${s.at ? 1 : 0}.${s.lever ? 1 : 0}`;
      const h = this.holdsBy.get(s.key);
      if (h && h.sig === sig) {
        const moved = relocate(h.t, bodyOf(layout, s));
        if (moved) {
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
        // (Rebuilt (its route moved on, or it left its way): its hold kept if the new way has the same place, else where it stands.)
        h.t = t;
        h.sig = sig;
        h.trainId = trainId;
        // (Rebuilt (its route moved on, it turned, it left its way): held where it stands, asking afresh. Carrying the old
        // hold's end over could hand it track it was never granted (a turned train's old end lies the other way).)
        this.setHold(h, t.at, []);
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
      if (k > 0 && t.frontRef[i] >= 0 && waysFrom(this.host.layout, fp, t.frontEn[i]).length > 1) h.points.push({ p: fp, en: t.frontEn[i], ex: indexOfRef(t.frontRef[i]), from: run + t.frontLen[i] });
      run += t.frontLen[i];
      last = fp;
    }
    // (Its aim: the first piece on the granted way that's off its booked one (a loop road, a detour).)
    h.aim = -1;
    const mainPieces = new Set<number>();
    for (let i = t.at; i < t.main; i++) for (const x of t.pos[i]) mainPieces.add(x);
    for (const i of p) {
      const fp = t.pos[i][t.pos[i].length - 1];
      if (i >= t.main && !mainPieces.has(fp)) {
        h.aim = fp;
        break;
      }
    }
  }

  private decide(ts: DTrain[], snaps: Snap[], engine: number): void {
    const h = this.holdsBy.get(engine);
    const k = ts.findIndex((t) => t.key === engine);
    if (!h || k < 0 || ts[k].fixed) return;
    h.decided = this.host.sim.ticks;
    const t0 = performance.now();
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
    let r = search(placed, members, { cap: DISPATCH_STATES, backUps: false, order, taken, weights });
    let ways = placed;
    let to = -1;
    if (r.first[0] >= 0 && r.first[0] >= r.plain) to = r.firstTo[0];
    else if (r.plain < r.of && h.stood >= 0 && this.host.sim.ticks - h.stood >= REROUTE_AFTER_S * 120 && r.states < DISPATCH_STATES) {
      // (Stuck: with detours.)
      const dt = withDetours(this.host.layout, snaps, placed, members);
      if (dt) {
        const rd = search(dt, members, { cap: DISPATCH_STATES - r.states, backUps: false, order, taken, detours: true, weights });
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
    this.decisions++;
    this.decisionMs.push(performance.now() - t0);
    const pt = this.perTrain.get(engine) ?? [0, 0];
    this.perTrain.set(engine, pt);
    pt[to < 0 ? 1 : 0]++;
    // (Who it waits for: the train in its move's way, or (its turn not yet) the one the best order lets go first.)
    const firstOther = r.order.find((m) => m.k !== 0);
    h.waitsOn = to >= 0 ? -1 : r.first[0] < 0 ? this.blocker(placed, k) : firstOther ? placed[members[firstOther.k]].key : -1;
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
    // (Points ahead on its way not lying for it yet (the router sets them as it comes): it stands short of them.)
    for (const q of h.points) {
      // (Ahead of its front piece: its run to the hold's end from its near end is no more than the front piece's beyond.)
      if (q.from <= rem + 1 && q.p !== c.pieceId && !this.liesFor(q.p, q.en, q.ex)) gap = Math.min(gap, len - c.s + rem - q.from);
    }
    return gap - CAR_SPECS[lead.kind].bogieInset - STAND_SHORT;
  }

  /** Does it hold this train (a routed one with its lever on)? */
  holds(train: Train): boolean {
    const engine = train.cars.find((c) => c.kind === "engine");
    return !!engine && engine.lever !== 0 && this.holdsBy.has(engine.id);
  }

  /** Do these points lie for a run in by `en` and out by `ex`? */
  private liesFor(p: number, en: number, ex: number): boolean {
    const ways = waysFrom(this.host.layout, p, en, () => true);
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
    if (!h || h.aim < 0) return undefined;
    // (On it: from there it's steered as booked again.)
    const train = this.host.sim.getTrain(h.trainId);
    if (!train || train.bogies.some((b) => b.pieceId === h.aim)) {
      h.aim = -1;
      return undefined;
    }
    return { follow: () => true, aim: h.aim };
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
    const t = h.t;
    for (let k = 0; k < h.path.length - 1; k++) if (t.frontRef[h.path[k]] === ref) return true;
    return false;
  }

  /** What a signal shows: green with a hold running past it, red with one ending at it; null: no hold there (as before). */
  aspect(ref: number): boolean | null {
    let red = false;
    for (const h of this.holdsBy.values()) {
      const t = h.t;
      for (let k = 0; k < h.path.length - 1; k++) if (t.frontRef[h.path[k]] === ref) return true;
      if (t.frontRef[h.end] === ref) red = true;
    }
    return red ? false : null;
  }

  /** Goes up whenever a hold changes (the sim works its signals out again then). */
  ownerVersion(): number {
    return this.holdVer;
  }
  private holdVer = 0;

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
