import { describe, expect, it } from "vitest";
import { connectorRef, createWorldConnector, Layout, type PieceTypeId } from "../track";
import { Sim, SIM_HZ } from "../sim";
import { Editor } from "./editor";

// A train lift carrying a train, or with one on it, can't be taken up or moved: the train would be left derailed in
// mid-air. The editor refuses the edit (and an undo or redo that would), leaving the history as it was.

function onEnd(layout: Layout, id: number, index: number, type: PieceTypeId): number {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, index), c);
  return layout.addPiece(type, { x: c.x, z: c.z, heading: c.heading }, c.y);
}

/** Felt, the lift, a level up: a turnback buffer at each end; a train of an engine and a coach heading for the lift. */
function line() {
  const layout = new Layout();
  layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
  const low = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const near = onEnd(layout, low, 1, "straight-216");
  const lift = onEnd(layout, near, 1, "kit-train-lift");
  const high = onEnd(layout, lift, 1, "straight-216");
  onEnd(layout, high, 1, "buffer-turnback");
  const sim = new Sim(layout);
  const placed = sim.addTrain(["engine", "passenger"], { pieceId: low, pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  sim.setLever(train().cars[0].id, 1);
  const held: number[] = [];
  const editor = new Editor(layout, sim, () => {});
  editor.onHeld = (id) => held.push(id);
  const until = (done: () => boolean, seconds = 40) => {
    for (let i = 0; i < seconds * SIM_HZ && !done(); i++) sim.tick();
    return done();
  };
  const onLift = () => train().bogies.some((b) => b.pieceId === lift);
  return { layout, sim, editor, lift, near, high, train, until, onLift, held };
}

describe("a train lift with a train on it stays put", () => {
  it("delete, move, turn: refused while the train's on it, and while it carries it; the train stays on the rails", () => {
    const w = line();
    w.editor.place("straight-54", { x: 0, z: 400, heading: 0 }, 0, false);
    expect(w.until(() => w.onLift() && w.train().speed === 0)).toBe(true);
    expect(w.sim.liftFree(w.lift)).toBe(false);
    expect(w.sim.heldLifts()).toEqual([w.lift]);
    const pose = { ...w.layout.getPiece(w.lift)!.pose };
    expect(w.editor.remove(w.lift)).toBe(false);
    expect(w.editor.rotate(w.lift, Math.PI / 4)).toBe(false);
    expect(w.editor.removeGroup([w.near, w.lift])).toBe(false);
    expect(w.layout.getPiece(w.lift)?.pose).toEqual(pose);
    expect(w.layout.getPiece(w.near)).toBeDefined();
    expect(w.held).toEqual([w.lift, w.lift, w.lift]);
    // Still joined both ends, and the train drives on as before.
    expect(w.layout.joinedConnector(connectorRef(w.lift, 0))).not.toBe(-1);
    expect(w.layout.joinedConnector(connectorRef(w.lift, 1))).not.toBe(-1);
    expect(w.train().derailed).toBe(false);
    // Mid-ride, the same.
    expect(w.until(() => w.sim.liftState(w.train().id) === "riding")).toBe(true);
    expect(w.editor.remove(w.lift)).toBe(false);
    expect(w.train().derailed).toBe(false);
    // Undo still undoes the last edit made (the straight put down), not a refused one.
    expect(w.editor.undo()).toBe(true);
    expect(w.layout.pieceCount).toBe(6);
    // It carries the train up and it drives off the top.
    expect(w.until(() => !w.onLift() && w.train().bogies[0].pieceId === w.high)).toBe(true);
    expect(w.train().derailed).toBe(false);
    expect(w.train().world[0].y).toBeCloseTo(48);
  });

  it("taken up once it's free; undo puts it back where its platform stood; a redo with a train now on it is refused, kept for later", () => {
    const w = line();
    // Up and off the top: the platform's left at the top, empty.
    expect(w.until(() => !w.onLift() && w.train().bogies[0].pieceId === w.high && w.sim.liftFree(w.lift))).toBe(true);
    expect(w.layout.switchState(w.lift)).toBe(1);
    // The train turns back at the buffer and waits at the platform's top end... take the lift up first.
    expect(w.editor.remove(w.lift)).toBe(true);
    w.sim.trackChanged();
    expect(w.layout.getPiece(w.lift)).toBeUndefined();
    expect(w.editor.undo()).toBe(true);
    w.sim.trackChanged();
    // Back, joined, its platform at the top where it was (not sent back down to the felt).
    expect(w.layout.getPiece(w.lift)).toBeDefined();
    expect(w.layout.switchState(w.lift)).toBe(1);
    expect(w.sim.liftPosition(w.lift)).toBe(1);
    expect(w.layout.joinedConnector(connectorRef(w.lift, 1))).not.toBe(-1);
    // The train comes back onto it from the top: a redo (taking it up again) is refused, and kept.
    expect(w.until(() => w.onLift())).toBe(true);
    expect(w.editor.redo()).toBe(false);
    expect(w.held).toEqual([w.lift]);
    expect(w.layout.getPiece(w.lift)).toBeDefined();
    expect(w.editor.canRedo).toBe(true);
    expect(w.train().derailed).toBe(false);
    // Carried down and off the bottom, the lift free again: the redo goes.
    expect(w.until(() => !w.onLift() && w.train().bogies[0].pieceId === w.near && w.sim.liftFree(w.lift))).toBe(true);
    expect(w.train().derailed).toBe(false);
    expect(w.editor.redo()).toBe(true);
    expect(w.layout.getPiece(w.lift)).toBeUndefined();
  });

  it("an undo that would take up a lift with a train on it (its placing undone) is refused, the history kept", () => {
    const w = line();
    // Take the lift up and put it down again, as an edit: undoing that edit takes it up.
    const at = { ...w.layout.getPiece(w.lift)! };
    expect(w.editor.remove(w.lift)).toBe(true);
    const lift = w.editor.place("kit-train-lift", at.pose, at.y, false);
    w.sim.trackChanged();
    expect(w.layout.joinedConnector(connectorRef(lift, 0))).not.toBe(-1);
    expect(w.until(() => w.train().bogies.every((b) => b.pieceId === lift) && w.train().speed === 0)).toBe(true);
    expect(w.editor.undo()).toBe(false);
    expect(w.held).toEqual([lift]);
    expect(w.layout.getPiece(lift)).toBeDefined();
    expect(w.editor.canUndo).toBe(true);
    expect(w.editor.canRedo).toBe(false);
    expect(w.train().derailed).toBe(false);
  });

  it("a lift going to its other end empty can't be taken up either", () => {
    const w = line();
    w.sim.removeTrain(w.sim.trainIds()[0]);
    expect(w.sim.toggleSwitch(w.lift)).toBe(true);
    w.sim.tick();
    expect(w.sim.liftFree(w.lift)).toBe(false);
    expect(w.editor.remove(w.lift)).toBe(false);
    expect(w.until(() => w.sim.liftFree(w.lift), 10)).toBe(true);
    expect(w.editor.remove(w.lift)).toBe(true);
    // Any other piece is free as ever.
    expect(w.sim.liftFree(w.near)).toBe(true);
  });
});
