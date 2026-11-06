/**
 * Why a routed train won't pick up a good at the stop it's heading for (`Economy.notLoadingAt`), said on its engine
 * card (`notLoadingText`). The user, 2026-11-06: a train on a sawmill → workshop → school line passed the sawmill empty,
 * "On its way to the sawmill 1", and nothing said why (the workshop had all the planks it could hold). Each reason comes
 * from the rule that decides it: a later stop with no room (`roomAhead`), no wagon for the good, none at the place.
 */
import { describe, expect, it } from "vitest";
import { CARGO } from "./cargo";
import { capAt, Economy } from "./economy";
import { Sim, type CarKind } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { engineView } from "../game/engine-status";
import { notLoadingText } from "../game/workshop-text";

/** Along +x: two straights (the train, heading +x), the sawmill, a straight, the workshop, two straights. */
function line(cars: CarKind[] = ["engine", "timber", "timber"]) {
  const layout = new Layout();
  const types: PieceTypeId[] = ["straight-216", "straight-216", "depot-sawmill", "straight-216", "depot-workshop", "straight-216", "straight-216"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const placed = sim.addTrain(cars, { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  const economy = new Economy(layout, sim);
  const sawmill = economy.addDepot("sawmill", ids[2]);
  const workshop = economy.addDepot("workshop", ids[4]);
  const train = sim.getTrain(placed.trainId)!;
  const engine = train.cars[0].id;
  economy.setRoute(engine, { stops: [{ depotId: sawmill.id, action: "auto" }, { depotId: workshop.id, action: "auto" }], next: 0 });
  sawmill.piles[CARGO.planks.index] = 6;
  const names: Record<number, string> = { [sawmill.id]: "the sawmill", [workshop.id]: "the workshop" };
  const said = () => engineView(sim, economy, engine, (id) => names[id]).status;
  return { sim, economy, sawmill, workshop, train, engine, said };
}

describe("why a routed train won't load at its next stop (the engine card)", () => {
  it("loads, and says nothing, while the workshop has room for planks", () => {
    const w = line();
    expect(w.economy.notLoadingAt(w.train.id)).toBeNull();
    expect(w.said()).not.toMatch(/^Not loading|^No planks/);
  });

  it("the workshop full: not loading planks at the sawmill, and it says so", () => {
    const w = line();
    w.workshop.piles[CARGO.planks.index] = capAt(w.workshop);
    const not = w.economy.notLoadingAt(w.train.id);
    expect(not).toMatchObject({ kind: "planks", why: "no-room", takerFull: true });
    expect(not?.depot.id).toBe(w.sawmill.id);
    expect(not?.taker?.id).toBe(w.workshop.id);
    expect(w.said()).toBe("Not loading planks at the sawmill: the workshop is full");
  });

  it("heading for the workshop first (past the sawmill), it's the sawmill it says", () => {
    const w = line();
    w.workshop.piles[CARGO.planks.index] = capAt(w.workshop);
    const r = w.economy.routeOf(w.engine)!;
    w.economy.setRoute(w.engine, { ...r, next: 1 });
    expect(w.said()).toBe("Not loading planks at the sawmill: the workshop is full");
  });

  it("…and it's the rule itself: run on, the train passes the sawmill without a plank", () => {
    const w = line();
    w.workshop.piles[CARGO.planks.index] = capAt(w.workshop);
    w.sim.setLever(w.engine, 1);
    for (let i = 0; i < 12 * 120; i++) {
      w.sim.tick();
      w.economy.tick();
      // (The workshop kept full: it's what's being said.)
      w.workshop.piles[CARGO.planks.index] = capAt(w.workshop);
    }
    expect(w.train.cars.every((c) => w.economy.cargoOf(c.id).count === 0)).toBe(true);
    expect(w.sawmill.piles[CARGO.planks.index]).toBe(6);
  });

  it("no wagon for planks (a hopper train): says what carries them; an engine alone isn't told", () => {
    expect(line(["engine"]).economy.notLoadingAt(line(["engine"]).train.id)).toBeNull();
    const w = line(["engine", "hopper"]);
    expect(w.economy.notLoadingAt(w.train.id)).toMatchObject({ kind: "planks", why: "no-wagon" });
    expect(w.said()).toBe("Not loading planks at the sawmill: they go on a flatbed. Add one to this train");
  });

  it("none at the sawmill, and none being made: says there are none yet", () => {
    const w = line();
    w.sawmill.piles.fill(0);
    expect(w.economy.notLoadingAt(w.train.id)).toMatchObject({ kind: "planks", why: "none" });
    expect(w.said()).toBe("No planks to load at the sawmill yet");
  });

  it("says nothing at a stop set to Only drop, or with no route", () => {
    const w = line();
    w.workshop.piles[CARGO.planks.index] = capAt(w.workshop);
    const r = w.economy.routeOf(w.engine)!;
    w.economy.setRoute(w.engine, { ...r, stops: [{ ...r.stops[0], action: "drop" }, r.stops[1]] });
    expect(w.economy.notLoadingAt(w.train.id)).toBeNull();
    w.economy.setRoute(w.engine, null);
    expect(w.economy.notLoadingAt(w.train.id)).toBeNull();
  });

  it("the words for a taker that doesn't need any yet, and with no taker named", () => {
    expect(notLoadingText("no-room", "planks", "the sawmill", "the workshop", false)).toBe("Not loading planks at the sawmill: the workshop doesn't need any yet");
    expect(notLoadingText("no-room", "planks", "the sawmill")).toBe("Not loading planks at the sawmill: no stop after it has room");
    expect(notLoadingText("no-wagon", "milk", "the dairy")).toBe("Not loading milk at the dairy: it goes on a milk tank. Add one to this train");
  });
});
