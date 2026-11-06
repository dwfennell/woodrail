import { ENGINE_SPEED, type CarLook, type Train } from "../sim";
import { powerOf } from "./power";
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
  /** Runs on power: at its speed with a spark (src/game/power.ts), at `STEAM`'s without. */
  readonly electric?: boolean;
  /** Has a cog under it: climbs a rack (`isRack`), where other trains stop short. */
  readonly rack?: boolean;
}

export const ENGINES: Partial<Record<CarLook, EngineKind>> = {
  classic: { label: "engine", pulls: 4, speed: 1, quick: 1 },
  tank: { label: "tank engine", pulls: 3, speed: 1, quick: 2 },
  goods: { label: "goods engine", pulls: 8, speed: 0.8, quick: 0.7 },
  diesel: { label: "diesel", pulls: 6, speed: 1.2, quick: 1 },
  electric: { label: "electric engine", pulls: 6, speed: 1.4, quick: 1.2, electric: true },
  express: { label: "express engine", pulls: 4, speed: 1.5, quick: 1 },
  // The rack's (spec 2026-11-04-rail-types.md): weak and slow, but it climbs.
  rack: { label: "rack engine", pulls: 2, speed: 0.7, quick: 1.5, rack: true },
  // The metro train's motor car (src/game/metro.ts): quick, electric, two cars of its own.
  metro: { label: "metro train", pulls: 2, speed: 1.3, quick: 1.5, electric: true },
  // The Royal Train's engine (a grand project's reward): an express's numbers, in claret and gold.
  royal: { label: "royal engine", pulls: 4, speed: 1.5, quick: 1 },
};

const engineOf = (world: World, carId: number): EngineKind => ENGINES[world.sim.lookOf(carId)] ?? ENGINES.classic!;

/** An electric engine without a spark of power runs as this (the classic engine's speed and pace): slower, never stopped. */
export const STEAM: EngineKind = { label: "electric engine", pulls: 6, speed: 1, quick: 1, electric: true };

/**
 * Does this engine run on a spark (src/game/power.ts)? The electric engine. (The metro train is electric too, but draws
 * its own coal from a power station as it runs, src/game/metro.ts, and stands while none has any: `metroStands`.)
 */
const onSparks = (world: World, carId: number): boolean => world.sim.lookOf(carId) === "electric";

/** An engine as it runs now: an electric one without a spark at steam speed. */
function runningAs(world: World, carId: number): EngineKind {
  return onSparks(world, carId) && !powerOf(world).engineOn(world, carId) ? STEAM : engineOf(world, carId);
}

/** Is this electric engine short of power (running at steam speed)? False for any other engine. */
export function shortOfPower(world: World, carId: number): boolean {
  return onSparks(world, carId) && !powerOf(world).engineOn(world, carId);
}

/** Does this train stand for want of power: a metro train while no power station has coal? */
function metroStands(world: World, train: Train): boolean {
  return train.cars.some((c) => c.kind === "engine" && world.sim.lookOf(c.id) === "metro") && !powered(world);
}

/** What a train's engines can pull, how many cars it has (engines aside), and its engines. */
export function load(world: World, train: Train): { pulls: number; cars: number; engines: EngineKind[] } {
  const engines = train.cars.filter((c) => c.kind === "engine").map((c) => engineOf(world, c.id));
  return { pulls: engines.reduce((n, e) => n + e.pulls, 0), cars: train.cars.length - engines.length, engines };
}

/** Is a power station working (it has coal)? (Its sparks: src/game/power.ts.) */
export function powered(world: World): boolean {
  for (const d of world.economy.allDepots()) if (d.role === "power" && world.layout.getPiece(d.pieceId) && world.economy.working(d)) return true;
  return false;
}

/** A train with a caboose at its tail runs this much faster (#13). One counts; more don't add to it. */
export const CABOOSE_BONUS = 1.1;

/** Better boilers (research, tech-tree R1): every engine runs this much faster. On top of a caboose's. */
export const BOILERS_BONUS = 1.1;

/**
 * Has the train a caboose at its tail: an end car (the end away from its engines, whichever way it's going: the cars
 * run front first and turn round with it), and an engine to pull it? A caboose mid-train doesn't count.
 */
export function cabooseAtTail(train: Train): boolean {
  const cars = train.cars;
  if (cars.length < 2 || !cars.some((c) => c.kind === "engine")) return false;
  return cars[0].kind === "caboose" || cars[cars.length - 1].kind === "caboose";
}

/**
 * A train's top speed (mm/s): its slowest engine's (an electric one without a spark of power at steam speed), a tenth
 * faster with a caboose at its tail, and a tenth again with Better boilers learned (`boilers`); 0 if it's too heavy
 * for its engines.
 */
export function topSpeed(world: World, train: Train, boilers = false): number {
  const l = load(world, train);
  if (l.engines.length === 0) return ENGINE_SPEED;
  if (l.cars > l.pulls) return 0;
  if (metroStands(world, train)) return 0;
  let speed = Infinity;
  for (const c of train.cars) if (c.kind === "engine") speed = Math.min(speed, runningAs(world, c.id).speed);
  return ENGINE_SPEED * speed * (cabooseAtTail(train) ? CABOOSE_BONUS : 1) * (boilers ? BOILERS_BONUS : 1);
}

/**
 * Why a train can't move at all (its top speed is 0): too heavy for its engines, or a metro train with no power; or
 * null. (An electric engine without a spark never stops: it runs at steam speed.)
 */
export function cantMove(world: World, train: Train): "too-heavy" | "no-power" | null {
  const l = load(world, train);
  if (l.engines.length === 0) return null;
  if (l.cars > l.pulls) return "too-heavy";
  if (metroStands(world, train)) return "no-power";
  return null;
}

/** How quickly a train gets going: its slowest engine's (an electric one without a spark at steam's pace). */
export function quickness(world: World, train: Train): number {
  let q = Infinity;
  for (const c of train.cars) if (c.kind === "engine") q = Math.min(q, runningAs(world, c.id).quick);
  return q === Infinity ? 1 : q;
}

/** "Too heavy: a tank engine pulls 3 cars, and this train has 5", or null if it can go. */
export function tooHeavy(world: World, train: Train): string | null {
  const l = load(world, train);
  if (l.engines.length > 0 && l.cars <= l.pulls && metroStands(world, train)) return "No power: a metro train runs while a power station has coal";
  if (l.engines.length === 0 || l.cars <= l.pulls) return null;
  const one = l.engines[0].label;
  const who = l.engines.length === 1 ? `${/^[aeiou]/.test(one) ? "an" : "a"} ${one} pulls ${l.pulls} cars` : `its engines pull ${l.pulls} cars`;
  return `Too heavy: ${who}, and this train has ${l.cars}. Add an engine or take a car off`;
}

/** May this train climb a rack: has it a rack engine (anywhere in it, pulling or pushing)? */
export function canRack(world: World, train: Train): boolean {
  return train.cars.some((c) => c.kind === "engine" && !!ENGINES[world.sim.lookOf(c.id)]?.rack);
}

/** "Can't climb the rack: …", for a train standing short of one (`Sim.rackHeld`). */
export const RACK_WAIT = "Can't climb the rack: add a rack engine, or go round by the ramps";

/** Game mode's engines on the sim (Sandbox: none, every engine alike, and any train climbs a rack). */
export function attachEngines(world: World, boilers: () => boolean = () => false): void {
  world.sim.topSpeed = (train) => topSpeed(world, train, boilers());
  world.sim.quickness = (train) => quickness(world, train);
  world.sim.mayRack = (train) => canRack(world, train);
}

export function detachEngines(world: World): void {
  world.sim.topSpeed = null;
  world.sim.quickness = null;
  world.sim.mayRack = null;
}
