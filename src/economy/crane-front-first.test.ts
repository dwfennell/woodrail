import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { Layout, type PieceTypeId } from "../track";
import { CARGO } from "./cargo";
import { Economy, type DepotState } from "./economy";
import { planTracks, tracksAfter } from "../game/depot-tracks";

/**
 * Two trains nose to tail on one track at a depot: the crane fills the front one first (furthest on in its direction),
 * so it can leave and the one behind move up (feedback: "I'd like the front train to get loaded first, it seems to do
 * both"). Trains on a depot's different tracks are still served in turn (depot-tracks.test.ts).
 */
function line(before = 4, after = 4) {
  const layout = new Layout();
  const types: PieceTypeId[] = [...Array(before).fill("straight-216"), "depot-mill", ...Array(after).fill("straight-216")];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const mill = economy.addDepot("mill", ids[before]);
  const step = () => {
    sim.tick();
    economy.tick();
  };
  return { layout, sim, economy, ids, mill, millAt: before, step };
}
type W = ReturnType<typeof line>;
function put(w: W, pieceId: number, kinds: CarKind[], s: number): Train {
  const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(`no room: ${r.kind}`);
  const t = w.sim.getTrain(r.trainId) as Train;
  w.sim.setLever(t.cars[0].id, 1);
  return t;
}
const sec = (n: number) => Math.round(n * SIM_HZ);
const flour = (w: W, t: Train) => t.cars.filter((c) => c.kind === "van").reduce((n, c) => n + w.economy.cargoOf(c.id).count, 0);

/** Each tick, which train the crane moved a unit for (flour onto a van, or anything off a wagon): "a", "b" or "". */
function watch(w: W, a: Train, b: Train) {
  const sum = (t: Train) => t.cars.reduce((n, c) => n + w.economy.cargoOf(c.id).count, 0);
  let wasA = sum(a);
  let wasB = sum(b);
  return () => {
    const na = sum(a);
    const nb = sum(b);
    const who = na !== wasA ? "a" : nb !== wasB ? "b" : "";
    wasA = na;
    wasB = nb;
    return who;
  };
}
const onMill = (w: W, t: Train) => t.bogies.some((x) => x.pieceId === w.ids[w.millAt]);

describe("crane: front train first", () => {
  it("two trains on one track: the front one is filled before the one behind gets any", () => {
    const w = line();
    // Waiting for a full load as the mill makes flour (a trickle): today's crane shared it out between the two.
    w.mill.waitFull = true;
    w.mill.piles[CARGO.flour.index] = 0;
    w.mill.piles[CARGO.grain.index] = 40;
    const full = 2 * w.economy.wagonCapacity;
    const a = put(w, w.ids[w.millAt], ["engine", "van", "van"], 150);
    const b = put(w, w.ids[w.millAt - 1], ["engine", "van", "van"], 30);
    const who = watch(w, a, b);
    const order: string[] = [];
    let aLeft = -1;
    for (let i = 0; i < sec(240); i++) {
      w.step();
      const k = who();
      if (k) order.push(k);
      if (aLeft === -1 && !onMill(w, a)) aLeft = i;
      expect(a.derailed || b.derailed).toBe(false);
      // While the front train is still being filled, the one behind gets nothing.
      if (flour(w, a) < full) expect(flour(w, b)).toBe(0);
    }
    expect(aLeft).toBeGreaterThan(0);
    expect(flour(w, a)).toBe(full);
    expect(flour(w, b)).toBe(full);
    // Every one of a's units, then every one of b's: no back and forth.
    expect(order.join("")).toBe("a".repeat(full) + "b".repeat(full));
  });

  it("the front train waiting for a full load leaves (Leave now): the one behind moves up and fills", () => {
    const w = line();
    w.mill.waitFull = true;
    // Slow: a few units now, and grain to make more (so the front one waits for them).
    w.mill.piles[CARGO.flour.index] = 3;
    w.mill.piles[CARGO.grain.index] = 40;
    const a = put(w, w.ids[w.millAt], ["engine", "van", "van"], 150);
    const b = put(w, w.ids[w.millAt - 1], ["engine", "van", "van"], 30);
    for (let i = 0; i < sec(20); i++) w.step();
    // The front one stands waiting to fill; the one behind has had none.
    expect(w.economy.waitingToFill(a.id)).not.toBeNull();
    expect(flour(w, a)).toBeGreaterThanOrEqual(3);
    expect(flour(w, b)).toBe(0);
    const bAt = b.bogies[0].s + (b.bogies[0].pieceId === w.ids[w.millAt] ? 216 : 0);
    expect(w.economy.leaveNow(a.id)).toBe(true);
    w.mill.piles[CARGO.flour.index] = 40;
    let left = -1;
    for (let i = 0; i < sec(90); i++) {
      w.step();
      if (left === -1 && !onMill(w, a)) left = i;
      expect(a.derailed || b.derailed).toBe(false);
    }
    expect(left).toBeGreaterThanOrEqual(0);
    // b moved up (its engine further on than where it stood) and was filled.
    expect(flour(w, b)).toBe(2 * w.economy.wagonCapacity);
    const bNow = w.sim.getTrain(b.id);
    if (bNow && bNow.bogies[0].pieceId === w.ids[w.millAt - 1]) expect(bNow.bogies[0].s).toBeGreaterThan(bAt);
  });

  it("the front train waiting for a full load: the one behind still unloads the grain it waits on, so it leaves full", () => {
    const w = line();
    w.mill.waitFull = true;
    // A little grain: the mill is working, so the front one waits, but the rest of its flour is in the hoppers behind.
    w.mill.piles[CARGO.flour.index] = 0;
    w.mill.piles[CARGO.grain.index] = 1;
    const full = w.economy.wagonCapacity;
    const a = put(w, w.ids[w.millAt], ["engine", "van"], 200);
    const b = put(w, w.ids[w.millAt - 1], ["engine", "hopper", "hopper"], 150);
    for (const c of b.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", w.economy.wagonCapacity);
    let waited = false;
    /** What the front one had aboard as it left the mill. */
    let leftWith = -1;
    for (let i = 0; i < sec(300); i++) {
      w.step();
      waited ||= w.economy.waitingToFill(a.id) !== null;
      if (leftWith === -1 && !onMill(w, a)) leftWith = flour(w, a);
      expect(a.derailed || b.derailed).toBe(false);
    }
    expect(waited).toBe(true);
    // The grain went onto the mill and became flour, and the front train left full (not with the one unit the mill's
    // own grain made, as it would if the crane wouldn't serve the hoppers behind it).
    expect(b.cars.filter((c) => c.kind === "hopper").every((c) => w.economy.cargoOf(c.id).count === 0)).toBe(true);
    expect(leftWith).toBe(full);
  });

  /** A second track laid as the mill's card does. */
  function twoTracks(w: W): number {
    const plan = planTracks(w, w.mill, () => null);
    if (typeof plan === "string") throw new Error(plan);
    for (const id of plan.covers) w.layout.removePiece(id);
    const ids = plan.pieces.map((p) => w.layout.addPiece(p.type, p.pose, p.y, p.flipped));
    const after = tracksAfter(plan, ids);
    w.economy.setTracks(w.mill as DepotState, after.roads, after.ends, after.ladder);
    return w.economy.roadsOf(w.mill.id)[0].pieceId;
  }

  it("two trains on a depot's separate tracks: still served in turn, back and forth (unchanged)", () => {
    const w = line();
    const road = twoTracks(w);
    w.mill.piles[CARGO.flour.index] = 40;
    const a = put(w, w.ids[w.millAt], ["engine", "van", "van"], 200);
    const b = put(w, road, ["engine", "van", "van"], 200);
    const who = watch(w, a, b);
    const order: string[] = [];
    for (let i = 0; i < sec(120); i++) {
      w.step();
      const k = who();
      if (k) order.push(k);
    }
    const full = 2 * w.economy.wagonCapacity;
    expect(flour(w, a)).toBe(full);
    expect(flour(w, b)).toBe(full);
    expect(order.filter((x, i) => i > 0 && x !== order[i - 1]).length).toBeGreaterThanOrEqual(4);
  });

  it("two trains nose to tail on a depot's own track and one on its second: all three filled (none starved)", () => {
    const w = line(6, 4);
    const road = twoTracks(w);
    w.mill.waitFull = true;
    w.mill.piles[CARGO.flour.index] = 2;
    w.mill.piles[CARGO.grain.index] = 60;
    // Both on the mill's own track, b's engine just behind a's van.
    const a = put(w, w.ids[w.millAt], ["engine", "van"], 214);
    const b = put(w, w.ids[w.millAt], ["engine", "van"], 40);
    const c = put(w, road, ["engine", "van"], 200);
    const full = w.economy.wagonCapacity;
    let bBeforeA = false;
    let together = false;
    for (let i = 0; i < sec(600); i++) {
      w.step();
      if (flour(w, a) < full && flour(w, b) > 0) bBeforeA = true;
      together ||= onMill(w, a) && onMill(w, b) && w.economy.servingDepot(b.id) !== undefined;
      expect(a.derailed || b.derailed || c.derailed).toBe(false);
    }
    // b did stand behind a at the mill, and wasn't served first.
    expect(together).toBe(true);
    expect(bBeforeA).toBe(false);
    for (const t of [a, b, c]) expect(flour(w, t)).toBe(full);
  });
});
