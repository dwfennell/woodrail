import { Color, Group, MeshStandardMaterial, type Material, type Mesh, type Object3D } from "three";
import type { CarKind, CarLook } from "../sim";
import { TRACK_THICKNESS } from "../track";
import { Kit } from "../catalogue/kit";
import { buildTrackCleaner, trackCleanerBogies, trackCleanerBrushes } from "../catalogue/assets/track-cleaner";
import { blenderCar } from "./blender-models";
import type { Materials } from "./materials";
import { GROOVE_DEPTH } from "./track-geometry";

/** The cars are modelled in Blender (tools/blender/trains.py); these sizes match them. */
export const WHEEL_RADIUS = 6.5;
/** Wheel centres ride in the groove floor. */
export const AXLE_HEIGHT = TRACK_THICKNESS - GROOVE_DEPTH + WHEEL_RADIUS - 0.5;
const DECK = AXLE_HEIGHT + 4;
/** Top of the timber wagon's deck, where cargo sits (car-local y). */
export const TIMBER_DECK = DECK + 4 + 4;

export interface CarModel {
  root: Group;
  /** Spun (round z) by distance travelled. */
  wheels: Object3D[];
  /** Engine only: glows to show the lever. */
  lamp?: Mesh;
}

/** The classic engine's colours, and its second scheme (the other looks have one scheme each). */
const ENGINE_BODY = "#2d6b3f";
const ENGINE_TRIM = "#c8442f";
const SECOND_SCHEME: Readonly<Record<string, string>> = { [ENGINE_BODY]: "#b8432f", [ENGINE_TRIM]: "#1f3f73" };

/** Colours of a car's slots (the van's body). */
const CAR_SLOTS: Partial<Record<CarKind, Record<string, string>>> = { van: { body: "#2f6db5" } };

/** Car facing +x, centred on its two axles, y = 0 at the track base. The models must be loaded (loadBlenderModels). */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0, look: CarLook = "classic"): CarModel {
  if (kind === "cleaner") return cleanerModel(mats);
  const lamp = new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 });
  const recolor = variant === 1 && kind === "engine" && look === "classic" ? SECOND_SCHEME : {};
  const model = blenderCar(kind, look, mats, lamp, recolor, CAR_SLOTS[kind]);
  model.root.traverse((o) => (o.userData.carKind = kind));
  return model;
}

/**
 * The track cleaner: the catalogue's model (a code model, no Blender one), lifted onto the rails. Its brushes turn
 * with its wheels, by distance run: only while it moves, at no cost of their own.
 */
function cleanerModel(mats: Materials): CarModel {
  const kit = new Kit(mats, 0.5);
  const body = buildTrackCleaner(kit);
  // Its wheels' feet (y 0, 6 mm wheels) on the groove floor, where the other cars' run.
  body.position.y = AXLE_HEIGHT - 7.5;
  const root = new Group();
  root.add(body);
  // Its wheels (the bogies' four, first in the model) turn as the other cars' do, and its brushes with them.
  const wheels: Object3D[] = [...trackCleanerBogies(body).children, ...trackCleanerBrushes(body)];
  root.traverse((o) => {
    o.userData.carKind = "cleaner";
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      // (Its geometry is its own: freed with it, see `disposeObject`.)
    }
  });
  return { root, wheels };
}

/** Free the GPU geometry a car model owns. Lacquer and wood materials are shared caches and are kept. */
export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
    if (mesh.userData.ownsMaterial) (mesh.material as Material).dispose();
  });
}

/** Which colour scheme a car wears: it follows the car (its id survives being picked up and put down). */
export const carVariant = (kind: CarKind, id: number): number => (kind === "engine" ? id % 2 : id);
