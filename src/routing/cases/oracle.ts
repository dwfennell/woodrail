/**
 * Scratch (docs/agents/stalls-verify-2026-11-10.md): a dispatcher oracle for the long fuzz's stalls. Test-only; nothing
 * in the game imports it.
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
import { connectorRef, getPieceDef, type Layout } from "../../track";
import { blocksOf } from "../../game/signal-place";
import { next, waysFrom } from "../graph";
import { pathLength } from "../../track/path";

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
export function oracle(layout: Layout, start: OTrain[], ends: "any" | "own" | "spare", maxStates = 400_000, signals = false, handFree = false, behind = true): OracleResult {
  const n = start.length;
  const key = (ts: Elem[][]) => ts.map((t) => t.map((e) => `${e.p}.${e.en}.${e.ex}`).join(",")).join("|");
  const sw = new Map<number, boolean>();
  const swOf = (p: number) => {
    let v = sw.get(p);
    if (v === undefined) sw.set(p, (v = isSwitch(layout, p)));
    return v;
  };
  const restOk = (t: Elem[]) => t.every((e) => !swOf(e.p));
  // (A piece's length the way it's run: its path from the end it's come onto by to the one it leaves by.)
  const lens = new Map<string, number>();
  const lenOf = (e: Elem): number => {
    const k = `${e.p}.${e.en}.${e.ex}`;
    let v = lens.get(k);
    if (v === undefined) {
      const piece = layout.getPiece(e.p);
      const def = piece ? getPieceDef(piece.type, piece.flipped) : undefined;
      const path = def?.paths.find((q) => (q.from === e.en && q.to === e.ex) || (q.from === e.ex && q.to === e.en)) ?? def?.paths.find((q) => q.from === e.en || q.to === e.en);
      lens.set(k, (v = path ? pathLength(path.geom) : 216));
    }
    return v;
  };
  /** A train moved on a piece: its tail let go of as far as the rest still covers its length. */
  const trimmed = (k: number, t: Elem[]): Elem[] => {
    const L = start[k].length;
    if (L === undefined) return t.slice(1);
    let sum = 0;
    for (const e of t) sum += lenOf(e);
    let i = 0;
    while (i < t.length - 1 && sum - lenOf(t[i]) >= L) sum -= lenOf(t[i++]);
    return t.slice(i);
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
   * ahead with no points between: that train is this one's end of the line.
   */
  const endAhead = (k: number, ts: Elem[][], f: Elem): boolean => {
    if (atEnd(layout, f)) return true;
    if (!behind) return false;
    const owner = new Map<number, number>();
    ts.forEach((t, j) => {
      if (j !== k) for (const e of t) owner.set(e.p, j);
    });
    let at = f;
    let j = -1;
    for (let i = 0; i < 16; i++) {
      const nx = next(layout, at.p, at.ex);
      if (!nx) return j >= 0;
      if (isBuffer(layout, nx.pieceId)) return j >= 0;
      const o = owner.get(nx.pieceId);
      if (o === undefined || (j >= 0 && o !== j) || swOf(nx.pieceId)) return false;
      // (Behind it: the first of it met is its tail, so it faces away, to the end. Nose to nose isn't behind.)
      if (j < 0 && ts[o][0].p !== nx.pieceId) return false;
      j = o;
      const w = waysFrom(layout, nx.pieceId, nx.entry, () => true)[0];
      if (!w || w.exit < 0) return true;
      at = { p: nx.pieceId, en: nx.entry, ex: w.exit };
    }
    return false;
  };
  const mayTurn = (k: number, ts: Elem[][]): boolean => {
    const t = ts[k];
    const f = t[t.length - 1];
    if (!endAhead(k, ts, f)) return false;
    if (!atEnd(layout, f)) return true;
    const stops = start[k].stops;
    if (ends === "any" || !stops) return true;
    if (stretchOf(f.p).some((q) => stops.includes(q))) return true;
    return ends === "spare" && spareEnd(f.p);
  };
  /** Rest positions train k reaches by one move forward (through points, to the first place clear of them). */
  const forward = (k: number, ts: Elem[][]): Elem[][] => {
    const others = new Set<number>();
    ts.forEach((t, j) => {
      if (j !== k) for (const e of t) others.add(e.p);
    });
    const out: Elem[][] = [];
    let frontier: Elem[][] = [ts[k]];
    for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
      const nextF: Elem[][] = [];
      for (const t of frontier) {
        const f = t[t.length - 1];
        if (f.ex < 0) continue;
        const nx = next(layout, f.p, f.ex);
        if (!nx || isBuffer(layout, nx.pieceId) || others.has(nx.pieceId)) continue;
        if (signals && layout.signalAt(connectorRef(f.p, f.ex)) && [...blockAhead(connectorRef(f.p, f.ex))].some((p) => others.has(p))) continue;
        // (A hand-run train takes points as they're set: no one throws them for it. A routed one, any way.)
        for (const w of waysFrom(layout, nx.pieceId, nx.entry, () => !start[k].stops && !handFree)) {
          if (w.exit < 0) continue;
          const nt = trimmed(k, [...t, { p: nx.pieceId, en: nx.entry, ex: w.exit }]);
          if (new Set(nt.map((e) => e.p)).size < nt.length) continue;
          if (restOk(nt)) out.push(nt);
          else nextF.push(nt);
        }
      }
      frontier = nextF;
    }
    return out;
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
  const turn = (t: Elem[]): Elem[] => [...t].reverse().map((e) => ({ p: e.p, en: e.ex, ex: e.en }));

  // Reachable states (BFS), edges.
  const ids = new Map<string, number>();
  const states: Elem[][][] = [];
  const edges: number[][] = [];
  const add = (ts: Elem[][]): number => {
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
  add(start.map((t) => t.elems));
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
        nts[k] = turn(ts[k]);
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
  const alone = start.map(() => false);
  for (const c of comps) {
    if (c.length < 2) continue;
    const delivers: number[] = [];
    for (let k = 0; k < n; k++) {
      const stops = start[k].stops;
      if (stops) {
        const need = new Set(stops);
        const seen = new Set<number>();
        for (const s of c) for (const e of states[s][k]) if (need.has(e.p)) seen.add(e.p);
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
    }
  }
  return { states: N, best, bestSet, alone, capped };
}
