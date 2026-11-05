import { Color, Group, MeshStandardMaterial, type Material, type Mesh, type Object3D } from "three";
import type { CarKind, CarLook } from "../sim";
import { TRACK_THICKNESS } from "../track";
import { Kit } from "../catalogue/kit";
import { buildTrackCleaner, trackCleanerBogies, trackCleanerBrushes } from "../catalogue/assets/track-cleaner";
import { buildMilkTanker, milkTankerBogies } from "../catalogue/assets/milk-tanker";
import { buildColdVan, coldVanBogies } from "../catalogue/assets/cold-van";
import { buildOilTanker, oilTankerBogies } from "../catalogue/assets/oil-tanker";
import { breakdownCraneBogies, buildBreakdownCrane } from "../catalogue/assets/breakdown-crane";
import { buildMailVan, mailVanBogies } from "../catalogue/assets/mail-van";
import { buildCarCarrier, carCarrierBogies } from "../catalogue/assets/car-carrier";
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

/**
 * Each engine look's modelled body and trim colours (tools/blender/trains.py), which a livery from the paint shop
 * (game/paint-shop.ts) swaps: a recolour map for `blenderCar`, through the lacquer cache (no new material per car).
 */
export const LIVERY_SLOTS: Readonly<Partial<Record<CarLook, { body: readonly string[]; trim: readonly string[] }>>> = {
  classic: { body: ["#2d6b3f"], trim: ["#c8442f"] },
  goods: { body: ["#1f4a2e"], trim: ["#c8442f"] },
  tank: { body: ["#2f6db5"], trim: ["#c8442f"] },
  diesel: { body: ["#e6b52c"], trim: [] },
  electric: { body: ["#c8442f"], trim: ["#f0ebe0"] },
  express: { body: ["#1f5aa6"], trim: ["#e6b52c"] },
};

/** A livery's recolour map for an engine of `look` (body and trim to the livery's). */
export function liveryRecolor(look: CarLook, livery: { body: string; trim: string }): Record<string, string> {
  const slots = LIVERY_SLOTS[look];
  const out: Record<string, string> = {};
  if (!slots) return out;
  for (const c of slots.body) out[c] = livery.body;
  for (const c of slots.trim) out[c] = livery.trim;
  return out;
}

/** Colours of a car's slots (the van's body). */
const CAR_SLOTS: Partial<Record<CarKind, Record<string, string>>> = { van: { body: "#2f6db5" } };

/** Car facing +x, centred on its two axles, y = 0 at the track base. The models must be loaded (loadBlenderModels). */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0, look: CarLook = "classic", loaded = false, livery?: { body: string; trim: string }): CarModel {
  if (kind === "cleaner") return cleanerModel(mats);
  if (kind === "tanker") return codeCarModel(mats, "tanker", buildMilkTanker, milkTankerBogies);
  if (kind === "reefer") return codeCarModel(mats, "reefer", buildColdVan, coldVanBogies);
  if (kind === "oiltank") return codeCarModel(mats, "oiltank", buildOilTanker, oilTankerBogies);
  if (kind === "crane") return codeCarModel(mats, "crane", buildBreakdownCrane, breakdownCraneBogies);
  if (kind === "carrier") return codeCarModel(mats, "carrier", buildCarCarrier, carCarrierBogies);
  if (kind === "mailvan") return codeCarModel(mats, "mailvan", buildMailVan, mailVanBogies);
  const lamp = new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 });
  // (Painted at the paint shop: its livery; else the classic engine's second scheme on every other one.)
  const recolor = kind === "engine" && livery ? liveryRecolor(look, livery) : variant === 1 && kind === "engine" && look === "classic" ? SECOND_SCHEME : {};
  const model = blenderCar(kind, look, mats, lamp, recolor, CAR_SLOTS[kind]);
  model.root.traverse((o) => (o.userData.carKind = kind));
  if (kind === "hopper" && !loaded) hideModelledLoad(model.root);
  return model;
}

/**
 * A hopper is modelled heaped with coal (its `coal…` nodes). On the track it starts empty, its open bin showing: the
 * load it carries is drawn by DepotView as a heap of its goods (`hopperLook`), so the coal is hidden once, here, and
 * nothing toggles it per frame. Only a picture of the car (a tray icon: `loaded`) keeps it.
 */
function hideModelledLoad(root: Object3D): void {
  root.traverse((o) => {
    if (o !== root && o.name.startsWith("coal")) o.visible = false;
  });
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

/** A wagon with a code model (no Blender one: the milk tank wagon, the cold van), lifted onto the rails as the cleaner is. */
function codeCarModel(mats: Materials, kind: CarKind, build: (k: Kit) => Group, bogies: (root: Object3D) => Object3D): CarModel {
  const kit = new Kit(mats, 0.5);
  const body = build(kit);
  body.position.y = AXLE_HEIGHT - 7.5;
  const root = new Group();
  root.add(body);
  const wheels: Object3D[] = [...bogies(body).children];
  root.traverse((o) => {
    o.userData.carKind = kind;
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
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
