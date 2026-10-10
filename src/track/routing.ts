import { connectorRef, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { getPieceDef, type PieceDef } from "./pieces";

export interface RouteStep {
  pieceId: number;
  pathIndex: number;
  /** True when travelling from the path's `to` end toward its `from` end. */
  reversed: boolean;
}

export const createRouteStep = (): RouteStep => ({ pieceId: 0, pathIndex: 0, reversed: false });

/**
 * Where does a train go after leaving `pieceId` through `connectorIndex`?
 * Writes into `out` and returns true, or returns false at an open end. No allocation.
 */
export function routeFrom(layout: Layout, pieceId: number, connectorIndex: number, out: RouteStep): boolean {
  const joined = layout.joinedConnector(connectorRef(pieceId, connectorIndex));
  if (joined === -1) return false;
  const nextId = pieceOfRef(joined);
  const entry = indexOfRef(joined);
  const piece = layout.getPiece(nextId)!;
  const paths = getPieceDef(piece.type, piece.flipped).paths;

  let count = 0;
  for (let i = 0; i < paths.length; i++) if (paths[i].from === entry || paths[i].to === entry) count++;
  if (count === 0) return false;

  const pick = count === 1 ? 0 : layout.switchState(nextId) % count;
  let seen = 0;
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (p.from !== entry && p.to !== entry) continue;
    if (seen++ !== pick) continue;
    out.pieceId = nextId;
    out.pathIndex = i;
    out.reversed = p.to === entry;
    return true;
  }
  return false;
}

/** Connector index a train leaves through, or -1 if the path ends at a buffer. */
export function pathExitConnector(def: PieceDef, pathIndex: number, reversed: boolean): number {
  const p = def.paths[pathIndex];
  if (reversed) return p.from;
  return p.to ?? -1;
}
