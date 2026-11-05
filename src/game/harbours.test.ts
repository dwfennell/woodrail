import { describe, expect, it } from "vitest";
import { capAt, capOf, CARGO, SHED_CAP } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { isWater, SURF_RIVER } from "../landscape";
import { siteWhy } from "./industries";
import { BOAT_DOCKED, BOAT_EVERY, BOAT_LOADS, BOAT_SAIL, boatPays, LIGHTHOUSE_ASSET, SHIP_LOADS, buyPrice, depotPoint, goodsForSale, HarbourTrade, loadBoat, QUAY, waterWay, type HarbourEvent } from "./harbours";
import { Progress } from "./progress";
import { buildStarterWorld, syncIndustries } from "./world";
import { coastWorld, harbourSite } from "./harbours-testing";

describe("harbours", () => {
  it("stand by water boats can reach: the way in runs over water, from out at sea to the quay", () => {
    const w = coastWorld();
    const pose = harbourSite(w);
    const way = waterWay(w.landscape, pose)!;
    expect(way.length).toBeGreaterThan(2);
    const q = depotPoint(pose, QUAY.t, QUAY.l);
    expect(way[way.length - 1]).toEqual(q);
    // Inland, nowhere near water: not a harbour.
    expect(siteWhy(w.landscape, "depot-harbour", { x: 0, z: 0, heading: 0 })).toMatch(/water/);
  });

  it("on a river, boats come up it from the edge of the land", () => {
    const w = buildStarterWorld();
    const pose = harbourSite(w, SURF_RIVER);
    const way = waterWay(w.landscape, pose)!;
    // It comes in from past the land's edge (off the grid), over river squares.
    const g = w.landscape.grid;
    expect(g.cellAtWorld(way[0].x, way[0].z)).toBe(-1);
    for (const p of way.slice(2, -2)) {
      const i = g.cellAtWorld(p.x, p.z);
      if (i !== -1) expect(isWater(g.surface[i])).toBe(true);
    }
  });

  it("a boat takes so many loads, the biggest piles first, and pays half a town's price", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.planks.index] = 5;
    d.piles[CARGO.flour.index] = 2;
    d.piles[CARGO.stone.index] = 1;
    const goods = loadBoat(d);
    expect(goods).toEqual({ planks: 4, flour: 2 });
    expect(Object.values(goods).reduce((a, b) => a + (b ?? 0), 0)).toBe(BOAT_LOADS);
    expect(d.piles[CARGO.planks.index]).toBe(1);
    expect(boatPays(goods)).toBe(Math.round((4 * 4 + 2 * 6) / 2));
  });

  it("boats come by themselves: in, tied up (selling), out, and again a while later", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.planks.index] = 8;
    const p = Progress.fresh();
    const trade = new HarbourTrade();
    const log: { t: number; e: HarbourEvent }[] = [];
    for (let t = 1; t <= 400; t++) for (const e of trade.update(w, p)) log.push({ t, e });
    const kinds = log.map((l) => l.e.kind);
    expect(kinds.slice(0, 4)).toEqual(["arrive", "sold", "leave", "arrive"]);
    const [arrive, sold, leave, again] = log;
    expect(sold.t - arrive.t).toBe(BOAT_SAIL);
    expect(leave.t - sold.t).toBe(BOAT_DOCKED);
    expect(again.t - leave.t).toBe(BOAT_SAIL + BOAT_EVERY);
    expect(sold.e.kind === "sold" && sold.e.goods).toEqual({ planks: 6 });
    expect(p.coins).toBe(12 + 4);
    expect(p.counts.get("exported")).toBe(8);
  });

  it("cargo ships, once learned: 24 loads a visit at a town's full price, and a lighthouse near brings them twice as often", () => {
    const w = coastWorld();
    const pose = harbourSite(w);
    const id = w.layout.addPiece("depot-harbour", pose);
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.planks.index] = 20;
    d.piles[CARGO.stone.index] = 10;
    const p = Progress.fresh();
    p.learned.add("cargo-ships");
    const trade = new HarbourTrade();
    const log: { t: number; e: HarbourEvent }[] = [];
    for (let t = 1; t <= 400; t++) for (const e of trade.update(w, p)) log.push({ t, e });
    const sold = log.find((l) => l.e.kind === "sold")!.e;
    if (sold.kind !== "sold") throw new Error("no sale");
    expect(sold.ship).toBe(true);
    expect((sold.goods.planks ?? 0) + (sold.goods.stone ?? 0)).toBe(SHIP_LOADS);
    expect(SHIP_LOADS).toBe(24);
    // A town's full price: twice what a rowing boat pays for the same.
    expect(sold.coins).toBe(boatPays(sold.goods, true));
    expect(boatPays({ planks: 14, stone: 10 }, true)).toBe(2 * boatPays({ planks: 14, stone: 10 }));
    // (Two ships call in 400 s: the second takes the 6 left.)
    expect(w.economy.shipLoads).toBe(30);
    expect(log.find((l) => l.e.kind === "arrive")!.e).toMatchObject({ ship: true });
    // A lighthouse a few squares from the quay, once Lighthouse is learned: half the wait between ships.
    const arrivals = (lit: boolean) => {
      const w2 = coastWorld();
      const at = harbourSite(w2);
      w2.layout.addPiece("depot-harbour", at);
      syncIndustries(w2);
      const p2 = Progress.fresh();
      if (lit) {
        p2.learned.add("lighthouse");
        const q = depotPoint(at, QUAY.t, QUAY.l - 200);
        w2.props.add(LIGHTHOUSE_ASSET, { x: q.x, z: q.z, heading: 0, y: 0 });
      }
      const t2 = new HarbourTrade();
      const times: number[] = [];
      for (let t = 1; t <= 700; t++) for (const e of t2.update(w2, p2)) if (e.kind === "arrive") times.push(t);
      return times;
    };
    const dark = arrivals(false);
    const lit = arrivals(true);
    expect(dark[1] - dark[0]).toBe(BOAT_SAIL + BOAT_DOCKED + BOAT_SAIL + BOAT_EVERY);
    expect(lit[1] - lit[0]).toBe(BOAT_SAIL + BOAT_DOCKED + BOAT_SAIL + BOAT_EVERY / 2);
  });

  it("dock sheds hold more of every good for the boats, and are saved", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    expect(capAt(d)).toBe(capOf("harbour"));
    d.sheds = 2;
    expect(capAt(d)).toBe(capOf("harbour") + 2 * SHED_CAP);
    d.piles[CARGO.planks.index] = capOf("harbour") + 5;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    const e = back.ok ? back.value.economy.depotAtPiece(id)! : null;
    expect(e?.sheds).toBe(2);
    expect(e?.piles[CARGO.planks.index]).toBe(capOf("harbour") + 5);
  });

  it("a boat in at a harbour that's taken up, or moved, is gone at once (the view's told)", () => {
    for (const how of ["remove", "move"] as const) {
      const w = coastWorld();
      const pose = harbourSite(w);
      const id = w.layout.addPiece("depot-harbour", pose);
      syncIndustries(w);
      const d = w.economy.depotAtPiece(id)!;
      const p = Progress.fresh();
      const trade = new HarbourTrade();
      const log: HarbourEvent[] = [];
      // Until the boat's tied up.
      while (trade.boatAt(d.id)?.phase !== "docked") log.push(...trade.update(w, p));
      if (how === "remove") {
        w.layout.removePiece(id);
        syncIndustries(w);
      } else {
        w.layout.movePiece(id, { ...pose, x: pose.x + 40 }, 0);
      }
      const after = trade.update(w, p);
      expect(after, how).toEqual([{ kind: "gone", depotId: d.id }]);
      // Nothing more of it: no leave for a boat that's gone; a moved harbour's next boat comes later as usual.
      const more: HarbourEvent[] = [];
      for (let t = 0; t < 60; t++) more.push(...trade.update(w, p));
      expect(more.some((e) => e.kind === "leave" || e.kind === "gone")).toBe(false);
      expect(log.filter((e) => e.kind === "arrive")).toHaveLength(1);
    }
  });

  it("boats sell you goods you already make, at twice a town's price, brought by the next boat", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    // Only what your industries make: the starter map has a sawmill and a forest yard, no mine.
    const sale = goodsForSale(w);
    expect(sale).toContain("planks");
    expect(sale).not.toContain("iron");
    expect(buyPrice("planks")).toBe(8);
    const p = Progress.fresh();
    p.coins = 100;
    const trade = new HarbourTrade();
    expect(trade.order(d.id, "planks")).toBe(true);
    expect(trade.order(d.id, "planks")).toBe(true);
    // A boat takes 6 loads; no more can be ordered.
    expect(trade.order(d.id, "log")).toBe(false);
    d.piles[CARGO.stone.index] = 2;
    const log: HarbourEvent[] = [];
    for (let t = 0; t < 60 && !log.some((e) => e.kind === "bought"); t++) log.push(...trade.update(w, p));
    // It loads first (the stone), then unloads the order: 6 planks for 48 coins.
    expect(log.find((e) => e.kind === "sold")).toMatchObject({ goods: { stone: 2 } });
    expect(log.find((e) => e.kind === "bought")).toMatchObject({ goods: { planks: 6 }, coins: 48, short: null });
    expect(d.piles[CARGO.planks.index]).toBe(6);
    expect(p.coins).toBe(100 + 5 - 48);
    expect(trade.ordered(d.id)).toEqual({});
    // The planks are landed: the next boat leaves them for trains.
    expect(loadBoat(d, BOAT_LOADS, w.economy.landed.get(d.id))).toEqual({});
  });

  it("ordered goods come off only as the boat ties up: never while the card says it's coming in (QA 2026-11-04, 8)", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    const p = Progress.fresh();
    p.coins = 100;
    const trade = new HarbourTrade();
    trade.order(d.id, "planks");
    // In the game's own steps (the clock's second, here a tenth of one), the card's line read after each.
    for (let t = 0; t < 120 * 10 && d.piles[CARGO.planks.index] === 0; t++) {
      trade.update(w, p, 0.1);
      if (d.piles[CARGO.planks.index] === 0) expect(trade.describe(d.id)).not.toMatch(/tied up/);
    }
    expect(d.piles[CARGO.planks.index]).toBe(3);
    expect(trade.describe(d.id)).toMatch(/^A boat is tied up at the quay/);
  });

  it("an order is paid for as it comes off: with too few coins, the rest goes back", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    const p = Progress.fresh();
    p.coins = 20;
    const trade = new HarbourTrade();
    trade.order(d.id, "planks");
    let bought: HarbourEvent | undefined;
    for (let t = 0; t < 60 && !bought; t++) bought = trade.update(w, p).find((e) => e.kind === "bought");
    expect(bought).toMatchObject({ goods: { planks: 2 }, coins: 16, short: "coins" });
    expect(p.coins).toBe(4);
  });

  it("trains take landed goods away from a harbour, and don't put them back", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    w.economy.land(d, "planks", 3);
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("no room for the train");
    const wagon = w.sim.getTrain(r.trainId)!.cars[1];
    expect(w.economy.needsService(d, wagon.id)).toBe(true);
    // A wagon of planks here while planks are landed: not unloaded.
    w.economy.setCargo(wagon.id, "planks", 2);
    expect(w.economy.needsService(d, wagon.id)).toBe(true); // (it can still take more on)
    w.economy.setCargo(wagon.id, "planks", w.economy.wagonCapacity);
    expect(w.economy.needsService(d, wagon.id)).toBe(false);
  });

  it("a train that takes bought goods from the quay doesn't hand them back in the same visit", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    w.economy.land(d, "planks", 3);
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("no room for the train");
    const wagon = w.sim.getTrain(r.trainId)!.cars[1];
    // The crane loads all three (landed counts down to none)...
    const crane = w.economy as unknown as { loadOne(d: unknown, carId: number): void };
    for (let k = 0; k < 3; k++) crane.loadOne(d, wagon.id);
    expect(w.economy.cargoOf(wagon.id)).toEqual({ kind: "planks", count: 3 });
    expect(w.economy.landed.get(d.id)![CARGO.planks.index]).toBe(0);
    // ...and doesn't put them back: nothing more to do here.
    expect(w.economy.needsService(d, wagon.id)).toBe(false);
    // Emptied elsewhere, the wagon is an ordinary one again.
    w.economy.setCargo(wagon.id, null, 0);
    expect(w.economy.landedFrom.has(wagon.id)).toBe(false);
  });

  it("goods landed on a quay are saved as landed: after a load, the next boat still leaves them", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    d.piles[CARGO.stone.index] = 2;
    w.economy.land(d, "planks", 4);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const e = back.value.economy.depotAtPiece(id)!;
    expect(e.piles[CARGO.planks.index]).toBe(4);
    expect(back.value.economy.landed.get(e.id)![CARGO.planks.index]).toBe(4);
    expect(loadBoat(e, BOAT_LOADS, back.value.economy.landed.get(e.id))).toEqual({ stone: 2 });
  });

  it("an order meeting a full quay says so (not coins)", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    w.economy.land(d, "planks", capAt(d)); // (landed: the boat leaves them, so the quay stays full)
    const p = Progress.fresh();
    p.coins = 500;
    const trade = new HarbourTrade();
    trade.order(d.id, "planks");
    expect(trade.full(d.id)).toBe(false);
    trade.order(d.id, "planks");
    expect(trade.full(d.id)).toBe(true);
    let bought: HarbourEvent | undefined;
    for (let t = 0; t < 60 && !bought; t++) bought = trade.update(w, p).find((e) => e.kind === "bought");
    expect(bought).toMatchObject({ short: "room" });
  });

  it("a car carrying bought goods still won't hand them back there after a save and load", () => {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    w.economy.land(d, "planks", 3);
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 150 });
    if (r.kind !== "placed") throw new Error("no room for the train");
    const crane = w.economy as unknown as { loadOne(d: unknown, carId: number): void };
    for (let k = 0; k < 3; k++) crane.loadOne(d, w.sim.getTrain(r.trainId)!.cars[1].id);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const e = back.value.economy.depotAtPiece(id)!;
    const wagon = back.value.sim.getTrain(back.value.sim.trainIds()[0])!.cars[1];
    expect(back.value.economy.cargoOf(wagon.id)).toEqual({ kind: "planks", count: 3 });
    expect(back.value.economy.landedFrom.get(wagon.id)).toBe(e.id);
    // No planks landed there now, yet the wagon doesn't unload its bought ones back.
    expect(back.value.economy.needsService(e, wagon.id)).toBe(false);
  });
});
