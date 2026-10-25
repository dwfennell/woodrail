import { describe, expect, it } from "vitest";
import { CARGO, CARGO_KINDS } from "../economy/cargo";
import { Economy, RECIPES } from "../economy/economy";
import { kindsOf } from "../economy/goods";
import { Sim, SIM_HZ } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { craftNow, owedText, shopNeeds, shopOwes } from "./crafting";
import { restorePrice, SITE_NAMES } from "./map-sites";
import { Progress } from "./progress";
import { THING_RULES, type ThingId } from "./things";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { deliverByTrain, inYards, owesAsTheGameDoes } from "./workshop-testing";

/**
 * QA: in Game mode a harbour could never be built or restored. Its price has stone at the workshop (10 new, 5 to
 * restore), but the workshop took only planks and iron from trains. Now it takes stone while a price it can be asked
 * for still needs some there, and only as much as is still owed (`shopOwes`).
 */

const HARBOUR = "piece:depot-harbour" as ThingId;

/** The starter map, a workshop out of the way, and a Game player (who knows Harbours if `harbours`). */
function setup(harbours: boolean): { w: World; p: Progress; shop: number } {
  const w = buildStarterWorld();
  const p = Progress.fresh();
  p.coins = 1000;
  if (harbours) p.learned.add("harbours");
  const shop = w.layout.addPiece("depot-workshop", { x: -40000, z: -40000, heading: 0 });
  syncIndustries(w, true);
  owesAsTheGameDoes(w, p);
  return { w, p, shop };
}

describe("every good a workshop price asks for can reach the workshop by train", () => {
  it("each good in a thing's cost (and so in a restore's) is one the workshop takes, or takes while owed", () => {
    const shop = RECIPES.workshop;
    for (const [id, rule] of Object.entries(THING_RULES)) {
      for (const k of kindsOf(rule!.cost)) expect(shop.takes.includes(k) || !!shop.owed?.includes(k), `${id}: ${k}`).toBe(true);
    }
    for (const role of Object.keys(SITE_NAMES) as (keyof typeof SITE_NAMES)[]) {
      for (const k of kindsOf(restorePrice(role).goods)) expect(shop.takes.includes(k) || !!shop.owed?.includes(k), `restore ${role}: ${k}`).toBe(true);
    }
  });
});

describe("the workshop takes stone only while a harbour's price still needs it (QA: a harbour couldn't be built)", { timeout: 30_000 }, () => {
  it("nothing owed (Harbours not learned): the workshop refuses stone, and the train keeps it", () => {
    const { w, p, shop } = setup(false);
    expect(shopNeeds(p, "stone")).toBe(0);
    expect(deliverByTrain(w, shop, "stone", 6)).toBe(6);
    expect(inYards(w, "stone")).toBe(0);
  });

  it("in Sandbox (no say in what's owed) it refuses stone too", () => {
    const { w, shop } = setup(true);
    w.economy.owes = null;
    expect(deliverByTrain(w, shop, "stone", 6)).toBe(6);
    expect(inYards(w, "stone")).toBe(0);
  });

  it("Harbours learned: a stone train leaves the harbour's 10 and stops there; the rest stays on board", () => {
    const { w, p, shop } = setup(true);
    expect(shopOwes(w, p, "stone")).toBe(10);
    expect(deliverByTrain(w, shop, "stone", 12)).toBe(2);
    expect(inYards(w, "stone")).toBe(10);
    expect(shopOwes(w, p, "stone")).toBe(0);
    // A second train once it's covered: the workshop takes none.
    expect(deliverByTrain(w, shop, "stone", 3)).toBe(3);
    expect(inYards(w, "stone")).toBe(10);
  });

  it("only what's still owed: holding 4, it takes 6 more", () => {
    const { w, p, shop } = setup(true);
    expect(deliverByTrain(w, shop, "stone", 4)).toBe(0);
    expect(shopOwes(w, p, "stone")).toBe(6);
    expect(deliverByTrain(w, shop, "stone", 9)).toBe(3);
    expect(inYards(w, "stone")).toBe(10);
  });

  it("then the harbour gets built from the tray, and the workshop takes stone for the next one", () => {
    const { w, p, shop } = setup(true);
    deliverByTrain(w, shop, "planks", 15);
    deliverByTrain(w, shop, "stone", 12);
    expect(craftNow(w, p, new Map([[HARBOUR, 1]]))).toBeNull();
    expect(p.owned.get(HARBOUR)).toBe(1);
    expect(inYards(w, "stone")).toBe(0);
    expect(shopOwes(w, p, "stone")).toBe(10);
  });

  it("waiting tray orders for two harbours: it takes stone for both (20), no more than its yard holds", () => {
    const p = Progress.fresh();
    p.learned.add("harbours");
    p.orders.push(HARBOUR, HARBOUR);
    expect(shopNeeds(p, "stone")).toBe(20);
    p.orders.push(HARBOUR, HARBOUR);
    expect(shopNeeds(p, "stone")).toBe(30);
    // (The one being made has had its stone taken.)
    p.making = true;
    expect(shopNeeds(p, "stone")).toBe(30);
    p.orders.length = 2;
    expect(shopNeeds(p, "stone")).toBe(10);
  });

  it("stone doesn't crowd out planks: a train of both leaves its planks and the harbour's stone, each on its own pile", () => {
    const { w, shop } = setup(true);
    deliverByTrain(w, shop, "planks", 9);
    deliverByTrain(w, shop, "stone", 12);
    expect(inYards(w, "planks")).toBe(9);
    expect(inYards(w, "stone")).toBe(10);
  });
});

describe("an unrouted hopper train from a quarry fills the workshop with what's owed", () => {
  it("it loads the quarry's stone (made there, not put there), and the workshop past it takes the harbour's 10", () => {
    const layout = new Layout();
    const types: PieceTypeId[] = ["straight-216", "straight-216", "straight-216", "depot-quarry", "straight-216", "depot-workshop", "straight-216", "straight-216"];
    const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", "hopper", "hopper", "hopper", "hopper"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    const quarry = economy.addDepot("quarry", ids[3]);
    const shop = economy.addDepot("workshop", ids[5]);
    const p = Progress.fresh();
    p.learned.add("harbours");
    economy.owes = (kind) => Math.max(0, shopNeeds(p, kind) - shop.piles[CARGO[kind].index]);
    // Three minutes of the quarry cutting stone before the train sets off.
    for (let t = 0; t < 180 * SIM_HZ; t++) economy.tick();
    expect(quarry.piles[CARGO.stone.index]).toBeGreaterThanOrEqual(12);
    sim.setLever(sim.getTrain(placed.trainId)!.cars[0].id, 1);
    for (let t = 0; t < 180 * SIM_HZ; t++) {
      sim.tick();
      economy.tick();
    }
    expect(shop.piles[CARGO.stone.index]).toBe(10);
    // (Only stone: nothing else came off a train into the yard.)
    for (const k of CARGO_KINDS) if (k !== "stone") expect(shop.piles[CARGO[k].index], k).toBe(0);
  });
});

describe("the cards say where the stone goes", () => {
  it("a harbour's price: \"Needs 10🪨 at the workshop\"; a restore's: 5; a price of planks only: nothing", () => {
    expect(owedText(THING_RULES[HARBOUR]!.cost)).toBe("Needs 10🪨 at the workshop");
    expect(owedText(restorePrice("harbour").goods)).toBe("Needs 5🪨 at the workshop");
    expect(owedText(THING_RULES["piece:depot-mill" as ThingId]!.cost)).toBeNull();
  });
});
