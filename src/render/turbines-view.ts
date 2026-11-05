import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import type { Prop, PropStore } from "../props/store";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { modelKey, SPINNERS, type PropLibrary, type Spinner } from "./props/library";

/** A wind turbine's rotor across (mm), for the ambient rule. */
const ROTOR_SIZE = 180;
/** How fast a rotor turns (radians a second of game time). */
export const ROTOR_SPEED = 1.2;
const START = 8;

const m = new Matrix4();
const turn = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const scale = new Vector3();

interface Placed {
  readonly key: string;
  /** Its rotor's frame at rest, in the world. */
  readonly base: Matrix4;
  /** Where its hub is (world), for the ambient rule. */
  readonly hub: Vector3;
}

/**
 * Wind turbines' rotors (the props in `SPINNERS`; each prop is drawn bare of its rotor by the props view). Every rotor
 * is an instance of one `InstancedMesh` per part (one per material: a draw call or two however many turbines).
 *
 * Ambient motion (AGENTS.md): the rotors turn by the game's clock, and ask for a frame only while one is on screen and
 * drawn at least `AMBIENT_MIN_PX.blade` across (`AmbientEye`), never while the game is paused. Out of view or zoomed
 * out they stand still and cost nothing; `sync` touches them only when the props change.
 */
export class TurbinesView {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private placed: Placed[] = [];
  private propsVersion = -1;
  private hidden = -1;
  private angle = 0;
  private spinner: Spinner | undefined;
  /**
   * Less motion (as `DepotView.calm`): the player asks for it (`prefers-reduced-motion`), or an e2e holds industries
   * still (`window.__woodrailStillIndustries`): the rotors stand still.
   */
  calm =
    !!(globalThis as { __woodrailStillIndustries?: unknown }).__woodrailStillIndustries ||
    (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

  constructor(private readonly library: PropLibrary) {
    this.group.name = "turbines";
  }

  /** How many rotors are drawn. */
  get count(): number {
    return this.placed.length;
  }

  /**
   * The turbines on the map now (`hidden`: one being moved by hand, drawn by the hand). Cheap when nothing changed (a
   * version compared). A rotor whose model isn't loaded yet is asked for: `force` once it is.
   */
  sync(props: Pick<PropStore, "version" | "all">, hidden = -1, force = false): boolean {
    if (props.version === this.propsVersion && hidden === this.hidden && !force) return false;
    this.propsVersion = props.version;
    this.hidden = hidden;
    const placed: Placed[] = [];
    for (const p of props.all()) {
      if (!SPINNERS[p.asset] || p.id === hidden || p.storeys) continue;
      const key = modelKey(p.asset, p.variant);
      const spinner = this.library.spinner(key);
      if (!spinner) {
        // (Loaded with the prop's own model: the props view asks for it. Synced again when it's in.)
        continue;
      }
      this.spinner ??= spinner;
      placed.push(this.place(p, spinner, key));
    }
    this.placed = placed;
    this.rebuild();
    return true;
  }

  /**
   * Turn the rotors on by `dt` seconds of game time: true if one in view turned (draw a frame). Paused, or none seen
   * and big enough to see turning, nothing moves and nothing is drawn.
   */
  update(dt: number, paused: boolean, eye: AmbientEye): boolean {
    if (this.placed.length === 0 || paused || this.calm) return false;
    let seen = false;
    for (const t of this.placed)
      if (eye.sees(t.hub.x, t.hub.y, t.hub.z, ROTOR_SIZE, AMBIENT_MIN_PX.blade)) {
        seen = true;
        break;
      }
    if (!seen) return false;
    this.angle = (this.angle + dt * ROTOR_SPEED) % (Math.PI * 2);
    this.pose();
    return true;
  }

  /** The rotors' angle now (for checks). */
  get turned(): number {
    return this.angle;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.dispose();
      this.group.remove(mesh);
    }
    this.meshes.length = 0;
    this.placed = [];
    this.propsVersion = -1;
  }

  private place(p: Prop, spinner: Spinner, key: string): Placed {
    const model = new Matrix4().compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, -p.heading), scale.setScalar(p.scale ?? 1));
    const base = model.multiply(spinner.base);
    return { key, base, hub: new Vector3().setFromMatrixPosition(base) };
  }

  /** One instanced mesh per rotor part, with room for every rotor; posed. */
  private rebuild(): void {
    const spinner = this.spinner;
    const n = this.placed.length;
    if (!spinner) return;
    if (this.meshes.length === 0 || this.meshes[0].instanceMatrix.count < n) {
      for (const mesh of this.meshes) {
        mesh.dispose();
        this.group.remove(mesh);
      }
      this.meshes.length = 0;
      const room = Math.max(START, n * 2);
      for (const part of spinner.parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, room);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = "turbine rotor";
        this.meshes.push(mesh);
        this.group.add(mesh);
      }
    }
    for (const mesh of this.meshes) mesh.count = n;
    this.pose();
  }

  private pose(): void {
    turn.makeRotationX(this.angle);
    for (let i = 0; i < this.placed.length; i++) {
      m.multiplyMatrices(this.placed[i].base, turn);
      for (const mesh of this.meshes) mesh.setMatrixAt(i, m);
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
