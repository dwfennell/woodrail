import { loadModelSet, type ModelSet } from "../render/blender-models";
import type { Asset } from "./types";

/**
 * The catalogue's files, loaded on demand: each is its own chunk, fetched the first time one of its models is wanted
 * (a tray tab opened, a saved prop loaded). An asset's file is named by its id's prefix (`bldg-red-barn` → buildings).
 */
const FILES = {
  bldg: () => import("./assets/buildings"),
  mech: () => import("./assets/mechanisms"),
  veh: () => import("./assets/vehicles"),
  life: () => import("./assets/life"),
  scene: () => import("./assets/scenery"),
} as const;

export type CatalogueFile = keyof typeof FILES;

/**
 * The model sets a file's assets are (the file waits for them as it loads). Fetched first, here: a fetch that fails
 * then fails before the file is imported, so asking again retries, where a failed module would stay failed.
 */
const MODEL_SETS: Partial<Record<CatalogueFile, ModelSet>> = { life: "life", bldg: "buildings" };

const loaded = new Map<CatalogueFile, Promise<Map<string, Asset>>>();

export function fileOf(assetId: string): CatalogueFile | null {
  const prefix = assetId.slice(0, assetId.indexOf("-"));
  return prefix in FILES ? (prefix as CatalogueFile) : null;
}

/** A catalogue file's assets by id (loaded once; a failed load is forgotten, so asking again retries). */
export function loadFile(file: CatalogueFile): Promise<Map<string, Asset>> {
  let p = loaded.get(file);
  if (!p) {
    const set = MODEL_SETS[file];
    p = (set ? loadModelSet(set, true) : Promise.resolve())
      .then(() => FILES[file]())
      .then((m) => new Map(m.ASSETS.map((a) => [a.id, a])));
    loaded.set(file, p);
    p.catch(() => loaded.delete(file));
  }
  return p;
}

/** One asset (undefined if there's no such asset). */
export async function loadAsset(assetId: string): Promise<Asset | undefined> {
  const file = fileOf(assetId);
  return file ? (await loadFile(file)).get(assetId) : undefined;
}
