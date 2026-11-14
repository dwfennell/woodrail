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
  for (let i = 0; i < states.length; i++) {
    if (states.length > maxStates) {
      capped = true;
      break;
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
  // Strongly connected sets (Tarjan, iterative).
  const N = states.length;
  const index = new Int32Array(N).fill(-1);
  const low = new Int32Array(N);
  const onStack = new Uint8Array(N);
  const stack: number[] = [];
  const comps: number[][] = [];
  let idx = 0;
  for (let s = 0; s < N; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    while (work.length > 0) {
      const top = work[work.length - 1];
      const [v, ei] = top;
      if (ei === 0 && index[v] === -1) {
        index[v] = low[v] = idx++;
        stack.push(v);
        onStack[v] = 1;
      }
      const es = edges[v] ?? [];
      if (ei < es.length) {
        top[1]++;
        const w = es[ei];
        if (w >= N) continue;
        if (index[w] === -1) work.push([w, 0]);
        else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length > 0) {
          const u = work[work.length - 1][0];
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
  }
  let best = 0;
  let bestSet: number[] = [];
  let bestComp: number[] = [];
  const alone = start.map(() => false);
  for (const c of comps) {
    if (c.length < 2) continue;
    const delivers: number[] = [];
    for (let k = 0; k < n; k++) {
      const stops = start[k].stops;
      if (stops) {
        const need = new Set(stops);
        const seen = new Set<number>();
        for (const s of c) for (const e of states[s][k].e) if (need.has(e.p)) seen.add(e.p);
        if (seen.size === need.size) delivers.push(k);
      } else {
        const pos = new Set(c.map((s) => key([states[s][k]])));
        if (pos.size > 1) delivers.push(k);
      }
    }
    for (const k of delivers) alone[k] = true;
    if (delivers.length > best) {
      best = delivers.length;
      bestSet = delivers;
      bestComp = c;
    }
  }
  return { states: N, best, bestSet, alone, capped, graph: keep ? { states, edges, best: bestComp } : undefined };
}
