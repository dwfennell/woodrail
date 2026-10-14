import type { Group, Material, Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { CarKind, CarLook } from "../sim";
import type { Materials } from "./materials";

/**
 * Car models made in Blender (tools/blender/trains.py), loaded from public/models/trains.glb. They wear the game's own
 * materials, swapped in by material name ("wood", "metal", "coal", "lamp", "lacquer #rrggbb"), so they're lit and
 * painted like everything else. Open the page with `?builtin` to see the models built in code instead (they're also
 * the fallback if the file can't be loaded).
 */
export const blenderModelsWanted = (): boolean => !new URLSearchParams(location.search).has("builtin");

const models = new Map<string, Object3D>();
let loading: Promise<void> | null = null;

/** Fetch and parse the models (once; call before building any car). Failing leaves the built-in models in place. */
export function loadBlenderModels(): Promise<void> {
  loading ??= (async () => {
    const t0 = performance.now();
    try {
      const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${import.meta.env.BASE_URL}models/trains.glb`);
      let tris = 0;
      for (const node of [...gltf.scene.children]) {
        // Each model sits somewhere in the .blend's layout: bring it home.
        node.position.set(0, 0, 0);
        node.updateMatrix();
        models.set(node.name, node);
        node.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
        });
      }
      console.info(`Woodrail: ${models.size} Blender models loaded in ${Math.round(performance.now() - t0)} ms (${Math.round(tris / 1000)}k triangles)`);
    } catch (e) {
      console.warn("Woodrail: couldn't load the Blender models, using the built-in ones", e);
    }
  })();
  return loading;
}

/** The car as modelled in Blender, or null if it isn't loaded. `recolor` swaps lacquer colours (#rrggbb, lower case). */
export function blenderCar(
  kind: CarKind,
  look: CarLook,
  mats: Materials,
  lamp: Material,
  recolor: Readonly<Record<string, string>> = {},
): { root: Group; wheels: Object3D[]; lamp?: Mesh } | null {
  const model = models.get(`${kind}-${look}`);
  if (!model) return null;
  const root = model.clone(true) as Group;
  // The wheels and lamp are nodes centred on their axle and bulb (the compressed mesh may be a child).
  const wheels: Object3D[] = [];
  let lampMesh: Mesh | undefined;
  const swap = (name: string): Material => {
    if (name.startsWith("lacquer #")) {
      const color = name.slice(8);
      return mats.lacquer(recolor[color] ?? color);
    }
    if (name === "wood") return mats.naturalWood;
    if (name === "coal") return mats.coal;
    if (name === "lamp") return lamp;
    return mats.magnet;
  };
  root.traverse((o) => {
    if (o.name.startsWith("wheel_")) wheels.push(o);
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.material = swap((m.material as Material).name);
    m.castShadow = true;
    m.receiveShadow = true;
    // Shared between every copy: don't let disposing one car free it.
    m.userData.sharedGeometry = true;
    if (m.material === lamp) lampMesh = m;
  });
  return { root, wheels, lamp: lampMesh };
}
