import { Frustum, Group, Matrix4, Mesh, Sphere, Vector3, type Camera, type Object3D } from "three";
import { BARGE_GOODS, BARGE_LOADS, isBulk, type Fleet } from "../game/boats";
import type { BoatState, CargoKind } from "../economy";
import { modelKey, type PropLibrary } from "./props/library";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { FLOAT_Y } from "./boats-view";
import { unitSize } from "./cargo-layout";

/** The tug's model, and each barge's by what it carries (the catalogue's water assets: src/catalogue/assets/water.ts). */
const TUG = "water-river-tug";
const BARGE: Record<CargoKind | "empty", string> = {
  empty: "water-barge",
  log: "water-barge-logs",
  stone: "water-barge-stone",
  ore: "water-barge-ore",
  coal: "water-barge-coal",
  grain: "water-barge-grain",
} as Record<CargoKind | "empty", string>;
/** Room round a tow's tug for the whole of it when asking if it's in view (mm). */
const REACH = 200;
/** A tug's length (mm), for the ambient rule: one drawn smaller than `AMBIENT_MIN_PX.boat` sails on unseen. */
const TUG_SIZE = 70;
/** A tap within this many px of a boat's tug or barge on screen is on it. */
const TAP_PX = 28;

/**
 * Each barge's loads, front barge first, four to a barge: heaped goods first (they fill the front barges), then made
 * goods, each in `BARGE_GOODS` order.
 */
export function bargeUnits(b: BoatState): CargoKind[][] {
  const units: CargoKind[] = [];
  for (const k of BARGE_GOODS) if (isBulk(k)) for (let i = 0; i < (b.load[k] ?? 0); i++) units.push(k);
  for (const k of BARGE_GOODS) if (!isBulk(k)) for (let i = 0; i < (b.load[k] ?? 0); i++) units.push(k);
  const out: CargoKind[][] = [];
  for (let i = 0; i < b.barges; i++) out.push(units.slice(i * BARGE_LOADS, i * BARGE_LOADS + BARGE_LOADS));
  return out;
}

/** Does a barge with these loads show them as units on its deck (any made good among them), not as a heap? */
const onDeck = (units: readonly CargoKind[]): boolean => units.some((k) => !isBulk(k));

/**
 * What each barge of a boat shows: a barge of heaped goods only, the heap model of the good most of its loads are; one
 * with any made good, the empty barge (its loads, heaped ones too, ride on its deck as units: `deckSlot`); empty, empty.
 */
export function bargeLooks(b: BoatState): string[] {
  return bargeUnits(b).map((mine) => {
    if (mine.length === 0 || onDeck(mine)) return BARGE.empty;
    const counts = new Map<CargoKind, number>();
    for (const k of mine) counts.set(k, (counts.get(k) ?? 0) + 1);
    let best: CargoKind | null = null;
    for (const [k, n] of counts) if (!best || n > counts.get(best)!) best = k;
    return BARGE[best ?? "empty"] ?? BARGE.empty;
  });
}

/** The top of a barge's hold floor (the model's, `HOLD` in src/catalogue/assets/water.ts), where its loads stand. */
export const BARGE_HOLD = 13.4;
/** Half a barge's hold, along it (mm): its loads stand two to a half. */
const BAY = 18.5;

/**
 * Where the k-th of a barge's four loads (0–3) stands on its deck, barge-local (x along it, y up from its keel, z
 * across), and how much shorter it's drawn along x (a log, 54 long, is cut to fit half the hold). Loads 0 and 1 stand
 * in the front half, 2 and 3 in the back: side by side across where two fit (crates, sacks, toy cars, logs), one on
 * the other where they don't (plank and iron bundles).
 */
export function deckSlot(kind: CargoKind, k: number): { x: number; y: number; z: number; sx: number } {
  const size = unitSize(kind);
  const x = (k < 2 ? 1 : -1) * BAY;
  const second = k % 2 === 1;
  if (kind === "planks" || kind === "iron") return { x, y: BARGE_HOLD + size.y / 2 + (second ? size.y : 0), z: 0, sx: 1 };
  const sx = size.x > BAY * 2 - 2 ? (BAY * 2 - 2) / size.x : 1;
  return { x, y: BARGE_HOLD + size.y / 2, z: (second ? 1 : -1) * (size.z / 2 + 0.4), sx };
}

/** Made goods riding on barges' decks: drawn by the depots' instanced loads (`DepotView.boatLoads`), no draw call of their own. */
export interface BoatLoads {
  /** Changes whenever a load on a deck should be placed again (one moved in view, or loads changed). */
  readonly loadsVersion: number;
  /** Each unit on a deck, its world matrix (`m`, reused: copy it). */
  forEachLoad(put: (kind: CargoKind, m: Matrix4) => void): void;
}

const _unit = new Matrix4();
const _scale = new Matrix4();

interface Shown {
  root: Group;
  /** The models it was made with (the tug's and each barge's): made again when what it carries changes. */
  key: string;
  /** Its parts, front to back, once loaded. */
  parts: Object3D[];
  /** Where it was last placed (a signature), so a still boat isn't placed again. */
  placed: string;
  /** Was it in view at the last frame (its leaving the view is drawn too)? */
  seen: boolean;
  /** Each barge's loads that ride on its deck (none for a heap or an empty barge), front barge first. */
  decks: CargoKind[][];
  /** `decks`, as a signature. */
  deckKey: string;
}

const frustum = new Frustum();
const viewProj = new Matrix4();
const sphere = new Sphere();
const v = new Vector3();

/**
 * The player's boats (Game mode's River barges): a tug and its barges for each, placed along the water by game time
 * (`Fleet.poses`), so a paused game holds them still. A moving boat asks for a frame only while it's in view and drawn
 * big enough to see (the ambient rule, `AmbientEye`); a tied-up one costs nothing. Models are the catalogue's, shared.
 */
export class RiverBoatsView implements BoatLoads {
  readonly group = new Group();
  /** See `BoatLoads`. */
  loadsVersion = 0;
  private readonly shown = new Map<number, Shown>();
  /** Loaded models by asset (the library's parts, baked: one load each). */
  private readonly models = new Map<string, Promise<Object3D | null>>();
  /** A boat moved while out of view since the shadows were last drawn for it. */
  shadowsStale = false;

  constructor(
    private readonly library: PropLibrary,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "river-boats";
  }

  /** Every boat gone at once (a new map). */
  clear(): void {
    this.shown.clear();
    this.loadsVersion++;
    this.group.clear();
  }

  get count(): number {
    return this.shown.size;
  }

  /**
   * Make, change and place the boats: `extra` seconds of game time since the fleet's last tick. True if a moving one is
   * in view (a frame should be drawn).
   */
  update(fleet: Fleet, boats: ReadonlyMap<number, BoatState>, extra: number, camera: Camera, eye: AmbientEye | null, piecesVersion = 0): boolean {
    if (boats.size === 0 && this.shown.size === 0) return false;
    // Gone.
    for (const [id, s] of this.shown) {
      if (boats.has(id)) continue;
      if (s.deckKey) this.loadsVersion++;
      this.group.remove(s.root);
      this.shown.delete(id);
      this.invalidate();
    }
    let draw = false;
    let frustumSet = false;
    for (const b of boats.values()) {
      const looks = bargeLooks(b);
      const key = `${TUG}|${looks.join(",")}`;
      const units = bargeUnits(b);
      const decks = units.map((mine) => (onDeck(mine) ? mine : []));
      const deckKey = decks.some((d) => d.length > 0) ? decks.map((d) => d.join("+")).join(",") : "";
      let s = this.shown.get(b.id);
      if (!s || s.key !== key) {
        if (s) this.group.remove(s.root);
        if (s?.deckKey) this.loadsVersion++;
        s = { root: new Group(), key, parts: [], placed: "", seen: true, decks: [], deckKey: "" };
        s.root.name = `boat-${b.id}`;
        s.root.userData.boatId = b.id;
        this.shown.set(b.id, s);
        this.group.add(s.root);
        void this.build(s, [TUG, ...looks]);
      }
      if (s.deckKey !== deckKey) {
        s.decks = decks;
        s.deckKey = deckKey;
        this.loadsVersion++;
      }
      if (s.parts.length === 0) continue;
      const moving = !b.docked && b.going && b.stops.length >= 2;
      // A still boat is placed again only when where it lies may have changed (its stop, its route, the pieces).
      const sig = moving ? "" : `${b.from}|${b.docked}|${b.t > 0 ? 1 : 0}|${b.stops.length}|${b.going}|${piecesVersion}`;
      if (!moving && sig === s.placed) continue;
      s.placed = sig;
      const poses = fleet.poses(b, moving ? extra : 0);
      poses.forEach((p, i) => {
        const part = s!.parts[i];
        if (!part) return;
        part.position.set(p.x, FLOAT_Y, p.z);
        part.rotation.y = -p.heading;
      });
      if (!moving) {
        // (A boat tying up, or a landing moved: drawn once.)
        if (s.deckKey) this.loadsVersion++;
        this.invalidate();
        continue;
      }
      if (!frustumSet) {
        viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProj);
        frustumSet = true;
      }
      const lead = poses[0];
      sphere.center.set(lead.x, FLOAT_Y, lead.z);
      sphere.radius = REACH;
      const seen = frustum.intersectsSphere(sphere) && (!eye || eye.pixels(lead.x, FLOAT_Y, lead.z, TUG_SIZE) >= AMBIENT_MIN_PX.boat);
      if (seen || s.seen) {
        draw = true;
        // (Its deck's loads follow it while it's seen, and once more as it leaves the view.)
        if (s.deckKey) this.loadsVersion++;
      } else this.shadowsStale = true;
      s.seen = seen;
    }
    return draw;
  }

  forEachLoad(put: (kind: CargoKind, m: Matrix4) => void): void {
    for (const s of this.shown.values()) {
      if (!s.deckKey) continue;
      s.decks.forEach((units, i) => {
        // (Part 0 is the tug.)
        const part = s.parts[i + 1];
        if (!part || units.length === 0) return;
        part.updateWorldMatrix(true, false);
        units.forEach((kind, k) => {
          const at = deckSlot(kind, k);
          _unit.makeTranslation(at.x, at.y, at.z);
          if (at.sx !== 1) _unit.multiply(_scale.makeScale(at.sx, 1, 1));
          put(kind, _unit.premultiply(part.matrixWorld));
        });
      });
    }
  }

  /** The boat whose tug or barges are within a fingertip of (x, y) on the canvas (client px), or −1. */
  boatAt(x: number, y: number, camera: Camera, rect: DOMRect): number {
    let best = -1;
    let bestD = TAP_PX;
    for (const [id, s] of this.shown) {
      for (const part of s.parts) {
        v.set(part.position.x, part.position.y + 10, part.position.z).project(camera);
        if (v.z > 1) continue;
        const sx = rect.left + ((v.x + 1) / 2) * rect.width;
        const sy = rect.top + ((1 - v.y) / 2) * rect.height;
        const d = Math.hypot(sx - x, sy - y);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
    }
    return best;
  }

  /** The tug's model of a boat (for the camera to look at), or null. */
  tugOf(boatId: number): Object3D | null {
    return this.shown.get(boatId)?.parts[0] ?? null;
  }

  private async build(s: Shown, assets: string[]): Promise<void> {
    const models = await Promise.all(assets.map((a) => this.model(a)));
    // Made again, or gone, while the models loaded.
    if (this.shown.get(s.root.userData.boatId) !== s) return;
    for (const m of models) {
      const part = new Group();
      if (m) for (const c of m.children) part.add(c.clone());
      s.root.add(part);
      s.parts.push(part);
    }
    s.placed = "";
    if (s.deckKey) this.loadsVersion++;
    this.invalidate();
  }

  private model(asset: string): Promise<Object3D | null> {
    let p = this.models.get(asset);
    if (!p) {
      p = this.library
        .load(modelKey(asset))
        .then((model) => {
          if (!model) return null;
          const g = new Group();
          for (const part of model.parts) {
            const m = new Mesh(part.geometry, part.material);
            // (The library owns the geometry.)
            m.userData.sharedGeometry = true;
            m.castShadow = true;
            g.add(m);
          }
          return g as Object3D;
        })
        .catch(() => null);
      this.models.set(asset, p);
    }
    return p;
  }
}
