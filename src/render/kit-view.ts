import { Group, Mesh } from "three";
import type { Prop } from "../props/store";
import { kitOf, type Layout, type PieceTypeId } from "../track";
import { kitModelKey, type PropLibrary, type PropModel } from "./props/library";
import { PropsView } from "./props/props-view";

/**
 * Draws the kit pieces' models (src/track/kits.ts) where their pieces stand, as `DepotView` draws depots' buildings:
 * each kit piece one instance of its asset's model, baked once per kit type without its slabs of track (the real
 * track is drawn under it by `TrackView`) and in the piece's own frame, so the instance is just the piece's pose.
 * Batched as the props are (`PropsView`: one BatchedMesh per material, whatever the number of kits).
 *
 * Updated only when the layout changes (`sync`, from `Game.trackChanged`): a diff by piece id and pose, so adding one
 * kit adds one instance. Nothing runs per frame. A piece in the hand or hidden while a stand-in settles isn't drawn.
 */
export class KitView {
  readonly group: Group;
  private readonly view: PropsView;
  /** The kit pieces drawn, as props (asset: the kit's model key; pose: the piece's). */
  private readonly drawn = new Map<number, Prop>();
  /** What `drawn` was built from: a key of the kit pieces' ids, types, poses and whether each is shown. */
  private key = "";
  private version = 0;
  /** Every kit piece on the layout, in the hand or not (for checks that want them all: others' footprints). */
  private ids: number[] = [];
  /** The source the view draws from: the kit pieces shown. */
  private readonly source = {
    version: 0,
    get: (id: number) => this.drawn.get(id),
    all: () => this.drawn.values(),
  };

  constructor(private readonly library: PropLibrary) {
    this.view = new PropsView(library);
    this.group = this.view.group;
    this.group.name = "kits";
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
      const asset = kitModelKey(p.type);
      const d = this.drawn.get(id);
      if (d && d.asset === asset) {
        if (d.x !== p.pose.x || d.z !== p.pose.z || d.heading !== p.pose.heading || d.y !== p.y) Object.assign(d, { x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });
        continue;
      }
      this.drawn.set(id, { id, asset, x: p.pose.x, z: p.pose.z, heading: p.pose.heading, y: p.y });
    }
    for (const id of [...this.drawn.keys()]) if (!seen.has(id)) this.drawn.delete(id);
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
      moved = true;
    }
    if (!moved) return;
    this.source.version = ++this.version;
    // (The key no longer matches: the next `sync` looks again.)
    this.key = "";
    this.view.sync(this.source);
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

  /**
   * Moving parts (`KitDef.moves`): Phase 1. The hook is here: a kit whose model moves gets a small live group of its
   * own, animated only while its trigger holds (a train on it, one stopped at it, a state change), calling
   * `invalidate()` while it moves. Returns whether anything is moving (nothing yet: no kit moves in Phase 0).
   */
  moving(): boolean {
    return false;
  }

  /** Draw calls (one per material in use), for the performance readout. */
  get drawCalls(): number {
    return this.view.drawCalls;
  }

  dispose(): void {
    this.view.dispose();
    this.drawn.clear();
    this.key = "";
  }
}
