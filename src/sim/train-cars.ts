/**
 * Small questions about a train's cars, asked all over the game: which way its engines drive it, its length, the car
 * that names it, whether it has an engine. One copy each (before, the net drive alone was written out eleven times).
 */
import { CAR_SPECS, COUPLER_GAP } from "./cars";
import type { Train } from "./sim";

/** A train's net drive toward its front, from its engines' levers: + its front, − its back, 0 not at all. */
export function driveOf(t: Train): number {
  let net = 0;
  for (const car of t.cars) if (car.kind === "engine") net += car.lever * car.facing;
  return net;
}

/** A train's length (mm), buffer face to buffer face: its cars and the couplings between them. */
export function trainLength(t: Train): number {
  let len = 0;
  for (const c of t.cars) len += CAR_SPECS[c.kind].length;
  return len + COUPLER_GAP * Math.max(0, t.cars.length - 1);
}

/** A train's name for waits and cards: its first engine's car id (else its first car's; −1 with no cars). */
export function engineOf(t: Train): number {
  for (const c of t.cars) if (c.kind === "engine") return c.id;
  return t.cars[0]?.id ?? -1;
}

/** Has the train an engine? */
export function hasEngine(t: Train): boolean {
  for (const c of t.cars) if (c.kind === "engine") return true;
  return false;
}
