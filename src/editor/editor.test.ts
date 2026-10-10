import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { Layout } from "../track";
import { Editor, pieceCentre } from "./editor";

function setup() {
  const layout = new Layout();
  const sim = new Sim(layout);
  let changes = 0;
  const editor = new Editor(layout, sim, () => changes++);
  return { layout, sim, editor, changes: () => changes };
}

describe("Editor", () => {
  it("place, undo and redo", () => {
    const { layout, editor, changes } = setup();
    const id = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    expect(layout.getPiece(id)).toBeDefined();
    editor.undo();
    expect(layout.getPiece(id)).toBeUndefined();
    editor.redo();
    expect(layout.getPiece(id)!.type).toBe("straight-144");
    expect(changes()).toBe(3);
  });

  it("remove restores joints on undo", () => {
    const { layout, editor } = setup();
    editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-144", { x: 144, z: 0, heading: 0 }, 0, false);
    expect(layout.jointCount).toBe(1);
    editor.remove(b);
    expect(layout.jointCount).toBe(0);
    editor.undo();
    expect(layout.jointCount).toBe(1);
  });

  it("move and undo move", () => {
    const { layout, editor } = setup();
    const a = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    editor.move(a, { x: 300, z: 50, heading: 1 }, 0);
    expect(layout.getPiece(a)!.pose.x).toBe(300);
    editor.undo();
    expect(layout.getPiece(a)!.pose).toEqual({ x: 0, z: 0, heading: 0 });
  });

  it("rotate turns a piece about its centre", () => {
    const { layout, editor } = setup();
    const a = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    const before = pieceCentre(layout, a);
    editor.rotate(a, Math.PI / 2);
    const after = pieceCentre(layout, a);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    expect(layout.getPiece(a)!.pose.heading).toBeCloseTo(Math.PI / 2);
  });

  it("flip toggles a flippable piece and ignores others", () => {
    const { layout, editor } = setup();
    const c = editor.place("curve-large", { x: 0, z: 0, heading: 0 }, 0, false);
    const s = editor.place("straight-54", { x: 500, z: 0, heading: 0 }, 0, false);
    expect(editor.flip(c)).toBe(true);
    expect(layout.getPiece(c)!.flipped).toBe(true);
    expect(editor.flip(s)).toBe(false);
    editor.undo();
    expect(layout.getPiece(c)!.flipped).toBe(false);
  });

  it("a new edit clears the redo stack", () => {
    const { editor } = setup();
    editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    editor.undo();
    editor.place("straight-54", { x: 0, z: 0, heading: 0 }, 0, false);
    expect(editor.canRedo).toBe(false);
  });

  it("removing track under a train derails it", () => {
    const { sim, editor } = setup();
    const a = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
    const r = sim.addTrain(["engine"], { pieceId: a, pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    editor.remove(a);
    expect(sim.getTrain(r.trainId)!.derailed).toBe(true);
  });
});

describe("Editor edits under trains", () => {
  for (const [name, act] of [
    ["rotate", (e: Editor, id: number) => e.rotate(id, Math.PI / 4)],
    ["move", (e: Editor, id: number) => e.move(id, { x: 400, z: 300, heading: 0 }, 0)],
    ["flip", (e: Editor, id: number) => e.flip(id)],
  ] as const) {
    it(`${name} of a piece a train stands on derails the train`, () => {
      const { sim, editor } = setup();
      const id = editor.place("curve-large", { x: 0, z: 0, heading: 0 }, 0, false);
      const r = sim.addTrain(["engine"], { pieceId: id, pathIndex: 0, reversed: false, s: 100 });
      if (r.kind !== "placed") throw new Error("not placed");
      act(editor, id);
      expect(sim.getTrain(r.trainId)!.derailed).toBe(true);
    });
  }

  it("editing an unrelated piece leaves trains running", () => {
    const { sim, editor } = setup();
    const a = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-54", { x: 900, z: 0, heading: 0 }, 0, false);
    const r = sim.addTrain(["engine"], { pieceId: a, pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("not placed");
    editor.rotate(b, Math.PI / 4);
    expect(sim.getTrain(r.trainId)!.derailed).toBe(false);
  });
});
