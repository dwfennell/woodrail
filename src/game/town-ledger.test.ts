import { describe, expect, it } from "vitest";
import { buildStarterWorld } from "./world";
import { ledgerKey, townLedger, type LedgerContext } from "./town-ledger";
import type { DepotState } from "../economy";
import { MARKET_BONUS } from "./landmarks";

const ctx = (learned: string[] = [], room: number | null = null, carried = 0): LedgerContext => ({ learned: new Set(learned), room, carried });

/** The starter world and its first town's station depot. */
function world() {
  const w = buildStarterWorld();
  const town = w.landscape.towns[0];
  const d = w.economy.depotAtPiece(w.stations.get(town.id)!)!;
  return { w, town, d };
}

describe("the town ledger (Game mode's town card)", () => {
  it("a new town: a hamlet growing into a village, planks 0 of 4, nothing holding it back (the starter map saws planks)", () => {
    const { w, town, d } = world();
    const v = townLedger(w, d, ctx())!;
    expect(v.name).toBe(town.name);
    expect([v.level, v.next, v.have, v.need]).toEqual(["Hamlet", "Village", 0, 4]);
    expect(v.goods).toEqual([{ kind: "planks", icon: "🪵", label: "Planks", have: 0, need: 4 }]);
    expect(v.holding).toBeNull();
    expect(v.school).toBeNull();
    expect(v.market).toBe(1);
    expect(v.station).toBeNull();
    expect(v.lines).toEqual([]);
  });

  it("counts what it's had toward the next level, and says plainly what nothing on the map makes yet", () => {
    const { w, town, d } = world();
    // A town (4 + 8 planks), and some way to a city (14 planks and 6 flour).
    w.economy.delivered.set(town.id, 12 + 10);
    w.economy.deliveredGoods.set(town.id, { flour: 5 });
    const v = townLedger(w, d, ctx())!;
    expect([v.level, v.next]).toEqual(["Town", "City"]);
    expect(v.goods.map((g) => [g.kind, g.have, g.need])).toEqual([
      ["planks", 10, 14],
      ["flour", 5, 6],
    ]);
    expect([v.have, v.need]).toEqual([15, 20]);
    // No mill on the starter map: flour is the first thing nothing makes. How to get one: learn Mills, then build one.
    expect(v.holding).toBe("Needs 🍞 flour: there's no mill yet. Learn Mills at a school");
    expect(townLedger(w, d, ctx(["mills"]))!.holding).toBe("Needs 🍞 flour: there's no mill yet. Build one from the tray");
  });

  it("its school (a college, a library wing as the town grows), the waiting people once passengers are learned, the lines that call", () => {
    const { w, town, d } = world();
    const school = w.economy.addDepot("school", d.pieceId, town.id);
    expect(townLedger(w, d, ctx())!.school).toEqual({ depotId: school.id, name: `${town.name} school`, note: "a schoolhouse" });
    // A town: with College learned its school is a college; a city, and it has a library wing too.
    w.economy.delivered.set(town.id, 12);
    // (Named as its card is: the note says it's a college.)
    expect(townLedger(w, d, ctx(["college"]))!.school).toEqual({ depotId: school.id, name: `${town.name} school`, note: "a college: learns 2× as fast" });
    w.economy.delivered.set(town.id, 26);
    w.economy.deliveredGoods.set(town.id, { flour: 6 });
    expect(townLedger(w, d, ctx(["college"]))!.school).toEqual({ depotId: school.id, name: `${town.name} school`, note: "a college: learns 2× as fast · library wing" });
    d.waiting = 3;
    expect(townLedger(w, d, ctx([], 12, 40))!.station).toEqual({ waiting: 3, room: 12, carried: 40 });
    const other = w.economy.depotAtPiece(w.stations.get(w.landscape.towns[1].id)!)!;
    w.economy.lines.set(1, { id: 1, colour: "#c0392b", name: "Red line", stops: [{ depotId: d.id, action: "auto" }, { depotId: other.id, action: "auto" }] });
    w.economy.lines.set(2, { id: 2, colour: "#2f6db5", name: "Blue line", stops: [{ depotId: other.id, action: "auto" }] });
    w.economy.lineIdOf.set(101, 1);
    w.economy.lineIdOf.set(102, 1);
    // The lines show once Train routes is learned (their chips open the Lines view, which needs it).
    expect(townLedger(w, d, ctx())!.lines).toEqual([]);
    expect(townLedger(w, d, ctx(["routes"]))!.lines).toEqual([{ id: 1, name: "Red line", colour: "#c0392b", trains: 2 }]);
  });


  it("its key changes when anything it shows does, and only then", () => {
    const { w, town, d } = world();
    const key = (c = ctx()) => ledgerKey(w, d as DepotState, c);
    const k0 = key();
    expect(key()).toBe(k0);
    const seen = new Set([k0]);
    const changed = (what: string, k: number) => {
      expect(seen.has(k), what).toBe(false);
      seen.add(k);
    };
    w.economy.delivered.set(town.id, 3);
    changed("a delivery", key());
    w.economy.deliveredGoods.set(town.id, { flour: 1 });
    changed("flour in", key());
    d.waiting = 2;
    changed("someone waiting", key());
    changed("passengers learned", key(ctx(["passengers"], 6)));
    changed("someone carried", key(ctx(["passengers"], 6, 1)));
    w.economy.lines.set(1, { id: 1, colour: "#c0392b", name: "Red line", stops: [{ depotId: d.id, action: "auto" }] });
    changed("a line", key());
    w.economy.lines.get(1)!.name = "Timber run";
    changed("a line renamed", key());
    w.economy.lineIdOf.set(101, 1);
    changed("a train on it", key());
    town.buildings.push({ ...town.buildings[0], id: 9999, landmark: "market" });
    changed("a new building", key());
    expect(townLedger(w, d, ctx())!.market).toBe(MARKET_BONUS);
  });
});
