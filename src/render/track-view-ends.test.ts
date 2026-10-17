import { InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { connectorRef, Layout } from "../track";
import type { Materials } from "./materials";
import { TrackView } from "./track-view";

const plain = () => new MeshBasicMaterial();
const red = plain();
const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: (c: string) => (c === "#c8442f" ? red : plain()), naturalWood: plain(), magnet: plain() } as unknown as Materials;
const P = (x: number, z: number, heading = 0) => ({ x, z, heading });

/** Which ends have boards (each instance stands at its end, the board just past it): their x, rounded. */
function boards(view: TrackView): number[] {
  const mesh = view.group.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.material === red && c.count > 0);
  if (!mesh) return [];
  const m = new Matrix4();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    return Math.round(new Vector3().setFromMatrixPosition(m).x);
  }).sort((a, b) => a - b);
}

describe("TrackView end boards", () => {
  it("while building, every free end of track has one; else only the ends a train has turned back at", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    layout.addPiece("straight-144", P(144, 0));
    const view = new TrackView(layout, mats);
    view.sync();
    expect(boards(view)).toEqual([]);
    view.showAllEnds(true);
    // At each end of the run (not at the joint between the two).
    const shown = boards(view);
    expect(shown).toEqual([0, 288]);
    view.showAllEnds(false);
    expect(boards(view)).toEqual([]);
    // A train turned back at the run's start: that end's board stays up.
    expect(view.markTurnedBack(connectorRef(a, 0))).toBe(true);
    expect(view.markTurnedBack(connectorRef(a, 0))).toBe(false);
    expect(boards(view)).toEqual([shown[0]]);
    // Track joined on there: the board goes.
    layout.addPiece("straight-144", P(-144, 0));
    view.sync();
    expect(boards(view)).toEqual([]);
  });

  it("moves with a run of track pulled along", () => {
    const layout = new Layout();
    const a = layout.addPiece("straight-144", P(0, 0));
    const view = new TrackView(layout, mats);
    view.showAllEnds(true);
    view.sync();
    const before = boards(view);
    layout.movePiece(a, P(100, 0), 0);
    view.moveInstances([a]);
    expect(boards(view)).toEqual(before.map((x) => x + 100));
  });
});
