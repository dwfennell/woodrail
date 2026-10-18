import { Box3, BufferAttribute, Color, Group, Matrix4, Mesh, Quaternion, SRGBColorSpace, Vector3, type BufferGeometry, type Material, type Object3D } from "three";
import { Kit } from "../../catalogue/kit";
import { loadAsset } from "../../catalogue/registry";
import type { Footprint } from "../../props/placement";
import { kitOf, kitPlace, type PieceTypeId } from "../../track";
import { Batcher } from "../dressing/batcher";
import { motionOf, type MotionParts } from "../kit-motions";
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
  /** A prop's live parts (a clock's hands), by model key: the template each prop's copy is cloned from. */
  private readonly propParts = new Map<string, Group>();
  /** A moving kit's moving parts, by kit type: the template its live copies are cloned from (see `bakeMovers`). */
  private readonly movers = new Map<PieceTypeId, Group>();
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
    // A kit's models (whole, and bare of its moving parts) are built together: wait for the whole one's. So are a
    // prop's with live parts (a clock's hands: see `PROP_LIVE_PARTS`).
    const kitType = key.startsWith(KIT_KEY) ? kitTypeOfKey(key) : undefined;
    if (kitType && key !== kitModelKey(kitType)) return this.load(kitModelKey(kitType)).then(() => this.models.get(key) ?? null);
    if (!kitType && key.endsWith(BARE)) return this.load(key.slice(0, -BARE.length)).then(() => this.models.get(key) ?? null);
    let p = this.pending.get(key);
    if (!p) {
      const kit = kitType ? kitOf(kitType) : undefined;
      const [assetId, v] = kit ? [kit.asset] : key.split("#");
      const variant = Number(v ?? 0);
      p = loadAsset(assetId).then((asset) => {
        let model: PropModel | null = null;
        if (kit && asset) model = this.loadKit(kitType!, asset.name, placedForKit(asset.build(this.kitFor(0)), kitPlace(kit)));
        else if (asset) {
          const built = asset.build(this.kitFor(variant));
          model = { name: asset.name, ...bake(built, this.mats) };
          this.footprints.set(assetId, model.footprint);
          // A prop with live parts: also baked bare of them (what's drawn under them), and the parts on their own.
          const live = PROP_LIVE_PARTS[assetId];
          const parts = live && bakeMovers(built, live, this.mats);
          if (parts) {
            this.models.set(key + BARE, { name: asset.name, ...bake(built, this.mats, { without: live }) });
            this.propParts.set(key, parts);
          }
        }
        this.models.set(key, model);
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

  /**
   * A kit piece's model, in its piece's own frame (see `KitDef.place`), its own slabs of track left out. One that moves
   * (`KIT_MOTIONS`) is posed at rest first, and baked twice: whole (drawn while it's still), and bare of its moving
   * parts (drawn under them while they move: see `moversOf`).
   */
  private loadKit(type: PieceTypeId, name: string, built: Object3D): PropModel {
    const motion = motionOf(kitOf(type)!.asset);
    if (motion) motion.pose(partsOf(built), 0, 0);
    const whole = { name, ...bake(built, this.mats, { slabs: false }) };
    if (!motion) return whole;
    const names = new Set(motion.parts);
    const movers = bakeMovers(built, names, this.mats);
    if (!movers) return whole;
    this.movers.set(type, movers);
    this.models.set(kitModelKey(type, true), { name, ...bake(built, this.mats, { slabs: false, without: names }) });
    return whole;
  }

  /**
   * A moving kit's moving parts at rest, in its piece's frame, to be cloned for each kit piece of it that moves (the
   * clones share its geometry). Undefined if it has none, or its model isn't loaded yet.
   */
  moversOf(type: PieceTypeId): Group | undefined {
    return this.movers.get(type);
  }

  /** A prop's live parts (see `PROP_LIVE_PARTS`) at rest, by model key; undefined if none or not loaded yet. */
  livePartsOf(key: string): Group | undefined {
    return this.propParts.get(key);
  }

  private kitFor(variant: number): Kit {
    let kit = this.kits.get(variant);
    // Fewer segments than the catalogue viewer's: props are small on screen, and many.
    if (!kit) this.kits.set(variant, (kit = new Kit(this.mats, PROP_DETAIL, variant === 0 ? undefined : (c) => shiftHue(c, variant))));
    return kit;
  }
}

/** A kit piece's model's key in the library (see `kitModelKey`). */
const KIT_KEY = "kit:";

/**
 * A kit piece's model's key: its asset baked without its slabs of track, in the piece's own frame (so it's drawn at
 * the piece's pose).
 */
export const kitModelKey = (type: PieceTypeId, bare = false): string => `${KIT_KEY}${type}${bare ? BARE : ""}`;

/** The key's suffix for a moving kit's model bare of its moving parts (drawn under them while they're live). */
const BARE = "~bare";

/** The kit type a kit model's key is for. */
const kitTypeOfKey = (key: string): PieceTypeId => key.slice(KIT_KEY.length).replace(BARE, "") as PieceTypeId;

/** A model's nodes by name (found once). */
export function partsOf(root: Object3D): MotionParts {
  const byName = new Map<string, Object3D[]>();
  root.traverse((o) => {
    if (!o.name) return;
    let list = byName.get(o.name);
    if (!list) byName.set(o.name, (list = []));
    list.push(o);
  });
  return { get: (name) => byName.get(name) ?? NO_PARTS };
}
const NO_PARTS: readonly Object3D[] = [];

/** A model stood where a kit's place says (turned about its own origin, then set at t, l), in the piece's frame. */
function placedForKit(model: Object3D, at: { t: number; l: number; turn: number }): Object3D {
  const placed = new Group();
  placed.add(model);
  placed.rotation.y = at.turn;
  placed.position.set(at.t, 0, at.l);
  const root = new Group();
  root.add(placed);
  return root;
}

/** A model's key in the library: its asset, and its colour variant if not the model's own colours. */
export function modelKey(asset: string, variant?: number): string {
  return variant ? `${asset}#${variant}` : asset;
}

/**
 * Props drawn with parts of their own, live (`ClockView`): the station clock's hands, which show the game's time. The
 * prop itself is drawn bare of them (`drawnKey`).
 */
export const PROP_LIVE_PARTS: Readonly<Record<string, ReadonlySet<string>>> = {
  "bldg-station-clock": new Set(["hour", "minute"]),
};

/** The model a placed prop is drawn with: its own, or for a prop with live parts, its model bare of them. */
export function drawnKey(asset: string, variant?: number): string {
  return PROP_LIVE_PARTS[asset] ? modelKey(asset, variant) + BARE : modelKey(asset, variant);
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

/**
 * A slab of track in a model (`kit.trackSlab`, which marks it `userData.slab`; or in a Blender model, a node named
 * `slab…`, as tools/blender/kit.py names its `trackSlab`s), or part of one: left out of a kit piece's model, whose real
 * track is drawn under it.
 */
export function isSlab(o: Object3D): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.slab || p.name.startsWith("slab")) return true;
  return false;
}

/** Is this node, or one it's in, named in `names`? */
function within(o: Object3D, names: ReadonlySet<string>): boolean {
  for (let p: Object3D | null = o; p; p = p.parent) if (names.has(p.name)) return true;
  return false;
}

/**
 * Merge a built model's meshes by material (transforms applied), and measure it. `slabs: false` leaves out its slabs
 * of track (see `isSlab`); `without`, the parts with those names (a kit's moving parts, drawn live instead).
 */
export function bake(root: Object3D, mats: Materials, opts: { slabs?: boolean; without?: ReadonlySet<string> } = {}): Omit<PropModel, "name"> {
  root.updateMatrixWorld(true);
  const b = new Batcher(mats.paint);
  const slabs = opts.slabs ?? true;
  const without = opts.without;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible || isUnderlay(mesh) || (!slabs && isSlab(mesh)) || (without && within(mesh, without))) return;
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

const tmp = new Matrix4();
const holderPos = new Vector3();
const holderQuat = new Quaternion();
const holderScale = new Vector3();

/**
 * A model's moving parts (the nodes named in `names`) as a tree of their own, in the root's frame: each part a group
 * with its node's own position, rotation, scale and visibility (so a motion poses it just as it would the node),
 * holding its meshes merged by material in its own frame, and the moving parts inside it in turn. Each stands in a
 * fixed holder giving the frame it moves in (whatever lies between it and the part it's in, or the root). Slabs of
 * track are left out. Null if there are none.
 */
export function bakeMovers(root: Object3D, names: ReadonlySet<string>, mats: Materials): Group | null {
  root.updateMatrixWorld(true);
  const out = new Group();
  out.name = "movers";
  /** A holder for a part built from `node`: the frame `node`'s parent gives it, relative to `outer`'s (or the root's). */
  const holdIn = (outer: Object3D | null, node: Object3D, part: Group): Group => {
    const holder = new Group();
    tmp.copy(node.parent!.matrixWorld);
    if (outer) tmp.premultiply(outer.matrixWorld.clone().invert());
    tmp.decompose(holderPos, holderQuat, holderScale);
    holder.position.copy(holderPos);
    holder.quaternion.copy(holderQuat);
    holder.scale.copy(holderScale);
    holder.add(part);
    return holder;
  };
  const build = (node: Object3D): Group => {
    const g = new Group();
    g.name = node.name;
    g.position.copy(node.position);
    g.rotation.copy(node.rotation);
    g.scale.copy(node.scale);
    g.visible = node.visible;
    const toLocal = node.matrixWorld.clone().invert();
    const b = new Batcher(mats.paint);
    const visit = (o: Object3D) => {
      const mesh = o as Mesh;
      // (A moving part that's hidden at rest, a lamp, keeps its geometry: its visibility is the part's, set above.)
      if (mesh.isMesh && (mesh.visible || o === node) && !isSlab(mesh)) {
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        b.add(material, mesh.geometry.clone().applyMatrix4(tmp.multiplyMatrices(toLocal, mesh.matrixWorld)));
      }
      for (const c of o.children) {
        if (names.has(c.name)) g.add(holdIn(node, c, build(c)));
        else visit(c);
      }
    };
    visit(node);
    for (const [material, geometry] of b.merged()) {
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.sharedGeometry = true;
      g.add(mesh);
    }
    return g;
  };
  const top = (o: Object3D) => {
    for (const c of o.children) {
      if (names.has(c.name)) out.add(holdIn(null, c, build(c)));
      else top(c);
    }
  };
  top(root);
  return out.children.length > 0 ? out : null;
}
