/**
 * Via points (the routing spec §3.5): pieces of track (or a station or halt's piece) a line passes on its way from one
 * stop to the next, in order, without stopping. A stop's `via` are those on the way out of it, to the stop after.
 *
 * A route keeps how many of the vias into its next stop it has passed (`viaFor`, `viaDone`); its train is aimed at the
 * first not passed, then the stop (`aimOf`). Shared by the economy and the routing harness, so both aim the same way.
 */

/** What a route keeps of its via points: which stop's way it's on (`viaFor`), and how many vias it has passed. */
export interface ViaProgress {
  next: number;
  at?: boolean;
  viaFor?: number;
  viaDone?: number;
}

/** The vias on a route's way into stop `i`: those of the stop before it (round the route). */
export type ViasOf = (k: number) => readonly number[] | undefined;

const NONE: readonly number[] = [];

function into(n: number, i: number, viasOf: ViasOf): readonly number[] {
  return viasOf((i - 1 + n) % n) ?? NONE;
}

/** How many vias into stop `i` the route has passed. */
export function viaDone(r: ViaProgress, i: number): number {
  return r.viaFor === i ? (r.viaDone ?? 0) : 0;
}

/**
 * The piece a routed train heads for on its way into stop `i` (of `n`), `skip` aims on: its vias not yet passed (those on
 * the map), then `stopPiece` (−1: none). `skip` 0 is where it's aimed now; 1 the aim after that (the router's look on past
 * a via, so the points just beyond one are set in time). −1 past the stop.
 */
export function aimOf(r: ViaProgress, n: number, i: number, viasOf: ViasOf, onMap: (pieceId: number) => boolean, stopPiece: number, skip = 0): number {
  const vias = into(n, i, viasOf);
  for (let k = viaDone(r, i); k < vias.length; k++) {
    if (!onMap(vias[k])) continue;
    if (skip-- === 0) return vias[k];
  }
  return skip === 0 ? stopPiece : -1;
}

/**
 * On the way to stop `r.next` (not at it): the vias its front (`front`, the piece its leading axle is on) has come to are
 * passed; so are those taken up. Cheap: a lookup or two per tick, only on a route with vias.
 */
export function passVias(r: ViaProgress, n: number, viasOf: ViasOf, onMap: (pieceId: number) => boolean, front: number): void {
  const i = r.next % n;
  const vias = into(n, i, viasOf);
  if (vias.length === 0) return;
  let done = viaDone(r, i);
  while (done < vias.length && (vias[done] === front || !onMap(vias[done]))) done++;
  if (done !== viaDone(r, i)) {
    r.viaFor = i;
    r.viaDone = done;
  }
}

/** Left a stop (or put on a route afresh): no vias passed on the way to the next. */
export function resetVias(r: ViaProgress): void {
  r.viaFor = r.next;
  r.viaDone = 0;
}

/**
 * Sections sent it by another road (a loop's other road, `skipStops`): the vias it's aimed at there are passed (it can't
 * pass them this time). True if any were.
 */
export function skipVias(r: ViaProgress, n: number, viasOf: ViasOf, pieces: ReadonlySet<number>): boolean {
  const i = r.next % n;
  const vias = into(n, i, viasOf);
  let done = viaDone(r, i);
  const was = done;
  while (done < vias.length && pieces.has(vias[done])) done++;
  if (done === was) return false;
  r.viaFor = i;
  r.viaDone = done;
  return true;
}

/**
 * A route's aims round one lap from where it's aimed now (stop `i`, `done` of the vias into it passed): the vias into
 * each stop not passed (those on the map), then the stop (`stopPiece`, −1: off the map, left out), stop by stop from `i`
 * round, and last the vias into `i` already passed (they come again next lap). For sections' `circling`: where a train
 * goes from here on, leg by leg, without stopping at the first stop.
 */
export function lapAims(n: number, i: number, done: number, viasOf: ViasOf, onMap: (pieceId: number) => boolean, stopPiece: (k: number) => number): number[] {
  const out: number[] = [];
  for (let s = 0; s < n; s++) {
    const k = (i + s) % n;
    const vias = into(n, k, viasOf);
    for (let v = s === 0 ? done : 0; v < vias.length; v++) if (onMap(vias[v])) out.push(vias[v]);
    const p = stopPiece(k);
    if (p >= 0) out.push(p);
  }
  const first = into(n, i, viasOf);
  for (let v = 0; v < Math.min(done, first.length); v++) if (onMap(first[v])) out.push(first[v]);
  return out;
}
