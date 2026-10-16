import { describe, expect, it } from "vitest";
import { Sim } from "../sim";
import { connectorRef, fitAutoStraight, getPieceDef, Layout, solveParentPose } from "../track";
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

  it("joins two track ends whose holes meet directly (any two ends join), in one undo step; trains run across", () => {
    const { layout, sim, editor } = setup();
    // Two straights end to end, their socket ends (holes) meeting at x = 0.
    const a = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-144", { x: 0, z: 0, heading: Math.PI }, 0, false);
    expect([...layout.pieceIds()].filter((i) => layout.getPiece(i)!.type === "joiner")).toHaveLength(0);
    expect(layout.joinedConnector(connectorRef(a, 0))).toBe(connectorRef(b, 0));
    // A train set off along b runs across the hole-to-hole joint onto a.
    const placed = sim.addTrain(["engine"], { pieceId: b, pathIndex: 0, s: 120, reversed: true });
    expect(placed.kind).toBe("placed");
    if (placed.kind === "placed") {
      sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
      for (let i = 0; i < 400; i++) sim.tick();
      expect(sim.getTrain(placed.trainId)!.bogies[0].pieceId).toBe(a);
    }
    editor.undo();
    expect(layout.getPiece(b)).toBeUndefined();
    expect(layout.joinedConnector(connectorRef(a, 0))).toBe(-1);
    editor.redo();
    expect(layout.jointCount).toBe(1);
  });

  it("trains run across a peg-to-peg joint too", () => {
    const { layout, sim, editor } = setup();
    // Two straights meeting peg to peg at x = 144.
    const a = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-144", { x: 288, z: 0, heading: Math.PI }, 0, false);
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(b, 1));
    const placed = sim.addTrain(["engine"], { pieceId: a, pathIndex: 0, s: 130, reversed: false });
    expect(placed.kind).toBe("placed");
    if (placed.kind === "placed") {
      sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
      for (let i = 0; i < 400; i++) sim.tick();
      expect(sim.getTrain(placed.trainId)!.bogies[0].pieceId).toBe(b);
    }
  });

  it("places a piece with the risers under it as one step", () => {
    const { layout, editor } = setup();
    const risers = [{ pose: { x: 216, z: 0, heading: 0 }, y: 0 }, { pose: { x: 216, z: 0, heading: 0 }, y: 64 }];
    const id = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 128, false, risers);
    const types = () => [...layout.pieceIds()].map((i) => layout.getPiece(i)!.type).sort();
    expect(types()).toEqual(["riser", "riser", "straight-216"]);
    editor.undo();
    expect(layout.pieceCount).toBe(0);
    editor.redo();
    expect(types()).toEqual(["riser", "riser", "straight-216"]);
    expect(layout.getPiece(id)!.y).toBe(128);
  });

  it("moves a piece with the risers it now needs as one step", () => {
    const { layout, editor } = setup();
    const id = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
    editor.move(id, { x: 0, z: 0, heading: 0 }, 64, undefined, [
      { pose: { x: 0, z: 0, heading: 0 }, y: 0 },
      { pose: { x: 216, z: 0, heading: 0 }, y: 0 },
    ]);
    expect(layout.pieceCount).toBe(3);
    editor.undo();
    expect(layout.pieceCount).toBe(1);
    expect(layout.getPiece(id)!.y).toBe(0);
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

  it("takes up joint play near a placed piece, as part of the same undo step", () => {
    const { layout, editor } = setup();
    const a = editor.place("straight-144", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-144", { x: 144, z: 0, heading: 0 }, 0, false);
    // Dropped 6 mm long of b's peg: b (loose) slides back so the joint closes, and a with it.
    const c = editor.place("straight-144", { x: 294, z: 0, heading: 0 }, 0, false);
    const gaps = () => [...layout.joints()].map((j) => j.posError);
    expect(gaps().length).toBe(2);
    expect(Math.max(...gaps())).toBeLessThan(0.05);
    expect(layout.getPiece(c)!.pose.x).not.toBe(294);
    editor.undo();
    expect(layout.getPiece(c)).toBeUndefined();
    expect(layout.getPiece(a)!.pose).toEqual({ x: 0, z: 0, heading: 0 });
    expect(layout.getPiece(b)!.pose).toEqual({ x: 144, z: 0, heading: 0 });
    editor.redo();
    expect(Math.max(...gaps())).toBeLessThan(0.05);
  });

  it("never shifts fixed pieces or track under a train", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    let station = -1;
    const editor = new Editor(layout, sim, () => {}, (id) => id === station);
    station = editor.place("station", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-144", { x: 216, z: 0, heading: 0 }, 0, false);
    const r = sim.addTrain(["engine"], { pieceId: b, pathIndex: 0, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error("not placed");
    editor.place("straight-144", { x: 366, z: 0, heading: 0 }, 0, false);
    expect(layout.getPiece(station)!.pose).toEqual({ x: 0, z: 0, heading: 0 });
    expect(layout.getPiece(b)!.pose).toEqual({ x: 216, z: 0, heading: 0 });
    expect(sim.getTrain(r.trainId)!.derailed).toBe(false);
    expect(Math.max(...[...layout.joints()].map((j) => j.posError))).toBeLessThan(0.05);
  });

  it("flips a curve about the end joined to other track, so it stays joined and bends the other way", () => {
    const { layout, editor } = setup();
    const s = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
    // A curve whose peg end (not its socket) is joined: the straight's socket at x = 0 takes the curve's peg.
    const peg = getPieceDef("curve-small", false).connectors[1].pose;
    const c = editor.place("curve-small", solveParentPose(peg, { x: 0, z: 0, heading: 0 }, { x: 0, z: 0, heading: 0 }), 0, false);
    expect(layout.jointCount).toBe(1);
    const before = pieceCentre(layout, c);
    expect(editor.flip(c)).toBe(true);
    expect(layout.getPiece(c)!.flipped).toBe(true);
    expect(layout.jointCount).toBe(1);
    expect(layout.joinedConnector(connectorRef(s, 0))).toBe(connectorRef(c, 1));
    // Mirrored across the straight's line: the curve now bends to the other side.
    const after = pieceCentre(layout, c);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(-before.z, 6);
    editor.undo();
    expect(layout.getPiece(c)!.flipped).toBe(false);
    expect(layout.jointCount).toBe(1);
  });
});

describe("moving a ramp", () => {
  it("may land flipped (its ends swapped, to come down from a peg), and undo puts it back as it was", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const editor = new Editor(layout, sim, () => {});
    const ramp = editor.place("ramp", { x: 0, z: 0, heading: 0 }, 0, false);
    layout.liftPiece(ramp);
    editor.move(ramp, { x: 300, z: 0, heading: 0 }, 0, undefined, [], true);
    expect(layout.getPiece(ramp)).toMatchObject({ flipped: true, pose: { x: 300 } });
    editor.undo();
    expect(layout.getPiece(ramp)).toMatchObject({ flipped: false, pose: { x: 0 } });
  });
});

describe("closing a near miss", () => {
  it("pulls loose track together at a few millimetres a joint, so a loop that closes a little off still joins", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    // The end to meet: a fixed piece's hole 16 mm further on and 12 mm to the side of where four straights end.
    const target = layout.addPiece("straight-216", { x: 216 * 5 + 16, z: 12, heading: 0 });
    const fixed = (id: number) => id === start || id === target;
    const editor = new Editor(layout, sim, () => {}, fixed);
    let last = start;
    for (let k = 0; k < 4; k++) {
      const c = getPieceDef("straight-216", false).connectors[0].pose;
      const w = layout.worldConnector(connectorRef(last, 1), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      const pose = solveParentPose(c, { x: w.x, z: w.z, heading: w.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
      last = editor.place("straight-216", pose, 0, false);
    }
    // Every joint seated, the closing one included, none badly.
    const ends = [connectorRef(last, 1), connectorRef(target, 0)];
    expect(layout.joinedConnector(ends[0])).toBe(ends[1]);
    for (const j of layout.joints()) expect(j.posError).toBeLessThan(5);
    // Undo opens the loop again (and takes the last piece away).
    editor.undo();
    expect(layout.joinedConnector(connectorRef(target, 0))).toBe(-1);
  });

  it("leaves ends that are too far apart alone", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const target = layout.addPiece("straight-216", { x: 216 * 2 + 60, z: 0, heading: 0 });
    const editor = new Editor(layout, sim, () => {}, (id) => id === start || id === target);
    const a = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(-1);
    expect(layout.getPiece(a)!.pose.x).toBeCloseTo(216);
  });
});

describe("stations giving a little", () => {
  it("a station shifts up to its reach to meet track that closes on it a little short, and says so", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    // The station's hole is 30 mm beyond where two straights end: more than loose track alone may take up here.
    const home = { x: 216 * 3 + 30, z: 0, heading: 0 };
    const station = layout.addPiece("station", home);
    const fixed = (id: number) => id === start || id === station;
    const give = (id: number) => (id === station ? { home, reach: 36, turn: (4 * Math.PI) / 180 } : null);
    const editor = new Editor(layout, sim, () => {}, fixed, give);
    const nudged: number[][] = [];
    editor.onNudge = (ids) => nudged.push(ids);
    const a = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-216", { x: 432, z: 0, heading: 0 }, 0, false);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(connectorRef(station, 0));
    const moved = layout.getPiece(station)!.pose;
    expect(Math.hypot(moved.x - home.x, moved.z - home.z)).toBeGreaterThan(0);
    expect(Math.hypot(moved.x - home.x, moved.z - home.z)).toBeLessThanOrEqual(36 + 1e-6);
    expect(nudged.flat()).toContain(station);
    // Undo puts the station back home.
    editor.undo();
    expect(layout.getPiece(station)!.pose.x).toBeCloseTo(home.x);
    void a;
  });

  it("without give, the same gap stays open", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const station = layout.addPiece("station", { x: 216 * 3 + 30, z: 0, heading: 0 });
    const editor = new Editor(layout, sim, () => {}, (id) => id === start || id === station);
    editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-216", { x: 432, z: 0, heading: 0 }, 0, false);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(-1);
  });
});

describe("pushing a run (nudge)", () => {
  it("pushing a line's free end up to a near miss closes it; undo parts it again", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const start = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
    const end = layout.addPiece("straight-216", { x: 216 * 3 + 70, z: 0, heading: 0 });
    // Both ends are stations, which give a little (as in the game).
    const homes = new Map([start, end].map((id) => [id, { ...layout.getPiece(id)!.pose }]));
    const give = (id: number) => (homes.has(id) ? { home: homes.get(id)!, reach: 36, turn: (4 * Math.PI) / 180 } : null);
    const editor = new Editor(layout, sim, () => {}, (id) => id === start || id === end, give);
    const a = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-216", { x: 432, z: 0, heading: 0 }, 0, false);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(-1);
    // 70 mm short: too far. Push the last piece 30 mm on: 40 mm short, within the near-miss reach.
    const before = new Map([[b, { ...layout.getPiece(b)!.pose }]]);
    const after = new Map([[b, { x: 432 + 30, z: 0, heading: 0 }]]);
    editor.nudge(before, after);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(connectorRef(end, 0));
    editor.undo();
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(-1);
    expect(layout.getPiece(b)!.pose.x).toBeCloseTo(432);
    void a;
  });
});

describe("picked pieces moved together (moveGroup, removeGroup)", () => {
  function line() {
    const { layout, editor } = setup();
    const a = editor.place("straight-216", { x: 0, z: 0, heading: 0 }, 0, false);
    const b = editor.place("straight-216", { x: 216, z: 0, heading: 0 }, 0, false);
    const c = editor.place("straight-216", { x: 432, z: 0, heading: 0 }, 0, false);
    // Free track further on, a little off the line's end.
    const d = editor.place("straight-216", { x: 1100, z: 0, heading: 0 }, 0, false);
    const poses = (ids: number[]) => new Map(ids.map((id) => [id, { ...layout.getPiece(id)!.pose }]));
    return { layout, editor, a, b, c, d, poses };
  }

  it("keeps the joints among them, parts the ones to other track; undo joins it back", () => {
    const { layout, editor, a, b, c, poses } = line();
    const before = poses([b, c]);
    const after = new Map([...before].map(([id, p]) => [id, { ...p, z: p.z + 200 }]));
    editor.moveGroup(before, after);
    expect(layout.getPiece(b)!.pose.z).toBeCloseTo(200);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(connectorRef(c, 0));
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(-1);
    editor.undo();
    expect(layout.getPiece(c)!.pose.z).toBeCloseTo(0);
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(b, 0));
    editor.redo();
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(-1);
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(connectorRef(c, 0));
  });

  it("a group put down with its end on other track's end joins it, in the same undo step", () => {
    const { layout, editor, b, c, d, poses } = line();
    const before = poses([b, c]);
    // The line's end is at 648; d starts at 1100.
    const after = new Map([...before].map(([id, p]) => [id, { ...p, x: p.x + 452 }]));
    editor.moveGroup(before, after);
    expect(layout.joinedConnector(connectorRef(c, 1))).toBe(connectorRef(d, 0));
    editor.undo();
    expect(layout.joinedConnector(connectorRef(c, 1))).toBe(-1);
    expect(layout.joinedConnector(connectorRef(d, 0))).toBe(-1);
  });

  it("removes them all as one step; undo puts them back joined", () => {
    const { layout, editor, a, b, c } = line();
    editor.removeGroup([b, c]);
    expect(layout.getPiece(b)).toBeUndefined();
    expect(layout.getPiece(c)).toBeUndefined();
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(-1);
    editor.undo();
    expect(layout.joinedConnector(connectorRef(a, 1))).toBe(connectorRef(b, 0));
    expect(layout.joinedConnector(connectorRef(b, 1))).toBe(connectorRef(c, 0));
  });
});

describe("the auto piece meeting an end a few degrees off", () => {
  it("is put down, and the loose track it meets turns to close the joint", () => {
    const { layout, editor } = setup();
    // A hole at (216, 0) facing −x to seat on; ahead of it, 126 back and 18 to the side, a hole turned 8°.
    const start = editor.place("straight-144", { x: 216, z: 0, heading: 0 }, 0, false);
    const a = (8 * Math.PI) / 180;
    const far = editor.place("straight-144", { x: 90, z: 18, heading: Math.PI + a }, 0, false);
    const fit = fitAutoStraight(layout, { x: 0, z: 0, heading: 0 }, 0, 1, [])!;
    expect(fit).not.toBeNull();
    const id = editor.place(fit.type, fit.pose, 0, fit.flipped);
    const ends = getPieceDef(fit.type, fit.flipped).connectors.map((_, i) => layout.joinedConnector(connectorRef(id, i)));
    expect(ends).toEqual(expect.arrayContaining([connectorRef(start, 0), connectorRef(far, 0)]));
  });
});
