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
  // was free. Now Willow gives way by the spur: the points are thrown for it, and back to the player's way after.
  // Known (2026-11-07): Willow then comes back out of the spur and stands with its front on the points, held by sections
  // for Clover at the forest yard, whose only way out is over them: nose to nose, said stuck. Willow is on no line, and
  // sections don't hold such a train at its stretch's end short of the points (routing spec §5 rule 9; the routing
  // redesign's step 6, every train reserving). Till then a turn round got them out; nothing turns mid-line now.)
  for (const ahead of [0, 1, 2])
    it(`Willow ${2 - ahead} pieces nearer the points: Willow takes the spur, Clover gets to the forest yard; then they jam on the points (known)`, () => {
      const m = spurWorld();
      const { w, branch, sw } = m;
      const before = w.economy.router.defaultOf(sw);
      const clover = train(w, branch[4], true, CARS, 150);
      train(w, branch[ahead], true, CARS, 150);
      routeOn(w, clover, [{ depotId: m.depots.sawmill.id, action: "drop" }, { depotId: m.depots.forest.id, action: "pick" }, { depotId: m.depots.sawmill.id, action: "drop" }], 1);
      const r = runFor(w, 180, clover);
      expect(r.stops).toBeGreaterThanOrEqual(1);
      // (The jam on the points, known: a fix flips this. Nobody turns to get out of it.)
      expect(r.stuck).toBeGreaterThan(60);
      expect(w.economy.stalls.gaveWay).toBeGreaterThanOrEqual(1);
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
  // (The wye joined by its connector 1, the ring going on from 2: its stem, the line, runs out away from the ring. Till
  // 2026-11-05 it was joined by 2 and on from 1, and the line ran in across the ring's far side, over its track with no
  // crossing: a layout the player can't lay (clearance refuses it), where trains met side on, or held at the wye for a
  // train standing on the overlap. Six of the 30 seeds' stalls were that.)
  const wye = appendPiece(layout, "wye", false, connectorRef(ring[7], 1), 1);
  const back = chain(layout, ["straight-72", C, C, C, C], connectorRef(wye, 2));
  if (layout.joinedConnector(connectorRef(ring[0], 0)) === -1) throw new Error("the ring doesn't close");
  layout.setSwitchState(wye, 0b110);
  const line = chain(layout, Array<PieceTypeId>(opts.line).fill(S), connectorRef(wye, 0));
  // (A passing loop on the single line, and a straight on past it: the card's fix, "Add a passing loop here".)
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
 * Seeds (1–30) where the route still stalls and all hand-run doesn't, and why (2026-11-05, on the corrected layout: see
 * `townWorld`'s wye). Before the dead-end rule (routing spec §5 rules 8 and 9) 12 stalled with no loop, 9 of them a
 * routed train waiting to go into a dead end a hand-run train was in, each waiting on the other for good. Now a dead end
 * is one block for entry, a train coming out takes a road clear of one waiting to go in, and nobody is held on points:
 * - `HEAD_ON` (15): coming out onto the ring, the routed train meets the hand-run train head on by the wye.
 * - `BOTH_IN` (19): both put down in the sawmill line's dead end, facing each other: a true deadlock.
 * - 22: the hand-run train coming out stands on the wye nose to nose with the routed one, 14 s, till one gives way.
 * With a passing loop laid, 19 and 22 run clean: asserted below (`LOOP_FIXES`).
 *
 * Since 2026-11-07 nothing turns a train round short of the end of its line (the user, firm: "trains should not turn
 * around except at the end of lines"). These were got out of by a turn, and now stand, said stuck (each traced as it
 * began; the fix that doesn't turn is the routing redesign's reservation core, its steps 3 to 6):
 * - `ON_WYE` (4, 23, 26, 30): the routed train coming up the line stands with its front on the wye (§5 rule 9 broken:
 *   it comes to stand past where it should have stood short of the points), in the way of the hand-run train going
 *   round the ring, which waits behind it for good.
 * - 11: head on on the single line, the hand-run train coming out of the sawmill line, the routed one going in.
 * - 14: head on round the ring at the wye, one each way.
 * - 15 (`HEAD_ON`) now stalls all hand-run too, and with a loop: listed in `KNOWN_HAND` and `KNOWN_LOOP`.
 */
const HEAD_ON = "head on with the hand-run train by the wye";
const ON_WYE = "the routed train stands on the wye coming up the line, in the hand-run train's way round the ring";
const KNOWN: Record<number, string> = {
  4: ON_WYE,
  11: "head on on the single line: the hand-run train coming out of the sawmill line, the routed one going in",
  14: "head on round the ring at the wye, one each way",
  19: "both put down in the same dead end, facing: a true deadlock",
  22: "14-19 s nose to nose on the wye, till one gives way by a road",
  23: ON_WYE,
  26: ON_WYE,
  30: ON_WYE,
};
/** Of those: laid a loop, they never stall. */
const LOOP_FIXES = [19, 22];
/**
 * All hand-run, seeds that stall (2026-11-07): the two trains put down facing each other on the ring, nose to nose in
 * seconds. Till then one turned round to give way; nothing turns mid-line now, so they stand, said stuck (the card:
 * move one or give it a route). The same with a loop laid, and with the route.
 */
const FACING = "the two trains put down facing each other on the ring: nose to nose, nothing turns";
const KNOWN_HAND: Record<number, string> = { 6: FACING, 13: FACING, 15: `${HEAD_ON}, all hand-run too`, 21: FACING, 24: FACING, 29: FACING };
/**
 * With a passing loop laid (`loop`), seeds that still stall (2026-11-05), both one class: the hand-run train goes round
 * the ring non-stop, and the routed one, in the loop, waits for it, its way round to its stop running against it (they'd
 * meet head on); seed 8 for 22 s, then it gets by, seed 9 said stuck after `STARVED_S`. Planning it the way round the
 * traffic already goes would help: a follow-up.
 */
const AGAINST = "its way round the ring runs against a hand-run train going round non-stop";
/** With a loop laid, since 2026-11-07 (nothing turns mid-line), also: as `ON_WYE` and `HEAD_ON` above, head on round the ring, and `KNOWN_HAND`'s but 29 (the loop lets them pass). */
const RING_HEAD_ON = "head on round the ring, the routed train one way and the hand-run one the other";
const KNOWN_LOOP: Record<number, string> = { 4: ON_WYE, 8: AGAINST, 9: AGAINST, 12: RING_HEAD_ON, 28: RING_HEAD_ON, 6: FACING, 13: FACING, 15: KNOWN_HAND[15], 21: FACING, 24: FACING };

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
  it("all hand-run, nobody is ever stuck here (they give way by a road), but the known ones", () => {
    expect(results.filter((x) => x.hand > 0 && !(x.seed in KNOWN_HAND)).map((x) => `seed ${x.seed}: ${x.hand.toFixed(0)} s`)).toEqual([]);
    expect(results.filter((x) => x.seed in KNOWN_HAND && x.hand === 0).map((x) => `seed ${x.seed} all hand-run`)).toEqual([]);
  });
  it("progress: the routed train comes to its stops, or is said stuck (never stands silently)", () => {
    expect(results.filter((x) => x.stops < 2 && x.routed === 0 && !(x.seed in KNOWN)).map((x) => `seed ${x.seed}: ${x.stops} stops`)).toEqual([]);
  });
});
