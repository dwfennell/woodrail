import type { Bag } from "../economy/goods";
import type { DepotRole, DepotState } from "../economy";
import { connectorRef, createWorldConnector, DOUBLE_TRACK_SPACING, getPieceDef, indexOfRef, isPlainStraight, pieceOfRef, straightLength, transformPose, type Ignore, type PieceTypeId, type Pose } from "../track";
import type { World } from "./world";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md; PROTOTYPE): an industry upgraded from its card to
 * serve two, then three tracks side by side. The extra roads lie beside its own track on the side away from its yard,
 * a double track (72 mm) apart, joined to the line at both ends by a ladder of crossovers laid in place of the plain
 * straights there (and a buffer on each crossover's spare end), all in one undo step (`Editor.replaceRun`). Each road
 * is the depot to the economy (`Economy.addRoad`): its own crane, the yard's piles, so two trains are worked at once.
 *
 * The ladder, in the depot's frame (t along its track from its first end, l across, +l the yard's side), for `n`
 * tracks: crossover k (1 … n−1) at the near end joins line k−1 (l = −(k−1)·72) to line k, over t ∈ [−(n−k)·216,
 * −(n−k−1)·216], flipped (its link to −l); at the far end the same turned round. Line j ≥ 1's road is a 216 straight
 * beside the depot (t ∈ [0, 216]). Each side needs (n−1)·216 mm of straight track on the line.
 */

/** The most tracks a depot has. */
export const MAX_TRACKS = 3;
/** Tracks lie this far apart (mm). */
export const TRACK_GAP = DOUBLE_TRACK_SPACING;
/** A depot's track length (mm): every industry's piece is a 216 straight. */
const DEPOT_LEN = 216;

/** What each further track costs (paid like a piece made at the workshop): the 2nd, the 3rd. */
export const TRACK_PRICES: Readonly<Record<2 | 3, Bag>> = { 2: { planks: 10 }, 3: { planks: 12, stone: 10 } };

/**
 * Which depots can have more tracks: every industry a train loads or unloads at by crane. Not a town's station (it
 * has big stations), a school (a few research loads), nor a Sandbox loader (a kit).
 */
export const TRACK_ROLES: ReadonlySet<DepotRole> = new Set<DepotRole>(["forest", "sawmill", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", "dairy", "bakery", "orchard", "juicer", "creamery", "icecream", "brickworks"]);

/** A depot's further tracks as laid: its roads (line 1, 2), and the ladder pieces (crossovers, straights, buffers). */
export interface DepotRoads {
  roads: number[];
  ladder: number[];
}

/** Depot piece id → its further tracks (prototype: kept per world; the spec saves it with the depot). */
const records = new WeakMap<object, Map<number, DepotRoads>>();
export function roadsRecord(w: Pick<World, "layout">): Map<number, DepotRoads> {
  let m = records.get(w.layout);
  if (!m) records.set(w.layout, (m = new Map()));
  return m;
}

/** How many tracks depot piece `pieceId` has now (its roads still on the layout, and 1). */
export function trackCount(w: Pick<World, "layout">, pieceId: number): number {
  const r = roadsRecord(w).get(pieceId);
  return 1 + (r ? r.roads.filter((id) => !!w.layout.getPiece(id)).length : 0);
}

export interface NewPiece {
  type: PieceTypeId;
  pose: Pose;
  y: number;
  flipped: boolean;
}

/** An upgrade worked out: the pieces taken up and put down, and which of those put down are the new roads. */
export interface TracksPlan {
  readonly depotPieceId: number;
  readonly tracks: number;
  readonly covers: readonly number[];
  readonly pieces: readonly NewPiece[];
  /** Indices into `pieces` of new roads (line 1, 2 …), and of the rest (the ladder). */
  readonly roads: readonly number[];
  readonly ladder: readonly number[];
  /** Roads already laid, kept. */
  readonly kept: readonly number[];
}

/** Why a piece can't go there, in words (the game's own drop rule), ignoring the pieces in `ignore`; null if it can. */
export type PlaceCheck = (type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore) => string | null;

/** Plain straights there are, by length (mm). */
const STRAIGHTS = new Set([36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 288]);

const ORD = ["", "", "second", "third"];
const sq = (mm: number) => Math.round(mm / 72);

/**
 * Can depot piece `depotPieceId` have one more track, and how: the plan, or why not in words. Walks the line out from
 * both ends of the depot for the straight track the ladder takes the place of; asks the game's drop rule for every
 * piece put down. Cheap enough for a card (a few pieces), not run per frame.
 */
export function planTracks(w: Pick<World, "layout" | "sim">, depotPieceId: number, check: PlaceCheck): TracksPlan | string {
  const layout = w.layout;
  const depot = layout.getPiece(depotPieceId);
  if (!depot) return "It isn't on the map";
  const have = trackCount(w, depotPieceId);
  if (have >= MAX_TRACKS) return `It has ${MAX_TRACKS} tracks already`;
  const n = have + 1;
  const rec = roadsRecord(w).get(depotPieceId);
  const ladder = new Set((rec?.ladder ?? []).filter((id) => !!layout.getPiece(id)));
  const kept = (rec?.roads ?? []).filter((id) => !!layout.getPiece(id));
  const need = (n - 1) * DEPOT_LEN;
  const covers = new Set<number>(ladder);
  const pieces: NewPiece[] = [];
  const out = { x: 0, z: 0, heading: 0 };
  const at = (t: number, l: number, h: number): Pose => ({ ...transformPose(depot.pose, { x: t, z: l, heading: h }, out) });
  const toLocal = (x: number, z: number) => {
    const c = Math.cos(depot.pose.heading);
    const s = Math.sin(depot.pose.heading);
    const dx = x - depot.pose.x;
    const dz = z - depot.pose.z;
    return { t: c * dx + s * dz, l: -s * dx + c * dz };
  };
  // The line each way: plain straights (or the ladder's own pieces on it), in line with the depot, `need` long.
  for (const side of [0, 1] as const) {
    let ref = connectorRef(depotPieceId, side);
    let reached = 0;
    for (let guard = 0; guard < 32 && reached < need - 0.5; guard++) {
      const other = layout.joinedConnector(ref);
      const words = `The ${ORD[n]} track needs ${sq(need)} squares of straight track on the line at each end`;
      if (other === -1) return `${words}: the line ends`;
      const pid = pieceOfRef(other);
      const p = layout.getPiece(pid);
      if (!p) return words;
      if (Math.abs(p.y - depot.y) > 0.5) return `${words}: it climbs`;
      const def = getPieceDef(p.type, p.flipped);
      const entry = indexOfRef(other);
      let exit = -1;
      if (isPlainStraight(p.type) && straightLength(p.type, p.flipped) > 0) exit = entry === 0 ? 1 : 0;
      else if (ladder.has(pid) && (p.type === "crossover" || isPlainStraight(p.type))) exit = entry === 1 ? 0 : entry === 0 ? 1 : -1;
      if (exit === -1 || def.connectors.length < 2) return `${words}: ${def.isSwitch ? "there are points" : "it bends"} in the way`;
      if (w.sim.pieceOccupied(pid)) return "A train is standing on the line beside it: move it first";
      covers.add(pid);
      const wc = layout.worldConnector(connectorRef(pid, exit), scratch);
      const loc = toLocal(wc.x, wc.z);
      if (Math.abs(loc.l) > 1) return `${words}: it bends`;
      reached = side === 0 ? -loc.t : loc.t - DEPOT_LEN;
      ref = connectorRef(pid, exit);
    }
    if (reached < need - 0.5) return `The ${ORD[n]} track needs ${sq(need)} squares of straight track on the line at each end`;
    // Past it by part of a straight: the rest put back as a shorter straight.
    const spare = Math.round(reached - need);
    if (spare > 0) {
      const type = `straight-${spare}` as PieceTypeId;
      if (!STRAIGHTS.has(spare)) return `The ${ORD[n]} track needs the straights at the ends to stop ${sq(need)} squares from it`;
      pieces.push({ type, pose: side === 0 ? at(-need - spare, 0, 0) : at(DEPOT_LEN + need, 0, 0), y: depot.y, flipped: false });
    }
  }
  const ladderIdx: number[] = pieces.map((_, i) => i);
  const roadIdx: number[] = [];
  const add = (type: PieceTypeId, pose: Pose, flipped: boolean, road = false) => {
    (road ? roadIdx : ladderIdx).push(pieces.length);
    pieces.push({ type, pose, y: depot.y, flipped });
  };
  for (let k = 1; k < n; k++) {
    const line = -(k - 1) * TRACK_GAP;
    const start = -(n - k) * DEPOT_LEN;
    add("crossover", at(start, line, 0), true);
    add("crossover", at(DEPOT_LEN + (n - k) * DEPOT_LEN, line, Math.PI), false);
    // The crossovers' spare ends: buffers.
    add("buffer", at(start, -k * TRACK_GAP, Math.PI), false);
    add("buffer", at(DEPOT_LEN + (n - k) * DEPOT_LEN, -k * TRACK_GAP, 0), false);
    // Straight on along line k−1 between this crossover and the depot's ends.
    for (let i = 0; i < n - k - 1; i++) {
      add("straight-216", at(-(i + 1) * DEPOT_LEN, line, 0), false);
      add("straight-216", at(DEPOT_LEN + i * DEPOT_LEN, line, 0), false);
    }
  }
  for (let j = kept.length + 1; j < n; j++) add("straight-216", at(0, -j * TRACK_GAP, 0), false, true);
  // Room for each piece put down: the game's own rule, the pieces it takes the place of left out.
  const ignore = new Set(covers);
  for (const p of pieces) {
    const why = check(p.type, p.flipped, p.pose, p.y, ignore);
    if (why) return `No room for a ${ORD[n]} track: ${why[0].toLowerCase()}${why.slice(1)}`;
  }
  return { depotPieceId, tracks: n, covers: [...covers], pieces, roads: roadIdx, ladder: ladderIdx, kept };
}

const scratch = createWorldConnector();

/** Note what an upgrade put down (the editor's ids for `plan.pieces`, in order), and give the depot its new roads. */
export function recordTracks(w: Pick<World, "layout" | "economy">, plan: TracksPlan, ids: readonly number[], depot: DepotState): DepotState[] {
  const roads = [...plan.kept, ...plan.roads.map((i) => ids[i])];
  roadsRecord(w).set(plan.depotPieceId, { roads, ladder: plan.ladder.map((i) => ids[i]) });
  return roads.map((id) => w.economy.addRoad(depot, id));
}
