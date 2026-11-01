import { describe, expect, it } from "vitest";
import { GOODS_ICON } from "../economy/cargo";
import { techOf } from "./tech";
import { BLUEPRINTS } from "./blueprints";
import { firstFoodNews } from "./food-text";
import { THING_RULES } from "./things";
import { buysText } from "./town-ledger";
import { FOODS, LUXURIES, payFor, PRICES, TOWN_LEVELS, townLevel, townStatus } from "./towns";

describe("the dairy chain and the orchard (tech-tree I3, I4)", () => {
  it("are built rows on the board, after the first City, mostly coins", () => {
    const row = (id: string) => BLUEPRINTS.find((b) => b.id === id)!;
    for (const id of ["dairy", "bakery", "orchard"]) {
      const b = row(id);
      expect(b.plan, id).toBeUndefined();
      expect(b.key, id).toBeFalsy();
      expect(b.tier, id).toBe(2);
      expect(b.research.coins ?? 0, id).toBeGreaterThanOrEqual(60);
      expect(techOf(id), id).toBeTruthy();
    }
    expect(row("dairy").needs).toEqual(["farming"]);
    expect(row("orchard").needs).toEqual(["farming"]);
    expect(row("bakery").needs).toEqual(["mills", "dairy"]);
    // Nothing new takes planks before the first City (spec §3): the dairy and the orchard need a city; the bakery
    // follows the dairy. No study asks for milk, bread or fruit: the balance player researches toward goods a study
    // asks for that nothing makes (`towardChains`), so one would send it down the dairy chain and move the bands.
    for (const id of ["dairy", "orchard"]) expect(row(id).requires).toContainEqual({ kind: "level", level: 3 });
    expect(row("bakery").research).toEqual({ goods: { planks: 12 }, coins: 120 });
    for (const b of BLUEPRINTS) for (const k of ["milk", "bread", "fruit"]) expect(b.research.goods[k], `${b.id} ${k}`).toBeUndefined();
    // The creamery and the tank wagons for oil and water stay planned.
    expect(row("creamery").plan).toBe("soon");
    expect(row("tankers").plan).toBe("soon");
  });

  it("each brings its industry, the dairy its milk tank wagon too", () => {
    expect(THING_RULES["piece:depot-dairy"]).toMatchObject({ tech: "dairy", coins: 180 });
    expect(THING_RULES["piece:depot-bakery"]).toMatchObject({ tech: "bakery", coins: 260 });
    expect(THING_RULES["piece:depot-orchard"]).toMatchObject({ tech: "orchard", coins: 150 });
    expect(THING_RULES["car:tanker"]).toMatchObject({ tech: "dairy", cost: { planks: 3 } });
  });

  it("towns always take milk, bread and fruit and pay the full price, but never need them to grow", () => {
    for (const k of ["milk", "bread", "fruit"] as const) {
      expect(FOODS.has(k)).toBe(true);
      expect(LUXURIES.has(k)).toBe(true);
      for (let level = 0; level < 8; level++) expect(townLevel(level).wants[k], `${k} at ${level}`).toBeUndefined();
      // A hamlet and a city pay alike: the full price.
      const hamlet = townStatus({});
      expect(payFor(k, hamlet)).toBe(PRICES[k]);
    }
    expect(TOWN_LEVELS.length).toBe(4);
    // Planks a hamlet doesn't want are still half price (unchanged).
    expect(payFor("stone", townStatus({}))).toBe(Math.ceil(PRICES.stone! / 2));
  });

  it("a town's card says what it always buys, of what's learned", () => {
    expect(buysText(new Set())).toBeNull();
    expect(buysText(new Set(["dairy"]))).toBe(`Always buys ${GOODS_ICON.milk} milk at full pay`);
    expect(buysText(new Set(["dairy", "bakery", "orchard"]))).toBe(`Always buys ${GOODS_ICON.milk} milk, ${GOODS_ICON.bread} bread and ${GOODS_ICON.fruit} fruit at full pay`);
  });

  it("the News has the first milk, bread or fruit any town has had, once", () => {
    expect(firstFoodNews("bread", 3, 3, "Ashby")).toBe(`First bread! ${GOODS_ICON.bread} Ashby buys it at full pay`);
    expect(firstFoodNews("bread", 3, 6, "Ashby")).toBeNull();
    expect(firstFoodNews("flour", 3, 3, "Ashby")).toBeNull();
  });
});
