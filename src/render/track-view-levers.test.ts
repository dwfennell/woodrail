import { MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import type { Materials } from "./materials";
import { TrackView } from "./track-view";

const plain = () => new MeshBasicMaterial();
const mats = { track: plain(), trackCut: plain(), bridgePaint: plain(), lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;

describe("TrackView levers of the new points (tech-tree T3, T4)", () => {
  it("a double three-way: two levers, one each side of the trunk (each its branch's side), and no post to take their taps", () => {
    const layout = new Layout();
    const id = layout.addPiece("switch-3way-double", { x: 0, z: 0, heading: 0 });
    const view = new TrackView(layout, mats);
    view.sync();
    const posts = view.leverPosts().filter((p) => p.pieceId === id);
    expect(posts).toHaveLength(2);
    expect(posts.map((p) => p.corner ?? 0)).toEqual([0, 1]);
    // (Lever 0 by the + branch, lever 1 by the − branch.)
    expect(posts[0].z).toBeGreaterThan(20);
    expect(posts[1].z).toBeLessThan(-20);
    const meshes = view.group.children.filter((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
    expect(meshes.map((m) => m.userData.corner)).toEqual([0, 1]);
  });

  it("a slip: one lever, by its first end on its curve's side", () => {
    const layout = new Layout();
    const id = layout.addPiece("slip-single", { x: 0, z: 0, heading: 0 });
    const view = new TrackView(layout, mats);
    view.sync();
    const levers = view.group.children.filter((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
    expect(levers).toHaveLength(1);
    const posts = view.leverPosts().filter((p) => p.pieceId === id);
    expect(posts[0].x).toBeLessThan(20);
    expect(posts[0].z).toBeGreaterThan(20);
  });
});
