import { Group, Mesh, type Object3D } from "three";
import type { PlanePhase } from "../game/airports";
import type { Pose } from "../track";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { modelKey, type PropLibrary } from "./props/library";

/** The plane that calls at airports (a catalogue model). */
export const PLANE_ASSET = "veh-propeller-plane";
/** A plane's wingspan (mm), for the ambient rule. */
const PLANE_SIZE = 110;

/** An airport the view draws a plane for: where it stands, and where its plane is (by its clock). */
export interface AirportAt {
  readonly id: number;
  readonly pose: Pose;
  readonly y: number;
}

/** Where a plane is: from an airport's pose and its plane's phase (`planePose`). */
export type PlacePlane = (pose: Pose, y: number, phase: PlanePhase) => { x: number; y: number; z: number; heading: number; pitch: number } | null;

/**
 * Planes calling at airports (Game mode). Each airport's plane is posed from its clock (`phase`) on frames that are
 * drawn anyway, and asks for frames only while it's flying in view, drawn big enough to see it move (the ambient
 * rule: `AmbientEye`). Parked, it's drawn once; away, it's hidden. Out of view or zoomed out, a flying plane moves on
 * unseen and costs nothing.
 */
export class PlanesView {
  readonly group = new Group();
  private readonly planes = new Map<number, Object3D>();
  private model: Object3D | null = null;
  private loading = false;
  /** Each airport's phase as last drawn ("away", "parked" or a flight), to draw a frame when it changes. */
  private readonly shown = new Map<number, string>();

  constructor(
    private readonly library: PropLibrary,
    private readonly invalidate: () => void,
  ) {
    this.group.name = "planes";
  }

  /** How many planes are out (flying or parked). */
  get count(): number {
    let n = 0;
    for (const p of this.planes.values()) if (p.visible) n++;
    return n;
  }

  /**
   * Pose each airport's plane: `phase(id)` says where it is now. True if one flew in view (draw a frame); a change of
   * phase (landed, gone) asks for one frame by itself.
   */
  update(airports: readonly AirportAt[], phase: (id: number) => PlanePhase, place: PlacePlane, eye: AmbientEye | null, paused = false): boolean {
    let moving = false;
    const here = new Set<number>();
    for (const a of airports) {
      here.add(a.id);
      const ph = phase(a.id);
      const at = place(a.pose, a.y, ph);
      const kind = ph.kind;
      if (this.shown.get(a.id) !== kind) {
        this.shown.set(a.id, kind);
        this.invalidate();
      }
      let plane = this.planes.get(a.id);
      if (!at) {
        if (plane) plane.visible = false;
        continue;
      }
      if (!plane) {
        const made = this.make();
        if (!made) continue;
        plane = made;
        this.planes.set(a.id, plane);
        this.group.add(plane);
      }
      plane.visible = true;
      plane.position.set(at.x, at.y, at.z);
      plane.rotation.set(0, -at.heading, at.pitch, "YXZ");
      if (kind !== "parked" && !paused && (!eye || eye.sees(at.x, at.y, at.z, PLANE_SIZE, AMBIENT_MIN_PX.boat, PLANE_SIZE * 2))) moving = true;
    }
    for (const [id, plane] of this.planes)
      if (!here.has(id)) {
        this.group.remove(plane);
        this.planes.delete(id);
        this.shown.delete(id);
      }
    return moving;
  }

  /** Every plane gone (a new map). */
  clear(): void {
    for (const p of this.planes.values()) this.group.remove(p);
    this.planes.clear();
    this.shown.clear();
  }

  /** A plane (the model shared), or null while it loads (asked for: a frame is drawn when it's in). */
  private make(): Object3D | null {
    if (!this.model) {
      if (!this.loading) {
        this.loading = true;
        void this.library.load(modelKey(PLANE_ASSET)).then(
          (m) => {
            if (!m) return;
            const g = new Group();
            for (const part of m.parts) {
              const mesh = new Mesh(part.geometry, part.material);
              mesh.userData.sharedGeometry = true;
              mesh.castShadow = true;
              g.add(mesh);
            }
            this.model = g;
            this.invalidate();
          },
          () => (this.loading = false),
        );
      }
      return null;
    }
    return this.model.clone();
  }
}
