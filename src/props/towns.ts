import { rng } from "../lib/rng";
import { CELL, FEAT_BUILDING, FEAT_NONE, SURF_TOWN, type Building, type Landscape, type Town } from "../landscape";
import { footprintOf, townLooks, type Look } from "../render/dressing/buildings";
import { COLOR_VARIANTS } from "../render/props/library";
import type { PropStore } from "./store";
import { landmarkOf } from "../game/landmarks";
import { scaleOf } from "../catalogue/scale";

/**
 * Towns built from catalogue models: each town building (`towns[].buildings`, generated with the map) becomes a prop
 * on its squares, a catalogue model that fits them, turned to face the town. The prop carries the building's id, so
 * the squares stay the building's (track can't be laid through a house) until the player moves or removes it.
 */

/**
 * Catalogue models' ground boxes as modelled (mm, along their own x and z: [x0, x1, z0, z1]; fronts face +x), measured
 * from the models (a test checks them against the GLB), for fitting them to town squares. Some are drawn bigger or
 * smaller (`catalogue/scale.ts`); a model stands with its box's middle on its lot's.
 */
const BOX: Record<string, readonly [number, number, number, number]> = {
  "bldg-townhouse": [-24.5, 24.5, -17.5, 17.5],
  "bldg-thatched-cottage": [-23, 24, -21, 21],
  "bldg-timber-house": [-21.5, 27.5, -20, 20],
  "bldg-bungalow": [-28, 28, -28, 28],
  "bldg-brick-house": [-22.5, 25, -22.5, 22.5],
  "bldg-narrow-house": [-21, 24, -14, 14],
  "bldg-corner-shop": [-23.5, 30, -20.5, 20.5],
  "bldg-toy-shop": [-26.5, 33, -18.5, 23.5],
  "bldg-bakery": [-25.5, 34, -18.5, 18.5],
  "bldg-terrace": [-21, 21, -64.5, 64.5],
  "bldg-semi-detached": [-26, 24, -56, 56],
  "bldg-villa": [-24, 31, -54, 54],
  "bldg-cottage-row": [-18, 19, -54.5, 54.5],
  "bldg-church": [-51.5, 47, -19.5, 19.5],
  "bldg-post-office": [-28.5, 39.9, -19.5, 19.5],
  "bldg-cafe": [-22.5, 48.2, -21, 23],
  "bldg-apartment-block": [-32, 40.1, -26, 26],
  // Town landmarks (Game mode): a school, a market hall, a library, a college.
  "bldg-school": [-19.5, 28.1, -37.5, 37.5],
  "bldg-market-hall": [-30, 30, -58, 58],
  "bldg-library": [-29, 29.6, -52, 52],
  "bldg-college": [-22.5, 18, -54, 54],
};

/** A town model's box as modelled (see `BOX`), or undefined for one not used in towns. */
export const boxOf = (asset: string): readonly [number, number, number, number] | undefined => BOX[asset];

/** A town model's ground size as drawn (mm, along its own x and z), or undefined for one not used in towns. */
export function sizeOf(asset: string): readonly [number, number] | undefined {
  const b = BOX[asset];
  if (!b) return undefined;
  const k = scaleOf(asset);
  return [(b[1] - b[0]) * k, (b[3] - b[2]) * k];
}

/** Room left between a model and its squares' edges (mm, each side), so nothing hangs over a street or a neighbour. */
const LOT_MARGIN = 1;

/** A lot's room for a model (mm, its short and long side, less the margins): 1 square, 2 side by side, or 2×2. */
function lotRoom(squares: number): [number, number] {
  const [w, l] = squares >= 4 ? [2 * CELL, 2 * CELL] : squares === 2 ? [CELL, 2 * CELL] : [CELL, CELL];
  return [w - 2 * LOT_MARGIN, l - 2 * LOT_MARGIN];
}

/**
 * The scale (of the model as modelled) this model stands at on a lot of `squares`: its own (`scaleOf`), or where that
 * doesn't fit, the largest that does, down to 1 (a landmark on a smaller lot than it wants is a little smaller there,
 * but itself). Null if it doesn't fit even at 1.
 */
export function fitScale(asset: string, squares: number): number | null {
  const b = BOX[asset];
  if (!b) return null;
  const dims = [b[1] - b[0], b[3] - b[2]];
  const [short, long] = [Math.min(...dims), Math.max(...dims)];
  const [roomShort, roomLong] = lotRoom(squares);
  const k = Math.min(scaleOf(asset), roomShort / short, roomLong / long);
  return k >= 1 ? k : null;
}

/** Does this model fit a lot of 1 square, 2 side by side, or 4 (2×2), lying along it, at the size it's drawn? */
export function fitsLot(asset: string, squares: number): boolean {
  const k = fitScale(asset, squares);
  return k !== null && k >= scaleOf(asset) - 1e-9;
}

/** Every model a town is dressed with, by how many squares it stands on (for checking they fit: see the tests). */
export function townModels(): { asset: string; squares: number }[] {
  const out: { asset: string; squares: number }[] = [];
  for (const a of HOUSES_1) out.push({ asset: a, squares: 1 });
  for (const a of HOUSES_2) out.push({ asset: a, squares: 2 });
  for (const look of Object.values(BY_LOOK)) for (const [n, list] of Object.entries(look)) for (const a of list ?? []) out.push({ asset: a, squares: Number(n) });
  return out;
}

/** Houses on one square: each town picks a few of these, so its houses go together. */
const HOUSES_1 = ["bldg-townhouse", "bldg-thatched-cottage", "bldg-timber-house", "bldg-bungalow", "bldg-brick-house", "bldg-narrow-house"];
const HOUSES_2 = ["bldg-semi-detached", "bldg-villa", "bldg-terrace"];

/** What each look becomes, by how many squares the building has (the first that fits; else a house). */
const BY_LOOK: Record<Look, { 1?: readonly string[]; 2?: readonly string[] }> = {
  house: {},
  terrace: { 2: ["bldg-terrace", "bldg-cottage-row"] },
  // The toy shop (pinwheel on its ridge) is a rare find: about one small shop in ten.
  shop: { 1: [...Array<string>(9).fill("bldg-corner-shop"), "bldg-toy-shop"], 2: ["bldg-apartment-block"] },
  bakery: { 1: ["bldg-bakery"], 2: ["bldg-bakery"] },
  cafe: { 1: ["bldg-corner-shop"], 2: ["bldg-cafe"] },
  post: { 1: ["bldg-corner-shop"], 2: ["bldg-post-office"] },
  church: { 2: ["bldg-church"] },
  // No catalogue school fits two squares yet (it's 78 mm deep): the school's spot gets a house.
  school: {},
};

export interface TownProp {
  asset: string;
  x: number;
  z: number;
  heading: number;
  building: number;
  town: number;
  /** Colour variant (see `COLOR_VARIANTS`): a town's repeated houses in different paint. */
  variant: number;
  /** Drawn smaller than its model (a landmark on a smaller lot than it wants: see `fitScale`). */
  scale?: number;
}

/** The catalogue model and pose for each building of a town (same order as `town.buildings`). */
export function townProps(land: Landscape, town: Town): TownProp[] {
  const looks = townLooks(land.seed, town);
  // The town's own stream, separate from the generator's and from `townLooks`.
  const r = rng((Math.imul(land.seed, 71) + town.id * 613 + 29) >>> 0);
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  // Three house styles per town, so its houses look like they belong together.
  const styles = [...HOUSES_1].sort(() => r() - 0.5).slice(0, 3);
  return town.buildings.map((b, k) => {
    const squares = b.cells.length >= 4 ? 4 : b.cells.length > 1 ? 2 : 1;
    const options = (squares === 4 ? undefined : BY_LOOK[looks[k]][squares]) ?? (squares > 1 ? HOUSES_2 : styles);
    // A landmark: its own model, the first of its list that's in the catalogue and fits its lot (others stand in).
    const mark = b.landmark ? landmarkOf(b.landmark) : undefined;
    // (On a smaller lot than it wants, still itself: drawn as large as fits there.)
    const list = mark && (squares === 4 ? [...(mark.models.four ?? []), ...mark.models.two] : squares === 2 ? mark.models.two : mark.models.one);
    const marked = list?.find((a) => fitScale(a, squares) !== null);
    const asset = marked ?? pick(options);
    const fit = marked ? fitScale(marked, squares)! / scaleOf(marked) : 1;
    const variant = Math.floor(r() * (COLOR_VARIANTS + 1));
    return { asset, ...poseFor(land, town, b, looks[k], asset, fit), building: b.id, town: town.id, variant, ...(fit < 1 - 1e-6 ? { scale: fit } : {}) };
  });
}

/**
 * Where a town building's prop stands on its squares as they are now, facing its street (as the town was dressed: see
 * `townProps`), for model `asset` drawn at `fit` of its size. `look` is the building's town look (`townLooks`), worked
 * out once by the caller (it doesn't change while the building moves: it goes by its place in the town's list).
 */
export function buildingPose(land: Landscape, town: Town, b: Building, look: Look, asset: string, fit = 1): { x: number; z: number; heading: number } {
  return poseFor(land, town, b, look, asset, fit);
}

/** The town look of each of a town's buildings (see `townLooks`), by building id. */
export function looksOf(land: Landscape, town: Town): Map<number, Look> {
  const looks = townLooks(land.seed, town);
  return new Map(town.buildings.map((b, k) => [b.id, looks[k]]));
}

/** `Building.front`'s grid edges as directions: +col, +row, −col, −row. */
const EDGES = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
] as const;

/**
 * Where a building's model stands and which way it faces: on its squares, its front toward its street (`front`) or
 * else the town's centre. A two-square model lies along its squares; one whose front is on its long side faces across
 * them, one whose front is at an end faces along them (toward the street or centre, whichever side that is).
 */
function poseFor(land: Landscape, town: Town, b: Building, look: Look, asset: string, fit = 1): { x: number; z: number; heading: number } {
  const { x, z, heading } = facing(land, town, b, look, asset);
  // The model's box (not its origin) on the lot's middle.
  const box = BOX[asset];
  if (!box) return { x, z, heading };
  const k = scaleOf(asset) * fit;
  const mx = ((box[0] + box[1]) / 2) * k;
  const mz = ((box[2] + box[3]) / 2) * k;
  const c = Math.cos(heading);
  const sn = Math.sin(heading);
  return { x: x - (mx * c - mz * sn), z: z - (mx * sn + mz * c), heading };
}

/** Where a building's lot's middle is, and which way its model faces (see `poseFor`). */
function facing(land: Landscape, town: Town, b: Building, look: Look, asset: string): { x: number; z: number; heading: number } {
  const fp = footprintOf(land, town, b.cells, look);
  // The way it should face: its street (the town plan's lot front), else the town's centre.
  const street = b.front === undefined ? null : EDGES[b.front];
  const toCentre = street ?? { x: town.centre.x - fp.cx, z: town.centre.z - fp.cz };
  // (One square, or a 2×2 block: it faces its street square on.)
  if (street && b.cells.length !== 2) return { x: fp.cx, z: fp.cz, heading: Math.atan2(street.z, street.x) };
  let front = fp.front;
  if (b.cells.length > 1) {
    // The squares' long axis, and the model's: long along z (front on its long side) or along x (front at an end).
    const along = fp.w > fp.d ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const [sx, sz] = sizeOf(asset) ?? [CELL, CELL];
    const frontAxis = sz >= sx ? { x: -along.z, z: along.x } : along;
    const toward = frontAxis.x * toCentre.x + frontAxis.z * toCentre.z >= 0 ? 1 : -1;
    front = { x: frontAxis.x * toward, z: frontAxis.z * toward };
  }
  return { x: fp.cx, z: fp.cz, heading: Math.atan2(front.z, front.x) };
}

/**
 * Give every town building that has no prop yet its catalogue model: a new map's towns, towns on land just added, and
 * saves from before towns were props. Returns how many were added.
 */
export function addTownProps(land: Landscape, props: PropStore): number {
  const have = new Set<number>();
  for (const p of props.all()) if (p.building !== undefined) have.add(p.building);
  let added = 0;
  for (const town of land.towns) {
    const wanted = town.buildings.some((b) => !have.has(b.id));
    if (!wanted) continue;
    for (const t of townProps(land, town)) {
      if (have.has(t.building)) continue;
      // On its square's ground: a town that has grown onto a hill stands its houses on the blocks.
      const cell = land.grid.cellAtWorld(t.x, t.z);
      const y = cell >= 0 ? land.grid.groundY(cell) : 0;
      props.add(t.asset, { x: t.x, z: t.z, heading: t.heading, y }, undefined, { building: t.building, town: t.town, ...(t.variant ? { variant: t.variant } : {}), ...(t.scale ? { scale: t.scale } : {}) });
      added++;
    }
  }
  return added;
}

/** The town and record of a building, by id. */
export function findBuilding(land: Landscape, id: number): { town: Town; building: Building } | null {
  for (const town of land.towns) {
    const building = town.buildings.find((b) => b.id === id);
    if (building) return { town, building };
  }
  return null;
}

/**
 * A town building's prop is moved or removed by the player: the building leaves the map's records, and its squares
 * become a town green (so the prop is an ordinary prop from now on). Returns a function that puts it all back (undo).
 */
export function releaseBuilding(land: Landscape, id: number): () => void {
  const found = findBuilding(land, id);
  if (!found) return () => {};
  const { town, building } = found;
  const index = town.buildings.indexOf(building);
  const g = land.grid;
  const before = building.cells.map((i) => [i, g.feature[i], g.owner[i], g.surface[i]] as const);
  town.buildings.splice(index, 1);
  for (const i of building.cells) {
    g.feature[i] = FEAT_NONE;
    g.owner[i] = -1;
    // A little town green (not street: the town's streets are the road plan's).
    g.surface[i] = SURF_TOWN;
  }
  return () => {
    town.buildings.splice(index, 0, building);
    for (const [i, f, o, s] of before) {
      g.feature[i] = f;
      g.owner[i] = o;
      g.surface[i] = s;
    }
  };
}

/** The squares a town building's prop stands on (to let it move about within them), or none. */
export function buildingCells(land: Landscape, id: number | undefined): number[] {
  if (id === undefined) return [];
  const found = findBuilding(land, id);
  return found ? found.building.cells.filter((i) => land.grid.feature[i] === FEAT_BUILDING) : [];
}
