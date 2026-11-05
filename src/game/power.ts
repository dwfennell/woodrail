import { RECIPES, type DepotState } from "../economy";
import type { World } from "./world";

/**
 * Power as sparks (late-game spec, W1: docs/superpowers/specs/2026-11-04-late-game-design.md). A power station makes
 * `STATION_SPARKS` while it has coal; a wind turbine on a hilltop makes `TURBINE_SPARKS`, always. Sparks are shared out:
 * every electric engine first (by car id, oldest first), then the yards the player asked to power, in the order asked.
 * An electric engine without one runs at steam speed (it never stops for want of power); a powered yard works
 * `POWERED_RATE` times as fast.
 *
 * Nothing here runs per frame. The plan is counted from the map and cached by a key of its inputs (`PowerGrid.refresh`):
 * Game mode recounts once a second (a power station's coal runs out), and at once when something asks about an
 * electric engine the plan hasn't seen (one just put on the track).
 */

/** Sparks a working power station (with coal) makes. */
export const STATION_SPARKS = 4;
/** Sparks a wind turbine makes. */
export const TURBINE_SPARKS = 1;
/** A powered yard works this many times as fast. */
export const POWERED_RATE = 1.5;
/** The wind turbine's catalogue model (a prop, made at the workshop once Wind farm is learned; on a hilltop only). */
export const WIND_TURBINE = "mech-wind-turbine";
/** The radio mast's catalogue model (a prop: src/game/radio.ts). Each takes a spark, after the engines. */
export const RADIO_MAST = "mech-radio-mast";
/** Engine looks that run on power. */
const ELECTRIC = "electric";

/** Can this depot be powered: a yard that makes something (not the power station, a town, a school or a store)? */
export function canPower(d: Pick<DepotState, "role">): boolean {
  if (d.role === "power") return false;
  const cycle = RECIPES[d.role].cycle;
  return !!cycle && !cycle.eats && Object.keys(cycle.makes).length > 0;
}

export interface PowerPlan {
  /** Working power stations (with coal), and the sparks they make. */
  readonly stations: number;
  readonly fromCoal: number;
  /** Wind turbines standing, and their sparks. */
  readonly turbines: number;
  readonly fromWind: number;
  /** All the sparks made. */
  readonly made: number;
  /** Electric engines on the map (car ids, oldest first), and those with a spark. */
  readonly engines: readonly number[];
  readonly enginesOn: ReadonlySet<number>;
  /** Radio masts standing (prop ids, oldest first), and those with a spark. */
  readonly masts: readonly number[];
  readonly mastsOn: ReadonlySet<number>;
  /** Yards asked to be powered (depot ids, in the order asked), and those with a spark. */
  readonly yards: readonly number[];
  readonly yardsOn: ReadonlySet<number>;
  /** Sparks used, and spare. */
  readonly used: number;
  readonly spare: number;
}

/** Electric engines on the map: car ids, oldest (lowest id) first. */
export function electricEngines(world: Pick<World, "sim">): number[] {
  const out: number[] = [];
  for (const id of world.sim.trainIds()) {
    for (const c of world.sim.getTrain(id)!.cars) if (c.kind === "engine" && world.sim.lookOf(c.id) === ELECTRIC) out.push(c.id);
  }
  return out.sort((a, b) => a - b);
}

/** Yards asked to be powered (on the map, and able to be), in the order asked. */
export function askedYards(world: Pick<World, "economy" | "layout">): DepotState[] {
  return world.economy
    .allDepots()
    .filter((d) => d.powerAsk > 0 && canPower(d) && world.layout.getPiece(d.pieceId))
    .sort((a, b) => a.powerAsk - b.powerAsk);
}

/** Working power stations on the map. */
function workingStations(world: Pick<World, "economy" | "layout">): number {
  let n = 0;
  for (const d of world.economy.allDepots()) if (d.role === "power" && world.layout.getPiece(d.pieceId) && world.economy.working(d)) n++;
  return n;
}

/** Radio masts standing: prop ids, oldest first. */
export function mastsOf(world: Pick<World, "props">): number[] {
  const out: number[] = [];
  for (const p of world.props.all()) if (p.asset === RADIO_MAST) out.push(p.id);
  return out.sort((a, b) => a - b);
}

/** Wind turbines standing. */
export function turbinesOf(world: Pick<World, "props">): number {
  let n = 0;
  for (const p of world.props.all()) if (p.asset === WIND_TURBINE) n++;
  return n;
}

/** Share out the sparks: `stations` working, `turbines` standing, to `engines`, then radio `masts`, then `yards` (each in order). */
export function sharePower(stations: number, turbines: number, engines: readonly number[], yards: readonly number[], masts: readonly number[] = []): PowerPlan {
  const fromCoal = stations * STATION_SPARKS;
  const fromWind = turbines * TURBINE_SPARKS;
  const made = fromCoal + fromWind;
  let left = made;
  const enginesOn = new Set<number>();
  for (const id of engines) {
    if (left <= 0) break;
    enginesOn.add(id);
    left--;
  }
  const mastsOn = new Set<number>();
  for (const id of masts) {
    if (left <= 0) break;
    mastsOn.add(id);
    left--;
  }
  const yardsOn = new Set<number>();
  for (const id of yards) {
    if (left <= 0) break;
    yardsOn.add(id);
    left--;
  }
  return { stations, fromCoal, turbines, fromWind, made, engines, enginesOn, masts, mastsOn, yards, yardsOn, used: made - left, spare: left };
}

/** The plan for the map as it is now (counted afresh). */
export function planPower(world: PowerWorld): PowerPlan {
  return sharePower(
    workingStations(world),
    turbinesOf(world),
    electricEngines(world),
    askedYards(world).map((d) => d.id),
    mastsOf(world),
  );
}

/**
 * The map's power, cached. `refresh` recounts, cheaply (the depots, the trains' cars, and the props only when they've
 * changed), and keeps the plan unless its inputs changed: `version` goes up when they did (for keyed caches: a card,
 * the yards' rates).
 */
export class PowerGrid {
  private plan: PowerPlan = sharePower(0, 0, [], []);
  private key = "";
  private propsVersion = -1;
  private turbines = 0;
  private masts: number[] = [];
  version = 0;

  /** Count again, on the map `w`; the plan (a new one only if anything changed). */
  refresh(w: PowerWorld): PowerPlan {
    // (A world made without props, a test's: no turbines.)
    const version = w.props?.version ?? -1;
    if (version !== this.propsVersion) {
      this.propsVersion = version;
      this.turbines = w.props ? turbinesOf(w) : 0;
      this.masts = w.props ? mastsOf(w) : [];
    }
    const stations = workingStations(w);
    const engines = electricEngines(w);
    const yards = askedYards(w).map((d) => d.id);
    const key = `${stations}|${this.turbines}|${engines.join(",")}|${yards.join(",")}|${this.masts.join(",")}`;
    if (key !== this.key) {
      this.key = key;
      this.plan = sharePower(stations, this.turbines, engines, yards, this.masts);
      this.version++;
    }
    return this.plan;
  }

  /** The plan as last counted. */
  get current(): PowerPlan {
    return this.plan;
  }

  /** Has this electric engine a spark? (One the plan hasn't seen yet, just put on the track, is counted in at once.) */
  engineOn(w: PowerWorld, carId: number): boolean {
    let p = this.plan;
    if (!p.engines.includes(carId)) p = this.refresh(w);
    return p.enginesOn.has(carId);
  }

  /** Is this yard powered now? */
  yardOn(depotId: number): boolean {
    return this.plan.yardsOn.has(depotId);
  }

  /** Ask for this yard to be powered (last in line), or stop asking. The plan is counted again. */
  ask(w: PowerWorld, d: DepotState, on: boolean): void {
    if (on) {
      if (d.powerAsk > 0) return;
      let last = 0;
      for (const o of w.economy.allDepots()) last = Math.max(last, o.powerAsk);
      d.powerAsk = last + 1;
    } else d.powerAsk = 0;
    this.refresh(w);
  }
}

/** What the power is counted from. */
export type PowerWorld = Pick<World, "economy" | "layout" | "props" | "sim">;

const grids = new WeakMap<object, PowerGrid>();

/** The map's power grid: one per economy (a game's; `Game.world` is a new object at each ask), counted on first ask. */
export function powerOf(world: PowerWorld): PowerGrid {
  let g = grids.get(world.economy);
  if (!g) {
    grids.set(world.economy, (g = new PowerGrid()));
    g.refresh(world);
  }
  return g;
}
