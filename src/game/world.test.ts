import { describe, expect, it, vi } from "vitest";
import { checkPlacement, connectedPairs, PLOT_ROWS, PLOT_WIDTH } from "../landscape";
import { SIM_DT } from "../sim";
import { appendPiece, connectorRef } from "../track";
import { buildStarterWorld, createWorld, freshGameWorld, landForSale, STARTER_SEED, plotsAround, plotsForSale, unlockPlot, type World, fixedPieces } from "./world";

describe("createWorld", () => {
  it("places one station piece per town at the town's station pose", () => {
    const w = createWorld(123);
    expect(w.stations.size).toBe(w.landscape.towns.length);
    for (const town of w.landscape.towns) {
      const p = w.layout.getPiece(w.stations.get(town.id)!)!;
      expect(p.type).toBe("station");
      expect(p.pose).toEqual(town.station);
    }
    expect(w.sim.trainCount).toBe(0);
  });
});

describe("buildStarterWorld", () => {
  it("starts bare: just the towns' stations, the depots and the old sites' stubs, no track and no trains", () => {
    const w = buildStarterWorld();
    const fixed = fixedPieces(w);
    for (const id of w.layout.pieceIds()) expect(fixed.has(id)).toBe(true);
    expect(w.ruins.size).toBe(w.landscape.sites!.length);
    expect(w.layout.pieceCount).toBe(w.landscape.towns.length + w.landscape.depots.length + w.ruins.size);
    for (const d of w.landscape.depots) expect(w.layout.getPiece(w.depots.get(d.id)!)!.type).toBe(d.kind === "forest" ? "depot-forest" : "depot-sawmill");
    expect(w.sim.trainCount).toBe(0);
    expect(connectedPairs(w.layout, w.stations)).toEqual([]);
  });

  it("leaves an easy first job: four long straights join the first two towns, clear of the landscape", () => {
    const w = buildStarterWorld();
    const [a, b] = w.landscape.towns;
    let last = w.stations.get(a.id)!;
    for (let i = 0; i < 4; i++) {
      last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
      const p = w.layout.getPiece(last)!;
      expect(checkPlacement(w.landscape, p.type, p.flipped, p.pose, p.y)).toEqual({ kind: "clear" });
    }
    expect(connectedPairs(w.layout, w.stations)).toContainEqual([a.id, b.id]);
  });
});

describe("stations on the grid", () => {
  it("four long straights join the starter stations exactly", () => {
    const w = buildStarterWorld();
    const [a] = w.landscape.towns;
    let last = w.stations.get(a.id)!;
    // The station's peg end (connector 1) faces the other town.
    for (let i = 0; i < 4; i++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    const joint = w.layout.jointAt(connectorRef(last, 1));
    expect(joint).toBeDefined();
    expect(joint!.posError).toBeLessThan(1e-6);
    expect(joint!.angleError).toBeLessThan(1e-6);
  });
});

describe("adding land", () => {
  it("sells the plots beside the land, and shows those within one of it", () => {
    const w = createWorld(31);
    expect(plotsForSale(w.landscape)).toHaveLength(8);
    expect(plotsAround(w.landscape)).toHaveLength(12);
    expect(unlockPlot(w, 3, 3)).toBeNull();
    expect(unlockPlot(w, 0, 0)).toBeNull();
    expect(unlockPlot(w, 1, 1)).toBeNull();
  });

  it("adds a plot as it was for sale, with stations, depots and economy depots for what it brings", () => {
    const w = createWorld(31);
    const forSale = landForSale(w.landscape, 1, 0);
    const towns = w.landscape.towns.length;
    const depots = w.economy.allDepots().length;
    const bought = unlockPlot(w, 1, 0)!;
    expect(bought.slots).toEqual([4]);
    expect(bought.towns).toHaveLength(forSale.towns.length);
    expect(w.landscape.towns).toHaveLength(towns + forSale.towns.length);
    for (const id of bought.towns) {
      const p = w.layout.getPiece(w.stations.get(id)!)!;
      expect(p.type).toBe("station");
      expect(p.pose).toEqual(w.landscape.towns[id].station);
      expect(w.economy.depotAtPiece(p.id)?.townId).toBe(id);
    }
    for (const id of bought.depots) expect(w.economy.depotAtPiece(w.depots.get(id)!)?.role).toBe(w.landscape.depots[id].kind);
    expect(w.economy.allDepots()).toHaveLength(depots + bought.towns.length + bought.depots.length);
    // Now the plots beyond it are for sale, and it isn't.
    expect(plotsForSale(w.landscape).some((p) => p.px === 2 && p.pz === 0)).toBe(true);
    expect(plotsForSale(w.landscape).some((p) => p.px === 1 && p.pz === 0)).toBe(false);
    expect(unlockPlot(w, 1, 0)).toBeNull();
  });

  /** A run of four long straights along x, on flat open ground, across the edge between plots (0, 0) and (1, 0). */
  function acrossTheEdge(w: World): { x: number; z: number } | null {
    const edge = PLOT_WIDTH;
    for (let row = 4; row < PLOT_ROWS - 4; row++) {
      const z = (row + 0.5) * 72;
      const x = edge - 2 * 216;
      const clear = [0, 1, 2, 3].every((k) => checkPlacement(w.landscape, "straight-216", false, { x: x + k * 216, z, heading: 0 }, 0).kind === "clear");
      if (clear) return { x, z };
    }
    return null;
  }

  it("lets track run across the edge between plots once both are owned, and trains along it", () => {
    let found: { w: World; at: { x: number; z: number } } | null = null;
    for (let seed = 1; seed < 60 && !found; seed++) {
      const w = createWorld(seed);
      // Off the land until the plot is bought.
      expect(checkPlacement(w.landscape, "straight-216", false, { x: PLOT_WIDTH + 100, z: 0, heading: 0 }, 0)).toEqual({ kind: "blocked", reason: "off-mat" });
      unlockPlot(w, 1, 0);
      const at = acrossTheEdge(w);
      if (at) found = { w, at };
    }
    expect(found).not.toBeNull();
    const { w, at } = found!;
    let last = w.layout.addPiece("straight-216", { x: at.x, z: at.z, heading: 0 });
    const first = last;
    for (let k = 1; k < 4; k++) last = appendPiece(w.layout, "straight-216", false, connectorRef(last, 1));
    expect(w.layout.getPiece(last)!.pose.x).toBeCloseTo(at.x + 3 * 216);
    const placed = w.sim.addTrain(["engine", "caboose"], { pieceId: first, pathIndex: 0, reversed: false, s: 150 });
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    const train = w.sim.getTrain(placed.trainId)!;
    w.sim.setLever(train.cars[0].id, 1);
    for (let i = 0; i < 6 / SIM_DT; i++) w.sim.tick();
    // It ran on over the edge into the new plot, still on the track.
    expect(Math.max(...w.sim.getTrain(placed.trainId)!.world.map((p) => p.x))).toBeGreaterThan(PLOT_WIDTH + 100);
    expect(w.sim.getTrain(placed.trainId)!.derailed).toBe(false);
  });
});

describe("freshGameWorld", () => {
  it("starts the first game on the starter map, and later ones on new starter-style maps", () => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    expect(freshGameWorld(() => 0.5).landscape.seed).toBe(STARTER_SEED);
    const next = freshGameWorld(() => 0.25);
    expect(next.landscape.seed).toBe(250_000);
    expect(next.landscape.starter).toBe(true);
    vi.unstubAllGlobals();
  });
});
