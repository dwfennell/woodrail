import type { Bag } from "../economy/goods";
import type { DepotRole, DepotState } from "../economy";
import { connectorRef, createWorldConnector, DOUBLE_TRACK_SPACING, SPLIT_SHORT_LENGTH, getPieceDef, indexOfRef, isPlainStraight, pieceOfRef, straightLength, transformPose, type Ignore, type PieceTypeId, type Pose } from "../track";
import type { World } from "./world";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): an industry upgraded from its card to two, then
 * three tracks side by side. The extra tracks lie beside its own on the side away from its yard, a double track (72 mm)
 * apart, joined at both ends by a short split (`split-short`, a turnout of 144 mm: two squares) laid in place of the
 * plain straights there, like a passing loop; the third track branches off the second the same way. One undo step
 * (`Editor.replaceRun`, in a group with the record and the price). Each extra track is the depot to the economy
 * (`Economy.setTracks`); its one crane, its gantry spanning them all, serves each track's train in turn.
 *
 * In the depot's frame (t along its track from its first end, l across, +l the yard's side), for `n` tracks: every
 * track runs clear of points from t = −e0 to 216 + e1, where e0 + e1 = `EXTRA` (216): 432 mm, long enough for an engine
 * and three wagons to stand clear of the turnouts. The extra is shared evenly (108 at each end) where the line allows,
 * else as much at one end as it takes (from 0 to 216, in 18s), so a curve or points close to one end don't stop it.
 * Line k (0 the line itself, l = −k·72) runs from t = −e0 − (n−1−k)·144, the turnout onto line k+1 first (k < n−1),
 * flipped (its link to −l); the far end the same turned round. So an end needs (n−1)·144 + its share: from 2 squares
 * (with 5 at the other end) to 3½ at each for the second track, and 4 to 5½ for the third.
 *
 * Older saves' tracks joined by a ladder of crossovers (and buffers) keep working as they are; another track added to
 * one takes the ladder up with the line and lays turnouts.
 */

/** The most tracks a depot has. */
export const MAX_TRACKS = 3;
/** Tracks of a depot of several lie this far apart (mm), on the side away from its yard (a double track apart). */
export const TRACK_GAP = DOUBLE_TRACK_SPACING;
/** A depot's piece is a 216 straight. */
const DEPOT_LEN = 216;
/** Each track's run clear of points is the depot's 216 and this much more, shared between its ends: 432 mm. */
export const EXTRA = 216;
/** The turnout joining each further track: a short split (mm). */
export const TURNOUT = SPLIT_SHORT_LENGTH;
/** The research that brings them. */
export const TRACKS_TECH = "sidings";

/** What each further track costs, taken from the workshops' piles: the 2nd, the 3rd. */
export const TRACK_PRICES: Readonly<Record<2 | 3, Bag>> = { 2: { planks: 10 }, 3: { planks: 12, stone: 10 } };

/**
 * Which depots can have more tracks: every industry a train loads or unloads at by crane. Not a town's station (it
 * has big stations), a school (a few research loads), nor a Sandbox loader (a kit).
 */
export const TRACK_ROLES: ReadonlySet<DepotRole> = new Set<DepotRole>(["forest", "sawmill", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", "dairy", "bakery", "orchard", "juicer", "creamery", "icecream", "brickworks", "carworks", "oilwell", "waterpump", "beetfield", "jamworks", "chocworks", "flowerfield", "dyeworks", "glassworks", "toyworks", "postoffice"]);

export interface NewPiece {
  type: PieceTypeId;
  pose: Pose;
  y: number;
  flipped: boolean;
}

type Part = "road" | "end" | "ladder";

/** An upgrade worked out: the pieces taken up and put down, and what each put down is. */
export interface TracksPlan {
  readonly depotId: number;
  readonly depotPieceId: number;
  readonly tracks: 2 | 3;
  readonly covers: readonly number[];
  readonly pieces: readonly NewPiece[];
  /** Of each piece put down: a new track's middle (its crane's), the rest of a new track, or the joins (turnouts, the line's straights). */
  readonly parts: readonly Part[];
  /** The tracks already laid, kept: their middles (each its own crane's). Their ends and joins are laid again. */
  readonly keptRoads: readonly number[];
  /** How much of the extra length is at the depot's first end (mm; the rest at the other). */
  readonly e0: number;
}

/** Why a piece can't go there, in words (the game's own drop rule), ignoring the pieces in `ignore`; null if it can. */
export type PlaceCheck = (type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore) => string | null;

/** Plain straights there are, by length (mm). */
const STRAIGHTS = [288, 216, 198, 180, 162, 144, 126, 108, 90, 72, 54, 36];
const ORD = ["", "", "second", "third"];
/** In squares, as a child would count them ("4½"). */
export const squares = (mm: number) => {
  const h = Math.round(mm / 36) / 2;
  return Number.isInteger(h) ? String(h) : `${Math.floor(h)}½`;
};
/** Straights to fill `len` mm (a multiple of 18), longest first; null if they can't (18 alone). */
function fill(len: number): number[] | null {
  const out: number[] = [];
  let left = Math.round(len);
  while (left > 0) {
    const c = STRAIGHTS.find((x) => x <= left && (x === left || left - x >= 36));
    if (c === undefined) return null;
    out.push(c);
    left -= c;
  }
  return out;
}
const scratch = createWorldConnector();

/** What stops the line's straight at one end of a depot, in words (after "before"), or why it stops. */
type Stop = "none" | "ends" | "climbs" | "points" | "bends" | "far";
const STOP_WORDS: Record<Stop, string> = { none: "", ends: "the track ends", climbs: "it climbs", points: "points", bends: "a curve", far: "" };

/** What the planner looked at along the line, for the card to show on the map: the straight it takes and what's in the way. */
export interface TracksLook {
  /** The pieces of the line the turnouts and their straights take the place of (or, refused, the straight there is). */
  room: number[];
  /** The pieces in the way: the curve, points or slope the straight stops at (refused), or a train's. */
  block: number[];
}

/** The straight along the line out of one end of the depot: its pieces with how far each reaches, and what stops it. */
interface Side {
  steps: { pid: number; reach: number; occupied: boolean }[];
  reach: number;
  stop: Stop;
  stopAt: number;
}

/**
 * Can depot `depot` have one more track, and how: the plan, or why not in words. Walks the line out from both ends of
 * the depot for the straight track the turnouts and their straights take the place of; asks the game's drop rule for
 * every piece put down. Cheap enough for a card (a few pieces), not run per frame. `look`, if given, is filled with
 * the stretch of line it takes (or would) and what's in the way, to show on the map.
 */
export function planTracks(w: Pick<World, "layout" | "sim" | "economy">, depot: DepotState, check: PlaceCheck, look?: TracksLook): TracksPlan | string {
  const layout = w.layout;
  const piece = layout.getPiece(depot.pieceId);
  if (look) {
    look.room = [];
    look.block = [];
  }
  if (!piece) return "It isn't on the map";
  const have = w.economy.trackCount(depot.id);
  if (have >= MAX_TRACKS) return `It has ${MAX_TRACKS} tracks already`;
  const n = (have + 1) as 2 | 3;
  const rec = w.economy.tracksOf(depot.id);
  const live = (ids: readonly number[] | undefined) => (ids ?? []).filter((id) => !!layout.getPiece(id));
  // The tracks' joins as they are (a ladder of crossovers in an older save, turnouts since), and their ends: all taken
  // up and laid again for one more track. The tracks' middles (each its own crane's) are kept.
  const ladder = new Set(live(rec?.ladder));
  const oldEnds = live(rec?.ends);
  const keptRoads = w.economy.roadsOf(depot.id).map((r) => r.pieceId);
  const turnouts = (n - 1) * TURNOUT;
  // The line need not reach further than all the extra length at one end.
  const most = turnouts + EXTRA;
  const c = Math.cos(piece.pose.heading);
  const s = Math.sin(piece.pose.heading);
  const walk = (side: 0 | 1): Side => {
    const steps: Side["steps"] = [];
    let ref = connectorRef(depot.pieceId, side);
    let reach = 0;
    for (let guard = 0; guard < 40 && reach < most - 0.5; guard++) {
      const other = layout.joinedConnector(ref);
      if (other === -1) return { steps, reach, stop: guard === 0 ? "none" : "ends", stopAt: -1 };
      const pid = pieceOfRef(other);
      const p = layout.getPiece(pid);
      if (!p) return { steps, reach, stop: "ends", stopAt: -1 };
      if (Math.abs(p.y - piece.y) > 0.5) return { steps, reach, stop: "climbs", stopAt: pid };
      const def = getPieceDef(p.type, p.flipped);
      const entry = indexOfRef(other);
      let exit = -1;
      if (isPlainStraight(p.type) && straightLength(p.type, p.flipped) > 0) exit = entry === 0 ? 1 : 0;
      // (The tracks' own joins: through them straight on. A crossover's straight is 0–1; a split's 0–1, entered at 1.)
      else if (ladder.has(pid) && p.type === "crossover") exit = entry === 1 ? 0 : entry === 0 ? 1 : -1;
      else if (ladder.has(pid) && (p.type === "split-short" || p.type === "split")) exit = entry === 1 ? 0 : -1;
      if (exit === -1) return { steps, reach, stop: def.isSwitch ? "points" : "bends", stopAt: pid };
      const wc = layout.worldConnector(connectorRef(pid, exit), scratch);
      const dx = wc.x - piece.pose.x;
      const dz = wc.z - piece.pose.z;
      const t = c * dx + s * dz;
      if (Math.abs(-s * dx + c * dz) > 1) return { steps, reach, stop: "bends", stopAt: pid };
      reach = side === 0 ? -t : t - DEPOT_LEN;
      steps.push({ pid, reach, occupied: w.sim.pieceOccupied(pid) });
      ref = connectorRef(pid, exit);
    }
    return { steps, reach, stop: "far", stopAt: -1 };
  };
  const sides = [walk(0), walk(1)] as const;
  // How the extra length is shared between the ends: as evenly as the line allows (half at each end, so the crane is
  // as near the middle of each track as it can be), else as much at one end as it takes.
  const evenly = EXTRA / 2;
  const shares: number[] = [];
  for (let e = 0; e <= EXTRA; e += 18) shares.push(e);
  shares.sort((a, b) => Math.abs(a - evenly) - Math.abs(b - evenly) || a - b);
  const fits = (side: Side, need: number) => side.reach >= need - 0.5;
  /** The pieces of `side` that `need` mm take up, and the straight left over past it; null if that can't be laid. */
  const take = (side: Side, need: number): { pids: number[]; spare: number[] } | null => {
    const pids: number[] = [];
    if (need < 0.5) return { pids, spare: [] };
    for (const st of side.steps) {
      pids.push(st.pid);
      if (st.reach >= need - 0.5) {
        const spare = fill(st.reach - need);
        return spare ? { pids, spare } : null;
      }
    }
    return null;
  };
  let why: string | null = null;
  let best: { e0: number; got: [{ pids: number[]; spare: number[] }, { pids: number[]; spare: number[] }] } | null = null;
  for (const e0 of shares) {
    const need = [turnouts + e0, turnouts + EXTRA - e0];
    if (!fits(sides[0], need[0]) || !fits(sides[1], need[1])) continue;
    const got = [take(sides[0], need[0]), take(sides[1], need[1])] as const;
    if (!got[0] || !got[1]) continue;
    best = { e0, got: [got[0], got[1]] };
    break;
  }
  const words = `The ${ORD[n]} track needs ${squares(2 * turnouts + EXTRA)} squares of straight line beside it, at least ${squares(turnouts)} at each end`;
  if (!best) {
    if (look) {
      for (const side of sides) look.room.push(...side.steps.map((st) => st.pid));
      for (const side of sides) if (side.stopAt !== -1 && side.reach < most - 0.5) look.block.push(side.stopAt);
    }
    // Say what there is at each end, and what stops it.
    const at = (side: Side) => {
      if (side.stop === "far") return `room at the other`;
      if (side.stop === "none") return "no track joined";
      const there = side.reach < 18 ? "none" : `${squares(side.reach)}`;
      return `${there} before ${STOP_WORDS[side.stop]}`;
    };
    const [a, b] = sides[0].reach <= sides[1].reach ? [sides[0], sides[1]] : [sides[1], sides[0]];
    if (a.stop === "none" && b.stop === "none") return `${words}: lay track at both ends first`;
    if (a.stop === "none") return `${words}: lay track at its other end first`;
    const other = b.stop === "far" ? "room at the other" : `${at(b)} at the other`;
    return `${words}: there's ${at(a)} at one end, ${other} (shown on the map)`;
  }
  const { e0 } = best;
  const e1 = EXTRA - e0;
  const covers = new Set<number>([...ladder, ...oldEnds]);
  for (const g of best.got) for (const pid of g.pids) covers.add(pid);
  const line = [...best.got[0].pids, ...best.got[1].pids];
  if (look) look.room.push(...line);
  const train = line.filter((pid) => w.sim.pieceOccupied(pid));
  if (train.length > 0) {
    if (look) look.block.push(...train);
    return "A train is standing on the line beside it: move it first";
  }
  const pieces: NewPiece[] = [];
  const parts: Part[] = [];
  const out = { x: 0, z: 0, heading: 0 };
  const at = (t: number, l: number, h: number): Pose => ({ ...transformPose(piece.pose, { x: t, z: l, heading: h }, out) });
  const add = (type: PieceTypeId, pose: Pose, flipped: boolean, part: Part = "ladder") => {
    pieces.push({ type, pose, y: piece.y, flipped });
    parts.push(part);
  };
  /** Straights along line `l` from t0 to t1 (t0 < t1). */
  const run = (t0: number, t1: number, l: number, part: Part) => {
    let t = t0;
    for (const len of fill(t1 - t0) ?? []) {
      add(`straight-${len}` as PieceTypeId, at(t, l, 0), false, part);
      t += len;
    }
  };
  // Past the turnouts by part of a straight: the rest put back as shorter straights.
  const need0 = turnouts + e0;
  const need1 = turnouts + e1;
  {
    let t = -need0;
    for (const len of [...best.got[0].spare].reverse()) {
      t -= len;
      add(`straight-${len}` as PieceTypeId, at(t, 0, 0), false);
    }
    t = DEPOT_LEN + need1;
    for (const len of best.got[1].spare) {
      add(`straight-${len}` as PieceTypeId, at(t, 0, 0), false);
      t += len;
    }
  }
  // Each line k (0 the line itself, 1 … n−1 the further tracks, k·72 over): from the turnout onto it (k ≥ 1) to the
  // depot's ends, the turnout onto the next line first (k < n−1), then straight; and the same at the far end. The
  // track the crane works (t 0 … 216) is the depot's own piece (k 0) or the track's middle ("road").
  for (let k = 0; k < n; k++) {
    const l = -k * TRACK_GAP;
    const begin = -e0 - (n - 1 - k) * TURNOUT;
    const end = DEPOT_LEN + e1 + (n - 1 - k) * TURNOUT;
    const part: Part = k === 0 ? "ladder" : "end";
    let from = begin;
    let to = end;
    if (k < n - 1) {
      // The turnout onto line k+1: its trunk outward, its link over to −l (flipped at the near end; turned round at the far).
      add("split-short", at(begin, l, 0), true);
      add("split-short", at(end, l, Math.PI), false);
      from = begin + TURNOUT;
      to = end - TURNOUT;
    }
    run(from, 0, l, part);
    run(DEPOT_LEN, to, l, part);
    if (k >= 1 && k > keptRoads.length) add("straight-216", at(0, l, 0), false, "road");
  }
  // Room for each piece put down: the game's own rule, the pieces it takes the place of left out.
  const ignore = new Set(covers);
  for (const p of pieces) {
    const no = check(p.type, p.flipped, p.pose, p.y, ignore);
    if (no) {
      why = `No room for a ${ORD[n]} track: ${no[0].toLowerCase()}${no.slice(1)}`;
      break;
    }
  }
  if (why) return why;
  return { depotId: depot.id, depotPieceId: depot.pieceId, tracks: n, covers: [...covers], pieces, parts, keptRoads, e0 };
}

/** The depot's tracks as a plan leaves them (the editor's ids for `plan.pieces`, in order): for `Economy.setTracks`. */
export function tracksAfter(plan: TracksPlan, ids: readonly number[]): { roads: number[]; ends: number[]; ladder: number[] } {
  const of = (part: Part) => plan.parts.flatMap((p, i) => (p === part ? [ids[i]] : []));
  return { roads: [...plan.keptRoads, ...of("road")], ends: of("end"), ladder: of("ladder") };
}
