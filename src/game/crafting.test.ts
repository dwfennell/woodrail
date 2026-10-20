import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { appendPiece, connectorRef } from "../track";
import { costOf, craftNow, craftShort, Crafting, CRAFT_SECONDS, ENGINE_NOTE, lacking, madeText, makeNote, uncraft, workshopStock } from "./crafting";
import { makeRowHtml } from "../ui/workshop-panel";
import type { ThingId } from "./things";
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
    // (A farm yard: 6 planks + 90 coins.)
    p.coins = 200;
    c.tick(w, 1);
    expect(p.making).toBe(true);
    expect(p.coins).toBe(110);
    expect(shop.piles[CARGO.planks.index]).toBe(6);
  });

  it("from the tray: one made at once from the yard's planks, into the toy box", () => {
    const { w } = withWorkshop(5);
    const p = Progress.fresh();
    p.learned.add("switches");
    const before = p.owned.get("piece:switch") ?? 0;
    expect(craftNow(w, p, new Map([["piece:switch", 1]]))).toBeNull();
    expect(p.owned.get("piece:switch")).toBe(before + 1);
    expect(workshopStock(w).planks).toBe(2);
  });

  it("from the tray, short of goods: says what's missing, takes nothing", () => {
    const { w } = withWorkshop(1);
    const p = Progress.fresh();
    p.learned.add("switches");
    expect(craftNow(w, p, new Map([["piece:switch", 1]]))).toEqual({ goods: { planks: 2 }, coins: 0 });
    expect(workshopStock(w).planks).toBe(1);
  });

  it("only asking (a tap on the tray): says whether it could be made, and takes nothing", () => {
    const p = Progress.fresh();
    p.learned.add("switches");
    const one = new Map<ThingId, number>([["piece:switch", 1]]);
    const { w } = withWorkshop(3);
    expect(craftShort(w, p, one)).toBeNull();
    expect(craftShort(withWorkshop(1).w, p, one)).toEqual({ goods: { planks: 2 }, coins: 0 });
    expect(craftShort(buildStarterWorld(), p, one)).toBe("no-workshop");
    expect(workshopStock(w).planks).toBe(3);
    expect(p.owned.get("piece:switch") ?? 0).toBe(0);
  });

  it("from the tray, with no workshop: nothing made", () => {
    const w = buildStarterWorld();
    const p = Progress.fresh();
    p.learned.add("switches");
    expect(craftNow(w, p, new Map([["piece:switch", 1]]))).toBe("no-workshop");
  });

  it("from the tray, a train's missing cars: all made or none, priced together", () => {
    const { w } = withWorkshop(10);
    const p = Progress.fresh();
    const needs = new Map<ThingId, number>([["car:engine", 1], ["car:timber", 2]]);
    // Whatever the toy box lacks of them, priced as one.
    for (const [id] of needs) p.owned.set(id, 0);
    const lack = lacking(w, p, needs);
    expect([...lack]).toEqual([["car:engine", 1], ["car:timber", 2]]);
    const cost = costOf(lack);
    expect(cost.goods.planks).toBe(costOf(new Map([["car:engine", 1]])).goods.planks! + 2 * costOf(new Map([["car:timber", 1]])).goods.planks!);
    if (cost.goods.planks! > 10) {
      // Not enough for the lot: nothing made, nothing taken.
      expect(craftNow(w, p, lack)).toMatchObject({ goods: { planks: cost.goods.planks! - 10 } });
      expect(workshopStock(w).planks).toBe(10);
      expect(p.owned.get("car:engine")).toBe(0);
    }
    const { w: rich } = withWorkshop(cost.goods.planks!);
    expect(craftNow(rich, p, lack)).toBeNull();
    expect(workshopStock(rich).planks).toBe(0);
    expect([p.owned.get("car:engine"), p.owned.get("car:timber")]).toEqual([1, 2]);
  });
});

describe("uncraft", () => {
  it("gives back what craftNow took: the planks to the yard, the coins, and the things out of the toy box", () => {
    const { w } = withWorkshop(10);
    const p = Progress.fresh();
    const wants = new Map<ThingId, number>([["car:timber", 3]]);
    const before = { planks: workshopStock(w).planks, coins: p.coins, owned: p.owned.get("car:timber") ?? 0 };
    expect(craftNow(w, p, wants)).toBeNull();
    expect(workshopStock(w).planks ?? 0).toBeLessThan(before.planks ?? 0);
    uncraft(w, p, wants);
    expect(workshopStock(w).planks).toBe(before.planks);
    expect(p.coins).toBe(before.coins);
    expect(p.owned.get("car:timber") ?? 0).toBe(before.owned);
  });
});

describe("a second engine before Signals (QA: the workshop could make the one the presents hold back)", () => {
  it("its row says it needs Signals to share a line, with an engine owned; it isn't barred", () => {
    const p = Progress.fresh();
    expect(p.owned.get("car:engine")).toBe(1);
    expect(makeNote(p, "car:engine")).toBe(ENGINE_NOTE);
    expect(ENGINE_NOTE).toBe("Needs Signals to share a line");
    // Nothing else is noted.
    expect(makeNote(p, "car:timber")).toBeNull();
    expect(makeNote(p, "piece:buffer-turnback")).toBeNull();
    // The first engine (none owned): nothing to say.
    p.owned.delete("car:engine");
    expect(makeNote(p, "car:engine")).toBeNull();
    // Signals learned: two can share a line now.
    p.owned.set("car:engine", 1);
    p.learned.add("signals");
    expect(makeNote(p, "car:engine")).toBeNull();
    // Not a gate: it's still made, from 6 planks.
    const { w } = withWorkshop(6);
    const q = Progress.fresh();
    expect(makeNote(q, "car:engine")).toBe(ENGINE_NOTE);
    expect(craftNow(w, q, new Map([["car:engine" as ThingId, 1]]))).toBeNull();
    expect(q.owned.get("car:engine")).toBe(2);
  });

  it("an engine ordered on the workshop's card says it too as it's made (QA P5: only the tray's said it)", () => {
    const { w } = withWorkshop(12);
    const p = Progress.fresh();
    const c = new Crafting(p);
    c.order("car:engine");
    let made: ThingId | null = null;
    for (let i = 0; i < 10 && !made; i++) made = c.tick(w, 1);
    expect(made).toBe("car:engine");
    expect(p.owned.get("car:engine")).toBe(2);
    expect(madeText(p, made!, "Engine")).toBe(`+1 Engine in your toy box. ${ENGINE_NOTE}`);
    // A wagon: no note.
    expect(madeText(p, "car:timber", "Flatbed wagon")).toBe("+1 Flatbed wagon in your toy box");
    // The first engine (none before it), or with Signals learned: none either.
    const q = Progress.fresh();
    q.owned.delete("car:engine");
    q.add("car:engine");
    expect(madeText(q, "car:engine", "Engine")).toBe("+1 Engine in your toy box");
    p.learned.add("signals");
    expect(madeText(p, "car:engine", "Engine")).toBe("+1 Engine in your toy box");
  });

  it("the workshop's card shows the note under the engine's name, beside its + button", () => {
    const row = { id: "car:engine" as ThingId, label: "Engine", cost: "6 planks", have: 0, queued: 0, shelf: "Trains" };
    const html = makeRowHtml({ ...row, note: ENGINE_NOTE });
    expect(html).toContain(`<span class="make-note">Needs Signals to share a line</span>`);
    expect(html).toContain(`data-make="car:engine" title="Make one more"`);
    expect(makeRowHtml({ ...row, note: null })).not.toContain("make-note");
  });
});
