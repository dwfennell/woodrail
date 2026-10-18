import { describe, expect, it } from "vitest";
import { Economy } from "../economy";
import { Sim } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { GOALS, GoalTracker } from "./goals";
import { editLine } from "./lines";
import { loopOnLine, passingLoops } from "./passing-loop";
import { buildStarterWorld, type World } from "./world";

function chain(layout: Layout, types: readonly PieceTypeId[], from = -1, flips: readonly boolean[] = []): number[] {
  const ids: number[] = [];
  let ref = from;
  types.forEach((t, k) => {
    const id = ref === -1 ? layout.addPiece(t, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, t, !!flips[k], ref);
    ids.push(id);
    ref = connectorRef(id, 1);
  });
  return ids;
}

/** Depot X, a passing loop (or, `loop` false, just a siding off a switch), depot Y. */
function layoutWith(loop: boolean) {
  const layout = new Layout();
  const [x, w1] = chain(layout, ["depot-forest", "straight-216"]);
  const s1 = appendPiece(layout, "switch", false, connectorRef(w1, 1));
  const main = chain(layout, ["straight-216", "straight-216"], connectorRef(s1, 1));
  const [c1] = chain(layout, ["curve-large"], connectorRef(s1, 2), [true]);
  const m = appendPiece(layout, "straight-216", false, connectorRef(c1, 1));
  let end = main[1];
  if (loop) {
    const [c2] = chain(layout, ["curve-large"], connectorRef(m, 1), [true]);
    end = appendPiece(layout, "switch", true, connectorRef(c2, 1), 2);
  }
  const [, y] = chain(layout, ["straight-216", "depot-sawmill"], connectorRef(end, loop ? 0 : 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", x, 0);
  const dy = economy.addDepot("sawmill", y, 0);
  return { layout, sim, economy, x, y, s1, m, dx, dy };
}

describe("passing loops", () => {
  it("finds two roads side by side between two switches (and not a siding)", () => {
    const l = layoutWith(true);
    const loops = passingLoops(l.layout);
    expect(loops).toHaveLength(1);
    expect(loops[0].pieces.has(l.s1)).toBe(true);
    expect(loops[0].pieces.has(l.m)).toBe(true);
    expect(passingLoops(layoutWith(false).layout)).toHaveLength(0);
    // Cached till the track changes: taking a piece of a road up breaks the loop.
    expect(passingLoops(l.layout)).toBe(loops);
    l.layout.removePiece(l.m);
    expect(passingLoops(l.layout)).toHaveLength(0);
  });

  it("the loop goal: done once a line with a train runs through a passing loop", () => {
    const g = GOALS.find((x) => x.id === "lay-loop")!;
    const l = layoutWith(true);
    const w = { economy: l.economy, layout: l.layout, sim: l.sim } as unknown as World;
    // A loop, but no line runs there.
    expect(g.check(w).done).toBe(false);
    const placed = l.sim.addTrain(["engine"], { pieceId: l.x, pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const engine = l.sim.getTrain(placed.trainId)!.cars[0].id;
    editLine(l.economy, engine, (s) => s.push({ depotId: l.dx.id, action: "auto" }, { depotId: l.dy.id, action: "auto" }));
    expect(loopOnLine(l.economy)).toBe(true);
    expect(g.check(w).done).toBe(true);
    // The same line with only a siding: not a passing loop.
    const s = layoutWith(false);
    const p2 = s.sim.addTrain(["engine"], { pieceId: s.x, pathIndex: 0, reversed: false, s: 150 });
    if (p2.kind !== "placed") throw new Error("no room");
    editLine(s.economy, s.sim.getTrain(p2.trainId)!.cars[0].id, (st) => st.push({ depotId: s.dx.id, action: "auto" }, { depotId: s.dy.id, action: "auto" }));
    expect(g.check({ economy: s.economy } as unknown as World).done).toBe(false);
  });

  it("comes right before two trains at once, once Switches and Signals are learned", () => {
    const ids = GOALS.map((g) => g.id);
    expect(ids.indexOf("lay-loop")).toBe(ids.indexOf("two-trains") - 1);
    expect(GOALS.find((g) => g.id === "lay-loop")!.needs).toEqual(["switches"]);
    expect(GOALS.find((g) => g.id === "lay-loop")!.hint).toBe("Two tracks side by side let trains pass.");
    const t = new GoalTracker(GOALS.filter((g) => !["lay-loop", "two-trains", "join-all"].includes(g.id)).map((g) => g.id));
    const w = buildStarterWorld();
    t.update(w, { learned: new Set() });
    expect(t.current()?.id).toBe("join-all");
    t.update(w, { learned: new Set(["switches", "signals"]) });
    expect([t.current()?.id, t.next()?.id]).toEqual(["lay-loop", "two-trains"]);
  });
});
