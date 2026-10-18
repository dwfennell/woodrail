import { describe, expect, it } from "vitest";
import { syncIndustries, type World } from "../game/world";
import { ACCELERATION, Sim, SIM_DT, SIM_HZ, ENGINE_SPEED, type CarKind, type Train } from "../sim";
import { connectorRef, createWorldConnector, KITS, Layout, type PieceTypeId } from "../track";
import { RECIPES, WAGON_CAPACITY, CARGO, Economy } from ".";

/**
 * A straight line along +x: a turnback buffer, a straight (the train starts on it), `types` end to end, a straight and
 * a turnback buffer; kit pieces that are cargo stops given their depots (as the game does: `syncIndustries`).
 */
function line(types: PieceTypeId[], cars: CarKind[]) {
  const layout = new Layout();
  const c = createWorldConnector();
  layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
  let at = { x: 0, z: 0, heading: 0 };
  const ids: number[] = [];
  for (const type of ["straight-216", ...types, "straight-216"] as PieceTypeId[]) {
    const id = layout.addPiece(type, at);
    ids.push(id);
    layout.worldConnector(connectorRef(id, 1), c);
    at = { x: c.x, z: c.z, heading: c.heading };
  }
  layout.addPiece("buffer-turnback", at);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  expect(syncIndustries({ layout, economy } as unknown as World)).toBe(types.some((t) => KITS[t as keyof typeof KITS]?.depot));
  const placed = sim.addTrain(cars, { pieceId: ids[0], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])! as Train;
  sim.setLever(train().cars.find((x) => x.kind === "engine")!.id, 1);
  const step = () => {
    sim.tick();
    economy.tick();
  };
  return { layout, sim, economy, train, ids: ids.slice(1, -1), step };
}

describe("Sandbox's cargo machines (kit pieces as depots)", () => {
  it("each cargo kit is registered as a depot of its role, which the economy knows", () => {
    for (const [type, role] of [
      ["kit-log-loader", "loader-log"],
      ["kit-grain-elevator", "loader-grain"],
      ["kit-cargo-conveyor", "loader-grain"],
      ["kit-coal-chute", "loader-coal"],
      ["kit-gantry-crane", "loader-planks"],
      ["kit-harbour-crane", "loader-planks"],
      ["kit-magnet-crane", "loader-planks"],
      ["kit-tipping-dump", "unloader"],
      ["kit-drop-hopper", "unloader"],
      ["kit-goods-shed", "unloader"],
    ] as const) {
      expect(KITS[type].depot, type).toBe(role);
      expect(KITS[type].moves, type).toBe("stopped");
      const w = line([type], ["engine"]);
      expect(w.economy.depotAtPiece(w.ids[0])?.role, type).toBe(role);
    }
    // The loaders' heaps are full from the start; an unloader's piles empty.
    expect(RECIPES["loader-log"]).toMatchObject({ gives: ["log"], endless: true });
    expect(RECIPES.unloader.sink).toBe(true);
  });

  it("an empty wagon fills at a loader (its heap never runs down), and empties at an unloader (the goods vanish)", () => {
    const w = line(["kit-log-loader", "straight-216", "kit-tipping-dump"], ["engine", "timber", "timber"]);
    const loader = w.economy.depotAtPiece(w.ids[0])!;
    const dump = w.economy.depotAtPiece(w.ids[2])!;
    const heap = loader.piles[CARGO.log.index];
    expect(heap).toBeGreaterThan(0);
    const wagons = () => w.train().cars.filter((c) => c.kind === "timber").map((c) => w.economy.cargoOf(c.id));
    let full = false;
    let standing = false;
    for (let i = 0; i < 40 * SIM_HZ; i++) {
      w.step();
      if (w.economy.standingAt(w.ids[0])) standing = true;
      if (!full && wagons().every((c) => c.kind === "log" && c.count === WAGON_CAPACITY)) full = true;
      if (full && wagons().every((c) => c.count === 0)) break;
    }
    expect(full).toBe(true);
    // The loader's crane worked with the train standing there (the kit's moving parts' trigger).
    expect(standing).toBe(true);
    expect(loader.piles[CARGO.log.index]).toBe(heap);
    // Emptied at the tipper, and nothing piled up there.
    expect(wagons().every((c) => c.count === 0 && c.kind === null)).toBe(true);
    expect(dump.piles.every((n) => n === 0)).toBe(true);
  });

  it("a train with nothing for a loader runs through (a hopper at the log loader)", () => {
    const w = line(["straight-216", "straight-216", "kit-log-loader"], ["engine", "hopper"]);
    let slowest = Infinity;
    for (let i = 0; i < 6 * SIM_HZ; i++) {
      w.step();
      if (w.train().bogies.some((b) => b.pieceId === w.ids[2])) slowest = Math.min(slowest, w.train().speed);
    }
    expect(slowest).toBe(ENGINE_SPEED);
  });

  it.each([
    ["kit-weighbridge", 30],
    ["kit-train-wash", 40],
  ] as const)("%s: a train crawls through (%i mm/s) while any axle is on it, then speeds up again", (kit, speed) => {
    const w = line(["straight-216", kit, "straight-216"], ["engine", "hopper"]);
    const crawl = KITS[kit].crawl!;
    expect(crawl).toBe(speed);
    let fastestOn = 0;
    let sawOn = false;
    let after = 0;
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      w.step();
      const t = w.train();
      const on = t.bogies.some((b) => b.pieceId === w.ids[1]);
      if (on) {
        sawOn = true;
        // (Once its leading axle is on, easing down to the crawl takes a moment.)
        if (t.bogies.every((b) => b.pieceId === w.ids[1] || b.pieceId === w.ids[2])) fastestOn = Math.max(fastestOn, t.speed);
      } else if (sawOn && t.bogies[0].pieceId === w.ids[2]) after = Math.max(after, t.speed);
      if (sawOn && after === ENGINE_SPEED) break;
    }
    expect(sawOn).toBe(true);
    expect(fastestOn).toBeLessThanOrEqual(crawl);
    expect(after).toBe(ENGINE_SPEED);
  });

  it.each(["kit-weighbridge", "kit-train-wash", "kit-loop-the-loop"] as const)("%s: the crawl is eased in and out (braking at the sim's rate), with no step in speed", (kit) => {
    const w = line(["straight-216", "straight-216", kit, "straight-216"], ["engine", "hopper", "hopper"]);
    const crawl = KITS[kit].crawl!;
    const kitId = w.ids[2];
    const step = ACCELERATION * SIM_DT;
    // The speed each tick, and where the leading axle was (how far short of the kit, mm; 0 once on it).
    const profile: { v: number; short: number; on: boolean; past: boolean }[] = [];
    let entered = false;
    let left = false;
    for (let i = 0; i < 30 * SIM_HZ; i++) {
      w.step();
      const t = w.train();
      const lead = t.bogies[0];
      const on = t.bogies.some((b) => b.pieceId === kitId);
      if (lead.pieceId === kitId) entered = true;
      if (entered && !on) left = true;
      const short = lead.pieceId === w.ids[1] ? 216 - lead.s : lead.pieceId === w.ids[0] ? 432 - lead.s : 0;
      profile.push({ v: t.speed, short, on, past: left });
      if (left && t.speed === ENGINE_SPEED) break;
    }
    expect(entered && left).toBe(true);
    // No step: from one tick to the next the speed changes by no more than the sim's easing (up or down).
    let biggest = 0;
    for (let i = 1; i < profile.length; i++) biggest = Math.max(biggest, Math.abs(profile[i].v - profile[i - 1].v));
    expect(biggest).toBeLessThanOrEqual(step + 1e-9);
    // At full speed coming up; slowing before its leading axle is on (over about its braking distance to the crawl),
    // and at the crawl as it gets there; the crawl while on it; full speed again after.
    const brake = (ENGINE_SPEED ** 2 - crawl ** 2) / (2 * ACCELERATION);
    const full = profile.findIndex((p) => p.v === ENGINE_SPEED);
    expect(full).toBeGreaterThan(0);
    const firstSlow = profile.findIndex((p, i) => i > full && p.v < ENGINE_SPEED);
    expect(firstSlow).toBeGreaterThan(full);
    expect(profile[firstSlow].short).toBeGreaterThan(brake - 3);
    expect(profile[firstSlow].short).toBeLessThan(brake + 3);
    const onAt = profile.findIndex((p) => p.on);
    expect(profile[onAt].v).toBeLessThanOrEqual(crawl + step);
    for (const p of profile) if (p.on) expect(p.v).toBeLessThanOrEqual(crawl + step);
    // Eased out: it picks up from the crawl over the sim's half second, not at once.
    const out = profile.findIndex((p) => p.past);
    expect(profile[out].v).toBeLessThanOrEqual(crawl + step);
    expect(profile.at(-1)!.v).toBe(ENGINE_SPEED);
    expect(profile.length - out).toBeGreaterThan(((ENGINE_SPEED - crawl) / ACCELERATION) * SIM_HZ - 2);
  });
});
