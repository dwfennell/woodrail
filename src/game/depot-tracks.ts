import type { Bag } from "../economy/goods";
import type { DepotRole, DepotState } from "../economy";
import { DOUBLE_TRACK_SPACING, transformPose, type Ignore, type PieceTypeId, type Pose } from "../track";
import type { World } from "./world";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): an industry upgraded from its card to two, then
 * three tracks side by side. The card lays only the extra track, beside its own on the side away from its yard, a
 * double track (72 mm) apart, its ends left open: the second 648 long (a straight of the yard's length, 216, under the
 * crane and one on past each end, `TRACK_END`), the third the yard's length beside the second. The player joins it
 * however they like: a Split dragged from the tray onto the line at each end of the second (onto the second's ends,
 * for the third) splices in there and joins it exactly. One undo step
 * (`Editor.replaceRun`, in a group with the record and the price). Each extra track is the depot to the economy
 * (`Economy.setTracks`) once a train can reach it (`Economy.reachableTracks`); its one crane, its gantry spanning them
 * all, serves each track's train in turn.
 *
 * Older saves' tracks, laid with a ladder of crossovers and buffers to the line (before 2026-11-16), keep it.
 */

/** The most tracks a depot has. */
export const MAX_TRACKS = 3;
/** Tracks of a depot of several lie this far apart (mm), on the side away from its yard (a double track apart). */
export const TRACK_GAP = DOUBLE_TRACK_SPACING;
const DEPOT_LEN = 216;
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

type Part = "road" | "end";

/** An upgrade worked out: the piece put down, and the record kept. */
export interface TracksPlan {
  readonly depotId: number;
  readonly depotPieceId: number;
  readonly tracks: 2 | 3;
  /** None: the track goes down beside the yard, nothing taken up. */
  readonly covers: readonly number[];
  readonly pieces: readonly NewPiece[];
  /** Of each piece put down: a new track's middle (its crane's), or one of its ends. */
  readonly parts: readonly Part[];
  /** The tracks already there, kept: their middles, and an older save's ends and ladder. */
  readonly keptRoads: readonly number[];
  readonly keptEnds: readonly number[];
  readonly keptLadder: readonly number[];
}

/** Why a piece can't go there, in words (the game's own drop rule), ignoring the pieces in `ignore`; null if it can. */
export type PlaceCheck = (type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore) => string | null;

const ORD = ["", "", "second", "third"];
/** A further track: a straight under the crane (the yard's length), and one on past each end of the yard. */
const ROAD: PieceTypeId = "straight-216";
/** How far the second track runs on past each end of the yard (mm): a Split's length, so one spliced into the line at
 * each end of it joins it, and it runs 648 clear of points. */
export const TRACK_END = 216;

/**
 * Can depot `depot` have one more track, and how: the plan, or why not in words. The new track goes beside the last,
 * at the yard's level; the game's drop rule says whether its spot is clear. Cheap (one piece), run for the card when
 * the track, the land or the workshop's stock change, not per frame.
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
  const keptRoads = w.economy.roadsOf(depot.id).map((r) => r.pieceId);
  const l = -(n - 1) * TRACK_GAP;
  const at = (t: number): Pose => ({ ...transformPose(piece.pose, { x: t, z: l, heading: 0 }, { x: 0, z: 0, heading: 0 }) });
  // The second runs on past the yard so Splits on the line join it; the third is the yard's length, so Splits in
  // place of the second's ends join it (a train longer than 216 loads at it where it stands).
  const pieces: NewPiece[] =
    n === 2
      ? [
          { type: ROAD, pose: at(-TRACK_END), y: piece.y, flipped: false },
          { type: ROAD, pose: at(0), y: piece.y, flipped: false },
          { type: ROAD, pose: at(DEPOT_LEN), y: piece.y, flipped: false },
        ]
      : [{ type: ROAD, pose: at(0), y: piece.y, flipped: false }];
  const ignore = new Set<number>();
  for (const p of pieces) {
    const no = check(p.type, p.flipped, p.pose, p.y, ignore);
    if (no) return `No room for a ${ORD[n]} track: ${no[0].toLowerCase()}${no.slice(1)}`;
  }
  return { depotId: depot.id, depotPieceId: depot.pieceId, tracks: n, covers: [], pieces, parts: pieces.length === 3 ? ["end", "road", "end"] : ["road"], keptRoads, keptEnds: live(rec?.ends), keptLadder: live(rec?.ladder) };
}

/** The depot's tracks as a plan leaves them (the editor's ids for `plan.pieces`, in order): for `Economy.setTracks`. */
export function tracksAfter(plan: TracksPlan, ids: readonly number[]): { roads: number[]; ends: number[]; ladder: number[] } {
  const of = (part: Part) => plan.parts.flatMap((p, i) => (p === part ? [ids[i]] : []));
  return { roads: [...plan.keptRoads, ...of("road")], ends: [...plan.keptEnds, ...of("end")], ladder: [...plan.keptLadder] };
}
