/**
 * Scratch (docs/agents/stalls-verify-2026-11-10.md): a dispatcher oracle for the long fuzz's stalls. Test-only; nothing
 * in the game imports it.
 *
 * Given the track and where each train stands (its pieces, which way it faces), it searches every sequence of moves a
 * perfect dispatcher (or a player with every lever) could make under the user's rules, and says how many trains can
 * keep delivering for ever. The model, deliberately generous to the trains:
 *
 * - A train fills `L` = 2 whole pieces (268 mm on 216 mm pieces: the least it can stand on). It moves a piece at a
 *   time; a piece holds one train.
 * - **Points are never a place to wait:** a train comes to rest only where none of its pieces is a switch; a move runs
 *   on through points to the next such place.
 * - **Trains turn round only at the ends of lines:** a train reverses only with its front at the end of the track (a
 *   buffer next, or track that stops). `ends`: "any" (any end of track, a siding's too), or "own" (a routed train only
 *   at an end whose last piece is one of its stops; a hand-run train at any).
 * - Every switch may be set either way for each move (the dispatcher holds every lever).
 *
 * Delivering: a routed train comes to every one of its stops (a stop piece under it), over and over; a hand-run train
 * keeps moving. "Over and over" is a strongly connected set of states reachable from the start that the dispatcher can
 * stay in: the answer is the most trains that deliver together in one such set.
 */
import { getPieceDef, type Layout } from "../track";
import { next, waysFrom } from "./graph";

export interface Elem {
  p: number;
  en: number;
  ex: number;
}
export interface OTrain {
  /** Tail first, front last. */
  elems: Elem[];
  stops: number[] | null;
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
 * `blocks` (optional): signal blocks, piece → block. A train may not come onto a piece whose block another train has a
 * piece in (a block signal's rule, each way: a little stricter than the game's, which lets a train stand across a joint).
 */
export function oracle(layout: Layout, start: OTrain[], ends: "any" | "own", maxStates = 400_000, blocks?: ReadonlyMap<number, number>): OracleResult {
  const n = start.length;
  const key = (ts: Elem[][]) => ts.map((t) => t.map((e) => `${e.p}.${e.en}.${e.ex}`).join(",")).join("|");
  const sw = new Map<number, boolean>();
  const swOf = (p: number) => {
    let v = sw.get(p);
    if (v === undefined) sw.set(p, (v = isSwitch(layout, p)));
    return v;
  };
  const restOk = (t: Elem[]) => t.every((e) => !swOf(e.p));
  const mayTurn = (k: number, t: Elem[]): boolean => {
    const f = t[t.length - 1];
    if (!atEnd(layout, f)) return false;
    const stops = start[k].stops;
    if (ends === "any" || !stops) return true;
    return stops.includes(f.p);
  };
  /** Rest positions train k reaches by one move forward (through points, to the first place clear of them). */
  const forward = (k: number, ts: Elem[][]): Elem[][] => {
    const others = new Set<number>();
    const taken = new Set<number>();
    ts.forEach((t, j) => {
      if (j !== k)
        for (const e of t) {
          others.add(e.p);
          const b = blocks?.get(e.p);
          if (b !== undefined) taken.add(b);
        }
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
        const nb = blocks?.get(nx.pieceId);
        if (nb !== undefined && taken.has(nb)) continue;
        for (const w of waysFrom(layout, nx.pieceId, nx.entry, () => false)) {
          if (w.exit < 0) continue;
          const nt = [...t.slice(1), { p: nx.pieceId, en: nx.entry, ex: w.exit }];
          if (new Set(nt.map((e) => e.p)).size < nt.length) continue;
          if (restOk(nt)) out.push(nt);
          else nextF.push(nt);
        }
      }
      frontier = nextF;
    }
    return out;
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
      if (mayTurn(k, ts[k])) {
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
