import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout } from "../track";
import { Sim, SIM_HZ, trainKey } from "./index";
import { Economy } from "../economy/economy";
import { chain } from "../economy/loop-fixtures";
import { editLine } from "../game/lines";

/** A straight line: buffer, forest, 6 straights, switch (its branch a spur), 2 straights, sawmill, buffer. */
function world() {
  const L = new Layout();
  const ids = [-1, ...chain(L, ["depot-forest", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "switch", "straight-216", "straight-216", "depot-sawmill", "buffer-turnback"])];
  appendPiece(L, "buffer-turnback", false, connectorRef(ids[1], 0));
  const sw = ids[8];
  chain(L, ["straight-216", "buffer-turnback"], connectorRef(sw, 2));
  const sim = new Sim(L);
  const economy = new Economy(L, sim);
  const forest = economy.addDepot("forest", ids[1], 0);
  const saw = economy.addDepot("sawmill", ids[11], 0);
  return { L, sim, economy, ids, sw, forest, saw };
}

const run = (w: ReturnType<typeof world>, seconds: number, until?: () => boolean) => {
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    w.sim.tick();
    w.economy.tick();
    if (until?.()) return true;
  }
  return false;
};

/** Every switch's lock holders (engines), as a string. */
const locks = (w: ReturnType<typeof world>) => [...w.L.pieceIds()].map((id) => `${id}:${[...w.economy.router.holdersOf(id)].join(",")}`).join(" ");

/** A routed train (engine, timber) on the line forest → sawmill, its lever on, heading for the sawmill. */
function routed(w: ReturnType<typeof world>, pieceId: number) {
  const placed = w.sim.addTrain(["engine", "timber"], { pieceId, pathIndex: 0, reversed: false, s: 100 });
  if (placed.kind !== "placed") throw new Error("no room");
  const engine = w.sim.getTrain(placed.trainId)!.cars[0].id;
  const line = editLine(w.economy, engine, (st) => st.push({ depotId: w.forest.id, action: "auto" }, { depotId: w.saw.id, action: "auto" }))!;
  w.economy.routeOf(engine)!.next = 1;
  w.sim.setLever(engine, 1);
  return { engine, line };
}

describe("trainKey: per-train state lasts through a turn, a couple and a split (architecture review §3.4)", () => {
  it("a couple (an engine catching wagons: its train takes the wagons' id) keeps the engine's line, route and locks; it delivers", () => {
    const w = world();
    // (The points set for the spur: the router locks and throws them for the train's way on to the sawmill.)
    w.L.setSwitchState(w.sw, 1);
    w.economy.prune();
    const wagons = w.sim.addTrain(["timber", "timber"], { pieceId: w.ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (wagons.kind !== "placed") throw new Error("no room");
    const { engine, line } = routed(w, w.ids[4]);
    const route = w.economy.routeOf(engine)!;
    const was = w.sim.findCar(engine)!.train.id;
    let coupled = false;
    for (let i = 0; i < 60 * SIM_HZ && !coupled; i++) {
      const before = locks(w);
      w.sim.tick();
      const t = w.sim.findCar(engine)!.train;
      if (t.id !== was) {
        coupled = true;
        // The tick it coupled: a new train id, the same key, and everything the engine had.
        expect(t.id).toBe(wagons.trainId);
        expect(t.cars.length).toBe(4);
        expect(trainKey(t)).toBe(engine);
        expect(locks(w)).toBe(before);
      }
      w.economy.tick();
    }
    expect(coupled).toBe(true);
    expect(w.economy.lineIdOf.get(engine)).toBe(line.id);
    expect(w.economy.routeOf(engine)).toBe(route);
    // (The game prunes on every track edit: the coupled engine keeps its route and line.)
    w.economy.prune();
    expect(w.economy.routeOf(engine)).toBe(route);
    // The payoff: on with its wagons, through the points the router set, to the sawmill.
    expect(run(w, 120, () => route.at && route.next === 1)).toBe(true);
    expect(w.sim.findCar(engine)!.train.cars.length).toBe(4);
  });

  it("a split keeps the key with the part that has the engine; the wagons left get their own", () => {
    const w = world();
    const placed = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: w.ids[4], pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const t = w.sim.getTrain(placed.trainId)!;
    const [e, w1, w2] = t.cars.map((c) => c.id);
    expect(trainKey(t)).toBe(e);
    const r = w.sim.decouple(w1);
    expect(r.kind).toBe("decoupled");
    expect(trainKey(w.sim.findCar(e)!.train)).toBe(e);
    expect(w.sim.findCar(w1)!.train).toBe(w.sim.findCar(w2)!.train);
    expect(trainKey(w.sim.findCar(w2)!.train)).toBe(w1);
  });

  it("a turn keeps who holds whom: a train close behind one that turns round is still held by it (its new id), at once", () => {
    const w = world();
    const a = w.sim.addTrain(["engine", "timber"], { pieceId: w.ids[3], pathIndex: 0, reversed: false, s: 100 });
    const b = w.sim.addTrain(["engine", "timber"], { pieceId: w.ids[6], pathIndex: 0, reversed: false, s: 100 });
    if (a.kind !== "placed" || b.kind !== "placed") throw new Error("no room");
    const ea = w.sim.getTrain(a.trainId)!.cars[0].id;
    const eb = w.sim.getTrain(b.trainId)!.cars[0].id;
    w.sim.setLever(ea, 1);
    expect(run(w, 20, () => w.sim.heldHow(a.trainId) === "follow")).toBe(true);
    expect(w.sim.heldBy(a.trainId)).toBe(b.trainId);
    const turned = w.sim.turnNow(b.trainId);
    expect(turned).not.toBeNull();
    expect(turned!.id).not.toBe(b.trainId);
    expect(trainKey(turned!)).toBe(eb);
    // (Before trainKey, the hold named the old id, gone: "held by nobody" till the next tick's look.)
    expect(w.sim.heldBy(a.trainId)).toBe(turned!.id);
  });

  it("is the engine's car id wherever it's coupled (a car id, so a v14 reload keeps it), or the first car's with no engine", () => {
    const w = world();
    const placed = w.sim.addTrain(["timber", "engine", "timber"], { pieceId: w.ids[4], pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const t = w.sim.getTrain(placed.trainId)!;
    expect(trainKey(t)).toBe(t.cars[1].id);
    const wagons = w.sim.addTrain(["timber", "timber"], { pieceId: w.ids[6], pathIndex: 0, reversed: false, s: 150 });
    if (wagons.kind !== "placed") throw new Error("no room");
    // (No engine: its first car's id.)
    expect(trainKey(w.sim.getTrain(wagons.trainId)!)).toBe(w.sim.getTrain(wagons.trainId)!.cars[0].id);
  });
});
