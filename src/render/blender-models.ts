import { BufferAttribute, Matrix3, Matrix4, Vector3, type BufferGeometry, type Group, type Material, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Kit } from "../catalogue/kit";
import type { CarKind, CarLook } from "../sim";
import type { Batcher } from "./dressing/batcher";
import type { Materials } from "./materials";

/**
 * The game's models, made in Blender (tools/blender/) and loaded from public/models/<set>.glb: one node per model,
 * named by its id. They wear the game's own materials, swapped in by material name ("wood", "metal",
 * "lacquer #rrggbb", ...), so they're lit and painted like everything else.
 */
export type ModelSet = "trains" | "life" | "buildings" | "dressing" | "industry";

const sets = new Map<ModelSet, Promise<Map<string, Object3D>>>();

/** Fetch attempts before giving up on a file, and the wait before the first retry (doubling after). */
const ATTEMPTS = 4;
const FIRST_RETRY_MS = 500;

/** A model file's bytes: fetched (retrying a failed fetch with backoff), or read from disk where there's no server (tests). */
async function fileBytes(set: ModelSet): Promise<ArrayBuffer> {
  if (typeof window === "undefined") {
    // A specifier in a variable: the browser build never bundles node's fs.
    const fs = "node:fs/promises";
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: string): Promise<Uint8Array> };
    const b = await readFile(`public/models/${set}.glb`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const url = `${import.meta.env.BASE_URL}models/${set}.glb`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (e) {
      if (attempt >= ATTEMPTS) throw e;
      console.warn(`Woodrail: fetching ${url} failed (attempt ${attempt} of ${ATTEMPTS}), retrying`, e);
      await new Promise((r) => setTimeout(r, FIRST_RETRY_MS * 2 ** (attempt - 1)));
    }
  }
}

/**
 * A set's models by id (fetched and parsed once; a failed load is forgotten, so asking again retries). Rejects if
 * the file can't be had. `floats`: decode compressed vertex data to plain floats, for models that get merged and
 * batched (props, the map's parts).
 */
export function loadModelSet(set: ModelSet, floats = false): Promise<Map<string, Object3D>> {
  let p = sets.get(set);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      const bytes = await fileBytes(set);
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, "");
      const models = new Map<string, Object3D>();
      let tris = 0;
      for (const node of [...gltf.scene.children]) {
        // Each model sits somewhere in the .blend's layout: bring it home.
        node.position.set(0, 0, 0);
        node.updateMatrix();
        node.updateMatrixWorld(true);
        const toModel = new Matrix4().copy(node.matrixWorld).invert();
        node.traverse((o) => {
          // Pivots are named `<model>|<part>|<n>`: keep the part's name, as the catalogue animates it by.
          if (o.name.includes("|")) o.name = o.name.split("|")[1];
          const m = o as Mesh;
          if (!m.isMesh) return;
          if (floats) toFloats(m);
          addUvs(m, new Matrix4().multiplyMatrices(toModel, m.matrixWorld));
          tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
        });
        models.set(node.name, node);
      }
      if (typeof window !== "undefined") {
        console.info(`Woodrail: ${models.size} models (${set}) loaded in ${Math.round(performance.now() - t0)} ms (${Math.round(tris / 1000)}k triangles)`);
      }
      return models;
    })();
    sets.set(set, p);
    p.catch(() => sets.delete(set));
  }
  return p;
}

/** One model of a set (which must be loaded: see `loadModelSet`). */
export function modelOf(models: ReadonlyMap<string, Object3D>, id: string): Object3D {
  const m = models.get(id);
  if (!m) throw new Error(`No model "${id}" (rebuild the models: npm run models)`);
  return m;
}

/**
 * Fetch and parse the models the game needs from the start: the trains, and the parts the map's buildings wear. Call
 * (and wait) before building any car or map; rejects if they can't be had.
 */
export async function loadBlenderModels(): Promise<void> {
  const [t, d] = await Promise.all([loadModelSet("trains"), loadModelSet("dressing", true)]);
  trains = t;
  parts.clear();
  addParts(d);
  if (industry) addParts(industry);
}

/** Game mode's parts (its industries, upgrade machines and cargo loads), once `loadGameModels` has them. */
let industry: Map<string, Object3D> | null = null;

/**
 * Fetch Game mode's parts (tools/blender/dressing.py, SET=industry): its industries other than the map's forest yards
 * and sawmills, the upgrade machines and the cargo loads. Only Game mode needs them, so only it loads them; until
 * they're in, `hasPart` says no and the depots draw their stand-ins. Rejects if they can't be had.
 */
export async function loadGameModels(): Promise<void> {
  const m = await loadModelSet("industry", true);
  if (industry) return;
  industry = m;
  addParts(m);
}

/** Flatten each model of a set into its pieces, one geometry per material, in the part's own space. */
function addParts(models: ReadonlyMap<string, Object3D>): void {
  const inv = new Matrix4();
  for (const [name, model] of models) {
    model.updateMatrixWorld(true);
    inv.copy(model.matrixWorld).invert();
    const pieces: Piece[] = [];
    model.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const toPart = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
      pieces.push({ material: (m.material as Material).name, geometry: m.geometry.clone().applyMatrix4(toPart) });
    });
    parts.set(name, pieces);
  }
}

interface Piece {
  material: string;
  geometry: BufferGeometry;
}

/** The map's building parts (tools/blender/dressing.py) by name: a door, a station clock, a street lamp; and Game mode's
 * (industry.glb) once loaded. */
const parts = new Map<string, Piece[]>();

/**
 * Draw a building part into a batch: each piece copied, placed by `place` (as the code places its own geometry) and
 * painted, a slot's colour taken from `slots` ("lacquer slot door" from `slots.door`).
 */
export function addPart(b: Pick<Batcher, "add">, mats: Materials, name: string, place: (g: BufferGeometry) => BufferGeometry, slots: Readonly<Record<string, string>> = {}): void {
  const pieces = parts.get(name);
  if (!pieces) throw new Error(`No building part "${name}" (load the models first: loadBlenderModels)`);
  for (const p of pieces) b.add(partMaterial(mats, p.material, slots), place(p.geometry.clone()));
}

/** Is this building part loaded (the models are loaded in the game, not in unit tests)? */
export function hasPart(name: string): boolean {
  return parts.has(name);
}

/**
 * A part's pieces as geometry and paint, each geometry a copy in the part's own space: for a part drawn many times
 * (instanced, as cargo is) or moved on its own (a saw blade, a windmill's sails).
 */
export function partPieces(mats: Materials, name: string, slots: Readonly<Record<string, string>> = {}): [BufferGeometry, Material][] {
  const pieces = parts.get(name);
  if (!pieces) throw new Error(`No building part "${name}" (load the models first: loadBlenderModels)`);
  return pieces.map((p) => [p.geometry.clone(), partMaterial(mats, p.material, slots)]);
}

function partMaterial(mats: Materials, name: string, slots: Readonly<Record<string, string>>): Material {
  if (name.startsWith("lacquer #")) return mats.lacquer(name.slice(8));
  if (name.startsWith("lacquer fixed #")) return mats.lacquer(name.slice(14));
  // A slot's colour comes with each copy ("lacquer slot door": the door's colour).
  if (name.startsWith("lacquer slot ")) return mats.lacquer(slots[name.slice(13)] ?? "#ff00ff");
  if (name === "wood") return mats.naturalWood;
  return mats.magnet;
}

let trains = new Map<string, Object3D>();

const UV_SCALE = 60;
const v = new Vector3();
const n = new Vector3();
const nm = new Matrix3();

/**
 * Texture coordinates for the beech grain and the lacquer's bump: a planar projection from each vertex's main
 * direction, one repeat per 60 mm of the model's own space (as tools/blender/toy.py once baked in). Made here rather
 * than shipped, which keeps the files small; and every mesh then has them, as batching needs.
 */
function addUvs(mesh: Mesh, toModel: Matrix4): void {
  const g = mesh.geometry;
  if (g.getAttribute("uv")) return;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  nm.getNormalMatrix(toModel);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    // The game's x/z ground plane and y up: a face looking along x shows (z, y), along y (x, z), along z (x, y).
    const [a, b] = ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
    uv[i * 2] = a / UV_SCALE;
    uv[i * 2 + 1] = b / UV_SCALE;
  }
  g.setAttribute("uv", new BufferAttribute(uv, 2));
}

/** Plain float vertex data in place of quantized (merging needs one array type throughout). */
function toFloats(mesh: Mesh): void {
  const g = mesh.geometry;
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as BufferAttribute;
    if (a.array instanceof Float32Array) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
}

/** A copy of a model with its materials swapped for the game's, by name. Geometry is shared between copies. */
function dressed(model: Object3D, swap: (name: string) => Material): Object3D {
  const root = model.clone(true);
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.material = swap((m.material as Material).name);
    m.castShadow = true;
    m.receiveShadow = true;
    // Shared between every copy: don't let disposing one free it.
    m.userData.sharedGeometry = true;
  });
  return root;
}

/**
 * Any model dressed in the game's materials, for showing on its own (the loading screen): slots take the given
 * colours (or a red), the lamp a warm glow.
 */
export function shownModel(model: Object3D, mats: Materials, lamp: Material, slots: Readonly<Record<string, string>> = {}): Object3D {
  return dressed(model, (name) => {
    if (name.startsWith("lacquer #")) return mats.lacquer(name.slice(8));
    if (name.startsWith("lacquer fixed #")) return mats.lacquer(name.slice(14));
    if (name.startsWith("lacquer slot ")) return mats.lacquer(slots[name.slice(13)] ?? "#c8442f");
    if (name === "wood") return mats.naturalWood;
    if (name === "coal") return mats.coal;
    if (name === "lamp") return lamp;
    return mats.magnet;
  });
}

/** A catalogue asset's Blender model, painted through the kit (so its colour variants work). */
export function catalogueModel(model: Object3D, k: Kit): Object3D {
  return dressed(model, (name) => {
    if (name.startsWith("lacquer #")) return k.paint(name.slice(8));
    // Faces keep their colours in every colour variant.
    if (name.startsWith("lacquer fixed #")) return k.mats.lacquer(name.slice(14));
    switch (name) {
      case "wood":
        return k.wood;
      case "cut":
        return k.cut;
      case "glass":
        return k.glass;
      case "coal":
        return k.coal;
      case "felt":
        return k.felt;
      case "water":
        return k.water;
      case "road":
        return k.road;
      default:
        return k.metal;
    }
  });
}

/** A van's body, when no colour is given for its slot. */
const SLOT_DEFAULT = "#7a4a2a";

/**
 * A car as modelled in Blender (the models must be loaded). `recolor` swaps lacquer colours (#rrggbb, lower case);
 * `slots` colours a car's slots ("lacquer slot body": the van's body).
 */
export function blenderCar(
  kind: CarKind,
  look: CarLook,
  mats: Materials,
  lamp: Material,
  recolor: Readonly<Record<string, string>> = {},
  slots: Readonly<Record<string, string>> = {},
): { root: Group; wheels: Object3D[]; lamp?: Mesh } {
  const model = modelOf(trains, `${kind}-${look}`);
  const root = dressed(model, (name) => {
    if (name.startsWith("lacquer #")) {
      const color = name.slice(8);
      return mats.lacquer(recolor[color] ?? color);
    }
    if (name.startsWith("lacquer slot ")) return mats.lacquer(slots[name.slice(13)] ?? SLOT_DEFAULT);
    if (name === "wood") return mats.naturalWood;
    if (name === "coal") return mats.coal;
    if (name === "lamp") return lamp;
    return mats.magnet;
  }) as Group;
  // The wheels and lamp are nodes centred on their axle and bulb (the compressed mesh may be a child).
  const wheels: Object3D[] = [];
  let lampMesh: Mesh | undefined;
  root.traverse((o) => {
    if (o.name.startsWith("wheel_")) wheels.push(o);
    if ((o as Mesh).isMesh && (o as Mesh).material === lamp) lampMesh = o as Mesh;
  });
  return { root, wheels, lamp: lampMesh };
}
