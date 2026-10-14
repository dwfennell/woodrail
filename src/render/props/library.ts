import { Box3, BufferAttribute, Color, SRGBColorSpace, type BufferGeometry, type Material, type Mesh, type Object3D } from "three";
import { Kit } from "../../catalogue/kit";
import { loadAsset } from "../../catalogue/registry";
import type { Footprint } from "../../props/placement";
import { Batcher } from "../dressing/batcher";
import type { Materials } from "../materials";

/** A catalogue model baked for drawing many copies: a few merged parts, and its size on the ground. */
export interface PropModel {
  name: string;
  /** One geometry per material (every lacquer colour folded into the vertex-coloured paint). */
  parts: { geometry: BufferGeometry; material: Material }[];
  footprint: Footprint;
  height: number;
}

/**
 * Builds catalogue models on first use and keeps them: the asset's code is fetched (its catalogue file's chunk), its
 * `build` run once, and the result baked into a handful of merged parts. Nothing is built for models never used.
 */
export class PropLibrary {
  /** A Kit per colour variant (0: the model's own colours). */
  private readonly kits = new Map<number, Kit>();
  /** Built models by key (`modelKey`). */
  private readonly models = new Map<string, PropModel | null>();
  /** Footprints by asset (the same for all its colour variants). */
  private readonly footprints = new Map<string, Footprint>();
  private readonly pending = new Map<string, Promise<PropModel | null>>();
  /** Called when a model finishes loading (to draw props that were waiting for it). */
  onLoaded: ((assetId: string) => void) | null = null;

  constructor(private readonly mats: Materials) {

  }

  /** The model if it's built (null if the asset doesn't exist; undefined if not loaded yet). `key`: see `modelKey`. */
  model(key: string): PropModel | null | undefined {
    return this.models.get(key);
  }

  footprint = (assetId: string): Footprint | undefined => this.footprints.get(assetId);

  /** Fetch and build a model, or a colour variant of it (once each; rejects if it can't be fetched). `key`: see `modelKey`. */
  load(key: string): Promise<PropModel | null> {
    const done = this.models.get(key);
    if (done !== undefined) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      const [assetId, v] = key.split("#");
      const variant = Number(v ?? 0);
      p = loadAsset(assetId).then((asset) => {
        const model = asset ? { name: asset.name, ...bake(asset.build(this.kitFor(variant)), this.mats) } : null;
        this.models.set(key, model);
        if (model) this.footprints.set(assetId, model.footprint);
        this.pending.delete(key);
        this.onLoaded?.(key);
        return model;
      });
      // A failed load (its models couldn't be fetched) is forgotten, so asking again retries.
      p.catch(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  private kitFor(variant: number): Kit {
    let kit = this.kits.get(variant);
    // Fewer segments than the catalogue viewer's: props are small on screen, and many.
    if (!kit) this.kits.set(variant, (kit = new Kit(this.mats, PROP_DETAIL, variant === 0 ? undefined : (c) => shiftHue(c, variant))));
    return kit;
  }
}

/** A model's key in the library: its asset, and its colour variant if not the model's own colours. */
export function modelKey(asset: string, variant?: number): string {
  return variant ? `${asset}#${variant}` : asset;
}

/** How many colour variants there are (besides the model's own colours): towns pick among them. */
export const COLOR_VARIANTS = 3;

const hsl = { h: 0, s: 0, l: 0 };
const shifted = new Color();

/** How far each variant turns a colour round the wheel (chosen to stay clear of magentas: red goes green, blue, orange). */
const HUE_STEPS = [0, 0.33, 0.58, 0.1];

/**
 * A colour variant: strong colours (walls, roofs, doors, awnings) turned round the colour wheel; whites, blacks,
 * greys, window glass and earthy browns (brick, wood) left as they are, so a house is still a house.
 */
export function shiftHue(color: string, variant: number): string {
  // In sRGB, the space the colours are written in (three's working space is linear).
  shifted.set(color).getHSL(hsl, SRGBColorSpace);
  if (hsl.s < 0.3 || hsl.l < 0.25 || hsl.l > 0.9) return color;
  const earthy = hsl.h < 0.11 && hsl.l < 0.5 && hsl.s < 0.5;
  if (earthy) return color;
  shifted.setHSL((hsl.h + HUE_STEPS[variant % HUE_STEPS.length]) % 1, hsl.s, hsl.l, SRGBColorSpace);
  return `#${shifted.getHexString()}`;
}

/** Kit detail for props (see `Kit`). */
const PROP_DETAIL = 0.5;

const box = new Box3();

/** Part of a showcase underlay (see `Asset.build`), or inside one. */
function isUnderlay(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.underlay) return true;
  return false;
}

/** Merge a built model's meshes by material (transforms applied), and measure it. */
export function bake(root: Object3D, mats: Materials): Omit<PropModel, "name"> {
  root.updateMatrixWorld(true);
  const b = new Batcher(mats.paint);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible || isUnderlay(mesh)) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    b.add(material, mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
  });
  const parts = [...b.merged()].map(([material, geometry]) => {
    // Every part in a material is drawn from one batch, which needs the same attributes throughout.
    if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
    return { material, geometry };
  });
  box.makeEmpty();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const footprint: Footprint = box.isEmpty()
    ? { cx: 0, cz: 0, hw: 4, hd: 4 }
    : { cx: (box.min.x + box.max.x) / 2, cz: (box.min.z + box.max.z) / 2, hw: Math.max(2, (box.max.x - box.min.x) / 2), hd: Math.max(2, (box.max.z - box.min.z) / 2) };
  return { parts, footprint, height: box.isEmpty() ? 0 : box.max.y };
}
