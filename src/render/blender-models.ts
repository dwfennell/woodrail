import { BufferAttribute, type Group, type Material, type Mesh, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Kit } from "../catalogue/kit";
import type { CarKind, CarLook } from "../sim";
import type { Materials } from "./materials";

/**
 * Models made in Blender (tools/blender/), loaded from public/models/<set>.glb: one node per model, named by its id.
 * They wear the game's own materials, swapped in by material name ("wood", "metal", "lacquer #rrggbb", ...), so
 * they're lit and painted like everything else. Open the page with `?builtin` to see the models built in code instead
 * (they're also the fallback if a file can't be loaded).
 */
export const blenderModelsWanted = (): boolean => typeof location === "undefined" || !new URLSearchParams(location.search).has("builtin");

export type ModelSet = "trains" | "life";

const sets = new Map<ModelSet, Promise<Map<string, Object3D>>>();

/**
 * A set's models by id (fetched and parsed once). An empty map if the file can't be loaded, or with `?builtin`.
 * `floats`: decode compressed vertex data to plain floats, for models that get merged and batched (props).
 */
export function loadModelSet(set: ModelSet, floats = false): Promise<Map<string, Object3D>> {
  let p = sets.get(set);
  if (!p) {
    p = (async () => {
      const models = new Map<string, Object3D>();
      if (!blenderModelsWanted()) return models;
      const t0 = performance.now();
      try {
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/${set}.glb`);
        let tris = 0;
        for (const node of [...gltf.scene.children]) {
          // Each model sits somewhere in the .blend's layout: bring it home.
          node.position.set(0, 0, 0);
          node.updateMatrix();
          node.traverse((o) => {
            // Pivots are named `<model>|<part>`: keep the part's name, as the catalogue animates it by.
            const bar = o.name.indexOf("|");
            if (bar >= 0) o.name = o.name.slice(bar + 1);
            const m = o as Mesh;
            if (!m.isMesh) return;
            if (floats) toFloats(m);
            tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
          });
          models.set(node.name, node);
        }
        console.info(`Woodrail: ${models.size} Blender models (${set}) loaded in ${Math.round(performance.now() - t0)} ms (${Math.round(tris / 1000)}k triangles)`);
      } catch (e) {
        // In tests (no server) too: the built-in models stand in.
        if (typeof window !== "undefined") console.warn(`Woodrail: couldn't load the Blender models (${set}), using the built-in ones`, e);
      }
      return models;
    })();
    sets.set(set, p);
  }
  return p;
}

/** Fetch and parse the train models (call before building any car). */
export async function loadBlenderModels(): Promise<void> {
  trains = await loadModelSet("trains");
}

let trains = new Map<string, Object3D>();

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

/** The car as modelled in Blender, or null if it isn't loaded. `recolor` swaps lacquer colours (#rrggbb, lower case). */
export function blenderCar(
  kind: CarKind,
  look: CarLook,
  mats: Materials,
  lamp: Material,
  recolor: Readonly<Record<string, string>> = {},
): { root: Group; wheels: Object3D[]; lamp?: Mesh } | null {
  const model = trains.get(`${kind}-${look}`);
  if (!model) return null;
  const root = dressed(model, (name) => {
    if (name.startsWith("lacquer #")) {
      const color = name.slice(8);
      return mats.lacquer(recolor[color] ?? color);
    }
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
