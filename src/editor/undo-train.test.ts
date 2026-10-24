import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { Layout } from "../track";
import { Editor, TRAIN_ON_TRACK } from "./editor";

function setup() {
  const layout = new Layout();
  const sim = new Sim(layout);
  const editor = new Editor(layout, sim, () => {});
  const refused: number[] = [];
  editor.onTrainOn = (id) => refused.push(id);
  const base = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
  return { layout, sim, editor, refused, base };
}

function trainOn(sim: Sim, pieceId: number): number {
  const r = sim.addTrain(["engine"], { pieceId, pathIndex: 0, s: 100, reversed: false });
  if (r.kind !== "placed") throw new Error(`no train: ${r.kind}`);
  return r.trainId;
}

describe("undo and redo never derail a train (QA sweep 3)", () => {
  it("undoing a drawn line a train has rolled onto is refused, and the history kept to try again", () => {
    const { layout, sim, editor, refused } = setup();
    const ids = editor.placeRun([
      { type: "straight-216", pose: { x: 216, z: 0, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: 432, z: 0, heading: 0 }, y: 0, flipped: false },
    ]);
    const t = trainOn(sim, ids[1]);
    expect(editor.undo()).toBe(false);
    expect(refused).toEqual([ids[1]]);
    for (const id of ids) expect(layout.getPiece(id)).toBeDefined();
    expect(sim.getTrain(t)!.derailed).toBe(false);
    expect(editor.canUndo).toBe(true);
    expect(editor.canRedo).toBe(false);
    // Once the train has gone, the same undo goes ahead.
    sim.removeTrain(t);
    expect(editor.undo()).toBe(true);
    for (const id of ids) expect(layout.getPiece(id)).toBeUndefined();
  });

  it("a train on other track doesn't stop an undo", () => {
    const { layout, sim, editor, refused, base } = setup();
    const [id] = editor.placeRun([{ type: "straight-216", pose: { x: 216, z: 0, heading: 0 }, y: 0, flipped: false }]);
    const t = trainOn(sim, base);
    expect(editor.undo()).toBe(true);
    expect(refused).toEqual([]);
    expect(layout.getPiece(id)).toBeUndefined();
    expect(sim.getTrain(t)!.derailed).toBe(false);
  });

  it("redoing a take-up of track a train is now on is refused", () => {
    const { layout, sim, editor, refused } = setup();
    const id = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    editor.remove(id);
    editor.undo();
    expect(layout.getPiece(id)).toBeDefined();
    const t = trainOn(sim, id);
    expect(editor.redo()).toBe(false);
    expect(refused).toEqual([id]);
    expect(layout.getPiece(id)).toBeDefined();
    expect(editor.canRedo).toBe(true);
    expect(sim.getTrain(t)!.derailed).toBe(false);
  });

  it("undoing a move of track a train is now on is refused", () => {
    const { layout, sim, editor, refused } = setup();
    const id = editor.place("straight-216", { x: 0, z: 400, heading: 0 }, 0, false);
    editor.moveGroup(new Map([[id, { x: 0, z: 400, heading: 0 }]]), new Map([[id, { x: 0, z: 600, heading: 0 }]]));
    trainOn(sim, id);
    expect(editor.undo()).toBe(false);
    expect(refused).toEqual([id]);
    expect(layout.getPiece(id)!.pose.z).toBe(600);
  });

  it("the toast", () => {
    expect(TRAIN_ON_TRACK).toBe("A train is on that track");
  });
});

describe("no edit takes track from under a train (QA N1, occupied span)", () => {
  it("taking up, turning, flipping or moving the piece under an engine is refused, and nothing changes", () => {
    const { layout, sim, editor, refused } = setup();
    const id = editor.place("curve-large", { x: 216, z: 0, heading: 0 }, 0, false);
    const t = trainOn(sim, id);
    const was = { ...layout.getPiece(id)!.pose };
    expect(editor.remove(id)).toBe(false);
    expect(editor.rotate(id, Math.PI / 4)).toBe(false);
    expect(editor.flip(id)).toBe(false);
    expect(editor.move(id, { x: 900, z: 300, heading: 0 }, 0)).toBe(false);
    expect(editor.removeGroup([id])).toBe(false);
    expect(refused).toEqual([id, id, id, id, id]);
    expect(layout.getPiece(id)!.pose).toEqual(was);
    expect(layout.getPiece(id)!.flipped).toBe(false);
    expect(sim.getTrain(t)!.derailed).toBe(false);
    // None of it is on the history: with the train gone, one undo takes back the piece's placing.
    sim.removeTrain(t);
    expect(editor.undo()).toBe(true);
    expect(layout.getPiece(id)).toBeUndefined();
  });

  it("a group taken up with one piece under a train: all of it stays", () => {
    const { layout, sim, editor, refused, base } = setup();
    const id = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    trainOn(sim, id);
    expect(editor.removeGroup([base, id])).toBe(false);
    expect(refused).toEqual([id]);
    expect(layout.getPiece(base)).toBeDefined();
    expect(layout.getPiece(id)).toBeDefined();
  });

  it("track beside a train can still be taken up", () => {
    const { layout, sim, editor, refused } = setup();
    const far = editor.place("straight-216", { x: 2000, z: 0, heading: 0 }, 0, false);
    const near = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    trainOn(sim, near);
    expect(editor.remove(far)).toBe(true);
    expect(refused).toEqual([]);
    expect(layout.getPiece(far)).toBeUndefined();
  });
});

describe("a train's pieces follow the track (QA N2)", () => {
  it("are worked out again after an edit, though the train hasn't moved", () => {
    const { layout, sim, editor, base } = setup();
    const t = trainOn(sim, base);
    expect([...sim.piecesUnder(t)]).toEqual([base]);
    const before = sim.piecesUnder(t);
    // A piece put down beside it, joined: the cover is worked out again (a new set), still just the one piece.
    editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    expect(sim.piecesUnder(t)).not.toBe(before);
    expect(layout.revision).toBeGreaterThan(0);
  });
});
