import { Group, Mesh } from "three";
import type { Prop } from "../props/store";
import { kitOf, type KitDef, type Layout, type PieceTypeId } from "../track";
import { motionOf, type KitMotion, type MotionParts } from "./kit-motions";
import { kitModelKey, partsOf, type PropLibrary, type PropModel } from "./props/library";
import { PropsView } from "./props/props-view";

/** A kit piece whose model moves (`KitDef.moves`), and how far into its motion it is. */
interface Mover {
  readonly id: number;
  readonly type: PieceTypeId;
  readonly kit: KitDef;
  readonly motion: KitMotion;
  /** How far the motion is engaged: 0 at rest, 1 fully (eased in and out). */
  on: number;
  /** Seconds it has run since it last started from rest. */
  t: number;
  /** Its moving parts, drawn live (while it's away from rest), or null (at rest: the static drawing shows them). */
  live: Group | null;
  parts: MotionParts | null;
  /** Was it still on the last update (at rest, or holding at full engagement)? */
  still: boolean;
}

/** Smoothstep, for easing a motion in and out. */
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * Draws the kit pieces' models (src/track/kits.ts) where their pieces stand, as `DepotView` draws depots' buildings:
 * each kit piece one instance of its asset's model, baked once per kit type without its slabs of track (the real
 * track is drawn under it by `TrackView`) and in the piece's own frame, so the instance is just the piece's pose.
 * Batched as the props are (`PropsView`: one BatchedMesh per material, whatever the number of kits).
 *
 * Updated only when the layout changes (`sync`, from `Game.trackChanged`): a diff by piece id and pose, so adding one
 * kit adds one instance. A piece in the hand or hidden while a stand-in settles isn't drawn.
 *
 * **Moving parts** (`KitDef.moves`, posed by `KIT_MOTIONS`): a kit at rest is drawn whole, like any other. While its
 * trigger holds (`update`, asked by the game only on frames where trains moved, a train halted, or a kit is still
 * moving), its instance is swapped for its model bare of its moving parts, and those are drawn live beside it, a small
 * group of its own (a clone of the library's, sharing its geometry). Back at rest, the live parts go and the whole model
 * is drawn again. An idle railway costs nothing: no kit is looked at, and nothing is drawn.
 */
export class KitView {
  readonly group = new Group();
  private readonly view: PropsView;
  /** The kit pieces drawn, as props (asset: the kit's model key; pose: the piece's). */
  private readonly drawn = new Map<number, Prop>();
  /** What `drawn` was built from: a key of the kit pieces' ids, types, poses and whether each is shown. */
  private key = "";
  private version = 0;
  /** Every kit piece on the layout, in the hand or not (for checks that want them all: others' footprints). */
  private ids: number[] = [];
  /** The kit pieces drawn whose models move, by piece id (a short list, kept as the layout changes). */
  private readonly movers = new Map<number, Mover>();
  /** Is any mover away from rest and not holding still (so it wants updating every frame)? */
  private moving = false;
  /** The source the view draws from: the kit pieces shown. */
  private readonly source = {
    version: 0,
    get: (id: number) => this.drawn.get(id),
    all: () => this.drawn.values(),
  };

  constructor(private readonly library: PropLibrary) {
    this.view = new PropsView(library);
    this.group.name = "kits";
    this.group.add(this.view.group);
  }

  /**
   * Bring the drawing up to date with the layout: kits added, moved, taken up or put down. `hidden` says which pieces
   * are hidden for now (a stand-in settling in their place). `force` after a model has loaded. True if anything
   * changed. One pass over the pieces (a map lookup each), and work only for the kits that changed.
   */
  sync(layout: Layout, hidden: (id: number) => boolean = () => false, force = false): boolean {
    let key = "";
    const ids: number[] = [];
    for (const id of layout.pieceIds()) {
      const p = layout.getPiece(id)!;
      if (!kitOf(p.type)) continue;
      ids.push(id);
      const shown = !layout.isLifted(id) && !hidden(id);
      key += `${id}:${p.type}:${p.pose.x}:${p.pose.z}:${p.pose.heading}:${p.y}:${shown ? 1 : 0};`;
    }
    this.ids = ids;
    if (key === this.key && !force) return false;
    this.key = key;
    const seen = new Set<number>();
    for (const id of ids) {
      const p = layout.getPiece(id)!;
      if (layout.isLifted(id) || hidden(id)) continue;
      seen.add(id);
      const kit = kitOf(p.type)!;
      let m = this.movers.get(id);
      if (m && m.type !== p.type) {
        this.rest(m);
        this.movers.delete(id);
        m = undefined;
      }
      const motion = kit.moves ? motionOf(kit.asset) : undefined;
      if (!m && motion) this.movers.set(id, (m = { id, type: p.type, kit, motion, on: 0, t: 0, live: null, parts: null, still: true }));
      const asset = kitModelKey(p.type, !!m?.live);
      const d = this.drawn.get(id);
      if (d && d.asset === asset) {
        if (d.x !== p.pose.x || d.z !== p.pose.z || d.heading !== p.pose.heading || d.y !== p.y) Object.assign(d, { x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });
      } else this.drawn.set(id, { id, asset, x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });
      if (m?.live) this.placeLive(m);
    }
    for (const id of [...this.drawn.keys()]) if (!seen.has(id)) this.drawn.delete(id);
    for (const [id, m] of this.movers)
      if (!seen.has(id)) {
        this.rest(m);
        this.movers.delete(id);
      }
    this.source.version = ++this.version;
    return this.view.sync(this.source, -1, force);
  }

  /**
   * Kit pieces of `ids` moved (a run of track pulled along on pointer moves): their instances follow, nothing else is
   * looked at.
   */
  moveInstances(layout: Layout, ids: Iterable<number>): void {
    let moved = false;
    for (const id of ids) {
      const d = this.drawn.get(id);
      const p = d && layout.getPiece(id);
      if (!d || !p) continue;
      Object.assign(d, { x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });
      const m = this.movers.get(id);
      if (m?.live) this.placeLive(m);
      moved = true;
    }
    if (!moved) return;
    this.source.version = ++this.version;
    // (The key no longer matches: the next `sync` looks again.)
    this.key = "";
    this.view.sync(this.source);
  }

  /** Are there kits on the layout whose models move (so `update` has anything to look at)? */
  get hasMovers(): boolean {
    return this.movers.size > 0;
  }

  /** Is a kit's model moving now (so it wants `update` every frame, triggered or not)? */
  get animating(): boolean {
    return this.moving;
  }

  /**
   * Move the kits' moving parts on by `dt` seconds: each eases toward full engagement while `triggered` says its
   * trigger holds, and back to rest after. Looks only at the movers (a short list); called by the game only on frames
   * already running for trains (see the class note). "moving" while any part moved (draw, and redraw shadows);
   * "changed" when something was swapped back to its still drawing (draw once); "still" otherwise.
   */
  update(triggered: (pieceId: number, kit: KitDef) => boolean, dt: number): "moving" | "changed" | "still" {
    let moved = false;
    let changed = false;
    let swapped = false;
    for (const m of this.movers.values()) {
      const want = triggered(m.id, m.kit);
      if (!want && m.on === 0 && !m.live) continue;
      if (!m.live) {
        if (!this.wake(m)) continue;
        swapped = true;
      }
      const ease = m.motion.ease ?? 0.8;
      const wasOn = m.on;
      const period = m.motion.period;
      if (!want && period && m.on === 1) {
        // A cycling motion runs on to the end of its round, then stops there, at rest.
        const end = Math.ceil(m.t / period - 1e-6) * period;
        m.t = Math.min(end, m.t + dt);
        if (m.t >= end - 1e-6) m.on = 0;
      } else {
        m.on = want ? Math.min(1, m.on + dt / ease) : Math.max(0, m.on - dt / ease);
        if (m.on > 0) m.t += dt;
      }
      const holding = m.on === 1 && wasOn === 1 && !!m.motion.holds;
      if (!holding) m.motion.pose(m.parts!, smooth(m.on), m.t);
      if (m.on === 0) {
        this.rest(m);
        swapped = true;
        changed = true;
        m.still = true;
        continue;
      }
      m.still = holding;
      if (!holding) moved = true;
    }
    this.moving = false;
    for (const m of this.movers.values()) if (m.live && !m.still) this.moving = true;
    if (swapped) {
      this.source.version = ++this.version;
      this.view.sync(this.source);
    }
    return moved ? "moving" : changed || swapped ? "changed" : "still";
  }

  /** Start a mover from rest: its moving parts drawn live, its instance the model bare of them. False if not loaded. */
  private wake(m: Mover): boolean {
    const template = this.library.moversOf(m.type);
    if (!template || !this.library.model(kitModelKey(m.type, true))) return false;
    m.live = template.clone(true);
    m.parts = partsOf(m.live);
    m.t = 0;
    this.group.add(m.live);
    this.placeLive(m);
    const d = this.drawn.get(m.id);
    if (d) this.drawn.set(m.id, { ...d, asset: kitModelKey(m.type, true) });
    return true;
  }

  /** A mover back at rest: its live parts go, and its whole model is drawn again. */
  private rest(m: Mover): void {
    m.on = 0;
    m.t = 0;
    if (m.live) this.group.remove(m.live);
    m.live = null;
    m.parts = null;
    const d = this.drawn.get(m.id);
    if (d) this.drawn.set(m.id, { ...d, asset: kitModelKey(m.type) });
  }

  /** A mover's live parts stand where its piece does. */
  private placeLive(m: Mover): void {
    const d = this.drawn.get(m.id);
    if (!d || !m.live) return;
    m.live.position.set(d.x, d.y, d.z);
    m.live.rotation.set(0, -d.heading, 0);
  }

  /** The kit pieces on the layout as of the last `sync` (in the hand too). */
  pieceIds(): readonly number[] {
    return this.ids;
  }

  /** Fetch and bake a kit type's model, if it isn't yet (for its tray picture, or the piece in the hand). */
  load(type: PieceTypeId): Promise<unknown> {
    return this.library.load(kitModelKey(type));
  }

  /**
   * A kit's model in its piece's own frame (the piece at the origin, heading 0), as one group: shown with the piece
   * while it's held, and in the tray's picture. Empty if the model isn't loaded yet (it's asked for). Its geometry is
   * shared with the drawing: not to be disposed.
   */
  model(type: PieceTypeId): Group {
    const out = new Group();
    const key = kitModelKey(type);
    const fill = (model: PropModel | null | undefined) => {
      for (const part of model?.parts ?? []) {
        const mesh = new Mesh(part.geometry, part.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.sharedGeometry = true;
        out.add(mesh);
      }
    };
    const model = this.library.model(key);
    // Not built yet: it fills in when it is (the piece in the hand shows it then).
    if (model === undefined) this.library.load(key).then(fill, () => {});
    else fill(model);
    return out;
  }

  /** Draw calls (one per material in use, and the live parts' meshes), for the performance readout. */
  get drawCalls(): number {
    let n = this.view.drawCalls;
    for (const m of this.movers.values())
      m.live?.traverse((o) => {
        if ((o as Mesh).isMesh) n++;
      });
    return n;
  }

  dispose(): void {
    for (const m of this.movers.values()) this.rest(m);
    this.movers.clear();
    this.view.dispose();
    this.drawn.clear();
    this.key = "";
  }
}
