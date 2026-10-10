import { connectorRef, Layout } from "./layout";
import type { PieceTypeId } from "./pieces";
import { appendPiece } from "./snap";

const OVAL: readonly PieceTypeId[] = [
  "curve-large",
  "curve-large",
  "curve-large",
  "straight-216",
  "curve-large",
  "curve-large",
  "curve-large",
  "curve-large",
  "straight-216",
];
const SPACING = 900;

/** Deterministic large layout for benchmarks and device testing: a grid of closed ovals plus loose straights. */
export function buildStressLayout(ovalCount: number): { layout: Layout; looseSockets: number[] } {
  const layout = new Layout();
  const looseSockets: number[] = [];
  const cols = Math.ceil(Math.sqrt(ovalCount));
  for (let i = 0; i < ovalCount; i++) {
    const ox = (i % cols) * SPACING;
    const oz = Math.floor(i / cols) * SPACING;
    let last = layout.addPiece("curve-large", { x: ox, z: oz, heading: 0 });
    for (const type of OVAL) last = appendPiece(layout, type, false, connectorRef(last, 1));
    const loose = layout.addPiece("straight-144", { x: ox + 300, z: oz + 150, heading: 0 });
    looseSockets.push(connectorRef(loose, 0));
  }
  return { layout, looseSockets };
}
