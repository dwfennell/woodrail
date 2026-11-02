/**
 * Empty (a wagon card) and Empty all (the engine card): tip a standing train's goods out, thrown away. Refused while it
 * moves; a coach's riders stay; nothing held for a school is left behind; the toast says what went and where takes it.
 */
import { describe, expect, it } from "vitest";
import { Economy } from "./economy";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { addTipped, emptyWords, type Tipped } from "../game/empty-words";

/** Along +x: straights, a mill, straights; an engine, a timber wagon, a hopper and a coach on the second straight. */
function world() {
  const layout = new Layout();
  const types: PieceTypeId[] = ["straight-216", "straight-216", "straight-216", "depot-mill", "straight-216", "straight-216", "straight-216"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const cars: CarKind[] = ["engine", "timber", "hopper", "passenger"];
  const placed = sim.addTrain(cars, { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  // (Game mode's bigger wagons: 6 a wagon.)
  economy.wagonCapacity = 6;
  const mill = economy.addDepot("mill", ids[3]);
  const train = () => sim.getTrain([...sim.trainIds()][0]) as Train;
  const [engine, timber, hopper, coach] = train().cars.map((c) => c.id);
  economy.setCargo(timber, "planks", 6);
  economy.setCargo(hopper, "grain", 4);
  economy.setRiders(coach, 3, -1);
  return { layout, sim, economy, mill, train, engine, timber, hopper, coach };
}

describe("Empty", () => {
  it("tips a standing wagon's goods out, thrown away, and leaves the others", () => {
    const w = world();
    const v = w.economy.loadsVersion;
    expect(w.economy.dumpRefusal(w.timber)).toBeNull();
    expect(w.economy.dump(w.timber)).toEqual({ kind: "planks", count: 6 });
    expect(w.economy.cargoOf(w.timber).count).toBe(0);
    expect(w.economy.cargoOf(w.hopper)).toEqual({ kind: "grain", count: 4 });
    // Onto no pile: the mill beside it got nothing.
    expect([...w.mill.piles].every((n) => n === 0)).toBe(true);
    // What shows loads redraws.
    expect(w.economy.loadsVersion).toBeGreaterThan(v);
    // Nothing left to tip out.
    expect(w.economy.dumpRefusal(w.timber)).toBe("empty");
    expect(w.economy.dump(w.timber)).toBeNull();
  });

  it("is refused while the train moves, changing nothing, and works once it stands", () => {
    const w = world();
    w.sim.setLever(w.engine, 1);
    for (let i = 0; i < SIM_HZ; i++) w.sim.tick();
    expect(w.train().speed).toBeGreaterThan(0);
    expect(w.economy.dumpRefusal(w.timber)).toBe("moving");
    expect(w.economy.dump(w.timber)).toBeNull();
    expect(w.economy.cargoOf(w.timber)).toEqual({ kind: "planks", count: 6 });
    w.sim.setLever(w.engine, 0);
    for (let i = 0; i < 10 * SIM_HZ && w.train().speed > 0; i++) w.sim.tick();
    expect(w.train().speed).toBe(0);
    expect(w.economy.dump(w.timber)).toEqual({ kind: "planks", count: 6 });
  });

  it("leaves a coach's riders on: people aren't goods", () => {
    const w = world();
    expect(w.economy.dumpRefusal(w.coach)).toBe("empty");
    expect(w.economy.dump(w.coach)).toBeNull();
    expect(w.economy.ridersOf(w.coach).count).toBe(3);
    // Empty all: every wagon tipped, the coach's riders still on.
    for (const c of w.train().cars) w.economy.dump(c.id);
    expect(w.train().cars.every((c) => w.economy.cargoOf(c.id).count === 0)).toBe(true);
    expect(w.economy.ridersOf(w.coach).count).toBe(3);
  });

  it("leaves nothing held for a school set to Research first", () => {
    const w = world();
    w.economy.sinkWants = (kind) => (kind === "planks" ? 10 : 0);
    expect(w.economy.heldForSchool(w.train().id, "planks")).toBe(6);
    w.economy.dump(w.timber);
    expect(w.economy.heldForSchool(w.train().id, "planks")).toBe(0);
  });

  it("names a place that takes the goods (the mill takes grain), and none where nothing does", () => {
    const w = world();
    expect(w.economy.takerOf("grain")).toBe(w.mill);
    expect(w.economy.takerOf("furniture")).toBeNull();
  });
});

describe("Empty's toast", () => {
  const none = () => null;
  it("says what was tipped out", () => {
    expect(emptyWords([{ kind: "planks", count: 6 }], none)).toBe("Tipped out 6 \uE000");
  });
  it("adds up Empty all by goods, in the order met", () => {
    const t: Tipped[] = [];
    addTipped(t, { kind: "planks", count: 6 });
    addTipped(t, { kind: "grain", count: 4 });
    addTipped(t, { kind: "planks", count: 2 });
    expect(emptyWords(t, none)).toBe("Tipped out 8 \uE000 4 🌾");
  });
  it("names a place that takes the first good one does", () => {
    const takers = (k: string) => (k === "grain" ? { name: "Mill", town: false } : null);
    expect(emptyWords([{ kind: "planks", count: 6 }, { kind: "grain", count: 4 }], takers)).toBe("Tipped out 6 \uE000 4 🌾 · The Mill takes 🌾");
    expect(emptyWords([{ kind: "planks", count: 6 }], () => ({ name: "Ashby", town: true }))).toBe("Tipped out 6 \uE000 · Ashby takes \uE000");
  });
  it("says nothing when nothing went", () => {
    expect(emptyWords([], none)).toBe("");
  });
});
