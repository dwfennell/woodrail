import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine } from "../game/lines";
import { Economy } from "./economy";

/**
 * Routing step 7, e2e `hand-wait`'s layout: a trunk from a forest into points, their straight road past a sawmill, their
 * curve to another. A routed train of logs on the trunk just short of the points, its route for the curve's sawmill; a
 * hand-run engine on the straight road beyond, facing them. Both started together: the routed train is there first, so
 * the points are thrown for it and the hand-run engine waits short of them, then goes on up the trunk as they lie.
 *
 * Whatever came before. Here both stand a while (`before` ticks) before the route is planned and they're started; once,
 * routed trains' looks and hand-run ones' were counted apart (the one with a routed train about, the other with two
 * trains), and that left them out of step: a hand-run look a few ticks before the routed train's first locked the points as they lay, it ran up the trunk into the routed
 * train, and both were stuck, each in the other's way (e2e `hand-wait` in the full run, about half of all phases).
 */
function run(before: number) {
  const layout = new Layout();
  const trunk = [layout.addPiece("depot-forest", { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let k = 0; k < 6; k++) trunk.push(appendPiece(layout, "straight-216", false, connectorRef(trunk[trunk.length - 1], 1)));
  const points = appendPiece(layout, "switch", false, connectorRef(trunk[trunk.length - 1], 1), 0);
  const road = (from: number, types: [PieceTypeId, boolean][]) => {
    const ids: number[] = [];
    for (const [t, flip] of types) ids.push(appendPiece(layout, t, flip, ids.length ? connectorRef(ids[ids.length - 1], 1) : from));
    return ids;
  };
  const a = road(connectorRef(points, 1), [["straight-216", false], ["depot-sawmill", false], ["straight-216", false]]);
  const b = road(connectorRef(points, 2), [["curve-large", true], ["straight-216", false], ["depot-sawmill", false], ["straight-216", false]]);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const forest = economy.addDepot("forest", trunk[0], 0).id;
  economy.addDepot("sawmill", a[1], 0);
  const mill = economy.addDepot("sawmill", b[2], 0).id;
  const put = (cars: CarKind[], pieceId: number, s: number, reversed: boolean) => {
    const placed = sim.addTrain(cars, { pieceId, pathIndex: 0, s, reversed });
    if (placed.kind !== "placed") throw new Error("no room");
    const t = sim.getTrain(placed.trainId)!;
    for (const c of t.cars) if (c.kind === "timber") economy.setCargo(c.id, "log", 5);
    sim.setLever(t.cars[0].id, 0);
    return t.cars[0].id;
  };
  const tick = () => (sim.tick(), economy.tick());
  const routed = put(["engine", "timber", "timber", "timber"], trunk[6], 200, false);
  const hand = put(["engine"], a[0], 150, true);
  for (let i = 0; i < before; i++) tick();
  editLine(economy, routed, (s) => s.push({ depotId: mill, action: "auto" }, { depotId: forest, action: "auto" }));
  sim.setLever(hand, 1);
  sim.setLever(routed, 1);
  const def = economy.router.defaultOf(points);
  const o = { stood: 0, overSet: 0, goods: 0, wentUp: false, stuck: false };
  // (Till the logs are in and the engine is up the trunk: beyond, the two come back along the one trunk and meet head on,
  // no loop there, as the e2e's run doesn't go on to.)
  for (let i = 0; i < 90 * SIM_HZ && !(o.goods >= 1 && o.wentUp); i++) {
    tick();
    for (const ev of economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === mill) o.goods++;
    const t = sim.findCar(hand)!.train;
    const wait = economy.router.waitOf(hand);
    if (wait?.kind === "points" && wait.pieceId === points && wait.by === routed && t.speed === 0) o.stood++;
    if (t.bogies.some((x) => x.pieceId === points) && layout.switchState(points) !== def) o.overSet++;
    if (trunk.includes(t.bogies[0].pieceId)) o.wentUp = true;
    if (economy.stalls.stuckOf(hand) || economy.stalls.stuckOf(routed)) o.stuck = true;
  }
  return o;
}

describe("a hand-run engine meets a routed train starting at points (routing step 7)", () => {
  // (Every phase of the router's looks (8 ticks) and sections' checks (12, and 3).)
  it.each(Array.from({ length: 24 }, (_, k) => k))("the routed train there first, after %i ticks: it goes, the hand-run one waits, then both go", (before) => {
    const o = run(before);
    expect(o.stuck).toBe(false);
    expect(o.stood).toBeGreaterThanOrEqual(SIM_HZ);
    expect(o.overSet).toBe(0);
    expect(o.wentUp).toBe(true);
    expect(o.goods).toBeGreaterThanOrEqual(1);
  });
});
