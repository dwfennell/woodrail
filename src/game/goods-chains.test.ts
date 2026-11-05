import { describe, expect, it } from "vitest";
import { canCarry, CARGO, CARGO_KINDS, Economy, RECIPES, type CargoKind } from "../economy";
import { CAR_KINDS, Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { firstFoodNews } from "./food-text";
import { BOAT_DOCKED, BOAT_EVERY, BOAT_SAIL, COCOA_LANDED, FISH_CATCH, HarbourTrade, type HarbourEvent } from "./harbours";
import { coastWorld, harbourSite } from "./harbours-testing";
import { Progress } from "./progress";
import { canResearch } from "./research";
import { STICKERS, type StickerContext } from "./stickers";
import { THING_RULES } from "./things";
import { buysText } from "./town-ledger";
import { FOODS, FULL_PAY, payFor, PRICES, townStatus } from "./towns";
import { INDUSTRY_ROLE, syncIndustries, type World } from "./world";

/**
 * The goods chains (2026-11-04), each ending (A + B) → C as the bakery does: sugar beet + an orchard's fruit → jam;
 * cocoa landed at a harbour + a dairy's milk → chocolate; a flower field → dye works → paint, and paint + planks → toys.
 * By train, as next-nodes.test.ts: a closed oval of the game's own depot pieces, the industries on one side and a town's
 * station on the other, one hand-run train going round. Nothing is written into a pile except cocoa, which a boat lands
 * (`Economy.land`, the boat's own call: tested on its own below).
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
const sticker = (id: string) => STICKERS.find((s) => s.id === id)!;
const earned = (id: string, economy: Economy) => sticker(id).check({ economy } as unknown as World, {} as StickerContext);

describe("the goods chains' goods", () => {
  it("are new cargo kinds at the end of the list (old saves' piles keep their places)", () => {
    expect(CARGO_KINDS.slice(21, 28)).toEqual(["sugar", "jam", "cocoa", "chocolate", "flowers", "paint", "toys"]);
    // (The post's mail and post come after a gap, at 30-31: cargo.test.ts.)
    for (const [i, k] of CARGO_KINDS.slice(0, 28).entries()) expect(CARGO[k].index).toBe(i);
  });

  it("towns buy them all at full pay but cocoa (only a chocolate factory takes it), and none is needed to grow", () => {
    for (const k of ["sugar", "jam", "chocolate", "flowers", "paint", "toys"] as const) {
      expect(FULL_PAY.has(k), k).toBe(true);
      expect(RECIPES.town.takes, k).toContain(k);
      expect(payFor(k, townStatus({})), k).toBe(PRICES[k]);
    }
    expect(["sugar", "jam", "chocolate"].every((k) => FOODS.has(k as CargoKind))).toBe(true);
    expect(RECIPES.town.takes).not.toContain("cocoa");
    // Toys pay the most of any made good but cars (the car factory's, at a University too).
    expect(Math.max(...Object.values(PRICES).map((n) => n ?? 0))).toBe(PRICES.autos);
    expect(PRICES.toys).toBeGreaterThan(Math.max(PRICES.furniture ?? 0, PRICES.tools ?? 0, PRICES.icecream ?? 0));
  });

  it("ride in the wagons that suit them: flowers on flatbeds, sacks and crates in vans, chocolate cold too", () => {
    expect(CAR_KINDS.filter((k) => canCarry(k, "flowers"))).toEqual(["timber"]);
    for (const k of ["sugar", "jam", "cocoa", "paint", "toys"] as const) expect(CAR_KINDS.filter((c) => canCarry(c, k)), k).toEqual(["van"]);
    expect(CAR_KINDS.filter((k) => canCarry(k, "chocolate"))).toEqual(["van", "reefer"]);
  });

  it("the News says the first of each, and the town card lists the learned ones", () => {
    expect(firstFoodNews("jam", 1, 1, "Ashby")).toBe("First jam! 🫙 Ashby buys it at full pay");
    expect(firstFoodNews("toys", 2, 2, "Ashby")).toBe("First toys! 🧸 Ashby buys them at full pay");
    expect(buysText(new Set(["sugar", "jam"]))).toBe("Always buys 🍬 sugar and 🫙 jam at full pay");
    expect(buysText(new Set(["paint"]))).toBe("Always buys 🌷 flowers and 🎨 paint at full pay");
  });
});

describe("the goods chains' blueprints", () => {
  it("are built rows, after the first City, mostly coins; the late ones at a College or a University", () => {
    for (const id of ["sugar", "jam", "chocolate", "paint", "toys"]) expect(bp(id).plan, id).toBeUndefined();
    expect(bp("sugar")).toMatchObject({ branch: "food", tier: 2, needs: ["farming"] });
    expect(bp("sugar").requires).toContainEqual({ kind: "level", level: 3 });
    expect(bp("jam")).toMatchObject({ branch: "food", tier: 2, needs: ["juice", "sugar"] });
    expect(bp("chocolate")).toMatchObject({ branch: "food", tier: 3, school: "college", needs: ["harbours", "dairy"] });
    expect(bp("paint")).toMatchObject({ branch: "craft", tier: 2, needs: ["farming"] });
    expect(bp("paint").requires).toContainEqual({ kind: "level", level: 3 });
    expect(bp("toys")).toMatchObject({ branch: "craft", tier: 3, school: "university", needs: ["carpentry", "paint"] });
    expect(bp("toys").requires).toContainEqual({ kind: "delivered", good: "furniture", n: 20 });
    for (const id of ["sugar", "jam", "chocolate", "paint", "toys"]) {
      const coins = bp(id).price.coins ?? 0;
      expect(coins, id).toBeGreaterThan(5 * (bp(id).price.planks ?? 0));
    }
  });

  it("bring their buildings, priced mostly in coins", () => {
    expect(THING_RULES["piece:depot-beet"]).toMatchObject({ tech: "sugar" });
    expect(THING_RULES["piece:depot-jam"]).toMatchObject({ tech: "jam" });
    expect(THING_RULES["piece:depot-chocolate"]).toMatchObject({ tech: "chocolate" });
    expect(THING_RULES["piece:depot-flowers"]).toMatchObject({ tech: "paint" });
    expect(THING_RULES["piece:depot-dyeworks"]).toMatchObject({ tech: "paint" });
    expect(THING_RULES["piece:depot-toyworks"]).toMatchObject({ tech: "toys" });
  });

  it("can't be learned before what they need", () => {
    const p = Progress.fresh();
    p.learned.add("farming");
    expect(canResearch(p, "jam")).toBe(false);
    p.learned.add("orchard").add("juice").add("sugar");
    // (Requires a city as well: none on a fresh map.)
    expect(canResearch(p, "jam")).toBe(true);
  });
});

describe("Jam kitchen: (fruit + sugar) → jam", () => {
  it("its recipe takes two goods from two chains", () => {
    expect(RECIPES.beetfield).toMatchObject({ takes: [], gives: ["sugar"] });
    expect(RECIPES.jamworks).toMatchObject({ takes: ["fruit", "sugar"], gives: ["jam"], cycle: { uses: { fruit: 1, sugar: 1 }, makes: { jam: 1 } } });
  });

  it("orchard and sugar beet field → jam kitchen → town: fruit by flatbed, sugar and jam by van", () => {
    const { closed, run, economy, got } = loop(["depot-orchard", "depot-beet", "depot-jam"], ["engine", "timber", "van"]);
    expect(closed).toBe(true);
    expect(earned("jam-today", economy)).toBe(false);
    run(20);
    expect(economy.made[CARGO.jam.index]).toBeGreaterThan(0);
    expect(got("jam")).toBeGreaterThan(0);
    expect(earned("jam-today", economy)).toBe(true);
  }, 180_000);

  it("fruit alone makes no jam", () => {
    const { run, economy } = loop(["depot-orchard", "depot-jam"], ["engine", "timber", "van"]);
    run(8);
    expect(economy.made[CARGO.jam.index]).toBe(0);
  }, 120_000);
});

describe("Chocolate factory: (cocoa + milk) → chocolate", () => {
  it("each boat lands sacks of cocoa on the quay once Chocolate factory is learned, and the boats don't take them back", () => {
    const run = (learned: boolean) => {
      const w = coastWorld();
      const id = w.layout.addPiece("depot-harbour", harbourSite(w));
      syncIndustries(w);
      const d = w.economy.depotAtPiece(id)!;
      const p = Progress.fresh();
      if (learned) p.learned.add("chocolate"); // (Setup: what the research gives; the boats are under test.)
      const trade = new HarbourTrade();
      const landed: HarbourEvent[] = [];
      for (let t = 1; t <= 2 * (BOAT_EVERY + 2 * BOAT_SAIL + BOAT_DOCKED) + 60 && landed.length < 2; t++) for (const e of trade.update(w, p)) if (e.kind === "caught") landed.push(e);
      return { d, landed, kept: w.economy.landed.get(d.id)?.[CARGO.cocoa.index] ?? 0, describe: new HarbourTrade().describe(d.id, false, learned) };
    };
    const yes = run(true);
    expect(yes.landed).toHaveLength(2);
    expect(yes.landed.every((e) => e.kind === "caught" && e.good === "cocoa")).toBe(true);
    expect(yes.d.piles[CARGO.cocoa.index]).toBe(2 * COCOA_LANDED);
    expect(yes.kept).toBe(2 * COCOA_LANDED);
    expect(yes.describe).toContain(`lands ${COCOA_LANDED} sacks of cocoa`);
    expect(new HarbourTrade().describe(0, true, true)).toContain(`lands ${FISH_CATCH} fish and ${COCOA_LANDED} sacks of cocoa`);
    const no = run(false);
    expect(no.landed).toHaveLength(0);
    expect(no.d.piles[CARGO.cocoa.index]).toBe(0);
  });

  it("a harbour's cocoa and a dairy's milk → chocolate factory → town, by van and tank wagon", () => {
    expect(RECIPES.chocworks).toMatchObject({ takes: ["cocoa", "milk"], gives: ["chocolate"], cycle: { uses: { cocoa: 1, milk: 1 }, makes: { chocolate: 1 } } });
    const { run, economy, depots, got } = loop(["depot-harbour", "depot-dairy", "depot-chocolate"], ["engine", "van", "tanker"]);
    // (Landed as a boat lands it: `Economy.land`, the boat's own call, tested above.)
    economy.land(depots[0], "cocoa", 12);
    expect(earned("sweet-tooth", economy)).toBe(false);
    run(20);
    expect(economy.made[CARGO.chocolate.index]).toBeGreaterThan(0);
    expect(got("chocolate")).toBeGreaterThan(0);
    expect(sticker("sweet-tooth").hidden).toBe(true);
    expect(earned("sweet-tooth", economy)).toBe(true);
  }, 180_000);
});

describe("Dye works and Toy workshop: flowers → paint; (planks + paint) → toys", () => {
  it("a flower field grows flowers, a dye works boils them into paint, a toy workshop makes toys of planks and paint", () => {
    expect(RECIPES.flowerfield).toMatchObject({ takes: [], gives: ["flowers"] });
    expect(RECIPES.dyeworks).toMatchObject({ takes: ["flowers"], gives: ["paint"], cycle: { uses: { flowers: 1 }, makes: { paint: 1 } } });
    expect(RECIPES.toyworks).toMatchObject({ takes: ["planks", "paint"], gives: ["toys"], cycle: { uses: { planks: 1, paint: 1 }, makes: { toys: 1 } } });
  });

  it("flower field → dye works → town: flowers on a flatbed, paint by van", () => {
    const { closed, run, economy, got } = loop(["depot-flowers", "depot-dyeworks"], ["engine", "timber", "van"]);
    expect(closed).toBe(true);
    run(15);
    expect(economy.made[CARGO.paint.index]).toBeGreaterThan(0);
    expect(got("paint")).toBeGreaterThan(0);
  }, 120_000);

  it("forest → sawmill, flower field → dye works → toy workshop → town: toys by van", () => {
    const { closed, run, economy, got } = loop(["depot-forest", "depot-sawmill", "depot-flowers", "depot-dyeworks", "depot-toyworks"], ["engine", "timber", "timber", "van", "van"]);
    expect(closed).toBe(true);
    expect(earned("toy-box", economy)).toBe(false);
    run(30);
    expect(economy.made[CARGO.toys.index]).toBeGreaterThan(0);
    expect(got("toys")).toBeGreaterThan(0);
    expect(earned("toy-box", economy)).toBe(true);
  }, 240_000);

  it("paint alone makes no toys", () => {
    const { run, economy } = loop(["depot-flowers", "depot-dyeworks", "depot-toyworks"], ["engine", "timber", "van"]);
    run(10);
    expect(economy.made[CARGO.toys.index]).toBe(0);
  }, 120_000);
});
