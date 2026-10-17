import { describe, expect, it } from "vitest";
import { ENGINE_SPEED, Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { connectorRef, createWorldConnector, KITS, Layout, type PieceTypeId } from "../track";
import { ticks } from "./constants";
import { Economy } from "./economy";
import { engineStatus } from "../game/engine-status";

const KIT = "kit-platform-furnished" as const;
const STOP = KITS[KIT].stop!;

/**
 * An oval: the platform kit and three straights along +x, a half circle of curves, four straights back, and a half
 * circle home. A train of `cars` stands on the first straight after the half circle home, heading round toward the
 * kit, and set going.
 */
function oval(cars: CarKind[]) {
  const layout = new Layout();
  const types: PieceTypeId[] = ["straight-216", KIT, "straight-216", "straight-216", ...Array<PieceTypeId>(4).fill("curve-large"), ...Array<PieceTypeId>(4).fill("straight-216"), ...Array<PieceTypeId>(4).fill("curve-large")];
  const c = createWorldConnector();
  let at = { x: 0, z: 0, heading: 0 };
  const ids: number[] = [];
  for (const type of types) {
    const id = layout.addPiece(type, at);
    ids.push(id);
    layout.worldConnector(connectorRef(id, 1), c);
    at = { x: c.x, z: c.z, heading: c.heading };
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  // The front on the straight before the kit, its tail behind it on the curves: coming up to the platform.
  const placed = sim.addTrain(cars, { pieceId: ids[0], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
  sim.setLever(train().cars.find((x) => x.kind === "engine")!.id, 1);
  const kit = ids[1];
  const step = () => {
    sim.tick();
    economy.tick();
  };
  return { layout, sim, economy, train, kit, step };
}

/** Run for `seconds`, noting each stop the train made on the kit: where its front stood, and for how many ticks. */
function run(w: ReturnType<typeof oval>, seconds: number) {
  const stops: { s: number; ticks: number; at: number }[] = [];
  let maxOnKit = 0;
  let still = 0;
  let prev = -1;
  let biggestDrop = 0;
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    w.step();
    const t = w.train();
    const front = t.bogies[0];
    if (t.bogies.some((b) => b.pieceId === w.kit)) maxOnKit = Math.max(maxOnKit, t.speed);
    if (prev >= 0) biggestDrop = Math.max(biggestDrop, prev - t.speed);
    prev = t.speed;
    if (t.speed === 0 && front.pieceId === w.kit) {
      if (still === 0) stops.push({ s: front.s, ticks: 0, at: i });
      still++;
      stops[stops.length - 1].ticks = still;
    } else still = 0;
  }
  return { stops, maxOnKit, biggestDrop };
}

describe("kit stops (the furnished platform)", () => {
  it("a passenger train eases in, halts with its front at the stop point for the dwell, then goes on", () => {
    const w = oval(["engine", "passenger", "passenger"]);
    const r = run(w, 14);
    expect(r.stops.length).toBe(1);
    // Its front at the stop point, along the kit from the end it came in by.
    expect(Math.abs(r.stops[0].s - STOP.at)).toBeLessThan(1);
    // The dwell, in sim ticks (within the tick it set off again).
    expect(Math.abs(r.stops[0].ticks - ticks(STOP.seconds))).toBeLessThanOrEqual(2);
    // Eased in: no faster than the sim's own easing (2 mm/s a tick), but for the last creep to a stand.
    expect(r.biggestDrop).toBeLessThan(7);
    // And on its way again.
    expect(w.train().speed).toBeGreaterThan(0);
    expect(w.economy.kitStops.dwelling(w.train().id)).toBe(false);
  });

  it("stops once a lap: not again on the same visit, again the next time round", () => {
    const w = oval(["engine", "passenger"]);
    // The oval is about 2.6 m round: at 120 mm/s, 22 s a lap (and 4 s at the platform).
    const r = run(w, 40);
    expect(r.stops.length).toBe(2);
    for (const s of r.stops) expect(Math.abs(s.s - STOP.at)).toBeLessThan(1);
    // A lap apart: none again as it set off.
    expect((r.stops[1].at - r.stops[0].at) / SIM_HZ).toBeGreaterThan(20);
  });

  it("a goods train runs through at full speed", () => {
    const w = oval(["engine", "hopper", "hopper"]);
    const r = run(w, 14);
    expect(r.stops).toEqual([]);
    expect(r.maxOnKit).toBe(ENGINE_SPEED);
  });

  it("the dwell waits while the lever is off, and reversing the lever sends the train on", () => {
    const w = oval(["engine", "passenger"]);
    const engine = () => w.train().cars.find((c) => c.kind === "engine")!;
    let i = 0;
    while (!w.economy.kitStops.dwelling(w.train().id) && i++ < 20 * SIM_HZ) w.step();
    expect(w.economy.kitStops.dwelling(w.train().id)).toBe(true);
    expect(engineStatus(w.sim, w.economy, engine().id, () => "")).toBe("Calling at the platform");
    // Lever off: it stands, and its dwell doesn't count down.
    w.sim.setLever(engine().id, 0);
    for (let k = 0; k < ticks(STOP.seconds) + 10; k++) w.step();
    expect(w.economy.kitStops.dwelling(w.train().id)).toBe(true);
    // Reversed: it backs away, not held.
    w.sim.setLever(engine().id, engine().facing === 1 ? -1 : 1);
    for (let k = 0; k < SIM_HZ; k++) w.step();
    expect(w.train().speed).toBeGreaterThan(0);
  });
});
