import { SURF_LANE, SURF_RIVER, SURF_ROAD, type LandscapeGrid } from "../landscape";
import type { RoadPieceId } from "../roads";

/**
 * Game mode's roads (spec 2026-10-31-roads.md, D1): road squares are bought with coins, as track pieces are made from
 * planks. Like the toy box (`Progress.owned`), what's free to lay is worked out, not kept: the squares you own
 * (`Progress.roads`) less the ones on the map now. So a road taken up, put back in the tray or undone goes back in the
 * box, free to lay again; coins are paid only for a square beyond what you own (`ROAD_COINS` each).
 *
 * "Your" roads are every road square that isn't a town's street: the country lanes the map came with (owned from the
 * start, `Progress.coverRoads`), the roads you laid, and road bridges over a river.
 */

/** Coins a square of road costs (the user's answer to the roads spec's §6 question 1). */
export const ROAD_COINS = 2;

/** The blueprint each road piece needs in Game mode: the plain ones Roads, the zebra Crossing gates, the rest Road bridges. */
export const ROAD_TECH: Readonly<Record<RoadPieceId, string>> = {
  straight: "roads",
  curve: "roads",
  tee: "roads",
  cross: "roads",
  end: "roads",
  zebra: "road-crossings",
  bridge: "road-bridges",
  "ramp-low": "road-bridges",
  "ramp-high": "road-bridges",
};

/** Is square `i` one of your roads (a lane, a road you laid, a road bridge), not a town's street? */
export const ownRoad = (g: LandscapeGrid, i: number): boolean => g.road[i] !== 0 && (g.surface[i] === SURF_LANE || g.surface[i] === SURF_RIVER);

const counted = new WeakMap<LandscapeGrid, { revision: number; n: number }>();

/**
 * How many of your road squares are on the map. A scan of the grid, cached by its revision (which goes up on every
 * change of a square, roads among them): worked out again only after an edit, never per frame.
 */
export function roadsOnMap(g: LandscapeGrid): number {
  const c = counted.get(g);
  if (c && c.revision === g.revision) return c.n;
  let n = 0;
  // (Squares past the last plot are spare room, all 0.)
  for (let i = 0; i < g.road.length; i++) if (ownRoad(g, i)) n++;
  counted.set(g, { revision: g.revision, n });
  return n;
}

/**
 * How many more of your road squares a change would leave on the map (negative: fewer): squares going from none (or
 * grass) to a road, less your roads going to none. A town's street is never yours, before or after.
 */
export function roadsAdded(g: LandscapeGrid, changes: Iterable<readonly [number, number]>): number {
  let n = 0;
  for (const [i, road] of changes) {
    const before = ownRoad(g, i);
    const after = road !== 0 && g.surface[i] !== SURF_ROAD;
    n += (after ? 1 : 0) - (before ? 1 : 0);
  }
  return n;
}

/** Road squares in the box: owned and not on the map. */
export const roadsSpare = (owned: number, onMap: number): number => Math.max(0, owned - onMap);

/** The coins `added` more squares cost now: none from the box, `ROAD_COINS` for each beyond it. */
export const roadsPrice = (owned: number, onMap: number, added: number): number => Math.max(0, added - roadsSpare(owned, onMap)) * ROAD_COINS;

/** Said when a road square can't be bought: "Road: needs 2🪙 more". */
export const roadShortText = (price: number, coins: number): string => `Road: needs ${price - coins}🪙 more`;
