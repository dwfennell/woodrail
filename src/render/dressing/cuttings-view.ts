import { BoxGeometry, Group, Matrix4, Mesh, type BufferGeometry, type Material } from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { blockCorners, CUTTING_WIDTH, hillSlabs, type Cutting, type LandscapeGrid } from "../../landscape";
import { RISER_HEIGHT } from "../../track";
import { blockKey, blockSolids, hillCoreGeometry, type BlockInstanceRef } from "./blocks";

const evaluator = new Evaluator();
const hidden = new Matrix4().makeScale(0, 0, 0);
/** How high above a ramp's deck its channel is cut (mm): through any hill a ramp may cut into. */
const CHANNEL_HEIGHT = 4 * RISER_HEIGHT;

/** A ramp's channel as a solid to subtract: the space above its deck, as wide as a cutting, along its length. */
function channel(c: Cutting): BufferGeometry {
  const g = new BoxGeometry(c.length + 2, CHANNEL_HEIGHT, CUTTING_WIDTH).toNonIndexed();
  g.translate(c.length / 2, CHANNEL_HEIGHT / 2, 0);
  // Shear so the floor follows the ramp's slope, then lay it where the ramp lies.
  g.applyMatrix4(new Matrix4().set(1, 0, 0, 0, c.rise / c.length, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  g.rotateY(-c.pose.heading);
  g.translate(c.pose.x, c.y, c.pose.z);
  return g;
}

function subtract(geometry: BufferGeometry, cutters: readonly Brush[]): BufferGeometry {
  let result = new Brush(geometry);
  result.updateMatrixWorld();
  for (const cutter of cutters) result = evaluator.evaluate(result, cutter, SUBTRACTION);
  const g = result.geometry;
  g.clearGroups();
  return g;
}

/**
 * The hills' blocks with ramps' channels cut through them. A cut block is drawn as its own mesh (the instance hidden);
 * the dark core is cut too. Rebuilt only when the set of cuttings changes.
 */
export class HillCuttings {
  readonly group = new Group();
  private signature = "";
  private hiddenRefs: BlockInstanceRef[] = [];

  constructor(
    private readonly grid: LandscapeGrid,
    private readonly materials: { wood: Material; top: Material },
    private readonly index: Map<string, BlockInstanceRef[]>,
    private readonly core: Mesh | null,
  ) {}

  /** Show these cuttings (replacing any shown before). */
  set(cuttings: readonly Cutting[]): void {
    const signature = cuttings.map((c) => `${c.pose.x.toFixed(1)},${c.pose.z.toFixed(1)},${c.pose.heading.toFixed(3)},${c.y}`).join(";");
    if (signature === this.signature) return;
    this.signature = signature;
    this.clear();
    if (cuttings.length === 0) {
      this.restoreCore();
      return;
    }
    const cutters = cuttings.map((c) => {
      const b = new Brush(channel(c));
      b.updateMatrixWorld();
      return { brush: b, cutting: c };
    });
    // Each block cut, with the channels through it.
    const blocks = new Map<string, { col: number; row: number; level: number; cutters: Brush[] }>();
    for (const { brush, cutting } of cutters) {
      for (const b of cutting.blocks) {
        const key = `${b.col},${b.row},${b.level}`;
        let entry = blocks.get(key);
        if (!entry) blocks.set(key, (entry = { ...b, cutters: [] }));
        entry.cutters.push(brush);
      }
    }
    const g = this.grid;
    for (const { col, row, level, cutters: through } of blocks.values()) {
      const x = g.centreX(col);
      const z = g.centreZ(row);
      const y = level * RISER_HEIGHT;
      const top = g.height[g.index(col, row)] === level + 1;
      for (const part of blockSolids(x, z, y, top, blockCorners(g, col, row, level))) {
        const mesh = new Mesh(subtract(part.geometry, through), part.kind === "wood" ? this.materials.wood : this.materials.top);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        this.group.add(mesh);
      }
      // Hide the whole block as the hill draws it (it may not be drawn at all if it was buried).
      for (const ref of this.index.get(blockKey(x, z, y)) ?? []) {
        ref.mesh.setMatrixAt(ref.i, hidden);
        ref.mesh.instanceMatrix.needsUpdate = true;
        this.hiddenRefs.push(ref);
      }
    }
    if (this.core) {
      const all = cutters.map((c) => c.brush);
      const cut = hillCoreGeometry(hillSlabs(g), (box) => {
        box.computeBoundingBox();
        const hits = all.filter((b) => {
          b.geometry.computeBoundingBox();
          return box.boundingBox!.intersectsBox(b.geometry.boundingBox!);
        });
        return hits.length > 0 ? subtract(box, hits) : box;
      });
      if (cut) {
        this.core.geometry.dispose();
        this.core.geometry = cut;
        this.coreCut = true;
      }
    }
  }

  private coreCut = false;

  private restoreCore(): void {
    if (!this.core || !this.coreCut) return;
    const plain = hillCoreGeometry(hillSlabs(this.grid));
    if (plain) {
      this.core.geometry.dispose();
      this.core.geometry = plain;
    }
    this.coreCut = false;
  }

  private clear(): void {
    for (const ref of this.hiddenRefs) {
      ref.mesh.setMatrixAt(ref.i, ref.matrix);
      ref.mesh.instanceMatrix.needsUpdate = true;
    }
    this.hiddenRefs = [];
    for (const m of [...this.group.children] as Mesh[]) {
      m.geometry.dispose();
      this.group.remove(m);
    }
  }
}
