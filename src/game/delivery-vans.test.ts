import { describe, expect, it } from "vitest";
import type { CargoKind } from "../economy/cargo";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { edgesOf, encodeRoad, pieceForEdges, RoadPlacer, setRoadSquare } from "../roads";
import { appendPiece, connectorRef } from "../track";
import { DeliveryVans, joinedToTrack, VAN_LOAD, VAN_YARD } from "./delivery-vans";
import { TownLife } from "./town-life";
import { townStatus } from "./towns";
import { growthOf, receivedBy } from "./town-life";
import { Vans } from "./vans";
import { buildStarterWorld, type World } from "./world";
import { loadFootprints } from "../props/footprints-testing";

/**
 * Delivery vans (roads spec D5) on the starter map: Larkfield's station on the line (track joined to it), Elderwick
 * off it, six road squares between their streets. The economy, TownLife and the van layer are the game's own; the
 * setup shortcuts (named): the road laid square by square as `RoadHand` lays it (shaped to join), the track joined by
 * `appendPiece`, and goods landed by the crane's own `put` (a train unloading is e2e:roads' to check).
 */
async function setup(learned = true) {
  const w = buildStarterWorld();
  const land = w.landscape;
  const G = land.grid;
  const nb = G.neighbours();
  const a = land.towns.find((t) => t.name === "Larkfield")!;
  const b = land.towns.find((t) => t.name === "Elderwick")!;
  const placer = new RoadPlacer(land, w.layout, { inRect: () => false });
  const open = (i: number) => i !== -1 && G.road[i] === 0 && placer.check(i, encodeRoad("curve", 0)) === null && placer.check(i, encodeRoad("straight", 0)) === null;
  // Street ends: a street square, and the open square its piece points at.
  const ends = (t: typeof a) => {
    const out: [number, number][] = [];
    for (const s of t.cells) {
      if (G.surface[s] !== 2 || G.road[s] === 0) continue;
      for (let e = 0; e < 4; e++) if (edgesOf(G.road[s]) & (1 << e) && open(nb[s * 4 + e]) && G.height[nb[s * 4 + e]] === G.height[s]) out.push([s, nb[s * 4 + e]]);
    }
    return out;
  };
  const targets = new Map(ends(b).map(([s, j]) => [j, s]));
  const from = new Map<number, number>();
  const q: number[] = [];
  for (const [s, j] of ends(a)) if (!from.has(j)) (from.set(j, s), q.push(j));
  let path: number[] = [];
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    if (targets.has(i)) {
      const chain = [targets.get(i)!];
      for (let x: number | undefined = i; x !== undefined; x = from.get(x)) chain.unshift(x);
      path = chain;
      break;
    }
    for (let e = 0; e < 4; e++) {
      const j = nb[i * 4 + e];
      if (from.has(j) || !open(j) || G.height[j] !== G.height[i]) continue;
      from.set(j, i);
      q.push(j);
    }
  }
  // chain: street A, road squares…, street B.
  const roadSquares = path.slice(1, -1);
  const lay = () => {
    for (let k = 1; k < path.length - 1; k++) {
      let mask = 0;
      for (const n of [path[k - 1], path[k + 1]]) for (let e = 0; e < 4; e++) if (nb[path[k] * 4 + e] === n) mask |= 1 << e;
      setRoadSquare(G, path[k], pieceForEdges(mask));
    }
    G.touch();
  };
  // Larkfield's station on the line: two straights joined to it.
  const station = w.stations.get(a.id)!;
  appendPiece(w.layout, "straight-216", false, connectorRef(appendPiece(w.layout, "straight-216", false, connectorRef(station, 1)), 1));
  const progress = { learned: new Set(learned ? ["vans"] : []) };
  const fp = await loadFootprints(["bldg"]);
  const host = Object.assign(w, { footprintOf: fp, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
  const received: { town: string; kind: CargoKind; n: number }[] = [];
  let dv: DeliveryVans;
  const life = new TownLife(host, {
    received: (town, kind, n) => received.push({ town: town.name, kind, n }),
    grew: () => {},
    vanTakes: (d, kind) => dv.takes(d, kind),
    vanYard: (d) => dv.yardFilled(d),
    vanShare: (d) => dv.share(d),
  });
  const vans = new Vans(() => w, () => ({ version: 0, has: () => false }));
  dv = new DeliveryVans({ world: w, vans, knows: () => progress.learned.has("vans"), lacks: (t, k) => life.lacks(t, k) });
  life.reset();
  const depot = w.economy.allDepots().find((d) => d.role === "town" && d.townId === a.id)!;
  const put = (kind: CargoKind, n: number) => {
    const p = (w.economy as unknown as { put(slot: { kind: "pile"; depotId: number; cargo: CargoKind }, kind: CargoKind): void }).put.bind(w.economy);
    for (let k = 0; k < n; k++) if (w.economy.accepts!(depot, kind)) p({ kind: "pile", depotId: depot.id, cargo: kind }, kind);
  };
  const run = (seconds: number) => {
    for (let k = 0; k < seconds * 120; k++) w.economy.tick();
    life.update();
  };
  return { w, a, b, roadSquares, lay, dv, vans, life, depot, put, run, received, progress };
}

describe("delivery vans (roads spec D5)", () => {
  it("the starter map: Larkfield on the line, Elderwick off it, six road squares apart", async () => {
    const s = await setup();
    expect(s.roadSquares).toHaveLength(6);
    expect(joinedToTrack(s.w.layout, s.w.stations.get(s.a.id)!)).toBe(true);
    expect(joinedToTrack(s.w.layout, s.w.stations.get(s.b.id)!)).toBe(false);
  });

  it("learned, a station joined by road to a town off the line gets a van; not before, nor without the road", async () => {
    const s = await setup(false);
    s.dv.sync();
    expect(s.dv.runOf(s.depot.id)).toBeUndefined();
    s.lay();
    s.dv.sync();
    expect(s.vans.vehicles.list).toHaveLength(0);
    s.progress.learned.add("vans");
    s.dv.sync();
    expect(s.dv.runOf(s.depot.id)?.townId).toBe(s.b.id);
    expect(s.vans.vehicles.list).toHaveLength(1);
    expect(s.vans.vehicles.list[0].leg).toBe("home");
    // A van is parked: nothing moves, nothing ticks.
    const version = s.vans.vehicles.version;
    s.run(5);
    expect(s.vans.vehicles.version).toBe(version);
  });

  it("never between two stations on the line: Elderwick's station on track too, no van", async () => {
    const s = await setup();
    s.lay();
    appendPiece(s.w.layout, "straight-216", false, connectorRef(s.w.stations.get(s.b.id)!, 1));
    s.dv.sync();
    expect(s.dv.runOf(s.depot.id)).toBeUndefined();
    expect(s.vans.vehicles.list).toHaveLength(0);
  });

  it("the station shares what both towns want, every other unit on the van's yard; the van takes it to Elderwick, which receives it", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    const larkBefore = receivedBy(s.w, s.a.id).planks ?? 0;
    const elder = townStatus(growthOf(s.w, s.b.id));
    expect((elder.wants.planks ?? 0) - (elder.got.planks ?? 0)).toBeGreaterThanOrEqual(3);
    // Both want planks: six landed, three to Larkfield, three on the yard for Elderwick.
    s.put("planks", 6);
    expect((receivedBy(s.w, s.a.id).planks ?? 0) - larkBefore).toBe(3);
    expect(s.w.economy.vanYard.get(s.depot.id)?.planks).toBe(3);
    const van = s.vans.vehicles.list[0];
    expect(van.leg).toBe("loading");
    // It loads, goes, hands them over and comes back.
    s.run(2.2);
    expect(van.leg).toBe("out");
    const elderBefore = receivedBy(s.w, s.b.id).planks ?? 0;
    s.run(30);
    expect(van.leg).toBe("home");
    expect((receivedBy(s.w, s.b.id).planks ?? 0) - elderBefore).toBe(3);
    expect(s.received.some((r) => r.town === "Elderwick" && r.kind === "planks" && r.n === 3)).toBe(true);
    expect(s.w.economy.vanYard.get(s.depot.id)).toBeUndefined();
  });

  it("the yard takes no more than Elderwick lacks (the rest is Larkfield's)", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    const elder = townStatus(growthOf(s.w, s.b.id));
    const lacks = (elder.wants.planks ?? 0) - (elder.got.planks ?? 0);
    s.put("planks", 2 * lacks + 6);
    expect(s.w.economy.vanYard.get(s.depot.id)?.planks).toBe(Math.min(lacks, VAN_YARD));
  });

  it("carries VAN_LOAD a trip, keeps at most VAN_YARD waiting, and goes again for the rest", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    const elder = townStatus(growthOf(s.w, s.b.id));
    const wants = (Object.keys(elder.wants) as CargoKind[]).filter((k) => (elder.wants[k] ?? 0) > (elder.got[k] ?? 0));
    for (const k of wants) s.put(k, 40);
    const yard = s.w.economy.vanYard.get(s.depot.id)!;
    const waiting = Object.values(yard).reduce((t, n) => t + (n ?? 0), 0);
    expect(waiting).toBeLessThanOrEqual(VAN_YARD);
    expect(waiting).toBeGreaterThan(0);
    s.run(2.2);
    const van = s.vans.vehicles.list[0];
    expect(van.leg).toBe("out");
    const load = (van.data as { load: Record<string, number> }).load;
    expect(Object.values(load).reduce((t, n) => t + n, 0)).toBe(Math.min(VAN_LOAD, waiting));
    // Two trips' time: everything waiting has gone.
    s.run(60);
    expect(s.w.economy.vanYard.get(s.depot.id)).toBeUndefined();
  });

  it("the road taken up while the van's out: it comes back with its load, kept on the yard; with no run, the yard goes to its own town", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    s.put("planks", 4);
    s.run(3);
    const van = s.vans.vehicles.list[0];
    expect(van.leg).toBe("out");
    const elderBefore = receivedBy(s.w, s.b.id).planks ?? 0;
    setRoadSquare(s.w.landscape.grid, s.roadSquares[4], 0);
    s.w.landscape.grid.touch();
    s.run(20);
    expect(receivedBy(s.w, s.b.id).planks ?? 0).toBe(elderBefore);
    // (Home, it was taken away with the run: its goods went to Larkfield.)
    expect(s.dv.runOf(s.depot.id)).toBeUndefined();
    expect(s.vans.vehicles.list).toHaveLength(0);
    expect(s.w.economy.vanYard.get(s.depot.id)).toBeUndefined();
  });

  it("the yard is saved with the game, and its van loads up again after loading", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    s.put("planks", 4);
    const saved = JSON.parse(JSON.stringify(serializeWorld(s.w as World)));
    const back = deserializeWorld(saved);
    if (!back.ok) throw new Error(back.error);
    const d = back.value.economy.allDepots().find((x) => x.role === "town" && x.townId === s.a.id)!;
    expect(back.value.economy.vanYard.get(d.id)?.planks).toBe(2);
  });

  it("a van that isn't a station's (step 4's show van) drives its trip untouched", async () => {
    const s = await setup();
    s.lay();
    s.dv.sync();
    expect(s.vans.drive(s.b.id, s.a.id)).toBe(true);
    const show = s.vans.vehicles.list.find((v) => (v.data as { depotId?: number }).depotId === undefined)!;
    s.run(40);
    expect(show.leg).toBe("home");
    expect(s.w.economy.vanYard.size).toBe(0);
  });
});
