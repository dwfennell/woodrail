import {
  BLOCK_MESSAGES,
  bridgeLevels,
  checkPlacement,
  checkSupport,
  cutUndermines,
  hillMessage,
  levelsAbove,
  levelsOver,
  type BlockReason,
  type Landscape,
  type RiserPlacement,
} from "../landscape";
import { pieceHitsProp, type Footprint } from "../props/placement";
import type { PropStore } from "../props/store";
import { findLowCrossing, findOverlap, RISER_HEIGHT, type Ignore, type Layout, type PlacedPiece, type PieceTypeId, type Pose } from "../track";

/**
 * The rules every track piece is put down by, wherever it comes from (a piece in the hand, a drawn line, and later
 * bridges, tunnels and crossing props): the reason codes a refusal gives (`BlockReason`), with nothing of the input
 * that asked. A mode's own rules (a depot's yard, an industry's site) sit on top of these, in `Interaction`.
 */
export interface TrackRules {
  readonly land: Landscape;
  readonly layout: Layout;
  /** Props on the map (track is refused through them), or null for none. */
  readonly props: PropStore | null;
  /** Footprints of props' models built so far (a prop whose model isn't built yet doesn't block). */
  footprint(asset: string): Footprint | undefined;
}

/** Why a piece can't go here (the landscape, another piece, a prop, or a cutting under other track), or null. */
export function trackBlock(r: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): BlockReason | null {
  const c = checkPlacement(r.land, type, flipped, pose, y);
  if (c.kind === "blocked") return c.reason;
  // Bridges' and raised ramps' arches are solid down to the ground (but for their openings).
  const arches = { mine: bridgeLevels(r.land, type, flipped, pose, y) * RISER_HEIGHT, of: (p: PlacedPiece) => bridgeLevels(r.land, p.type, p.flipped, p.pose, p.y) * RISER_HEIGHT };
  if (findOverlap(r.layout, type, flipped, pose, y, ignoreId, arches) !== -1) return "piece";
  if (findLowCrossing(r.layout, type, flipped, pose, y, ignoreId) !== -1) return "headroom";
  if (r.props && pieceHitsProp(r.props, r.footprint, type, flipped, pose)) return "prop";
  // A ramp cutting into a hill mustn't take the ground from under other track.
  return cutUndermines(r.land, r.layout, type, flipped, pose, y, ignoreId) === -1 ? null : "undercut";
}

/** What holds a piece up here: null and the risers to add under ends in the air, or why not (nothing under an end, or no room for its risers). */
export function trackSupport(r: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): { reason: BlockReason | null; risers: RiserPlacement[] } {
  const s = checkSupport(r.land, r.layout, type, flipped, pose, y, ignoreId);
  if (s.kind === "unsupported") return { reason: "unsupported", risers: [] };
  for (const riser of s.risers) {
    const why = trackBlock(r, "riser", false, riser.pose, riser.y, ignoreId);
    if (why) return { reason: why, risers: [] };
  }
  return { reason: null, risers: s.risers };
}

/** `trackBlock`, then `trackSupport`: the track's own rules, without a mode's. */
export function trackPlacement(r: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignoreId: Ignore): { reason: BlockReason | null; risers: RiserPlacement[] } {
  const reason = trackBlock(r, type, flipped, pose, y, ignoreId);
  return reason ? { reason, risers: [] } : trackSupport(r, type, flipped, pose, y, ignoreId);
}

/** The message for a track rule's refusal; a hill says how far up it is (`levels`, from `levelsAbove`). */
export function trackMessage(reason: BlockReason, levels = 1): string {
  return reason === "hill" ? hillMessage(levels) : BLOCK_MESSAGES[reason];
}

/**
 * What a drawn line says at a hill two or more levels up: a drawn line climbs one level at a time (a ramp, then on
 * along the hilltop), so it can't go up there itself. (A piece in the hand is told to climb with ramps in a row:
 * see `hillMessage`.)
 */
export function drawHillMessage(levels: number): string {
  const words = ["", "one", "two", "three", "four"];
  return `Too steep to draw: ${words[levels] ?? levels} levels up. Lay a ramp first, then draw on`;
}

/** The message for a drawn piece's refusal: as a held piece's (`message`), but for a hill too high for the line to climb. */
export function drawMessage(reason: string, levels: number, message: (reason: string) => string): string {
  return reason === "hill" && levels >= 2 ? drawHillMessage(levels) : message(reason);
}

/** A drawn piece's refusal as the line reads it: the reason code, and how many levels it's about (see `drawRefusal`). */
export interface DrawRefusal {
  readonly reason: string;
  readonly levels: number;
}

/**
 * A piece of a drawn line refused (`reason`, or risers it'd need: a drawn line puts in none, so that's
 * "unsupported"), as the line reads it to choose a special piece (see `DrawLine`): for a hill, how many levels up it
 * is (`levelsAbove`: a ramp climbs one); for a river or nothing underneath, how many whole levels the piece stands
 * above the ground under it (`levelsOver`: a bridge needs at least one). Null if it may go. Worked out only on a
 * refusal, so a line on open ground pays nothing for it.
 */
export function drawRefusal(land: Landscape, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, reason: string | null, risers: readonly unknown[]): DrawRefusal | null {
  const why = reason ?? (risers.length > 0 ? "unsupported" : null);
  if (!why) return null;
  if (why === "hill") return { reason: why, levels: levelsAbove(land, type, flipped, pose, y) };
  if (why === "river" || why === "unsupported") return { reason: why, levels: levelsOver(land, type, flipped, pose, y) };
  return { reason: why, levels: 0 };
}
