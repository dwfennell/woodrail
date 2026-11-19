/**
 * The per-stretch search (dispatcher spec §5, §12 "What follows" 3, docs/superpowers/specs/2026-11-18-dispatcher.md):
 * for one decision, only the trains in a ring of waits and those booked onto the same stretches, each along its booked
 * way cut at waiting points, and a search over grant orders (plus one back-up a train) for one that keeps the most
 * trains delivering. Both the dispatcher's decider (`decide`) and a judge that finishes (`judgeStretch`).
 *
 * The model (deliberately the dispatcher's own, not the oracle's every-lever one):
 *
 * - **A train's booked way** (`buildTrain`): its plan (`plan.ts`, the router's costs) from where it stands through its
 *   next stops, as the positions it stands in a piece at a time (the pieces under it from its front back as far as it's
 *   long), turning where the plan turns (a line's end). One length of the track it came by is kept behind it, for a
 *   back-up.
 * - **Waiting points:** positions clear of points (or at one of its own stops, where a train too long for its yard may
 *   stand over them): the last such before points, a stop, a line end. A move runs from one waiting point to the next,
 *   all at once (§R 3.4), over pieces no other train stands on; short of that, up close behind the train in the way
 *   (following), if that's clear of points.
 * - **Back-up** (§2.2 step 5): at most once a train, back along the way it came at most its own length, onto pieces no
 *   one stands on, to rest clear of points; on from there the way it was going. Only searched when no order without
 *   one keeps them all going.
 * - **Delivering:** reaching its goal: arriving at its `HORIZON`th stop ahead. A train there may still move on (out of
 *   the others' way) as far as its booked way goes.
 * - **The stretch** (`stretchOf`): the deciding train, and every train standing on, or whose next move runs onto, the
 *   way any of them is booked up to its goal; up to `MAX_TRAINS`, nearest first. The rest stand as they are.
 *
 * The search is a depth-first walk of the grant orders, memoised by state (indices along each train's way, who has
 * backed up): the states form a DAG (moves only go on, a back-up only once), so a state's value (the most trains
 * delivering from it) is the best of its children. Longest waiter first (fair turns). Capped at `cap` states: past it,
 * a state's value is what it has already (the best found so far).
 *
 * Event-driven and allocation-light: built per train and cached by the caller; a search allocates its memo only.
 * Nothing in the game runs it yet (shadow, §8 step 1).
 */
import { connectorRef, getPieceDef, pathLength, type Layout } from "../track";
import { blocksOf } from "../game/signal-place";
import { next, waysFrom } from "./graph";
import { plan, ROUTE_COSTS, type PlanState } from "./plan";
import { elemsOf, isSwitch, piecesFor, type Elem } from "./oracle";
import { trainLength } from "../sim/train-cars";
import type { Sim } from "../sim";
import type { Economy } from "../economy/economy";

/**
 * Signals as waiting points (§2.1): a train resting clear of points with its front at a signal facing its way waits
 * there (the hold shows as the signal's aspect). A signal whose block is too short to rest clear of points isn't one.
 * Off by default (`DISPATCH_SIGNAL_WAITS=1` on): on the eight maps it changed no decision's kind but capped 60% more
 * decisions (10,212 against 6,416) and left 17 jams unjudged against 7 (2026-11-19).
 */
export const SIGNAL_WAITS = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}).DISPATCH_SIGNAL_WAITS === "1";
/**
 * A detour is looked for only once the train has stood this long (s) (§10's `REROUTE_AFTER`: not while the wait is
 * young; a short wait often clears by itself, and planning detours is a decision's dearest part).
 */
export const REROUTE_AFTER_S = 10;
/** Held this many decisions in a row with its move free: its turn comes, at the cost of at most one train's delivery. */
export const FAIR_TURNS = 8;
/** The stops ahead a train's goal is (its next stop is 1). */
export const HORIZON = 1;
/** Stops ahead its booked way runs to (past its goal: room to move on out of the others' way). */
export const BOOKED = 3;
/** The most trains one search takes (the stretch's nearest). */
export const MAX_TRAINS = 8;
/**
 * The dispatcher's state cap per decision (§5's `DISPATCH_STATES`): 500, not the spec's 2,000, to keep a decision that
 * runs to it within §5's 1 ms in Node (0.9–1.4 µs a state warm on the reference maps, more on 8-train stretches;
 * `npm run dispatch:report`).
 */
export const DISPATCH_STATES = 500;
/** The judge's state cap (a jam judged to the end: test and report only). */
export const JUDGE_STATES = 1_000_000;
/** Pieces of the way it came kept behind a train's tail (for a back-up). */
const BEHIND = 6;
/** The most positions one train's booked way has. */
const MAX_POSITIONS = 800;

/** A train as it stands, enough to book it (a snapshot: kept a while for "before"). */
export interface Snap {
  /** Its engine's car id (its first car's, without one). */
  key: number;
  /** Its pieces, tail first, front last, with up to `BEHIND` pieces of the way it came behind its tail. */
  elems: Elem[];
  length: number;
  /** Its stops' pieces in order (null: hand-run). */
  stops: number[] | null;
  /** The stop it heads for, and whether it's at it now. */
  next: number;
  at: boolean;
  /** Its lever on (else parked: track that's taken). */
  lever: boolean;
  speed: number;
}

/** A routed train's stops (pieces) and where it is on them; null: hand-run. */
export type RouteView = (engine: number) => { stops: number[]; next: number; at: boolean } | null;

export function snapOf(layout: Layout, sim: Sim, economy: Economy): Snap[] {
  return snapsOf(layout, sim, (e) => {
    const route = economy.routeOf(e);
    if (!route || route.stops.length === 0) return null;
    const stops = route.stops.map((s) => economy.depot(s.depotId)?.pieceId ?? -1);
    return stops.every((p) => p >= 0) ? { stops, next: route.next, at: !!route.at } : null;
  });
}

export function snapsOf(layout: Layout, sim: Sim, routeOf: RouteView): Snap[] {
  const out: Snap[] = [];
  for (const t of sim.trains()) {
    if (t.derailed) continue;
    const engine = t.cars.find((c) => c.kind === "engine");
    const key = (engine ?? t.cars[0]).id;
    const route = engine ? routeOf(engine.id) : null;
    out.push({
      key,
      elems: elemsOf(layout, t, piecesFor(t) + BEHIND),
      length: trainLength(t),
      stops: route ? route.stops : null,
      next: route?.next ?? 0,
      at: !!route?.at,
      lever: !!engine && engine.lever !== 0,
      speed: t.speed,
    });
  }
  return out;
}

/** The pieces under a train as it stands (front back, as far as it's long): as its booked way's node there. */
export function bodyOf(layout: Layout, s: Snap): number[] {
  let sum = 0;
  let j = s.elems.length - 1;
  for (; j >= 0 && sum < s.length; j--) sum += lenOf(layout, s.elems[j]);
  return s.elems.slice(j + 1).map((e) => e.p);
}

/** `t` moved on along its booked way to stand as `body` (its pieces): a copy standing there, or null (not on its way). */
export function relocate(t: DTrain, body: readonly number[]): DTrain | null {
  const same = (i: number) => t.pos[i].length === body.length && body.every((p, k) => t.pos[i][k] === p);
  if (same(t.at)) return t;
  for (let i = t.at + 1; i < t.pos.length; i++) if (same(i) && (i < t.main || t.order[i] >= t.order[t.at])) return { ...t, at: i };
  return null;
}

/**
 * One train along its booked way: positions (nodes) a piece apart, each with the pieces under it. The booked way's
 * nodes come first, in order (`main`); a loop's other road (`ROAD_SLACK`) branches off at its points and joins again.
 */
export interface DTrain {
  key: number;
  length: number;
  /** Never moves in the search: hand-run (respected as it stands), parked, or no way to its stop. */
  fixed: boolean;
  /** Each node's pieces. */
  pos: Int32Array[];
  /** Each node's next nodes (the booked way's first), and the one before it (the way it came: a back-up's way). */
  succ: Int32Array[];
  prev: Int32Array;
  /** May rest there (clear of points, or at its own stop); a waiting point. */
  rest: Uint8Array;
  wait: Uint8Array;
  /** Clear of points (a back-up rests only there, even at a stop). */
  plain: Uint8Array;
  /** Which run of the way (a turn starts the next) and how far along it (mm, its front): for back-ups. */
  seg: Int32Array;
  dist: Float64Array;
  /** How far along the booked way (the main node it stands level with): its goal is reached at `goal` or on. */
  order: Float64Array;
  /** The booked way's own nodes (the rest are other roads). */
  main: number;
  /** A stuck train's detour (§2.2 step 4): nodes of another way to its next stop, off the booked way's track. */
  detour: Uint8Array;
  /**
   * Part pieces: a close-up node (its front piece only part way) and each main node's close-up (−1: none); how much of
   * its tail piece a node covers (mm, from that piece's far end) and the connector it runs onto it by; its front's.
   */
  half: Uint8Array;
  closeOf: Int32Array;
  tailCover: Float64Array;
  tailEn: Int32Array;
  frontEn: Int32Array;
  /** Its front piece's length (mm, along its path). */
  frontLen: Float64Array;
  /** The highest piece id on its way (for sizing a search's tables). */
  maxPiece: number;
  /** The joint at each node's front, the way it runs (`connectorRef` of its front piece's exit; −1: none). */
  frontRef: Int32Array;
  /** A turn node (it has just turned at a line's end). */
  turned: Uint8Array;
  /**
   * Per node: the pieces of the plain signal block beyond its front (a signal at its front's joint facing its way, its
   * block with no points in it), which a move on past it needs free as well as its own way (the sim shows that signal
   * red while a train is anywhere in it); null: none.
   */
  blockAfter: (Int32Array | null)[];
  /** Where it stands now, and its goal (a main node; −1: none). */
  at: number;
  goal: number;
  /** Where it arrives at each stop ahead. */
  arrivals: number[];
}

/** A piece's length along the path between two of its ends (cached per layout). */
const lens = new WeakMap<Layout, Map<number, number>>();
function lenOf(layout: Layout, e: Elem): number {
  let m = lens.get(layout);
  if (!m) lens.set(layout, (m = new Map()));
  const k = (e.p * 16 + e.en + 1) * 16 + e.ex + 1;
  let v = m.get(k);
  if (v === undefined) {
    const piece = layout.getPiece(e.p);
    const def = piece ? getPieceDef(piece.type, piece.flipped) : undefined;
    const path = def?.paths.find((q) => (q.from === e.en && q.to === e.ex) || (q.from === e.ex && q.to === e.en)) ?? def?.paths[0];
    m.set(k, (v = path ? pathLength(path.geom) : 216));
  }
  return v;
}

const sw = new WeakMap<Layout, Map<number, boolean>>();
function swOf(layout: Layout, p: number): boolean {
  let m = sw.get(layout);
  if (!m) sw.set(layout, (m = new Map()));
  let v = m.get(p);
  if (v === undefined) m.set(p, (v = isSwitch(layout, p)));
  return v;
}

/** A plain block's pieces beyond the signal at `ref` (cached per layout and its signals' version); null: a path signal's. */
const blockCache = new WeakMap<Layout, { ver: string; m: Map<number, Int32Array | null> }>();
function plainBlock(layout: Layout, ref: number): Int32Array | null {
  const ver = `${layout.signalsVersion}.${layout.revision}`;
  let c = blockCache.get(layout);
  if (!c || c.ver !== ver) blockCache.set(layout, (c = { ver, m: new Map() }));
  let b = c.m.get(ref);
  if (b === undefined) {
    const pieces = [...blocksOf(layout, ref).ahead.keys()];
    b = pieces.some((p) => swOf(layout, p)) ? null : Int32Array.from(pieces);
    c.m.set(ref, b);
  }
  return b;
}

/** A loop's other road costing up to this much more (mm) than the booked one is one it may take (the router's). */
export const ROAD_SLACK = 2000;
/** The most pieces a loop's other road runs before it joins the booked way again. */
const ROAD_MAX = 24;

/** Train `s` along its booked way (`horizon`: its goal, stops ahead; `BOOKED`). */
export function buildTrain(layout: Layout, s: Snap, horizon = HORIZON, avoid?: ReadonlySet<number>): DTrain {
  const L = s.length;
  const pos: number[][] = [];
  const rest: boolean[] = [];
  const plain: boolean[] = [];
  const seg: number[] = [];
  const dist: number[] = [];
  const isStop: boolean[] = [];
  const turned: boolean[] = [];
  const laneAt: number[] = [];
  const arrivals: number[] = [];
  const lanes: Elem[][] = [];
  let lane: Elem[] = s.elems.map((e) => ({ ...e }));
  lanes.push(lane);
  let run = 0;
  const cumOf = (ln: Elem[]) => {
    const c: number[] = [];
    let d = 0;
    for (const e of ln) c.push((d += lenOf(layout, e)));
    return c;
  };
  let cum = cumOf(lane);
  /** A lane's elems under the train with its front at ln[i] (null: the lane's too short behind). */
  const bodyOf = (ln: Elem[], i: number, partial = false): Elem[] | null => {
    let sum = 0;
    let j = i;
    for (; j >= 0 && sum < L; j--) sum += lenOf(layout, ln[j]);
    if (sum < L && !partial) return null;
    return ln.slice(j + 1, i + 1);
  };
  const tailCover: number[] = [];
  const tailEn: number[] = [];
  const frontEn: number[] = [];
  const frontLen: number[] = [];
  const atSignal: boolean[] = [];
  const frontRef: number[] = [];
  const node = (body: Elem[], stop: boolean, turn: boolean, sg: number, d: number, li: number) => {
    const ps = body.map((e) => e.p);
    // (How much of its tail piece it covers (mm, from that piece's far end) and which way it runs onto it; its front's.)
    let sum = 0;
    for (const e of body) sum += lenOf(layout, e);
    tailCover.push(body.length > 0 ? lenOf(layout, body[0]) - Math.max(0, sum - L) : 0);
    tailEn.push(body[0]?.en ?? -1);
    frontEn.push(body[body.length - 1]?.en ?? -1);
    frontLen.push(body.length > 0 ? lenOf(layout, body[body.length - 1]) : 0);
    // (Its front at a signal facing its way: a waiting point if it rests clear of points there (§2.1).)
    const fr = body[body.length - 1];
    frontRef.push(fr && fr.ex >= 0 ? connectorRef(fr.p, fr.ex) : -1);
    atSignal.push(SIGNAL_WAITS && !!fr && fr.ex >= 0 && !!layout.signalAt(connectorRef(fr.p, fr.ex)));
    const clear = ps.every((p) => !swOf(layout, p));
    pos.push(ps);
    plain.push(clear);
    rest.push(clear || (stop && !!s.stops));
    seg.push(sg);
    dist.push(d);
    isStop.push(stop);
    turned.push(turn);
    laneAt.push(li);
    return pos.length - 1;
  };
  const push = (body: Elem[], stop: boolean, turn: boolean) => node(body, stop, turn, run, cum[lane.length - 1], lane.length - 1);
  // Behind it (the way it came), then where it stands.
  for (let i = 0; i < lane.length - 1; i++) {
    const b = bodyOf(lane, i);
    if (b) node(b, false, false, 0, cum[i], i);
  }
  const at = pos.length;
  push(bodyOf(lane, lane.length - 1, true)!, s.at, false);
  const fixed = !s.stops || !s.lever;
  if (!fixed) {
    const stops = s.stops!;
    const first = s.at ? s.next + 1 : s.next;
    const front = lane[lane.length - 1];
    let state: PlanState | null = { pieceId: front.p, entry: front.en, lead: true };
    const apply = (st: { pieceId: number; entry: number; exit: number; reverse?: boolean }): boolean => {
      const f = lane[lane.length - 1];
      if (st.pieceId === f.p) {
        if (f.ex !== st.exit) lane[lane.length - 1] = { p: f.p, en: f.en, ex: st.exit };
      } else if (pos[pos.length - 1].includes(st.pieceId)) {
        // (After a turn: back through pieces it's on already.)
      } else {
        const n = f.ex < 0 ? null : next(layout, f.p, f.ex);
        if (!n || n.pieceId !== st.pieceId) return false;
        lane.push({ p: st.pieceId, en: st.entry, ex: st.exit });
        cum.push(cum[cum.length - 1] + lenOf(layout, lane[lane.length - 1]));
        push(bodyOf(lane, lane.length - 1, true)!, false, false);
      }
      if (st.reverse) {
        const body = bodyOf(lane, lane.length - 1, true)!;
        lane = body.reverse().map((e) => ({ p: e.p, en: e.ex, ex: e.en }));
        lanes.push(lane);
        cum = cumOf(lane);
        run++;
        push(bodyOf(lane, lane.length - 1, true)!, false, true);
      }
      return true;
    };
    for (let j = 0; j < BOOKED && state && pos.length < MAX_POSITIONS; j++) {
      const target = stops[(first + j) % stops.length];
      const p = plan(layout, state, target, ROUTE_COSTS);
      if (!p) break;
      let ok = true;
      for (const st of p.steps) if (!(ok = apply(st))) break;
      if (!ok) break;
      // (Onto the stop's piece: arrived. The way through it, the next leg's.)
      const f = lane[lane.length - 1];
      if (f.p !== target) {
        const n = f.ex < 0 ? null : next(layout, f.p, f.ex);
        if (!n || n.pieceId !== target) break;
        const w = waysFrom(layout, n.pieceId, n.entry, () => true)[0];
        if (!apply({ pieceId: n.pieceId, entry: n.entry, exit: w?.exit ?? -1 })) break;
        state = { pieceId: n.pieceId, entry: n.entry, lead: true };
      }
      const last = pos.length - 1;
      isStop[last] = true;
      rest[last] = true;
      arrivals.push(last);
    }
  }
  // (Standing on its next stop already, not yet "at" it: that stop is where it is; its goals are the ones after.)
  let skip = 0;
  if (arrivals.length > 0 && arrivals[0] === at) {
    arrivals.shift();
    skip = 1;
  }
  const main = pos.length;
  const succ: number[][] = pos.map((_, i) => (i + 1 < main ? [i + 1] : []));
  const prev: number[] = pos.map((_, i) => (i > 0 && seg[i] === seg[i - 1] ? i - 1 : -1));
  const order: number[] = pos.map((_, i) => i);
  // A loop's other road: off the booked way at facing points ahead of it, back onto it (the same way) within
  // `ROAD_MAX` pieces, no stop of its own bypassed, costing at most `ROAD_SLACK` more.
  if (!fixed) {
    const nodeOf = new Map<string, number>();
    for (let i = at; i < main; i++) nodeOf.set(`${seg[i]}.${laneAt[i]}`, i);
    const stopSet = new Set(s.stops!);
    for (let i = at; i < main && pos.length < MAX_POSITIONS; i++) {
      if (turned[i]) continue;
      const ln = lanes[seg[i]];
      const li = laneAt[i];
      const q = ln[li];
      if (!swOf(layout, q.p) || ln.length <= li + 1) continue;
      for (const w of waysFrom(layout, q.p, q.en)) {
        if (w.exit < 0 || w.exit === q.ex) continue;
        const road: Elem[] = [];
        let cur: Elem = { p: q.p, en: q.en, ex: w.exit };
        let j = -1;
        for (let step = 0; step < ROAD_MAX; step++) {
          const nx = next(layout, cur.p, cur.ex);
          if (!nx) break;
          const ways = waysFrom(layout, nx.pieceId, nx.entry);
          // (Back onto the booked way: at trailing points, out the way it goes.)
          const m = ln.findIndex((e, k) => k > li && e.p === nx.pieceId);
          if (m >= 0) {
            if (ln[m].en !== nx.entry && ways.some((x) => x.exit === ln[m].ex)) {
              road.push({ p: nx.pieceId, en: nx.entry, ex: ln[m].ex });
              j = m;
            }
            break;
          }
          if (road.some((e) => e.p === nx.pieceId)) break;
          if (ways.length !== 1 || ways[0].exit < 0) break;
          cur = { p: nx.pieceId, en: nx.entry, ex: ways[0].exit };
          road.push(cur);
        }
        if (j < 0 || road.length < 2) continue;
        if (ln.slice(li + 1, j + 1).some((e) => stopSet.has(e.p))) continue;
        let byMain = 0;
        for (let k = li + 1; k <= j; k++) byMain += lenOf(layout, ln[k]);
        let byRoad = 0;
        for (const e of road) byRoad += lenOf(layout, e);
        if (byRoad > byMain + ROAD_SLACK) continue;
        // (Its lane: up to the points, the other road and the points it joins by, the booked way's on from there.)
        const alt = [...ln.slice(0, li), { p: q.p, en: q.en, ex: w.exit }, ...road, ...ln.slice(j + 1)];
        const altCum = cumOf(alt);
        const roadSet = new Set(road.slice(0, -1).map((e) => e.p));
        let before = i;
        for (let f = li + 1; f < alt.length && pos.length < MAX_POSITIONS; f++) {
          const body = bodyOf(alt, f, true)!;
          const onMain = f >= li + road.length ? nodeOf.get(`${seg[i]}.${j + f - li - road.length}`) : undefined;
          if (onMain !== undefined && !body.some((e) => roadSet.has(e.p))) {
            succ[before].push(onMain);
            break;
          }
          const id = node(body, false, false, seg[i], altCum[f], -1);
          succ.push([]);
          prev.push(before);
          order.push(i + 0.5);
          succ[before].push(id);
          before = id;
        }
      }
    }
  }
  // A detour (§2.2 step 4, stuck; given `avoid`, the pieces the trains in its way stand on): to its next stop by
  // another way off those of them on its booked way, however far round (save 3's Bluebell: about 9× the direct way); on
  // to the stops after as booked from there. Searched only when no order keeps the stretch going.
  const detourFrom = pos.length;
  const extra: [number, number][] = [];
  if (!fixed && avoid && arrivals.length > 0 && pos.length < MAX_POSITIONS) {
    const stops = s.stops!;
    const first = (s.at ? s.next + 1 : s.next) + skip;
    const target0 = stops[first % stops.length];
    const off = new Set<number>();
    for (let i = at + 1; i <= arrivals[0]; i++) for (const p of pos[i]) if (avoid.has(p)) off.add(p);
    for (const p of pos[at]) off.delete(p);
    off.delete(target0);
    const offWay = { id: "detour", against: (pieceId: number, exit: number) => off.has(next(layout, pieceId, exit)?.pieceId ?? -1) };
    lane = s.elems.map((e) => ({ ...e }));
    cum = cumOf(lane);
    let dRun = 0;
    let before = at;
    const dPush = (body: Elem[], stop: boolean, turn: boolean, order0: number) => {
      const id = node(body, stop, turn, dRun, cum[lane.length - 1], -1);
      extra.push([before, id]);
      prevD.push(seg[before] === dRun ? before : -1);
      orderD.push(order0);
      before = id;
      return id;
    };
    const prevD: number[] = [];
    const orderD: number[] = [];
    let leg = 0;
    const orderNow = () => (arrivals[leg] ?? main + leg) - 0.5;
    const applyD = (st: { pieceId: number; entry: number; exit: number; reverse?: boolean }): boolean => {
      const f = lane[lane.length - 1];
      if (st.pieceId === f.p) {
        if (f.ex !== st.exit) lane[lane.length - 1] = { p: f.p, en: f.en, ex: st.exit };
      } else if (pos[before].includes(st.pieceId)) {
        // (After a turn: back through pieces it's on already.)
      } else {
        const nx = f.ex < 0 ? null : next(layout, f.p, f.ex);
        if (!nx || nx.pieceId !== st.pieceId) return false;
        lane.push({ p: st.pieceId, en: st.entry, ex: st.exit });
        cum.push(cum[cum.length - 1] + lenOf(layout, lane[lane.length - 1]));
        dPush(bodyOf(lane, lane.length - 1, true)!, false, false, orderNow());
      }
      if (st.reverse) {
        const body = bodyOf(lane, lane.length - 1, true)!;
        lane = body.reverse().map((e) => ({ p: e.p, en: e.ex, ex: e.en }));
        cum = cumOf(lane);
        dRun = dRun === 0 ? run + 1 : dRun + 1;
        dPush(bodyOf(lane, lane.length - 1, true)!, false, true, orderNow());
      }
      return pos.length < MAX_POSITIONS;
    };
    const front = lane[lane.length - 1];
    let state: PlanState | null = { pieceId: front.p, entry: front.en, lead: true };
    for (leg = 0; leg < BOOKED - skip && state; leg++) {
      const target = stops[(first + leg) % stops.length];
      const p = plan(layout, state, target, ROUTE_COSTS, undefined, leg === 0 ? offWay : undefined);
      if (!p) break;
      let ok = true;
      for (const st of p.steps) if (!(ok = applyD(st))) break;
      if (!ok) break;
      const f = lane[lane.length - 1];
      if (f.p !== target) {
        const nx = f.ex < 0 ? null : next(layout, f.p, f.ex);
        if (!nx || nx.pieceId !== target) break;
        const w = waysFrom(layout, nx.pieceId, nx.entry, () => true)[0];
        if (!applyD({ pieceId: nx.pieceId, entry: nx.entry, exit: w?.exit ?? -1 })) break;
        state = { pieceId: nx.pieceId, entry: nx.entry, lead: true };
      }
      const last = pos.length - 1;
      if (last < detourFrom) break;
      isStop[last] = true;
      rest[last] = true;
      orderD[last - detourFrom] = arrivals[leg] ?? main + leg;
    }
    if (off.size === 0 || pos.length === detourFrom || !isStop.slice(detourFrom).some((x) => x)) {
      // (No other way to its stop: none.)
      pos.length = rest.length = plain.length = seg.length = dist.length = isStop.length = turned.length = laneAt.length = tailCover.length = tailEn.length = frontEn.length = frontLen.length = atSignal.length = frontRef.length = detourFrom;
      extra.length = 0;
    } else {
      for (let k = 0; k < pos.length - detourFrom; k++) {
        succ.push([]);
        prev.push(prevD[k]);
        order.push(orderD[k]);
      }
      for (const [a, b] of extra) succ[a].push(b);
    }
  }
  // Close-up nodes (part pieces, §R's table): for each main node m, its front onto piece q only part way, the rest of it
  // as at m − 1, up close behind a train whose tail is on the far end of q going the same way. Reached only by
  // following (the search's `forward`), on to m once q is clear.
  const half: number[] = pos.map(() => 0);
  const closeOf: number[] = pos.map(() => -1);
  if (!fixed)
    for (let m = at + 1; m < main && pos.length < MAX_POSITIONS; m++) {
      if (seg[m] !== seg[m - 1] || turned[m]) continue;
      const q = pos[m][pos[m].length - 1];
      if (pos[m - 1].includes(q) || swOf(layout, q)) continue;
      const ps = [...pos[m - 1], q];
      if (!ps.every((p) => !swOf(layout, p))) continue;
      const c = pos.length;
      pos.push(ps);
      plain.push(true);
      rest.push(true);
      seg.push(seg[m]);
      dist.push(dist[m - 1]);
      isStop.push(false);
      turned.push(false);
      laneAt.push(-1);
      tailCover.push(tailCover[m - 1]);
      tailEn.push(tailEn[m - 1]);
      frontEn.push(frontEn[m]);
      frontLen.push(frontLen[m]);
      atSignal.push(false);
      frontRef.push(frontRef[m]);
      succ.push([m]);
      prev.push(m - 1);
      order.push(m - 0.5);
      half.push(1);
      closeOf.push(-1);
      closeOf[m] = c;
    }
  const n = pos.length;
  const restA = Uint8Array.from(rest, (b) => (b ? 1 : 0));
  const wait = new Uint8Array(n);
  for (let i = at; i < n; i++) wait[i] = restA[i] && (isStop[i] || turned[i] || atSignal[i] || succ[i].length === 0 || succ[i].some((x) => !restA[x])) ? 1 : 0;
  const goal = fixed || arrivals.length === 0 ? -1 : arrivals[Math.min(horizon, arrivals.length) - 1];
  return {
    key: s.key,
    length: L,
    fixed: fixed || goal < 0,
    pos: pos.map((ps) => Int32Array.from(ps)),
    succ: succ.map((x) => Int32Array.from(x)),
    prev: Int32Array.from(prev),
    rest: restA,
    wait,
    plain: Uint8Array.from(plain, (b) => (b ? 1 : 0)),
    seg: Int32Array.from(seg),
    dist: Float64Array.from(dist),
    order: Float64Array.from(order),
    main,
    half: Uint8Array.from(half),
    closeOf: Int32Array.from(closeOf),
    tailCover: Float64Array.from(tailCover),
    tailEn: Int32Array.from(tailEn),
    frontEn: Int32Array.from(frontEn),
    frontLen: Float64Array.from(frontLen),
    frontRef: Int32Array.from(frontRef),
    blockAfter: frontRef.map((ref) => (ref >= 0 && layout.signalAt(ref) ? plainBlock(layout, ref) : null)),
    turned: Uint8Array.from(turned, (b) => (b ? 1 : 0)),
    maxPiece: pos.reduce((m, ps) => ps.reduce((a, p) => (p > a ? p : a), m), 0),
    detour: Uint8Array.from({ length: n }, (_, i) => (i >= detourFrom && extra.length > 0 ? 1 : 0)),
    at,
    goal,
    arrivals,
  };
}

/**
 * The stretch's trains with detours (§2.2 step 4): each member rebuilt with another way to its next stop off the
 * pieces the other members stand on, where its booked way runs over them. A copy of `trains` (the others as they were),
 * or null if none has one.
 */
const detourCache = new Map<string, DTrain>();

export function withDetours(layout: Layout, snaps: readonly Snap[], trains: readonly DTrain[], members: readonly number[], horizon = HORIZON): DTrain[] | null {
  const out = trains.slice();
  let any = false;
  for (const k of members) {
    const t = trains[k];
    if (t.fixed) continue;
    const others = new Set<number>();
    for (const j of members) if (j !== k) for (const p of trains[j].pos[trains[j].at]) others.add(p);
    // (Only what stands on its way to its next stop matters: none, no detour frees anything.)
    const avoid = new Set<number>();
    const to = t.arrivals[0] ?? t.main - 1;
    for (let i = t.at + 1; i <= to && i < t.main; i++) for (const p of t.pos[i]) if (others.has(p)) avoid.add(p);
    if (avoid.size === 0) continue;
    const s = snaps.find((x) => x.key === t.key);
    if (!s) continue;
    // (Cached by where it stands, its route and what it avoids: a jam that lasts plans its detours once.)
    const f = s.elems[s.elems.length - 1];
    const ck = `${s.key}.${f.p}.${f.en}.${s.next}.${s.at ? 1 : 0}.${horizon}.${[...avoid].sort((a, b) => a - b).join(",")}`;
    let d = detourCache.get(ck);
    if (!d) {
      d = buildTrain(layout, s, horizon, avoid);
      if (detourCache.size > 4000) detourCache.clear();
      detourCache.set(ck, d);
    }
    if (d.detour.some((x) => x === 1)) {
      out[k] = d;
      any = true;
    }
  }
  return any ? out : null;
}

/** The nodes of `t`'s way from where it stands on to its goal (every road), and to its first waiting points. */
function wayTo(t: DTrain, until: (i: number) => boolean, into: Set<number>): void {
  const seen = new Set<number>();
  const todo = [t.at];
  while (todo.length > 0) {
    const i = todo.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    for (const p of t.pos[i]) into.add(p);
    if (i !== t.at && until(i)) continue;
    for (const x of t.succ[i]) if (!t.detour[x]) todo.push(x);
  }
}

/**
 * The stretch a decision for `trains[k]` takes: it, and each train standing on (or whose next move runs onto) the way
 * one of them is booked to its goal, nearest first, up to `max`. Indices into `trains`.
 */
export function stretchOf(trains: readonly DTrain[], k: number, max = MAX_TRAINS): number[] {
  const members = [k];
  const ways: Set<number>[] = [wayOf(trains[k])];
  for (let m = 0; m < members.length && members.length < max; m++) {
    const w = ways[m];
    const own = trains[members[m]].pos[trains[members[m]].at];
    for (let j = 0; j < trains.length && members.length < max; j++) {
      if (members.includes(j)) continue;
      let hit = false;
      for (const p of nextOf(trains[j]))
        if (w.has(p)) {
          hit = true;
          break;
        }
      if (!hit && !trains[j].fixed) {
        // (Its way onto where a member stands: it's coming.)
        const wj = wayOf(trains[j]);
        for (const p of own) if (wj.has(p)) hit = true;
      }
      if (hit) {
        members.push(j);
        ways.push(wayOf(trains[j]));
      }
    }
  }
  return members;
}

/** Per booked way (its `pos`, shared by the copies `relocate` makes) and where it stands: its way to its goal, its next move's. */
const waysCache = new WeakMap<Int32Array[], Map<number, { way: Set<number>; next: Set<number> }>>();
function cached(t: DTrain) {
  let m = waysCache.get(t.pos);
  if (!m) waysCache.set(t.pos, (m = new Map()));
  let c = m.get(t.at);
  if (!c) {
    const way = new Set<number>();
    const nxt = new Set<number>();
    if (!t.fixed) {
      wayTo(t, (i) => t.order[i] >= t.goal, way);
      wayTo(t, (i) => t.wait[i] === 1, nxt);
    } else for (const p of t.pos[t.at]) way.add(p), nxt.add(p);
    m.set(t.at, (c = { way, next: nxt }));
  }
  return c;
}
const wayOf = (t: DTrain) => cached(t).way;
const nextOf = (t: DTrain) => cached(t).next;

export interface SearchResult {
  /** The most of the trains that can deliver (reach their goals) together, and how many could at all. */
  value: number;
  of: number;
  states: number;
  capped: boolean;
  /** Per member: the value after its first move now (the best of its moves; −1: it can't move now, or not searched). */
  first: number[];
  /** Per member: the node its best first move goes to (−1: none). */
  firstTo: number[];
  /** The value with no back-up or detour (`value` may use them). */
  plain: number;
  /** With detours (searched only when `plain` falls short), and the first moves then (as `first`, `firstTo`). */
  detourValue: number;
  firstD: number[];
  firstToD: number[];
  /** Did the best use a back-up (whose, index into members; −1 none)? */
  backUp: number;
  /** The best order's moves, in order (member index, node). */
  order: { k: number; to: number; back: boolean }[];
}

export interface SearchOptions {
  cap?: number;
  /**
   * Back-ups (§2.2 step 5): searched where no order keeps them all going (true), or only where none of the stretch can
   * move at all (`"standstill"`: the dispatcher's, "only when the search finds nothing else").
   */
  backUps?: boolean | "standstill";
  /** Detours for stuck trains (default on). */
  detours?: boolean;
  /** Pieces no member may have (granted to trains on their way over them: the dispatcher's holds in transit). */
  taken?: ReadonlySet<number>;
  /**
   * Per member (by index in `members`): what its delivering counts for (default 1 each; at most 32). The dispatcher
   * weighs long waiters more (fair turns): then `value`, `of`, `plain` and `first` are in these units.
   */
  weights?: readonly number[];
  /** Members tried first (fair turns: longest waiter first); default their order. */
  order?: number[];
}

/** A move: member `k` to node `to` (`back`: a back-up). */
interface Move {
  k: number;
  to: number;
  back: boolean;
}

/**
 * The ways on from one node to the next waiting point, one a road: the nodes in order, and the pieces each comes onto
 * that the one before it wasn't on (`flat`, from `off[j]` to `off[j + 1]`): only those can meet another train.
 */
interface Branch {
  nodes: Int32Array;
  off: Int32Array;
  flat: Int32Array;
  /** Ends at a waiting point (else at the end of its booked way). */
  wait: boolean;
  /** Takes the train's detour (searched only when stuck). */
  detour: boolean;
}

/** Per booked way (its `pos`, shared by the copies `relocate` makes): each node's branches. */
const branchCache = new WeakMap<Int32Array[], Map<number, Branch[]>>();

function branchesOf(t: DTrain, i: number): Branch[] {
  let m = branchCache.get(t.pos);
  if (!m) branchCache.set(t.pos, (m = new Map()));
  const got = m.get(i);
  if (got) return got;
  const bs: Branch[] = [];
  const path: number[] = [];
  const walk = (y: number) => {
    if (path.length > 400) return;
    path.push(y);
    if (t.wait[y] || t.succ[y].length === 0) {
      const off = new Int32Array(path.length + 1);
      const flat: number[] = [];
      let before = i;
      path.forEach((nd, j) => {
        off[j] = flat.length;
        // (Out of a close-up, its front piece is shared till then: still to be had.)
        const had = t.half[before] ? t.pos[before].subarray(0, t.pos[before].length - 1) : t.pos[before];
        for (const p of t.pos[nd]) if (!had.includes(p)) flat.push(p);
        // (On past a plain signal: its whole block must be free too.)
        const blk = t.blockAfter?.[before];
        if (blk && t.frontRef[before] !== t.frontRef[nd]) for (const p of blk) if (!had.includes(p)) flat.push(p);
        before = nd;
      });
      off[path.length] = flat.length;
      bs.push({ nodes: Int32Array.from(path), off, flat: Int32Array.from(flat), wait: t.wait[y] === 1, detour: t.detour[path[0]] === 1 && t.detour[i] === 0 });
    } else for (const z of t.succ[y]) walk(z);
    path.pop();
  };
  for (const y of t.succ[i]) walk(y);
  m.set(i, bs);
  return bs;
}

/** The train (its key) first met on `trains[k]`'s next move, on any road; −1: none. */
export function blockerOf(trains: readonly DTrain[], k: number): number {
  const t = trains[k];
  const at = new Map<number, number>();
  trains.forEach((o, j) => {
    if (j !== k) for (const p of o.pos[o.at]) at.set(p, o.key);
  });
  for (const b of branchesOf(t, t.at)) for (const p of b.flat) if (at.has(p)) return at.get(p)!;
  return -1;
}

/** Per booked way: each piece's furthest `order` on it (from where it stands on): whether it's still to come. */
const futureCache = new WeakMap<Int32Array[], Map<number, number>>();
function futureOf(t: DTrain): Map<number, number> {
  let m = futureCache.get(t.pos);
  if (!m) {
    m = new Map();
    for (let i = 0; i < t.pos.length; i++) if (i >= t.main || i >= t.at) for (const p of t.pos[i]) m.set(p, Math.max(m.get(p) ?? -1, t.order[i]));
    futureCache.set(t.pos, m);
  }
  return m;
}

/**
 * Why `trains[k]`'s next move is blocked, in a word (a diagnostic for the shadow's report): what stands on the first
 * piece it can't have, and whether it could close up behind it (part pieces).
 */
export function whyBlocked(trains: readonly DTrain[], k: number): string {
  const t = trains[k];
  const on = new Map<number, number>();
  trains.forEach((o, j) => {
    if (j !== k) for (const p of o.pos[o.at]) on.set(p, j);
  });
  for (const b of branchesOf(t, t.at)) {
    if (b.detour) continue;
    for (let j = 0; j < b.nodes.length; j++)
      for (let x = b.off[j]; x < b.off[j + 1]; x++) {
        const q = b.flat[x];
        const who = on.get(q);
        if (who === undefined) continue;
        const a = trains[who];
        const m = b.nodes[j];
        const where = a.pos[a.at][0] === q ? "its tail" : a.pos[a.at][a.pos[a.at].length - 1] === q ? "its front" : "its middle";
        if (where !== "its tail") return `on ${where}`;
        const c = t.closeOf[m];
        if (c < 0) return m >= t.main ? "tail, off its main way" : "tail, no close-up there (points or a turn)";
        if (a.tailEn[a.at] !== t.frontEn[c]) return "tail, coming the other way";
        if (a.tailCover[a.at] + 20 >= t.frontLen[c]) return "tail, no room on the piece";
        return "tail, room (another piece taken)";
      }
  }
  const bs = branchesOf(t, t.at);
  if (bs.length === 0) return `none met: no branch (succ ${t.succ[t.at].length}, at ${t.at}/${t.pos.length}, main ${t.main}, goal ${t.goal})`;
  const b = bs[0];
  const last = b.nodes[b.nodes.length - 1];
  let rests = 0;
  for (const x of b.nodes) rests += t.rest[x];
  return `none met: ${bs.length} branches, first ${b.nodes.length} nodes, ends ${b.wait ? "at a wait" : "the way's end"} (node ${last}, rest ${t.rest[last]}), ${rests} rests`;
}

/** An open-addressed table of states (each `n` node indices and a back-up mask): value and best move per state. */
class States {
  private keys: Int32Array;
  private used: Uint8Array;
  readonly value: Int32Array;
  readonly move: Int32Array;
  private size = 0;
  private readonly w: number;
  private mask: number;
  constructor(
    private readonly n: number,
    cap: number,
  ) {
    let c = 16;
    while (c < cap * 2) c *= 2;
    this.w = n + 1;
    this.mask = c - 1;
    this.keys = new Int32Array(c * this.w);
    this.used = new Uint8Array(c);
    this.value = new Int32Array(c);
    this.move = new Int32Array(c * 3);
  }
  /** The slot for this state (found, or −1 − the slot it would take). */
  find(idx: Int32Array, bits: number): number {
    let h = bits | 0;
    for (let k = 0; k < this.n; k++) h = Math.imul(h ^ idx[k], 0x9e3779b1);
    h ^= h >>> 15;
    let s = h & this.mask;
    for (;;) {
      if (!this.used[s]) return -1 - s;
      const o = s * this.w;
      let same = this.keys[o + this.n] === bits;
      for (let k = 0; same && k < this.n; k++) same = this.keys[o + k] === idx[k];
      if (same) return s;
      s = (s + 1) & this.mask;
    }
  }
  put(slot: number, idx: Int32Array, bits: number, v: number): number {
    const s = -1 - slot;
    this.used[s] = 1;
    this.size++;
    const o = s * this.w;
    for (let k = 0; k < this.n; k++) this.keys[o + k] = idx[k];
    this.keys[o + this.n] = bits;
    this.value[s] = v;
    this.move[s * 3] = -1;
    return s;
  }
  clear(): void {
    this.used.fill(0);
    this.size = 0;
  }
}

/** Buffers kept between searches (a decision allocates little): piece owners (zeroed), moves a depth by size. */
const buffers: Int32Array[] = [];
function buffer(k: number, size: number): Int32Array {
  let b = buffers[k];
  if (!b || b.length < size) buffers[k] = b = new Int32Array(Math.max(size, 1024));
  else b.fill(0, 0, size);
  return b;
}
const fwdPool: Int32Array[][] = [];

/** The last search's states without back-ups (for measuring). */
export const statsLast = { plainStates: 0 };

/** A table a size, kept for the next search (a decision allocates nothing it needn't). */
const tables = new Map<string, States>();
function statesFor(n: number, cap: number): States {
  if (cap > 100_000) return new States(n, cap);
  const k = `${n}.${cap}`;
  let t = tables.get(k);
  if (!t) tables.set(k, (t = new States(n, cap)));
  else t.clear();
  return t;
}

/**
 * The search over grant orders for `members` of `trains` (the others stand where they are). `first` and the value say
 * which first moves keep the best.
 */
export function search(trains: readonly DTrain[], members: readonly number[], opts: SearchOptions = {}): SearchResult {
  const cap = opts.cap ?? DISPATCH_STATES;
  const n = members.length;
  const ts = members.map((i) => trains[i]);
  const order = opts.order ?? members.map((_, i) => i);
  // (Pieces: those standing still outside the stretch (−1), and each member's where it stands in the state walked
  // (k + 1), kept as the walk goes.)
  let maxP = 0;
  for (const t of trains) for (const p of t.pos[t.at]) if (p > maxP) maxP = p;
  for (const t of ts) if (t.maxPiece > maxP) maxP = t.maxPiece;
  const owner = buffer(0, maxP + 1);
  const isMember = new Uint8Array(trains.length);
  for (const i of members) isMember[i] = 1;
  trains.forEach((t, i) => {
    if (!isMember[i]) for (const p of t.pos[t.at]) owner[p] = -1;
  });
  if (opts.taken) for (const p of opts.taken) if (p <= maxP) owner[p] = -1;
  const goalOf = ts.map((t) => (t.fixed ? Infinity : t.goal));
  const wt = ts.map((_, k) => Math.max(1, Math.min(32, Math.round(opts.weights?.[k] ?? 1))));
  let of = 0;
  ts.forEach((t, k) => {
    if (!t.fixed) of += wt[k];
  });
  const cur = Int32Array.from(ts.map((t) => t.at));
  // (A piece two trains share, the one up close behind the other's tail (a close-up node, or standing so): the second
  // owner. Still trains' tails, for closing up behind them: what of its tail piece each covers, and which way it runs.)
  const owner2 = buffer(1, maxP + 1);
  const stillTail = new Map<number, { cover: number; en: number }>();
  trains.forEach((t, i) => {
    if (!isMember[i]) stillTail.set(t.pos[t.at][0], { cover: t.tailCover[t.at], en: t.tailEn[t.at] });
  });
  const place = (k: number, i: number, on: boolean) => {
    const own = k + 1;
    for (const p of ts[k].pos[i]) {
      if (on) {
        if (owner[p] === 0) owner[p] = own;
        else if (owner[p] !== own) owner2[p] = own;
      } else if (owner2[p] === own) owner2[p] = 0;
      else if (owner[p] === own) {
        owner[p] = owner2[p];
        owner2[p] = 0;
      }
    }
  };
  for (let k = 0; k < n; k++) place(k, cur[k], true);
  const count = () => {
    let c = 0;
    for (let k = 0; k < n; k++) if (ts[k].order[cur[k]] >= goalOf[k]) c += wt[k];
    return c;
  };
  const table = statesFor(n, cap + 64);
  let states = 0;
  let capped = false;
  let done = false;
  const freeNode = (k: number, i: number) => {
    for (const p of ts[k].pos[i]) if ((owner[p] !== 0 && owner[p] !== k + 1) || (owner2[p] !== 0 && owner2[p] !== k + 1)) return false;
    return true;
  };
  /** The gap (mm) kept up close behind a standing train's tail (the sim's `STOP_GAP`, and some). */
  const CLOSE_GAP = 20;
  /** Can member k close up into its node m's front piece behind the train whose tail is there? */
  const closesUp = (k: number, m: number): boolean => {
    const t = ts[k];
    const c = t.closeOf[m];
    if (c < 0) return false;
    const q = t.pos[c][t.pos[c].length - 1];
    if (owner2[q] !== 0) return false;
    const ow = owner[q];
    let cover = -1;
    let en = -2;
    if (ow > 0 && ow !== k + 1) {
      const a = ts[ow - 1];
      const x = cur[ow - 1];
      if (a.pos[x][0] !== q || a.half[x]) return false;
      cover = a.tailCover[x];
      en = a.tailEn[x];
    } else if (ow === -1) {
      const st = stillTail.get(q);
      if (!st) return false;
      cover = st.cover;
      en = st.en;
    } else return false;
    if (en !== t.frontEn[c] || cover + CLOSE_GAP >= t.frontLen[c]) return false;
    // (The rest of it where it was a node back: its own, or free.)
    for (const p of t.pos[c]) if (p !== q && ((owner[p] !== 0 && owner[p] !== k + 1) || (owner2[p] !== 0 && owner2[p] !== k + 1))) return false;
    return true;
  };
  // (Each member's forward moves in a state, a depth's worth: per member a count and up to `PER` nodes. A child's are
  // its parent's, worked out again only for the train that moved and those whose ways it was or is now on.)
  const PER = 6;
  const W = 1 + PER;
  const fwds = fwdPool[n] ?? (fwdPool[n] = []);
  const fwdAt = (d: number) => fwds[d] ?? (fwds[d] = new Int32Array(n * W));
  const brs: (Branch[] | undefined)[][] = ts.map((t) => new Array(t.pos.length));
  /** Detours searched (a phase: only when no order without keeps them all going). */
  let detours = false;
  const forward = (k: number, out: Int32Array) => {
    const o = k * W;
    out[o] = 0;
    const t = ts[k];
    if (t.fixed) return;
    const own = k + 1;
    const i = cur[k];
    const bl = brs[k][i] ?? (brs[k][i] = branchesOf(t, i));
    for (let bi = 0; bi < bl.length; bi++) {
      const b = bl[bi];
      if (b.detour && !detours) continue;
      let lastRest = -1;
      let j = 0;
      for (; j < b.nodes.length; j++) {
        let blocked = false;
        for (let q = b.off[j]; q < b.off[j + 1]; q++) {
          const ow = owner[b.flat[q]];
          const ow2 = owner2[b.flat[q]];
          if ((ow !== 0 && ow !== own) || (ow2 !== 0 && ow2 !== own)) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
        if (t.rest[b.nodes[j]]) lastRest = b.nodes[j];
      }
      // (Blocked by a train's tail on its next piece, going its way: up close behind it, part way onto that piece.)
      const close = j < b.nodes.length && closesUp(k, b.nodes[j]) ? t.closeOf[b.nodes[j]] : -1;
      const to = j === b.nodes.length && b.wait ? b.nodes[j - 1] : close >= 0 ? close : lastRest;
      if (to < 0 || out[o] >= PER) continue;
      let dup = false;
      for (let x = 0; x < out[o]; x++) if (out[o + 1 + x] === to) dup = true;
      if (!dup) out[o + 1 + out[o]++] = to;
    }
  };
  // (Back-ups, a state at a time (only searched when no order works without).)
  const backs = new Int32Array(n * 4 + 1);
  const backUpsOf = (mask: number) => {
    let c = 0;
    for (const k of order) {
      const t = ts[k];
      if (t.fixed || mask & (1 << k)) continue;
      const i = cur[k];
      // (Back the way it came, at most its length, onto free pieces, to rest clear of points: the nearest and farthest.)
      let near = -1;
      let far = -1;
      for (let b = t.prev[i]; b >= 0 && t.seg[b] === t.seg[i] && t.dist[i] - t.dist[b] <= t.length; b = t.prev[b]) {
        if (!freeNode(k, b)) break;
        if (t.plain[b]) {
          if (near < 0) near = b;
          far = b;
        }
      }
      if (near >= 0) {
        backs[1 + c * 2] = k;
        backs[2 + c * 2] = near;
        c++;
      }
      if (far >= 0 && far !== near) {
        backs[1 + c * 2] = k;
        backs[2 + c * 2] = far;
        c++;
      }
    }
    backs[0] = c;
  };
  // (A state's score: trains delivering × `SCORE`, less the back-ups the way there takes: the fewest back-ups win.)
  const SCORE = 64;
  const bits = (m: number) => {
    let c = 0;
    for (; m; m &= m - 1) c++;
    return c;
  };
  const first = new Array<number>(n).fill(-1);
  const firstTo = new Array<number>(n).fill(-1);
  let enough = of * SCORE;
  /** Move member k to node `to` (owners kept), and back. */
  const step = (k: number, to: number) => {
    place(k, cur[k], false);
    cur[k] = to;
    place(k, to, true);
  };
  const futures = ts.map((t) => futureOf(t));
  const needed = (k: number, p: number) => {
    for (let x = 0; x < n; x++) if (x !== k && !ts[x].fixed && (futures[x].get(p) ?? -1) >= ts[x].order[cur[x]]) return true;
    return false;
  };
  /** A member with one move, independent of every other member's way on; −1: none. */
  const independent = (mine: Int32Array): number => {
    for (const k of order) {
      if (mine[k * W] !== 1) continue;
      const t = ts[k];
      const to = mine[k * W + 1];
      let ok = true;
      for (const p of t.pos[cur[k]]) if (needed(k, p)) ok = false;
      if (!ok) continue;
      for (const b of branchesOf(t, cur[k])) {
        const j = b.nodes.indexOf(to);
        if (j < 0) continue;
        for (let q = 0; q < b.off[j + 1] && ok; q++) if (needed(k, b.flat[q])) ok = false;
        break;
      }
      if (ok) return k;
    }
    return -1;
  };
  // (Per depth: the slot, its value, its own score, the back-ups listed.)
  const slots: number[] = [];
  const vals: number[] = [];
  const heres: number[] = [];
  const backBufs: Int32Array[] = [];
  /** Try member k's move to `to` from the state at `depth` (back: a back-up); true when that's enough to stop. */
  const tryMove = (depth: number, mask: number, backUps: boolean, k: number, to: number, back: number): boolean => {
    const from = cur[k];
    step(k, to);
    const nmask = back ? mask | (1 << k) : mask;
    const cv = value(nmask, backUps, depth + 1) - back;
    step(k, from);
    if (depth === 0 && !back && Math.ceil(cv / SCORE) > first[k]) {
      first[k] = Math.ceil(cv / SCORE);
      firstTo[k] = to;
    }
    const slot = slots[depth];
    if (cv > vals[depth] || (table.move[slot * 3] < 0 && cv === vals[depth] && cv > heres[depth])) {
      vals[depth] = cv;
      table.move[slot * 3] = k;
      table.move[slot * 3 + 1] = to;
      table.move[slot * 3 + 2] = back;
    }
    // (Enough: all of them delivering, with no more back-ups on the way here than the fewest that could do it.)
    if (vals[depth] - bits(mask) >= enough) {
      done = true;
      return true;
    }
    return false;
  };
  const value = (mask: number, backUps: boolean, depth: number): number => {
    let slot = table.find(cur, mask);
    if (slot >= 0) return table.value[slot];
    const here = count() * SCORE;
    if (done || states >= cap) {
      if (!done) capped = true;
      return here;
    }
    states++;
    slot = table.put(slot, cur, mask, here);
    slots[depth] = slot;
    vals[depth] = here;
    heres[depth] = here;
    const mine = fwdAt(depth);
    for (let k = 0; k < n; k++) forward(k, mine);
    let stop = false;
    // (A move no other member will ever need the track of (where it stands, where it runs, where it stops): taken alone,
    // it loses nothing (it neither frees nor takes what another needs, and stays free whatever they do).)
    // (Not at the root: there every member's first move is weighed, for the decision.)
    const lone = backUps || depth === 0 ? -1 : independent(mine);
    if (lone >= 0) stop = tryMove(depth, mask, backUps, lone, mine[lone * W + 1], 0);
    else
      for (let oi = 0; oi < order.length && !stop; oi++) {
        const k = order[oi];
        const o = k * W;
        for (let x = 0; x < mine[o] && !stop; x++) stop = tryMove(depth, mask, backUps, k, mine[o + 1 + x], 0);
      }
    if (!stop && backUps) {
      backUpsOf(mask);
      const list = backBufs[depth] ?? (backBufs[depth] = new Int32Array(n * 4));
      const c = backs[0];
      list.set(backs.subarray(1, 1 + c * 2));
      for (let x = 0; x < c && !stop; x++) stop = tryMove(depth, mask, backUps, list[x * 2], list[x * 2 + 1], 1);
    }
    const v = vals[depth];
    table.value[slot] = v;
    return v;
  };
  const root = fwdAt(0);
  for (let k = 0; k < n; k++) forward(k, root);
  let v = Math.ceil(value(0, false, 0) / SCORE);
  const plain = v;
  statsLast.plainStates = states;
  let usedBackUps = false;
  let still = true;
  for (let k = 0; k < n; k++) if (root[k * W] > 0) still = false;
  // (No order keeps them all going: with detours, stuck trains going round by another way (§2.2 step 4).)
  let detourValue = v;
  const firstD = new Array<number>(n).fill(-1);
  const firstToD = new Array<number>(n).fill(-1);
  if (v < of && opts.detours !== false && ts.some((t) => t.detour.some((x) => x === 1))) {
    table.clear();
    done = false;
    detours = true;
    const keep = first.slice();
    const keepTo = firstTo.slice();
    first.fill(-1);
    firstTo.fill(-1);
    for (let k = 0; k < n; k++) forward(k, root);
    detourValue = Math.ceil(value(0, false, 0) / SCORE);
    firstD.splice(0, n, ...first);
    firstToD.splice(0, n, ...firstTo);
    first.splice(0, n, ...keep);
    firstTo.splice(0, n, ...keepTo);
    if (detourValue > v) v = detourValue;
  }
  if (v < of && (opts.backUps === true || (opts.backUps === "standstill" && still))) {
    // (No order keeps them all going: with one back-up a train, the fewest. First moves as found without.)
    table.clear();
    done = false;
    enough = of * SCORE - 1;
    const keep = first.slice();
    const keepTo = firstTo.slice();
    for (let k = 0; k < n; k++) forward(k, root);
    const vb = Math.ceil(value(0, true, 0) / SCORE);
    first.splice(0, n, ...keep);
    firstTo.splice(0, n, ...keepTo);
    if (vb > v) {
      v = vb;
      usedBackUps = true;
    }
  }
  // The best order, followed down.
  const orderOut: Move[] = [];
  let mask = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const slot = table.find(cur, mask);
    if (slot < 0 || table.move[slot * 3] < 0) break;
    const k = table.move[slot * 3];
    const to = table.move[slot * 3 + 1];
    const back = table.move[slot * 3 + 2] === 1;
    orderOut.push({ k, to, back });
    cur[k] = to;
    if (back) mask |= 1 << k;
  }
  const backUp = usedBackUps ? (orderOut.find((m) => m.back)?.k ?? -1) : -1;
  return { value: v, of, states, capped, first, firstTo, plain, detourValue, firstD, firstToD, backUp, order: orderOut };
}

/** A judgement of one jam: the stretch round the stuck train, and the most of it a dispatcher keeps delivering. */
export interface StretchJudgement {
  trains: number;
  value: number;
  of: number;
  states: number;
  capped: boolean;
  ms: number;
  /** With one back-up a train (only where no order without one keeps them all going). */
  backUp?: { value: number; by: number };
  /** The trains judged (their keys). */
  keys: number[];
  /** Without detours (`value` may use them: §2.2 step 4). */
  plain: number;
}

/**
 * The judge: the stretch round train `key` (and any of `also`, trains judged with it before), its goal `horizon` stops
 * ahead, searched to the end (`cap` large).
 */
export function judgeStretch(layout: Layout, snaps: readonly Snap[], key: number, also: readonly number[] = [], cap = JUDGE_STATES, backUps = true, horizon = 2): StretchJudgement | null {
  const t0 = performance.now();
  const trains = snaps.map((s) => buildTrain(layout, s, horizon));
  const k = trains.findIndex((t) => t.key === key);
  if (k < 0) return null;
  const members = stretchOf(trains, k);
  for (const a of also) {
    const j = trains.findIndex((t) => t.key === a);
    if (j >= 0 && !members.includes(j)) members.push(j);
  }
  let r = search(trains, members, { cap, backUps: false });
  if (r.value < r.of) {
    const dt = withDetours(layout, snaps, trains, members, horizon);
    if (dt) {
      const plain = r.plain;
      r = search(dt, members, { cap, backUps: false });
      r.plain = plain;
      trains.splice(0, trains.length, ...dt);
    }
  }
  let backUp: StretchJudgement["backUp"];
  if (backUps && r.value < r.of && !r.capped) {
    const b = search(trains, members, { cap, backUps: true });
    backUp = { value: b.value, by: b.backUp >= 0 ? trains[members[b.backUp]].key : -1 };
  }
  return { trains: members.length, value: r.value, of: r.of, plain: r.plain, states: r.states, capped: r.capped, ms: performance.now() - t0, keys: members.map((i) => trains[i].key), ...(backUp ? { backUp } : {}) };
}
