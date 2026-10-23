import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { appendPiece, connectorRef, Layout } from "../track";
import { Sim } from "./sim";

// QA's eraser check: a 36 mm piece between a car's two bogies (56 mm apart on an engine) counted as free, so the
// eraser took it from under the train, which floated over the gap. The editor's pinned check and the lift check ask
// the same question.

/** 216, 36, 216 in a line; an engine whose axles stand on the two long ones, the short one between them. */
function spanned(lead = 15) {
  const layout = new Layout();
  const sim = new Sim(layout);
  const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  const b = appendPiece(layout, "straight-36", false, connectorRef(a, 1));
  const c = appendPiece(layout, "straight-216", false, connectorRef(b, 1));
  const r = sim.addTrain(["engine"], { pieceId: c, pathIndex: 0, s: lead, reversed: false });
  if (r.kind !== "placed") throw new Error("no train");
  return { layout, sim, a, b, c, train: r.trainId };
}

describe("a piece under a car is taken, not only one under a wheel", () => {
  it("a short piece between a car's two bogies is occupied", () => {
    const { sim, a, b, c, train } = spanned();
    const t = sim.getTrain(train)!;
    // (Neither axle on it: that's the case.)
    expect(t.bogies.map((x) => x.pieceId)).toEqual([c, a]);
    expect(sim.pieceOccupied(b)).toBe(true);
    expect(sim.piecesUnder(train)).toEqual(new Set([a, b, c]));
  });

  it("so is one between two cars, under their coupling", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const b = appendPiece(layout, "straight-36", false, connectorRef(a, 1));
    const c = appendPiece(layout, "straight-216", false, connectorRef(b, 1));
    // (An engine and a wagon: the engine's rear axle 2 mm past the 36, the wagon's front one 2 mm short of it, the
    // 40 mm between them two cars' ends and the coupling.)
    const r = sim.addTrain(["engine", "timber"], { pieceId: c, pathIndex: 0, s: 58, reversed: false });
    if (r.kind !== "placed") throw new Error("no train");
    expect(sim.getTrain(r.trainId)!.bogies.some((x) => x.pieceId === b)).toBe(false);
    expect(sim.pieceOccupied(b)).toBe(true);
  });

  it("not one just past the front axle (a switch there is still the train's to throw)", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const a = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const b = appendPiece(layout, "straight-36", false, connectorRef(a, 1));
    sim.addTrain(["engine"], { pieceId: a, pathIndex: 0, s: 206, reversed: false });
    expect(sim.pieceOccupied(b)).toBe(false);
  });

  it("works it out again when the train moves", () => {
    const { sim, b, train } = spanned();
    expect(sim.pieceOccupied(b)).toBe(true);
    const t = sim.getTrain(train)!;
    for (const car of t.cars) sim.setLever(car.id, 1);
    for (let i = 0; i < 600 && sim.pieceOccupied(b); i++) sim.tick();
    expect(sim.pieceOccupied(b)).toBe(false);
  });

  it("an undo that would take it up from under the car is refused, as for one under a wheel", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const editor = new Editor(layout, sim, () => {});
    const refused: number[] = [];
    editor.onTrainOn = (id) => refused.push(id);
    // (Two long ones a 36 apart, then the 36 laid into the gap with the editor: undoing it takes it up.)
    layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const c = layout.addPiece("straight-216", { x: 252, z: 0, heading: 0 });
    const b = editor.place("straight-36", { x: 216, z: 0, heading: 0 }, 0, false);
    expect([0, 1].map((k) => layout.joinedConnector(connectorRef(b, k)) !== -1)).toEqual([true, true]);
    expect(sim.addTrain(["engine"], { pieceId: c, pathIndex: 0, s: 15, reversed: false }).kind).toBe("placed");
    expect(sim.pieceOccupied(b)).toBe(true);
    expect(editor.undo()).toBe(false);
    expect(layout.getPiece(b)).toBeDefined();
    expect(refused).toEqual([b]);
  });

  it("costs a few microseconds a call", () => {
    const { sim, b } = spanned();
    for (let i = 0; i < 1000; i++) sim.pieceOccupied(b);
    const n = 100000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) sim.pieceOccupied(b + 100);
    const us = ((performance.now() - t0) * 1000) / n;
    console.log(`pieceOccupied (standing train, free piece): ${us.toFixed(3)} us a call`);
    expect(us).toBeLessThan(5);
  });
});
