import { describe, expect, it } from "vitest";
import { canCarry, CARGO, CARGO_KINDS, CARRIES, Economy, RECIPES, type CargoKind } from "../economy";
import { CAR_KINDS, CAR_SPECS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { firstFoodNews } from "./food-text";
import { buysText } from "./town-ledger";
import { FULL_PAY, LUXURIES, payFor, PRICES, townStatus } from "./towns";
import { STICKERS, type StickerContext } from "./stickers";
import { THING_RULES } from "./things";
import type { World } from "./world";
import { INDUSTRY_ROLE, syncIndustries } from "./world";
import { BOAT_DOCKED, BOAT_EVERY, BOAT_SAIL, FISH_CATCH, HarbourTrade, type HarbourEvent } from "./harbours";
import { coastWorld, harbourSite } from "./harbours-testing";
import { Progress } from "./progress";
import { costOf, lacking, studyTime, UNIVERSITY_GOODS } from "./research";
import { seenOf } from "./tech";

/**
 * The tech tree's next nodes (spec "Next nodes", 2026-11-02) by train: a closed oval of the game's own depot pieces,
 * the industries on one side and a town's station on the other, one hand-run train going round. Nothing is written
 * into a pile: each industry makes its goods only of what the train brings it, and the town gets them.
 */
function loop(industries: PieceTypeId[], cars: CarKind[]) {
  const layout = new Layout();
  const half: PieceTypeId[] = ["curve-large", "curve-large", "curve-large", "curve-large"];
  const sequence: PieceTypeId[] = [...half, ...industries, ...half, "station", ...industries.slice(1).map((): PieceTypeId => "straight-216")];
  const ids: number[] = [];
  let last = -1;
  for (const type of sequence) {
    last = last === -1 ? layout.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, type, false, connectorRef(last, 1));
    ids.push(last);
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const depots = industries.map((type) => economy.addDepot(INDUSTRY_ROLE[type]!, ids[sequence.indexOf(type)]));
  economy.addDepot("town", ids[sequence.indexOf("station")], 0);
  const placed = sim.addTrain(cars, { pieceId: ids[ids.length - 1], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
  const run = (minutes: number) => {
    for (let i = 0; i < minutes * 60 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
    }
    expect(sim.getTrain(placed.trainId)!.derailed).toBe(false);
  };
  const got = (k: CargoKind) => economy.deliveredGoods.get(0)?.[k] ?? 0;
  return { economy, depots, run, got, closed: [...layout.joints()].length === sequence.length };
}

const bp = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;

describe("Juice works", () => {
  it("is built: a row with no plan after Orchards, mostly coins, and the juice works it brings", () => {
    expect(bp("juice").plan).toBeUndefined();
    expect(bp("juice")).toMatchObject({ needs: ["orchard"], tier: 2, research: { goods: { planks: 8 }, coins: 120 } });
    expect(THING_RULES["piece:depot-juicer"]).toMatchObject({ tech: "juice", coins: 200 });
    expect(RECIPES.juicer).toMatchObject({ takes: ["fruit"], gives: ["juice"], cycle: { uses: { fruit: 1 }, makes: { juice: 1 } } });
  });

  it("orchard → juice works → town: fruit by flatbed, juice in crates by van", () => {
    const { closed, run, economy, got } = loop(["depot-orchard", "depot-juicer"], ["engine", "timber", "van"]);
    expect(closed).toBe(true);
    run(15);
    expect(economy.made[CARGO.juice.index]).toBeGreaterThan(0);
    expect(got("juice")).toBeGreaterThan(0);
  }, 120_000);

  it("a juice works with no fruit brought makes nothing", () => {
    const { run, economy } = loop(["depot-juicer"], ["engine", "van"]);
    run(5);
    expect(economy.made[CARGO.juice.index]).toBe(0);
  }, 60_000);
});

describe("goods towns always buy at full pay", () => {
  it("every one is taken by towns, paid in full at any level, and none is wanted to grow", () => {
    for (const k of FULL_PAY) {
      expect(RECIPES.town.takes, k).toContain(k);
      expect(LUXURIES.has(k), k).toBe(true);
      expect(payFor(k, townStatus({})), k).toBe(PRICES[k]);
      expect(CARGO_KINDS, k).toContain(k);
    }
    // No study asks for them: the balance player would research toward them (`towardChains`).
    for (const b of BLUEPRINTS) for (const k of Object.keys(b.research.goods)) expect(FULL_PAY.has(k as CargoKind), `${b.id} asks ${k}`).toBe(false);
  });

  it("the News says the first of each, and the town card lists the learned ones", () => {
    expect(firstFoodNews("juice", 2, 2, "Ashby")).toBe("First juice! 🧃 Ashby buys it at full pay");
    expect(firstFoodNews("juice", 2, 5, "Ashby")).toBeNull();
    expect(buysText(new Set(["orchard", "juice"]))).toBe("Always buys 🍎 fruit and 🧃 juice at full pay");
  });
});

describe("Creamery", () => {
  it("is built: after Dairy farm, mostly coins, the creamery it brings makes cheese of milk", () => {
    expect(bp("creamery").plan).toBeUndefined();
    expect(bp("creamery")).toMatchObject({ needs: ["dairy"], tier: 2, research: { goods: { planks: 10 }, coins: 140 } });
    expect(THING_RULES["piece:depot-creamery"]).toMatchObject({ tech: "creamery", coins: 240 });
    expect(RECIPES.creamery).toMatchObject({ takes: ["milk"], gives: ["cheese"], cycle: { uses: { milk: 1 }, makes: { cheese: 1 } } });
  });

  it("dairy → creamery → town: milk by tank wagon, cheese by van", () => {
    const { closed, run, economy, got } = loop(["depot-dairy", "depot-creamery"], ["engine", "tanker", "van"]);
    expect(closed).toBe(true);
    run(15);
    expect(economy.made[CARGO.cheese.index]).toBeGreaterThan(0);
    expect(got("cheese")).toBeGreaterThan(0);
  }, 120_000);
});

describe("Cold van", () => {
  it("is built: after Creamery, a wagon of its own (4 planks) that carries cheese", () => {
    expect(bp("reefer").plan).toBeUndefined();
    expect(bp("reefer")).toMatchObject({ needs: ["creamery"], tier: 2, research: { goods: { planks: 4 }, coins: 100 } });
    expect(THING_RULES["car:reefer"]).toMatchObject({ tech: "reefer", cost: { planks: 4 } });
    expect(CAR_KINDS.filter((k) => canCarry(k, "cheese"))).toEqual(["van", "reefer"]);
    expect(canCarry("reefer", "milk")).toBe(false);
    expect(CAR_SPECS.reefer).toMatchObject({ length: 84, powered: false });
  });

  it("a cold van carries the creamery's cheese to town", () => {
    const { run, got, economy } = loop(["depot-dairy", "depot-creamery"], ["engine", "tanker", "reefer"]);
    run(15);
    expect(economy.made[CARGO.cheese.index]).toBeGreaterThan(0);
    expect(got("cheese")).toBeGreaterThan(0);
  }, 120_000);
});

describe("Ice cream factory", () => {
  it("is built: tier 3 after the Cold van and Orchards, two goods from two chains make ice cream", () => {
    expect(bp("ice-cream").plan).toBeUndefined();
    expect(bp("ice-cream")).toMatchObject({ needs: ["reefer", "orchard"], tier: 3, research: { goods: { planks: 10 }, coins: 200 } });
    expect(THING_RULES["piece:depot-icecream"]).toMatchObject({ tech: "ice-cream", coins: 360 });
    expect(RECIPES.icecream).toMatchObject({ takes: ["milk", "fruit"], gives: ["icecream"], cycle: { uses: { milk: 1, fruit: 1 }, makes: { icecream: 1 } } });
    // Ice cream rides in a cold van and nothing else.
    expect(CAR_KINDS.filter((k) => canCarry(k, "icecream"))).toEqual(["reefer"]);
  });

  it("(milk + fruit) → ice cream: the train brings both, and a cold van takes the ice cream to town", () => {
    const { closed, run, economy, got } = loop(["depot-dairy", "depot-orchard", "depot-icecream"], ["engine", "tanker", "timber", "reefer"]);
    expect(closed).toBe(true);
    run(20);
    expect(economy.made[CARGO.icecream.index]).toBeGreaterThan(0);
    expect(got("icecream")).toBeGreaterThan(0);
    // The hidden sticker for it: earned by the delivery itself (its check reads the economy's totals).
    const sticker = STICKERS.find((s) => s.id === "ice-cream-day")!;
    expect(sticker.hidden).toBe(true);
    expect(sticker.check({ economy } as unknown as World, {} as StickerContext)).toBe(true);
  }, 120_000);

  it("fruit alone isn't ice cream, and without a cold van it stays at the factory", () => {
    const fruitOnly = loop(["depot-orchard", "depot-icecream"], ["engine", "timber", "reefer"]);
    fruitOnly.run(10);
    expect(fruitOnly.economy.made[CARGO.icecream.index]).toBe(0);
    const noColdVan = loop(["depot-dairy", "depot-orchard", "depot-icecream"], ["engine", "tanker", "timber", "van"]);
    noColdVan.run(15);
    expect(noColdVan.economy.made[CARGO.icecream.index]).toBeGreaterThan(0);
    expect(noColdVan.got("icecream")).toBe(0);
  }, 120_000);
});

describe("Brickworks", () => {
  it("is built: tier 3 after Quarries and Mines, stone and coal fired into bricks", () => {
    expect(bp("brickworks").plan).toBeUndefined();
    expect(bp("brickworks")).toMatchObject({ needs: ["quarries", "mines"], tier: 3, research: { goods: { planks: 12 }, coins: 180 } });
    expect(THING_RULES["piece:depot-brickworks"]).toMatchObject({ tech: "brickworks", coins: 320 });
    expect(RECIPES.brickworks).toMatchObject({ takes: ["stone", "coal"], gives: ["bricks"], cycle: { uses: { stone: 1, coal: 1 }, makes: { bricks: 1 } } });
    expect(CAR_KINDS.filter((k) => canCarry(k, "bricks"))).toEqual(["timber"]);
    // Bricks aren't food, but towns buy them the same way, and the card says so once learned.
    expect(FULL_PAY.has("bricks")).toBe(true);
    expect(buysText(new Set(["brickworks"]))).toBe("Always buys 🧱 bricks at full pay");
  });

  it("(stone + coal) → bricks: hoppers bring both from a quarry and a mine, flatbeds take the bricks to town", () => {
    const { closed, run, economy, got } = loop(["depot-quarry", "depot-mine", "depot-brickworks"], ["engine", "hopper", "hopper", "timber"]);
    expect(closed).toBe(true);
    run(20);
    expect(economy.made[CARGO.bricks.index]).toBeGreaterThan(0);
    expect(got("bricks")).toBeGreaterThan(0);
  }, 120_000);
});

// Tech tree 3 (2026-11-03): the car carrier and the car factory (iron's chain gets an end), fishing boats (a harbour's
// catch), and the university.
describe("Car carrier", () => {
  it("is built: tier 3 after the Foundry, a wagon of its own (planks and iron) that carries cars and nothing else", () => {
    expect(bp("car-carrier").plan).toBeUndefined();
    expect(bp("car-carrier")).toMatchObject({ needs: ["foundry"], tier: 3, research: { goods: { planks: 6 }, coins: 160 } });
    expect(THING_RULES["car:carrier"]).toMatchObject({ tech: "car-carrier", cost: { planks: 3, iron: 2 } });
    expect(CARRIES.carrier).toEqual(["autos"]);
    expect(CAR_SPECS.carrier).toMatchObject({ length: 84, powered: false });
  });
});

describe("Car factory", () => {
  it("is built: tier 3 after the Car carrier, once towns have had 20 iron; iron and planks make cars", () => {
    expect(bp("car-factory").plan).toBeUndefined();
    expect(bp("car-factory")).toMatchObject({ needs: ["car-carrier"], tier: 3, research: { goods: { planks: 12 }, coins: 220 } });
    expect(bp("car-factory").requires).toContainEqual({ kind: "delivered", good: "iron", n: 20 });
    expect(THING_RULES["piece:depot-carworks"]).toMatchObject({ tech: "car-factory", coins: 420, cost: { planks: 12, iron: 4 } });
    expect(RECIPES.carworks).toMatchObject({ takes: ["iron", "planks"], gives: ["autos"], cycle: { uses: { iron: 1, planks: 1 }, makes: { autos: 1 } } });
    // Cars ride on a car carrier and nothing else; towns pay the most for them, at any level.
    expect(CAR_KINDS.filter((k) => canCarry(k, "autos"))).toEqual(["carrier"]);
    expect(FULL_PAY.has("autos")).toBe(true);
    expect(Math.max(...CARGO_KINDS.map((k) => PRICES[k] ?? 0))).toBe(PRICES.autos);
    expect(buysText(new Set(["car-factory"]))).toBe("Always buys 🚗 cars at full pay");
    expect(firstFoodNews("autos", 1, 1, "Ashby")).toBe("First cars! 🚗 Ashby buys them at full pay");
  });

  it("(iron + planks) → cars: the train brings both, and a car carrier takes the cars to town", () => {
    const { closed, run, economy, got } = loop(["depot-mine", "depot-foundry", "depot-forest", "depot-sawmill", "depot-carworks"], ["engine", "hopper", "timber", "timber", "carrier"]);
    expect(closed).toBe(true);
    run(30);
    expect(economy.made[CARGO.iron.index]).toBeGreaterThan(0);
    expect(economy.made[CARGO.autos.index]).toBeGreaterThan(0);
    expect(got("autos")).toBeGreaterThan(0);
    // The hidden sticker for it, earned by the delivery itself.
    const sticker = STICKERS.find((s) => s.id === "showroom")!;
    expect(sticker.hidden).toBe(true);
    expect(sticker.check({ economy } as unknown as World, {} as StickerContext)).toBe(true);
  }, 240_000);

  it("without a car carrier the cars stay at the factory", () => {
    const { run, economy, got } = loop(["depot-mine", "depot-foundry", "depot-forest", "depot-sawmill", "depot-carworks"], ["engine", "hopper", "timber", "timber", "van"]);
    run(20);
    expect(economy.made[CARGO.autos.index]).toBeGreaterThan(0);
    expect(got("autos")).toBe(0);
  }, 240_000);
});

describe("Fishing boats", () => {
  it("is built: tier 3 after Harbours, mostly coins; fish ride in vans or cold vans, and towns buy them at full pay", () => {
    expect(bp("fishing").plan).toBeUndefined();
    expect(bp("fishing")).toMatchObject({ needs: ["harbours"], tier: 3, research: { goods: { planks: 8 }, coins: 160 } });
    expect(CAR_KINDS.filter((k) => canCarry(k, "fish"))).toEqual(["van", "reefer"]);
    expect(FULL_PAY.has("fish")).toBe(true);
    expect(buysText(new Set(["fishing"]))).toBe("Always buys 🐟 fish at full pay");
  });

  it("each boat in lands a catch of fish on the quay, once it's learned, and the boats don't take it back", () => {
    const run = (learned: boolean) => {
      const w = coastWorld();
      const id = w.layout.addPiece("depot-harbour", harbourSite(w));
      syncIndustries(w);
      const d = w.economy.depotAtPiece(id)!;
      const p = Progress.fresh();
      if (learned) p.learned.add("fishing"); // (Setup: what the research gives; the boats are under test.)
      const trade = new HarbourTrade();
      const caught: HarbourEvent[] = [];
      // Two boats (the second must leave the first's catch on the quay), or as long as two would take.
      for (let t = 1; t <= 2 * (BOAT_EVERY + 2 * BOAT_SAIL + BOAT_DOCKED) + 60 && caught.length < 2; t++) for (const e of trade.update(w, p)) if (e.kind === "caught") caught.push(e);
      return { d, caught, landed: w.economy.landed.get(d.id)?.[CARGO.fish.index] ?? 0, describe: new HarbourTrade().describe(d.id, learned) };
    };
    const yes = run(true);
    expect(yes.caught).toHaveLength(2);
    expect(yes.d.piles[CARGO.fish.index]).toBe(2 * FISH_CATCH);
    expect(yes.landed).toBe(2 * FISH_CATCH);
    expect(yes.describe).toContain(`lands ${FISH_CATCH} fish`);
    const no = run(false);
    expect(no.caught).toHaveLength(0);
    expect(no.d.piles[CARGO.fish.index]).toBe(0);
  });

  it("a van takes a harbour's landed fish to town", () => {
    const { run, economy, depots, got } = loop(["depot-harbour"], ["engine", "van"]);
    // (Landed as a boat lands it: `Economy.land`, the boat's own call, tested above.)
    economy.land(depots[0], "fish", 6);
    run(6);
    expect(got("fish")).toBeGreaterThan(0);
    const sticker = STICKERS.find((s) => s.id === "fish-supper")!;
    expect(sticker.hidden).toBe(true);
    expect(sticker.check({ economy } as unknown as World, {} as StickerContext)).toBe(true);
  }, 120_000);
});

describe("University", () => {
  it("is built: tier 3 after the College and 20 blueprints, mostly coins", () => {
    expect(bp("university").plan).toBeUndefined();
    expect(bp("university")).toMatchObject({ needs: ["college"], tier: 3, research: { goods: { planks: 14 }, coins: 300 } });
    expect(bp("university").requires).toContainEqual({ kind: "count", stat: "blueprints", n: 20 });
  });

  it("a hard (tier-3) lesson needs a third fewer goods once it's learned, coins and study the same; the board shows every blueprint", () => {
    const p = Progress.fresh();
    const before = { factory: costOf("car-factory", p.learned), mills: costOf("mills", p.learned), study: studyTime("car-factory", p.learned) };
    expect([...seenOf(p).values()].some((s) => s !== "shown")).toBe(true);
    p.learned.add("university");
    expect(costOf("car-factory", p.learned)).toEqual({ goods: { planks: Math.ceil(12 * UNIVERSITY_GOODS) }, coins: before.factory.coins });
    expect(costOf("car-factory", p.learned).goods.planks).toBe(8);
    // Foundry's 10 stone and 10 coal: 7 of each.
    expect(costOf("foundry", p.learned).goods).toEqual({ stone: 7, coal: 7 });
    expect(costOf("mills", p.learned)).toEqual(before.mills);
    expect(studyTime("car-factory", p.learned)).toBe(before.study);
    // The research under way asks the schools for the fewer goods.
    p.research.current = "car-factory";
    expect(lacking(p, "planks")).toBe(8);
    expect([...seenOf(p).values()].every((s) => s === "shown")).toBe(true);
  });
});
