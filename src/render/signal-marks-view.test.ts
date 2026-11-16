import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Object3D } from "three";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import type { Materials } from "./materials";
import { ARM_GLIDE_S, markSetGhost, placeSetGhost, SignalMarksView, type MarkModels } from "./signal-marks-view";

const S: PieceTypeId = "straight-216";
const plain = () => new MeshBasicMaterial();
const mats = { lacquer: plain, naturalWood: plain(), magnet: plain() } as unknown as Materials;

/** Where a ghost's post stands (world plan x, z): its model's foot, the first part. */
function ghostPost(post: Object3D): { x: number; z: number } {
  post.updateWorldMatrix(true, true);
  const v = post.getObjectByName("model")!.children[0].getWorldPosition(new Vector3());
  return { x: v.x, z: v.z };
}

/** The sim's aspects, as a test sets them. */
function aspects() {
  const clear = new Map<number, boolean>();
  return {
    clear,
    signalsVersion: 0,
    markClear(id: number) {
      return clear.get(id) ?? true;
    },
  };
}

/** A library with a stand-in model for each kit: a box, and its moving parts as the kits name them. */
function fakeModels(): MarkModels {
  const mat = new MeshBasicMaterial();
  const part = (name: string) => {
    const holder = new Group();
    const g = new Group();
    g.name = name;
    g.add(new Mesh(new BoxGeometry(2, 2, 2), mat));
    holder.add(g);
    return holder;
  };
  return {
    model: () => ({ parts: [{ geometry: new BoxGeometry(4, 4, 4), material: mat }] }),
    load: () => Promise.resolve(),
    moversOf: (type) => {
      const g = new Group();
      if (type === "kit-semaphore-signal") g.add(part("arm"));
      if (type === "kit-colour-light-signal") g.add(part("red"), part("amber"), part("green"));
      if (type === "kit-signal-gantry") g.add(part("r0"), part("g0"), part("r1"), part("g1"));
      return g;
    },
  };
}

describe("signal marks' drawing", () => {
  it("a few draws however many signals; nothing done when nothing changed", () => {
    const layout = new Layout();
    const ids = chain(layout, Array<PieceTypeId>(24).fill(S));
    const sim = aspects();
    const view = new SignalMarksView(layout, sim, mats, fakeModels());
    layout.addSignal(connectorRef(ids[0], 1));
    expect(view.sync()).toBe(true);
    const one = view.drawCalls;
    for (let i = 2; i < 22; i += 2) layout.addSignal(connectorRef(ids[i], 1));
    expect(view.sync()).toBe(true);
    expect(view.drawCalls).toBe(one);
    expect(view.sync()).toBe(false);
    // (Three looks in use: more draws, but still a few, whatever the count.)
    let k = 0;
    for (const m of [...layout.signals()]) layout.setSignalStyle(m.id, (["plain", "semaphore", "colour-light"] as const)[k++ % 3]);
    view.sync();
    expect(view.drawCalls).toBeLessThanOrEqual(12);
  });

  it("an aspect change glides the arm over about 0.3 s, then asks for no more frames", () => {
    const layout = new Layout();
    const ids = chain(layout, [S, S]);
    const sim = aspects();
    const view = new SignalMarksView(layout, sim, mats, fakeModels());
    const id = layout.addSignal(connectorRef(ids[0], 1), "semaphore");
    view.sync();
    const up = view.shownOf(id)!.angle;
    expect(view.animate(0.016)).toBe(false);
    sim.clear.set(id, false);
    sim.signalsVersion++;
    view.sync();
    let t = 0;
    let frames = 0;
    while (view.animate(0.016)) {
      t += 0.016;
      frames++;
      if (frames > 100) break;
    }
    expect(Math.abs(t - ARM_GLIDE_S)).toBeLessThan(0.04);
    expect(view.shownOf(id)!.angle).toBe(0);
    expect(up).not.toBe(0);
    expect(view.animate(0.016)).toBe(false);
  });

  it("two signals side by side on double track, the same way: a gantry over both", () => {
    const layout = new Layout();
    const [a, b] = chain(layout, ["double-straight", "double-straight"]);
    const sim = aspects();
    const view = new SignalMarksView(layout, sim, mats, fakeModels());
    // (Each road's end at the joint, both guarding the same way.)
    const ends = [0, 1, 2, 3].map((c) => connectorRef(a, c)).filter((r) => layout.joinedConnector(r) !== -1);
    const far = ends.filter((r) => {
      const o = layout.joinedConnector(r);
      return Math.floor(o / 8) === b;
    });
    expect(far.length).toBe(2);
    const m1 = layout.addSignal(far[0]);
    const m2 = layout.addSignal(far[1]);
    view.sync();
    expect(view.shownOf(m1)!.look).toBe("gantry");
    expect(view.shownOf(m2)!.look).toBe("gantry");
    // One the other way round: no longer side by side the same way.
    layout.turnSignal(m2);
    view.sync();
    expect(view.shownOf(m1)!.look).toBe("plain");
  });
});

describe("a signal set's ghost", () => {
  it("shows both posts, one each side of the joint, or the one when it's a lone signal; the view hides a set picked up", () => {
    const layout = new Layout();
    const ids = chain(layout, [S, S, S]);
    const at = connectorRef(ids[0], 1);
    const ghost = markSetGhost(mats);
    const [a, b] = [ghost.getObjectByName("post0")!, ghost.getObjectByName("post1")!];
    expect(placeSetGhost(ghost, layout, at, true)).toBe(true);
    expect(b.visible).toBe(true);
    // (Either side of the track: the posts stand on the drivers' right of opposite ways.)
    const [pa, pb] = [ghostPost(a), ghostPost(b)];
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThan(30);
    expect(placeSetGhost(ghost, layout, at, false)).toBe(true);
    expect(b.visible).toBe(false);
    // (An open end has no other side: one post only.)
    expect(placeSetGhost(ghost, layout, connectorRef(ids[2], 1), true)).toBe(true);
    expect(b.visible).toBe(false);
    const sim = aspects();
    const view = new SignalMarksView(layout, sim, mats);
    const m1 = layout.addSignal(at);
    const m2 = layout.addSignal(connectorRef(ids[1], 0));
    view.sync();
    expect([view.topOf(m1), view.topOf(m2)].every(Boolean)).toBe(true);
    view.hidden = [m1, m2];
    expect(view.sync()).toBe(true);
    expect([view.topOf(m1), view.topOf(m2)]).toEqual([null, null]);
  });

  it("a ghost in the hand stands just where the drawn signal does, mirrored to the left by a crossover", () => {
    // (The user's report: a signal by a crossover put down on its other road, not where its preview stood.)
    const layout = new Layout();
    const [a] = chain(layout, [S]);
    const x = appendPiece(layout, "crossover", false, connectorRef(a, 1));
    chain(layout, [S], connectorRef(x, 1));
    chain(layout, [S], connectorRef(x, 2));
    chain(layout, [S], connectorRef(x, 3));
    const view = new SignalMarksView(layout, aspects(), mats);
    const ghost = markSetGhost(mats);
    const post = ghost.getObjectByName("post0")!;
    const ends = [connectorRef(a, 1), connectorRef(x, 0), connectorRef(x, 1), connectorRef(x, 2), connectorRef(x, 3)].filter((e) => layout.joinedConnector(e) !== -1);
    expect(ends.length).toBe(5);
    let mirrored = 0;
    for (const at of ends) {
      const id = layout.addSignal(at);
      view.sync();
      placeSetGhost(ghost, layout, at, false);
      const g = ghostPost(post);
      const top = view.topOf(id)!;
      expect(Math.hypot(g.x - top.x, g.z - top.z)).toBeLessThan(0.01);
      if ((post.getObjectByName("model")!.scale.z as number) < 0) mirrored++;
      layout.removeSignal(id);
    }
    // (At the crossover's far end on its first line, and its second line's near end: the right is its board.)
    expect(mirrored).toBe(2);
    // (Drawn mirrored: the lit lamps' own mirrored batches, at most 2 more draws however many; the rest as the right's.)
    for (const at of ends) layout.addSignal(at);
    view.sync();
    // (The toy light: foot, post, head, two dim lenses, and the lit lamps, red and green.)
    expect(view.drawCalls).toBeLessThanOrEqual(7 + 2);
  });
});
