import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { pilesOf, RECIPES } from "../economy/economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { craftNow, owedSpare, owedText, shopNeeds, shopOwes, shopOwing } from "./crafting";
import { Progress } from "./progress";
import { attachResearch, lacking as researchLacking } from "./research";
import { THING_RULES, type ThingId } from "./things";
import { buildStarterWorld, syncIndustries, type World } from "./world";
import { deliverByTrain, inYards, owesAsTheGameDoes } from "./workshop-testing";

/**
 * Balance play-through, seed 1: Smithy's research waited 65 minutes for iron while the foundry's went mostly into the
 * workshop's yard, which took iron always. Now it takes iron as it takes a harbour's stone: only while a price the
 * player may pay there still needs some (a smithy, a power station, a colour-light signal known and not built, or a
 * waiting tray order), with a small spare on top (`owedSpare`: the cheapest such thing's iron), and only as many.
 */

const SMITHY = "piece:depot-smithy" as ThingId;
const POWER = "piece:depot-power" as ThingId;

/** The starter map, a workshop out of the way (`ahead`: what's laid on past it), and a Game player who knows `learned`. */
function setup(learned: string[] = [], ahead?: Parameters<typeof deliverByTrain>[5]): { w: World; p: Progress; shop: number; deliver: (kind: "planks" | "iron", n: number) => number } {
  const w = buildStarterWorld();
  const p = Progress.fresh();
  p.coins = 2000;
  for (const id of learned) p.learned.add(id);
  const shop = w.layout.addPiece("depot-workshop", { x: -40000, z: -40000, heading: 0 });
  syncIndustries(w, true);
  owesAsTheGameDoes(w, p);
  return { w, p, shop, deliver: (kind, n) => deliverByTrain(w, shop, kind, n, 120, ahead) };
}

/** A smithy made from the tray (its goods brought by train, paid from the yard), then put down, its depot added as the game adds it. */
function buildSmithy(w: World, p: Progress, deliver: (kind: "planks" | "iron", n: number) => number): void {
  deliver("planks", 8);
  deliver("iron", 9);
  expect(craftNow(w, p, new Map([[SMITHY, 1]]))).toBeNull();
  w.layout.addPiece("depot-smithy", { x: -30000, z: -30000, heading: 0 });
  syncIndustries(w, true);
  expect(p.available(w, SMITHY)).toBe(0);
}

describe("the workshop takes iron only while a price needs it there", { timeout: 60_000 }, () => {
  it("iron is a good the workshop takes only while owed, as stone is", () => {
    expect(RECIPES.workshop.takes).not.toContain("iron");
    expect(RECIPES.workshop.owed).toContain("iron");
    // (Its pile is still there, for the crane and the yard's iron bars.)
    expect(pilesOf("workshop")).toContain("iron");
  });

  it("nothing known costs iron: the workshop refuses iron, and the train keeps it", () => {
    const { w, p, deliver } = setup(["foundry"]);
    expect(shopOwes(w, p, "iron")).toBe(0);
    expect(shopOwing(w, p)).toBe(false);
    expect(deliver("iron", 6)).toBe(6);
    expect(inYards(w, "iron")).toBe(0);
  });

  it("in Sandbox (no say in what's owed) it refuses iron, as it does stone", () => {
    const { w, deliver } = setup(["smithy"]);
    w.economy.owes = null;
    expect(deliver("iron", 6)).toBe(6);
    expect(inYards(w, "iron")).toBe(0);
  });

  it("Smithy learned, none built: the smithy's 4 owed and a spare of 4; a train leaves 8 and keeps the rest", () => {
    const { w, p, deliver } = setup(["smithy"]);
    expect(shopNeeds(p, "iron", w)).toBe(4);
    expect(owedSpare(p, "iron", w)).toBe(4);
    expect(shopOwes(w, p, "iron")).toBe(8);
    expect(deliver("iron", 12)).toBe(4);
    expect(inYards(w, "iron")).toBe(8);
    expect(shopOwes(w, p, "iron")).toBe(0);
    // Covered: the next train keeps all its iron.
    expect(deliver("iron", 3)).toBe(3);
  });

  it("Electricity learned: the power station's 6 and a colour-light signal's 1 (the cheapest) as the spare", () => {
    const { w, p } = setup(["electricity"]);
    expect(shopNeeds(p, "iron", w)).toBe(6);
    expect(owedSpare(p, "iron", w)).toBe(1);
    expect(shopOwes(w, p, "iron")).toBe(7);
  });

  it("the smithy built: nothing owed, and an iron train passing the workshop leaves none", () => {
    const { w, p, deliver } = setup(["smithy"]);
    buildSmithy(w, p, deliver);
    // (The spare's 4 left over in the yard: nothing more is owed.)
    expect(inYards(w, "iron")).toBe(4);
    expect(owedSpare(p, "iron", w)).toBe(0);
    expect(shopOwes(w, p, "iron")).toBe(0);
    expect(shopOwing(w, p)).toBe(false);
    expect(deliver("iron", 6)).toBe(6);
    expect(inYards(w, "iron")).toBe(4);
  });

  it("smithies queued at the workshop: their iron owed (no spare: nothing known is unbuilt), and a train leaves it", () => {
    const { w, p, deliver } = setup(["smithy"]);
    buildSmithy(w, p, deliver);
    // One queued: the spare's 4 left in the yard cover it.
    p.orders.push(SMITHY);
    expect(shopOwes(w, p, "iron")).toBe(0);
    // Two: 8, less the 4 held.
    p.orders.push(SMITHY);
    expect(owedSpare(p, "iron", w)).toBe(0);
    expect(shopOwes(w, p, "iron")).toBe(4);
    expect(shopOwing(w, p)).toBe(true);
    expect(deliver("iron", 6)).toBe(2);
    expect(inYards(w, "iron")).toBe(8);
  });

  it("queued orders for two power stations: 12 owed, the dearest known thing counting no more", () => {
    const p = Progress.fresh();
    p.learned.add("electricity");
    p.orders.push(POWER, POWER);
    expect(shopNeeds(p, "iron")).toBe(12);
  });

  it("Smithy being studied: the workshop takes none, and the school past it gets all the research lacks", () => {
    const { w, p, deliver } = setup(["foundry", "carpentry"], ["depot-school", "straight-216", "straight-216"]);
    w.economy.accepts = (d, kind) => (d.role === "school" ? researchLacking(p, kind) > 0 : true);
    attachResearch(w.economy, () => p);
    // (Setup shortcut, not what's tested: Smithy being studied, its iron still to come.)
    p.research.current = "smithy";
    p.research.got = {};
    expect(researchLacking(p, "iron")).toBe(10);
    expect(shopOwes(w, p, "iron")).toBe(0);
    expect(deliver("iron", 12)).toBe(2);
    expect(inYards(w, "iron")).toBe(0);
    expect(p.research.got.iron).toBe(10);
  });

  it("an old save with iron in the workshop's yard loads with it, and that iron counts toward what's owed", () => {
    const { w, p, shop } = setup([]);
    // (As an old save has it: iron taken before it was owed.)
    const yard = w.economy.allDepots().find((d) => d.pieceId === shop)!;
    yard.piles[CARGO.iron.index] = 5;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!r.ok) throw new Error(r.error);
    const w2 = r.value;
    expect(inYards(w2, "iron")).toBe(5);
    const p2 = Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    expect(shopOwes(w2, p2, "iron")).toBe(0);
    p2.learned.add("smithy");
    expect(shopOwes(w2, p2, "iron")).toBe(3);
  });
});

describe("the cards say where the iron goes", () => {
  it("a smithy's price: \"Needs 4🔩 at the workshop\"; a power station's 6; a colour-light signal's 1", () => {
    expect(owedText(THING_RULES[SMITHY]!.cost)).toBe("Needs 4🔩 at the workshop");
    expect(owedText(THING_RULES[POWER]!.cost)).toBe("Needs 6🔩 at the workshop");
    expect(owedText(THING_RULES["piece:kit-colour-light-signal" as ThingId]!.cost)).toBe("Needs 1🔩 at the workshop");
  });
});
