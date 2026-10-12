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

const loaded = new Map<CatalogueFile, Promise<Map<string, Asset>>>();

export function fileOf(assetId: string): CatalogueFile | null {
  const prefix = assetId.slice(0, assetId.indexOf("-"));
  return prefix in FILES ? (prefix as CatalogueFile) : null;
}

/** A catalogue file's assets by id (loaded once). */
export function loadFile(file: CatalogueFile): Promise<Map<string, Asset>> {
  let p = loaded.get(file);
  if (!p) {
    p = FILES[file]().then((m) => new Map(m.ASSETS.map((a) => [a.id, a])));
    loaded.set(file, p);
  }
  return p;
}

/** One asset (undefined if there's no such asset). */
export async function loadAsset(assetId: string): Promise<Asset | undefined> {
  const file = fileOf(assetId);
  return file ? (await loadFile(file)).get(assetId) : undefined;
}
