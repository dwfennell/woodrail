import { describe, expect, it } from "vitest";
import { CARGO, Economy } from "../economy";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { placeOn } from "../props/kinds";
import { checkProp, TrackIndex, type Footprint } from "../props/placement";
import { PropStore } from "../props/store";
import { ENGINE_SPEED, Sim } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { topSpeed } from "./engines";
import { updateRates } from "./industries";
import { canPower, planPower, POWERED_RATE, powerOf, sharePower, STATION_SPARKS, WIND_TURBINE } from "./power";
import { buildStarterWorld, type World } from "./world";

describe("sharing the sparks out", () => {
  it("a power station with coal makes 4, a turbine 1; engines first (oldest first), then yards in the order asked", () => {
    const p = sharePower(1, 2, [7, 3], [10, 11, 12, 13, 14]);
    expect(p.made).toBe(STATION_SPARKS + 2);
    expect([p.fromCoal, p.fromWind]).toEqual([4, 2]);
    expect([...p.enginesOn]).toEqual([7, 3]);
    expect([...p.yardsOn]).toEqual([10, 11, 12, 13]);
    expect([p.used, p.spare]).toEqual([6, 0]);
  });

  it("short of sparks: the engines asked last go without, and the yards get none", () => {
    const p = sharePower(0, 2, [1, 2, 3], [9]);
    expect([...p.enginesOn]).toEqual([1, 2]);
    expect(p.yardsOn.size).toBe(0);
    expect(p.spare).toBe(0);
  });

  it("spare sparks are counted", () => {
    expect(sharePower(1, 0, [], [5]).spare).toBe(3);
  });

  it("only yards that make something can be powered", () => {
    for (const role of ["sawmill", "forest", "mill", "foundry", "mine", "bakery", "carworks"] as const) expect(canPower({ role }), role).toBe(true);
    for (const role of ["power", "town", "school", "warehouse", "harbour", "workshop"] as const) expect(canPower({ role }), role).toBe(false);
  });
});

/** A line of track, a power station off it, and an economy. */
function line() {
  const layout = new Layout();
  let last = layout.addPiece("straight-216", { x: 0, z: 0, heading: 0 });
  for (let i = 0; i < 8; i++) last = appendPiece(layout, "straight-216", false, connectorRef(last, 1));
  const powerPiece = layout.addPiece("depot-power", { x: 0, z: 800, heading: 0 });
  const sawPiece = layout.addPiece("depot-sawmill", { x: 0, z: 1600, heading: 0 });
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const power = economy.addDepot("power", powerPiece);
  const saw = economy.addDepot("sawmill", sawPiece);
  const props = new PropStore();
  const w = { layout, sim, economy, props } as unknown as World;
  const electric = (s: number): number => {
    const placed = sim.addTrain(["engine"], { pieceId: last, pathIndex: 0, reversed: false, s });
    if (placed.kind !== "placed") throw new Error("no room");
    const car = sim.getTrain(placed.trainId)!.cars[0];
    sim.setLook(car.id, "electric");
    return placed.trainId;
  };
  return { w, sim, economy, power, saw, props, electric, last };
}

describe("the power grid", () => {
  it("counts the map: coal at a power station, turbines standing, electric engines", () => {
    const { w, power, props, electric } = line();
    electric(150);
    expect(planPower(w).made).toBe(0);
    power.piles[CARGO.coal.index] = 1;
    props.add(WIND_TURBINE, { x: 5000, z: 5000, heading: 0, y: 64 });
    const p = planPower(w);
    expect([p.stations, p.turbines, p.made, p.engines.length, p.enginesOn.size, p.spare]).toEqual([1, 1, 5, 1, 1, 4]);
  });

  it("keeps its plan until something it counts changes (its version says when)", () => {
    const { w, power } = line();
    const grid = powerOf(w);
    const v = grid.version;
    grid.refresh(w);
    expect(grid.version).toBe(v);
    power.piles[CARGO.coal.index] = 1;
    grid.refresh(w);
    expect(grid.version).toBe(v + 1);
    expect(grid.current.made).toBe(STATION_SPARKS);
  });

  it("an electric engine without a spark runs at steam speed, never stopped; one put on later is counted in at once", () => {
    const { w, sim, power, props, electric } = line();
    props.add(WIND_TURBINE, { x: 5000, z: 5000, heading: 0, y: 64 });
    const first = sim.getTrain(electric(150))!;
    // (The one turbine's spark goes to it.)
    expect(topSpeed(w, first)).toBeCloseTo(ENGINE_SPEED * 1.4);
    const second = sim.getTrain(electric(700))!;
    expect(topSpeed(w, second)).toBeCloseTo(ENGINE_SPEED);
    expect(topSpeed(w, first)).toBeCloseTo(ENGINE_SPEED * 1.4);
    // Coal comes: four more sparks, and both run fast.
    power.piles[CARGO.coal.index] = 1;
    powerOf(w).refresh(w);
    expect(topSpeed(w, second)).toBeCloseTo(ENGINE_SPEED * 1.4);
  });

  it("a yard asked for gets a spare spark, and works 1.5× as fast; asked to stop, back to its own speed", () => {
    const { w, power, saw } = line();
    power.piles[CARGO.coal.index] = 1;
    const grid = powerOf(w);
    grid.ask(w, saw, true);
    expect(saw.powerAsk).toBeGreaterThan(0);
    expect(grid.yardOn(saw.id)).toBe(true);
    const world = { ...w, depots: new Map(), landscape: buildStarterWorld().landscape } as unknown as World;
    updateRates(world, (_role, d) => (grid.yardOn(d.id) ? POWERED_RATE : 1));
    expect(saw.rate).toBeCloseTo(POWERED_RATE, 5);
    grid.ask(w, saw, false);
    expect([saw.powerAsk, grid.yardOn(saw.id)]).toEqual([0, false]);
  });

  it("a yard asked for with no spark spare waits for one", () => {
    const { w, saw } = line();
    const grid = powerOf(w);
    grid.ask(w, saw, true);
    expect([grid.current.yards, grid.yardOn(saw.id)]).toEqual([[saw.id], false]);
  });
});

describe("wind turbines", () => {
  const FP: Footprint = { cx: 0, cz: 0, hw: 20, hd: 20 };
  it("stand only on a hill's top", () => {
    expect(placeOn(WIND_TURBINE)).toBe("hill");
    const w = buildStarterWorld();
    const g = w.landscape.grid;
    const ctx = { land: w.landscape, track: new TrackIndex(w.layout), props: new PropStore(), footprint: () => FP };
    let low: { x: number; z: number } | null = null;
    let high: { x: number; z: number } | null = null;
    g.forEachCell((i, col, row) => {
      if (g.feature[i] !== 0 || g.surface[i] === undefined) return;
      const at = { x: g.centreX(col), z: g.centreZ(row) };
      const clear = checkProp(ctx, FP, { ...at, heading: 0 }, "land").kind === "clear";
      if (!clear) return;
      if (g.height[i] === 0) low ??= at;
      else high ??= at;
    });
    expect(low && high).toBeTruthy();
    expect(checkProp(ctx, FP, { ...low!, heading: 0 }, "hill")).toEqual({ kind: "blocked", reason: "low" });
    expect(checkProp(ctx, FP, { ...high!, heading: 0 }, "hill")).toMatchObject({ kind: "clear" });
  });
});

describe("the save", () => {
  it("keeps which yards were asked to be powered, and in what order", () => {
    const w = buildStarterWorld();
    const ds = w.economy.allDepots().filter((d) => canPower(d));
    expect(ds.length).toBeGreaterThanOrEqual(2);
    ds[0].powerAsk = 2;
    ds[1].powerAsk = 1;
    const r = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (!r.ok) throw new Error(r.error);
    const back = r.value.economy.allDepots();
    expect(back[ds[0].id].powerAsk).toBe(2);
    expect(back[ds[1].id].powerAsk).toBe(1);
    expect(back.filter((d) => d.powerAsk > 0)).toHaveLength(2);
  });
});
