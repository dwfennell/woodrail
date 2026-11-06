import { Box3, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type Object3D } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CarKind, CarLook } from "../sim";
import { TRACK_THICKNESS } from "../track";
import { Kit } from "../catalogue/kit";
import { buildTrackCleaner, trackCleanerBogies, trackCleanerBrushes } from "../catalogue/assets/track-cleaner";
import { buildMilkTanker, milkTankerBogies } from "../catalogue/assets/milk-tanker";
import { buildColdVan, coldVanBogies } from "../catalogue/assets/cold-van";
import { buildRoyalEngine, buildRoyalSaloon, royalBogies } from "../catalogue/assets/royal-train";
import { buildOilTanker, oilTankerBogies } from "../catalogue/assets/oil-tanker";
import { breakdownCraneBogies, buildBreakdownCrane } from "../catalogue/assets/breakdown-crane";
import { buildMailVan, buildSortingVan, mailVanBogies } from "../catalogue/assets/mail-van";
import { buildCarCarrier, carCarrierBogies } from "../catalogue/assets/car-carrier";
import { buildCircusCage, circusCageBogies } from "../catalogue/assets/circus-cage";
import { buildObservationCar, observationBogies } from "../catalogue/assets/observation-car";
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
  // (The rack engine is the tank engine's model, the metro's the electric's: painted, their own schemes give way.)
  rack: { body: ["#2f6db5"], trim: ["#c8442f"] },
  metro: { body: ["#c8442f"], trim: ["#f0ebe0"] },
};

/**
 * Wagons' modelled body and trim colours (tools/blender/trains.py), by kind and look, for your own colours from the
 * paint shop (game/paint-shop.ts). The code-modelled wagons (tank wagons, cold van, car carrier, …) aren't painted.
 */
export const WAGON_SLOTS: Readonly<Partial<Record<CarKind, Partial<Record<CarLook, { body: readonly string[]; trim: readonly string[] }>>>>> = {
  hopper: { classic: { body: ["#e6b52c"], trim: ["#2f6db5"] } },
  passenger: {
    classic: { body: ["#2f6db5"], trim: ["#f0ebe0"] },
    dining: { body: ["#7a2a3a"], trim: ["#f0ebe0"] },
    sleeper: { body: ["#1f3f73"], trim: ["#e6b52c"] },
    "double-decker": { body: ["#2d6b3f"], trim: ["#f0ebe0"] },
    "first-class": { body: ["#6e1f2e", "#4a1823"], trim: ["#d9a93a"] },
  },
  caboose: { classic: { body: ["#c8442f"], trim: ["#f0ebe0"] }, "bay-window": { body: ["#e6b52c"], trim: ["#7a4a2a"] } },
  timber: { classic: { body: ["#c8442f"], trim: [] } },
  // (The van's body is a slot, "lacquer slot body": painted, the livery's body; its cream doors and roof ribs take the trim.)
  van: { classic: { body: ["#7a4a2a"], trim: ["#f0ebe0"] } },
};

/** Can a car of `kind` and `look` be painted (an engine, or a wagon with its colours in `WAGON_SLOTS`)? */
export const paintable = (kind: CarKind, look: CarLook): boolean => (kind === "engine" ? !!LIVERY_SLOTS[look] : !!WAGON_SLOTS[kind]?.[look]);

/** A livery's recolour map for an engine of `look` (body and trim to the livery's). */
export function liveryRecolor(look: CarLook, livery: { body: string; trim: string }): Record<string, string> {
  const slots = LIVERY_SLOTS[look];
  const out: Record<string, string> = {};
  if (!slots) return out;
  for (const c of slots.body) out[c] = livery.body;
  for (const c of slots.trim) out[c] = livery.trim;
  return out;
}

/** A wagon's recolour map to a livery's colours (null: one that can't be painted). */
export function wagonRecolor(kind: CarKind, look: CarLook, livery: { body: string; trim: string }): Record<string, string> | null {
  const slots = WAGON_SLOTS[kind]?.[look];
  if (!slots) return null;
  const out: Record<string, string> = {};
  for (const c of slots.body) out[c] = livery.body;
  for (const c of slots.trim) out[c] = livery.trim;
  return out;
}

/** The metro train's colours over the electric engine's (red, cream) and the coach's (blue, cream): silver and red. */
const METRO_SCHEME: Readonly<Record<string, string>> = { "#c8442f": "#c9ccd1", "#2f6db5": "#c9ccd1", "#f0ebe0": "#c8442f" };

/** The rack engine's colours over the tank engine's (blue and red): claret and gold. */
const RACK_SCHEME: Readonly<Record<string, string>> = { "#2f6db5": "#7a2a3a", "#c8442f": "#d9a93a" };

/** The rack engine's cog: a toothed wheel between its frames, low over the rack's strip (it turns with the wheels). */
function rackCog(mats: Materials): Object3D {
  const cog = new Group();
  cog.name = "wheel_cog";
  const metal = mats.lacquer("#2a2b2e");
  const disc = new Mesh(new CylinderGeometry(6, 6, 5, 16), metal);
  disc.rotation.x = Math.PI / 2;
  cog.add(disc);
  for (let k = 0; k < 10; k++) {
    const tooth = new Mesh(new BoxGeometry(2.2, 3, 5), metal);
    const a = (k / 10) * Math.PI * 2;
    tooth.position.set(Math.cos(a) * 7, Math.sin(a) * 7, 0);
    tooth.rotation.z = a;
    cog.add(tooth);
  }
  // (Its lowest teeth just over the strip, 2.5 mm proud of the track's top.)
  cog.position.set(0, TRACK_THICKNESS + 2.5 + 8.5, 0);
  cog.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
  });
  return cog;
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
/** The van's body: goods brown, as its dark ribbed roof is (the coaches are lacquered, under a light clerestory roof). */
const CAR_SLOTS: Partial<Record<CarKind, Record<string, string>>> = { van: { body: "#7a4a2a" } };

/** Car facing +x, centred on its two axles, y = 0 at the track base. The models must be loaded (loadBlenderModels). */
export function buildCarModel(kind: CarKind, mats: Materials, variant = 0, look: CarLook = "classic", loaded = false, livery?: { body: string; trim: string; stripes?: readonly string[] }): CarModel {
  if (kind === "cleaner") return cleanerModel(mats);
  if (kind === "tanker") return codeCarModel(mats, "tanker", buildMilkTanker, milkTankerBogies);
  if (kind === "reefer") return codeCarModel(mats, "reefer", buildColdVan, coldVanBogies);
  if (kind === "oiltank") return codeCarModel(mats, "oiltank", buildOilTanker, oilTankerBogies);
  if (kind === "crane") return codeCarModel(mats, "crane", buildBreakdownCrane, breakdownCraneBogies);
  if (kind === "carrier") return codeCarModel(mats, "carrier", buildCarCarrier, carCarrierBogies);
  if (kind === "passenger" && look === "observation") return codeCarModel(mats, "passenger", buildObservationCar, observationBogies);
  if (kind === "mailvan") return codeCarModel(mats, "mailvan", buildMailVan, mailVanBogies);
  if (kind === "sortvan") return codeCarModel(mats, "sortvan", buildSortingVan, mailVanBogies);
  if (kind === "cage") return codeCarModel(mats, "cage", buildCircusCage, circusCageBogies);
  // The Royal Train (a grand project's reward, src/game/grand.ts): claret and gold, the saloon crowned.
  if (kind === "engine" && look === "royal") return codeCarModel(mats, "engine", (k) => buildRoyalEngine(k), royalBogies);
  if (kind === "passenger" && look === "royal") return codeCarModel(mats, "passenger", (k) => buildRoyalSaloon(k, { crown: true }), royalBogies);
  const lamp = new MeshStandardMaterial({ color: new Color("#ffcf6b"), emissive: new Color("#ffaa33"), emissiveIntensity: 0.2, roughness: 0.3 });
  const rack = kind === "engine" && look === "rack";
  const metro = look === "metro";
  // (Painted at the paint shop: its livery; else the classic engine's second scheme on every other one. The rack engine
  // is the tank engine's model in its own colours, with a cog under it; the metro train is the electric engine and a
  // coach in silver and red.)
  const wagon = kind !== "engine" && livery ? wagonRecolor(kind, look, livery) : null;
  const recolor = kind === "engine" && livery ? liveryRecolor(look, livery) : wagon ? wagon : rack ? RACK_SCHEME : metro ? METRO_SCHEME : variant === 1 && kind === "engine" && look === "classic" ? SECOND_SCHEME : {};
  // (A van painted: its body slot in the livery's colour.)
  const slots = kind === "van" && livery ? { body: livery.body } : CAR_SLOTS[kind];
  const model = blenderCar(kind, rack ? "tank" : metro ? (kind === "engine" ? "electric" : "classic") : look, mats, lamp, recolor, slots);
  if (rack) {
    const cog = rackCog(mats);
    model.root.add(cog);
    model.wheels.push(cog);
  }
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
