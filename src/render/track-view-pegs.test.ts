import { InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import type { Materials } from "./materials";
import { TrackView } from "./track-view";

const plain = () => new MeshBasicMaterial();
const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

/** The view's pegs: where each stands (its end face, in world space) and whose piece it is. */
function pegsOf(view: TrackView) {
  const mesh = view.group.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.material === mats.track);
  if (!mesh) return [];
  const m = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    const at = new Vector3().setFromMatrixPosition(m);
    return { x: Math.round(at.x), z: Math.round(at.z), piece: view.pieceAt(mesh, i) };
  });
}

describe("TrackView pegs", () => {
  it("one at each joint, in the peg end's piece, and one in each free peg end; a free hole has none", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    const b = layout.addPiece("straight-144", P(144, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    expect(pegsOf(view)).toEqual([
      { x: 144, z: 0, piece: a },
      { x: 288, z: 0, piece: b },
    ]);
  });

  it("two peg ends (or two holes) joined: one peg between them, in the first piece", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    // Turned round: its peg end meets a's.
    layout.addPiece("straight-144", P(288, 0, Math.PI));
    const holes = new Layout();
    const c = holes.addPiece("straight-144", P(144, 0, Math.PI));
    holes.addPiece("straight-144", P(144, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    expect(pegsOf(view)).toEqual([{ x: 144, z: 0, piece: a }]);
    const holesView = new TrackView(holes, mats);
    holesView.sync();
    // c's peg end is free (at x 0); the two holes at x 144 share one peg; the second piece's peg end is free too.
    expect(pegsOf(holesView).filter((p) => p.x === 144)).toEqual([{ x: 144, z: 0, piece: c }]);
    expect(pegsOf(holesView)).toHaveLength(3);
  });

  it("an end whose neighbour is lifted shows as free, and the pegs move with their piece", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    const b = layout.addPiece("straight-144", P(144, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    expect(pegsOf(view)).toHaveLength(2);
    layout.liftPiece(b);
    view.sync();
    expect(pegsOf(view)).toEqual([{ x: 144, z: 0, piece: a }]);
    layout.movePiece(a, P(10, 20), 0);
    view.moveInstances([a]);
    expect(pegsOf(view)).toEqual([{ x: 154, z: 20, piece: a }]);
  });

  it("a group parted from the track (taken up to drag) gives its joints' pegs back to their own ends", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    const b = layout.addPiece("straight-144", P(144, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    // a's peg end holds the peg in b's hole.
    expect(pegsOf(view)).toEqual([
      { x: 144, z: 0, piece: a },
      { x: 288, z: 0, piece: b },
    ]);
    layout.partFrom(new Set([a]));
    view.jointsChanged();
    // Parted: a's peg end is free (its peg stays), b's hole is empty; b's own peg end as before.
    expect(pegsOf(view)).toEqual([
      { x: 144, z: 0, piece: a },
      { x: 288, z: 0, piece: b },
    ]);
    // The other way round: b parted keeps its peg at 288, and a's peg is now in no hole but still its own.
    const l2 = new Layout();
    const c = l2.addPiece("straight-144", P(144, 0, Math.PI)); // its peg end at x = 0, its hole at 144
    const d = l2.addPiece("straight-144", P(144, 0)); // its hole at 144: two holes meet, one peg (c's, the first)
    const v2 = new TrackView(l2, mats);
    v2.sync();
    expect(pegsOf(v2).filter((p) => p.x === 144)).toEqual([{ x: 144, z: 0, piece: c }]);
    l2.partFrom(new Set([d]));
    v2.jointsChanged();
    // Two free holes: no peg between them.
    expect(pegsOf(v2).filter((p) => p.x === 144)).toEqual([]);
  });
});
