import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { CARGO } from "./cargo";
import { Economy } from "./economy";
import { loopOn } from "./loop-fixtures";

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

/** QA's `H.scen`: trains (piece, next stop, s, added at), one line of `stops`, `secs` seconds; forest piles topped up. */
function scen(q: Q, trains: { p: number; next?: number; s?: number; rev?: boolean; at?: number; spare?: boolean }[], stops: number[], secs: number, cars: CarKind[] = ["engine", "timber", "timber"]) {
  const depots = new Map<number, ReturnType<Economy["addDepot"]>>();
  for (const p of stops) if (!depots.has(p)) depots.set(p, q.economy.addDepot(q.L.getPiece(p)!.type === "depot-forest" ? "forest" : "sawmill", p, 0));
  const E: number[] = [];
  let lineId = -1;
  const add = (t: (typeof trains)[number]) => {
    const placed = q.sim.addTrain(cars, { pieceId: t.p, pathIndex: 0, reversed: !!t.rev, s: t.s ?? 100 });
    if (placed.kind !== "placed") throw new Error(`no room on ${t.p}`);
    const e = q.sim.getTrain(placed.trainId)!.cars[0].id;
    E.push(e);
    // (A spare: standing, lever off, not on the line.)
    if (t.spare) return;
    q.sim.setLever(e, 1);
    if (lineId === -1) lineId = editLine(q.economy, e, (s) => s.push(...stops.map((p) => ({ depotId: depots.get(p)!.id, action: "auto" as const }))))!.id;
    else joinLine(q.economy, e, lineId);
    q.economy.routeOf(e)!.next = t.next ?? 0;
  };
  for (const t of trains) if (!t.at) add(t);
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
    for (const d of q.economy.allDepots()) if (d.role === "forest") d.piles[CARGO.log.index] = Math.max(d.piles[CARGO.log.index], 6);
    q.sim.tick();
    q.economy.tick();
    for (const e of E) {
      const tr = q.sim.findCar(e)?.train;
      if (!tr) continue;
      const at = q.economy.routeOf(e)?.at ?? false;
      if (at && !prevAt.get(e)) arr.set(e, (arr.get(e) ?? 0) + 1);
      prevAt.set(e, at);
      const lt = tr.lastTurn;
      if (lt && lastTurn.get(e) !== lt.tick) {
        lastTurn.set(e, lt.tick);
        if (lt.cause === "train") meet++;
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
      }
    }
  }
  /** The share of `e`'s samples whose card matches `re`. */
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
  return { E, arrivals: E.map((e) => arr.get(e) ?? 0), meet, cards, cardsOf, share, released: q.economy.sections.released };
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
    // (No bare "Waiting for the Red line train" on a line that's full: the card says what to build.)
    expect(cards).not.toContain("Waiting for the Red line train");
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
    if (ENV.SHOW) console.log(`PARK ${nm}: arrivals ${r.arrivals.join("/")} meet ${r.meet} released ${r.released} cards ${[...r.cards].join(" | ")}`);
    return r;
  };
  it("B2 base: 2 loops, 3 trains", () => {
    const { q, R3 } = two();
    const r = show("base3", scen(q, R3, [q.a, q.b], 300, cars));
    expect(r.meet).toBe(0);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(5);
  });
  // (Cards: the one a held train shows, naming how many loops to lay.)
  const says = (r: ReturnType<typeof scen>, lay: number, trains: number) => {
    const n = `${lay} more passing loop${lay === 1 ? "" : "s"}`;
    expect([...r.cards], "held").toContain(`Waiting: lay ${n} for ${trains} trains`);
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
  type T = { p: number; next?: number; s?: number; at?: number; spare?: boolean };
  // [name, extra trains, how many keep running (more than 5 arrivals), loops to lay, trains on the line]
  const parks1: [string, (l: L) => T[], number, number, number][] = [
    ["L1T3_heldSide", (l) => [{ p: l.side[1], next: 1, s: 100 }], 2, 1, 3],
    ["L1T3_heldMain", (l) => [{ p: l.main[0], next: 0, s: 200 }], 2, 1, 3],
    ["L1T3_spareSide (B3)", (l) => [{ p: l.side[1], spare: true, s: 100 }], 1, 1, 2],
    ["L1T4_heldBoth", (l) => [{ p: l.side[1], next: 1, s: 100 }, { p: l.main[0], next: 0, s: 200 }], 0, 2, 4],
    ["L1T4_spareBoth (B3)", (l) => [{ p: l.side[1], spare: true, s: 100 }, { p: l.main[0], spare: true, s: 200 }], 0, 1, 2],
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
    ["L2T5_spareBothL0 (B3)", (a) => [{ p: a.side[1], spare: true, s: 100 }, { p: a.main[0], spare: true, s: 200 }], 2, 1, 3],
    // (Late joins, QA's j_park4: adding one train to a working 2-loop line holds that one, not two.)
    ["T4_side0_at0", (a) => [{ p: a.side[1], next: 1, s: 100 }], 3, 1, 4],
    ["T4_side1_at30", (_a, b) => [{ p: b.side[1], next: 0, s: 100, at: 30 }], 3, 1, 4],
    ["T4_side0_at45", (a) => [{ p: a.side[1], next: 1, s: 100, at: 45 }], 3, 1, 4],
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
});
