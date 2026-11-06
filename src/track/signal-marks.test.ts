/** Signal marks on joints (docs/superpowers/specs/2026-10-31-signals.md §3, step 1): kept by the layout, undone by the editor. */
import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from ".";

function line(n = 4): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece("straight-216" as PieceTypeId, { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < n; i++) ids.push(appendPiece(layout, "straight-216", false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

describe("signal marks", () => {
  it("go on joints only, one each way; turned round, a mark faces the other way on the same joint", () => {
    const { layout, ids } = line();
    expect(layout.addSignal(connectorRef(ids[0], 0))).toBe(-1); // an open end
    const a = layout.addSignal(connectorRef(ids[1], 1));
    expect(a).toBeGreaterThan(0);
    expect(layout.addSignal(connectorRef(ids[1], 1))).toBe(-1);
    const b = layout.addSignal(connectorRef(ids[2], 0));
    expect(b).toBeGreaterThan(0);
    // (Both ways taken: neither turns.)
    expect(layout.turnSignal(a)).toBe(false);
    layout.removeSignal(b);
    const v = layout.signalsVersion;
    expect(layout.turnSignal(a)).toBe(true);
    expect(layout.getSignal(a)!.at).toBe(connectorRef(ids[2], 0));
    expect(layout.signalsVersion).toBeGreaterThan(v);
  });

  it("go when a piece of their joint is taken up, and come back with it (undo)", () => {
    const { layout, ids } = line();
    const editor = new Editor(layout, new Sim(layout), () => {});
    const a = layout.addSignal(connectorRef(ids[1], 1), "semaphore");
    expect(editor.remove(ids[2])).toBe(true);
    expect(layout.signalCount).toBe(0);
    expect(editor.undo()).toBe(true);
    expect(layout.getSignal(a)).toMatchObject({ at: connectorRef(ids[1], 1), style: "semaphore" });
    // Lifted to be moved and put down where it was: still there.
    const p = layout.getPiece(ids[1])!;
    layout.liftPiece(ids[1]);
    expect(layout.signalCount).toBe(0);
    layout.dropPiece(ids[1], p.pose, p.y);
    expect(layout.getSignal(a)?.at).toBe(connectorRef(ids[1], 1));
  });

  it("placing, turning and taking one away are each an undo step, with no track work", () => {
    const { layout, ids } = line();
    let trackEdits = 0;
    let signalEdits = 0;
    const editor = new Editor(layout, new Sim(layout), () => trackEdits++);
    editor.onSignalsChange = () => signalEdits++;
    expect(editor.addSignal(connectorRef(ids[0], 0))).toBe(-1);
    const a = editor.addSignal(connectorRef(ids[1], 1), "colour-light");
    expect(editor.turnSignal(a)).toBe(true);
    expect(layout.getSignal(a)!.at).toBe(connectorRef(ids[2], 0));
    expect(editor.removeSignal(a)).toBe(true);
    expect(layout.signalCount).toBe(0);
    editor.undo();
    expect(layout.getSignal(a)).toMatchObject({ at: connectorRef(ids[2], 0), style: "colour-light" });
    editor.undo();
    expect(layout.getSignal(a)!.at).toBe(connectorRef(ids[1], 1));
    editor.undo();
    expect(layout.signalCount).toBe(0);
    editor.redo();
    expect(layout.getSignal(a)!.at).toBe(connectorRef(ids[1], 1));
    expect(trackEdits).toBe(0);
    expect(signalEdits).toBe(7);
  });

  it("a set (one each way on a joint) moves together to another joint, one each side, as one undo step", () => {
    const { layout, ids } = line(6);
    const editor = new Editor(layout, new Sim(layout), () => {});
    const [a, b] = editor.addSignals([connectorRef(ids[1], 1), connectorRef(ids[2], 0)]);
    layout.setSignalMode(b, "red");
    expect(layout.signalPartner(a)!.id).toBe(b);
    expect(layout.signalPartner(b)!.id).toBe(a);
    // Moved by either: both go, the moved one to the end it was dropped on, its partner to that joint's other end.
    expect(editor.moveSignal(b, connectorRef(ids[4], 0))).toBe(true);
    expect([layout.getSignal(b)!.at, layout.getSignal(a)!.at]).toEqual([connectorRef(ids[4], 0), connectorRef(ids[3], 1)]);
    expect(layout.getSignal(b)).toMatchObject({ mode: "red" });
    expect(layout.signalCount).toBe(2);
    editor.undo();
    expect([layout.getSignal(a)!.at, layout.getSignal(b)!.at]).toEqual([connectorRef(ids[1], 1), connectorRef(ids[2], 0)]);
    editor.redo();
    expect(layout.getSignal(a)!.at).toBe(connectorRef(ids[3], 1));
    // Not onto a joint with another signal on either end, nor onto an open end.
    const c = editor.addSignal(connectorRef(ids[1], 1));
    expect(editor.signalSetAt(a, connectorRef(ids[2], 0))).toBeNull();
    expect(editor.moveSignal(a, connectorRef(ids[2], 0))).toBe(false);
    expect(editor.moveSignal(a, connectorRef(ids[0], 0))).toBe(false);
    // Onto its own joint the other way round: the set swaps sides.
    expect(editor.moveSignal(a, connectorRef(ids[4], 0))).toBe(true);
    expect([layout.getSignal(a)!.at, layout.getSignal(b)!.at]).toEqual([connectorRef(ids[4], 0), connectorRef(ids[3], 1)]);
    expect(layout.getSignal(c)!.at).toBe(connectorRef(ids[1], 1));
  });

  it("a set is taken away together, as one undo step; a lone one (an old save's) moves and goes by itself", () => {
    const { layout, ids } = line(6);
    const editor = new Editor(layout, new Sim(layout), () => {});
    const [a, b] = editor.addSignals([connectorRef(ids[1], 1), connectorRef(ids[2], 0)]);
    layout.setSignalMode(a, "green");
    expect(editor.removeSignalSet(b)).toBe(true);
    expect(layout.signalCount).toBe(0);
    editor.undo();
    expect([layout.getSignal(a), layout.getSignal(b)]).toMatchObject([{ at: connectorRef(ids[1], 1), mode: "green" }, { at: connectorRef(ids[2], 0), mode: "auto" }]);
    // A lone one, as an old save has (a mark facing one way only): no partner; it moves and goes by itself.
    const lone = layout.addSignal(connectorRef(ids[3], 1), "plain", true);
    expect(layout.signalPartner(lone)).toBeUndefined();
    expect(editor.signalSetAt(lone, connectorRef(ids[4], 1))).toEqual({ ids: [lone], ats: [connectorRef(ids[4], 1)] });
    expect(editor.moveSignal(lone, connectorRef(ids[4], 1))).toBe(true);
    expect(layout.getSignal(lone)).toMatchObject({ at: connectorRef(ids[4], 1), mode: "red" });
    expect(layout.signalCount).toBe(3);
    expect(editor.removeSignalSet(lone)).toBe(true);
    expect(layout.signalCount).toBe(2);
  });

  it("a set cleared in a group (as Clear's sweep does, with track and props) comes back with one undo", () => {
    const { layout, ids } = line(6);
    const editor = new Editor(layout, new Sim(layout), () => {});
    const [a] = editor.addSignals([connectorRef(ids[1], 1), connectorRef(ids[2], 0)]);
    expect(editor.group(() => void editor.removeSignalSet(a))).toBe(true);
    expect(layout.signalCount).toBe(0);
    expect(editor.undo()).toBe(true);
    expect(layout.signalCount).toBe(2);
  });
});
