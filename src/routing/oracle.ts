/**
 * A dispatcher oracle (docs/agents/stalls-verify-2026-11-10.md), first for the long fuzz's stalls and the routing cases'
 * judge (`cases/judge.ts`), and in the game for the swap planner (`swap-planner.ts`): on a stall, the moves that keep
 * every train going. (Moved here from `cases/oracle.ts`, which re-exports it.)
 *
 * Given the track and where each train stands (its pieces, which way it faces), it searches every sequence of moves a
 * perfect dispatcher (or a player with every lever) could make under the user's rules, and says how many trains can
 * keep delivering for ever. The model, deliberately generous to the trains:
 *
 * - A train fills the whole pieces from its front back as far as they're as long as it is (`OTrain.length`, by the
 *   pieces' real paths; else as given). It moves a piece at a time; a piece holds one train.
 * - **Points are never a place to wait:** a train comes to rest only where none of its pieces is a switch; a move runs
 *   on through points to the next such place.
 * - **Trains turn round only at the ends of lines:** a train reverses only with its front at the end of the track (a
 *   buffer next, or track that stops), or close behind a train standing at one (routing spec §16 Q9: that train is its
 *   end of the line). `ends`: "any" (any end of track, a siding's too), "own" (a routed train only at its own ends: one of
 *   its stops on the plain track from the end back to the first points; a hand-run train at any), or "spare" (own, and
 *   a spare dead end: no industry, no train's stop; the user's rule A1).
 * - Every switch may be set either way for each move of a routed train (the dispatcher holds every lever). A hand-run
 *   train (no stops) takes points as they're set: in the game no one throws them for it, but to give way (stalls.ts);
 *   `handFree`: it may take any way too (the bound the other way).
 *
 * Delivering: a routed train comes to every one of its stops (a stop piece under it), over and over; a hand-run train
 * keeps moving. "Over and over" is a strongly connected set of states reachable from the start that the dispatcher can
 * stay in: the answer is the most trains that deliver together in one such set.
 */
import { connectorRef, getPieceDef, type Layout } from "../track";
import { blocksOf } from "../game/signal-place";
import { next, waysFrom } from "./graph";
import { pathLength } from "../track/path";
import { driveOf, trainLength } from "../sim/train-cars";
import type { Train } from "../sim";

/** The gap (mm) two trains keep on a piece they share (the sim's, standing close behind: `STOP_GAP`). */
const GAP = 10;
/** How finely (mm) a train closes up behind another part way onto a piece. */
const STEP = 8;

export interface Elem {
  p: number;
  en: number;
  ex: number;
}
export interface OTrain {
  /** Tail first, front last. */
  elems: Elem[];
  stops: number[] | null;
  /**
   * Its length (mm), buffer face to buffer face. Given, it fills the pieces from its front back as far as they're that
   * long by their real paths (a curve is shorter than a straight): it rests clear of points only where those are none.
   * Not given: `elems` as they are, one piece on and one off each move.
   */
  length?: number;
}

export interface OracleResult {
  states: number;
  /** The most trains delivering together in one reachable strongly connected set (and which). */
  best: number;
  bestSet: number[];
  /** Per train: can it deliver at all (in some reachable set, others as they may)? */
  alone: boolean[];
  capped: boolean;
  /**
   * With `keep`: the search itself, for the swap planner. `states[i][k]`: train k in state i (state 0 the start), its
   * pieces tail first and how far short of its front piece's end it stands; `edges[i]`: the states one move on (one train
   * moved or turned); `best`: the strongly connected set `best` counts (state ids), empty if none.
   */
  graph?: { states: { e: Elem[]; fs: number }[][]; edges: number[][]; best: number[] };
}

export function isSwitch(layout: Layout, p: number): boolean {
  const piece = layout.getPiece(p);
  return !!piece && getPieceDef(piece.type, piece.flipped).paths.length > 1;
}

function isBuffer(layout: Layout, p: number): boolean {
  return layout.getPiece(p)?.type.startsWith("buffer") ?? false;
}

/** Is the way on from this front element the end of the track (a buffer next, or nothing)? */
export function atEnd(layout: Layout, f: Elem): boolean {
  if (f.ex < 0) return true;
  const n = next(layout, f.p, f.ex);
  if (!n) return true;
  return isBuffer(layout, n.pieceId);
}

/**
 * `signals`: keep to the layout's signals as the game does (`blocksOf`, the sim's blocks): a train may cross a signal's
 * joint the way it guards only with no other train in the block beyond (a plain block; a path signal's, with points in
 * it, only its way through). Elsewhere signals hold nothing.
 */
export function oracle(layout: Layout, start: OTrain[], ends: "any" | "own" | "spare", maxStates = 400_000, signals = false, handFree = false, behind = true, keep = false): OracleResult {
  const s = createOracle(layout, start, ends, maxStates, signals, handFree, behind, keep);
  s.step(Infinity);
  return s.finish();
}

/**
 * The oracle's search, a slice at a time (the swap planner's, in the game: spread over ticks, never a frame's worth):
 * `step(n)` expands up to `n` more states and says whether the search is done; `finish` then gives the answer (and,
 * finished early, as far as it got, capped). By count, not time, so the game stays deterministic.
 */
export interface OracleSearch {
  step(n: number): boolean;
  /** Up to about `n` steps of working out the answer once `step` is done; true once it's there. */
  finishStep(n: number): boolean;
  finish(): OracleResult;
  /** States found so far. */
  readonly size: number;
}

export function createOracle(layout: Layout, start: OTrain[], ends: "any" | "own" | "spare", maxStates = 400_000, signals = false, handFree = false, behind = true, keep = false): OracleSearch {
  const n = start.length;
  /** A train in a state: its pieces (tail first) and how far (mm) its front stands short of its front piece's far end. */
  type T = { e: Elem[]; fs: number };
  const key = (ts: T[]) => ts.map((t) => `${t.e.map((e) => `${e.p}.${e.en}.${e.ex}`).join(",")}~${t.fs}`).join("|");
  const sw = new Map<number, boolean>();
  const swOf = (p: number) => {
    let v = sw.get(p);
    if (v === undefined) sw.set(p, (v = isSwitch(layout, p)));
    return v;
  };
  const restOk = (t: Elem[]) => t.every((e) => !swOf(e.p));
  // (A piece's length the way it's run, and whether that's its path's own way (from its `from` end).)
  const lens = new Map<string, { len: number; fwd: boolean }>();
  const pathOf = (e: Elem): { len: number; fwd: boolean } => {
    const k = `${e.p}.${e.en}.${e.ex}`;
    let v = lens.get(k);
    if (v === undefined) {
      const piece = layout.getPiece(e.p);
      const def = piece ? getPieceDef(piece.type, piece.flipped) : undefined;
      const path = def?.paths.find((q) => (q.from === e.en && q.to === e.ex) || (q.from === e.ex && q.to === e.en)) ?? def?.paths.find((q) => q.from === e.en || q.to === e.en);
      lens.set(k, (v = path ? { len: pathLength(path.geom), fwd: path.from === e.en } : { len: 216, fwd: true }));
    }
    return v;
  };
  const lenOf = (e: Elem) => pathOf(e).len;
  /** A train's length (mm): given, or (none given) its pieces as they are. */
  const lengthOf = (k: number, t: T): number => {
    const L = start[k].length;
    if (L !== undefined) return L;
    let sum = -t.fs;
    for (const e of t.e) sum += lenOf(e);
    return sum;
  };
  /** Its pieces from the front back, let go of at the tail as far as the rest still covers its length. */
  const trimmed = (k: number, t: T): T => {
    if (start[k].length === undefined) return { e: t.e.slice(1), fs: 0 };
    const L = lengthOf(k, t);
    let sum = -t.fs;
    for (const e of t.e) sum += lenOf(e);
    let i = 0;
    while (i < t.e.length - 1 && sum - lenOf(t.e[i]) >= L) sum -= lenOf(t.e[i++]);
    return { e: t.e.slice(i), fs: t.fs };
  };
  /**
   * The stretch a train covers on each of its pieces, along each piece's own path from its `from` end (mm): its front
   * piece up to `fs` short of its far end, its tail piece only as far back as its length reaches.
   */
  const spans = (k: number, t: T): Map<number, [number, number][]> => {
    const out = new Map<number, [number, number][]>();
    let left = lengthOf(k, t);
    for (let i = t.e.length - 1; i >= 0 && left > 0; i--) {
      const e = t.e[i];
      const { len, fwd } = pathOf(e);
      // (Along its run: from the end it came onto by. Its front piece up to `fs` short of the far end.)
      const hi = i === t.e.length - 1 ? len - t.fs : len;
      const lo = Math.max(0, hi - left);
      left -= hi - lo;
      const a = fwd ? lo : len - hi;
      const b = fwd ? hi : len - lo;
      const list = out.get(e.p) ?? [];
      list.push([a, b]);
      out.set(e.p, list);
    }
    return out;
  };
  /** Does train k as `t` keep clear of the others (a gap between them on a piece they share)? */
  const clear = (k: number, t: T, ts: T[]): boolean => {
    const mine = spans(k, t);
    for (let j = 0; j < ts.length; j++) {
      if (j === k) continue;
      const theirs = spans(j, ts[j]);
      for (const [p, as] of mine) {
        const bs = theirs.get(p);
        if (!bs) continue;
        for (const [a0, a1] of as) for (const [b0, b1] of bs) if (a0 < b1 + GAP && b0 < a1 + GAP) return false;
      }
    }
    return true;
  };
  // (Its own end of the line: one of its stops on the plain track from the end back to the first points (it runs to the
  // end beyond its stop and turns there, as on any line). The plain stretch an end is on, cached.)
  const stretches = new Map<number, number[]>();
  const stretchOf = (p: number): number[] => {
    let st = stretches.get(p);
    if (st) return st;
    st = [];
    const todo = [p];
    const seen = new Set<number>();
    while (todo.length > 0) {
      const q = todo.pop()!;
      if (seen.has(q) || swOf(q) || isBuffer(layout, q)) continue;
      seen.add(q);
      st.push(q);
      const piece = layout.getPiece(q);
      if (!piece) continue;
      const def = getPieceDef(piece.type, piece.flipped);
      for (let c = 0; c < def.connectors.length; c++) {
        const n = next(layout, q, c);
        if (n) todo.push(n.pieceId);
      }
    }
    for (const q of st) stretches.set(q, st);
    return st;
  };
  // (A spare dead end (the user, 2026-11-13, "A1"): an end whose plain stretch back to the points has no industry on it
  // (no depot piece) and no train's stop, a siding or platform: a routed train may step aside into it and turn there.)
  const allStops = new Set(start.flatMap((t) => t.stops ?? []));
  const spareEnd = (p: number): boolean => stretchOf(p).every((q) => !allStops.has(q) && !(layout.getPiece(q)?.type.startsWith("depot") ?? false));
  /**
   * The end of the line ahead: the track's end, or (routing spec §16 Q9) another train standing at it, facing it, close
   * ahead with no points between: that train is this one's end of the line. (On its own front piece too, closed up behind
   * it there.)
   */
  const endAhead = (k: number, ts: T[], f: Elem): boolean => {
    if (ts[k].fs === 0 && atEnd(layout, f)) return true;
    if (!behind) return false;
    const owner = new Map<number, number>();
    ts.forEach((t, j) => {
      if (j !== k) for (const e of t.e) owner.set(e.p, j);
    });
    let j = -1;
    // (One whose tail is on its own front piece, ahead of it there: closed up behind it.)
    const here = owner.get(f.p);
    if (here !== undefined && ts[here].e[0].p === f.p && ts[k].fs > 0) j = here;
    else if (ts[k].fs > 0) return false;
    let at = f;
    for (let i = 0; i < 16; i++) {
      const nx = next(layout, at.p, at.ex);
      if (!nx) return j >= 0;
      if (isBuffer(layout, nx.pieceId)) return j >= 0;
      const o = owner.get(nx.pieceId);
      if (o === undefined) return false;
      if ((j >= 0 && o !== j) || swOf(nx.pieceId)) return false;
      // (Behind it: the first of it met is its tail, so it faces away, to the end. Nose to nose isn't behind.)
      if (j < 0 && ts[o].e[0].p !== nx.pieceId) return false;
      j = o;
      const w = waysFrom(layout, nx.pieceId, nx.entry, () => true)[0];
      if (!w || w.exit < 0) return true;
      at = { p: nx.pieceId, en: nx.entry, ex: w.exit };
    }
    return false;
  };
  const mayTurn = (k: number, ts: T[]): boolean => {
    const t = ts[k].e;
    const f = t[t.length - 1];
    if (!endAhead(k, ts, f)) return false;
    if (!(ts[k].fs === 0 && atEnd(layout, f))) return true;
    const stops = start[k].stops;
    if (ends === "any" || !stops) return true;
    if (stretchOf(f.p).some((q) => stops.includes(q))) return true;
    return ends === "spare" && spareEnd(f.p);
  };
  /** Rest positions train k reaches by one move forward (through points, to the first place clear of them). */
  const forward = (k: number, ts: T[]): T[] => {
    const out: T[] = [];
    let from = ts[k];
    // (Closed up short of its front piece's end: up to the end of it if that's clear (and on from there), else only as
    // far as it's clear.)
    if (from.fs > 0) {
      const up = trimmed(k, { e: from.e, fs: 0 });
      if (!clear(k, up, ts)) return closeUp(k, ts, from).filter((t) => t.fs < from.fs);
      out.push(up);
      from = up;
    }
    let frontier: T[] = [from];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const nextF: T[] = [];
      for (const t of frontier) {
        const f = t.e[t.e.length - 1];
        if (f.ex < 0) continue;
        const nx = next(layout, f.p, f.ex);
        if (!nx || isBuffer(layout, nx.pieceId)) continue;
        if (signals && layout.signalAt(connectorRef(f.p, f.ex)) && [...blockAhead(connectorRef(f.p, f.ex))].some((p) => ts.some((o, j) => j !== k && o.e.some((x) => x.p === p)))) continue;
        // (A hand-run train takes points as they're set: no one throws them for it. A routed one, any way.)
        for (const w of waysFrom(layout, nx.pieceId, nx.entry, () => !start[k].stops && !handFree)) {
          if (w.exit < 0) continue;
          const onto = { e: [...t.e, { p: nx.pieceId, en: nx.entry, ex: w.exit }], fs: 0 };
          const nt = trimmed(k, onto);
          if (new Set(nt.e.map((e) => e.p)).size < nt.e.length) continue;
          if (!clear(k, nt, ts)) {
            // (Another train on it: up close behind that one, part way onto the piece, if that's clear of points.)
            for (const c of closeUp(k, ts, onto)) if (restOk(c.e)) out.push(c);
            continue;
          }
          if (restOk(nt.e)) out.push(nt);
          else nextF.push(nt);
        }
      }
      frontier = nextF;
    }
    return out;
  };
  /** Does the way on from this element run, over plain track (no points), to the end of the line? */
  const ends0 = new Map<string, boolean>();
  const toEnd = (f: Elem): boolean => {
    const kk = `${f.p}.${f.en}.${f.ex}`;
    let v = ends0.get(kk);
    if (v !== undefined) return v;
    v = false;
    let at = f;
    for (let i = 0; i < 32; i++) {
      if (swOf(at.p)) break;
      if (atEnd(layout, at)) {
        v = true;
        break;
      }
      const nx = next(layout, at.p, at.ex)!;
      const w = waysFrom(layout, nx.pieceId, nx.entry, () => true);
      if (w.length !== 1 || w[0].exit < 0) break;
      at = { p: nx.pieceId, en: nx.entry, ex: w[0].exit };
    }
    ends0.set(kk, v);
    return v;
  };
  /** Train k as `t`, its front pulled back on its front piece till it's clear of the others (the gap behind one ahead): or none. */
  const closeUp = (k: number, ts: T[], t: T): T[] => {
    const f = t.e[t.e.length - 1];
    // (Only where it leads to the end of the line, plain track on to it: to turn behind the one there (§16 Q9). Elsewhere
    // it waits a piece back as before; closing up there only adds states.)
    if (!toEnd(f)) return [];
    const len = lenOf(f);
    for (let fs = Math.max(t.fs, 1); fs < len; fs += STEP) {
      const c = trimmed(k, { e: t.e, fs: Math.round(fs) });
      if (clear(k, c, ts)) return [c];
    }
    return [];
  };
  // (A plain block's: its pieces. A block with points or a crossing in it is a path signal's (sim.ts, signals spec
  // §3.1): it lets a train on when its way through is free, which the pieces it moves onto already are. Empty, then.)
  const blocks = new Map<number, ReadonlySet<number>>();
  const blockAhead = (at: number): ReadonlySet<number> => {
    let b = blocks.get(at);
    if (!b) {
      const pieces = [...blocksOf(layout, at).ahead.keys()];
      blocks.set(at, (b = new Set(pieces.some((p) => swOf(p)) ? [] : pieces)));
    }
    return b;
  };
  /** Turned round where it stands: its pieces the other way, its front now where its tail was (short of that piece's end by what it didn't cover). */
  const turn = (k: number, t: T): T => {
    const e = [...t.e].reverse().map((x) => ({ p: x.p, en: x.ex, ex: x.en }));
    let covered = 0;
    for (let i = 1; i < t.e.length; i++) covered += lenOf(t.e[i]);
    covered -= t.fs;
    const tailCover = Math.max(0, lengthOf(k, t) - covered);
    const fs = t.e.length === 1 ? Math.max(0, lenOf(t.e[0]) - t.fs - lengthOf(k, t)) : Math.max(0, lenOf(t.e[0]) - tailCover);
    return { e, fs: Math.round(fs) };
  };

  // Reachable states (BFS), edges.
  const ids = new Map<string, number>();
  const states: T[][] = [];
  const edges: number[][] = [];
  const add = (ts: T[]): number => {
    const kk = key(ts);
    let id = ids.get(kk);
    if (id === undefined) {
      id = states.length;
      ids.set(kk, id);
      states.push(ts);
      edges.push([]);
    }
    return id;
  };
  add(start.map((t) => ({ e: t.elems, fs: 0 })));
  let capped = false;
  let next0 = 0;
  const step = (budget: number): boolean => {
    const until = next0 + budget;
  for (let i = next0; i < states.length; i++) {
    if (states.length > maxStates) {
      capped = true;
      next0 = states.length;
      return true;
    }
    // (This slice's states expanded: on from here next time.)
    if (i >= until) {
      next0 = i;
      return false;
    }
    const ts = states[i];
    for (let k = 0; k < n; k++) {
      for (const nt of forward(k, ts)) {
        const nts = ts.slice();
        nts[k] = nt;
        edges[i].push(add(nts));
      }
      if (mayTurn(k, ts)) {
        const nts = ts.slice();
        nts[k] = turn(k, ts[k]);
        edges[i].push(add(nts));
      }
    }
  }
    next0 = states.length;
    return true;
  };
  // The answer, a slice at a time too (`finishStep`): the strongly connected sets (Tarjan, iterative), then which trains
  // deliver in each. Kept between slices.
  let fin: {
    N: number;
    index: Int32Array;
    low: Int32Array;
    onStack: Uint8Array;
    stack: number[];
    comps: number[][];
    idx: number;
    s: number;
    work: [number, number][];
    c: number;
    best: number;
    bestSet: number[];
    bestComp: number[];
    alone: boolean[];
    cur: { at: number; seen: Set<number | string>[] } | null;
    result: OracleResult | null;
  } | null = null;
  /** Up to about `budget` steps of the answer; true once it's there (`finish` gives it). */
  const finishStep = (budget: number): boolean => {
    if (!fin) {
      if (next0 < states.length) capped = true;
      const N = states.length;
      fin = { N, index: new Int32Array(N).fill(-1), low: new Int32Array(N), onStack: new Uint8Array(N), stack: [], comps: [], idx: 0, s: 0, work: [], c: 0, best: 0, bestSet: [], bestComp: [], alone: start.map(() => false), cur: null, result: null };
    }
    const f = fin;
    if (f.result) return true;
    let left = budget;
    const { N, index, low, onStack, stack, comps } = f;
    while (f.s < N || f.work.length > 0) {
      if (left-- <= 0) return false;
      if (f.work.length === 0) {
        if (index[f.s] !== -1) {
          f.s++;
          continue;
        }
        f.work.push([f.s, 0]);
      }
      const top = f.work[f.work.length - 1];
      const [v, ei] = top;
      if (ei === 0 && index[v] === -1) {
        index[v] = low[v] = f.idx++;
        stack.push(v);
        onStack[v] = 1;
      }
      const es = edges[v] ?? [];
      if (ei < es.length) {
        top[1]++;
        const w = es[ei];
        if (w >= N) continue;
        if (index[w] === -1) f.work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        f.work.pop();
        if (f.work.length > 0) {
          const u = f.work[f.work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          const c: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            c.push(w);
          } while (w !== v);
          comps.push(c);
        }
      }
    }
    for (; f.c < comps.length; f.c++) {
      const c = comps[f.c];
      if (c.length < 2) continue;
      // (Each train's stops seen, or its places, gathered a slice of states at a time.)
      if (!f.cur) f.cur = { at: 0, seen: start.map(() => new Set<number | string>()) };
      const cur = f.cur;
      for (; cur.at < c.length; cur.at++) {
        if (left-- <= 0) return false;
        const st = states[c[cur.at]];
        for (let k = 0; k < n; k++) {
          const stops = start[k].stops;
          if (stops) {
            for (const e of st[k].e) if (stops.includes(e.p)) cur.seen[k].add(e.p);
          } else cur.seen[k].add(key([st[k]]));
        }
      }
      f.cur = null;
      const delivers: number[] = [];
      for (let k = 0; k < n; k++) {
        const stops = start[k].stops;
        if (stops ? cur.seen[k].size === new Set(stops).size : cur.seen[k].size > 1) delivers.push(k);
      }
      for (const k of delivers) f.alone[k] = true;
      if (delivers.length > f.best) {
        f.best = delivers.length;
        f.bestSet = delivers;
        f.bestComp = c;
      }
    }
    f.result = { states: N, best: f.best, bestSet: f.bestSet, alone: f.alone, capped, graph: keep ? { states, edges, best: f.bestComp } : undefined };
    return true;
  };
  const finish = (): OracleResult => {
    finishStep(Infinity);
    return fin!.result!;
  };
  return {
    step,
    finishStep,
    finish,
    get size() {
      return states.length;
    },
  };
}

/** How many whole pieces the oracle gives a train: what it fills on 216 mm pieces, 2 at least. */
export function piecesFor(t: Train): number {
  return Math.max(2, Math.ceil(trainLength(t) / 216));
}

/** A train as the oracle sees it: the pieces it fills from its front (`piecesFor`), tail first, which way it drives (oracle.ts). */
export function elemsOf(layout: Layout, t: Train, n = piecesFor(t)): Elem[] {
  const d = driveOf(t) < 0 ? -1 : 1;
  const lead = d > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1];
  const rev = d > 0 ? lead.reversed : !lead.reversed;
  const pathOf = (p: number, c: number) => {
    const piece = layout.getPiece(p)!;
    const paths = getPieceDef(piece.type, piece.flipped).paths;
    const used = t.bogies.find((b) => b.pieceId === p)?.pathIndex;
    const ok = paths.map((q, i) => ({ q, i })).filter(({ q }) => q.from === c || q.to === c);
    return (ok.find(({ i }) => i === used) ?? ok[0]).q;
  };
  const piece = layout.getPiece(lead.pieceId)!;
  const path = getPieceDef(piece.type, piece.flipped).paths[lead.pathIndex];
  const elems: Elem[] = [rev ? { p: lead.pieceId, en: path.to ?? -1, ex: path.from } : { p: lead.pieceId, en: path.from, ex: path.to ?? -1 }];
  for (let i = 0; i < n + 1; i++) {
    const f = elems[0];
    const back = next(layout, f.p, f.en);
    if (!back) break;
    const q = pathOf(back.pieceId, back.entry);
    elems.unshift({ p: back.pieceId, en: q.from === back.entry ? (q.to ?? -1) : q.from, ex: back.entry });
  }
  // (Off a buffer: the train's front is the piece before it.)
  while (layout.getPiece(elems[elems.length - 1].p)!.type.startsWith("buffer")) elems.pop();
  // (Its tail on a buffer it's just turned at: the oracle has no train on one; the pieces from its front back.)
  while (elems.length > 1 && layout.getPiece(elems[0].p)!.type.startsWith("buffer")) elems.shift();
  return elems.slice(-n);
}

/**
 * A train as the oracle sees it by its real length: the pieces from its front back as far as their paths are as long as
 * it is (a curve is shorter than a straight; the old count, `piecesFor`, took every piece as 216 mm).
 */
export function elemsByLength(layout: Layout, t: Train): Elem[] {
  const L = trainLength(t);
  const all = elemsOf(layout, t, 16);
  const lenOf = (e: Elem) => {
    const piece = layout.getPiece(e.p)!;
    const def = getPieceDef(piece.type, piece.flipped);
    const q = def.paths.find((x) => (x.from === e.en && x.to === e.ex) || (x.from === e.ex && x.to === e.en)) ?? def.paths[0];
    return pathLength(q.geom);
  };
  let sum = 0;
  let i = all.length;
  while (i > 0 && sum < L) sum += lenOf(all[--i]);
  return all.slice(i);
}

