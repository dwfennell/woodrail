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
function line0(spec: { loops: number; ends?: number; pre?: PieceTypeId[] | null; branch?: PieceTypeId[]; branchFlips?: boolean[]; eastT?: PieceTypeId[]; sideAt?: boolean }) {
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
  for (let i = 0; i < spec.loops; i++) {
    const l = loopOn(L, from, ["straight-216", "straight-216"], ["straight-216"]);
    loops.push(l);
    from = connectorRef(l.s2, 0);
    if (i + 1 < spec.loops) {
      const m = chain(["straight-216", "straight-216", "straight-216"], from);
      from = connectorRef(m[2], 1);
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
  return { L, sim, economy, a, b: east[east.length - 1], west, east, loops, br };
}

type Q = ReturnType<typeof line0>;

/** QA's `H.scen`: trains (piece, next stop, s, added at), one line of `stops`, `secs` seconds; forest piles topped up. */
function scen(q: Q, trains: { p: number; next: number; s?: number; rev?: boolean; at?: number }[], stops: number[], secs: number, cars: CarKind[] = ["engine", "timber", "timber"]) {
  const depots = new Map<number, ReturnType<Economy["addDepot"]>>();
  for (const p of stops) if (!depots.has(p)) depots.set(p, q.economy.addDepot(q.L.getPiece(p)!.type === "depot-forest" ? "forest" : "sawmill", p, 0));
  const E: number[] = [];
  let lineId = -1;
  const add = (t: (typeof trains)[number]) => {
    const placed = q.sim.addTrain(cars, { pieceId: t.p, pathIndex: 0, reversed: !!t.rev, s: t.s ?? 100 });
    if (placed.kind !== "placed") throw new Error(`no room on ${t.p}`);
    const e = q.sim.getTrain(placed.trainId)!.cars[0].id;
    q.sim.setLever(e, 1);
    if (lineId === -1) lineId = editLine(q.economy, e, (s) => s.push(...stops.map((p) => ({ depotId: depots.get(p)!.id, action: "auto" as const }))))!.id;
    else joinLine(q.economy, e, lineId);
    q.economy.routeOf(e)!.next = t.next;
    E.push(e);
  };
  for (const t of trains) if (!t.at) add(t);
  const arr = new Map<number, number>();
  const prevAt = new Map<number, boolean>();
  const lastTurn = new Map<number, number>();
  let meet = 0;
  const cards = new Set<string>();
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
      if (tick % 30 === 0) cards.add(engineStatus(q.sim, q.economy, e, (id) => (q.economy.depot(id)?.role === "forest" ? "forest" : "sawmill")));
    }
  }
  return { E, arrivals: E.map((e) => arr.get(e) ?? 0), meet, cards, released: q.economy.sections.released };
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
  });
});
