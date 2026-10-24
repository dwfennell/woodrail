import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout } from "../track";
import { editLine, joinLine } from "../game/lines";
import { Economy } from "./economy";
import { chain, loopOn, runner, train, type World } from "./loop-fixtures";
import { topologyOf, trainLength } from "./sections";
import { engineStatus } from "../game/engine-status";

/**
 * A single line from depot X to depot Y, buffers at both ends, with `loops` bare passing loops in a row between them
 * (three straights between two loops), or none; with `station`, the first loop's other road is a stop M.
 *
 *   ⊐ X ══ ══ S1 ══ main ══ S2 ══ ══ ══ S3 … S4 ══ ══ Y ⊏
 *                ╲_ side _╱
 */
function line(loops: number, opts: { station?: boolean; shortRoads?: boolean } = {}) {
  const layout = new Layout();
  const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  let from = connectorRef(west[1], 1);
  const made: ReturnType<typeof loopOn>[] = [];
  const middle: number[] = [];
  for (let i = 0; i < loops; i++) {
    const l = opts.shortRoads ? loopOn(layout, from, ["straight-216"], []) : loopOn(layout, from, ["straight-216", "straight-216"], [opts.station && i === 0 ? "depot-sawmill" : "straight-216"]);
    made.push(l);
    from = connectorRef(l.s2, 0);
    if (i + 1 < loops) {
      const m = chain(layout, ["straight-216", "straight-216", "straight-216"], from);
      middle.push(...m);
      from = connectorRef(m[2], 1);
    }
  }
  const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], from);
  appendPiece(layout, "buffer-turnback", false, connectorRef(east[2], 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", x, 0);
  const dm = opts.station ? economy.addDepot("sawmill", made[0].side[1], 0) : null;
  const dy = economy.addDepot("town", east[2], 1);
  const w = { layout, sim, economy, dx } as unknown as World;
  return { w, layout, sim, economy, dx, dm, dy, x, west, east, middle, loops: made };
}

type Line = ReturnType<typeof line>;

/** Trains on the line (A west heading for X, B east heading for Y, others at `more` pieces facing `moreBack`), one line. */
function trains(l: Line, more: { piece: number; back: boolean; next: number }[] = [], cars?: CarKind[]) {
  const stops = l.dm ? [l.dx, l.dm, l.dy] : [l.dx, l.dy];
  const es = [train(l.w, l.west[0], true, cars), train(l.w, l.east[0], false, cars), ...more.map((m) => train(l.w, m.piece, m.back, cars))];
  const red = editLine(l.economy, es[0], (s) => s.push(...stops.map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
  for (const e of es.slice(1)) joinLine(l.economy, e, red.id);
  l.economy.routeOf(es[0])!.next = 0;
  l.economy.routeOf(es[1])!.next = stops.length - 1;
  more.forEach((m, k) => (l.economy.routeOf(es[2 + k])!.next = m.next));
  return es;
}

/** Every tick: a train whose front is in a section holds a move through it, alone, to a slot no other train has. */
function checkMoves(l: Line, es: readonly number[]) {
  const longest = Math.max(...es.map((e) => trainLength(l.sim.findCar(e)!.train)));
  const topo = topologyOf(l.layout, longest);
  let bad = 0;
  let checked = 0;
  return {
    tick() {
      const states = es.map((e) => l.economy.sections.stateOf(e));
      es.forEach((e, k) => {
        const st = states[k];
        const m = st?.move;
        if (!m) return;
        checked++;
        es.forEach((u, j) => {
          if (u === e) return;
          const t = l.sim.findCar(u)!.train;
          const om = states[j]?.move;
          if (om && (om.section === m.section || om.dest === m.dest)) bad++;
          // (No other train's wheels in its section while it holds it.)
          if (t.bogies.some((b) => topo.sectionOf.get(b.pieceId) === m.section)) bad++;
        });
      });
    },
    get bad() {
      return bad;
    },
    get checked() {
      return checked;
    },
  };
}

describe("sections and slots: the layout", () => {
  it("a loop's two roads and the two line ends are slots; the switches are sections", () => {
    const l = line(1);
    const topo = topologyOf(l.layout, 200);
    expect(topo.slots.map((s) => s.kind).sort()).toEqual(["end", "end", "road", "road"]);
    const { s1, s2, main, side } = l.loops[0];
    expect(topo.slotOf.get(main[0])).toBe(topo.slotOf.get(main[1]));
    expect(topo.slotOf.get(side[0])).not.toBe(topo.slotOf.get(main[0]));
    expect(topo.sectionOf.has(s1) && topo.sectionOf.has(s2)).toBe(true);
    expect(topo.sectionOf.get(s1)).not.toBe(topo.sectionOf.get(s2));
    // The ends: X, Y and the track out to their loop.
    expect(topo.slots[topo.slotOf.get(l.x)!].pieces.has(l.west[1])).toBe(true);
    expect(topo.slots[topo.slotOf.get(l.east[2])!].pieces.has(l.east[0])).toBe(true);
  });

  it("a loop too short for the train is no slot (its pieces are a section); a line with no switch has an end slot up to each end's stop", () => {
    const short = line(1, { shortRoads: true });
    const t = topologyOf(short.layout, trainLength({ cars: [{ kind: "engine" }, { kind: "timber" }, { kind: "timber" }, { kind: "timber" }] } as never));
    expect(t.slots.filter((s) => s.kind === "road")).toEqual([]);
    const plain = line(0);
    const p = topologyOf(plain.layout, 200);
    expect(p.slots.map((s) => s.kind)).toEqual(["end", "end"]);
    expect(p.slots.every((s) => s.pieces.size === 2)).toBe(true);
    expect(p.sectionOf.get(plain.west[0])).toBe(p.sectionOf.get(plain.east[0]));
  });
});

describe("sections and slots: the rules", { timeout: 120_000 }, () => {
  it("entering a section needs the section and a slot at its far end, both its own; it waits short of the switch till then", () => {
    for (const l of [line(1), line(1, { station: true }), line(2)]) {
      const es = trains(l, l.middle.length > 0 ? [{ piece: l.middle[1], back: true, next: 0 }] : []);
      const r = runner(l.w, es);
      const c = checkMoves(l, es);
      for (let i = 0; i < 6 * 60 * SIM_HZ; i++) {
        r.step();
        c.tick();
      }
      expect(c.checked).toBeGreaterThan(1000);
      expect(c.bad).toBe(0);
      expect(l.economy.sections.granted).toBeGreaterThan(10);
      expect(r.meetings).toEqual([]);
    }
  });

  it("trains turn only in slots (at the line's ends), never in a section, on a line with room for them all", () => {
    for (const l of [line(1), line(2), line(1, { station: true })]) {
      const es = trains(l, l.middle.length > 0 ? [{ piece: l.middle[1], back: true, next: 0 }] : []);
      const topo = topologyOf(l.layout, Math.max(...es.map((e) => trainLength(l.sim.findCar(e)!.train))));
      const r = runner(l.w, es);
      const seen = new Map<number, number>();
      let turns = 0;
      let inSection = 0;
      for (let i = 0; i < 6 * 60 * SIM_HZ; i++) {
        r.step();
        for (const e of es) {
          const t = l.sim.findCar(e)!.train.lastTurn;
          if (!t || seen.get(e) === t.tick) continue;
          seen.set(e, t.tick);
          turns++;
          if (!topo.slotOf.has(t.pieceId)) inSection++;
        }
      }
      expect(turns).toBeGreaterThan(5);
      expect(inSection).toBe(0);
    }
  });

  it("the room rule: a line takes one train more than its passing loops; the extra one is held, saying how many loops to lay", () => {
    const l = line(1);
    const es = trains(l, [{ piece: l.east[1], back: true, next: 1 }]);
    const r = runner(l.w, es);
    const extra = es[2];
    let moved = false;
    for (let i = 0; i < 2 * 60 * SIM_HZ; i++) {
      r.step();
      if (l.economy.sections.stateOf(extra)?.move) moved = true;
    }
    expect(moved).toBe(false);
    expect(l.economy.sectionWait(extra)).toEqual({ kind: "room", lineId: l.economy.lineIdOf.get(extra), trains: 3, loops: 1, more: 1, spare: false, parked: false, other: false });
    // No passing loop at all: the second train is held, one loop to lay.
    const plain = line(0);
    const two = trains(plain);
    const r2 = runner(plain.w, two);
    r2.run(60);
    expect(two.map((e) => plain.economy.sectionWait(e)?.kind ?? null)).toContain("room");
    expect(plain.economy.sectionWait(two[1])).toMatchObject({ kind: "room", loops: 0, more: 1 });
    expect(r2.meetings).toEqual([]);
  });

  it("no circular wait with a loop per extra train: arrivals keep rising, never meeting, nothing let go", () => {
    for (const [l, more] of [
      [line(1), []],
      [line(1, { station: true }), []],
      [line(2), "middle"],
    ] as const) {
      const es = trains(l, more === "middle" ? [{ piece: l.middle[1], back: true, next: 0 }] : []);
      const r = runner(l.w, es);
      r.run(5 * 60);
      const half = es.map((e) => r.arrivals.get(e)!);
      r.run(5 * 60);
      es.forEach((e, k) => {
        expect(half[k], `train ${k}, first half`).toBeGreaterThan(3);
        expect(r.arrivals.get(e)!, `train ${k}, second half`).toBeGreaterThan(half[k] + 3);
      });
      expect(r.meetings).toEqual([]);
      expect(l.economy.sections.released).toBe(0);
    }
  });

  it("a lone train runs exactly as with sections off (and a line's second train joining later is handled)", () => {
    const run = (on: boolean) => {
      const l = line(2);
      const [a] = [train(l.w, l.west[0], true)];
      const red = editLine(l.economy, a, (s) => s.push({ depotId: l.dx.id, action: "auto" }, { depotId: l.dy.id, action: "auto" }))!;
      void red;
      l.economy.sections.enabled = on;
      const out: string[] = [];
      for (let i = 0; i < 4 * 60 * SIM_HZ; i++) {
        l.sim.tick();
        l.economy.tick();
        if (i % SIM_HZ === 0) {
          const t = l.sim.findCar(a)!.train;
          out.push(`${t.bogies[0].pieceId}:${t.bogies[0].s.toFixed(3)}:${t.speed.toFixed(3)}`);
        }
      }
      return out;
    };
    expect(run(true)).toEqual(run(false));
  });

  it("a convoy is spaced out: two routed trains of a line set off nose to tail, the second waits in its slot while the first runs the section ahead", () => {
    const l = line(1);
    // Both west of the loop, heading east for Y, one behind the other.
    const a = train(l.w, l.west[1], false);
    const b = train(l.w, l.west[0], false);
    const red = editLine(l.economy, a, (s) => s.push({ depotId: l.dx.id, action: "auto" }, { depotId: l.dy.id, action: "auto" }))!;
    joinLine(l.economy, b, red.id);
    l.economy.routeOf(a)!.next = 1;
    l.economy.routeOf(b)!.next = 1;
    const r = runner(l.w, [a, b]);
    const atY: { e: number; t: number }[] = [];
    const was = [false, false];
    for (let s = 0; s < 10 * 60 * SIM_HZ; s++) {
      r.step();
      [a, b].forEach((e, k) => {
        const rt = l.economy.routeOf(e)!;
        const at = !!rt.at && rt.next === 1;
        if (at && !was[k]) atY.push({ e, t: s / SIM_HZ });
        was[k] = at;
      });
    }
    const gaps: number[] = [];
    for (let i = 1; i < atY.length; i++) if (atY[i].e !== atY[i - 1].e) gaps.push(atY[i].t - atY[i - 1].t);
    expect(r.meetings).toEqual([]);
    expect(r.arrivals.get(a)!).toBeGreaterThan(15);
    expect(r.arrivals.get(b)!).toBeGreaterThan(15);
    // (They come to Y apart, taking turns: never one straight behind the other.)
    expect(gaps.length).toBeGreaterThan(10);
    expect(Math.min(...gaps)).toBeGreaterThan(10);
  });

  it("an under-built line keeps running: the trains it has room for turn back short of the one held, which keeps its reason", () => {
    const cases: [Line, { piece: number; back: boolean; next: number }[], CarKind[] | undefined][] = [];
    const bare = line(1);
    cases.push([bare, [{ piece: bare.east[1], back: true, next: 1 }], undefined]);
    const station = line(1, { station: true });
    cases.push([station, [{ piece: station.east[1], back: true, next: 1 }], undefined]);
    cases.push([line(0), [], undefined]);
    const plain3 = line(0);
    cases.push([plain3, [{ piece: plain3.east[1], back: true, next: 1 }], undefined]);
    cases.push([line(1, { shortRoads: true }), [], ["engine", "timber", "timber", "timber"]]);
    for (const [l, more, cars] of cases) {
      const es = trains(l, more, cars);
      const r = runner(l.w, es);
      r.run(10 * 60);
      const held = es.filter((e) => l.economy.sectionWait(e)?.kind === "room");
      const running = es.filter((e) => !held.includes(e));
      expect(held.length).toBe(es.length - 1 - l.loops.filter(() => !cars).length);
      for (const e of running) expect(r.arrivals.get(e)!, `running train ${e}`).toBeGreaterThan(10);
      expect(r.meetings).toEqual([]);
      expect(l.economy.sections.released).toBe(0);
    }
  });

  it("two trains put down face to face in one line end: one gives way (turns back), no meeting", () => {
    // (Two loops: room for all three.)
    const l = line(2);
    // B on Y's line end facing in, C deeper in it facing out: B turns back and leads out.
    const es = trains(l, [{ piece: l.east[1], back: true, next: 0 }]);
    const r = runner(l.w, es);
    r.run(5 * 60);
    expect(r.meetings).toEqual([]);
    expect(l.economy.sections.gaveWay).toBeGreaterThan(0);
    for (const e of es) expect(r.arrivals.get(e)!).toBeGreaterThan(3);
  });

  it("the engine card says why: waiting for the line's other train, or how many passing loops to lay", () => {
    const texts = (l: Line, es: readonly number[], seconds: number) => {
      const r = runner(l.w, es);
      const seen = new Set<string>();
      for (let i = 0; i < seconds * SIM_HZ; i++) {
        r.step();
        if (i % 30 === 0) for (const e of es) seen.add(engineStatus(l.sim, l.economy, e, () => "Larkfield"));
      }
      return seen;
    };
    const two = line(1);
    expect(texts(two, trains(two), 120)).toContain("Waiting for the Red line train");
    const three = line(1);
    expect(texts(three, trains(three, [{ piece: three.east[1], back: true, next: 1 }]), 60)).toContain("Waiting: lay 1 more passing loop for 3 trains");
    const plain = line(0);
    const seen = texts(plain, trains(plain, [{ piece: plain.east[1], back: true, next: 1 }]), 60);
    expect(seen).toContain("Waiting: lay 2 more passing loops for 3 trains");
  });
});
