import { describe, expect, it } from "vitest";
import { Economy, type DepotState } from "../economy/economy";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { LANDMARKS } from "./landmarks";
import {
  KNOWHOW_PRICES,
  KNOWHOW_PER_LOAD,
  knowHowFor,
  knowHowForRiders,
  knowHowFromOldSave,
  knowHowPrice,
  LANDMARK_MULTIPLIER,
  townMultiplier,
} from "./knowhow";
import { techOf } from "./tech";

const board = BLUEPRINTS.filter((b) => b.learn === "board");
const tiered = (tier: number) => board.filter((b) => b.tier === tier).map(knowHowPrice);

describe("know-how prices (option B, not in the game)", () => {
  it("gives every blueprint a price: board ones some know-how, ones learned by themselves none", () => {
    for (const b of BLUEPRINTS) {
      const p = KNOWHOW_PRICES.get(b.id);
      expect(p, b.id).toBeDefined();
      if (b.learn === "auto" || b.id === "launch") expect(p!.knowhow, b.id).toBe(0);
      else expect(p!.knowhow, b.id).toBeGreaterThan(0);
      // Coins and other goods as today; planks gone.
      expect(p!.coins, b.id).toBe(b.price.coins);
      expect(p!.goods, b.id).toEqual(b.price.goods);
      expect("planks" in p!, b.id).toBe(false);
    }
  });

  it("rises with tier: every tier costs more than every blueprint of the tier below", () => {
    for (const t of [1, 2]) expect(Math.max(...tiered(t)), `tier ${t}`).toBeLessThan(Math.min(...tiered(t + 1)));
    expect(tiered(1).length).toBeGreaterThan(0);
  });

  it("keeps today's order within a tier (more planks today, more know-how)", () => {
    for (const a of board)
      for (const b of board)
        if (a.tier === b.tier && (a.price.planks ?? 0) < (b.price.planks ?? 0)) expect(knowHowPrice(a), `${a.id} < ${b.id}`).toBeLessThanOrEqual(knowHowPrice(b));
  });

  it("prices Switches at about 15", () => {
    expect(knowHowPrice(techOf("switches")!)).toBe(15);
  });

  it("charges coins only from tier 2 on, as today", () => {
    for (const b of board.filter((x) => x.tier === 1)) expect(KNOWHOW_PRICES.get(b.id)!.coins, b.id).toBeUndefined();
  });

  it("converts an old save's workshop planks at the rate the prices were set by", () => {
    expect(knowHowFromOldSave(6)).toBe(15);
    expect(knowHowFromOldSave(0)).toBe(0);
    expect(knowHowFromOldSave(-3)).toBe(0);
    expect(knowHowFromOldSave(7)).toBe(17);
  });
});

describe("know-how earned", () => {
  it("is 1 a load where it's used, half into an industry, none into a warehouse", () => {
    expect(knowHowFor("town", "planks")).toBe(KNOWHOW_PER_LOAD);
    expect(knowHowFor("workshop", "planks", 4)).toBe(4);
    expect(knowHowFor("sawmill", "log", 2)).toBe(1);
    expect(knowHowFor("warehouse", "flour", 5)).toBe(0);
    expect(knowHowForRiders(4)).toBe(2);
  });

  it("has a multiplier for landmarks that exist", () => {
    const ids = new Set(LANDMARKS.map((l) => l.id));
    for (const id of Object.keys(LANDMARK_MULTIPLIER)) expect(ids.has(id), id).toBe(true);
  });

  it("is multiplied by the town's best landmark, not all of them", () => {
    expect(knowHowFor("town", "planks", 2, ["school"])).toBe(3);
    expect(knowHowFor("town", "flour", 2, ["school", "market", "college"])).toBe(4);
    expect(townMultiplier(["school", "library", "college"])).toBe(2);
    expect(townMultiplier(["market"])).toBe(1);
    expect(knowHowForRiders(2, ["library"])).toBe(1.75);
    // Only a town's deliveries: an industry or the workshop isn't a town's.
    expect(knowHowFor("sawmill", "log", 2, ["college"])).toBe(1);
    expect(knowHowFor("workshop", "planks", 1, ["college"])).toBe(1);
  });
});

/** The timber oval of `economy/scenario.test.ts`: forest yard, sawmill, a town station; one engine and three wagons. */
function oval() {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, "depot-forest", "straight-216", "depot-sawmill", ...half, "station", "straight-216", "straight-216"];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const at = (type: PieceTypeId) => ids[sequence.indexOf(type)];
  economy.addDepot("forest", at("depot-forest"));
  economy.addDepot("sawmill", at("depot-sawmill"));
  economy.addDepot("town", at("station"), 0);
  const placed = sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  return { sim, economy };
}

/** Know-how a minute on the oval over `minutes`, from its first delivery, with these landmarks in the town. */
function ratePerMinute(minutes: number, landmarks: string[]): number {
  const { sim, economy } = oval();
  let earned = 0;
  let first = -1;
  let tick = 0;
  // Count each unload as the game would (a test-only hook on the crane's unload).
  const e = economy as unknown as { unloadOne(d: DepotState, carId: number): void };
  const unload = e.unloadOne.bind(economy);
  e.unloadOne = (d, carId) => {
    const kind = economy.cargoOf(carId).kind!;
    unload(d, carId);
    earned += knowHowFor(d.role, kind, 1, d.role === "town" ? landmarks : []);
    if (first < 0) first = tick;
  };
  for (; tick < minutes * 60 * SIM_HZ; tick++) {
    sim.tick();
    economy.tick();
  }
  return earned / ((tick - first) / SIM_HZ / 60);
}

describe("know-how over time (one timber train on the scenario oval)", () => {
  // The grand tour's path: Switches; then Train routes; then Farming, Mills and (from a city's library) Quarries.
  const path = [["switches"], ["routes"], ["farming", "mills", "quarries"]];
  const cumulative = path.map((_, i) => path.slice(0, i + 1).flat().reduce((s, id) => s + knowHowPrice(techOf(id)!), 0));

  it("reaches tier 1 in a few minutes, tier 2 in a quarter of an hour, tier 3 in about an hour", () => {
    const plain = ratePerMinute(10, []);
    const school = ratePerMinute(10, ["school"]);
    const mins = (rate: number) => cumulative.map((k) => k / rate);
    const rows = cumulative.map((k, i) => `tier ${i + 1}: ${k} know-how, ${mins(plain)[i].toFixed(1)} min, ${mins(school)[i].toFixed(1)} min with a school`);
    console.log(`know-how a minute: ${plain.toFixed(2)}, ${school.toFixed(2)} with a school\n${rows.join("\n")}`);
    expect(cumulative).toEqual([15, 65, 310]);
    expect(plain).toBeGreaterThan(3);
    expect(plain).toBeLessThan(6);
    expect(school).toBeGreaterThan(plain);
    const [t1, t2, t3] = mins(plain);
    expect(t1).toBeGreaterThan(2);
    expect(t1).toBeLessThan(6);
    expect(t2).toBeGreaterThan(10);
    expect(t2).toBeLessThan(25);
    expect(t3).toBeGreaterThan(45);
    expect(t3).toBeLessThan(100);
  }, 120_000);
});
