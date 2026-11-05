import { CARGO } from "../economy/cargo";
import { createSample, getPieceDef, METRO_KIT, pathLength, samplePath, TUNNEL_COVER, type PieceTypeId, type Pose } from "../track";
import type { Sim, Train } from "../sim";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * The metro (spec 2026-11-04-rail-types.md §2): stops in tunnels two levels under a town, a metro train, and what it
 * costs. The user's condition: "It should be expensive to move folks by metro": its stops, its train, the digging under
 * a town and the power it draws make it the dearest way to carry people, and its extra riders pay it back slowly.
 */

/** A town's metro stops with riders of their own (each a quarter of the town): the first this many. */
export const METRO_QUARTERS = 2;
/** A metro stop's riders turn up this many times as slowly as its town's at the station (half the rate). */
export const METRO_SLOWER = 2;
/** Each square of a town dug under for track two levels down costs this (coins), once. */
export const DIG_COINS = 60;
/** A metro train running draws a coal from a power station's pile every this many seconds (on top of its own burn). */
export const METRO_COAL_SECONDS = 20;

/** Is this a metro stop's depot? */
export const isMetroStop = (world: World, pieceId: number): boolean => world.layout.getPiece(pieceId)?.type === METRO_KIT;

/** Has this train a metro engine (its look)? */
export const isMetroTrain = (sim: Sim, train: Train): boolean => train.cars.some((c) => c.kind === "engine" && sim.lookOf(c.id) === "metro");

const under = createSample();
let dugCache: { version: number; towns: string; cells: Set<number> } | null = null;

/** The town squares a piece at `pose` (two levels down or more) runs under, added to `into`. */
function addUnder(world: World, town: ReadonlySet<number>, type: PieceTypeId, flipped: boolean, pose: Pose, into: Set<number>): void {
  const g = world.landscape.grid;
  const def = getPieceDef(type, flipped);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  for (const path of def.paths) {
    const len = pathLength(path.geom);
    for (let d = 0; d <= len; d += 18) {
      samplePath(path.geom, d, under);
      const i = g.cellAtWorld(pose.x + c * under.x - s * under.z, pose.z + s * under.x + c * under.z);
      if (i !== -1 && town.has(i)) into.add(i);
    }
  }
}

const townCells = (world: World): Set<number> => {
  const town = new Set<number>();
  for (const t of world.landscape.towns) for (const i of t.cells) town.add(i);
  return town;
};

/** Is track at this height two levels or more under the felt (a metro's)? */
export const deep = (y: number): boolean => y <= -TUNNEL_COVER + 0.5;

/** The town squares track runs under two levels below the felt, worked out again only when the pieces change. */
function dugCells(world: World): Set<number> {
  const version = world.layout.piecesVersion;
  // (Towns grow: their squares change with the map's revision.)
  const towns = `${world.landscape.towns.length}|${world.landscape.grid.revision}`;
  if (dugCache && dugCache.version === version && dugCache.towns === towns) return dugCache.cells;
  const town = townCells(world);
  const cells = new Set<number>();
  for (const id of world.layout.pieceIds()) {
    const p = world.layout.getPiece(id)!;
    if (deep(p.y)) addUnder(world, town, p.type, p.flipped, p.pose, cells);
  }
  dugCache = { version, towns, cells };
  return cells;
}

/** The squares of towns that track runs under, two levels below the felt (a metro's tunnels), each counted once. */
export function squaresDugUnder(world: World): number {
  return dugCells(world).size;
}

/**
 * Why a piece can't go down two levels under a town (the digging's coins short), or null. On every pointer move while
 * a piece is held: a dozen samples of it against the squares already dug (kept till the pieces change).
 */
export function digWhy(world: World, p: Progress, type: PieceTypeId, pose: Pose, y: number): string | null {
  if (!deep(y)) return null;
  const have = dugCells(world);
  const more = new Set<number>();
  // (Its unflipped shape: a curve's other hand reaches about the same squares.)
  addUnder(world, townCells(world), type, false, pose, more);
  let added = 0;
  for (const i of more) if (!have.has(i)) added++;
  return digRefusal(p, Math.max(have.size, p.dug) + added);
}

/** The coins for digging under `more` squares of town beyond those paid for. */
export function digPrice(p: Progress, onMap: number): number {
  return Math.max(0, onMap - p.dug) * DIG_COINS;
}

/** "Digging under the town costs 80🪙: you have 30🪙", or null if the coins are there. */
export function digRefusal(p: Progress, onMap: number): string | null {
  const price = digPrice(p, onMap);
  return price > p.coins ? `Digging under the town costs ${price}🪙: you have ${p.coins}🪙` : null;
}

/**
 * Pay for squares of town newly dug under after a track edit (`laid`): the coins paid, 0 if none. Taken up, they stay
 * paid. Not after a track edit (`laid` false: a town grown out over a line already there), they're counted as paid.
 */
export function settleDigging(p: Progress, onMap: number, laid = true): number {
  if (!laid) {
    p.dug = Math.max(p.dug, onMap);
    return 0;
  }
  const price = digPrice(p, onMap);
  if (price === 0) return 0;
  p.dug = onMap;
  p.coins = Math.max(0, p.coins - price);
  return price;
}

/**
 * Metro trains draw power: each one running takes a coal from a working power station's pile every
 * `METRO_COAL_SECONDS`, on top of what the station burns. With none left, the power's off and electric trains stop
 * (`powered`). `clock` holds each metro train's seconds since its last coal (by train id), kept by the caller. Cheap:
 * the trains and a few depots, once a second.
 */
export function metroDraw(world: World, seconds: number, clock: Map<number, number>): void {
  const coal = CARGO.coal.index;
  for (const id of world.sim.trainIds()) {
    const t = world.sim.getTrain(id)!;
    if (t.speed < 1 || !isMetroTrain(world.sim, t)) continue;
    let s = (clock.get(id) ?? 0) + seconds;
    while (s >= METRO_COAL_SECONDS) {
      s -= METRO_COAL_SECONDS;
      const station = world.economy.allDepots().find((d) => d.role === "power" && world.layout.getPiece(d.pieceId) && d.piles[coal] > 0);
      if (station) station.piles[coal]--;
    }
    clock.set(id, s);
  }
}
