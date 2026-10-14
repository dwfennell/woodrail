import { connectorRef, indexOfRef, pieceOfRef, type Layout } from "./layout";
import { getPieceDef } from "./pieces";

/** The most pieces a pulled run carries along one way. */
const MAX_RUN = 60;

/**
 * The track that comes along when a placed piece is pulled a little, as a line of wooden track does: from the piece,
 * along each of its ends, the plain pieces joined one after another (two ends each), up to a switch, a piece that
 * stays put (`stops`: a station, a depot, track under a train), or a free end. Each way that ends free is a tail that
 * follows the pull rigidly (`followers`); a way that ends at something that stays put bends instead (`benders`).
 * A loop back to the piece bends.
 */
export function runOf(layout: Layout, pieceId: number, stops: (id: number) => boolean): { followers: number[]; benders: number[] } {
  const piece = layout.getPiece(pieceId);
  if (!piece) return { followers: [], benders: [] };
  const followers: number[] = [];
  const benders: number[] = [];
  const count = getPieceDef(piece.type, piece.flipped).connectors.length;
  for (let k = 0; k < count; k++) {
    const way: number[] = [];
    let free = false;
    let ref = connectorRef(pieceId, k);
    for (let n = 0; n < MAX_RUN; n++) {
      const next = layout.joinedConnector(ref);
      if (next === -1) {
        free = true;
        break;
      }
      const id = pieceOfRef(next);
      if (id === pieceId || stops(id) || way.includes(id)) break;
      const p = layout.getPiece(id)!;
      const ends = getPieceDef(p.type, p.flipped).connectors.length;
      // A switch (or crossing) is where lines meet: the run stops before it.
      if (ends !== 2) break;
      way.push(id);
      // On along it: out through its other end.
      ref = connectorRef(id, 1 - indexOfRef(next));
    }
    (free ? followers : benders).push(...way);
  }
  return { followers, benders };
}
