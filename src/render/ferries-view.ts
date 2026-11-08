import { Frustum, Group, Matrix4, Mesh, Sphere, type Camera, type Object3D } from "three";
import { ferryPose, type Ferries, type FerryTrip } from "../game/ferry";
import type { Economy } from "../economy";
import type { Layout } from "../track";
import type { Sim } from "../sim";
import { CAR_SPECS } from "../sim/cars";
import { buildCarModel } from "./train-models";
import type { Materials } from "./materials";
import { modelKey, type PropLibrary } from "./props/library";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { FLOAT_Y } from "./boats-view";

/** The ferry's model (src/catalogue/assets/water.ts). */
const FERRY_ASSET = "water-train-ferry";
/** Its deck track's rail top, less the cars' own wheel depth (as the cars stand on track: model units, mm). */
const DECK_Y = 23;
/** Where the train's front stops on the deck (the ferry's x, by its buffer). */
const DECK_FRONT = 106;
const REACH = 200;
const FERRY_SIZE = 320;

interface Shown {
  root: Group;
  ferry: Object3D | null;
  /** The train's copy on deck, by its cars (a key), or none. */
  deck: Group | null;
  deckKey: string;
  placed: string;
  seen: boolean;
}

const frustum = new Frustum();
const viewProj = new Matrix4();
const sphere = new Sphere();

/**
 * The train ferries (Game mode's Train ferry): one at each ferry slip, tied up at its end, or sailing out to sea and
 * back with a copy of the train aboard on its deck (the train itself hidden where it stands meanwhile). Placed by game
 * time; a moving ferry asks for frames only in view and big enough to see (the ambient rule). Not loaded till a slip
 * stands on the map.
 */
export class FerriesView {
  readonly group = new Group();
  private readonly shown = new Map<number, Shown>();
  private model: Promise<Object3D | null> | null = null;
  private readonly slips = new Set<number>();
  private readonly aboard = new Set<number>();
  /** Cars hidden for a trip (shown again when they come off). */
  private readonly hidden = new Set<number>();
  shadowsStale = false;

  constructor(
    private readonly library: PropLibrary,
    private readonly mats: Materials,
    private readonly invalidate: () => void,
    private readonly carObject: (carId: number) => Object3D | undefined,
  ) {
    this.group.name = "ferries";
  }

  clear(): void {
    this.shown.clear();
    this.group.clear();
    this.hidden.clear();
  }

  update(ferries: Ferries, economy: Economy, layout: Layout, sim: Sim, extra: number, camera: Camera, eye: AmbientEye | null): boolean {
    let draw = false;
    // (Kept and cleared, not made: this runs every frame.)
    const slips = this.slips;
    const aboard = this.aboard;
    slips.clear();
    aboard.clear();
    for (const d of economy.allDepots()) {
      if (d.role !== "slip") continue;
      const piece = layout.getPiece(d.pieceId);
      if (!piece) continue;
      slips.add(d.id);
      let s = this.shown.get(d.id);
      if (!s) {
        s = { root: new Group(), ferry: null, deck: null, deckKey: "", placed: "", seen: true };
        this.shown.set(d.id, s);
        this.group.add(s.root);
        void this.load().then((m) => {
          if (!m || this.shown.get(d.id) !== s) return;
          s!.ferry = m.clone();
          s!.root.add(s!.ferry);
          s!.placed = "";
          this.invalidate();
        });
      }
      const trip = ferries.tripAt(d.id);
      for (const c of trip?.cars ?? []) aboard.add(c);
      this.dressDeck(s, trip, sim);
      const moving = !!trip && trip.phase !== "away";
      const at = ferryPose(piece.pose, trip, moving ? extra : 0);
      const sig = `${at.x.toFixed(1)},${at.z.toFixed(1)},${at.heading.toFixed(3)},${at.shown},${s.deckKey},${!!s.ferry}`;
      if (sig === s.placed) continue;
      s.placed = sig;
      s.root.visible = at.shown;
      s.root.position.set(at.x, FLOAT_Y, at.z);
      s.root.rotation.y = -at.heading;
      if (!moving) {
        this.invalidate();
        continue;
      }
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProj);
      sphere.center.set(at.x, FLOAT_Y, at.z);
      sphere.radius = REACH;
      const seen = frustum.intersectsSphere(sphere) && (!eye || eye.pixels(at.x, FLOAT_Y, at.z, FERRY_SIZE) >= AMBIENT_MIN_PX.boat);
      if (seen || s.seen) draw = true;
      else this.shadowsStale = true;
      s.seen = seen;
    }
    for (const [id, s] of this.shown) {
      if (slips.has(id)) continue;
      this.group.remove(s.root);
      this.shown.delete(id);
      this.invalidate();
    }
    // The train itself, hidden while it's aboard (asked of each car every frame: a car's model can be made again).
    for (const c of aboard) {
      const o = this.carObject(c);
      if (o && o.visible) {
        o.visible = false;
        this.invalidate();
      }
      this.hidden.add(c);
    }
    if (this.hidden.size > aboard.size) for (const c of this.hidden) {
      if (aboard.has(c)) continue;
      const o = this.carObject(c);
      if (o) o.visible = true;
      this.hidden.delete(c);
      this.invalidate();
    }
    return draw;
  }

  /** The train's copy on the ferry's deck, made when it goes aboard and dropped when it comes off. */
  private dressDeck(s: Shown, trip: FerryTrip | null, sim: Sim): void {
    const cars = trip ? trip.cars.map((id) => sim.findCar(id)).filter((f) => !!f) : [];
    const key = cars.map((f) => f!.train.cars[f!.index].id).join(",");
    if (key === s.deckKey) return;
    s.deckKey = key;
    if (s.deck) {
      s.root.remove(s.deck);
      s.deck = null;
    }
    if (cars.length === 0) return;
    const deck = new Group();
    let x = DECK_FRONT;
    cars.forEach((f, i) => {
      const car = f!.train.cars[f!.index];
      const spec = CAR_SPECS[car.kind];
      const m = buildCarModel(car.kind, this.mats, i, sim.lookOf(car.id), false).root;
      m.position.set(x - spec.length / 2, DECK_Y, 0);
      m.traverse((o) => {
        if ((o as Mesh).isMesh) o.castShadow = true;
      });
      deck.add(m);
      x -= spec.length + 6;
    });
    s.deck = deck;
    s.root.add(deck);
  }

  private load(): Promise<Object3D | null> {
    this.model ??= this.library
      .load(modelKey(FERRY_ASSET))
      .then((model) => {
        if (!model) return null;
        const g = new Group();
        for (const part of model.parts) {
          const m = new Mesh(part.geometry, part.material);
          m.userData.sharedGeometry = true;
          m.castShadow = true;
          g.add(m);
        }
        return g as Object3D;
      })
      .catch(() => null);
    return this.model;
  }
}
