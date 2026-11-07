/**
 * What counts as points: the one place that says whether a piece offers a choice of way, whether two of its paths foul
 * each other, and whether it's double track (routing redesign §6 F3, docs/superpowers/specs/2026-11-07-routing-redesign.md).
 *
 * Before this module the same questions were answered five ways (the sim's `pathsApart`/`pathsMeet`, sections'
 * `branches`/`blockEdge`, the router's `isPoints`, the `oneOwner` invariant's shared-end test, the shadow's "more than
 * one path"). Each caller kept its own meaning, so the meanings are kept here as separately named questions, each worked
 * out once per piece def:
 *
 * - `leverPoints`: a switch with a lever the player (or a route) throws. Not a deck, a lift or a signal.
 * - `offersChoice`: some end of the piece leads on by two or more paths (a switch, a deck, a lift, a slip). A buffer's
 *   turn-back path or a diamond's two straights is no choice.
 * - `doubleTrack`: not a switch, and every pair of its paths stays a track's width apart (a double straight, a gantry's
 *   roads). A crossing is not: its lines meet.
 * - `junction`: several paths that meet somewhere (a switch, a crossing, a slip; a deck). Not double track.
 * - `overlaps(def)[i]`: the other paths (a bit each) that come within a track's width of path `i` (the booking table's
 *   overlaps table: a train on one fouls a train on the other). None on a deck or a lift, which one train has to
 *   itself whole.
 * - `pathsFoul(def, i, j)`: `i === j`, or `overlaps` says so (the decks and lifts: always).
 */
import { pathLength, samplePath, createSample } from "./path";
import { TRACK_WIDTH } from "./constants";
import type { PieceDef } from "./pieces";

/** The most paths a piece may have for the overlaps table (as the sim's path masks). */
export const MAX_OVERLAP_PATHS = 16;

interface Facts {
  overlaps: readonly number[];
  doubleTrack: boolean;
  offersChoice: boolean;
}

const facts = new WeakMap<PieceDef, Facts>();
const sa = createSample();
const sb = createSample();

/** Do two of a piece's paths come within a track's width of each other somewhere (sampled every 8 mm)? */
export function pathsMeet(def: PieceDef, i: number, j: number): boolean {
  const step = 8;
  const a = def.paths[i].geom;
  const b = def.paths[j].geom;
  const la = pathLength(a);
  const lb = pathLength(b);
  for (let s = 0; s <= la; s += step) {
    samplePath(a, Math.min(s, la), sa);
    for (let t = 0; t <= lb; t += step) {
      samplePath(b, Math.min(t, lb), sb);
      if (Math.hypot(sa.x - sb.x, sa.z - sb.z) < TRACK_WIDTH) return true;
    }
  }
  return false;
}

function factsOf(def: PieceDef): Facts {
  let f = facts.get(def);
  if (f) return f;
  const n = def.paths.length;
  const meets: boolean[][] = [];
  for (let i = 0; i < n; i++) meets.push(new Array<boolean>(n).fill(false));
  if (n > 1 && n <= MAX_OVERLAP_PATHS)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) if (pathsMeet(def, i, j)) meets[i][j] = meets[j][i] = true;
  const overlaps = new Array<number>(n).fill(0);
  if (!def.gated && !def.lift) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (meets[i][j]) overlaps[i] |= 1 << j;
  let apart = !def.isSwitch && n >= 2;
  for (let i = 0; i < n && apart; i++) for (let j = i + 1; j < n && apart; j++) if (meets[i][j]) apart = false;
  let choice = def.isSwitch || !!def.gated;
  for (let c = 0; c < def.connectors.length && !choice; c++) {
    let k = 0;
    for (const p of def.paths) if (p.from === c || p.to === c) k++;
    if (k > 1) choice = true;
  }
  f = { overlaps, doubleTrack: apart, offersChoice: choice };
  facts.set(def, f);
  return f;
}

/** A switch with a lever (not a deck, a lift or a signal): what routes set and the player taps. */
export function leverPoints(def: PieceDef): boolean {
  return def.isSwitch && !def.gated && !def.signal;
}

/** Does some end of the piece lead on by two or more paths (a switch, a deck, a lift, a slip)? */
export function offersChoice(def: PieceDef): boolean {
  return factsOf(def).offersChoice;
}

/** Double track (or more): not a switch, several paths, none within a track's width of another anywhere. */
export function doubleTrack(def: PieceDef): boolean {
  return factsOf(def).doubleTrack;
}

/** Several paths that meet (a switch, a crossing, a slip, a deck): a place a train must never wait on. */
export function junction(def: PieceDef): boolean {
  return def.paths.length > 1 && !factsOf(def).doubleTrack;
}

/** For each path, the others (a bit each) that foul it. Empty masks on a deck or a lift, and on plain track. */
export function overlaps(def: PieceDef): readonly number[] {
  return factsOf(def).overlaps;
}

/**
 * Do these two paths of a piece foul each other: the same path, or ones that come within a track's width? On a deck or a
 * lift, any two do (one train has it whole).
 */
export function pathsFoul(def: PieceDef, i: number, j: number): boolean {
  if (i === j || def.gated || def.lift) return true;
  return ((factsOf(def).overlaps[i] >> j) & 1) === 1;
}

/** Does any path in mask `a` foul any in mask `b` (masks of path bits)? */
export function masksFoul(def: PieceDef, a: number, b: number): boolean {
  if ((a & b) !== 0) return true;
  if (a === 0 || b === 0) return false;
  if (def.gated || def.lift) return true;
  const o = factsOf(def).overlaps;
  for (let i = 0; i < o.length; i++) if ((a >> i) & 1 && (o[i] & b) !== 0) return true;
  return false;
}
