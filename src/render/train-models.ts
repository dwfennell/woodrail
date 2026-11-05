import { Box3, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CarKind, CarLook } from "../sim";
import { TRACK_THICKNESS } from "../track";
import { Kit } from "../catalogue/kit";
import { buildTrackCleaner, trackCleanerBogies, trackCleanerBrushes } from "../catalogue/assets/track-cleaner";
import { buildMilkTanker, milkTankerBogies } from "../catalogue/assets/milk-tanker";
import { buildColdVan, coldVanBogies } from "../catalogue/assets/cold-van";
import { buildOilTanker, oilTankerBogies } from "../catalogue/assets/oil-tanker";
import { breakdownCraneBogies, buildBreakdownCrane } from "../catalogue/assets/breakdown-crane";
import { buildMailVan, buildSortingVan, mailVanBogies } from "../catalogue/assets/mail-van";
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

/** A body panel shorter or lower than this (mm) gets no stripe (a dome, a handrail, a lamp's box). */
const STRIPE_MIN_LENGTH = 14;
const STRIPE_MIN_HEIGHT = 7;
/** One band of a stripe: its height and how far it stands off the panel (mm). */
const BAND = 1.1;
const BAND_DEPTH = 0.5;

/**
 * A livery's painted stripe (paint shop's Lined and Rainbow): along each side of every body-coloured panel big enough
 * for one (`body`: the livery's body material), a band of `colours` stacked top to bottom, at the panel's middle
 * height and widest point (on a boiler too: a band where its round side stands out most). Built once with the car's
 * model (paint is rare): one merged mesh per colour, lacquer materials from the shared cache.
 */
export function addStripes(root: Object3D, mats: Materials, body: readonly Material[], colours: readonly string[]): number {
  if (body.length === 0 || colours.length === 0) return 0;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const panels: Box3[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || !body.includes(m.material as Material)) return;
    m.geometry.computeBoundingBox();
    const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv);
    if (box.max.x - box.min.x >= STRIPE_MIN_LENGTH && box.max.y - box.min.y >= STRIPE_MIN_HEIGHT) panels.push(box);
  });
  const parts: BufferGeometry[][] = colours.map(() => []);
  for (const box of panels) {
    const length = box.max.x - box.min.x - 4;
    // The band: its colours stacked, no more than half the panel's height.
    const band = Math.min(BAND, ((box.max.y - box.min.y) * 0.5) / colours.length);
    const mid = (box.min.y + box.max.y) / 2 + (band * colours.length) / 2;
    const x = (box.min.x + box.max.x) / 2;
    colours.forEach((_, i) => {
      for (const z of [box.max.z + BAND_DEPTH / 2 - 0.1, box.min.z - BAND_DEPTH / 2 + 0.1]) parts[i].push(new BoxGeometry(length, band, BAND_DEPTH).translate(x, mid - band * (i + 0.5), z));
    });
  }
  let made = 0;
  colours.forEach((c, i) => {
    if (parts[i].length === 0) return;
    const mesh = new Mesh(mergeGeometries(parts[i])!, mats.lacquer(c));
    mesh.name = "livery-stripe";
    mesh.castShadow = false;
    root.add(mesh);
    made++;
  });
  return made;
}

/** Colours of a car's slots (the van's body). */
const CAR_SLOTS: Partial<Record<CarKind, Record<string, string>>> = { van: { body: "#2f6db5" } };

/** Car facing +x, centred on its two axles, y = 0 at the track base. The models must be loaded (loadBlenderModels). */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0, look: CarLook = "classic", loaded = false, livery?: { body: string; trim: string; stripes?: readonly string[] }): CarModel {
  if (kind === "cleaner") return cleanerModel(mats);
  if (kind === "tanker") return codeCarModel(mats, "tanker", buildMilkTanker, milkTankerBogies);
  if (kind === "reefer") return codeCarModel(mats, "reefer", buildColdVan, coldVanBogies);
  if (kind === "oiltank") return codeCarModel(mats, "oiltank", buildOilTanker, oilTankerBogies);
  if (kind === "crane") return codeCarModel(mats, "crane", buildBreakdownCrane, breakdownCraneBogies);
  if (kind === "carrier") return codeCarModel(mats, "carrier", buildCarCarrier, carCarrierBogies);
  if (kind === "mailvan") return codeCarModel(mats, "mailvan", buildMailVan, mailVanBogies);
  if (kind === "sortvan") return codeCarModel(mats, "sortvan", buildSortingVan, mailVanBogies);
  const lamp = new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 });
  // (Painted at the paint shop: its livery; else the classic engine's second scheme on every other one.)
  const recolor = kind === "engine" && livery ? liveryRecolor(look, livery) : variant === 1 && kind === "engine" && look === "classic" ? SECOND_SCHEME : {};
  const model = blenderCar(kind, look, mats, lamp, recolor, CAR_SLOTS[kind]);
  // (A lined or rainbow livery: its stripe painted along the body's sides.)
  if (kind === "engine" && livery?.stripes?.length) addStripes(model.root, mats, LIVERY_SLOTS[look] ? [mats.lacquer(livery.body)] : [], livery.stripes);
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
