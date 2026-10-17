import type { Pose } from "./math";
import type { ConnectorKind, PieceDef, PieceTypeId } from "./pieces";

/**
 * Track shapes shared by the piece catalogue (`pieces.ts`) and the kit pieces (`kits.ts`), in a module of their own so
 * the kits can build their track with them while `pieces.ts` builds its catalogue from the kits.
 */

export const pose = (x: number, z: number, heading: number): Pose => ({ x, z, heading });

/** A straight `length` long along +x from the origin: a socket at its start and a peg at its far end (by default). */
export function straight(type: PieceTypeId, length: number, a: ConnectorKind = "socket", b: ConnectorKind = "peg", y = 0): PieceDef {
  return {
    type,
    connectors: [
      { kind: a, pose: pose(0, 0, Math.PI), y },
      { kind: b, pose: pose(length, 0, 0), y },
    ],
    paths: [{ from: 0, to: 1, geom: { kind: "line", start: pose(0, 0, 0), length, y0: y, rise: 0 } }],
    flippable: false,
    isSwitch: false,
    supportHeight: 0,
  };
}
