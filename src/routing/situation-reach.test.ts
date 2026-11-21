/**
 * Situation help step 5 (spec docs/superpowers/specs/2026-11-18-situation-help.md, detectors #6 and #9), on the
 * game's own sim and economy: a routed train that can't reach its stops for a line end too short for it, said only
 * while its card hasn't been looked at; a train too long for a yard, its tail on the points each time it's worked
 * there, said once it's happened twice, and not for one that fits.
 */
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { Economy } from "../economy/economy";
import { CARGO } from "../economy/cargo";
import { editLine } from "../game/lines";
import { TOO_LONG, UNREACHABLE, CARD_SEEN_S, type SituationContext } from "../game/situation-tips";
import type { World } from "../game/world";

const S: PieceTypeId = "straight-216";
const world = (layout: Layout, sim: Sim, economy: Economy) => ({ layout, sim, economy }) as unknown as World;

describe("situation tips: a stop out of reach, a train too long for its yard", { timeout: 120_000 }, () => {
  it("a line end too short to turn in: the line skips its stops, said while its card isn't looked at", () => {
    // (stubs.test.ts's kickback: a train on road A longer than the dead end it would have to turn in.)
    const layout = new Layout();
    const stub = chain(layout, [S]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(stub[0], 0));
    const sw = appendPiece(layout, "switch", false, connectorRef(stub[0], 1), 0);
    const a = chain(layout, [S, S, S, S, S, S], connectorRef(sw, 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(a[5], 1));
    const b = chain(layout, [S, S], connectorRef(sw, 2));
    const forest = appendPiece(layout, "depot-forest", false, connectorRef(b[1], 1));
    const c = chain(layout, [S, S], connectorRef(forest, 1));
    const mill = appendPiece(layout, "depot-sawmill", false, connectorRef(c[1], 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(mill, 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const f = economy.addDepot("forest", forest);
    const m = economy.addDepot("sawmill", mill);
    const cars: CarKind[] = ["engine", "timber", "timber", "timber", "timber"];
    const placed = sim.addTrain(cars, { pieceId: a[3], pathIndex: 0, reversed: true, s: 100 });
    if (placed.kind !== "placed") throw new Error("no room");
    const e = sim.getTrain(placed.trainId)!.cars[0].id;
    const line = editLine(economy, e, (st) => st.push({ depotId: f.id, action: "auto" }, { depotId: m.id, action: "auto" }))!;
    sim.setLever(e, 1);
    for (let k = 0; k < 120 * SIM_HZ; k++) {
      sim.tick();
      economy.tick();
    }
    expect(economy.shortSkipOf(e)).not.toBeNull();
    const ctx = (cardAt?: number): SituationContext => ({ learned: null, nameOf: (id) => (id === f.id ? "the forest" : `D${id}`), now: 500, cardAt: () => cardAt });
    const sit = UNREACHABLE.look(world(layout, sim, economy), ctx());
    expect(sit?.title).toBe(`The ${line.name} skips the forest`);
    expect(sit?.text).toMatch(/too short for its train to turn and take the other road\. Lengthen it, or take a car off\./);
    expect(sit?.more).toBe("routes");
    expect(sit?.engine).toBe(e);
    // (Its card open a moment ago says it already: no tip. A while after, the tip.)
    expect(UNREACHABLE.look(world(layout, sim, economy), ctx(500 - 10))).toBeNull();
    expect(UNREACHABLE.look(world(layout, sim, economy), ctx(500 - CARD_SEEN_S - 1))).not.toBeNull();
  });

  /** ⊐ forest ══ ══ ══ ══ points · sawmill ⊏, the points' other road a stub: a yard as long as the sawmill. */
  function yard(cars: CarKind[], shorten = false) {
    const layout = new Layout();
    const [forest, ...w] = chain(layout, ["depot-forest", S, S, S, S]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(forest, 0));
    const sw = appendPiece(layout, "switch", false, connectorRef(w[3], 1), 0);
    const [mill] = chain(layout, ["depot-sawmill"], connectorRef(sw, 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(mill, 1));
    chain(layout, [S], connectorRef(sw, 2));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const f = economy.addDepot("forest", forest);
    const m = economy.addDepot("sawmill", mill);
    const placed = sim.addTrain(cars, { pieceId: w[1], pathIndex: 0, reversed: false, s: 100 });
    if (placed.kind !== "placed") throw new Error("no room");
    const engine = sim.getTrain(placed.trainId)!.cars[0].id;
    editLine(economy, engine, (st) => st.push({ depotId: f.id, action: "auto" }, { depotId: m.id, action: "auto" }));
    sim.setLever(engine, 1);
    const ctx: SituationContext = { learned: null, nameOf: (id) => (id === m.id ? "the sawmill" : "the forest"), now: 0 };
    let said = null as ReturnType<typeof TOO_LONG.look>;
    let onPoints = 0;
    let delivered = 0;
    let was = false;
    let shortened = 0;
    let stillSaid = false;
    const visits: number[] = [];
    for (let k = 0; k < 900 * SIM_HZ; k++) {
      // (The forest kept stocked and the mill emptied, so the line always has a load: shortcut.)
      if (k % SIM_HZ === 0) {
        economy.depot(f.id)!.piles[CARGO.log.index] = 12;
        economy.depot(m.id)!.piles.fill(0);
      }
      sim.tick();
      economy.tick();
      for (const ev of economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === m.id) delivered++;
      const on = !!economy.standsOnPoints(placed.trainId);
      if (on && !was) visits.push(Math.round(k / SIM_HZ));
      if (!on && was) visits.push(-Math.round(k / SIM_HZ));
      was = on;
      if (on) onPoints++;
      // (Looked at as the tracker does: every 2 game s.)
      if (k % (2 * SIM_HZ) === 0) {
        ctx.now = k / SIM_HZ;
        const now = TOO_LONG.look(world(layout, sim, economy), ctx);
        said ??= now;
        if (shortened && now) stillSaid = true;
        // (Said, and the train standing at the forest: its last wagon uncoupled and put back in the box, as its card does.)
        if (shorten && said && !shortened) {
          const t = sim.findCar(engine)!.train;
          if (Math.abs(t.speed) < 1 && !economy.standsOnPoints(t.id)) {
            const last = t.cars[t.cars.length - 1].id === engine ? t.cars[0].id : t.cars[t.cars.length - 1].id;
            const r = sim.decouple(last);
            if (r.kind === "decoupled") {
              sim.removeTrain(sim.findCar(last)!.train.id);
              shortened = k / SIM_HZ;
            }
          }
        }
      }
    }
    return { said, onPoints, delivered, visits, shortened, stillSaid };
  }

  it("a train longer than the yard, worked with its tail on the points: said; one that fits isn't", () => {
    const long = yard(["engine", "timber", "timber", "timber", "timber"]);
    expect(long.onPoints, `its tail on the points while worked (${long.delivered} delivered)`).toBeGreaterThan(0);
    expect(long.visits.length, JSON.stringify(long)).toBeGreaterThan(2);
    expect(long.said?.title).toBe("Too long for the sawmill's yard");
    expect(long.said?.text).toMatch(/tail on the points while it's worked at the sawmill.*Take a car off, or add a second track\./);
    const fits = yard(["engine", "timber"]);
    expect(fits.onPoints).toBe(0);
    expect(fits.delivered, "it works the line").toBeGreaterThan(2);
    expect(fits.said).toBeNull();
  });

  it("said, and a car taken off: not said again (the player's fix clears it at once)", () => {
    const r = yard(["engine", "timber", "timber", "timber"], true);
    expect(r.said).not.toBeNull();
    expect(r.shortened, "a wagon taken off").toBeGreaterThan(0);
    expect(r.stillSaid).toBe(false);
  });
});
