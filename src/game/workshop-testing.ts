import { CARGO, type CargoKind } from "../economy/cargo";
import { WAGON_CAPACITY } from "../economy/constants";
import { SIM_HZ, type CarKind } from "../sim";
import type { PieceTypeId } from "../track";
import { shopOwes } from "./crafting";
import type { Progress } from "./progress";
import { syncIndustries, type World } from "./world";

// Helpers for the tests of what the workshop takes from trains (not part of the game).

/** Game mode's say in what the workshop takes only while owed (stone, iron): as main.ts sets it. */
export function owesAsTheGameDoes(w: World, p: Progress): void {
  w.economy.owes = (kind) => shopOwes(w, p, kind);
}

/**
 * The player's way to get stone into the workshop: a goods train of hoppers holding `units` of `kind` (3 a wagon),
 * run along a line laid through the workshop's piece (straights either side, heading as it does), its crane
 * unloading what the workshop takes. Returns how many are still on the train when it has run its line
 * (the train is then taken off the map). `ahead`: the 216 mm pieces laid on past the workshop, when the line is laid
 * (its first train): two straights, or a school and more (their depots added as the game adds them).
 */
/** Each map's lines laid through a workshop: the piece its trains start on, by the workshop's piece. */
const lines = new WeakMap<object, Map<number, number>>();

export function deliverByTrain(w: World, shopPiece: number, kind: CargoKind, units: number, seconds = 120, ahead: readonly PieceTypeId[] = ["straight-216", "straight-216"]): number {
  const at = w.layout.getPiece(shopPiece)!.pose;
  const c = Math.cos(at.heading);
  const s = Math.sin(at.heading);
  const along = (k: number) => ({ x: at.x + c * 216 * k, z: at.z + s * 216 * k, heading: at.heading });
  // (Laid once per workshop: a later train runs the same line.)
  let start = lines.get(w.layout)?.get(shopPiece);
  if (start === undefined) {
    const before = [-6, -5, -4, -3, -2, -1].map((k) => w.layout.addPiece("straight-216", along(k)));
    ahead.forEach((t, k) => w.layout.addPiece(t, along(k + 1)));
    if (ahead.some((t) => t.startsWith("depot-"))) syncIndustries(w, true);
    start = before[before.length - 1];
    if (!lines.has(w.layout)) lines.set(w.layout, new Map());
    lines.get(w.layout)!.set(shopPiece, start);
  }
  const wagons = Math.ceil(units / WAGON_CAPACITY);
  const cars: CarKind[] = ["engine", ...Array<CarKind>(wagons).fill(kind === "planks" || kind === "iron" || kind === "log" ? "timber" : "hopper")];
  const placed = w.sim.addTrain(cars, { pieceId: start, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room for the train");
  const train = w.sim.getTrain(placed.trainId)!;
  let left = units;
  for (const car of train.cars.slice(1)) {
    const n = Math.min(WAGON_CAPACITY, left);
    w.economy.setCargo(car.id, kind, n);
    left -= n;
  }
  w.sim.setLever(train.cars[0].id, 1);
  for (let t = 0; t < seconds * SIM_HZ; t++) {
    w.sim.tick();
    w.economy.tick();
  }
  const carIds = train.cars.map((car) => car.id);
  const still = carIds.reduce((n, id) => n + (w.economy.cargoOf(id).kind === kind ? w.economy.cargoOf(id).count : 0), 0);
  // (By its cars: the sim may have given the train a new id on the way.)
  for (const id of new Set(carIds.map((c) => w.sim.findCar(c)?.train.id))) if (id !== undefined) w.sim.removeTrain(id);
  return still;
}

/** What the workshops' yards hold of `kind`. */
export function inYards(w: World, kind: CargoKind): number {
  return w.economy.allDepots().reduce((n, d) => n + (d.role === "workshop" ? d.piles[CARGO[kind].index] : 0), 0);
}
