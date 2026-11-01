/**
 * Signal marks on joints (docs/superpowers/specs/2026-10-31-signals.md §4, §5): a post on the driver's right of each
 * mark, its head red or green as the sim shows it. Drawn instanced (one draw for the posts, one for the heads), worked
 * out again only when the marks, the track or an aspect changed (`sync` returns true then: the caller redraws). And the
 * block tint shown while a signal is held or its card is open: one mesh, built when its joint changes.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, Vector3, type Camera, type Material } from "three";
import { createSample, getPieceDef, pathLength, pieceOfRef, samplePath, TRACK_WIDTH, type Layout, type PieceTypeId } from "../track";
import { jointPose, postAt, type Block, type JointPose } from "../game/signal-place";
import { kitModelKey } from "./props/library";
import type { Materials } from "./materials";

const POST_H = 46;

/** What the view reads of the sim: each mark's aspect (true: clear). */
export interface MarkAspects {
  markClear(id: number): boolean;
  readonly signalsVersion: number;
}

/** A model's style as drawn: a mark's own, or a gantry over two marks side by side on double track (decision 7). */
type Look = "plain" | "semaphore" | "colour-light" | "gantry";

/** The signal piece's length: a model is drawn in its piece's frame, its far end (x = this) on the mark's joint. */
const PIECE_LENGTH = 144;
/** The old toy semaphore (a signal piece's, as TrackView draws it): where its post stands in the piece's frame. */
const TOY_SIDE = TRACK_WIDTH / 2 + 9 + 4;
const TOY_HEIGHT = 54;
const TOY_RAISED = 0.75;
/** The semaphore kit's arm raised at clear (as the kit's motion). */
const SEMAPHORE_CLEAR = 0.7;
/** How long an arm takes to glide between red and clear (s). */
export const ARM_GLIDE_S = 0.3;
/** Roads of double track a gantry spans: this far apart (mm), side by side. */
const ROADS = 72;

/** One part of a look: its geometry and material, its frame in the model, and whether it's a moving arm or a lens. */
interface Part {
  geometry: BufferGeometry;
  material: Material;
  /** The part's frame in the model's (an arm's pivot, unrotated). */
  frame: Matrix4;
  role: "fixed" | "arm" | "red" | "green";
  /** A gantry's lens: which road's head (0 or 1, in the model's frame). */
  head?: number;
  /** For an arm: its rotation about x at red and at clear. */
  red?: number;
  clear?: number;
  shadow: boolean;
}

/** A part drawn instanced for every mark (or gantry) of its look: one draw however many there are. */
interface Batch {
  part: Part;
  mesh: InstancedMesh;
  /** Instances (marks' indices into `MarkShown`) this frame: for a lens, those lit that colour. */
  n: number;
}

interface MarkShown {
  id: number;
  look: Look;
  /** The model's frame in the world (for a gantry, its road 0's mark's). */
  world: Matrix4;
  /** The road this mark's head is over (a gantry's: 0 or 1), its arm's angle now, and gliding from/to. */
  road: number;
  clear: boolean;
  held: boolean;
  angle: number;
  from: number;
  to: number;
  t: number;
  /** Where its post's top (a gantry's: its head) is, for picking. */
  top: Vector3;
  /** A gantry's other mark (its drawing is the first's), or −1. */
  partner: number;
}

/** The library the kit models come from (the semaphore's, the colour light's and the gantry's). */
export interface MarkModels {
  model(key: string): { parts: readonly { geometry: BufferGeometry; material: Material }[] } | null | undefined;
  load(key: string): Promise<unknown>;
  moversOf(type: PieceTypeId): Group | undefined;
}

const KIT_OF: Record<Exclude<Look, "plain">, PieceTypeId> = { semaphore: "kit-semaphore-signal", "colour-light": "kit-colour-light-signal", gantry: "kit-signal-gantry" };

export class SignalMarksView {
  readonly group = new Group();
  /** Each look's parts, once its model is loaded (plain's at once). */
  private readonly parts = new Map<Look, Part[]>();
  private readonly batches = new Map<Part, Batch>();
  private shown: MarkShown[] = [];
  private byId = new Map<number, MarkShown>();
  private key = "";
  /** A mark not drawn (picked up, in the hand). */
  hidden = -1;
  /** Loads asked for (a look's model is fetched once). */
  private readonly asked = new Set<Look>();

  constructor(
    private layout: Layout,
    private readonly sim: MarkAspects,
    private readonly mats: Materials,
    private readonly models: MarkModels | null = null,
  ) {
    this.parts.set("plain", this.toyParts());
  }

  /** The old toy semaphore, as a signal piece's: base, post and cap fixed; the arm and its stripe moving. */
  private toyParts(): Part[] {
    const at = new Matrix4().makeTranslation(PIECE_LENGTH - 20, 0, TOY_SIDE);
    const pivot = new Matrix4().makeTranslation(PIECE_LENGTH - 20, TOY_HEIGHT - 8, TOY_SIDE);
    const fixed = (geometry: BufferGeometry, material: Material): Part => ({ geometry, material, frame: at, role: "fixed", shadow: true });
    const arm = (geometry: BufferGeometry, material: Material): Part => ({ geometry, material, frame: pivot, role: "arm", red: 0, clear: -TOY_RAISED, shadow: false });
    return [
      fixed(new CylinderGeometry(5, 6, 3, 16).translate(0, 1.5, 0), this.mats.naturalWood),
      fixed(new CylinderGeometry(1.7, 1.9, TOY_HEIGHT, 10).translate(0, TOY_HEIGHT / 2, 0), this.mats.lacquer("#f6f1e6")),
      fixed(new SphereGeometry(2.6, 14, 10).translate(0, TOY_HEIGHT + 1, 0), this.mats.magnet),
      arm(new BoxGeometry(4.5, 3, 24).translate(0, 0, 12), this.mats.lacquer("#c8442f")),
      arm(new BoxGeometry(4.8, 3.3, 3).translate(0, 0, 19), this.mats.lacquer("#f6f1e6")),
    ];
  }

  /** A kit look's parts from the library (its model bare of moving parts, and those), or null till it's loaded. */
  private kitParts(look: Exclude<Look, "plain">): Part[] | null {
    if (!this.models) return null;
    const type = KIT_OF[look];
    const bare = this.models.model(kitModelKey(type, true));
    const movers = this.models.moversOf(type);
    if (!bare || !movers) {
      if (!this.asked.has(look)) {
        this.asked.add(look);
        this.models.load(kitModelKey(type)).then(
          () => {
            this.key = "";
            this.onLoaded?.();
          },
          () => {},
        );
      }
      return null;
    }
    const out: Part[] = bare.parts.map((p) => ({ geometry: p.geometry, material: p.material, frame: new Matrix4(), role: "fixed", shadow: true }));
    movers.updateMatrixWorld(true);
    const rootInv = movers.matrixWorld.clone().invert();
    movers.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const part = mesh.parent!;
      const name = part.name;
      // (The part's frame in the model, unrotated: its holder's, and its own place.)
      const frame = new Matrix4().multiplyMatrices(rootInv, part.parent!.matrixWorld).multiply(new Matrix4().makeTranslation(part.position.x, part.position.y, part.position.z));
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (name === "arm") out.push({ geometry: mesh.geometry, material, frame, role: "arm", red: 0, clear: SEMAPHORE_CLEAR, shadow: false });
      else if (name === "red" || name === "green") out.push({ geometry: mesh.geometry, material, frame, role: name, shadow: false });
      else if (/^[rg][01]$/.test(name)) out.push({ geometry: mesh.geometry, material, frame, role: name[0] === "r" ? "red" : "green", head: Number(name[1]), shadow: false });
    });
    return out;
  }

  /** Called when a look's model has loaded (the caller redraws). */
  onLoaded: (() => void) | null = null;

  setLayout(layout: Layout): void {
    this.layout = layout;
    this.key = "";
  }

  /** The batch drawing a part (made the first time a mark of its look is drawn). */
  private batch(part: Part, need: number): Batch {
    let b = this.batches.get(part);
    if (!b || b.mesh.instanceMatrix.count < need) {
      if (b) {
        this.group.remove(b.mesh);
        b.mesh.dispose();
      }
      const mesh = new InstancedMesh(part.geometry, part.material, Math.max(8, need * 2));
      mesh.castShadow = part.shadow;
      mesh.receiveShadow = part.role === "fixed";
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.userData = { kind: "signal-mark", sharedGeometry: true };
      this.group.add(mesh);
      b = { part, mesh, n: 0 };
      this.batches.set(part, b);
    }
    return b;
  }

  /**
   * Bring the drawing up to date; true if anything changed (redraw). Cheap when nothing did: one string compare. Marks,
   * track and aspects worked out again only on a change; an aspect change starts its arm's glide (`animate`).
   */
  sync(): boolean {
    const L = this.layout;
    const key = `${L.signalsVersion}:${L.revision}:${this.sim.signalsVersion}:${this.hidden}:${L.signalCount}`;
    if (key === this.key) return false;
    this.key = key;
    const was = this.byId;
    this.shown = [];
    this.byId = new Map();
    const marks = [...L.signals()].filter((m) => m.id !== this.hidden && !L.isLifted(pieceOfRef(m.at)));
    const poses = new Map<number, JointPose>();
    for (const m of marks) {
      const j = jointPose(L, m.at);
      if (j) poses.set(m.id, j);
    }
    // Side by side on double track, the same way: a gantry over the two (decision 7).
    const partner = new Map<number, number>();
    for (const a of marks)
      for (const b of marks) {
        if (a.id >= b.id || partner.has(a.id) || partner.has(b.id)) continue;
        const pa = poses.get(a.id);
        const pb = poses.get(b.id);
        if (!pa || !pb || Math.abs(Math.sin((pa.heading - pb.heading) / 2)) > 0.02) continue;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const along = dx * Math.cos(pa.heading) + dz * Math.sin(pa.heading);
        const across = -dx * Math.sin(pa.heading) + dz * Math.cos(pa.heading);
        if (Math.abs(along) < 12 && Math.abs(Math.abs(across) - ROADS) < 8 && Math.abs(pa.y - pb.y) < 4) {
          partner.set(a.id, b.id);
          partner.set(b.id, a.id);
        }
      }
    for (const m of marks) {
      const j = poses.get(m.id);
      if (!j) continue;
      const other = partner.get(m.id) ?? -1;
      let look: Look = other !== -1 ? "gantry" : m.style;
      let road = 0;
      if (look === "gantry") {
        // (Road 0 is the one on the left of the way they guard, road 1 a double track to its right.)
        const o = poses.get(other)!;
        road = -(o.x - j.x) * Math.sin(j.heading) + (o.z - j.z) * Math.cos(j.heading) > 0 ? 0 : 1;
      }
      if (look !== "plain" && !this.parts.has(look)) {
        const parts = this.kitParts(look);
        if (parts) this.parts.set(look, parts);
        // (Not loaded yet: drawn plain till it is.)
        else look = "plain";
      }
      if (look === "plain" && other !== -1) road = 0;
      const world = new Matrix4().makeRotationY(-j.heading).setPosition(j.x, j.y, j.z).multiply(new Matrix4().makeTranslation(-PIECE_LENGTH, 0, -road * ROADS));
      const clear = !m.held && this.sim.markClear(m.id);
      const prior = was.get(m.id);
      const arm = this.parts.get(look)!.find((p) => p.role === "arm");
      const target = arm ? (clear ? arm.clear! : arm.red!) : 0;
      const top = this.topIn(look, world, road);
      const s: MarkShown = { id: m.id, look, world, road, clear, held: m.held, angle: target, from: target, to: target, t: 1, top, partner: look === "gantry" ? other : -1 };
      // (Its aspect changed while drawn the same: its arm glides there from where it was.)
      if (prior && prior.look === look && prior.to !== target) {
        s.angle = prior.angle;
        s.from = prior.angle;
        s.t = 0;
      }
      this.shown.push(s);
      this.byId.set(m.id, s);
    }
    this.draw();
    return true;
  }

  /** Where a look's post top (a gantry's head over `road`) stands, in the world. */
  private topIn(look: Look, world: Matrix4, road: number): Vector3 {
    const local = look === "plain" ? new Vector3(PIECE_LENGTH - 20, TOY_HEIGHT, TOY_SIDE) : look === "gantry" ? new Vector3(PIECE_LENGTH - 20, 90, road * ROADS) : new Vector3(PIECE_LENGTH - 20, 100, look === "semaphore" ? 36 : 30);
    return local.applyMatrix4(world);
  }

  /** Write every batch's instances: fixed parts once a mark (a gantry once for its two), arms at their angles, lit lenses. */
  private draw(): void {
    for (const b of this.batches.values()) b.n = 0;
    const m4 = new Matrix4();
    const rot = new Matrix4();
    const count = new Map<Look, number>();
    for (const s of this.shown) count.set(s.look, (count.get(s.look) ?? 0) + 1);
    for (const s of this.shown) {
      // (A gantry is drawn once, by the mark over road 0; its other mark adds its own head's lens.)
      const parts = this.parts.get(s.look)!;
      const owner = s.look !== "gantry" || s.road === 0 || !this.byId.has(s.partner);
      for (const part of parts) {
        if (part.role === "fixed" && !owner) continue;
        if (part.role === "arm") {
          rot.makeRotationX(s.angle);
          m4.multiplyMatrices(s.world, part.frame).multiply(rot);
        } else if (part.role === "red" || part.role === "green") {
          // (A lens: the lit one only; a gantry's, its own head's: head 1 over road 0, head 0 over road 1.)
          const lit = s.clear ? "green" : "red";
          if (part.role !== lit) continue;
          if (part.head !== undefined && part.head !== 1 - s.road) continue;
          m4.multiplyMatrices(s.look === "gantry" && !owner ? this.byId.get(s.partner)!.world : s.world, part.frame);
        } else m4.multiplyMatrices(s.world, part.frame);
        const b = this.batch(part, count.get(s.look)!);
        b.mesh.setMatrixAt(b.n++, m4);
      }
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Arms gliding to a new aspect (`ARM_GLIDE_S`): moved on by `dt` seconds. True while any is still on its way (the
   * caller draws a frame); nothing to do (false) once all are at rest. Arms cast no shadow, so a glide never redraws them.
   */
  animate(dt: number): boolean {
    let moving = false;
    for (const s of this.shown) {
      if (s.t >= 1) continue;
      s.t = Math.min(1, s.t + dt / ARM_GLIDE_S);
      const e = s.t * s.t * (3 - 2 * s.t);
      s.angle = s.from + (s.to - s.from) * e;
      moving = true;
    }
    if (moving) this.draw();
    return moving;
  }

  /** Is any arm still gliding? */
  get gliding(): boolean {
    return this.shown.some((s) => s.t < 1);
  }

  /** Draws in use (the performance readout, and the e2e: a few however many signals). */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.n > 0) n++;
    return n;
  }

  /** The mark nearest a screen point (CSS px) within `slack` px of its post (top to foot), or −1. */
  pick(x: number, y: number, camera: Camera, width: number, height: number, slack: number): number {
    let best = -1;
    let bestD = slack;
    const v = new Vector3();
    for (const s of this.shown) {
      for (const h of [0, 0.5, 1]) {
        v.set(s.top.x, s.top.y - POST_H * (1 - h), s.top.z).project(camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * width - x, (-v.y * 0.5 + 0.5) * height - y);
        if (d < bestD) {
          bestD = d;
          best = s.id;
        }
      }
    }
    return best;
  }

  /** Where a drawn mark's post top (a gantry's: its head) is (world), for tests and cards; null if it isn't drawn. */
  topOf(id: number): { x: number; y: number; z: number } | null {
    const s = this.byId.get(id);
    return s ? { x: s.top.x, y: s.top.y, z: s.top.z } : null;
  }

  /** How a drawn mark is drawn, for tests: its look, its arm's angle, and whether it's shown clear. */
  shownOf(id: number): { look: Look; angle: number; clear: boolean } | null {
    const s = this.byId.get(id);
    return s ? { look: s.look, angle: s.angle, clear: s.clear } : null;
  }

  dispose(): void {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
  }
}

/** A mark in the hand: its post and head, and an arrow on the track the way it guards. */
export function markGhost(mats: Materials): Group {
  const g = new Group();
  g.add(new Mesh(new CylinderGeometry(2.2, 2.8, POST_H, 8).translate(0, POST_H / 2, 0), mats.lacquer("#f6f1e6")));
  const head = new Mesh(new BoxGeometry(8, 11, 6).translate(0, POST_H + 3, 0), mats.lacquer("#39b04a"));
  g.add(head);
  // (The arrow lies on the track, pointing the way trains it guards go: local +x, set by `placeGhost`.)
  const arrow = new Mesh(new ConeGeometry(9, 22, 3).rotateZ(-Math.PI / 2), new MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthTest: false }));
  arrow.name = "arrow";
  arrow.renderOrder = 3;
  g.add(arrow);
  return g;
}

/** Stand a mark's ghost at a joint end (its post on the right of the way it guards, the arrow on the track). */
export function placeGhost(ghost: Object3D, layout: Layout, at: number): boolean {
  const p = postAt(layout, at);
  if (!p) return false;
  ghost.position.set(p.px, p.y, p.pz);
  ghost.rotation.set(0, -p.heading, 0);
  const arrow = ghost.getObjectByName("arrow");
  // (Back over the track's centre, a little before the joint, in the ghost's own frame: x along, z right.)
  if (arrow) arrow.position.set(-22, 6, -26);
  return true;
}

const tintSample = createSample();
const AHEAD = new Color("#3fcf5a");
const BEHIND = new Color("#4a8ff0");

/**
 * The tint over a signal's blocks: the one it guards green, the one it ends blue (signals spec §4). One mesh, its
 * geometry built when `show` is given another joint (or the track changed), dropped by `hide`.
 */
export class BlockTint {
  readonly mesh: Mesh;
  private key = "";

  constructor() {
    this.mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: DoubleSide }));
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.userData = { kind: "block-tint" };
  }

  /** Show the tint for these blocks, `key` naming them (the same key: nothing rebuilt). */
  show(layout: Layout, key: string, of: () => { ahead: Block; behind: Block }): void {
    this.mesh.visible = true;
    if (key === this.key) return;
    this.key = key;
    const blocks = of();
    const pos: number[] = [];
    const col: number[] = [];
    const strip = (block: Block, c: Color) => {
      for (const [id, bits] of block) {
        const p = layout.getPiece(id);
        if (!p || layout.isLifted(id)) continue;
        const def = getPieceDef(p.type, p.flipped);
        const ch = Math.cos(p.pose.heading);
        const sh = Math.sin(p.pose.heading);
        def.paths.forEach((path, i) => {
          if (((bits >> i) & 1) === 0) return;
          const len = pathLength(path.geom);
          const n = Math.max(2, Math.ceil(len / 12));
          let prev: number[] | null = null;
          for (let k = 0; k <= n; k++) {
            samplePath(path.geom, (len * k) / n, tintSample);
            // (Across the track: ±16 mm either side of the centre line.)
            const nx = -Math.sin(tintSample.heading) * 16;
            const nz = Math.cos(tintSample.heading) * 16;
            const lx = [tintSample.x - nx, tintSample.x + nx];
            const lz = [tintSample.z - nz, tintSample.z + nz];
            const y = p.y + tintSample.y + 3.5;
            const w = [0, 1].map((j) => [p.pose.x + lx[j] * ch - lz[j] * sh, y, p.pose.z + lx[j] * sh + lz[j] * ch]);
            const cur = [...w[0], ...w[1]];
            if (prev) {
              const [a, b, c2, d] = [prev.slice(0, 3), prev.slice(3), cur.slice(0, 3), cur.slice(3)];
              pos.push(...a, ...b, ...c2, ...b, ...d, ...c2);
              for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
            }
            prev = cur;
          }
        });
      }
    };
    strip(blocks.behind, BEHIND);
    strip(blocks.ahead, AHEAD);
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
  }

  /** Hide it (the key is kept: shown again for the same joint, nothing is rebuilt). */
  hide(): boolean {
    const was = this.mesh.visible;
    this.mesh.visible = false;
    return was;
  }

  /** Forget the built tint (the track changed under it). */
  reset(): void {
    this.key = "";
  }
}
