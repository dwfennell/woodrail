import { describe, expect, it } from "vitest";
import { isWater, SURF_SEA } from "../landscape";
import { ACCELERATION } from "../sim";
import { appendPiece, connectorRef } from "../track";
import { Ferries, FERRY_AWAY, FERRY_SAIL, ferryPose, slipWhy, SLIP_LENGTH } from "./ferry";
import { siteWhy } from "./industries";
import { Progress } from "./progress";
import { PRICES } from "./towns";
import { syncIndustries, type World } from "./world";
import { coastWorld } from "./harbours-testing";

/** A pose for a ferry slip on the coast: its end at the sea, its line on land. */
function slipSite(w: World): { x: number; z: number; heading: number } {
  const g = w.landscape.grid;
  let found: { x: number; z: number; heading: number } | null = null;
  g.forEachCell((i, col, row) => {
    if (found || g.surface[i] !== SURF_SEA) return;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      // The slip's end on the shore just short of this sea square.
      const pose = { x: g.centreX(col) - c * (SLIP_LENGTH + 40), z: g.centreZ(row) - s * (SLIP_LENGTH + 40), heading };
      const start = g.cellAtWorld(pose.x, pose.z);
      const end = g.cellAtWorld(pose.x + c * (SLIP_LENGTH - 20), pose.z + s * (SLIP_LENGTH - 20));
      if (start === -1 || end === -1 || isWater(g.surface[start]) || isWater(g.surface[end])) continue;
      if (slipWhy(w.landscape, pose) === null) {
        found = pose;
        return;
      }
    }
  });
  expect(found, "a shore for a ferry slip").not.toBeNull();
  return found!;
}

function setup() {
  const w = coastWorld();
  const pose = slipSite(w);
  const piece = w.layout.addPiece("kit-ferry-slip", pose);
  // Track behind it (the train's tail stands there).
  appendPiece(w.layout, "straight-216", false, connectorRef(piece, 0));
  syncIndustries(w, true);
  const slip = w.economy.depotAtPiece(piece)!;
  expect(slip.role).toBe("slip");
  // An engine and two flatbeds standing on the slip, routed there.
  const added = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: piece, pathIndex: 0, reversed: false, s: 200 });
  expect(added.kind).toBe("placed");
  const train = w.sim.getTrain(added.kind === "placed" ? added.trainId : -1)!;
  const [engine, a, b] = train.cars.map((c) => c.id);
  w.economy.setRoute(engine, { stops: [{ depotId: slip.id, action: "auto" }], next: 0 });
  w.economy.setCargo(a, "planks", 3);
  w.economy.setCargo(b, "log", 2);
  const p = Progress.fresh();
  p.coins = 100;
  return { w, pose, slip, train, engine, a, b, p, ferries: new Ferries() };
}

describe("the train ferry", () => {
  it("slips stand on the shore with their end at the sea, and say why not inland", () => {
    const w = coastWorld();
    expect(siteWhy(w.landscape, "kit-ferry-slip", slipSite(w))).toBeNull();
    expect(siteWhy(w.landscape, "kit-ferry-slip", { x: 0, z: 0, heading: 0 })).toMatch(/open sea/);
  });

  it("takes a train routed to the slip abroad: its load sold at a town's full price, held there the while", () => {
    const { w, slip, train, engine, a, b, p, ferries } = setup();
    const [e] = ferries.tick(w, p, 1);
    expect(e).toMatchObject({ kind: "boarded", slip: slip.id, sold: 5, coins: 3 * PRICES.planks! + 2 * PRICES.log! });
    expect(p.coins).toBe(100 + 3 * PRICES.planks! + 2 * PRICES.log!);
    expect(w.economy.cargoOf(a).count + w.economy.cargoOf(b).count).toBe(0);
    for (const c of train.cars) expect(w.economy.held.has(c.id)).toBe(true);
    // Held: the sim can't move it (its speed cap is 0), lever or no lever.
    w.sim.setLever(engine, 1);
    for (let i = 0; i < 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    expect(Math.abs(train.speed)).toBeLessThan(ACCELERATION);
    expect(ferries.tripOf(engine)?.phase).toBe("out");
  });

  it("brings it back after the trip with its wagons full of goods from abroad, paid at a town's price, and lets it go", () => {
    const { w, slip, train, engine, a, b, p, ferries } = setup();
    ferries.tick(w, p, 1);
    const coins = p.coins;
    const log: string[] = [];
    let landed = null;
    for (let t = 0; t < FERRY_SAIL + FERRY_AWAY + FERRY_SAIL + 2 && !landed; t++) {
      for (const ev of ferries.tick(w, p, 1)) if (ev.kind === "landed") landed = ev;
      log.push(ferries.tripAt(slip.id)?.phase ?? "in");
    }
    expect(log).toContain("away");
    expect(landed).toMatchObject({ kind: "landed", slip: slip.id, engine });
    // Flatbeds: the dearest goods from abroad a flatbed carries (iron).
    expect([w.economy.cargoOf(a).kind, w.economy.cargoOf(b).kind]).toEqual(["iron", "iron"]);
    const brought = w.economy.cargoOf(a).count + w.economy.cargoOf(b).count;
    expect(brought).toBeGreaterThan(0);
    expect(p.coins).toBe(coins - brought * PRICES.iron!);
    for (const c of train.cars) expect(w.economy.held.has(c.id)).toBe(false);
    expect(ferries.tripAt(slip.id)).toBeNull();
  });

  it("leaves a train that isn't routed there", () => {
    const { w, engine, p, ferries } = setup();
    w.economy.setRoute(engine, null);
    expect(ferries.tick(w, p, 1)).toEqual([]);
  });

  it("sails out to sea along the slip's line and back to its end", () => {
    const { pose } = setup();
    const at = ferryPose(pose, null);
    const out = ferryPose(pose, { slip: 0, phase: "away", t: 0, cars: [] });
    expect(out.shown).toBe(false);
    const halfway = ferryPose(pose, { slip: 0, phase: "out", t: FERRY_SAIL / 2, cars: [] });
    const d = Math.hypot(halfway.x - at.x, halfway.z - at.z);
    expect(d).toBeGreaterThan(0);
    expect(Math.atan2(halfway.z - at.z, halfway.x - at.x)).toBeCloseTo(pose.heading, 5);
  });
});
