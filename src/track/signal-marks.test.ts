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
});
