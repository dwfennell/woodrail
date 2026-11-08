import { Frustum, Group, Matrix4, Mesh, Sphere, Vector3, type Camera, type Object3D } from "three";
import { BULK, type Fleet } from "../game/boats";
import type { BoatState, CargoKind } from "../economy";
import { modelKey, type PropLibrary } from "./props/library";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { FLOAT_Y } from "./boats-view";

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

/** What each barge of a boat shows: the good most of its four loads are (front barge first), or empty. */
export function bargeLooks(b: BoatState): string[] {
  const units: CargoKind[] = [];
  for (const k of BULK) for (let i = 0; i < (b.load[k] ?? 0); i++) units.push(k);
  const out: string[] = [];
  for (let i = 0; i < b.barges; i++) {
    const mine = units.slice(i * 4, i * 4 + 4);
    const counts = new Map<CargoKind, number>();
    for (const k of mine) counts.set(k, (counts.get(k) ?? 0) + 1);
    let best: CargoKind | null = null;
    for (const [k, n] of counts) if (!best || n > counts.get(best)!) best = k;
    out.push(BARGE[best ?? "empty"] ?? BARGE.empty);
  }
  return out;
}

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
export class RiverBoatsView {
  readonly group = new Group();
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
      this.group.remove(s.root);
      this.shown.delete(id);
      this.invalidate();
    }
    let draw = false;
    let frustumSet = false;
    for (const b of boats.values()) {
      const looks = bargeLooks(b);
      const key = `${TUG}|${looks.join(",")}`;
      let s = this.shown.get(b.id);
      if (!s || s.key !== key) {
        if (s) this.group.remove(s.root);
        s = { root: new Group(), key, parts: [], placed: "", seen: true };
        s.root.name = `boat-${b.id}`;
        s.root.userData.boatId = b.id;
        this.shown.set(b.id, s);
        this.group.add(s.root);
        void this.build(s, [TUG, ...looks]);
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
      if (seen || s.seen) draw = true;
      else this.shadowsStale = true;
      s.seen = seen;
    }
    return draw;
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
