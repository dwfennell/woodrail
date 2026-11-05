import { describe, expect, it } from "vitest";
import { CARGO } from "../economy";
import { SURF_RIVER } from "../landscape";
import { Fleet } from "./boats";
import { cancel, order, progressOf, stillNeeds, tickYards, whyNotOrder, YARD_COSTS } from "./yards";
import { siteWhy } from "./industries";
import { buildStarterWorld, syncIndustries, type World } from "./world";

/** A boatyard on the −z bank of a straight run of river on the starter map, its depot. */
function boatyardOn(w: World) {
  const g = w.landscape.grid;
  for (let i = 0; i < g.cellCount; i++) {
    if (g.surface[i] !== SURF_RIVER) continue;
    const c = g.colOf(i);
    const r = g.rowOf(i);
    const at = (dc: number, dr: number) => g.surface[g.index(c + dc, r + dr)] ?? -1;
    let run = true;
    for (let k = -4; k <= 4; k++) if (at(k, 0) !== SURF_RIVER || at(k, -2) === SURF_RIVER || at(k, 2) === SURF_RIVER) run = false;
    if (!run) continue;
    const pose = { x: g.centreX(c) - 120, z: g.centreZ(r) - 100, heading: 0 };
    if (siteWhy(w.landscape, "kit-boatyard", pose) !== null) continue;
    const id = w.layout.addPiece("kit-boatyard", pose);
    syncIndustries(w, true);
    return w.economy.depotAtPiece(id)!;
  }
  throw new Error("no river run");
}

/** Goods brought by train to a yard (as a train's crane would leave them on its piles). */
function bring(d: { piles: Int32Array | number[] }, goods: Record<string, number>): void {
  for (const [k, n] of Object.entries(goods)) d.piles[CARGO[k as keyof typeof CARGO].index] += n;
}

describe("yards", () => {
  it("a boatyard stands on a bank, its ways to the water; a shipyard on the shore of the sea", () => {
    const w = buildStarterWorld();
    expect(boatyardOn(w).role).toBe("boatyard");
    expect(siteWhy(w.landscape, "kit-boatyard", { x: 0, z: -2000, heading: 0 })).toMatch(/bank/);
    expect(siteWhy(w.landscape, "kit-shipyard", { x: 0, z: -2000, heading: 0 })).toMatch(/sea/);
  });

  it("build a tug and barge from planks and iron trains bring: half built, then launched as a boat at the yard", () => {
    const w = buildStarterWorld();
    const yard = boatyardOn(w);
    const fleet = new Fleet(() => w);
    expect(whyNotOrder(w, yard, "barge")).toMatch(/needs a tug/);
    expect(order(w, yard, "tug")).toBe(true);
    expect(whyNotOrder(w, yard, "tug")).toMatch(/building already/);
    // Half the goods: half built, nothing launched.
    bring(yard, { planks: 10, iron: 2 });
    expect(tickYards(w, fleet)).toEqual([]);
    const o = w.economy.yardOrders.get(yard.id)!;
    expect(progressOf(o)).toBeCloseTo(0.5, 5);
    expect(stillNeeds(o)).toEqual({ planks: 10, iron: 2 });
    expect(yard.piles[CARGO.planks.index]).toBe(0);
    // The rest: launched, a boat of one barge waiting at the yard.
    bring(yard, { planks: 12, iron: 4 });
    const [e] = tickYards(w, fleet);
    expect(e).toMatchObject({ kind: "launched", depotId: yard.id, build: "tug" });
    const boat = w.economy.boats.get(e.boatId!)!;
    expect([boat.barges, boat.home, boat.stops.map((s) => s.depotId)]).toEqual([1, yard.id, [yard.id]]);
    // (What wasn't needed stays on the yard's piles.)
    expect(yard.piles[CARGO.planks.index]).toBe(2);
    expect(w.economy.yardOrders.has(yard.id)).toBe(false);
    // A barge for it, from 8 planks.
    expect(order(w, yard, "barge")).toBe(true);
    bring(yard, { planks: YARD_COSTS.barge.planks! });
    tickYards(w, fleet);
    expect(boat.barges).toBe(2);
  });

  it("a yard builds only its own kind: a ship ordered at a boatyard (an old save's) is dropped, not launched", () => {
    const w = buildStarterWorld();
    const yard = boatyardOn(w);
    // (A boatyard doesn't build ships.)
    expect(order(w, yard, "ship")).toBe(false);
    w.economy.yardOrders.set(yard.id, { build: "ship", got: { ...YARD_COSTS.ship } });
    // (The yard's depot is a boatyard, so a ship order there is dropped: only a shipyard keeps it.)
    tickYards(w, new Fleet(() => w));
    expect(w.economy.shipsBuilt).toBe(0);
  });

  it("an order stopped is gone, and its goods with it", () => {
    const w = buildStarterWorld();
    const yard = boatyardOn(w);
    order(w, yard, "tug");
    bring(yard, { planks: 5 });
    tickYards(w, new Fleet(() => w));
    cancel(w, yard.id);
    expect(w.economy.yardOrders.size).toBe(0);
    expect(yard.piles[CARGO.planks.index]).toBe(0);
  });

  it("orders and what's been built are saved", async () => {
    const { deserializeWorld, serializeWorld } = await import("../persist/save");
    const w = buildStarterWorld();
    const yard = boatyardOn(w);
    order(w, yard, "tug");
    bring(yard, { planks: 6 });
    tickYards(w, new Fleet(() => w));
    w.economy.shipsBuilt = 2;
    w.economy.ferriesBuilt = 1;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    const w2 = back.ok ? back.value : w;
    expect([...w2.economy.yardOrders.values()]).toEqual([{ build: "tug", got: { planks: 6 } }]);
    expect([w2.economy.shipsBuilt, w2.economy.ferriesBuilt]).toEqual([2, 1]);
  });
});
