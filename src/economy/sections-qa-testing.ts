/**
 * QA's sections cases (src/economy/sections-qa*.test.ts): the worlds, the scenario runner and the checks they share. The
 * cases were one file, 350 s, the long pole of `npm test`; split so its slow sweeps run in workers of their own.
 */
import { afterAll, describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine, stopLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { putAway } from "../game/put-away";
import { CARGO } from "./cargo";
import { capAt, Economy } from "./economy";
import { topologyOf, trainLength } from "./sections";
import { STUCK_S } from "./stalls";
import { loopOn } from "./loop-fixtures";
import { next, waysFrom } from "../routing/graph";
import { planStats } from "../routing/plan";
import type { Router } from "../routing/router";
import { economyChecks } from "../game/dev-checks";
import { INVARIANTS, type Invariant } from "../sim/invariants";


export const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
export const TRACE = !!ENV.TRACE;
/**
 * ROUTING=1: every world's router is timed; at the end, its looks ahead (a routed train asking for its points), their
 * mean time, locks granted, asks refused, waits begun and points put back, and the plan choices worked out and cached (with
 * --silent=false).
 */
export const ROUTERS: Router[] | null = ENV.ROUTING ? [] : null;
if (ROUTERS)
  afterAll(() => {
    const sum = (f: (r: Router) => number) => ROUTERS.reduce((t, r) => t + f(r), 0);
    const looks = sum((r) => r.looks);
    console.log(
      `QA routing: ${ROUTERS.length} worlds, ${looks} looks, ${((sum((r) => r.ms) * 1000) / Math.max(1, looks)).toFixed(2)} µs a look (locks included); ${sum((r) => r.granted)} locks, ${sum((r) => r.refused)} asks refused, ${sum((r) => r.waitsBegun)} waits at points begun, ${sum((r) => r.restored)} points put back; plan choices ${planStats.choices} worked out, ${planStats.hits} cached, ${planStats.searches} searches`,
    );
  });

/**
 * The train invariants (src/sim/invariants.ts) on every QA world, as a dev build checks them: each world's breaks, by
 * the test that made it. INVARIANTS=0 leaves them off.
 */
export const CHECKED: { test: string; checks: ReturnType<typeof economyChecks> }[] = [];
export function checked(economy: Economy): void {
  if (ENV.INVARIANTS === "0") return;
  CHECKED.push({ test: expect.getState().currentTestName ?? "?", checks: economyChecks(economy) });
}

/** QA's layout builder (scratchpad/qa/ss/lib.js `H.line0`), on a plain Layout. */
export function line0(spec: { loops: number; ends?: number; mid?: number; pre?: PieceTypeId[] | null; branch?: PieceTypeId[]; branchFlips?: boolean[]; eastT?: PieceTypeId[]; sideAt?: boolean }) {
  const L = new Layout();
  const put = (type: PieceTypeId, flipped: boolean, ref: number, via = 0) => (ref === -1 ? L.addPiece(type, { x: 0, z: 0, heading: 0 }) : appendPiece(L, type, flipped, ref, via));
  const chain = (types: readonly PieceTypeId[], from: number, flips: readonly boolean[] = []) => {
    const ids: number[] = [];
    let ref = from;
    types.forEach((t, k) => {
      const id = put(t, !!flips[k], ref);
      ids.push(id);
      ref = connectorRef(id, 1);
    });
    return ids;
  };
  const ends = spec.ends ?? 2;
  const a = put("depot-forest", false, -1);
  put("buffer-turnback", false, connectorRef(a, 0));
  const west = chain(Array<PieceTypeId>(ends).fill("straight-216"), connectorRef(a, 1));
  let from = west.length ? connectorRef(west[west.length - 1], 1) : connectorRef(a, 1);
  const loops: ReturnType<typeof loopOn>[] = [];
  const middle: number[][] = [];
  for (let i = 0; i < spec.loops; i++) {
    const l = loopOn(L, from, ["straight-216", "straight-216"], ["straight-216"]);
    loops.push(l);
    from = connectorRef(l.s2, 0);
    if (i + 1 < spec.loops && (spec.mid ?? 3) > 0) {
      const m = chain(Array<PieceTypeId>(spec.mid ?? 3).fill("straight-216"), from);
      middle.push(m);
      from = connectorRef(m[m.length - 1], 1);
    }
  }
  let br: { j: number; bt: number[]; z: number } | null = null;
  if (spec.branch && spec.pre) {
    const pre = chain(spec.pre, from);
    from = connectorRef(pre[pre.length - 1], 1);
  }
  if (spec.branch) {
    const j = put("switch", false, from);
    const bt = chain(spec.branch, connectorRef(j, 2), spec.branchFlips ?? []);
    const z = bt[bt.length - 1];
    put("buffer-turnback", false, connectorRef(z, 1));
    br = { j, bt, z };
    from = connectorRef(j, 1);
  }
  const east = chain([...(spec.eastT ?? Array<PieceTypeId>(ends).fill("straight-216")), "depot-sawmill"], from);
  put("buffer-turnback", false, connectorRef(east[east.length - 1], 1));
  const sim = new Sim(L);
  const economy = new Economy(L, sim);
  checked(economy);
  if (ROUTERS) {
    economy.router.timing = true;
    ROUTERS.push(economy.router);
  }
  return { L, sim, economy, a, b: east[east.length - 1], west, east, loops, middle, br };
}

export type Q = ReturnType<typeof line0>;

export const depotsOf = new WeakMap<object, Map<number, ReturnType<Economy["addDepot"]>>>();
/** Worlds whose trains run idle: wagons put down full of logs, the sawmill kept full (nothing to load or unload). */
export const idleOf = new WeakSet<object>();

/** QA's `H.clearTrains`: every train off its line and off the track, the world kept (its history with it). */
export function clearTrains(q: { sim: Sim; economy: Economy }): void {
  for (const id of [...q.sim.trainIds()]) {
    const t = q.sim.getTrain(id);
    if (t) for (const c of t.cars) if (c.kind === "engine") stopLine(q.economy, c.id);
    q.sim.removeTrain(id);
  }
  q.economy.prune();
}

/** How long (s) a train is said stuck before the player puts one away (see `scen`). */
export const FIX_S = 10;

/** QA's `H.scen`: trains (piece, next stop, s, added at), one line of `stops`, `secs` seconds; forest piles topped up, sawmills' logs taken away. */
export function scen(q: Q, trains: { p: number; next?: number; s?: number; rev?: boolean; at?: number; spare?: boolean; when?: (E: readonly number[]) => boolean; offAt?: number; ps?: readonly number[]; ss?: readonly number[]; shared?: boolean }[], stops: number[], secs: number, cars: CarKind[] = ["engine", "timber", "timber"], events: { at: number; fn: (E: readonly number[]) => void }[] = [], fix = false) {
  // (Depots made once per world: a sequence of runs in one world reuses them.)
  const depots = depotsOf.get(q) ?? new Map<number, ReturnType<Economy["addDepot"]>>();
  depotsOf.set(q, depots);
  for (const p of stops) if (!depots.has(p)) depots.set(p, q.economy.addDepot(q.L.getPiece(p)!.type === "depot-forest" ? "forest" : "sawmill", p, 0));
  const E: number[] = [];
  const spare: boolean[] = [];
  let stillFrom = 0;
  let allStill = 0;
  // (The same for the trains on the line only: one taken off it may shuttle between them while they stand.)
  let lineFrom = 0;
  let lineStill = 0;
  let tickMs = 0;
  if (ENV.BENCH) q.economy.sections.timing = true;
  let ringFrom = 0;
  let longestRing = 0;
  const meets: number[] = [];
  const arrAt: { e: number; t: number }[] = [];
  const goodsAt: number[] = [];
  const cardLog: { e: number; t: number; c: string }[] = [];
  let stale = 0;
  // (How often each train's card changed, and the stalls begun (stalls.ts), over the run.)
  const lastCard = new Map<number, string>();
  const flips = new Map<number, number>();
  const stalls0 = q.economy.stalls.begun;
  let lineId = -1;
  const add = (t: (typeof trains)[number]) => {
    // (`ps`: the first piece of these with no train on it, at the first of `ss` that fits: QA's put-down on a road.)
    let placed = q.sim.addTrain(cars, { pieceId: t.p, pathIndex: 0, reversed: !!t.rev, s: t.s ?? 100 });
    if (t.ps) {
      const taken = (p: number) => q.sim.trainIds().some((id) => q.sim.getTrain(id)!.bogies.some((b) => b.pieceId === p));
      for (const p of t.ps) {
        if (placed.kind === "placed" || (taken(p) && !t.shared)) continue;
        for (const s0 of t.ss ?? [100]) {
          placed = q.sim.addTrain(cars, { pieceId: p, pathIndex: 0, reversed: !!t.rev, s: s0 });
          if (placed.kind === "placed") break;
        }
      }
    }
    if (placed.kind !== "placed") {
      // (QA's NOROOM: one put down later where a train stands isn't put down.)
      if (t.at || t.when) return false;
      throw new Error(`no room on ${t.p}`);
    }
    const e = q.sim.getTrain(placed.trainId)!.cars[0].id;
    // (PREFILL: its wagons put down full of logs, so they've nothing to load at the forest.)
    if (ENV.PREFILL || idleOf.has(q)) for (const c of q.sim.getTrain(placed.trainId)!.cars) if (c.kind !== "engine") q.economy.setCargo(c.id, "log", q.economy.wagonCapacity);
    E.push(e);
    spare.push(!!t.spare);
    // (A spare: standing, lever off, not on the line.)
    if (t.spare) return;
    q.sim.setLever(e, 1);
    if (lineId === -1) lineId = editLine(q.economy, e, (s) => s.push(...stops.map((p) => ({ depotId: depots.get(p)!.id, action: "auto" as const }))))!.id;
    else joinLine(q.economy, e, lineId);
    q.economy.routeOf(e)!.next = t.next ?? 0;
  };
  for (const t of trains) if (!t.at && !t.when) add(t);
  /** Seconds each train has been said stuck (the player's fix, below), and the trains put away for it. */
  const stuckFor = new Map<number, number>();
  const fixes: { t: number; e: number }[] = [];
  const whenDone = new Set<(typeof trains)[number]>();
  let whenAt = -1;
  const arr = new Map<number, number>();
  const prevAt = new Map<number, boolean>();
  const lastTurn = new Map<number, number>();
  let meet = 0;
  let overlaps = 0;
  let shared = new Set<string>();
  let overlapAt = "";
  const cards = new Set<string>();
  // (Each train's cards, and how many samples, a sample a quarter second.)
  const cardsOf = new Map<number, Map<string, number>>();
  const traceLast = new Map<number, string>();
  for (let tick = 0; tick < secs * SIM_HZ; tick++) {
    for (const t of trains) if (t.at && Math.round(t.at * SIM_HZ) === tick) add(t);
    for (const ev of events) if (Math.round(ev.at * SIM_HZ) === tick) ev.fn(E);
    // (Taken off its line while running: lever left on, it runs on, no line's.)
    trains.forEach((t, k) => {
      if (t.offAt && Math.round(t.offAt * SIM_HZ) === tick && E[k] !== undefined) stopLine(q.economy, E[k]);
    });
    // (Put down the first moment `when` holds.)
    for (const t of trains)
      if (t.when && !whenDone.has(t) && t.when(E) && add(t) !== false) {
        whenDone.add(t);
        whenAt = tick / SIM_HZ;
      }
    // (The forest kept stocked. The sawmill: SAW_FULL, or an idle world, keeps its logs at its cap, so trains can't unload
    // there and run through; otherwise its logs are taken away, so it always has room for them: trains load only what a
    // later stop has room for, and with the sawmill full they'd run empty.)
    for (const d of q.economy.allDepots()) {
      if (d.role === "forest") d.piles[CARGO.log.index] = Math.max(d.piles[CARGO.log.index], 6);
      if (d.role === "sawmill") d.piles[CARGO.log.index] = ENV.SAW_FULL || idleOf.has(q) ? capAt(d) : 0;
    }
    const t0 = performance.now();
    q.sim.tick();
    q.economy.tick();
    tickMs += performance.now() - t0;
    // The player's fix (`fix`: a harness step for layouts that jam now nothing turns a train back, standing in for the
    // player reading the card; NOFIX=1 leaves stalls be): once a train has been said stuck (stalls.ts) for `FIX_S`, the
    // player taps Put away, as its card says: for too many trains, the one its line holds for want of room; for one in
    // the way, one on no line of those stuck (a stray), else the one last put down.
    if (fix && !ENV.NOFIX && tick % SIM_HZ === 0) {
      let due = -1;
      for (const e of E) {
        if (q.economy.stalls.stuckOf(e) && q.sim.findCar(e)) stuckFor.set(e, (stuckFor.get(e) ?? 0) + 1);
        else stuckFor.delete(e);
        if ((stuckFor.get(e) ?? 0) >= FIX_S && due === -1) due = e;
      }
      if (due !== -1) {
        const held = q.economy.stalls.stuckOf(due)!.kind === "too-many" ? E.find((e) => q.sim.findCar(e) && q.economy.sections.heldForRoom(e)) : undefined;
        const off = held ?? E.find((e) => stuckFor.has(e) && !q.economy.lineIdOf.has(e)) ?? [...E].reverse().find((e) => stuckFor.has(e))!;
        putAway(q.sim, q.economy, off);
        fixes.push({ t: tick / SIM_HZ, e: off });
        stuckFor.clear();
      }
    }
    // (Goods delivered: each load unloaded at a stop, as QA counts them.)
    for (const ev of q.economy.drainEvents()) if (ev.kind === "unloaded") goodsAt.push(tick / SIM_HZ);
    // (The longest stretch with every train of the line standing still.)
    let moving = false;
    for (let k = 0; k < E.length; k++) if (!spare[k] && (q.sim.findCar(E[k])?.train.speed ?? 0) >= 1) moving = true;
    if (moving || E.length === 0) stillFrom = tick;
    else allStill = Math.max(allStill, (tick - stillFrom) / SIM_HZ);
    let lineMoving = false;
    let onLine = 0;
    for (let k = 0; k < E.length; k++)
      if (!spare[k] && q.economy.lineIdOf.has(E[k])) {
        onLine++;
        if ((q.sim.findCar(E[k])?.train.speed ?? 0) >= 1) lineMoving = true;
      }
    if (lineMoving || onLine === 0) lineFrom = tick;
    else lineStill = Math.max(lineStill, (tick - lineFrom) / SIM_HZ);
    // (The longest a ring of waits lasted: trains of the line each waiting on the next, round to the first.)
    const on = (e: number) => {
      const w = q.economy.sections.waitOf(e);
      return w && "engine" in w ? w.engine : -1;
    };
    let ring = false;
    for (const e of E) {
      let x = on(e);
      for (let k = 0; k < E.length && x !== -1 && x !== e; k++) x = on(x);
      if (x === e) ring = true;
    }
    if (!ring) ringFrom = tick;
    else longestRing = Math.max(longestRing, (tick - ringFrom) / SIM_HZ);
    // (Two trains on one piece at once: from each one's last axle to its first, as sections count it.)
    // (The line's own trains, each pair counted as it comes to share one: not a spare put down beside one.)
    const under = new Map<number, number>();
    const sharing = new Set<string>();
    for (let k = 0; k < E.length; k++) {
      const tr = q.sim.findCar(E[k])?.train;
      if (!tr || spare[k] || !q.economy.lineIdOf.has(E[k])) continue;
      for (const p of q.sim.piecesUnder(tr.id)) {
        const o = under.get(p);
        if (o !== undefined && o !== k) sharing.add(`${o}-${k}`);
        under.set(p, k);
      }
    }
    for (const pair of sharing)
      if (!shared.has(pair)) {
        if (overlaps === 0) overlapAt = `${(tick / SIM_HZ).toFixed(1)}s e${pair}`;
        overlaps++;
      }
    shared = sharing;
    for (const e of E) {
      const tr = q.sim.findCar(e)?.train;
      if (!tr) continue;
      const at = q.economy.routeOf(e)?.at ?? false;
      if (at && !prevAt.get(e)) {
        arr.set(e, (arr.get(e) ?? 0) + 1);
        arrAt.push({ e, t: tick / SIM_HZ });
      }
      prevAt.set(e, at);
      // (Met head on: held nose to nose by another train, counted once a meeting.)
      const nose = q.sim.heldHow(tr.id) === "nose";
      if (nose && lastTurn.get(e) !== tick - 1) {
        meet++;
        meets.push(tick / SIM_HZ);
        if (TRACE) console.log(`MEET ${(tick / SIM_HZ).toFixed(1)} e${e}`);
      }
      if (nose) lastTurn.set(e, tick);
      if (TRACE && tick % 30 === 0) {
        const key = `${tr.speed < 1 ? [...new Set(tr.bogies.map((b) => b.pieceId))].join(",") : "m"} ${q.economy.routeOf(e)?.at ? "AT" : "->"}${q.economy.routeOf(e)?.next} ${JSON.stringify(q.economy.sections.stateOf(e))} ${JSON.stringify(q.economy.sectionWait(e))} ${tr.lastTurn?.cause ?? ""}${tr.turnback >= 0 ? " TB" : ""}`;
        if (traceLast.get(e) !== key) {
          traceLast.set(e, key);
          console.log(`T ${(tick / SIM_HZ).toFixed(1)} e${e} v${tr.speed.toFixed(0)} ${key} held ${q.sim.heldBy(tr.id)}/${q.sim.heldHow(tr.id)} clear ${q.economy.sections.clearWait(tr.id)} stuck ${JSON.stringify(q.economy.stalls.stuckOf(e))} lever ${tr.cars.map((c) => c.lever).join("")} t${tr.id}`);
        }
      }
      if (tick % 30 === 0) {
        const c = engineStatus(q.sim, q.economy, e, (id) => (q.economy.depot(id)?.role === "forest" ? "forest" : "sawmill"));
        cards.add(c);
        const m = cardsOf.get(e) ?? new Map<string, number>();
        cardsOf.set(e, m);
        m.set(c, (m.get(c) ?? 0) + 1);
        cardLog.push({ e, t: tick / SIM_HZ, c });
        if (lastCard.has(e) && lastCard.get(e) !== c) flips.set(e, (flips.get(e) ?? 0) + 1);
        lastCard.set(e, c);
        // (A train with room showing the held train's card: QA saw one, just after admission changed.)
        const adm = (q.economy.sections as unknown as { admitted: Map<number, Set<number>> }).admitted.get(lineId);
        if (c.startsWith("Waiting: lay") && adm?.has(e)) stale++;
      }
    }
  }
  /** The share of `e`'s samples whose card matches `re`. */
  if (ENV.BENCH) console.log(`BENCH ms/tick ${(tickMs / (secs * SIM_HZ)).toFixed(4)} capUs ${((q.economy.sections.capMs * 1000) / Math.max(1, q.economy.sections.capCalls)).toFixed(2)}`);
  const share = (e: number, re: RegExp) => {
    const m = cardsOf.get(e);
    if (!m) return 0;
    let n = 0;
    let all = 0;
    for (const [c, k] of m) {
      all += k;
      if (re.test(c)) n += k;
    }
    return all ? n / all : 0;
  };
  return { E, spare, arrivals: E.map((e) => arr.get(e) ?? 0), meet, overlaps, overlapAt, cards, cardsOf, cardLog, stale, flips, stalls: q.economy.stalls.begun - stalls0, stuck: q.economy.stalls.count, fixes, share, allStill, lineStill, goodsAt, longestRing, meets, arrAt, whenAt, released: q.economy.sections.released, cut: q.economy.sections.cut };
}

/** A card that says what's wrong and what to do: stuck (stalls.ts), held for want of a loop, or the line full. */
export const SAYS_FIX = /^Stuck: |^Waiting: (lay \d|the line is full|unpin|a parked train|another train is in the way)|^Can't reach /;

/**
 * Nothing turns a train back now (routing §16 Q3), so a layout with a train too many, or one in another's way, stands
 * rather than shuttling on. Each train of the line that hasn't kept
 * delivering (`min` arrivals or fewer) has said what to do (`SAYS_FIX`) in its last minute: none stands unexplained.
 * (Spares, lever off, are the player's own.)
 */
export function runsOrSays(r: { E: readonly number[]; spare: readonly boolean[]; arrivals: readonly number[]; cardLog: readonly { e: number; t: number; c: string }[] }, secs: number, min = 5): string[] {
  const bad: string[] = [];
  r.E.forEach((e, k) => {
    if (r.spare[k] || r.arrivals[k] > min) return;
    const late = [...new Set(r.cardLog.filter((x) => x.e === e && x.t > secs - 60).map((x) => x.c))];
    if (!late.some((c) => SAYS_FIX.test(c))) bad.push(`e${e} (${r.arrivals[k]} arrivals): ${late.join(" | ")}`);
  });
  return bad;
}

export const cars: CarKind[] = ["engine", "timber", "timber"];
export const two = () => {
  const q = line0({ loops: 2, mid: 1, ends: 1 });
  const [l0, l1] = q.loops;
  const R3 = [{ p: q.west[0], next: 0, s: 200 }, { p: q.east[0], next: 1, s: 200 }, { p: q.middle[0][0], next: 1, s: 200 }];
  return { q, l0, l1, R3 };
};
export const one = () => {
  const q = line0({ loops: 1, ends: 1 });
  return { q, l: q.loops[0], R2: [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }] };
};
export const show = (nm: string, r: ReturnType<typeof scen>) => {
  if (ENV.SHOW) for (const e of r.E) console.log(`PARK ${nm} e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
  if (ENV.SHOW) console.log(`PARK ${nm}: arrivals ${r.arrivals.join("/")} meet ${r.meet} released ${r.released} stalls ${r.stalls} flips ${r.E.map((e) => r.flips.get(e) ?? 0).join("/")} cards ${[...r.cards].join(" | ")}`);
  return r;
};
export type L = Q["loops"][0];
export type T = { p: number; next?: number; s?: number; at?: number; spare?: boolean; ps?: readonly number[]; ss?: readonly number[]; when?: (E: readonly number[]) => boolean };
/** Pin a loop's switches, each set so a train coming at it from its stem takes `roads` ("main" or "side"). */
export const pin = (q: Q, l: Q["loops"][0], roads: readonly ["main" | "side", "main" | "side"]) => {
  for (const [k, sw] of [l.s1, l.s2].entries()) {
    for (let state = 0; state < 2; state++) {
      q.L.setSwitchState(sw, state);
      q.L.setPinned(sw, true);
      const w = waysFrom(q.L, sw, 0)[0];
      const n = w ? next(q.L, sw, w.exit) : null;
      const on = n && l.main.includes(n.pieceId) ? "main" : "side";
      if (on === roads[k]) break;
      q.L.setPinned(sw, false);
    }
  }
};
// QA's B5 sweep (j_put_spare3.js), in its order, in one world: road x T x mode. After T s, wait for a runner heading
// into the road ("heading": a move to it granted, under way, not on it yet) or standing on it ("behind"), then put
// a spare (lever off, no line) on the road's first free piece; run 180 s. On 4ffce95 it froze at l1.main, 45 s,
// heading: the runner between the loops waited on no one named, for good.
export const qb5 = (idle: boolean, only?: string) => {
  const bad: string[] = [];
  const { q, l0, l1, R3 } = two();
  if (idle) idleOf.add(q);
  const roads = ([["l0.main", l0.main], ["l0.side", l0.side], ["l1.main", l1.main]] as [string, readonly number[]][]).filter(([rn]) => !only || rn === only);
  for (const [rn, pieces] of roads)
    for (const T of [10, 20, 30, 45])
      for (const mode of ["heading", "behind"] as const) {
        clearTrains(q);
        const when = (E: readonly number[]) => {
          if (q.sim.ticks - start < T * SIM_HZ) return false;
          const t0 = q.sim.findCar(E[0])?.train;
          if (!t0) return false;
          const slot = topologyOf(q.L, trainLength(t0)).slotOf.get(pieces[1]);
          return E.some((e) => {
            const t = q.sim.findCar(e)!.train;
            const on = t.bogies.some((b) => pieces.includes(b.pieceId));
            if (mode === "behind") return t.speed < 1 && on;
            const st = q.economy.sections.stateOf(e);
            return !!st?.move && st.move.dest === slot && t.speed >= 1 && !on;
          });
        };
        const start = q.sim.ticks;
        const r = scen(q, [...R3, { p: pieces[0], ps: pieces, ss: [100, 60, 140, 30], spare: true, when }], [q.a, q.b], T + 150 + 180, cars);
        const after = r.whenAt < 0 ? -1 : r.whenAt;
        const meets = r.meets.filter((t) => after >= 0 && (t < after || t > after + 3)).length;
        const says = [...r.cards].some((c) => /ay \d+ more|Move it/.test(c)) || runsOrSays(r, T + 150 + 180, 3).length === 0;
        const line = `${rn} T${T} ${mode}: put ${after < 0 ? "none" : after.toFixed(0)} -> ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} meets ${meets} released ${r.released}`;
        if (ENV.SHOW) console.log(`QB5 ${line}${says ? " (says)" : ""}`);
        if (meets > 0 || r.released > 0 || (r.allStill > 60 && !says)) bad.push(line);
        // (Nor two of the line's trains on one piece: one split across a loop's roads, say.)
        if (r.overlaps > 0) bad.push(`${line}: two trains on one piece at ${r.overlapAt}`);
      }
  return bad;
};

// B4, and the invariant behind it: one train put down on any loop road at any moment, ahead of a runner or not. None
// bump (bar one put down in front of a moving train). Before, no ring of waits outlasted its breaking, the line never
// stood still for long, and two or more of the four kept delivering, by turning trains back. Nothing turns a train
// back now (routing §16 Q3): where it can't run, every train that doesn't deliver says what to do (`runsOrSays`).
// (Split by loop between sections-qa-b4-l0 and -l1.test.ts: each (road, time) is a world of its own, so the halves are
// the same cases, run in parallel.)
export function b4Sweep(forRoads: readonly string[]): string[] {
  const bad: string[] = [];
  const roads = ENV.ROADS ? ENV.ROADS.split(",") : forRoads;
  const ats = ENV.ATS ? ENV.ATS.split(",").map(Number) : Array.from({ length: 24 }, (_, k) => 4 + k * 4);
  for (const road of roads)
    for (const at of ats) {
      const { q, l0, l1, R3 } = two();
      const l = road.startsWith("l0") ? l0 : l1;
      const p = road.endsWith("side") ? l.side[1] : l.main[0];
      const r = scen(q, [...R3, { p, next: road.startsWith("l0") ? 1 : 0, s: 100, at }], [q.a, q.b], at + 240, cars);
      if (r.E.length < 4) continue;
      const running = r.arrivals.filter((a) => a > 3).length;
      // (A train put down within a moving one's braking distance is bumped: nothing can stop that. Any other bump counts.)
      const meets = r.meets.filter((t) => t < at || t > at + 3).length;
      if (ENV.SHOW) console.log(`B4 ${road} at ${at}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meet ${r.meet} (${meets} not at the put-down) rel ${r.released} stalls ${r.stalls} cut ${r.cut}`);
      const unsaid = runsOrSays(r, at + 240, 3);
      if (meets > 0 || ((r.allStill > 60 || r.longestRing > STUCK_S + 3 || running < 2) && unsaid.length > 0)) bad.push(`${road} at ${at}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} s, ring ${r.longestRing.toFixed(1)} s, meets ${meets}; unsaid ${unsaid.join("; ")}`);
    }
  return bad;
}

/**
 * Breaks the invariants found on main when they were first run here (claude/harden-1, 2026-10-31), by the test whose
 * world broke them, and why. Each is a bug to fix (reported to the CoS); when a fix lands, take its entry off (the
 * guard below fails on an entry that no longer breaks).
 */
export const KNOWN_BREAKS: { test: string; invariant: Invariant; why: string }[] = [
  // (Routing redesign step 0's invariants, known to break today: docs/superpowers/specs/2026-11-07-routing-redesign.md §4.)
  { test: "QA's N2: a train taken off its line", invariant: "oneOwner", why: "trains put down by hand on the loop's points (0.0 s), and one taken off its line running onto points another is on (step 6)" },
];

/** The guard, for each file that runs QA worlds: its own worlds' breaks (`CHECKED` is per file, as each file is a module of its own). */
export function invariantsHold(): void {
  describe("the train invariants (src/sim/invariants.ts)", () => {
    it.skipIf(ENV.INVARIANTS === "0")("hold in every QA world, but the breaks known on main (KNOWN_BREAKS)", () => {
      const known = (test: string, k: Invariant) => KNOWN_BREAKS.some((b) => b.invariant === k && test.includes(b.test));
      const broke: string[] = [];
      for (const c of CHECKED) for (const k of INVARIANTS) if (c.checks.broke[k].count > 0 && !known(c.test, k)) broke.push(`${c.test}: ${k} ×${c.checks.broke[k].count}: ${c.checks.broke[k].first.join(" | ")}`);
      if (ENV.SHOW || broke.length > 0) console.log(`QA invariants:\n${CHECKED.filter((c) => c.checks.count > 0).map((c) => `${c.test}: ${c.checks.summary()}`).join("\n")}`);
      expect(broke, "broken, and not known").toEqual([]);
      // (Known, its test run, and no longer broken: fixed, so off the list.)
      const ran = KNOWN_BREAKS.filter((b) => CHECKED.some((c) => c.test.includes(b.test)));
      const fixed = ran.filter((b) => !CHECKED.some((c) => c.test.includes(b.test) && c.checks.broke[b.invariant].count > 0));
      expect(fixed.map((b) => `${b.test}: ${b.invariant}`), "known breaks that no longer break (take them off)").toEqual([]);
    });
  });
}
