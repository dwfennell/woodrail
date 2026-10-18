import type { CargoKind, CargoSlot } from "../economy";

/** How close (mm, on the ground) a dropped unit must land to a pile to go onto it. */
export const PILE_DROP_RANGE = 70;

export interface CargoDropInput {
  kind: CargoKind;
  from: CargoSlot;
  /** Ground point under the pointer. */
  x: number;
  z: number;
  /** A car under the pointer, or −1. */
  carId: number;
  piles: readonly { depotId: number; cargo: CargoKind; x: number; z: number }[];
  carAccepts(carId: number, kind: CargoKind): boolean;
  pileAccepts(depotId: number, kind: CargoKind): boolean;
}

/**
 * Where a unit carried by hand goes when it's let go: a wagon under the pointer that can take it, else the nearest
 * pile of that cargo within reach that has room. Null sends it back where it came from.
 */
export function cargoDropTarget(d: CargoDropInput): CargoSlot | null {
  const sameAsFrom = (s: CargoSlot) =>
    (s.kind === "car" && d.from.kind === "car" && s.carId === d.from.carId) ||
    (s.kind === "pile" && d.from.kind === "pile" && s.depotId === d.from.depotId && s.cargo === d.from.cargo);
  if (d.carId !== -1) {
    const slot: CargoSlot = { kind: "car", carId: d.carId };
    if (!sameAsFrom(slot) && d.carAccepts(d.carId, d.kind)) return slot;
  }
  let best: CargoSlot | null = null;
  let bestD = PILE_DROP_RANGE;
  for (const p of d.piles) {
    if (p.cargo !== d.kind) continue;
    const dist = Math.hypot(p.x - d.x, p.z - d.z);
    const slot: CargoSlot = { kind: "pile", depotId: p.depotId, cargo: p.cargo };
    if (dist < bestD && !sameAsFrom(slot) && d.pileAccepts(p.depotId, d.kind)) {
      best = slot;
      bestD = dist;
    }
  }
  return best;
}

/**
 * Was a unit with nowhere to go (`cargoDropTarget` null) let go back on what it came from (the wagon it was lifted off,
 * or within reach of its own pile)? Then it's simply put back, with no "this goes on…" to say.
 */
export function putsBack(d: Pick<CargoDropInput, "from" | "x" | "z" | "carId" | "piles">): boolean {
  const from = d.from;
  if (from.kind === "car") return d.carId === from.carId;
  return d.piles.some((p) => p.depotId === from.depotId && p.cargo === from.cargo && Math.hypot(p.x - d.x, p.z - d.z) < PILE_DROP_RANGE);
}
