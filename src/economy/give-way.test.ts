import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine } from "../game/lines";
import { rng } from "../routing/scenarios";
import { Economy, type StopAction } from "./economy";
import { chain, loopOn, train, type World } from "./loop-fixtures";

/**
 * Giving way (stalls.ts) with the economy's own holds: depots, trains worked at them (a hand-run train works at every
 * stop), loads waited for. The routing harness has no depots, so nothing dwells there: the user's 2026-11-05 deadlock
 * needed the hand-run train's stop at the forest yard to happen.
 */

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";
const CARS: CarKind[] = ["engine", "timber", "timber"];

/**
 * A spur layout: `⊐ F ══ ══ ══ (points)`, the points' straight road a branch `══ ══ Workshop ══ Sawmill ══ ══ ⊐`, their
 * curved one a spur `⌒ ══ ══ Mill ══ ⊐`. `branch`/`spur`: the straights before the depots on each (the fuzz varies them).
 */
function spurWorld(opts: { branch?: number; spur?: number; trunk?: number } = {}) {
  const layout = new Layout();
  const trunk = chain(layout, ["depot-forest", ...Array<PieceTypeId>(opts.trunk ?? 3).fill(S)]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(trunk[0], 0), 0);
  const sw = appendPiece(layout, "switch", false, connectorRef(trunk[trunk.length - 1], 1), 0);
  const br = chain(layout, [...Array<PieceTypeId>(opts.branch ?? 2).fill(S), "depot-workshop", S, "depot-sawmill", S, S], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(br[br.length - 1], 1));
  const sp = chain(layout, [C, ...Array<PieceTypeId>(opts.spur ?? 2).fill(S), "depot-mill", S], connectorRef(sw, 2), [true]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(sp[sp.length - 1], 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  const forest = w.economy.addDepot("forest", trunk[0], 0);
  const workshop = w.economy.addDepot("workshop", br[br.length - 5], 1);
  const sawmill = w.economy.addDepot("sawmill", br[br.length - 3], 1);
  const mill = w.economy.addDepot("mill", sp[sp.length - 2], 1);
  w.dx = forest;
  return { w, sw, trunk, branch: br, spur: sp, depots: { forest, workshop, sawmill, mill } };
}

function routeOn(w: World, engine: number, stops: { depotId: number; action: StopAction }[], next: number): void {
  editLine(w.economy, engine, (s) => s.push(...stops));
  w.economy.routeOf(engine)!.next = next;
}

/** Run, logs topped up at the forest yard: seconds said stuck (any train), and stops come to by `engine` (its route's). */
function runFor(w: World, seconds: number, engine: number, trace = false) {
  let stuck = 0;
  let stops = 0;
  let at = false;
  for (let i = 0; i < seconds * SIM_HZ; i++) {
    if (w.dx) w.dx.piles[0] = Math.max(w.dx.piles[0], 6);
    w.sim.tick();
    w.economy.tick();
    if (w.economy.stalls.count > 0) stuck++;
    if (trace && i % 240 === 0) console.log("T", i / 120, w.sim.trainIds().map((id) => { const t = w.sim.getTrain(id)!; const e = t.cars[0].id; return `e${e} ${t.speed.toFixed(0)}@${t.bogies[0].pieceId}/${t.bogies[t.bogies.length - 1].pieceId} lev${t.cars[0].lever}f${t.cars[0].facing} sw${JSON.stringify(w.economy.sections.waitOf(e))} rw${JSON.stringify(w.economy.router.waitOf(e))} h${w.sim.heldHow(id)} cw${w.economy.sections.clearWait(id)} st${w.economy.stalls.stuckOf(e)?.kind} at${w.economy.routeOf(e)?.at} g${w.economy.routeOf(e)?.next}`; }).join(" | "));
    const r = w.economy.routeOf(engine);
    if (r?.at && !at) stops++;
    at = !!r?.at;
  }
  return { stuck: stuck / SIM_HZ, stops };
}

describe("the user's map, small (2026-11-05): a routed train behind a hand-run one at the sawmill", () => {
  // (Clover, routed Sawmill (drop) → Forest yard (pick) → Sawmill (drop), at the sawmill platform; Willow, no route,
  // just ahead by the workshop, both heading out toward the points. Willow runs out to the forest yard and works there;
  // Clover follows to the points and waits for the yard's line end. Willow comes back to the points, which lie for the
  // branch Clover holds: each waited on the other for good, said stuck, though the mill spur on the points' other road
  // was free. Now Willow gives way by the spur: the points are thrown for it, and back to the player's way after.)
  for (const ahead of [0, 1, 2])
    it(`Willow ${2 - ahead} pieces nearer the points: never stuck, Clover keeps working its route, Willow takes the spur`, () => {
      const m = spurWorld();
      const { w, branch, sw } = m;
      const before = w.economy.router.defaultOf(sw);
      const clover = train(w, branch[4], true, CARS, 150);
      train(w, branch[ahead], true, CARS, 150);
      routeOn(w, clover, [{ depotId: m.depots.sawmill.id, action: "drop" }, { depotId: m.depots.forest.id, action: "pick" }, { depotId: m.depots.sawmill.id, action: "drop" }], 1);
      const r = runFor(w, 180, clover);
      expect(r.stuck).toBe(0);
      expect(r.stops).toBeGreaterThanOrEqual(4);
      expect(w.economy.stalls.gaveWayRoad).toBeGreaterThanOrEqual(1);
      expect(w.economy.router.gaveWayThrows).toBeGreaterThanOrEqual(1);
      // (The player's way at the points is still theirs.)
      expect(w.economy.router.defaultOf(sw)).toBe(before);
    });
});

/**
 * The user's map's shape: a town ring (two stations, Foxley and Rookhurst), a wye off it into a single line to points,
 * their straight road the sawmill line (`══ Workshop ══ Sawmill ══ ══ ⊐`), their curved one the forest yard's spur
 * (`⌒ ══ Forest yard ══ ⊐`). The straights before each depot are the fuzz's to vary.
 */
function townWorld(opts: { line: number; branch: number; spur: number; loop?: boolean }) {
  const layout = new Layout();
  const ring = chain(layout, ["depot-farm", S, S, C, C, C, C, "depot-dairy"]);
  const wye = appendPiece(layout, "wye", false, connectorRef(ring[7], 1), 2);
  const back = chain(layout, ["straight-72", C, C, C, C], connectorRef(wye, 1));
  if (layout.joinedConnector(connectorRef(ring[0], 0)) === -1) throw new Error("the ring doesn't close");
  layout.setSwitchState(wye, 0b110);
  const line = chain(layout, Array<PieceTypeId>(opts.line).fill(S), connectorRef(wye, 0));
  // (A passing loop on the single line, and a straight on past it: the card's fix, "Add a passing loop between them".)
  if (opts.loop) {
    const l = loopOn(layout, connectorRef(line[line.length - 1], 1), [S, S], [S]);
    line.push(...l.main, ...chain(layout, [S], connectorRef(l.s2, 0)));
  }
  const sw = appendPiece(layout, "switch", false, connectorRef(line[line.length - 1], 1), 0);
  const br = chain(layout, [...Array<PieceTypeId>(opts.branch).fill(S), "depot-workshop", S, "depot-sawmill", S, S], connectorRef(sw, 1));
  appendPiece(layout, "buffer-turnback", false, connectorRef(br[br.length - 1], 1));
  const sp = chain(layout, [C, ...Array<PieceTypeId>(opts.spur).fill(S), "depot-forest", S], connectorRef(sw, 2), [true]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(sp[sp.length - 1], 1));
  const w = { layout } as World;
  w.sim = new Sim(layout);
  w.economy = new Economy(layout, w.sim);
  const depots = {
    foxley: w.economy.addDepot("farm", ring[0], 0),
    rookhurst: w.economy.addDepot("dairy", ring[7], 0),
    workshop: w.economy.addDepot("workshop", br[br.length - 5], 1),
    sawmill: w.economy.addDepot("sawmill", br[br.length - 3], 1),
    forest: w.economy.addDepot("forest", sp[sp.length - 2], 1),
  };
  w.dx = depots.forest;
  const places = [...ring.slice(1, 7), ...back.slice(1), ...line, ...br.slice(0, -1)];
  return { w, sw, places, depots };
}

/**
 * A route never makes it worse, with depots (the routing harness's fuzz has none, so nothing ever dwells there): seeded
 * layouts of the user's map's shape (`townWorld`), a routed train and a hand-run one put down anywhere on it, either
 * way, the routed one's 2–3 stops and their actions dealt from the five depots. Each seed runs twice, the routed train
 * hand-run too. A stall with the route where all hand-run had none fails (the user: "without the route these same trains
 * ran fine"); so does a routed train that comes to no stop and isn't said stuck. Known ones, each with why, in `KNOWN`.
 *
 *   TOWN_FUZZ=30 npx vitest run src/economy/give-way.test.ts    (the long run, about 5 min: the known lists cover 1–30;
 *                                                               SHOW=1 prints each, TRACE=<seed> traces one)
 *
 * CI runs the first 12 (about 2 min). Past 30, seeds aren't in the known lists yet: expect new entries to sort.
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.TOWN_FUZZ ?? 12);
/**
 * Seeds where the route still stalls and all hand-run doesn't, and why (2026-11-05). On main (before giving way) 9 of
 * these 12 stalled all hand-run too, and 11 with the route; now all hand-run never does. Fixes since: giving way
 * (stalls.ts); a stale wait in sections (`capOf`: a train a look let go stood held by its last wait between looks); a
 * train on no line going round a ring isn't in a way it's clear of (`clearOfCircling`: the ring is one section, and it
 * kept it for good). What's left, with no passing loop, is one class: their network (ring, line and points) is one
 * section with no passing place, room for one train. The routed train waits in it for the sawmill line, where the
 * hand-run one is and can only come out through it (or, given way on the ring, comes round against it). The card says
 * "Add a passing loop between them", and with one laid all but seed 9 run: asserted below (`loop`).
 */
const NO_LOOP = "no passing place: the card's fix is a loop";
/**
 * Seeds 13–30, for the long run (`TOWN_FUZZ=30`; CI runs 12): each stalls with the route and not all hand-run, and with a
 * passing loop laid runs clean, as the five above do (2026-11-05). Not traced one by one: the same class by its cure.
 */
const NO_LOOP_LONG = "no passing place (long run, not traced one by one): a loop laid clears it";
const KNOWN: Record<number, string> = {
  2: NO_LOOP,
  3: NO_LOOP,
  4: NO_LOOP,
  9: NO_LOOP,
  11: NO_LOOP,
  ...Object.fromEntries([13, 15, 17, 18, 19, 21, 22, 24, 25, 26, 27, 29, 30].map((k) => [k, NO_LOOP_LONG])),
};
/** Of those: laid a loop, they never stall. */
const LOOP_FIXES = [2, 3, 4, 11, 13, 15, 17, 18, 19, 21, 22, 24, 25, 26, 27, 29, 30];
/**
 * With a passing loop laid (`loop`), seeds that still stall (2026-11-05). Seed 9: the hand-run train goes round the ring
 * non-stop, and the routed one's way round from the loop to its stops runs against it, so they'd meet head on: it waits,
 * and is said stuck after `STARVED_S`. Only planning it the same way round would help: a follow-up. Seed 8: a 22 s stall,
 * not looked into yet.
 */
const KNOWN_LOOP: Record<number, string> = {
  8: "a 22 s stall, not looked into",
  9: "its way round the ring runs against a hand-run train going round non-stop",
  20: "a 7 s stall (long run), not looked into",
};

describe(`a route never makes it worse, with depots: ${SEEDS} town-ring layouts × 180 s`, () => {
  const deal = (seed: number, routed: boolean, loop = false) => {
    const r = rng(seed);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    const m = townWorld({ line: 1 + Math.floor(r() * 3), branch: Math.floor(r() * 3), spur: 1 + Math.floor(r() * 2), loop });
    const a = Math.floor(r() * m.places.length);
    let b = Math.floor(r() * m.places.length);
    if (Math.abs(a - b) < 2) b = (a + 2 + Math.floor(r() * (m.places.length - 3))) % m.places.length;
    const ds = Object.values(m.depots);
    const n = 2 + Math.floor(r() * 2);
    const stops = Array.from({ length: n }, () => ({ depotId: pick(ds).id, action: pick<StopAction>(["auto", "drop", "pick", "both"]) }));
    if (stops.every((s) => s.depotId === stops[0].depotId)) stops[1].depotId = ds[(ds.findIndex((d) => d.id === stops[0].depotId) + 1) % ds.length].id;
    const [ra, rb] = [r() < 0.5, r() < 0.5];
    const next = Math.floor(r() * n);
    let e0: number;
    try {
      e0 = train(m.w, m.places[a], ra, CARS, 150);
      train(m.w, m.places[b], rb, CARS, 150);
    } catch {
      return null;
    }
    if (routed) routeOn(m.w, e0, stops, next);
    return { ...m, e0 };
  };
  const results: { seed: number; hand: number; routed: number; stops: number; loop: number; loopStops: number }[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const hand = deal(seed, false);
    const routed = deal(seed, true);
    if (!hand || !routed) continue;
    const h = runFor(hand.w, 180, hand.e0);
    const trace = ENV.TRACE !== undefined && Number(ENV.TRACE) === seed;
    if (trace) console.log("layout", [...routed.w.layout.pieceIds()].map((id) => `${id}:${routed.w.layout.getPiece(id)!.type.replace("straight-216", "S")}`).join(" "));
    const rr = runFor(routed.w, 180, routed.e0, trace);
    const lp = deal(seed, true, true);
    const traceLoop = ENV.TRACE_LOOP !== undefined && Number(ENV.TRACE_LOOP) === seed;
    const rl = lp ? runFor(lp.w, 180, lp.e0, traceLoop) : null;
    results.push({ seed, hand: h.stuck, routed: rr.stuck, stops: rr.stops, loop: rl?.stuck ?? -1, loopStops: rl?.stops ?? -1 });
  }
  if (ENV.SHOW) for (const x of results) console.log(`town seed ${x.seed}: stuck all hand-run ${x.hand.toFixed(0)} s, routed ${x.routed.toFixed(0)} s (${x.stops} stops); with a passing loop ${x.loop.toFixed(0)} s (${x.loopStops} stops)`);
  it("no stall the all-hand-run run doesn't have (but the known ones)", () => {
    expect(results.length).toBeGreaterThan(SEEDS / 2);
    expect(results.filter((x) => x.routed > 0 && x.hand === 0 && !(x.seed in KNOWN)).map((x) => `seed ${x.seed}: routed stuck ${x.routed.toFixed(0)} s`)).toEqual([]);
  });
  it("the known ones still are (a fix takes its entry off)", () => {
    expect(results.filter((x) => x.seed in KNOWN && !(x.routed > 0 && x.hand === 0)).map((x) => `seed ${x.seed}`)).toEqual([]);
    expect(results.filter((x) => x.seed in KNOWN_LOOP && x.loop === 0).map((x) => `seed ${x.seed} with a loop`)).toEqual([]);
  });
  it("no passing place: the card's fix (a passing loop laid) works", () => {
    expect(results.filter((x) => LOOP_FIXES.includes(x.seed) && x.loop !== 0).map((x) => `seed ${x.seed}: ${x.loop.toFixed(0)} s with a loop`)).toEqual([]);
  });
  it("with a passing loop laid, no stall (but the known ones)", () => {
    expect(results.filter((x) => x.loop > 0 && !(x.seed in KNOWN_LOOP)).map((x) => `seed ${x.seed}: ${x.loop.toFixed(0)} s`)).toEqual([]);
  });
  it("all hand-run, nobody is ever stuck here (they give way)", () => {
    expect(results.filter((x) => x.hand > 0).map((x) => `seed ${x.seed}: ${x.hand.toFixed(0)} s`)).toEqual([]);
  });
  it("progress: the routed train comes to its stops, or is said stuck (never stands silently)", () => {
    expect(results.filter((x) => x.stops < 2 && x.routed === 0 && !(x.seed in KNOWN)).map((x) => `seed ${x.seed}: ${x.stops} stops`)).toEqual([]);
  });
});
