import { ENGINE_SPEED, type CarLook, type Train } from "../sim";
import type { World } from "./world";

/**
 * Game mode's engines: each kind pulls so many cars, at its own speed, and gets going (and stops) at its own pace. Two
 * engines on a train pull both their loads, at the slower one's speed. A train too heavy for its engines won't move.
 */
export interface EngineKind {
  readonly label: string;
  /** Cars it can pull (engines aside). */
  readonly pulls: number;
  /** Top speed, against the classic engine's. */
  readonly speed: number;
  /** How quickly it gets going and stops, against the classic engine's. */
  readonly quick: number;
}

export const ENGINES: Partial<Record<CarLook, EngineKind>> = {
  classic: { label: "engine", pulls: 4, speed: 1, quick: 1 },
  tank: { label: "tank engine", pulls: 3, speed: 1, quick: 2 },
  diesel: { label: "diesel", pulls: 6, speed: 1.2, quick: 1 },
  electric: { label: "electric engine", pulls: 6, speed: 1.4, quick: 1.2 },
  express: { label: "express engine", pulls: 4, speed: 1.5, quick: 1 },
};

const engineOf = (world: World, carId: number): EngineKind => ENGINES[world.sim.lookOf(carId)] ?? ENGINES.classic!;

/** What a train's engines can pull, how many cars it has (engines aside), and its engines. */
export function load(world: World, train: Train): { pulls: number; cars: number; engines: EngineKind[] } {
  const engines = train.cars.filter((c) => c.kind === "engine").map((c) => engineOf(world, c.id));
  return { pulls: engines.reduce((n, e) => n + e.pulls, 0), cars: train.cars.length - engines.length, engines };
}

/** A train's top speed (mm/s): its slowest engine's; 0 if it's too heavy for its engines. */
export function topSpeed(world: World, train: Train): number {
  const l = load(world, train);
  if (l.engines.length === 0) return ENGINE_SPEED;
  if (l.cars > l.pulls) return 0;
  return ENGINE_SPEED * Math.min(...l.engines.map((e) => e.speed));
}

/** How quickly a train gets going: its slowest engine's. */
export function quickness(world: World, train: Train): number {
  const l = load(world, train);
  return l.engines.length === 0 ? 1 : Math.min(...l.engines.map((e) => e.quick));
}

/** "Too heavy: a tank engine pulls 3 cars, and this train has 5", or null if it can go. */
export function tooHeavy(world: World, train: Train): string | null {
  const l = load(world, train);
  if (l.engines.length === 0 || l.cars <= l.pulls) return null;
  const one = l.engines[0].label;
  const who = l.engines.length === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one} pulls ${l.pulls} cars` : `its engines pull ${l.pulls} cars`;
  return `Too heavy: ${who}, and this train has ${l.cars}. Add an engine or take a car off`;
}

/** Game mode's engines on the sim (Sandbox: none, every engine alike). */
export function attachEngines(world: World): void {
  world.sim.topSpeed = (train) => topSpeed(world, train);
  world.sim.quickness = (train) => quickness(world, train);
}

export function detachEngines(world: World): void {
  world.sim.topSpeed = null;
  world.sim.quickness = null;
}
