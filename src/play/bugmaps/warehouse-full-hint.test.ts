import { describe, expect, it } from "vitest";
import { SIM_HZ } from "../../sim";
import { capAt } from "../../economy";
import { CARGO } from "../../economy/cargo";
import { engineView } from "../../game/engine-status";
import { routeStops } from "../../game/route-stops";
import { loadBugMap } from "../bugmap";
import MAP from "./reports/2026-11-27-muffin-warehouse-full.txt?raw";
import MUFFIN_MAP from "./reports/2026-11-27-warehouse2-full-muffin.txt?raw";

/**
 * The user's map (2026-11-27, seed 770187, saved minutes before the report): "how is warehouse 2 full?" Muffin, on a
 * line mill → Farm yard → Warehouse 2 → … → bakery, said "Not loading flour at the mill: the warehouse 2 is full" while
 * Warehouse 2's card said Empty and took flour. Warehouse 2 was never where the flour would go: it passes flour on to
 * the bakery further round the line, a stop that uses it, and the bakery was full. The card named the first later stop
 * that takes flour at all, and called it full when it merely took flour (`takerFull` was `takesNow`).
 *
 * Muffin's line came after this save; Yellow line 3 here (farm, dairy, bakery, mill, Warehouse 2: engine 51) is the same
 * shape, and said "Not loading grain at the farm: the warehouse is full" with no grain in the warehouse (the mill was
 * full). Run as saved, every "is full" names a stop whose pile of that good is full, never Warehouse 2 while it would
 * pass the good on, and the bakery or mill named is the one really holding the train's goods back.
 */
describe("the user's 2026-11-27 map: \"how is warehouse 2 full?\"", () => {
  const WAREHOUSE = 15;
  const ENGINE = 51;

  it("each 'is full' on the engine card names a stop that is full", async () => {
    const { world } = await loadBugMap(MAP);
    const { sim, economy } = world;
    const line = economy.lines.get(economy.lineIdOf.get(ENGINE)!)!;
    expect(line.name).toBe("Yellow line 3");
    expect(line.stops.map((s) => economy.depot(s.depotId)!.role)).toEqual(["farm", "dairy", "bakery", "mill", "warehouse"]);
    const names = routeStops(world);
    const nameOf = (id: number) => names.find((s) => s.depotId === id)?.name ?? "";
    expect(nameOf(WAREHOUSE)).toBe("Warehouse 2");
    const said = new Set<string>();
    let full = 0;
    for (let i = 0; i < 900 * SIM_HZ; i++) {
      sim.tick();
      economy.tick();
      if (i % SIM_HZ) continue;
      const train = sim.findCar(ENGINE)!.train;
      const not = economy.notLoadingAt(train.id);
      if (!not || not.why !== "no-room") continue;
      const status = engineView(sim, economy, ENGINE, nameOf).status;
      said.add(status.replace(/^Not loading (\w+) at (.+?):.*/, "$1 at $2"));
      expect(not.taker, status).toBeDefined();
      if (not.takerRoom === "full") {
        full++;
        expect(not.taker!.piles[CARGO[not.kind].index], status).toBeGreaterThanOrEqual(capAt(not.taker!));
      }
      // (Warehouse 2 is named only full, or with room only for what's on board: as a buffer, or where the good ends up.)
      if (status.startsWith("Not loading") && /: Warehouse 2/.test(status)) expect(status).toMatch(/: Warehouse 2 (is full|has room only for what's on board)$/);
    }
    // (It did come to say so: grain at the farm for the mill, milk at the dairy for the bakery.)
    expect(full).toBeGreaterThan(0);
    expect(said.size).toBeGreaterThan(0);
  }, 120_000);

  it("Muffin at the moment of the screenshots: the bakery full, it takes the mill's flour to Warehouse 2, which gives it back for the bakery", async () => {
    const { world } = await loadBugMap(MUFFIN_MAP);
    const { sim, economy } = world;
    const names = routeStops(world);
    const nameOf = (id: number) => names.find((s) => s.depotId === id)?.name ?? "";
    const muffin = [...sim.trains()].map((t) => t.cars[0].id).find((e) => sim.nameOf(e) === "Muffin")!;
    const line = economy.lines.get(economy.lineIdOf.get(muffin)!)!;
    expect(line.name).toBe("Orange line 4");
    expect(line.stops.map((s) => nameOf(s.depotId))).toEqual(["Bakery", "Mill", "Warehouse 2", "Farm yard", "Dairy farm"]);
    const store = economy.depot(WAREHOUSE)!;
    const FLOUR = CARGO.flour.index;
    expect(store.piles[FLOUR]).toBe(0);
    // (The bakery has 11 flour of 12 and Muffin carries 2: no room for more there. Warehouse 2 keeps the extra. Muffin
    // is heading for Warehouse 2 now; it says so on its way to the mill.)
    const aboard = () => sim.findCar(muffin)!.train.cars.reduce((n, c) => n + (economy.cargoOf(c.id).kind === "flour" ? economy.cargoOf(c.id).count : 0), 0);
    const said = new Set<string>();
    let most = 0;
    let given = 0;
    let visit: { was: number; dropped: boolean; picked: boolean } | null = null;
    for (let i = 0; i < 1200 * SIM_HZ; i++) {
      const before = store.piles[FLOUR];
      sim.tick();
      economy.tick();
      if (store.piles[FLOUR] < before) given += before - store.piles[FLOUR];
      most = Math.max(most, store.piles[FLOUR]);
      // Muffin at Warehouse 2: it leaves flour there or takes some, never both on one visit.
      const r = economy.routeOf(muffin)!;
      const atStore = !!r.at && r.stops[r.next % r.stops.length].depotId === WAREHOUSE;
      if (atStore) {
        visit ??= { was: aboard(), dropped: false, picked: false };
        const now = aboard();
        if (now < visit.was) visit.dropped = true;
        if (now > visit.was) visit.picked = true;
        visit.was = now;
        expect(visit.dropped && visit.picked, "dropped and picked up flour on one visit").toBe(false);
      } else visit = null;
      if (i % SIM_HZ === 0) said.add(engineView(sim, economy, muffin, nameOf).status);
      expect(store.piles[FLOUR]).toBeLessThanOrEqual(capAt(store));
    }
    // Flour was kept at Warehouse 2 and given back out of it (for the bakery: the only stop on its lines that uses it).
    expect(most).toBeGreaterThan(0);
    expect(given).toBeGreaterThan(0);
    expect([...said].some((t) => t.startsWith("Taking flour to Warehouse 2: Bakery"))).toBe(true);
  }, 300_000);
});
