import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine, stopLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { CARGO } from "./cargo";
import { Economy } from "./economy";
import { topologyOf, trainLength, YIELD_S } from "./sections";
import { loopOn } from "./loop-fixtures";
import { next, waysFrom } from "./steer";

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const TRACE = !!ENV.TRACE;

/** QA's layout builder (scratchpad/qa/ss/lib.js `H.line0`), on a plain Layout. */
function line0(spec: { loops: number; ends?: number; mid?: number; pre?: PieceTypeId[] | null; branch?: PieceTypeId[]; branchFlips?: boolean[]; eastT?: PieceTypeId[]; sideAt?: boolean }) {
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
  return { L, sim, economy, a, b: east[east.length - 1], west, east, loops, middle, br };
}

type Q = ReturnType<typeof line0>;

const depotsOf = new WeakMap<object, Map<number, ReturnType<Economy["addDepot"]>>>();

/** QA's `H.clearTrains`: every train off its line and off the track, the world kept (its history with it). */
function clearTrains(q: { sim: Sim; economy: Economy }): void {
  for (const id of [...q.sim.trainIds()]) {
    const t = q.sim.getTrain(id);
    if (t) for (const c of t.cars) if (c.kind === "engine") stopLine(q.economy, c.id);
    q.sim.removeTrain(id);
  }
  q.economy.prune();
}

/** QA's `H.scen`: trains (piece, next stop, s, added at), one line of `stops`, `secs` seconds; forest piles topped up, sawmills' logs taken away. */
function scen(q: Q, trains: { p: number; next?: number; s?: number; rev?: boolean; at?: number; spare?: boolean; when?: (E: readonly number[]) => boolean; offAt?: number; ps?: readonly number[]; ss?: readonly number[]; shared?: boolean }[], stops: number[], secs: number, cars: CarKind[] = ["engine", "timber", "timber"], events: { at: number; fn: (E: readonly number[]) => void }[] = []) {
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
  const cardLog: { e: number; t: number; c: string }[] = [];
  let stale = 0;
  // (How often each train's card changed, and the turn-backs sections made, over the run.)
  const lastCard = new Map<number, string>();
  const flips = new Map<number, number>();
  const sec0 = q.economy.sections;
  const turns0 = sec0.turnedShort + sec0.yielded + sec0.gaveWay;
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
  const whenDone = new Set<(typeof trains)[number]>();
  let whenAt = -1;
  const arr = new Map<number, number>();
  const prevAt = new Map<number, boolean>();
  const lastTurn = new Map<number, number>();
  let meet = 0;
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
    // (And the sawmill's logs taken away, so it always has room for them: the trains have work at both depots, run after
    // run in one world. Trains load only what a later stop has room for: with the sawmill full they'd run empty.)
    for (const d of q.economy.allDepots()) {
      if (d.role === "forest") d.piles[CARGO.log.index] = Math.max(d.piles[CARGO.log.index], 6);
      if (d.role === "sawmill") d.piles[CARGO.log.index] = 0;
    }
    const t0 = performance.now();
    q.sim.tick();
    q.economy.tick();
    tickMs += performance.now() - t0;
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
    for (const e of E) {
      const tr = q.sim.findCar(e)?.train;
      if (!tr) continue;
      const at = q.economy.routeOf(e)?.at ?? false;
      if (at && !prevAt.get(e)) {
        arr.set(e, (arr.get(e) ?? 0) + 1);
        arrAt.push({ e, t: tick / SIM_HZ });
      }
      prevAt.set(e, at);
      const lt = tr.lastTurn;
      if (lt && lastTurn.get(e) !== lt.tick) {
        lastTurn.set(e, lt.tick);
        if (lt.cause === "train") {
          meet++;
          meets.push(tick / SIM_HZ);
          if (TRACE) console.log(`MEET ${(tick / SIM_HZ).toFixed(1)} e${e}`);
        }
      }
      if (TRACE && tick % 30 === 0) {
        const key = `${tr.speed < 1 ? [...new Set(tr.bogies.map((b) => b.pieceId))].join(",") : "m"} ${q.economy.routeOf(e)?.at ? "AT" : "->"}${q.economy.routeOf(e)?.next} ${JSON.stringify(q.economy.sections.stateOf(e))} ${JSON.stringify(q.economy.sectionWait(e))} ${tr.lastTurn?.cause ?? ""}${tr.turnback >= 0 ? " TB" : ""}`;
        if (traceLast.get(e) !== key) {
          traceLast.set(e, key);
          console.log(`T ${(tick / SIM_HZ).toFixed(1)} e${e} v${tr.speed.toFixed(0)} ${key}`);
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
        if (c.startsWith("Waiting: lay") && adm?.has(e) && q.economy.sections.waitOf(e)?.kind !== "stalled") stale++;
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
  return { E, arrivals: E.map((e) => arr.get(e) ?? 0), meet, cards, cardsOf, cardLog, stale, flips, turns: sec0.turnedShort + sec0.yielded + sec0.gaveWay - turns0, share, allStill, lineStill, longestRing, meets, arrAt, whenAt, released: q.economy.sections.released, yielded: q.economy.sections.yielded, cut: q.economy.sections.cut };
}

describe("sections: QA's cases (P2 review)", { timeout: 300_000 }, () => {
  it("B1: a branching line, 1 loop, 3 trains, the third held on the branch: no head-ons, the others keep running", () => {
    for (const pre of ENV.PRE ? [["straight-216"] as PieceTypeId[]] : [null, ["straight-216"] as PieceTypeId[]])
      for (const at of ENV.AT ? [Number(ENV.AT)] : [0, 6]) {
        const q = line0({ loops: 1, ends: 1, pre, branch: ["curve-large", "straight-216", "straight-216", "depot-sawmill"], branchFlips: [true], eastT: pre ? ["straight-216"] : ["straight-216", "straight-216"] });
        const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 2, s: 200 }, { p: q.br!.bt[2], next: 0, s: 200, at: at || undefined }], [q.a, q.b, q.a, q.br!.z], 240);
        expect(r.meet, `pre ${!!pre} at ${at}`).toBe(0);
        expect(r.arrivals[0], `pre ${!!pre} at ${at}: A`).toBeGreaterThan(4);
        expect(r.arrivals[1], `pre ${!!pre} at ${at}: B`).toBeGreaterThan(4);
        expect(r.released).toBe(0);
        expect([...r.cards]).toContain("Waiting: lay 1 more passing loop for 3 trains");
      }
  });

  it("N1: a spare train parked on a loop road is held there; the others run through the loop by its other road", () => {
    for (const [loops, extra] of [
      [1, 1],
      [1, 2],
    ] as const) {
      const q = line0({ loops });
      const l = q.loops[0];
      const more = [{ p: l.side[1], next: 0 }, ...(extra > 1 ? [{ p: l.main[0], next: 0 }] : [])].slice(0, extra);
      // (Two extras: one each road; then only one runs.)
      const r = scen(q, [{ p: q.west[0], next: 1, rev: true }, { p: q.east[0], next: 0 }, ...more], [q.a, q.b], 300);
      expect(r.meet, `${extra} extra`).toBe(0);
      expect(r.released).toBe(0);
      // (Its other road is no passing place: one runner, the other held, saying so.)
      expect(Math.max(r.arrivals[0], r.arrivals[1]), `${extra} extra: a runner`).toBeGreaterThan(6);
      expect([...r.cards].some((c) => c.startsWith("Waiting: lay "))).toBe(true);
    }
  });

  it("N1: two trains face to face mid-line, no loop: one gives way, no head-on", () => {
    const q = line0({ loops: 0, ends: 4 });
    const r = scen(q, [{ p: q.west[2], next: 1 }, { p: q.east[0], next: 0, rev: true }], [q.a, q.b], 240);
    expect(r.meet).toBe(0);
    expect(Math.max(...r.arrivals)).toBeGreaterThan(6);
  });

  it("N2: a train put down just short of one loading at its stop, facing it, doesn't bump it", () => {
    const q = line0({ loops: 1, ends: 2 });
    // The first stands loading at Y (the east end); the second goes down two pieces short of it, facing it.
    const r = scen(q, [{ p: q.b, next: 1 }, { p: q.east[0], next: 1, s: 80 }], [q.a, q.b], 120);
    expect(r.meet).toBe(0);
  });

  it("N3: a train that can't reach its stop past a held train says so, and how many loops to lay", () => {
    const q = line0({ loops: 1 });
    const l = q.loops[0];
    const r = scen(q, [{ p: q.west[0], next: 1, rev: true }, { p: q.east[0], next: 0 }, { p: q.east[1], next: 0, rev: true }], [q.a, q.b], 240);
    void l;
    expect(r.meet).toBe(0);
    const cards = [...r.cards];
    expect(cards.some((c) => /^Can't reach sawmill: the line is full\. Lay 1 more passing loop$/.test(c) || /^Turning back early: the line is full\. Lay 1 more passing loop$/.test(c))).toBe(true);
    // (QA: trains with room, waiting a moment at the loop for a line-mate, showed "Waiting: lay 1 more…" about 30% of
    // the time. That card is for the held train only.)
    expect(r.share(r.E[0], /^Waiting: lay/)).toBe(0);
    expect(r.share(r.E[1], /^Waiting: lay/)).toBe(0);
    // (QA: the train turning back early showed "On its way to sawmill" about 45% of its cycle. It's on its way to
    // sawmill only while it hasn't yet found it can't get there: a few seconds at the start.)
    if (ENV.SHOW) for (const e of r.E) console.log(`N3 e${e}`, [...r.cardsOf.get(e)!].map(([c, n]) => `${c} x${n}`).join(" | "));
    expect(r.share(r.E[0], /^On its way to sawmill$/)).toBeLessThan(0.1);
  });
});

describe("sections: QA's B2/B3 park cases", { timeout: 600_000 }, () => {
  const cars: CarKind[] = ["engine", "timber", "timber"];
  const two = () => {
    const q = line0({ loops: 2, mid: 1, ends: 1 });
    const [l0, l1] = q.loops;
    const R3 = [{ p: q.west[0], next: 0, s: 200 }, { p: q.east[0], next: 1, s: 200 }, { p: q.middle[0][0], next: 1, s: 200 }];
    return { q, l0, l1, R3 };
  };
  const one = () => {
    const q = line0({ loops: 1, ends: 1 });
    return { q, l: q.loops[0], R2: [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }] };
  };
  const show = (nm: string, r: ReturnType<typeof scen>) => {
    if (ENV.SHOW) for (const e of r.E) console.log(`PARK ${nm} e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
    if (ENV.SHOW) console.log(`PARK ${nm}: arrivals ${r.arrivals.join("/")} meet ${r.meet} released ${r.released} turns ${r.turns} flips ${r.E.map((e) => r.flips.get(e) ?? 0).join("/")} cards ${[...r.cards].join(" | ")}`);
    return r;
  };
  it("B2 base: 2 loops, 3 trains", () => {
    const { q, R3 } = two();
    const r = show("base3", scen(q, R3, [q.a, q.b], 300, cars));
    expect(r.meet).toBe(0);
    expect([...r.cards].filter((c) => c.startsWith("Waiting: lay"))).toEqual([]);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(5);
  });
  // (Cards: the one a held train shows, naming how many loops to lay; `lay` 0: a loop with a train not on the line on
  // each road cuts the line, and the card says to move it instead.)
  const says = (r: ReturnType<typeof scen>, lay: number, trains: number) => {
    if (lay === 0) {
      expect([...r.cards].some((c) => c === "Waiting: a parked train is in the way. Move it"), "held").toBe(true);
      expect([...r.cards].filter((c) => /[Ll]ay \d+ more/.test(c))).toEqual([]);
      return;
    }
    const n = `${lay} more passing loop${lay === 1 ? "" : "s"}`;
    expect([...r.cards].some((c) => c.startsWith(`Waiting: lay ${n} for ${trains} trains`)), "held").toBe(true);
    // (And no card on the line asks for another number.)
    for (const c of r.cards) {
      const m = /[Ll]ay (\d+) more/.exec(c);
      if (m) expect(Number(m[1]), c).toBe(lay);
    }
  };
  // (A loop with a train held on one road is no passing place, but the line runs through it by the other; held on
  // both, nothing passes. With every loop lost and a train at each end and between, nothing can reach the far end:
  // no head-ons, no lock-up, and the cards say what to build. That's all it can do.)
  it("B2: 2 loops, 3 trains, a held train on each loop's side road: no head-ons, it says to lay 2 more loops", () => {
    const { q, l0, l1, R3 } = two();
    const r = show("held2", scen(q, [...R3, { p: l0.side[1], next: 1, s: 100 }, { p: l1.side[1], next: 0, s: 100 }], [q.a, q.b], 300, cars));
    expect(r.meet).toBe(0);
    expect(r.released).toBe(0);
    says(r, 2, 5);
  });
  it("B2: 2 loops, 3 trains, one held on loop 0's side road: loop 1 still lets three run", () => {
    const { q, l0, R3 } = two();
    const r = show("held1", scen(q, [...R3, { p: l0.side[1], next: 1, s: 100 }], [q.a, q.b], 300, cars));
    expect(r.meet).toBe(0);
    expect(r.released).toBe(0);
    // (Four trains, two loops: one held, the other three run; it says one more loop.)
    expect(r.arrivals.filter((a) => a > 4).length).toBeGreaterThanOrEqual(3);
    says(r, 1, 4);
  });
  type L = Q["loops"][0];
  type T = { p: number; next?: number; s?: number; at?: number; spare?: boolean; ps?: readonly number[]; ss?: readonly number[]; when?: (E: readonly number[]) => boolean };
  // [name, extra trains, how many keep running (more than 5 arrivals), loops to lay (0: move a spare), trains on the line]
  const parks1: [string, (l: L) => T[], number, number, number][] = [
    ["L1T3_heldSide", (l) => [{ p: l.side[1], next: 1, s: 100 }], 2, 1, 3],
    ["L1T3_heldMain", (l) => [{ p: l.main[0], next: 0, s: 200 }], 2, 1, 3],
    ["L1T3_spareSide (B3)", (l) => [{ p: l.side[1], spare: true, s: 100 }], 1, 1, 2],
    ["L1T4_heldBoth", (l) => [{ p: l.side[1], next: 1, s: 100 }, { p: l.main[0], next: 0, s: 200 }], 0, 2, 4],
    ["L1T4_spareBoth (B3)", (l) => [{ p: l.side[1], spare: true, s: 100 }, { p: l.main[0], spare: true, s: 200 }], 0, 0, 2],
  ];
  for (const [nm, extra, runners, lay, trains] of parks1)
    it(`park ${nm}: no head-ons, ${runners} running, lay ${lay} more`, () => {
      const { q, l, R2 } = one();
      const r = show(nm, scen(q, [...R2, ...extra(l)], [q.a, q.b], 600, cars));
      expect(r.meet).toBe(0);
      expect(r.released).toBe(0);
      expect(r.arrivals.filter((a) => a > 5).length).toBeGreaterThanOrEqual(runners);
      says(r, lay, trains);
    });
  const parks2: [string, (a: L, b: L) => T[], number, number, number][] = [
    ["L2T5_heldOneEach", (a, b) => [{ p: a.side[1], next: 1, s: 100 }, { p: b.side[1], next: 0, s: 100 }], 0, 2, 5],
    ["L2T5_heldBothL0", (a) => [{ p: a.side[1], next: 1, s: 100 }, { p: a.main[0], next: 0, s: 200 }], 2, 2, 5],
    ["L2T5_spareOneEach (B3)", (a, b) => [{ p: a.side[1], spare: true, s: 100 }, { p: b.side[1], spare: true, s: 100 }], 0, 2, 3],
    ["L2T5_spareBothL0 (B3)", (a) => [{ p: a.side[1], spare: true, s: 100 }, { p: a.main[0], spare: true, s: 200 }], 2, 0, 3],
    // (Late joins, QA's j_park4: adding one train to a working 2-loop line holds that one, not two.)
    ["T4_side0_at0", (a) => [{ p: a.side[1], next: 1, s: 100 }], 3, 1, 4],
    ["T4_side1_at30", (_a, b) => [{ p: b.side[1], next: 0, s: 100, at: 30 }], 3, 1, 4],
    ["T4_side0_at45", (a) => [{ p: a.side[1], next: 1, s: 100, at: 45 }], 3, 1, 4],
    // (B4: put down at 30 s on loop 1's side road, nose to nose with a runner already let into that road.)
    ["B4_l1side_at30", (_a, b) => [{ p: b.side[1], next: 0, s: 100, at: 30 }], 3, 1, 4],
    ["B4_l0side_at30", (a) => [{ p: a.side[1], next: 1, s: 100, at: 30 }], 3, 1, 4],
    ["T5_both_at30", (a, b) => [{ p: a.side[1], next: 1, s: 100, at: 30 }, { p: b.side[1], next: 0, s: 100, at: 30 }], 0, 2, 5],
  ];
  for (const [nm, extra, runners, lay, trains] of parks2)
    it(`park ${nm}: no head-ons, ${runners} running, lay ${lay} more`, () => {
      const { q, l0, l1, R3 } = two();
      const r = show(nm, scen(q, [...R3, ...extra(l0, l1)], [q.a, q.b], 600, cars));
      expect(r.meet).toBe(0);
      expect(r.released).toBe(0);
      expect(r.arrivals.filter((a) => a > 5).length).toBeGreaterThanOrEqual(runners);
      says(r, lay, trains);
    });
  // B4, and the invariant behind it: one train put down on any loop road at any moment, ahead of a runner or not. No
  // ring of waits outlasts the breaking of rings (`YIELD_S`), the line never stands still for long, none bump (bar one
  // put down in front of a moving train), and at least two of the four keep delivering (614de33 had two in QA's B4).
  it("B4: a train put down on any loop road at any time: no wait ring lasts, never all still for a minute, no head-ons, two or more keep running", () => {
    const bad: string[] = [];
    const roads = (ENV.ROADS ? ENV.ROADS.split(",") : ["l0.side", "l0.main", "l1.side", "l1.main"]) as readonly string[];
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
        if (ENV.SHOW) console.log(`B4 ${road} at ${at}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meet ${r.meet} (${meets} not at the put-down) rel ${r.released} yield ${r.yielded} cut ${r.cut}`);
        if (meets > 0 || r.allStill > 60 || r.longestRing > YIELD_S + 3 || running < 2 || r.released > 0) bad.push(`${road} at ${at}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} s, ring ${r.longestRing.toFixed(1)} s, meets ${meets}, released ${r.released}`);
      }
    expect(bad).toEqual([]);
  });
  // The invariant again, with two trains put down at random (seeded) on loop roads or line ends, and a spare among
  // them now and then: whatever the line can or can't do then, no ring of waits outlasts its breaking, and no train
  // bumps another bar one put down in front of a moving one.
  it("random put-downs: no wait ring lasts, no head-ons", () => {
    const bad: string[] = [];
    const seeds = Number(ENV.SEEDS ?? 24);
    for (let seed = 1; seed <= seeds; seed++) {
      let x = seed * 7919;
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const { q, l0, l1, R3 } = two();
      const spots = [l0.side[1], l0.main[0], l1.side[1], l1.main[0], q.middle[0][0], q.west[0], q.east[0]];
      const extra: T[] = [0, 1].map(() => ({ p: spots[Math.floor(rnd() * spots.length)], next: rnd() < 0.5 ? 0 : 1, s: 100, at: 2 + Math.floor(rnd() * 120), spare: rnd() < 0.2 }));
      const r = scen(q, [...R3, ...extra], [q.a, q.b], 300, cars);
      const meets = r.meets.filter((t) => !extra.some((e) => t >= e.at! && t <= e.at! + 3)).length;
      if (ENV.SHOW) console.log(`RND ${seed}: ${extra.map((e) => `${e.p}@${e.at}${e.spare ? "s" : ""}`).join(" ")} -> ${r.arrivals.join("/")} ring ${r.longestRing.toFixed(1)} still ${r.allStill.toFixed(0)} meets ${meets}`);
      if (meets > 0 || r.longestRing > YIELD_S + 3 || r.released > 0) bad.push(`seed ${seed}: ring ${r.longestRing.toFixed(1)} s, meets ${meets}, released ${r.released}`);
    }
    expect(bad).toEqual([]);
  });
  // B5, and the invariant again over a sequence of runs in one world (history mattered there: QA's sweep froze only
  // after earlier runs): a train put down on each loop road at many times, a spare (lever off, not on the line) or one
  // of the line's. The line never stands all still for a minute, unless it can't do better, and its cards then say why.
  it("B5: put-downs on every loop road, spares and line trains, run after run in one world: never all still for a minute", () => {
    const bad: string[] = [];
    const { q, l0, l1, R3 } = two();
    const roads = (ENV.ROADS ? ENV.ROADS.split(",") : ["l0.side", "l0.main", "l1.side", "l1.main"]) as readonly string[];
    const ats = ENV.ATS ? ENV.ATS.split(",").map(Number) : [15, 30, 45, 60, 75, 90];
    // (Then the same with the other loop pinned to one road both ways, as Game Mode had it: no passing place there.)
    const kinds = ENV.KINDS ? ENV.KINDS.split(",") : ["spare", "line", "pinned"];
    for (const kind of kinds)
      for (const road of roads)
        for (const at of ats) {
          clearTrains(q);
          const l = road.startsWith("l0") ? l0 : l1;
          const p = road.endsWith("side") ? l.side[1] : l.main[0];
          const other = l === l0 ? l1 : l0;
          if (kind === "pinned") pin(q, other, ["main", "main"]);
          const r = scen(q, [...R3, { p, next: road.startsWith("l0") ? 1 : 0, s: 100, at, spare: kind === "spare" }], [q.a, q.b], at + 180, cars);
          for (const sw of [other.s1, other.s2]) q.L.setPinned(sw, false);
          const meets = r.meets.filter((t) => t < at || t > at + 3).length;
          // (Can't do better: every train of the line held, or a card saying what to build or move.)
          const says = [...r.cards].some((c) => /Lay \d+ more|lay \d+ more|Move it|unpin/.test(c));
          const line = `${kind} ${road} at ${at}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${meets} released ${r.released} turns ${r.turns} flips ${r.E.map((e) => r.flips.get(e) ?? 0).join("/")}`;
          if (ENV.SHOW) console.log(`B5 ${line}`);
          if (ENV.SHOW && ENV.CARDS) for (const e of r.E) console.log(`B5C e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
          if (meets > 0 || r.released > 0 || r.longestRing > YIELD_S + 3 || (r.allStill > 60 && !says)) bad.push(line);
          if (r.stale > 0) bad.push(`${line}: ${r.stale} "lay" cards on trains with room`);
          // (QA: a spare can leave the line delivering nothing. Then the cards must say to move it.)
          const delivering = r.arrivals.slice(0, 3).some((a) => a > 3);
          if (kind === "spare" && !delivering && ![...r.cards].some((c) => /[Mm]ove (it|the parked train)$/.test(c))) bad.push(`${line}: no card saying to move it`);
          if (r.allStill > 60 && says && ENV.SHOW) console.log(`B5 still, but it says why: ${[...r.cards].filter((c) => /ay \d+ more|Move it|unpin/.test(c)).join(" | ")}`);
        }
    expect(bad).toEqual([]);
  });
  // QA's B5 sweep (j_put_spare3.js), in its order, in one world: road x T x mode. After T s, wait for a runner heading
  // into the road ("heading": a move to it granted, under way, not on it yet) or standing on it ("behind"), then put
  // a spare (lever off, no line) on the road's first free piece; run 180 s. On 4ffce95 it froze at l1.main, 45 s,
  // heading: the runner between the loops waited on no one named, for good.
  it("B5: QA's spare sweep, in order in one world: never all still for a minute", () => {
    const bad: string[] = [];
    const { q, l0, l1, R3 } = two();
    const roads: [string, readonly number[]][] = [["l0.main", l0.main], ["l0.side", l0.side], ["l1.main", l1.main]];
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
          const says = [...r.cards].some((c) => /ay \d+ more|Move it/.test(c));
          const line = `${rn} T${T} ${mode}: put ${after < 0 ? "none" : after.toFixed(0)} -> ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} meets ${meets} released ${r.released}`;
          if (ENV.SHOW) console.log(`QB5 ${line}${says ? " (says)" : ""}`);
          if (meets > 0 || r.released > 0 || (r.allStill > 60 && !says)) bad.push(line);
        }
    expect(bad).toEqual([]);
  });
  // B5's state, set up directly: a runner between the loops with its nose on loop 1's switch, set for the main road, a
  // spare on that road (the side road free), a line-mate at the far end waiting on it, the third held at the near end.
  // On 4ffce95 the runner waited on no one named (−1) for good, and the line froze.
  it("B5: a runner on a switch set for a road a spare stands on: it says what it waits on, and turns back", () => {
    const { q, l1 } = two();
    q.L.setSwitchState(l1.s1, 0);
    const r = show(
      "B5 state",
      scen(q, [{ p: q.west[0], next: 0, s: 200 }, { p: q.east[0], next: 0, s: 200, rev: !!ENV.REV2 }, { p: l1.s1, next: 1, s: Number(ENV.S0 ?? 52), rev: !!ENV.REV }, { p: l1.main[l1.main.length - 1], spare: true, s: 100 }], [q.a, q.b], 240, cars),
    );
    if (ENV.SHOW) console.log(`B5STATE ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${r.meet}`);
    expect(r.meet).toBe(0);
    expect(r.allStill).toBeLessThan(60);
    expect(r.arrivals.slice(0, 3).filter((a) => a > 3).length).toBeGreaterThanOrEqual(1);
  });
  // QA's B4 itself: a runner let into a loop's road, still in the section on its way there, and a train put down on that
  // road ahead of it. The newcomer isn't let in (the runner has the road); the runner stops short, and one of them turns
  // back: no nose-to-nose standoff.
  for (const road of ["l0.side", "l0.main", "l1.side", "l1.main"] as const)
    it(`B4: a train put down on ${road} ahead of a runner on its way into that road: one turns back, the line runs on`, () => {
      const { q, l0, l1, R3 } = two();
      const l = road.startsWith("l0") ? l0 : l1;
      const p = road.endsWith("side") ? l.side[1] : l.main[0];
      const when = (E: readonly number[]) => {
        const t = q.sim.findCar(E[0])?.train;
        if (!t || q.sim.ticks < 120) return false;
        const topo = topologyOf(q.L, trainLength(t));
        const slot = topo.slotOf.get(p);
        return E.some((e) => {
          const st = q.economy.sections.stateOf(e);
          return !!st && st.slot === -1 && st.move?.dest === slot && q.sim.findCar(e)!.train.speed >= 1;
        });
      };
      const r = show(`B4 ahead ${road}`, scen(q, [...R3, { p, next: 0, s: 100, when }], [q.a, q.b], 360, cars));
      expect(r.whenAt, "a runner on its way into the road").toBeGreaterThan(0);
      expect(r.E.length, "put down").toBe(4);
      expect(r.meets.filter((t) => t > r.whenAt + 3).length).toBe(0);
      expect(r.released).toBe(0);
      expect(r.longestRing).toBeLessThan(YIELD_S + 3);
      expect(r.allStill).toBeLessThan(60);
      expect(r.arrivals.filter((a) => a > 4).length).toBeGreaterThanOrEqual(2);
    });
  // QA: a running train taken off its line (lever left on) runs on, no line's: the line's trains treat it as a train
  // in the way where it is, and wait for it while it moves.
  it("a running train taken off the line runs on among the line's trains: fewer bumps than 614de33, the line delivers more", () => {
    const { q, R3 } = two();
    const r = show("offline", scen(q, [{ ...R3[0], offAt: 30 }, R3[1], R3[2]], [q.a, q.b], 300, cars));
    if (ENV.SHOW) console.log(`OFFLINE meets ${r.meets.map((t) => t.toFixed(0)).join(",")}`);
    // (614de33: 3 + 2 arrivals, 66 bumps.)
    expect(r.arrivals[1] + r.arrivals[2]).toBeGreaterThanOrEqual(6);
    expect(r.meet).toBeLessThanOrEqual(5);
  });
  // (Each of the three taken off, at four times: 614de33 bumped 582 times over the twelve.)
  it("a running train taken off the line, any of them, any time: few bumps", () => {
    let bumps = 0;
    for (const k of [0, 1, 2])
      for (const at of [20, 40, 60, 80]) {
        const { q, R3 } = two();
        const tr = R3.map((t, i) => (i === k ? { ...t, offAt: at } : t));
        const r = scen(q, tr, [q.a, q.b], 300, cars);
        if (ENV.SHOW) console.log(`OFF k${k} at${at}: ${r.arrivals.join("/")} meet ${r.meet}`);
        bumps += r.meet;
        expect(r.released).toBe(0);
      }
    expect(bumps).toBeLessThan(40);
  });
  // QA's stopLine repro (j_last.js): 1 loop, 3 trains, the third held on the loop's side road. At 90 s the first
  // train moving and not at a stop is taken off its line, lever left on; measured 90-300 s. 614de33: 0/8/10 arrivals,
  // 21 head-ons; bdf33c1: 0/0/1, 27.
  it("QA's stopLine repro: a running train taken off an over-full line: few bumps, the line keeps delivering", () => {
    const { q, l } = one();
    let off = -1;
    const r = show(
      "stopLine",
      scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: l.side[1], next: 1, s: 100 }], [q.a, q.b], 300, cars, [
        {
          at: 90,
          fn: (E) => {
            const e = ENV.OFFE ? Number(ENV.OFFE) : E.find((x) => (q.sim.findCar(x)?.train.speed ?? 0) >= 1 && !q.economy.routeOf(x)?.at);
            if (e !== undefined) {
              off = e;
              stopLine(q.economy, e);
            }
          },
        },
      ]),
    );
    const arr = r.E.map((e) => r.arrAt.filter((a) => a.e === e && a.t >= 90).length);
    const meets = r.meets.filter((t) => t >= 90).length;
    if (ENV.SHOW) console.log(`STOPLINE off e${off}: 90-300 s arrivals ${arr.join("/")} head-ons ${meets}`);
    if (ENV.SHOW) for (const e of r.E) console.log(`STOPLINE e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
    expect(off).toBeGreaterThan(0);
    // (QA: its card said "Turning back early: the end of the line is taken" about 25 s a run, and at a buffer "Turning
    // back at the end of the line". On no line it has no line's end: plain cards, "the track ends here".)
    expect(new Set(r.cardLog.filter((x) => x.e === off && x.t > 91).map((x) => x.c).filter((c) => /early|end of the line|[Ll]ay \d/.test(c)))).toEqual(new Set());
    // (It runs where it likes; the line's trains keep out of its way, and it stops short of them and turns back, as it
    // would on bumping them. The line still delivers; few bumps where 614de33 had 21.)
    expect(arr.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(6);
    expect(meets).toBeLessThanOrEqual(5);
    expect(r.released).toBe(0);
  });
  // (Cost: the look ahead of a running train on no line, among a managed line's trains, a call per tick each.)
  it("clearCap: a running train off its line costs a few microseconds a tick", () => {
    const { q, R3 } = two();
    scen(q, [{ ...R3[0], offAt: 20 }, R3[1], R3[2]], [q.a, q.b], 40, cars);
    const off = q.sim.findCar(q.sim.getTrain(q.sim.trainIds()[0])!.cars[0].id)!.train;
    const cap = (q.economy.sections as unknown as { clearCap(t: typeof off): number }).clearCap.bind(q.economy.sections);
    for (let i = 0; i < 2000; i++) cap(off);
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) cap(off);
    const us = ((performance.now() - t0) * 1000) / n;
    if (ENV.SHOW) console.log(`CLEARCAP ${us.toFixed(2)} us a call (speed ${off.speed.toFixed(0)})`);
    expect(us).toBeLessThan(50);
  });
  // unring picks a train to turn back only if it can: one with a train standing right behind it in its slot can't, and
  // picked anyway it was picked again every check. A spare is put right behind a train waiting in a loop road.
  it("unring: never picks a train it can't turn (one with a spare right behind it)", () => {
    const { q, l0, l1, R3 } = two();
    const roads = [l0.main, l0.side, l1.main, l1.side];
    const refused0 = q.economy.sections.giveWayRefused;
    let put = 0;
    for (const road of roads) {
      clearTrains(q);
      const start = q.sim.ticks;
      // (Behind it: the road's pieces past its tail, nearest first, its tail's own piece among them.)
      const spare: { p: number; ps: number[]; ss: number[]; spare: true; shared: true; when: (E: readonly number[]) => boolean } = { p: road[0], ps: [], ss: [5, 15, 25, 40, 60, 100, 140, 180], spare: true, shared: true, when: () => false };
      spare.when = (E) =>
        q.sim.ticks - start > 10 * SIM_HZ &&
        E.some((e) => {
          const t = q.sim.findCar(e)!.train;
          const w = q.economy.sections.waitOf(e);
          if (!(t.speed < 1 && !!w && "engine" in w && t.bogies.some((b) => road.includes(b.pieceId)))) return false;
          // (Its tail's own piece, behind the tail, or the road's other pieces it isn't on.)
          spare.ps = [t.bogies[t.bogies.length - 1].pieceId, ...road.filter((p) => !t.bogies.some((b) => b.pieceId === p))];
          return true;
        });
      const r = scen(q, [...R3, spare], [q.a, q.b], 240, cars);
      if (r.whenAt > 0) put++;
      if (ENV.SHOW) console.log(`UNRING road ${road.join(",")}: put ${r.whenAt.toFixed(0)} -> ${r.arrivals.join("/")} refused ${q.economy.sections.giveWayRefused - refused0}`);
      expect(r.meets.filter((t) => t > r.whenAt + 3).length).toBe(0);
    }
    expect(put).toBeGreaterThan(0);
    expect(q.economy.sections.giveWayRefused - refused0).toBe(0);
  });
  // The same, built directly: a short train in loop 1's main road waiting on a spare ahead of it (stuck: the spare
  // won't move), a free slot behind it, but another spare right behind it in the road. It mustn't be picked to turn.
  // (Game Mode's harness, seeds 1 and 5: a people train on no line, lever on, between the line's two goods trains,
  // each waiting on it. It stood short of one, turned back, stood short of the other, on and on; standing with its lever
  // on, `unring` took it for one that will go, and no one gave way: they stood till picked up. Before: 88 s.)
  it("a train on no line shuttling between two of the line's trains waiting on it: one gives way, they don't all stand", () => {
    const rows: string[] = [];
    for (const k of [0, 2, 3, 4])
      for (const off of [5, 40]) {
        const { q, l } = one();
        const ps = [q.west[0], l.main[0], l.main[1], l.side[0], l.main[1], q.east[0]];
        const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: ps[k], ps: [ps[k], ...ps], ss: [20, 100, 180], next: 1, offAt: off }], [q.a, q.b], 240, cars);
        if (ENV.SHOW) console.log(`LINELESS k${k} off${off}: line still ${r.lineStill.toFixed(0)} s, arrivals ${r.arrivals.join("/")}, meets ${r.meet}`);
        if (r.lineStill > 30) rows.push(`k${k} off${off}: the line's trains all stood ${r.lineStill.toFixed(0)} s`);
        if (r.arrivals[0] + r.arrivals[1] < 4) rows.push(`k${k} off${off}: ${r.arrivals.join("/")} arrivals`);
        expect(r.meet).toBeLessThanOrEqual(4);
      }
    expect(rows).toEqual([]);
  });
  // QA's N2: a running train taken off its line at 5 s, put down anywhere on a 1-loop line among the line's two. The
  // line's train in a loop road ran head on into it (the line's slots don't keep a train on no line out): two real
  // bumps 2.3 s apart, the second as it turned back into it again. On origin/main (7385861) 15 of these placements
  // bumped so. Now a line's train stops short of a train not on its line ahead of it, as that one does of it.
  it("QA's N2: a train taken off its line, anywhere among the line's two: no head-ons", () => {
    const rows: string[] = [];
    for (const ends of [1, 2])
      for (let p0 = 0; p0 < 16; p0++)
        for (const s0 of [20, 100, 180]) {
          const q = line0({ loops: 1, ends });
          const piece = q.L.getPiece(p0);
          if (!piece || !/^(straight|depot|curve)/.test(piece.type)) continue;
          let r;
          try {
            r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: p0, s: s0, next: 1, offAt: 5 }], [q.a, q.b], 240, cars);
          } catch {
            continue;
          }
          if (r.meet > 0) rows.push(`ends ${ends}, piece ${p0} at ${s0}: head-ons at ${r.meets.map((t) => t.toFixed(1)).join(", ")} s`);
          if (r.arrivals[0] + r.arrivals[1] < 3) rows.push(`ends ${ends}, piece ${p0} at ${s0}: ${r.arrivals.join("/")} arrivals`);
        }
    expect(rows).toEqual([]);
  });
  it("unring: a train boxed in by spares in its road waits on the one ahead, named, and isn't picked to turn back", () => {
    const { q, l1 } = two();
    const short: CarKind[] = ["engine"];
    const r = scen(
      q,
      [
        { p: q.west[0], next: 1, s: 200 },
        { p: l1.main[l1.main.length - 1], next: 1, s: Number(ENV.SA ?? 60), rev: !!ENV.RA },
        { p: l1.main[l1.main.length - 1], spare: true, s: Number(ENV.SF ?? 190), rev: !!ENV.RA },
        { p: l1.main[0], spare: true, s: Number(ENV.SB ?? 100), rev: !!ENV.RA },
      ],
      [q.a, q.b],
      60,
      short,
    );
    if (ENV.SHOW) console.log(`BOXED ${r.arrivals.join("/")} refused ${q.economy.sections.giveWayRefused} wait ${JSON.stringify(q.economy.sections.waitOf(r.E[1]))}`);
    expect(q.economy.sections.giveWayRefused).toBe(0);
    expect(q.economy.sections.waitOf(r.E[1])).toEqual({ kind: "slot", engine: r.E[2] });
    expect(r.meet).toBe(0);
  });
  // QA: when nothing can deliver, the trains with room shuttled (13-91 turn-backs a run), their cards flickering
  // between waiting and turning back. Now they stand still, a steady card saying what to do.
  for (const [nm, build] of [
    ["L2T5_heldOneEach", (a: L, b: L) => [{ p: a.side[1], next: 1, s: 100 }, { p: b.side[1], next: 0, s: 100 }]],
    ["L2T5_spareOneEach (B3)", (a: L, b: L) => [{ p: a.side[1], spare: true, s: 100 }, { p: b.side[1], spare: true, s: 100 }]],
    ["T5_both_at30", (a: L, b: L) => [{ p: a.side[1], next: 1, s: 100, at: 30 }, { p: b.side[1], next: 0, s: 100, at: 30 }]],
  ] as [string, (a: L, b: L) => T[]][])
    it(`nothing can deliver (${nm}): the trains stand still, few turn-backs, a steady card`, () => {
      const { q, l0, l1, R3 } = two();
      const r = show(`still ${nm}`, scen(q, [...R3, ...build(l0, l1)], [q.a, q.b], 600, cars));
      expect(r.meet).toBe(0);
      expect(r.turns).toBeLessThanOrEqual(15);
      // (Over the last 2 minutes each train shows one card, and one that says what to build or move.)
      for (const e of r.E) {
        const last = new Set(r.cardLog.filter((x) => x.e === e && x.t > 480).map((x) => x.c));
        expect(last.size, `e${e}: ${[...last].join(" | ")}`).toBe(1);
      }
      const says = r.E.flatMap((e) => r.cardLog.filter((x) => x.e === e && x.t > 480).map((x) => x.c)).some((c) => /[Ll]ay \d+ more|Move it|move the parked train/.test(c));
      expect(says).toBe(true);
    });
  // QA's B1 on 21e6efc: any other train moving anywhere woke a stood-still line (its key held every train not on the
  // line, where it was), so it shuttled again about every minute. Only trains standing on its own network wake it.
  for (const other of ["none", "lineless", "line"] as const)
    it(`B1: a stood-still line stays still with ${other === "none" ? "no other train" : `a ${other === "line" ? "train of another line" : "lineless runner"} on a layout of its own`}`, () => {
      const { q, l0, l1, R3 } = two();
      // (A layout of its own, far off: a forest and a sawmill a few pieces apart, buffers at both ends.)
      const L = q.L;
      const f = L.addPiece("depot-forest", { x: 0, z: 3000, heading: 0 });
      appendPiece(L, "buffer-turnback", false, connectorRef(f, 0));
      let at = f;
      for (let i = 0; i < 4; i++) at = appendPiece(L, "straight-216", false, connectorRef(at, 1));
      const sw = appendPiece(L, "depot-sawmill", false, connectorRef(at, 1));
      appendPiece(L, "buffer-turnback", false, connectorRef(sw, 1));
      let e = -1;
      if (other === "lineless" || other === "line") {
        const placed = q.sim.addTrain(cars, { pieceId: at, pathIndex: 0, reversed: false, s: 100 });
        if (placed.kind !== "placed") throw new Error("no room");
        e = q.sim.getTrain(placed.trainId)!.cars[0].id;
        q.sim.setLever(e, 1);
        if (other === "line") {
          const d1 = q.economy.addDepot("forest", f, 0);
          const d2 = q.economy.addDepot("sawmill", sw, 0);
          editLine(q.economy, e, (st) => st.push({ depotId: d1.id, action: "auto" }, { depotId: d2.id, action: "auto" }));
        }
      }
      // (QA's B3: its card at a buffer there is its own line's end, not "the track ends here", managed line or no.)
      const its = new Set<string>();
      const look = Array.from({ length: 600 }, (_, k) => ({ at: k + 1, fn: () => void (e >= 0 && its.add(engineStatus(q.sim, q.economy, e, () => "stop"))) }));
      const r = show(`B1 ${other}`, scen(q, [...R3, { p: l0.side[1], next: 1, s: 100 }, { p: l1.side[1], next: 0, s: 100 }], [q.a, q.b], 600, cars, look));
      expect([...its].filter((c) => c.includes("track ends here"))).toEqual([]);
      const late = r.E.map((e) => new Set(r.cardLog.filter((x) => x.e === e && x.t > 400).map((x) => x.c)).size);
      if (ENV.SHOW) console.log(`B1 ${other}: turns ${r.turns} stalls ${q.economy.sections.stalls} cards 400-600 s ${late.join("/")}`);
      expect(r.turns).toBeLessThanOrEqual(15);
      expect(q.economy.sections.stalls).toBe(1);
      for (const n of late) expect(n).toBe(1);
    });
  // QA's N1 on a2d072c: waiting on another line's train, the card looked that line up by the id waited on, its
  // first car: a wagon once it had reversed, on no line, so the card said "a train not on the line" (56 of 92).
  it("N1: waiting on another line's train, the card says another train, whichever way round it runs", () => {
    const { q, l } = one();
    const said = new Map<string, number>();
    let other = -1;
    const events = [
      {
        at: 1,
        fn: () => {
          // (Another line over the same track, the same two stops: its train runs to and fro, reversing at each.)
          const placed = q.sim.addTrain(cars, { pieceId: l.side[1], pathIndex: 0, reversed: false, s: 100 });
          if (placed.kind !== "placed") throw new Error("no room");
          other = q.sim.getTrain(placed.trainId)!.cars[0].id;
          q.sim.setLever(other, 1);
          const ds = [q.a, q.b].map((p) => q.economy.allDepots().find((d) => d.pieceId === p)!.id);
          editLine(q.economy, other, (st) => st.push(...ds.map((depotId) => ({ depotId, action: "auto" as const }))));
        },
      },
      ...Array.from({ length: 1200 }, (_, k) => ({
        at: 2 + k * 0.25,
        fn: (E: readonly number[]) => {
          for (const e of E) {
            const w = q.economy.sectionWait(e);
            if (!w || !("engine" in w)) continue;
            const t = q.sim.findCar(w.engine)?.train;
            if (!t || !t.cars.some((c) => c.id === other)) continue;
            const c = engineStatus(q.sim, q.economy, e, () => "stop");
            if (c.startsWith("Waiting")) said.set(c, (said.get(c) ?? 0) + 1);
          }
        },
      })),
    ];
    const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }], [q.a, q.b], 300, cars, events);
    if (ENV.SHOW) console.log(`N1 waits on the other line's train: ${[...said].map(([c, n]) => `${c} x${n}`).join(" | ")}; reversed ${q.sim.findCar(other)?.train.cars[0].id !== other}`);
    expect([...said.keys()].filter((c) => c.includes("not on the line"))).toEqual([]);
    expect(said.get("Waiting: another train is in the way") ?? 0).toBeGreaterThan(0);
    void r;
  });
  // Game Mode's deadlock on main: a loop whose switches are pinned wasn't counted as a passing place at all, so the
  // line had room for one; a second train put down in front of the working one was held where it stood, and the
  // working one waited on it for good (with a third, a ring nobody could turn out of).
  /** Pin a loop's switches, each set so a train coming at it from its stem takes `roads` ("main" or "side"). */
  const pin = (q: Q, l: Q["loops"][0], roads: readonly ["main" | "side", "main" | "side"]) => {
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
  for (const [nm, roads, trains] of [
    ["pinned both to the main road, 2 trains", ["main", "main"], 2],
    ["pinned both to the main road, 3 trains", ["main", "main"], 3],
    ["pinned one-way (each way its own road), 2 trains", ["main", "side"], 2],
    ["pinned one-way, 3 trains", ["main", "side"], 3],
  ] as [string, readonly ["main" | "side", "main" | "side"], number][])
    for (const [seedAt, onLoop] of [[20, false], [45, false], [20, true], [45, true]] as const)
      it(`pinned loop: ${nm}, one put down at ${seedAt} s in front of a running one${onLoop ? ", on the loop's road" : ""}: no lock-up`, () => {
        const q = line0({ loops: 1, ends: 2 });
        const l = q.loops[0];
        pin(q, l, roads);
        const ts: T[] = [{ p: q.west[0], next: 1, s: 200 }];
        // (Put down at that time where there's room, the far end first: ahead of the runner, the way it's heading.)
        const at = (t: number) => () => q.sim.ticks >= t * SIM_HZ;
        const t0 = q.sim.ticks / SIM_HZ;
        const ahead = onLoop ? [...l.main, ...l.side] : [q.east[1], q.east[0]];
        ts.push({ p: ahead[0], ps: [...ahead, q.east[1], q.east[0], q.west[1], q.west[0]], ss: [100, 60, 140], next: 0, s: 100, when: at(t0 + seedAt) });
        if (trains === 3) ts.push({ p: q.west[1], ps: [q.west[1], q.west[0], q.east[1], q.east[0]], ss: [100, 60, 140], next: 1, s: 100, when: at(t0 + seedAt + 10) });
        const r = show(`pin ${nm} at ${seedAt}`, scen(q, ts, [q.a, q.b], seedAt + 300, cars));
        if (ENV.SHOW) console.log(`PIN ${nm} at ${seedAt}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${r.meet} turns ${r.turns} cards ${[...r.cards].filter((c) => /pin|lay|Move/.test(c)).join(" | ")}`);
        expect(r.E.length).toBe(trains);
        expect(r.meet).toBe(0);
        expect(r.longestRing).toBeLessThan(YIELD_S + 3);
        const says = [...r.cards].some((c) => /unpin|[Ll]ay \d+ more/.test(c));
        expect(r.allStill < 60 || says, `all still ${r.allStill.toFixed(0)} s and no card says why`).toBe(true);
        if (roads[0] === roads[1]) {
          // (Pinned to one road both ways: no passing place. The card says what to do: unpin, not lay a loop.)
          expect([...r.cards].some((c) => c.endsWith("unpin the passing loop's switches so trains can pass"))).toBe(true);
          expect([...r.cards].filter((c) => /[Ll]ay \d+ more/.test(c))).toEqual([]);
        }
        // (Passing one way each way round: as good as an unpinned loop, two trains both running.)
        if (roads[0] !== roads[1] && trains === 2) expect(r.arrivals.filter((a) => a > 5).length).toBe(2);
        // (Two trains, the loop no passing place: one runs, the other held out of its way.)
        if (roads[0] === roads[1] && trains === 2) expect(r.arrivals.some((a) => a > 5)).toBe(true);
      });
  // Each switch free, or pinned so a train at it from its stem takes main or side (`pin`, one switch at a time).
  const pinEach = (q: Q, l: Q["loops"][0], ways: readonly ["free" | "main" | "side", "free" | "main" | "side"]) => {
    for (const [k, sw] of [l.s1, l.s2].entries()) {
      const want = ways[k];
      if (want === "free") continue;
      for (let state = 0; state < 2; state++) {
        q.L.setSwitchState(sw, state);
        q.L.setPinned(sw, true);
        const w = waysFrom(q.L, sw, 0)[0];
        const n = w ? next(q.L, sw, w.exit) : null;
        if ((n && l.main.includes(n.pieceId) ? "main" : "side") === want) break;
        q.L.setPinned(sw, false);
      }
    }
  };
  // Every way of pinning a loop: each switch free, or pinned to send trains coming at it from its stem onto main or
  // side. Pinned to the same road both ends: no passing place (the card says unpin). Otherwise it passes: one end
  // pinned, trains in at the other keep to the other road (7034c25 let them onto the pinned end's road, where the two
  // met with no way round: free/main and main/free delivered 0 and 2 where these deliver 13 each).
  const W = ["free", "main", "side"] as const;
  for (const a of W)
    for (const b of W)
      it(`a loop pinned ${a}/${b}, 2 trains: ${a !== "free" && a === b ? "no passing place, the card says unpin" : "they pass, both deliver"}`, () => {
        const q = line0({ loops: 1, ends: 2 });
        const l = q.loops[0];
        pinEach(q, l, [a, b]);
        const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }], [q.a, q.b], 300, cars);
        if (ENV.SHOW) console.log(`PINS ${a}/${b}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} meets ${r.meet} cards ${[...r.cards].filter((c) => /pin|lay|Move/.test(c)).join(" | ")}`);
        expect(r.meet).toBe(0);
        const unpin = [...r.cards].some((c) => c.endsWith("unpin the passing loop's switches so trains can pass"));
        if (a !== "free" && a === b) {
          expect(unpin).toBe(true);
          expect(r.arrivals.some((x) => x > 5)).toBe(true);
        } else {
          expect(unpin).toBe(false);
          expect([...r.cards].filter((c) => /[Ll]ay \d+ more|full/.test(c))).toEqual([]);
          for (const x of r.arrivals) expect(x).toBeGreaterThan(9);
        }
      });
  // QA's j_pin2 (B1 on 7034c25): pinned main/main, 2 trains; at 200 s the player does what the card says, unpinning
  // one switch or both (each keeps the state it was pinned in). 7034c25, arrivals in the 200 s after: s1 0, s2 2,
  // both 16; dae31d6: 9, 9, 16.
  for (const un of ["s1", "s2", "both"] as const)
    it(`QA's j_pin2: a loop pinned main/main, then ${un === "both" ? "both switches" : un} unpinned as the card says: the line delivers`, () => {
      const q = line0({ loops: 1, ends: 2 });
      const l = q.loops[0];
      pin(q, l, ["main", "main"]);
      const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }], [q.a, q.b], 400, cars, [
        {
          at: 200,
          fn: () => {
            if (un !== "s2") q.L.setPinned(l.s1, false);
            if (un !== "s1") q.L.setPinned(l.s2, false);
          },
        },
      ]);
      const after = r.E.map((e) => r.arrAt.filter((x) => x.e === e && x.t >= 200).length);
      if (ENV.SHOW) console.log(`J_PIN2 unpin ${un}: after ${after.join("/")} before ${r.arrAt.filter((x) => x.t < 200).length} meets ${r.meet}`);
      expect(r.meet).toBe(0);
      expect(after.reduce((x, y) => x + y, 0)).toBeGreaterThanOrEqual(14);
      for (const x of after) expect(x).toBeGreaterThan(5);
    });
  // QA's N1: 3 trains on 1 loop (the third put down at the forest end at 30 s), unpinned or one-way. The room rule
  // (loops + 1) holds one; it's held at the forest end, so neither of the others can load: unpinned they shuttle empty
  // to the sawmill (QA counted 17 arrivals, none with logs), one-way they stand still. Both say lay 1 more loop.
  for (const w of [["free", "free"], ["main", "side"]] as const)
    it(`QA's N1: 3 trains on a loop ${w[0] === "free" ? "unpinned" : "pinned one-way"}: one held, the card says lay 1 more loop`, () => {
      const q = line0({ loops: 1, ends: 2 });
      const l = q.loops[0];
      pinEach(q, l, w);
      const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: q.west[1], next: 1, s: 100, at: 30 }], [q.a, q.b], 300, cars);
      const loads = r.E.map((e) => r.cardLog.filter((x) => x.e === e && x.t > 60 && /at forest/.test(x.c)).length);
      if (ENV.SHOW) console.log(`N1 ${w.join("/")}: ${r.arrivals.join("/")} loading at the forest after 60 s ${loads.join("/")}`);
      expect(r.meet).toBe(0);
      expect([...r.cards].some((c) => /lay 1 more passing loop for 3 trains/.test(c))).toBe(true);
      expect(loads).toEqual([0, 0, 0]);
    });
  // Fix 2's case, built directly: no passing place (the loop pinned to one road both ways), the working train standing
  // at its end of the line, a second put down right in front of it on the single track. Held for room where it
  // stood, it blocked the working train, which had nowhere to turn: it waited on it for good. Held by rule, not by
  // the track, the second takes the room and runs; the first is held where it stands, clear of its way.
  for (const onLoop of [false, true])
    it(`held train in front of the working one at its line end (${onLoop ? "on the pinned loop" : "just past the end"}): no lock-up`, () => {
      const q = line0({ loops: 1, ends: 2 });
      const l = q.loops[0];
      pin(q, l, ["main", "main"]);
      const t0 = q.sim.ticks / SIM_HZ;
      const ahead = onLoop ? [l.main[0], l.main[1]] : [q.west[q.west.length - 1]];
      const r = show(
        `held in front ${onLoop}`,
        scen(q, [{ p: q.west[0], next: 1, s: 100, rev: true }, { p: ahead[0], ps: ahead, ss: [60, 100, 140], next: 1, s: 100, when: () => q.sim.ticks / SIM_HZ >= t0 + 1 }], [q.a, q.b], 300, cars),
      );
      if (ENV.SHOW) console.log(`INFRONT ${onLoop}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} put ${r.whenAt} swapped ${q.economy.sections.swapped}`);
      expect(r.E.length).toBe(2);
      expect(r.meet).toBe(0);
      expect(r.allStill).toBeLessThan(60);
      expect(r.arrivals.some((a) => a > 5)).toBe(true);
    });
});
