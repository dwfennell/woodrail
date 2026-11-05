import { connectorRef, createSample, getPieceDef, indexOfRef, pathLength, pieceOfRef, samplePath, transformPose, type Layout, type PieceDef, type Pose } from "../track";

/**
 * Turntable controls (tech-tree T5, docs/superpowers/specs/2026-10-31-tech-tree.md): "Tap a road and the turntable turns
 * to it." Which road of which deck a tap means: on a deck's piece, the road whose end is nearest the tap (a tap on its
 * hub, the middle, still steps the deck round, as before); on track joined to a deck's end (a stall's road, a line
 * leading off), that end's road. A deck is a turntable's or a transfer table's (`PieceDef.gated`), not a lift.
 */
/** The blueprint that brings them. */
export const TURNTABLE_CONTROLS = "turntable-controls";

export interface DeckRoad {
  /** The deck's piece. */
  readonly deck: number;
  /** The road (the deck's path) to turn it to. */
  readonly road: number;
}

/** A tap this near a deck's middle, as a share of how far its ends are from it, is on its hub (it steps round). */
export const DECK_HUB = 0.35;
/** A tap on track joined to a deck counts only this near (mm) the road it's on. */
export const ROAD_REACH = 40;

const isDeck = (def: PieceDef): boolean => !!def.gated && !def.lift;

/** The road (path) of a deck that has end `end`, or −1. */
function roadAt(def: PieceDef, end: number): number {
  return def.paths.findIndex((p) => p.from === end || p.to === end);
}

const on: Pose = { x: 0, z: 0, heading: 0 };
const sample = createSample();

/** How far (mm) world point (x, z) is from a path of a piece standing at `at` (sampled every 8 mm). */
function offPath(geom: PieceDef["paths"][number]["geom"], at: Pose, x: number, z: number): number {
  const len = pathLength(geom);
  const n = Math.max(1, Math.ceil(len / 8));
  let best = Infinity;
  for (let k = 0; k <= n; k++) {
    samplePath(geom, (len * k) / n, sample);
    transformPose(at, { x: sample.x, z: sample.z, heading: 0 }, on);
    best = Math.min(best, Math.hypot(x - on.x, z - on.z));
  }
  return best;
}

/** The deck and road a tap at world (x, z) on piece `pieceId` means (see `DeckRoad`), or null: not one, or a hub tap. */
export function deckRoadAt(layout: Layout, pieceId: number, x: number, z: number): DeckRoad | null {
  const p = layout.getPiece(pieceId);
  if (!p) return null;
  const def = getPieceDef(p.type, p.flipped);
  if (isDeck(def)) {
    // (Its ends round its middle: the nearest to the tap, unless the tap is on the hub.)
    let cx = 0;
    let cz = 0;
    const ends = def.connectors.map((c) => transformPose(p.pose, c.pose, { x: 0, z: 0, heading: 0 }));
    for (const e of ends) {
      cx += e.x / ends.length;
      cz += e.z / ends.length;
    }
    const reach = ends.reduce((s, e) => s + Math.hypot(e.x - cx, e.z - cz), 0) / ends.length;
    if (Math.hypot(x - cx, z - cz) < reach * DECK_HUB) return null;
    let best = -1;
    let bestD = Infinity;
    ends.forEach((e, k) => {
      const d = Math.hypot(x - e.x, z - e.z);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    const road = best === -1 ? -1 : roadAt(def, best);
    return road === -1 ? null : { deck: pieceId, road };
  }
  // Track joined to a deck's end: the road it's on, if the tap is on it.
  let found: DeckRoad | null = null;
  let foundD = ROAD_REACH;
  for (let i = 0; i < def.connectors.length; i++) {
    const joined = layout.joinedConnector(connectorRef(pieceId, i));
    if (joined === -1) continue;
    const deckPiece = layout.getPiece(pieceOfRef(joined));
    if (!deckPiece) continue;
    const dd = getPieceDef(deckPiece.type, deckPiece.flipped);
    if (!isDeck(dd)) continue;
    const road = roadAt(dd, indexOfRef(joined));
    if (road === -1) continue;
    // (Which of its roads leads there: a roundhouse's stalls fan out from the pit, a tap is on one of them.)
    for (const path of def.paths) {
      if (path.from !== i && path.to !== i) continue;
      const d = offPath(path.geom, p.pose, x, z);
      if (d < foundD) {
        foundD = d;
        found = { deck: pieceOfRef(joined), road };
      }
    }
  }
  return found;
}

/** Does the deck of `r` lie along its road now (so a tap there has nothing to turn)? */
export function deckLiesAlong(layout: Layout, r: DeckRoad): boolean {
  const p = layout.getPiece(r.deck);
  if (!p) return true;
  const n = getPieceDef(p.type, p.flipped).paths.length;
  return layout.switchState(r.deck) % n === r.road;
}
