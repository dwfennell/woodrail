import type { Group, Material, Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { Materials } from "./materials";

/**
 * A pilot: car models made in Blender (tools/blender/), loaded from public/models/ in place of the ones built in code.
 * Off unless the page is opened with `?blender`. The models wear the game's own materials, swapped in by material
 * name, so they're lit and painted like every other car.
 */
export const blenderModelsWanted = (): boolean => new URLSearchParams(location.search).has("blender");

let engine: Group | null = null;

/** Fetch and parse the models (call once before building any car). Failing leaves the code-built models in place. */
export async function loadBlenderModels(): Promise<void> {
  const t0 = performance.now();
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/engine.glb`);
    engine = gltf.scene;
    let tris = 0;
    engine.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    });
    console.info(`Woodrail: Blender engine loaded in ${Math.round(performance.now() - t0)} ms (${Math.round(tris)} triangles)`);
  } catch (e) {
    console.warn("Woodrail: couldn't load the Blender models, using the built-in ones", e);
  }
}

/** The colours each named material takes. */
export interface BlenderPaint {
  body: string;
  trim: string;
  wheel: string;
  pane: string;
  lamp: Material;
}

/** A copy of the Blender engine, or null if it isn't loaded. Geometry is shared between copies. */
export function blenderEngine(mats: Materials, paint: BlenderPaint): { root: Group; wheels: Object3D[]; lamp?: Mesh } | null {
  if (!engine) return null;
  const root = engine.clone(true);
  // The wheels and lamp are named nodes centred on their axle and bulb; the (compressed) mesh is a child.
  const wheels: Object3D[] = [];
  let lamp: Mesh | undefined;
  const swap = (name: string): Material => {
    switch (name) {
      case "body":
        return mats.lacquer(paint.body);
      case "trim":
        return mats.lacquer(paint.trim);
      case "wheel":
        return mats.lacquer(paint.wheel);
      case "pane":
        return mats.lacquer(paint.pane);
      case "wood":
        return mats.naturalWood;
      case "lamp":
        return paint.lamp;
      default:
        return mats.magnet;
    }
  };
  root.traverse((o: Object3D) => {
    if (o.name.startsWith("wheel_")) wheels.push(o);
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.material = swap((m.material as Material).name);
    m.castShadow = true;
    m.receiveShadow = true;
    // Shared between every copy: don't let disposing one car free it.
    m.userData.sharedGeometry = true;
    if (m.material === paint.lamp) lamp = m;
  });
  return { root, wheels, lamp };
}
