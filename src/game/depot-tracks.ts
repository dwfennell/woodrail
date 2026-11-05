import type { Bag } from "../economy/goods";
import type { DepotRole, DepotState } from "../economy";
import { connectorRef, createWorldConnector, DOUBLE_TRACK_SPACING, getPieceDef, indexOfRef, isPlainStraight, pieceOfRef, straightLength, transformPose, type Ignore, type PieceTypeId, type Pose } from "../track";
import type { World } from "./world";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): an industry upgraded from its card to two, then
 * three tracks side by side. The extra tracks lie beside its own on the side away from its yard, a double track (72 mm)
 * apart, joined to the line at both ends by a ladder of crossovers laid in place of the plain straights there (and a
 * buffer on each crossover's spare end): one undo step (`Editor.replaceRun`, in a group with the record and the price).
 * Each extra track is the depot to the economy (`Economy.setTracks`); its one crane, its gantry spanning them all,
 * serves each track's train in turn.
 *
 * In the depot's frame (t along its track from its first end, l across, +l the yard's side), for `n` tracks: every
 * track runs from t = −`END` to 216 + `END` (the depot's own track has a straight of `END` added at each end), 432 mm,
 * long enough for an engine and three wagons to stand clear of the ladder. Crossover k (1 … n−1) joins line k−1
 * (l = −(k−1)·72) to line k over t ∈ [−END − (n−k)·216, −END − (n−k−1)·216], flipped (its link to −l); at the far end
 * the same turned round. So each end needs (n−1)·216 + END mm of straight on the line.
 */

/** The most tracks a depot has. */
export const MAX_TRACKS = 3;
/** Tracks lie this far apart (mm). */
export const TRACK_GAP = DOUBLE_TRACK_SPACING;
/** A depot's piece is a 216 straight; its tracks run on this far past each of its ends (mm). */
const DEPOT_LEN = 216;
export const END = 108;
/** The research that brings them. */
export const TRACKS_TECH = "sidings";

/** What each further track costs, taken from the workshops' piles: the 2nd, the 3rd. */
export const TRACK_PRICES: Readonly<Record<2 | 3, Bag>> = { 2: { planks: 10 }, 3: { planks: 12, stone: 10 } };

/**
 * Which depots can have more tracks: every industry a train loads or unloads at by crane. Not a town's station (it
 * has big stations), a school (a few research loads), nor a Sandbox loader (a kit).
 */
export const TRACK_ROLES: ReadonlySet<DepotRole> = new Set<DepotRole>(["forest", "sawmill", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", "dairy", "bakery", "orchard", "juicer", "creamery", "icecream", "brickworks", "carworks", "oilwell", "waterpump", "beetfield", "jamworks", "chocworks", "flowerfield", "dyeworks", "toyworks"]);

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
  /** Of each piece put down: a new track's middle (its crane's), a new track's end piece, or the ladder's. */
  readonly parts: readonly Part[];
  /** The tracks already laid, kept: their middles and their end pieces. */
  readonly keptRoads: readonly number[];
  readonly keptEnds: readonly number[];
}

/** Why a piece can't go there, in words (the game's own drop rule), ignoring the pieces in `ignore`; null if it can. */
export type PlaceCheck = (type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore) => string | null;

/** Plain straights there are, by length (mm). */
const STRAIGHTS = new Set([36, 54, 72, 90, 108, 126, 144, 162, 180, 198, 216, 288]);
const ORD = ["", "", "second", "third"];
/** In squares, as a child would count them ("4½"). */
const squares = (mm: number) => {
  const h = Math.round(mm / 36) / 2;
  return Number.isInteger(h) ? String(h) : `${Math.floor(h)}½`;
};
const scratch = createWorldConnector();

/**
 * Can depot `depot` have one more track, and how: the plan, or why not in words. Walks the line out from both ends of
 * the depot for the straight track the ladder takes the place of; asks the game's drop rule for every piece put down.
 * Cheap enough for a card (a few pieces), not run per frame.
 */
export function planTracks(w: Pick<World, "layout" | "sim" | "economy">, depot: DepotState, check: PlaceCheck): TracksPlan | string {
  const layout = w.layout;
  const piece = layout.getPiece(depot.pieceId);
  if (!piece) return "It isn't on the map";
  const have = w.economy.trackCount(depot.id);
  if (have >= MAX_TRACKS) return `It has ${MAX_TRACKS} tracks already`;
  const n = (have + 1) as 2 | 3;
  const rec = w.economy.tracksOf(depot.id);
  const live = (ids: readonly number[] | undefined) => (ids ?? []).filter((id) => !!layout.getPiece(id));
  const ladder = new Set(live(rec?.ladder));
  const keptRoads = w.economy.roadsOf(depot.id).map((r) => r.pieceId);
  const keptEnds = live(rec?.ends);
  const need = (n - 1) * DEPOT_LEN + END;
  const covers = new Set<number>(ladder);
  const pieces: NewPiece[] = [];
  const parts: Part[] = [];
  const out = { x: 0, z: 0, heading: 0 };
  const at = (t: number, l: number, h: number): Pose => ({ ...transformPose(piece.pose, { x: t, z: l, heading: h }, out) });
  const add = (type: PieceTypeId, pose: Pose, flipped: boolean, part: Part = "ladder") => {
    pieces.push({ type, pose, y: piece.y, flipped });
    parts.push(part);
  };
  const c = Math.cos(piece.pose.heading);
  const s = Math.sin(piece.pose.heading);
  const words = `The ${ORD[n]} track needs ${squares(need)} squares of straight track on the line at each end`;
  // The line each way: plain straights (or the ladder's own pieces on it), in line with the depot, `need` long.
  for (const side of [0, 1] as const) {
    let ref = connectorRef(depot.pieceId, side);
    let reached = 0;
    for (let guard = 0; guard < 40 && reached < need - 0.5; guard++) {
      const other = layout.joinedConnector(ref);
      // (No track joined there yet, or what's there stops short. QA 2026-11-05 #6: "the line ends" said neither.)
      if (other === -1) return `${words}: ${guard === 0 ? "lay track there first" : "the track stops short there"}`;
      const pid = pieceOfRef(other);
      const p = layout.getPiece(pid);
      if (!p) return words;
      if (Math.abs(p.y - piece.y) > 0.5) return `${words}: it climbs`;
      const def = getPieceDef(p.type, p.flipped);
      const entry = indexOfRef(other);
      let exit = -1;
      if (isPlainStraight(p.type) && straightLength(p.type, p.flipped) > 0) exit = entry === 0 ? 1 : 0;
      else if (ladder.has(pid) && p.type === "crossover") exit = entry === 1 ? 0 : entry === 0 ? 1 : -1;
      if (exit === -1) return `${words}: ${def.isSwitch ? "there are points" : "it bends"} in the way`;
      if (w.sim.pieceOccupied(pid)) return "A train is standing on the line beside it: move it first";
      covers.add(pid);
      const wc = layout.worldConnector(connectorRef(pid, exit), scratch);
      const dx = wc.x - piece.pose.x;
      const dz = wc.z - piece.pose.z;
      const t = c * dx + s * dz;
      if (Math.abs(-s * dx + c * dz) > 1) return `${words}: it bends`;
      reached = side === 0 ? -t : t - DEPOT_LEN;
      ref = connectorRef(pid, exit);
    }
    if (reached < need - 0.5) return words;
    // Past it by part of a straight: the rest put back as a shorter straight.
    const spare = Math.round(reached - need);
    if (spare > 0) {
      if (!STRAIGHTS.has(spare)) return `The ${ORD[n]} track needs the straights to end ${squares(need)} squares from it`;
      add(`straight-${spare}` as PieceTypeId, side === 0 ? at(-need - spare, 0, 0) : at(DEPOT_LEN + need, 0, 0), false);
    }
  }
  // The depot's own track on past its ends.
  add("straight-108", at(-END, 0, 0), false);
  add("straight-108", at(DEPOT_LEN, 0, 0), false);
  for (let k = 1; k < n; k++) {
    const line = -(k - 1) * TRACK_GAP;
    const near = -END - (n - k) * DEPOT_LEN;
    const far = DEPOT_LEN + END + (n - k) * DEPOT_LEN;
    add("crossover", at(near, line, 0), true);
    add("crossover", at(far, line, Math.PI), false);
    // The crossovers' spare ends: buffers.
    add("buffer", at(near, -k * TRACK_GAP, Math.PI), false);
    add("buffer", at(far, -k * TRACK_GAP, 0), false);
    // Straight on along line k−1 between this crossover and the tracks' ends.
    for (let i = 0; i < n - k - 1; i++) {
      add("straight-216", at(-END - (i + 1) * DEPOT_LEN, line, 0), false);
      add("straight-216", at(DEPOT_LEN + END + i * DEPOT_LEN, line, 0), false);
    }
  }
  // The new track: a 216 under the crane, and an end piece either side.
  for (let j = keptRoads.length + 1; j < n; j++) {
    add("straight-108", at(-END, -j * TRACK_GAP, 0), false, "end");
    add("straight-216", at(0, -j * TRACK_GAP, 0), false, "road");
    add("straight-108", at(DEPOT_LEN, -j * TRACK_GAP, 0), false, "end");
  }
  // Room for each piece put down: the game's own rule, the pieces it takes the place of left out.
  const ignore = new Set(covers);
  for (const p of pieces) {
    const why = check(p.type, p.flipped, p.pose, p.y, ignore);
    if (why) return `No room for a ${ORD[n]} track: ${why[0].toLowerCase()}${why.slice(1)}`;
  }
  return { depotId: depot.id, depotPieceId: depot.pieceId, tracks: n, covers: [...covers], pieces, parts, keptRoads, keptEnds };
}

/** The depot's tracks as a plan leaves them (the editor's ids for `plan.pieces`, in order): for `Economy.setTracks`. */
export function tracksAfter(plan: TracksPlan, ids: readonly number[]): { roads: number[]; ends: number[]; ladder: number[] } {
  const of = (part: Part) => plan.parts.flatMap((p, i) => (p === part ? [ids[i]] : []));
  return { roads: [...plan.keptRoads, ...of("road")], ends: [...plan.keptEnds, ...of("end")], ladder: of("ladder") };
}
