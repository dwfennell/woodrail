import { describe, expect, it } from "vitest";
import { EARLY_PLANK_PRICE, PRICES, STAPLES } from "./towns";
import { Progress } from "./progress";
import { payDelivery } from "./rewards";
import { receivedBy, statusOf, TownLife, type TownLifeHost } from "./town-life";
import { buildStarterWorld } from "./world";
import { deliverByTrain } from "./workshop-testing";
import { keptText } from "./workshop-text";
import { passSentence } from "./line-sheet-text";

/**
 * Towns buy what they need (spec docs/superpowers/specs/2026-11-27-towns-buy-what-they-need.md): a town takes from a
 * train, and pays for, only what it needs to grow (or for its place or grand project under way: places.test.ts,
 * grand.test.ts), and the staples (everyday food, cars, oil, water, toys, the post) at half price. The rest stays on the
 * train. By the player's path: goods brought by train to the town's station, paid as main pays (`payDelivery` on
 * TownLife's `received`).
 */
function game() {
  const w = buildStarterWorld();
  const p = Progress.fresh();
  const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const life = new TownLife(host, { grew: () => {}, received: (town, kind, n, before) => payDelivery(p, kind, n, before, town) });
  life.reset();
  return { w, p, life };
}

describe("a town buys what it needs", () => {
  it("refuses goods it doesn't need: they stay on the train, unpaid", () => {
    const { w, p, life } = game();
    const town = w.landscape.towns[0];
    const station = w.stations.get(town.id)!;
    expect(statusOf(w, town.id).wants).toEqual({ planks: 4 });
    for (const kind of ["bricks", "paint", "stone", "furniture", "tools"] as const) {
      expect(STAPLES.has(kind), kind).toBe(false);
      expect(deliverByTrain(w, station, kind, 3), kind).toBe(3);
      expect(receivedBy(w, town.id)[kind] ?? 0, kind).toBe(0);
    }
    life.update();
    expect(p.coins).toBe(Progress.fresh().coins);
  });

  it("takes what it needs to grow, at the full price", () => {
    const { w, p, life } = game();
    const town = w.landscape.towns[0];
    const coins = p.coins;
    // A hamlet wants 4 planks: 3 brought, all taken, at a hamlet's price.
    expect(deliverByTrain(w, w.stations.get(town.id)!, "planks", 3)).toBe(0);
    life.update();
    expect(receivedBy(w, town.id).planks).toBe(3);
    expect(p.coins - coins).toBe(3 * EARLY_PLANK_PRICE);
  });

  it("takes the staples, needed or not, at half price", () => {
    const { w, p, life } = game();
    const town = w.landscape.towns[0];
    const coins = p.coins;
    expect(deliverByTrain(w, w.stations.get(town.id)!, "milk", 3)).toBe(0);
    life.update();
    expect(receivedBy(w, town.id).milk).toBe(3);
    expect(p.coins - coins).toBe(3 * Math.ceil(PRICES.milk! / 2));
  });

  it("says so: the engine card beside it, and the line sheet's stop", () => {
    expect(keptText("unwanted", "bricks", "town", "Rookhurst")).toBe("Not dropping bricks: Rookhurst doesn't need bricks");
    expect(passSentence("Rookhurst", ["bricks"])).toEqual(["Rookhurst doesn't need 🧱 bricks: they ride on"]);
    expect(passSentence("Rookhurst", [])).toEqual([]);
  });
});
