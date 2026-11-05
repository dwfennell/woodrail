import { describe, expect, it } from "vitest";
import { CARGO } from "../economy";
import { SURF_RIVER } from "../landscape";
import { BARGE_LOADS, BOAT_SPEED, DOCK_SECONDS, Fleet, landingWhy, MAX_BARGES, waterAt, waterPath } from "./boats";
import { siteWhy } from "./industries";
import { Progress } from "./progress";
import { buildStarterWorld, syncIndustries, type World } from "./world";

/**
 * A straight stretch of river along x (river squares from `x - 3` to `x + 3` squares, land both sides): its middle,
 * where landings can stand on either bank. Found on the starter map.
 */
function riverRun(w: World): { x: number; z: number }[] {
  const g = w.landscape.grid;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < g.cellCount; i++) {
    if (g.surface[i] !== SURF_RIVER) continue;
    const c = g.colOf(i);
    const r = g.rowOf(i);
    const at = (dc: number, dr: number) => g.surface[g.index(c + dc, r + dr)] ?? -1;
    let run = true;
    for (let k = -4; k <= 4; k++) if (at(k, 0) !== SURF_RIVER || at(k, -2) === SURF_RIVER || at(k, 2) === SURF_RIVER) run = false;
    if (run) out.push({ x: g.centreX(c), z: g.centreZ(r) });
  }
  return out;
}

/** A landing on the −z bank of the river at `p` (its jetty out over the water), its economy depot's id. */
function landingAt(w: World, p: { x: number; z: number }, dx = 0): number {
  const pose = { x: p.x - 120 + dx, z: p.z - 100, heading: 0 };
  expect(landingWhy(w.landscape, pose), "the jetty over the water").toBeNull();
  const id = w.layout.addPiece("kit-landing", pose, 0);
  syncIndustries(w, true);
  return w.economy.depotAtPiece(id)!.id;
}

function setup() {
  const w = buildStarterWorld();
  const runs = riverRun(w);
  expect(runs.length, "a straight run of river on the starter map").toBeGreaterThan(0);
  // Two landings far apart on the same water.
  const a = runs[0];
  const b = runs.reduce((best, r) => (waterAt(w.landscape, r) === waterAt(w.landscape, a) && Math.hypot(r.x - a.x, r.z - a.z) > Math.hypot(best.x - a.x, best.z - a.z) ? r : best), a);
  const progress = new Progress();
  progress.coins = 500;
  const fleet = new Fleet(() => w);
  return { w, a, b, progress, fleet, A: landingAt(w, a), B: landingAt(w, b) };
}

describe("river landings", () => {
  it("stand on a bank with their jetty over the water, and say why not on dry land", () => {
    const w = buildStarterWorld();
    const [p] = riverRun(w);
    expect(siteWhy(w.landscape, "kit-landing", { x: p.x - 120, z: p.z - 100, heading: 0 })).toBeNull();
    expect(siteWhy(w.landscape, "kit-landing", { x: p.x - 120, z: p.z - 600, heading: 0 })).toMatch(/jetty out over the water/);
  });
});

describe("boats", () => {
  it("are launched at a dock with one barge, waiting there, their route that one stop", () => {
    const { A, fleet } = setup();
    const b = fleet.launch(A)!;
    expect([b.barges, b.stops.map((s) => s.depotId), b.docked, b.home]).toEqual([1, [A], true, A]);
    expect(MAX_BARGES).toBe(3);
  });

  it("find their way by water between landings, and only to docks on the same water", () => {
    const { w, a, b, A, B, fleet } = setup();
    const way = waterPath(w.landscape, a, b)!;
    expect(way.length).toBeGreaterThan(2);
    for (const p of way.slice(1, -1)) expect(waterAt(w.landscape, p), "every point of the way on the water").not.toBe(-1);
    const boat = fleet.launch(A)!;
    expect(fleet.addStop(boat.id, B)).toBeNull();
    // A station is no dock.
    const station = w.economy.depotAtPiece(w.stations.get(w.landscape.towns[0].id)!)!.id;
    expect(fleet.addStop(boat.id, station)).toMatch(/landings and harbours/);
    expect(boat.stops.map((s) => s.depotId)).toEqual([A, B]);
  });

  it("carry logs down the river: picked up at one landing, dropped at the other, by the clock", () => {
    const { w, A, B, fleet } = setup();
    const from = w.economy.depot(A)!;
    const to = w.economy.depot(B)!;
    from.piles[CARGO.log.index] = 10;
    const boat = fleet.launch(A)!;
    boat.barges++;
    fleet.addStop(boat.id, B);
    expect(boat.stops.map((s) => s.action)).toEqual(["pick", "drop"]);
    // (Picking up happens on arriving: it was bought there, so it takes its first load when it next calls. Serve it now
    // as its first call, as the game does when it's bought: see `Fleet.serve`.)
    fleet.serve(boat, boat.stops[0]);
    expect(boat.load.log).toBe(2 * BARGE_LOADS);
    expect(from.piles[CARGO.log.index]).toBe(10 - 2 * BARGE_LOADS);
    // Ties up for its time at the dock, then sails, and gets there after its way's length at its speed.
    const length = fleet.wayBetween(A, B).length;
    let ticks = 0;
    let docked = false;
    while (!docked && ticks < 2000) {
      docked = fleet.tick(1).some((e) => e.kind === "docked" && e.depotId === B);
      ticks++;
    }
    expect(docked).toBe(true);
    expect(ticks).toBeGreaterThanOrEqual(DOCK_SECONDS + Math.floor(length / BOAT_SPEED));
    expect(ticks).toBeLessThanOrEqual(DOCK_SECONDS + Math.ceil(length / BOAT_SPEED) + 1);
    expect(to.piles[CARGO.log.index]).toBe(2 * BARGE_LOADS);
    expect(boat.load.log ?? 0).toBe(0);
    expect(w.economy.boatDelivered).toBe(2 * BARGE_LOADS);
  });

  it("carry only bulk goods: planks stay on the jetty", () => {
    const { w, A, fleet } = setup();
    const from = w.economy.depot(A)!;
    from.piles[CARGO.planks.index] = 5;
    from.piles[CARGO.stone.index] = 2;
    const boat = fleet.launch(A)!;
    fleet.serve(boat, boat.stops[0]);
    expect(boat.load).toEqual({ stone: 2 });
    expect(from.piles[CARGO.planks.index]).toBe(5);
  });

  it("stop where they are when stopped, and hold still with no time passing (a paused game)", () => {
    const { A, B, fleet } = setup();
    const boat = fleet.launch(A)!;
    fleet.addStop(boat.id, B);
    for (let i = 0; i < DOCK_SECONDS + 5; i++) fleet.tick(1);
    expect(boat.docked).toBe(false);
    const at = fleet.where(boat)!;
    boat.going = false;
    for (let i = 0; i < 20; i++) fleet.tick(1);
    expect(fleet.where(boat)).toEqual(at);
    boat.going = true;
    fleet.tick(0);
    expect(fleet.where(boat)).toEqual(at);
  });

  it("drop a landing taken up from their route, and go when no dock is left", () => {
    const { w, A, B, fleet } = setup();
    const boat = fleet.launch(A)!;
    fleet.addStop(boat.id, B);
    w.layout.removePiece(w.economy.depot(B)!.pieceId);
    fleet.tick(1);
    expect(boat.stops.map((s) => s.depotId)).toEqual([A]);
    w.layout.removePiece(w.economy.depot(A)!.pieceId);
    fleet.tick(1);
    expect(w.economy.boats.size).toBe(0);
  });

  it("are scrapped from their card: gone, with what they carried", () => {
    const { w, A, fleet } = setup();
    const boat = fleet.launch(A)!;
    fleet.scrap(boat.id);
    expect(w.economy.boats.size).toBe(0);
  });
});

describe("boats in a save", () => {
  it("come back where they were: their route, barges, load and how far they'd sailed", async () => {
    const { deserializeWorld, serializeWorld } = await import("../persist/save");
    const { w, A, B, fleet } = setup();
    w.economy.depot(A)!.piles[CARGO.coal.index] = 3;
    const boat = fleet.launch(A)!;
    boat.barges++;
    fleet.addStop(boat.id, B);
    fleet.serve(boat, boat.stops[0]);
    for (let i = 0; i < DOCK_SECONDS + 4; i++) fleet.tick(1);
    expect(boat.docked).toBe(false);
    const data = JSON.parse(JSON.stringify(serializeWorld(w)));
    const back = deserializeWorld(data);
    expect(back.ok).toBe(true);
    const w2 = back.ok ? back.value : w;
    const [b2] = [...w2.economy.boats.values()];
    expect({ name: b2.name, barges: b2.barges, load: b2.load, stops: b2.stops, docked: b2.docked, t: b2.t }).toEqual({ name: boat.name, barges: 2, load: { coal: 3 }, stops: boat.stops, docked: false, t: boat.t });
    expect(new Fleet(() => w2).where(b2)).toEqual(fleet.where(boat));
  });
});
