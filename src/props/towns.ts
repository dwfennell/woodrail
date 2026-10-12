import { rng } from "../lib/rng";
import { CELL, FEAT_BUILDING, FEAT_NONE, SURF_ROAD, type Building, type Landscape, type Town } from "../landscape";
import { footprintOf, townLooks, type Look } from "../render/dressing/buildings";
import type { PropStore } from "./store";

/**
 * Towns built from catalogue models: each town building (`towns[].buildings`, generated with the map) becomes a prop
 * on its squares, a catalogue model that fits them, turned to face the town. The prop carries the building's id, so
 * the squares stay the building's (track can't be laid through a house) until the player moves or removes it.
 */

/** Catalogue models' ground sizes (mm, along their own x and z; fronts face +x), for fitting them to town squares. */
const SIZE: Record<string, readonly [number, number]> = {
  "bldg-townhouse": [48, 41],
  "bldg-thatched-cottage": [46, 46],
  "bldg-timber-house": [48, 43],
  "bldg-bungalow": [56, 56],
  "bldg-brick-house": [47, 51],
  "bldg-narrow-house": [43, 31],
  "bldg-corner-shop": [53, 46],
  "bldg-toy-shop": [59, 45],
  "bldg-bakery": [61, 43],
  "bldg-terrace": [45, 128],
  "bldg-semi-detached": [50, 112],
  "bldg-villa": [55, 108],
  "bldg-cottage-row": [39, 108],
  "bldg-church": [101, 45],
  "bldg-post-office": [70, 45],
  "bldg-cafe": [72, 44],
  "bldg-apartment-block": [72, 52],
};

/** Houses on one square: each town picks a few of these, so its houses go together. */
const HOUSES_1 = ["bldg-townhouse", "bldg-thatched-cottage", "bldg-timber-house", "bldg-bungalow", "bldg-brick-house", "bldg-narrow-house"];
const HOUSES_2 = ["bldg-semi-detached", "bldg-villa", "bldg-terrace"];

/** What each look becomes, by how many squares the building has (the first that fits; else a house). */
const BY_LOOK: Record<Look, { 1?: readonly string[]; 2?: readonly string[] }> = {
  house: {},
  terrace: { 2: ["bldg-terrace", "bldg-cottage-row"] },
  shop: { 1: ["bldg-corner-shop", "bldg-toy-shop"], 2: ["bldg-apartment-block"] },
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
    const squares = b.cells.length > 1 ? 2 : 1;
    const options = BY_LOOK[looks[k]][squares] ?? (squares === 2 ? HOUSES_2 : styles);
    const asset = pick(options);
    return { asset, ...poseFor(land, town, b, looks[k], asset), building: b.id, town: town.id };
  });
}

/** Where a building's model stands and which way it faces: on its squares, its front toward the town's centre. */
function poseFor(land: Landscape, town: Town, b: Building, look: Look, asset: string): { x: number; z: number; heading: number } {
  const fp = footprintOf(land, town, b.cells, look);
  const toCentre = { x: town.centre.x - fp.cx, z: town.centre.z - fp.cz };
  let front = fp.front;
  if (b.cells.length > 1) {
    // The squares' long axis, and the model's: long along z (front on its long side) or along x (front at an end).
    const along = fp.w > fp.d ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const [sx, sz] = SIZE[asset] ?? [CELL, CELL];
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
      props.add(t.asset, { x: t.x, z: t.z, heading: t.heading, y: 0 }, undefined, { building: t.building, town: t.town });
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
 * become town street (so the prop is an ordinary prop from now on). Returns a function that puts it all back (undo).
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
    g.surface[i] = SURF_ROAD;
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
