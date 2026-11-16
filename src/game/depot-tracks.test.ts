import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { connectorRef, createWorldConnector, Layout, type PieceTypeId } from "../track";
import { CARGO } from "../economy/cargo";
import { Economy, type DepotState } from "../economy";
import { EXTRA, planTracks, TRACK_ROLES, tracksAfter, type PlaceCheck, type TracksPlan } from "./depot-tracks";
import { INDUSTRY_ROLE } from "./world";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): the ladder laid, one crane serving each track's
 * train in turn, what that does to the time two trains take, routed trains sent to the first free track and waiting
 * short of the ladder when all are taken.
 */

/** A mill in a straight line along +x: `before` straights, the mill, `after` straights. No room rules (`open`). */
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
const open: PlaceCheck = () => null;

/** Do a plan as the card does (`replaceRun`, then `setTracks`). */
function apply(w: Pick<W, "layout" | "economy">, mill: DepotState, plan: TracksPlan): void {
  for (const id of plan.covers) w.layout.removePiece(id);
  const ids = plan.pieces.map((p) => w.layout.addPiece(p.type, p.pose, p.y, p.flipped));
  const after = tracksAfter(plan, ids);
  w.economy.setTracks(mill, after.roads, after.ends, after.ladder);
}
function upgrade(w: W, to: 2 | 3): void {
  for (let n = w.economy.trackCount(w.mill.id); n < to; n++) {
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
  }
}
/** A train on piece `pieceId`, its front `s` along it (+x), lever on. */
function put(w: W, pieceId: number, kinds: CarKind[], s = 150): Train {
  const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s });
  if (r.kind !== "placed") throw new Error(`no room: ${r.kind}`);
  const t = w.sim.getTrain(r.trainId) as Train;
  w.sim.setLever(t.cars[0].id, 1);
  return t;
}
const roadOf = (w: W, k: number) => w.economy.roadsOf(w.mill.id)[k].pieceId;
const sec = (n: number) => Math.round(n * SIM_HZ);

/** A mill on a line along +x: the pieces `before` it (laid back from it), the mill, the pieces `after`. No room rules. */
function lineOf(before: PieceTypeId[], after: PieceTypeId[]) {
  const layout = new Layout();
  const mill = layout.addPiece("depot-mill", { x: 0, z: 0, heading: 0 });
  // (Each laid joined to the last: back from the mill's first end, on from its far end.)
  const lay = (types: PieceTypeId[], from: number) => {
    let ref = connectorRef(mill, from);
    for (const t of types) {
      const at = { ...layout.worldConnector(ref, createWorldConnector()) };
      const id = layout.addPiece(t, { x: 0, z: 0, heading: 0 });
      const c0 = { ...layout.worldConnector(connectorRef(id, 0), createWorldConnector()) };
      // Turn the piece so its end 0 meets `ref` facing it, then move it there.
      const h = at.heading + Math.PI - c0.heading;
      layout.removePiece(id);
      const id2 = layout.addPiece(t, { x: 0, z: 0, heading: h });
      const c1 = { ...layout.worldConnector(connectorRef(id2, 0), createWorldConnector()) };
      layout.removePiece(id2);
      const id3 = layout.addPiece(t, { x: at.x - c1.x, z: at.z - c1.z, heading: h });
      ref = connectorRef(id3, 1);
    }
  };
  lay(before, 0);
  lay(after, 1);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const d = economy.addDepot("mill", mill);
  return { layout, sim, economy, mill: d };
}
const count = (layout: Layout, type: PieceTypeId) => [...layout.pieceIds()].filter((id) => layout.getPiece(id)!.type === type).length;
/** Every end of every piece of these types is joined. */
const joined = (layout: Layout, type: PieceTypeId) => [...layout.pieceIds()].filter((id) => layout.getPiece(id)!.type === type).every((id) => [0, 1, 2].every((i) => layout.joinedConnector(connectorRef(id, i)) !== -1));
/** How far along x a track at z lies clear of points: the plain straights (and the mill) at that z, end to end. */
function clearRun(layout: Layout, z: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    if (Math.abs(p.pose.z - z) > 1 || !(p.type.startsWith("straight") || p.type.startsWith("depot"))) continue;
    for (const i of [0, 1]) {
      const c = layout.worldConnector(connectorRef(id, i), createWorldConnector());
      // (Only straights meeting a turnout or each other count: walk out from the mill's middle.)
      lo = Math.min(lo, c.x);
      hi = Math.max(hi, c.x);
    }
  }
  return [lo, hi];
}

describe("depot tracks: the turnouts", () => {
  it("lays a second, then a third track, 432 clear of points, joined at both ends by a short split", () => {
    const w = line();
    const two = planTracks(w, w.mill, open);
    if (typeof two === "string") throw new Error(two);
    expect(two.tracks).toBe(2);
    expect(two.pieces.filter((p) => p.type === "split-short")).toHaveLength(2);
    expect(two.pieces.some((p) => p.type === "crossover" || p.type === "buffer")).toBe(false);
    // Evenly: 108 at each end.
    expect(two.e0).toBe(108);
    apply(w, w.mill, two);
    expect(w.economy.trackCount(w.mill.id)).toBe(2);
    // Every split's three ends are joined, and the new track is one square over.
    expect(joined(w.layout, "split-short")).toBe(true);
    const road = w.layout.getPiece(roadOf(w, 0))!;
    expect(road.pose.z).toBeCloseTo(-72);
    // The mill is at x 4·216 = 864: its track and the new one run 432 clear of points, 108 past each end.
    const mx = 4 * 216;
    expect(clearRun(w.layout, -72)).toEqual([mx - 108, mx + 324]);
    upgrade(w, 3);
    expect(w.economy.trackCount(w.mill.id)).toBe(3);
    expect(count(w.layout, "split-short")).toBe(4);
    expect(joined(w.layout, "split-short")).toBe(true);
    expect(clearRun(w.layout, -144)).toEqual([mx - 108, mx + 324]);
    // The second track's middle (its crane's) is kept as it was.
    expect(roadOf(w, 0)).toBe(road.id);
    expect(planTracks(w, w.mill, open)).toMatch(/3 tracks already/);
  });

  it("needs far less of the line than the ladder did: 2 squares at a tight end, the rest at the other", () => {
    // A curve 2 squares (144) from the mill's first end, plenty of straight at the other: the 432 lies off-centre.
    const w = lineOf(["straight-144", "curve-large"], ["straight-216", "straight-216", "straight-216"]);
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.e0).toBe(0);
    apply(w, w.mill, plan);
    expect(w.economy.trackCount(w.mill.id)).toBe(2);
    expect(joined(w.layout, "split-short")).toBe(true);
    // The curve's still there, joined to the turnout's trunk.
    expect(count(w.layout, "curve-large")).toBe(1);
    expect(clearRun(w.layout, -72)).toEqual([0, 432]);
    // Points just past it at the far end, 5 squares out: still fits (2 + 5). A forest yard with a double crossover
    // below it and a curve just above (the owner's).
    const yard = lineOf(["straight-144", "curve-large"], ["straight-216", "straight-144", "crossover"]);
    expect(typeof planTracks(yard, yard.mill, open)).toBe("object");
    // Room at both ends but split oddly: 3 and 4 squares (216, 288): shared 72 and 144.
    const odd = lineOf(["straight-216", "curve-large"], ["straight-288", "curve-large"]);
    const p2 = planTracks(odd, odd.mill, open);
    if (typeof p2 === "string") throw new Error(p2);
    expect(p2.e0).toBe(72);
    // A part of a straight left over is put back as a shorter one.
    const cut = lineOf(["straight-288", "curve-large"], ["straight-288", "curve-large"]);
    const p3 = planTracks(cut, cut.mill, open);
    if (typeof p3 === "string") throw new Error(p3);
    apply(cut, cut.mill, p3);
    expect(joined(cut.layout, "split-short")).toBe(true);
    for (const id of cut.layout.pieceIds()) if (cut.layout.getPiece(id)!.type === "curve-large") expect(cut.layout.joinedConnector(connectorRef(id, 0)) !== -1 || cut.layout.joinedConnector(connectorRef(id, 1)) !== -1).toBe(true);
  });

  it("the third track: 4 squares at a tight end", () => {
    const w = lineOf(["straight-288", "curve-large"], [...Array(4).fill("straight-216")]);
    for (const n of [2, 3]) {
      const plan = planTracks(w, w.mill, open);
      if (typeof plan === "string") throw new Error(plan);
      expect(plan.tracks).toBe(n);
      apply(w, w.mill, plan);
    }
    expect(w.economy.trackCount(w.mill.id)).toBe(3);
    expect(count(w.layout, "split-short")).toBe(4);
    expect(joined(w.layout, "split-short")).toBe(true);
    for (const z of [0, -72, -144]) expect(clearRun(w.layout, z)[1] - Math.max(clearRun(w.layout, z)[0], z === 0 ? 0 : -Infinity)).toBeGreaterThanOrEqual(432);
  });

  it("says why, in squares, and what's in the way at each end, when there isn't the room", () => {
    // One square at one end: a curve.
    const tight = lineOf(["straight-72", "curve-large"], [...Array(4).fill("straight-216")]);
    const look = { room: [] as number[], block: [] as number[] };
    expect(planTracks(tight, tight.mill, open, look)).toBe("The second track needs 7 squares of straight line beside it, at least 2 at each end: there's 1 before a curve at one end, room at the other (shown on the map)");
    // The stretch for the map: the straight there is, and the curve in the way.
    expect(look.room.length).toBeGreaterThan(1);
    expect(look.block.map((id) => tight.layout.getPiece(id)!.type)).toEqual(["curve-large"]);
    // Both ends short: 3 squares before points, 3 before a curve (6 of the 7).
    const both = lineOf(["straight-216", "curve-large"], ["straight-216", "switch"]);
    expect(planTracks(both, both.mill, open)).toBe("The second track needs 7 squares of straight line beside it, at least 2 at each end: there's 3 before a curve at one end, 3 before points at the other (shown on the map)");
    // The line ends; nothing joined at all at one end (a yard dropped on its own: QA 2026-11-05 #6).
    const short = lineOf(["straight-72"], [...Array(4).fill("straight-216")]);
    expect(planTracks(short, short.mill, open)).toMatch(/there's 1 before the track ends at one end, room at the other/);
    // (3 squares at an end is room now: the ladder needed 4½.)
    const three = line(1, 4);
    expect(typeof planTracks(three, three.mill, open)).toBe("object");
    const bare = line(0, 4);
    expect(planTracks(bare, bare.mill, open)).toMatch(/: lay track at its other end first$/);
    const none = line(0, 0);
    expect(planTracks(none, none.mill, open)).toMatch(/: lay track at both ends first$/);
    // Room: what the drop rule says.
    const w = line();
    expect(planTracks(w, w.mill, (t) => (t === "split-short" ? "That's a hill" : null))).toBe("No room for a second track: that's a hill");
  });

  it("a train on the straights it would take up: not till it's moved", () => {
    const w = line();
    put(w, w.ids[w.millAt - 1], ["engine"], 100);
    const look = { room: [] as number[], block: [] as number[] };
    expect(planTracks(w, w.mill, open, look)).toMatch(/A train is standing/);
    expect(look.block).toEqual([w.ids[w.millAt - 1]]);
  });
});

describe("depot tracks: one crane, each track in turn", () => {
  /** A hopper train of grain on the mill's own track and a van train for flour on its second, both running up to the crane. */
  function two(w: W) {
    w.mill.piles[CARGO.flour.index] = 12;
    w.mill.piles[CARGO.grain.index] = 0;
    const a = put(w, w.ids[w.millAt], ["engine", "hopper", "hopper"], 200);
    for (const c of a.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", 4);
    const b = put(w, roadOf(w, 0), ["engine", "van", "van"], 200);
    return { a, b };
  }

  it("moves a unit for one train at a time, in turn, from the same piles", () => {
    const w = line();
    upgrade(w, 2);
    const { a, b } = two(w);
    const move = { kind: "log" as const, toPile: false, carId: -1, phase: 0 };
    const order: number[] = [];
    let last = -1;
    for (let i = 0; i < sec(120); i++) {
      w.step();
      // Never two units at once: one crane.
      let moving = 0;
      for (const p of [w.ids[w.millAt], roadOf(w, 0)]) if (w.economy.craneMove(w.mill.id, move, p)) moving++;
      expect(moving).toBeLessThanOrEqual(1);
      if (w.economy.craneMove(w.mill.id, move) && move.carId !== last) {
        last = move.carId;
        order.push(a.cars.some((c) => c.id === move.carId) ? 0 : 1);
      }
    }
    // Both served: the grain's on the mill's pile, the vans have flour.
    expect(a.cars.filter((c) => c.kind === "hopper").every((c) => w.economy.cargoOf(c.id).count === 0)).toBe(true);
    expect(b.cars.filter((c) => c.kind === "van").every((c) => w.economy.cargoOf(c.id).kind === "flour" && w.economy.cargoOf(c.id).count > 0)).toBe(true);
    // In turn: the crane went back and forth between the two trains while both were there.
    const switches = order.filter((x, i) => i > 0 && x !== order[i - 1]).length;
    expect(switches).toBeGreaterThanOrEqual(4);
  });

  it("two trains are done sooner than on one track, though the crane is no faster (throughput)", () => {
    // One track: the van train waits behind the hopper train on the line, then comes in.
    const time = (tracks: 1 | 2) => {
      const w = line(6, 4);
      if (tracks === 2) upgrade(w, 2);
      w.mill.piles[CARGO.flour.index] = 12;
      const a = put(w, w.ids[w.millAt], ["engine", "hopper", "hopper"], 200);
      for (const c of a.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", 4);
      const b = tracks === 2 ? put(w, roadOf(w, 0), ["engine", "van", "van"], 200) : put(w, w.ids[w.millAt - 3], ["engine", "van", "van"], 100);
      const done = () => a.cars.every((c) => c.kind !== "hopper" || w.economy.cargoOf(c.id).count === 0) && b.cars.every((c) => c.kind !== "van" || w.economy.cargoOf(c.id).count === w.economy.wagonCapacity);
      for (let i = 0; i < sec(300); i++) {
        w.step();
        if (done()) return i / SIM_HZ;
      }
      return Infinity;
    };
    const one = time(1);
    const twoT = time(2);
    console.log(`two trains served: one track ${one.toFixed(1)} s, two tracks ${twoT.toFixed(1)} s (${Math.round((1 - twoT / one) * 100)}% sooner)`);
    expect(Number.isFinite(one)).toBe(true);
    expect(twoT).toBeLessThan(one);
    // The crane moves the same units either way: two tracks save the waiting train's run in and the wagons' shunting, not crane time.
    expect(twoT).toBeGreaterThan(one * 0.4);
  });
});

describe("depot tracks: routed trains", () => {
  /** Routed trains (no line) to the mill, then on to a farm at the far end. */
  function routed(tracks: 1 | 2 | 3, count: number) {
    const w = line(11, 6);
    const far = w.layout.addPiece("depot-farm", { x: (w.ids.length) * 216, z: 0, heading: 0 });
    const farm = w.economy.addDepot("farm", far);
    if (tracks > 1) upgrade(w, tracks as 2 | 3);
    w.mill.piles[CARGO.flour.index] = 12;
    const trains: Train[] = [];
    for (let k = 0; k < count; k++) {
      const t = put(w, w.ids[8 - 3 * k], ["engine", "van", "van"], 200);
      w.economy.setRoute(t.cars[0].id, { stops: [{ depotId: w.mill.id, action: "pick" }, { depotId: farm.id, action: "auto" }], next: 0 });
      trains.push(t);
    }
    return { w, trains };
  }
  const tracksUnder = (w: W, t: Train) => {
    const all = [w.ids[w.millAt], ...w.economy.roadsOf(w.mill.id).map((r) => r.pieceId)];
    return all.findIndex((p) => t.bogies.some((b) => b.pieceId === p));
  };

  it("sends each to the first free track: the depot's own, then the second", () => {
    const { w, trains } = routed(2, 2);
    const [a, b] = trains;
    let at: [number, number] = [-1, -1];
    for (let i = 0; i < sec(90) && (at[0] === -1 || at[1] === -1); i++) {
      w.step();
      const ta = tracksUnder(w, a);
      const tb = tracksUnder(w, b);
      if (ta !== -1 && at[0] === -1) at[0] = ta;
      if (tb !== -1 && at[1] === -1) at[1] = tb;
      expect(a.derailed || b.derailed).toBe(false);
    }
    expect(at).toEqual([0, 1]);
    // Both loaded with flour at the one stop.
    for (let i = 0; i < sec(60); i++) w.step();
    for (const t of trains) expect(t.cars.some((c) => w.economy.cargoOf(c.id).kind === "flour")).toBe(true);
  });

  it("waits short of the ladder while every track is taken, then goes in", () => {
    const { w, trains } = routed(2, 3);
    const c = trains[2];
    const ladder = new Set(w.economy.tracksOf(w.mill.id)!.ladder);
    let waited = false;
    let inAfter = false;
    for (let i = 0; i < sec(240); i++) {
      w.step();
      const short = w.economy.router.waitsAt(c);
      if (short !== -1 && ladder.has(short)) {
        waited = true;
        // Short of it: not on any track while it waits.
        expect(tracksUnder(w, c)).toBe(-1);
      }
      if (waited && tracksUnder(w, c) !== -1) inAfter = true;
      for (const t of trains) expect(t.derailed).toBe(false);
      if (inAfter) break;
    }
    expect(waited).toBe(true);
    expect(inAfter).toBe(true);
  });

  it("goes as before at a depot of one track (no waits for tracks)", () => {
    const { w, trains } = routed(1, 1);
    expect(w.economy.tracksOf(w.mill.id)).toBeUndefined();
    for (let i = 0; i < sec(60); i++) w.step();
    expect(trains[0].cars.some((c) => w.economy.cargoOf(c.id).kind === "flour")).toBe(true);
  });
});

it(`each track runs 432 mm clear of points (the depot and ${EXTRA} mm more)`, () => expect(216 + EXTRA).toBe(432));

describe("depot tracks: an older save's ladder of crossovers", () => {
  /** The second track as the ladder laid it (before 2026-11-16): crossovers 216 out, buffers on their spare ends. */
  function oldLadder(w: W): void {
    const mx = w.millAt * 216;
    const L = w.layout;
    for (const k of [-2, -1, 1, 2]) L.removePiece(w.ids[w.millAt + k]);
    const at = (t: number, l: number, h = 0) => ({ x: mx + t, z: l, heading: h });
    const ladder = [
      L.addPiece("straight-108", at(-432, 0)),
      L.addPiece("crossover", at(-324, 0), 0, true),
      L.addPiece("straight-108", at(-108, 0)),
      L.addPiece("straight-108", at(216, 0)),
      L.addPiece("crossover", at(540, 0, Math.PI)),
      L.addPiece("straight-108", at(540, 0)),
      L.addPiece("buffer", at(-324, -72, Math.PI)),
      L.addPiece("buffer", at(540, -72)),
    ];
    const ends = [L.addPiece("straight-108", at(-108, -72)), L.addPiece("straight-108", at(216, -72))];
    const road = L.addPiece("straight-216", at(0, -72));
    w.economy.setTracks(w.mill, [road], ends, ladder);
  }

  it("keeps working: two routed trains stand on its two tracks, both served", () => {
    const w = line(11, 6);
    const far = w.layout.addPiece("depot-farm", { x: w.ids.length * 216, z: 0, heading: 0 });
    const farm = w.economy.addDepot("farm", far);
    oldLadder(w);
    expect(w.economy.trackCount(w.mill.id)).toBe(2);
    for (const id of w.layout.pieceIds()) if (w.layout.getPiece(id)!.type === "crossover") for (let i = 0; i < 4; i++) expect(w.layout.joinedConnector(connectorRef(id, i))).not.toBe(-1);
    w.mill.piles[CARGO.flour.index] = 12;
    const trains = [0, 1].map((k) => {
      const t = put(w, w.ids[6 - 3 * k], ["engine", "van", "van"], 200);
      w.economy.setRoute(t.cars[0].id, { stops: [{ depotId: w.mill.id, action: "pick" }, { depotId: farm.id, action: "auto" }], next: 0 });
      return t;
    });
    const tracks = [w.ids[w.millAt], roadOf(w, 0)];
    const seen = new Set<number>();
    for (let i = 0; i < sec(120); i++) {
      w.step();
      for (const t of trains) {
        expect(t.derailed).toBe(false);
        const k = tracks.findIndex((p) => t.bogies.some((b) => b.pieceId === p));
        if (k !== -1) seen.add(k);
      }
    }
    expect([...seen].sort()).toEqual([0, 1]);
    for (const t of trains) expect(t.cars.some((c) => w.economy.cargoOf(c.id).kind === "flour")).toBe(true);
  });

  it("a third track added to it takes the ladder up and lays turnouts, the second track's middle kept", () => {
    const w = line(6, 6);
    oldLadder(w);
    const road = roadOf(w, 0);
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    expect(w.economy.trackCount(w.mill.id)).toBe(3);
    expect(count(w.layout, "crossover")).toBe(0);
    expect(count(w.layout, "buffer")).toBe(0);
    expect(count(w.layout, "split-short")).toBe(4);
    expect(joined(w.layout, "split-short")).toBe(true);
    expect(roadOf(w, 0)).toBe(road);
  });
});

describe("depot tracks: saves", () => {
  it("keeps an industry's tracks through a save; an old save (none) has one", async () => {
    const { buildStarterWorld, syncIndustries } = await import("./world");
    const { deserializeWorld, serializeWorld } = await import("../persist/save");
    const world = buildStarterWorld();
    // (A line of its own, clear of the starter map's track.)
    let mill = -1;
    for (let i = 0; i < 11; i++) {
      const id = world.layout.addPiece(i === 5 ? "depot-mill" : "straight-216", { x: i * 216, z: -2400, heading: 0 });
      if (i === 5) mill = id;
    }
    syncIndustries(world);
    const d = world.economy.depotAtPiece(mill)!;
    const plan = planTracks(world, d, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(world, d, plan);
    const roads = world.economy.roadsOf(d.id).map((r) => r.pieceId);
    const data = serializeWorld(world);
    const back = deserializeWorld(JSON.parse(JSON.stringify(data)));
    if (!back.ok) throw new Error(back.error);
    const d2 = back.value.economy.depotAtPiece(mill)!;
    expect(back.value.economy.trackCount(d2.id)).toBe(2);
    expect(back.value.economy.roadsOf(d2.id).map((r) => r.pieceId)).toEqual(roads);
    expect(back.value.economy.depotAtPiece(roads[0])?.id).toBe(d2.id);
    // A save from before: no `tracks` on its depots.
    for (const s of (data as { depots: { tracks?: unknown }[] }).depots) delete s.tracks;
    const old = deserializeWorld(JSON.parse(JSON.stringify(data)));
    if (!old.ok) throw new Error(old.error);
    expect(old.value.economy.trackCount(old.value.economy.depotAtPiece(mill)!.id)).toBe(1);
  });
});

describe("depot tracks: the one crane drawn", () => {
  it("a gantry from just beyond the last track to the yard's edge (a jib crane becomes one); one track: as it was", async () => {
    const { DEPOT_LAYOUT, spanLayout } = await import("../render/depot-view");
    const jib = DEPOT_LAYOUT.farm;
    expect(spanLayout(jib, 1)).toBe(jib);
    const two = spanLayout(jib, 2).crane;
    expect(two.kind).toBe("gantry");
    expect([two.l - two.half!, two.l + two.half!]).toEqual([-72 - 34, 118]);
    const three = spanLayout(DEPOT_LAYOUT.mill, 3).crane;
    expect([three.l - three.half!, three.l + three.half!]).toEqual([-144 - 34, 118]);
    expect(three.t).toBe(DEPOT_LAYOUT.mill.crane.t);
  });
});

describe("depot tracks: which industries", () => {
  // QA 2026-11-05 #3: the tank wagons' wells and the goods chains' industries (built alongside) had no Second track.
  // Every industry piece's role offers it but a school, an airport and an airship's mast (not crane industries: the
  // last two are rider stops). The car factory too (the owner's call).
  const NOT: ReadonlySet<string> = new Set(["school", "airport", "mast"]);
  it("every crane industry offers more tracks", () => {
    const missing = [...new Set(Object.values(INDUSTRY_ROLE))].filter((r) => r && !NOT.has(r) && !TRACK_ROLES.has(r));
    expect(missing).toEqual([]);
  });

  it("an oil well is given a second track like a mill, and a tank wagon train on it is loaded", () => {
    const layout = new Layout();
    const types: PieceTypeId[] = [...Array(4).fill("straight-216"), "depot-oilwell", ...Array(4).fill("straight-216")];
    const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const well = economy.addDepot("oilwell", ids[4]);
    const plan = planTracks({ layout, sim, economy }, well, open);
    if (typeof plan === "string") throw new Error(plan);
    apply({ layout, economy }, well, plan);
    expect(economy.trackCount(well.id)).toBe(2);
    well.piles[CARGO.oil.index] = 6;
    const road = economy.roadsOf(well.id)[0].pieceId;
    // (Run in to the track's end, as the mill's second train in "one crane serves each track in turn".)
    const r = sim.addTrain(["engine", "oiltank", "oiltank"], { pieceId: road, pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") throw new Error(r.kind);
    const t = sim.getTrain(r.trainId)!;
    sim.setLever(t.cars[0].id, 1);
    for (let i = 0; i < sec(30); i++) {
      sim.tick();
      economy.tick();
    }
    expect(economy.cargoOf(t.cars[1].id).kind).toBe("oil");
    expect(economy.cargoOf(t.cars[1].id).count).toBeGreaterThan(0);
  });
});
