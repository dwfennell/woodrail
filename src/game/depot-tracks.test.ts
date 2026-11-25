import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind, type Train } from "../sim";
import { connectorRef, findOverlap, findSplice, Layout, type PieceTypeId } from "../track";
import { CARGO } from "../economy/cargo";
import { Economy, type DepotState } from "../economy";
import { planTracks, TRACK_ROLES, tracksAfter, type PlaceCheck, type TracksPlan } from "./depot-tracks";
import { buildStarterWorld, INDUSTRY_ROLE, type World } from "./world";
import { trackBlock } from "./track-rules";
import { BLOCK_MESSAGES } from "../landscape/clearance";
import { loadBugMap } from "../play/bugmap";
import { editLine, legStop } from "./lines";
import { viaLegs } from "./route-path";
import WORKSHOP_MAP from "../play/bugmaps/reports/2026-11-17-workshop-second-track.txt?raw";

/**
 * Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): the track laid beside, joined by the player's points (here a pair of splits, as from the tray), one crane serving each track's
 * train in turn, what that does to the time two trains take, routed trains sent to the first free track and waiting
 * short of the points when all are taken.
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
/** The track's own placement rules on a world (`trackBlock`: the land and other pieces; no props, which need models). */
const rulesOf =
  (w: Pick<World, "layout" | "landscape">): PlaceCheck =>
  (t, f, pose, y, ignore) => {
    const r = trackBlock({ land: w.landscape, layout: w.layout, props: null, footprint: () => undefined }, t, f, pose, y, ignore);
    return r ? BLOCK_MESSAGES[r] : null;
  };
/** Only other pieces in the way (a world with no landscape). */
const pieceRule =
  (w: W): PlaceCheck =>
  (t, f, pose, y, ignore) =>
    findOverlap(w.layout, t, f, pose, y, ignore) === -1 ? null : BLOCK_MESSAGES.piece;

/** Do a plan as the card does (`replaceRun`, then `setTracks`). */
function apply(w: Pick<W, "layout" | "economy">, mill: DepotState, plan: TracksPlan): void {
  for (const id of plan.covers) w.layout.removePiece(id);
  const ids = plan.pieces.map((p) => w.layout.addPiece(p.type, p.pose, p.y, p.flipped));
  const after = tracksAfter(plan, ids);
  w.economy.setTracks(mill, after.roads, after.ends, after.ladder);
}
/**
 * The second track joined to the line as a player would, by a pair of splits from the tray: one in place of the
 * line's straight next to each end of the mill, its link over to the track's end. The tracks run the yard's length
 * (216) clear of points. Returns the splits.
 */
function loop(w: W): number[] {
  const mx = w.millAt * 216;
  const L = w.layout;
  L.removePiece(w.ids[w.millAt - 1]);
  L.removePiece(w.ids[w.millAt + 1]);
  const splits = [L.addPiece("split", { x: mx - 216, z: 0, heading: 0 }, 0, true), L.addPiece("split", { x: mx + 432, z: 0, heading: Math.PI })];
  return splits;
}
/**
 * The third track joined as the card says: the line's splits moved a straight further out (a straight back in their
 * place), and a split at each end of the second and third tracks, its legs on both, its trunk meeting the line's
 * split's link. Returns the splits.
 */
function ladder(w: W, splits: number[]): number[] {
  const mx = w.millAt * 216;
  const L = w.layout;
  for (const id of splits) L.removePiece(id);
  L.removePiece(w.ids[w.millAt - 2]);
  L.removePiece(w.ids[w.millAt + 2]);
  L.addPiece("straight-216", { x: mx - 216, z: 0, heading: 0 });
  L.addPiece("straight-216", { x: mx + 216, z: 0, heading: 0 });
  return [
    L.addPiece("split", { x: mx - 432, z: 0, heading: 0 }, 0, true),
    L.addPiece("split", { x: mx + 648, z: 0, heading: Math.PI }),
    L.addPiece("split", { x: mx - 216, z: -72, heading: 0 }, 0, true),
    L.addPiece("split", { x: mx + 432, z: -72, heading: Math.PI }),
  ];
}
function upgrade(w: W, to: 2 | 3): void {
  for (let n = w.economy.trackCount(w.mill.id); n < to; n++) {
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    if (n === 1) loop(w);
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
const count = (layout: Layout, type: PieceTypeId) => [...layout.pieceIds()].filter((id) => layout.getPiece(id)!.type === type).length;

describe("depot tracks: the track beside it", () => {
  it("lays a second, then a third track beside the yard: one straight each, nothing taken up, its ends open", () => {
    const w = line();
    const before = [...w.layout.pieceIds()].length;
    const two = planTracks(w, w.mill, open);
    if (typeof two === "string") throw new Error(two);
    expect(two.tracks).toBe(2);
    expect(two.covers).toEqual([]);
    // The yard's length under the crane, and nothing past its ends (the owner, 2026-11-22: "really we just need to add
    // the one in the middle").
    expect(two.pieces.map((p) => [p.type, Math.round(p.pose.x - 4 * 216), Math.round(p.pose.z)])).toEqual([["straight-216", 0, -72]]);
    apply(w, w.mill, two);
    expect([...w.layout.pieceIds()].length).toBe(before + 1);
    expect(w.economy.tracksOf(w.mill.id)!.ends).toHaveLength(0);
    expect(w.economy.trackCount(w.mill.id)).toBe(2);
    const road = w.layout.getPiece(roadOf(w, 0))!;
    expect(road.pose.z).toBeCloseTo(-72);
    expect(road.pose.x).toBeCloseTo(4 * 216);
    // Its ends open.
    expect([0, 1].map((i) => w.layout.joinedConnector(connectorRef(road.id, i)))).toEqual([-1, -1]);
    // Not joined: no track of the industry to routes yet, and the card says so (`unjoinedTracks`).
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([road.id]);
    expect(w.economy.reachableTracks(w.mill)).toEqual([w.ids[w.millAt]]);
    // Joined by the player's points: it is.
    const splits = loop(w);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([]);
    expect(w.economy.reachableTracks(w.mill)).toEqual([w.ids[w.millAt], road.id]);
    const three = planTracks(w, w.mill, open);
    if (typeof three === "string") throw new Error(three);
    apply(w, w.mill, three);
    expect(w.economy.trackCount(w.mill.id)).toBe(3);
    const third = w.layout.getPiece(roadOf(w, 1))!;
    expect(third.pose.z).toBeCloseTo(-144);
    // The yard's length, its ends open.
    expect(three.pieces).toHaveLength(1);
    expect(roadOf(w, 0)).toBe(road.id);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([third.id]);
    expect(planTracks(w, w.mill, open)).toMatch(/3 tracks already/);
    // Joined as the card says (the line's Splits a straight further out, a Split at each end on the second and third):
    // all three the industry's, every split joined at all three ends.
    const four = ladder(w, splits);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([]);
    expect(w.economy.reachableTracks(w.mill)).toEqual([w.ids[w.millAt], road.id, third.id]);
    for (const id of four) for (const i of [0, 1, 2]) expect(w.layout.joinedConnector(connectorRef(id, i))).not.toBe(-1);
  });

  it("a Split dropped from the tray onto the line at each end of it splices in and joins it (the player's path)", () => {
    const w = line();
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    const mx = w.millAt * 216;
    // Held over the line next to each end of the yard, turned so its link goes to the track's side: what the
    // drag does (`findSplice`, as for a depot), then dropped (its straights taken up, the split put down).
    for (const [x, heading, flipped] of [
      [mx - 108, 0, true],
      [mx + 324, Math.PI, false],
    ] as const) {
      const s = findSplice(w.layout, "split", flipped, { x, z: -10 }, heading, 40);
      if (s.kind !== "splice") throw new Error(s.kind);
      expect(s.covers).toHaveLength(1);
      for (const id of s.covers) w.layout.removePiece(id);
      w.layout.addPiece("split", s.pose, s.y, flipped);
    }
    expect(count(w.layout, "split")).toBe(2);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([]);
    for (const id of w.layout.pieceIds()) if (w.layout.getPiece(id)!.type === "split") for (const i of [0, 1, 2]) expect(w.layout.joinedConnector(connectorRef(id, i))).not.toBe(-1);
  });

  it("needs no straight on the line: a curve or points right at the yard's ends, or no line at all", () => {
    const layout = new Layout();
    const ids = (["switch", "depot-mill", "curve-large"] as PieceTypeId[]).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    expect(typeof planTracks({ layout, sim, economy }, economy.addDepot("mill", ids[1]), open)).toBe("object");
    const bare = line(0, 0);
    expect(typeof planTracks(bare, bare.mill, open)).toBe("object");
  });

  it("asks the drop rule for the spot beside the yard (at its level), and says what's there", () => {
    const w = line();
    let asked: { y: number; z: number } | null = null;
    const rule: PlaceCheck = (_t, _f, pose, y) => {
      asked = { y, z: pose.z };
      return "That's a hill";
    };
    expect(planTracks(w, w.mill, rule)).toBe("No room for a second track beside the yard: that's a hill");
    expect(asked).toEqual({ y: 0, z: -72 });
  });

  it("names the piece in the way beside the yard", () => {
    const w = line();
    w.layout.addPiece("switch", { x: 4 * 216 + 40, z: -72, heading: 0 });
    expect(planTracks(w, w.mill, pieceRule(w))).toBe("No room for a second track beside the yard: a switch is in the way");
  });

  it("lays nothing past the yard's ends: a line across right by the yard doesn't stop it", () => {
    // (Until 2026-11-22 the second ran on 216 past each end, cut short by what was there, as on the user's map
    // 2026-11-17: a line across 180 past a workshop's end.)
    for (const gap of [180, 20]) {
      const w = line(1, 4);
      w.layout.addPiece("straight-216", { x: 216 - gap, z: 108, heading: -Math.PI / 2 });
      const plan = planTracks(w, w.mill, pieceRule(w));
      if (typeof plan === "string") throw new Error(plan);
      expect(plan.pieces.map((p) => [p.type, Math.round(p.pose.x - 216)])).toEqual([["straight-216", 0]]);
      expect(plan.parts).toEqual(["road"]);
      apply(w, w.mill, plan);
      expect(w.economy.trackCount(w.mill.id)).toBe(2);
    }
  });

  it("the user's map (2026-11-17): the workshop's second track goes down beside it, a switch and a field past its ends", async () => {
    // "No room for a second track: another piece is in the way", on a workshop with open felt beside its yard: its
    // second track ran on 216 past each end, and 180 past its near end a line crosses (a switch on it); past its far
    // end, a farm's field. The track beside the yard was clear all along.
    const { world } = await loadBugMap(WORKSHOP_MAP);
    const shop = world.economy.allDepots().find((d) => d.role === "workshop")!;
    const rule = rulesOf(world);
    const plan = planTracks(world, shop, rule);
    if (typeof plan === "string") throw new Error(plan);
    expect(plan.tracks).toBe(2);
    expect(plan.pieces.map((p) => p.type)).toEqual(["straight-216"]);
    // Laid, each piece where the rules let it go (as the card lays it), and the economy counts the track.
    for (const p of plan.pieces) expect(rule(p.type, p.flipped, p.pose, p.y, new Set())).toBeNull();
    apply(world, shop, plan);
    expect(world.economy.trackCount(shop.id)).toBe(2);
    expect(world.economy.unjoinedTracks(shop)).toHaveLength(1);
  });

  it("a fresh starter map: every industry that can have tracks has room for a second", () => {
    const world = buildStarterWorld();
    const rule = rulesOf(world);
    const depots = world.economy.allDepots().filter((d) => TRACK_ROLES.has(d.role));
    expect(depots.length).toBeGreaterThan(0);
    for (const d of depots) {
      const plan = planTracks(world, d, rule);
      expect([d.role, typeof plan === "string" ? plan : "ok"]).toEqual([d.role, "ok"]);
    }
  });

  it("a routed train goes to the yard's own track while the one beside it isn't joined", () => {
    const w = line(6, 4);
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    const far = w.layout.addPiece("depot-farm", { x: w.ids.length * 216, z: 0, heading: 0 });
    const farm = w.economy.addDepot("farm", far);
    w.mill.piles[CARGO.flour.index] = 12;
    const t = put(w, w.ids[2], ["engine", "van", "van"], 200);
    w.economy.setRoute(t.cars[0].id, { stops: [{ depotId: w.mill.id, action: "pick" }, { depotId: farm.id, action: "auto" }], next: 0 });
    for (let i = 0; i < sec(60); i++) w.step();
    expect(t.derailed).toBe(false);
    expect(t.cars.some((c) => w.economy.cargoOf(c.id).kind === "flour")).toBe(true);
  });
});

describe("depot tracks: a second track on another line", () => {
  // The user, 2026-11-22 (src/play/bugmaps/teal-warehouse.test.ts): a warehouse's second track joined to a line of its
  // own, not to the yard's first track: "I should be able to stop at the warehouse on the second track here right?"
  it("is the industry's to routes: a train on that line is aimed at it and loads there; the yard's own line's at its own", () => {
    const w = line(6, 4);
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    const road = roadOf(w, 0);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([road]);
    // (Another line along the second track, the player's own: straights on from both its open ends, a farm at the east.)
    const rp = w.layout.getPiece(road)!.pose;
    const z = rp.z;
    const [west, east] = [rp.x - 216, rp.x + 216];
    for (const x of [west, east]) w.layout.addPiece("straight-216", { x, z, heading: 0 });
    const before = [1, 2].map((k) => w.layout.addPiece("straight-216", { x: west - 216 * k, z, heading: 0 }));
    w.layout.addPiece("straight-216", { x: east + 216, z, heading: 0 });
    const farm2 = w.economy.addDepot("farm", w.layout.addPiece("depot-farm", { x: east + 432, z, heading: 0 }));
    const farm1 = w.economy.addDepot("farm", w.layout.addPiece("depot-farm", { x: w.ids.length * 216, z: 0, heading: 0 }));
    expect(w.economy.reachableTracks(w.mill)).toEqual([w.mill.pieceId, road]);
    expect(w.economy.unjoinedTracks(w.mill)).toEqual([]);
    w.mill.piles[CARGO.flour.index] = 12;
    const other = put(w, before[0], ["engine", "van", "van"], 200);
    const own = put(w, w.ids[2], ["engine", "van", "van"], 200);
    w.economy.setRoute(other.cars[0].id, { stops: [{ depotId: w.mill.id, action: "pick" }, { depotId: farm2.id, action: "auto" }], next: 0 });
    w.economy.setRoute(own.cars[0].id, { stops: [{ depotId: w.mill.id, action: "pick" }, { depotId: farm1.id, action: "auto" }], next: 0 });
    // (The map's way from the far line's farm back into the mill: to the second track, the one on its line.)
    const legs = viaLegs(w.layout, [legStop(w.economy, farm2), legStop(w.economy, w.mill)]);
    expect(legStop(w.economy, w.mill).tracks).toEqual([w.mill.pieceId, road]);
    expect(legs[0]?.at(-1)?.pieceId).toBe(road);
    const aims = [new Set<number>(), new Set<number>()];
    for (let i = 0; i < sec(40); i++) {
      w.step();
      [other, own].forEach((t, k) => {
        const r = w.economy.routeOf(t.cars[0].id)!;
        if (r.next % 2 === 0 && !r.at) aims[k].add(w.economy.aimOf(t.cars[0].id));
      });
      expect(other.derailed || own.derailed).toBe(false);
    }
    expect([...aims[0]]).toEqual([road]);
    expect([...aims[1]]).toEqual([w.mill.pieceId]);
    for (const t of [other, own]) expect(t.cars.some((c) => w.economy.cargoOf(c.id).kind === "flour")).toBe(true);
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
    const move = { kind: "log" as const, toPile: false, carId: -1, phase: 0, run: -1 };
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

  it("waits short of the points while every track is taken, then goes in", () => {
    const { w, trains } = routed(2, 3);
    const c = trains[2];
    // (The player's points into its tracks: the router stands it short of them.)
    const ladder = new Set([...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type === "split"));
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

describe("depot tracks: a train standing on the points into them", () => {
  /**
   * A train on a line whose front axle stands on the split into the mill's second track, the split set for that track,
   * its stop the mill's own track; another line's train in the second track. The points can't move under it, so the
   * second track is the only way it can go. Its way was found full there naming no train: it waited for train −1 on
   * the points for good (an invariant break seen in e2e:depot-tracks: "waits (section) for a train that isn't there
   * (-1)").
   */
  function onThePoints(path: number) {
    const w = line(11, 6);
    const far = w.layout.addPiece("depot-farm", { x: w.ids.length * 216, z: 0, heading: 0 });
    const farm = w.economy.addDepot("farm", far);
    upgrade(w, 2);
    const split = [...w.layout.pieceIds()].find((id) => w.layout.getPiece(id)!.type === "split" && w.layout.getPiece(id)!.pose.heading === 0)!;
    w.mill.piles[CARGO.flour.index] = 12;
    const other = put(w, roadOf(w, 0), ["engine"], 150);
    // (Its front on the split's way into the second track (path 1), or straight on toward the mill's own (path 0).)
    const r = w.sim.addTrain(["engine"], { pieceId: split, pathIndex: path, reversed: false, s: 100 });
    if (r.kind !== "placed") throw new Error(`no room: ${r.kind}`);
    const train = w.sim.getTrain(r.trainId) as Train;
    w.sim.setLever(train.cars[0].id, 1);
    for (const t of [other, train]) editLine(w.economy, t.cars[0].id, (stops) => stops.push({ depotId: w.mill.id, action: "auto" }, { depotId: farm.id, action: "auto" }));
    return { w, other: other.cars[0].id, engine: train.cars[0].id, split, far };
  }

  it.each([1, 0])("never waits for no train, and goes on to its stops (its front on the split's path %i)", (path) => {
    const { w, engine, other, split, far } = onThePoints(path);
    const front = w.sim.findCar(engine)!.train.bogies[0];
    expect([front.pieceId, front.pathIndex]).toEqual([split, path]);
    // (How long each has waited for a train that isn't there: the invariants' "deadlock" says so at a second.)
    const ghost = new Map<number, number>();
    let longest = 0;
    let farm = false;
    for (let i = 0; i < sec(120) && !farm; i++) {
      w.step();
      for (const e of [engine, other]) {
        const wait = w.economy.sections.waitOf(e);
        const n = wait && "engine" in wait && !w.sim.findCar(wait.engine) ? (ghost.get(e) ?? 0) + 1 : 0;
        ghost.set(e, n);
        longest = Math.max(longest, n);
      }
      farm = w.sim.findCar(engine)!.train.bogies.some((b) => b.pieceId === far);
    }
    expect(longest).toBe(0);
    // The payoff: off the points, on by the mill's tracks, to its next stop.
    expect(farm).toBe(true);
  });
});


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

  it("a third track added to it goes beside the second, the ladder kept", () => {
    const w = line(6, 6);
    oldLadder(w);
    const road = roadOf(w, 0);
    const before = w.economy.tracksOf(w.mill.id)!;
    const plan = planTracks(w, w.mill, open);
    if (typeof plan === "string") throw new Error(plan);
    apply(w, w.mill, plan);
    expect(w.economy.trackCount(w.mill.id)).toBe(3);
    expect(count(w.layout, "crossover")).toBe(2);
    expect(roadOf(w, 0)).toBe(road);
    const after = w.economy.tracksOf(w.mill.id)!;
    expect(after.ladder).toEqual(before.ladder);
    expect(after.ends).toEqual(before.ends);
    // Its ladder still the points a full stop's trains wait short of.
    expect(w.economy.reachableTracks(w.mill)).toContain(road);
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
    // (Joined by a pair of splits, as a player would.)
    layout.removePiece(ids[3]);
    layout.removePiece(ids[5]);
    layout.addPiece("split", { x: 3 * 216, z: 0, heading: 0 }, 0, true);
    layout.addPiece("split", { x: 6 * 216, z: 0, heading: Math.PI });

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
