/**
 * What a signal pair shows as it's placed (the user: "do the signal lights change realistically?", with a screenshot of
 * a pair before a station, a train standing at the platform past them, and the post facing the platform green).
 */
import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { Sim } from "./sim";

/** Straights, then a station: ids in order along the line, the station last. */
function lineToStation(): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece("straight-216" as PieceTypeId, { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < 4; i++) ids.push(appendPiece(layout, "straight-216", false, connectorRef(ids[i - 1], 1)));
  ids.push(appendPiece(layout, "station", false, connectorRef(ids[3], 1)));
  ids.push(appendPiece(layout, "straight-216", false, connectorRef(ids[4], 1)));
  return { layout, ids };
}

describe("a signal pair before a station, a train standing at the platform", () => {
  it("the post facing the platform shows red as soon as it's placed (paused, nothing moving), the other green", () => {
    const { layout, ids } = lineToStation();
    const sim = new Sim(layout);
    const editor = new Editor(layout, sim, () => {});
    // A train standing at the platform (speed 0: no tick moves it).
    const t = sim.addTrain(["engine", "passenger"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 150 });
    expect(t.kind).toBe("placed");
    sim.tick();
    // The pair on the joint between the second and third straights: one guarding the way to the platform (from ids[1]'s
    // far end), one the way back (from ids[2]'s near end).
    const [toPlatform, back] = editor.addSignals([connectorRef(ids[1], 1), connectorRef(ids[2], 0)]);
    // (Placed while nothing moves, as on a paused game: read at once, no tick.)
    expect(sim.markClear(toPlatform)).toBe(false);
    expect(sim.markClear(back)).toBe(true);
    sim.tick();
    expect([sim.markClear(toPlatform), sim.markClear(back)]).toEqual([false, true]);
    // Turned round, moved, or the track changed under it: worked out again, still with nothing moving.
    editor.removeSignal(back);
    expect(editor.turnSignal(toPlatform)).toBe(true);
    expect(sim.markClear(toPlatform)).toBe(true);
    expect(editor.turnSignal(toPlatform)).toBe(true);
    expect(sim.markClear(toPlatform)).toBe(false);
    // The train taken away: clear.
    sim.removeTrain(sim.trainIds()[0]);
    sim.tick();
    expect(sim.markClear(toPlatform)).toBe(true);
  });
});
