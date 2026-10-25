import { Color, MeshStandardMaterial } from "three";
import { fileOf, loadFile, type CatalogueFile } from "../catalogue/registry";
import type { Materials } from "../render/materials";
import { PropLibrary } from "../render/props/library";
import type { Footprint } from "./placement";

// Helpers for tests that place things among props (not part of the game).

/** Plain stand-ins for the game's materials (theirs need a canvas for textures; a footprint doesn't depend on them). */
export function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

/**
 * The game's own footprints (`PropLibrary.footprint`, which `Game.footprintOf` asks), for every asset in these
 * catalogue files: their models built and measured as the game builds them, from the same GLBs (read from disk). The
 * function it gives is synchronous, as the game's is; it throws for an asset of a file not loaded here, so a test
 * never quietly treats a prop as having no footprint (where the game, its models loaded, would see one).
 */
export async function loadFootprints(files: readonly CatalogueFile[]): Promise<(asset: string) => Footprint | undefined> {
  const lib = new PropLibrary(stubMaterials());
  for (const file of files) for (const id of (await loadFile(file)).keys()) await lib.load(id);
  const loaded = new Set(files);
  return (asset) => {
    const file = fileOf(asset);
    if (file && !loaded.has(file)) throw new Error(`loadFootprints: ${asset} is in the "${file}" catalogue file, not loaded (add it to the files)`);
    return lib.footprint(asset);
  };
}
