import { DynamicDrawUsage, Group, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry, type Material } from "three";
import type { Prop, PropStore } from "../props/store";
import { AMBIENT_MIN_PX, type AmbientEye } from "./ambient";
import { modelKey, SPINNERS, type PropLibrary, type Spinner } from "./props/library";

/** How fast a rotor turns (radians a second of game time). */
export const ROTOR_SPEED = 1.2;
/** How fast the World's Fair wheel turns (a grand project's: src/game/grand.ts): a turn in about 40 s, slowly. */
export const WHEEL_SPEED = 0.15;
const START = 8;

/**
 * Each spinning model's motion: the axis its part turns about (its own frame), how fast, and how big it is (mm across,
 * for the ambient rule: drawn turning only while at least `AMBIENT_MIN_PX.blade` across on screen).
 */
const SPINS: Readonly<Record<string, { axis: "x" | "z"; speed: number; size: number }>> = {
  "mech-wind-turbine": { axis: "x", speed: ROTOR_SPEED, size: 180 },
  "grand-ferris-wheel-3": { axis: "z", speed: WHEEL_SPEED, size: 260 },
};

const m = new Matrix4();
const turn = new Matrix4();
const back = new Matrix4();
const step = new Matrix4();
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const scale = new Vector3();
const v = new Vector3();

interface Placed {
  /** Its spinner's frame at rest, in the world. */
  readonly base: Matrix4;
  /** Where its hub is (world), for the ambient rule. */
  readonly hub: Vector3;
}

/** The spinners of one model (one kind): their meshes (the spinning part's, then its riders'), and where each stands. */
interface Kind {
  readonly spinner: Spinner;
  readonly spin: { axis: "x" | "z"; speed: number; size: number };
  placed: Placed[];
  readonly meshes: InstancedMesh[];
  readonly riderMeshes: InstancedMesh[];
}

/**
 * Spinning parts of props (the models in `SPINNERS`; each prop is drawn bare of its spinner by the props view): wind
 * turbines' rotors, and the World's Fair wheel with its gondolas riding round upright (`RIDERS`). Each kind of spinner
 * is one `InstancedMesh` per part (a draw call or two however many there are), its riders the same.
 *
 * Ambient motion (AGENTS.md): they turn by the game's clock, and ask for a frame only while one is on screen and drawn
 * at least `AMBIENT_MIN_PX.blade` across (`AmbientEye`), never while the game is paused. Out of view or zoomed out they
 * stand still and cost nothing; `sync` touches them only when the props change.
 */
export class TurbinesView {
  readonly group = new Group();
  private kinds = new Map<string, Kind>();
  private propsVersion = -1;
  private hidden = -1;
  /** Game time turned so far (s): each kind's angle is this times its speed. */
  private time = 0;
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

  /** How many spinners are drawn. */
  get count(): number {
    let n = 0;
    for (const k of this.kinds.values()) n += k.placed.length;
    return n;
  }

  /**
   * The spinners on the map now (`hidden`: one being moved by hand, drawn by the hand). Cheap when nothing changed (a
   * version compared). A spinner whose model isn't loaded yet is asked for: `force` once it is.
   */
  sync(props: Pick<PropStore, "version" | "all">, hidden = -1, force = false): boolean {
    if (props.version === this.propsVersion && hidden === this.hidden && !force) return false;
    this.propsVersion = props.version;
    this.hidden = hidden;
    for (const k of this.kinds.values()) k.placed = [];
    for (const p of props.all()) {
      const spin = SPINS[p.asset];
      if (!SPINNERS[p.asset] || !spin || p.id === hidden || p.storeys) continue;
      const key = modelKey(p.asset, p.variant);
      const spinner = this.library.spinner(key);
      // (Loaded with the prop's own model: the props view asks for it. Synced again when it's in.)
      if (!spinner) continue;
      let kind = this.kinds.get(key);
      if (!kind) this.kinds.set(key, (kind = { spinner, spin, placed: [], meshes: [], riderMeshes: [] }));
      kind.placed.push(this.place(p, spinner));
    }
    for (const kind of this.kinds.values()) this.rebuild(kind);
    return true;
  }

  /**
   * Turn the spinners on by `dt` seconds of game time: true if one in view turned (draw a frame). Paused, or none seen
   * and big enough to see turning, nothing moves and nothing is drawn.
   */
  update(dt: number, paused: boolean, eye: AmbientEye): boolean {
    if (paused || this.calm) return false;
    let seen = false;
    for (const k of this.kinds.values()) {
      for (const t of k.placed)
        if (eye.sees(t.hub.x, t.hub.y, t.hub.z, k.spin.size, AMBIENT_MIN_PX.blade)) {
          seen = true;
          break;
        }
      if (seen) break;
    }
    if (!seen) return false;
    // (A whole turn of the slowest every few hundred seconds: kept small so the angle stays exact.)
    this.time = (this.time + dt) % 4000;
    for (const k of this.kinds.values()) this.pose(k);
    return true;
  }

  /** The rotors' angle now (for checks): the turbines'. */
  get turned(): number {
    return (this.time * ROTOR_SPEED) % (Math.PI * 2);
  }

  dispose(): void {
    for (const k of this.kinds.values())
      for (const mesh of [...k.meshes, ...k.riderMeshes]) {
        mesh.dispose();
        this.group.remove(mesh);
      }
    this.kinds.clear();
    this.propsVersion = -1;
  }

  private place(p: Prop, spinner: Spinner): Placed {
    const model = new Matrix4().compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, -p.heading), scale.setScalar(p.scale ?? 1));
    const base = model.multiply(spinner.base);
    return { base, hub: new Vector3().setFromMatrixPosition(base) };
  }

  /** One instanced mesh per part (and per rider part), with room for every spinner (and all their riders); posed. */
  private rebuild(kind: Kind): void {
    const n = kind.placed.length;
    const riders = kind.spinner.riders;
    const perRiders = riders?.at.length ?? 0;
    if (kind.meshes.length === 0 || kind.meshes[0].instanceMatrix.count < n) {
      for (const mesh of [...kind.meshes, ...kind.riderMeshes]) {
        mesh.dispose();
        this.group.remove(mesh);
      }
      kind.meshes.length = 0;
      kind.riderMeshes.length = 0;
      const room = Math.max(START, n * 2);
      const make = (part: { geometry: BufferGeometry; material: Material }, count: number, into: InstancedMesh[]) => {
        const mesh = new InstancedMesh(part.geometry, part.material, count);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.name = "spinner";
        into.push(mesh);
        this.group.add(mesh);
      };
      for (const part of kind.spinner.parts) make(part, room, kind.meshes);
      if (riders) for (const part of riders.parts) make(part, room * perRiders, kind.riderMeshes);
    }
    for (const mesh of kind.meshes) mesh.count = n;
    for (const mesh of kind.riderMeshes) mesh.count = n * perRiders;
    // Riders of their own colours: each instance of the painted part tinted (its white parts take it), set once here.
    if (riders?.tints) {
      for (const mesh of kind.riderMeshes) {
        if (!(mesh.material as Material & { vertexColors?: boolean }).vertexColors) continue;
        for (let i = 0; i < n; i++) for (let j = 0; j < perRiders; j++) mesh.setColorAt(i * perRiders + j, riders.tints[j]);
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.pose(kind);
  }

  private pose(kind: Kind): void {
    const a = (this.time * kind.spin.speed) % (Math.PI * 2);
    if (kind.spin.axis === "x") turn.makeRotationX(a);
    else turn.makeRotationZ(a);
    const riders = kind.spinner.riders;
    for (let i = 0; i < kind.placed.length; i++) {
      const base = kind.placed[i].base;
      m.multiplyMatrices(base, turn);
      for (const mesh of kind.meshes) mesh.setMatrixAt(i, m);
      if (!riders) continue;
      // Each rider where the spinner has carried it, upright (the spinner's turn not passed on to it).
      for (let j = 0; j < riders.at.length; j++) {
        v.copy(riders.at[j]).applyMatrix4(turn);
        step.makeTranslation(v.x, v.y, v.z);
        back.multiplyMatrices(base, step);
        for (const mesh of kind.riderMeshes) mesh.setMatrixAt(i * riders.at.length + j, back);
      }
    }
    // (Two loops, not a spread: this runs on each frame a spinner is seen.)
    for (const mesh of kind.meshes) mesh.instanceMatrix.needsUpdate = true;
    for (const mesh of kind.riderMeshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
