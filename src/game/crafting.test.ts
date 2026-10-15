import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { appendPiece, connectorRef } from "../track";
import { Crafting, CRAFT_SECONDS, workshopStock } from "./crafting";
import { Progress } from "./progress";
import { buildStarterWorld, syncIndustries } from "./world";

/** The starter map with a workshop out of the first station's far end, holding `planks`. */
function withWorkshop(planks: number) {
  const w = buildStarterWorld();
  const station = w.stations.get(w.landscape.towns[0].id)!;
  const piece = appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 0));
  expect(syncIndustries(w)).toBe(true);
  expect(syncIndustries(w)).toBe(false);
  const d = w.economy.depotAtPiece(piece)!;
  expect(d.role).toBe("workshop");
  d.piles[CARGO.planks.index] = planks;
  return { w, d, piece };
}

describe("the workshop", () => {
  it("makes orders in turn from the planks in its yard, into the toy box", () => {
    const { w } = withWorkshop(7);
    const p = Progress.fresh();
    const c = new Crafting(p);
    c.order("car:engine");
    c.order("piece:buffer-turnback");
    expect(c.tick(w, 1)).toBeNull();
    expect(workshopStock(w).planks).toBe(1);
    expect(c.now).toMatchObject({ id: "car:engine", waiting: false });
    expect(c.tick(w, CRAFT_SECONDS)).toBe("car:engine");
    expect(p.owned.get("car:engine")).toBe(2);
    c.tick(w, 0);
    expect(c.tick(w, CRAFT_SECONDS)).toBe("piece:buffer-turnback");
    expect(workshopStock(w).planks).toBe(0);
    expect(c.now).toBeNull();
  });

  it("waits for goods it hasn't got, taking nothing", () => {
    const { w } = withWorkshop(2);
    const p = Progress.fresh();
    const c = new Crafting(p);
    c.order("car:timber");
    expect(c.tick(w, 10)).toBeNull();
    expect(c.now).toMatchObject({ id: "car:timber", waiting: true });
    expect(workshopStock(w).planks).toBe(2);
  });

  it("won't take orders for what isn't known yet, and can cancel ones not started", () => {
    const { w } = withWorkshop(0);
    const p = Progress.fresh();
    const c = new Crafting(p);
    c.order("piece:switch");
    expect(p.orders).toEqual([]);
    c.order("car:timber");
    c.order("car:timber");
    expect(c.cancel("car:timber")).toBe(true);
    expect(p.orders).toEqual(["car:timber"]);
    expect(workshopStock(w).planks).toBe(0);
  });

  it("is left out of the save when its piece is taken up, and loads back with its planks", async () => {
    const { serializeWorld, deserializeWorld } = await import("../persist/save");
    const { w, piece } = withWorkshop(5);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (back.ok) expect(workshopStock(back.value).planks).toBe(5);
    w.layout.removePiece(piece);
    const gone = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(gone.ok).toBe(true);
    if (gone.ok) expect(gone.value.economy.allDepots().some((d) => d.role === "workshop")).toBe(false);
  });
});

describe("coins as well as goods", () => {
  it("an industry waits for its coins too, and pays them when the workshop starts on it", () => {
    const { w, d: shop } = withWorkshop(12);
    const p = Progress.fresh();
    p.learned.add("farming");
    const c = new Crafting(p);
    c.order("piece:depot-farm");
    p.coins = 10;
    c.tick(w, 1);
    expect(p.making).toBe(false);
    expect(shop.piles[CARGO.planks.index]).toBe(12);
    p.coins = 45;
    c.tick(w, 1);
    expect(p.making).toBe(true);
    expect(p.coins).toBe(15);
    expect(shop.piles[CARGO.planks.index]).toBe(0);
  });
});
