import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { Economy } from "./economy";
import { chain, loopOn, runner, train, type World } from "./loop-fixtures";

/**
 * Block working (routes Phase 3c, economy/crossing.ts): a train leaving a passing place claims through to the next
 * passing place along its route, or to a terminus, whichever comes first; with no passing place on its line, to the
 * next terminus, where the line's trains take turns.
 */

/**
 * A line that runs on past its only loop: X ⊐ ══ S1 ═ loop ═ S2 ══ (signal) ══ M ══ ══ Y ⊏, stops X, M and Y (the
 * stretch S2–M–Y single track, two stops on it beyond the loop). With `lift`, the stretch beyond M climbs a train lift
 * to Y on a dead-end branch up high.
 *
 *   ⊐ X ══ S1 ══ main ══ S2 ══ (⊓) ══ M ══ ══ (lift) ══ Y ⊏
 *              ╲_ side _╱
 */
function runOn(opts: { signal?: boolean; lift?: boolean } = {}) {
  const layout = new Layout();
  const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  const loop = loopOn(layout, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["straight-216"]);
  const types: PieceTypeId[] = [...(opts.signal ? (["signal"] as const) : []), "straight-216", "depot-sawmill", "straight-216", ...(opts.lift ? (["kit-train-lift"] as const) : []), "straight-216", "depot-forest"];
  const east = chain(layout, types, connectorRef(loop.s2, 0));
  const m = east[types.indexOf("depot-sawmill")];
  const y = east[east.length - 1];
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", x, 0);
  const dm = economy.addDepot("sawmill", m, 0);
  const dy = economy.addDepot("town", y, 1);
  const w = { layout, sim, economy, dx } as unknown as World;
  return { w, layout, sim, economy, dx, dm, dy, x, m, y, west, east, ...loop, signal: opts.signal ? east[0] : -1 };
}

type RunOn = ReturnType<typeof runOn>;

/** Trains on the X–M–Y line: A west of the loop heading for X, B beyond M heading for Y, and (`third`) C in the loop. */
function trainsOn(r: RunOn, third = false, cars?: CarKind[]) {
  const mAt = r.east.indexOf(r.m);
  const a = train(r.w, r.west[0], true, cars);
  const b = train(r.w, r.east[mAt + 1], false, cars);
  const es = [a, b, ...(third ? [train(r.w, r.main[0], false, cars)] : [])];
  const red = editLine(r.economy, a, (s) => s.push(...[r.dx, r.dm, r.dy].map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
  for (const e of es.slice(1)) joinLine(r.economy, e, red.id);
  r.economy.routeOf(a)!.next = 0;
  r.economy.routeOf(b)!.next = 2;
  if (third) r.economy.routeOf(es[2])!.next = 1;
  return es;
}

/**
 * A single-track line from X to Y with no passing place, turnbacks at both ends (and with `middle`, depot M mid-way):
 * A west heading for X, B east heading for Y, and (`n` 3) C behind B, heading for Y too.
 */
function plain(n: 2 | 3, middle = false) {
  const layout = new Layout();
  const types: PieceTypeId[] = ["depot-forest", "straight-216", "straight-216", ...(middle ? (["depot-sawmill"] as const) : []), "straight-216", "straight-216", "depot-forest"];
  const ids = chain(layout, types);
  appendPiece(layout, "buffer-turnback", false, connectorRef(ids[0], 0));
  appendPiece(layout, "buffer-turnback", false, connectorRef(ids[ids.length - 1], 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", ids[0], 0);
  const dm = middle ? economy.addDepot("sawmill", ids[3], 0) : null;
  const dy = economy.addDepot("town", ids[ids.length - 1], 1);
  const w = { layout, sim, economy, dx } as unknown as World;
  const last = ids.length - 1;
  const es = [train(w, ids[1], true), train(w, ids[last - 2], false), ...(n > 2 ? [train(w, ids[last - 1], false)] : [])];
  const stops = dm ? [dx, dm, dy, dm] : [dx, dy];
  const red = editLine(economy, es[0], (s) => s.push(...stops.map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
  for (const e of es.slice(1)) joinLine(economy, e, red.id);
  economy.routeOf(es[0])!.next = 0;
  for (const e of es.slice(1)) economy.routeOf(e)!.next = dm ? 2 : 1;
  return { w, es, economy };
}

/** Every release but the player's Go now (the safety net). */
const releases = (economy: Economy) => economy.crossing.releases.filter((r) => r.why !== "go-now");

// (Minutes of play, tick by tick: slow on a loaded machine.)
describe("block working (crossing, Phase 3c)", { timeout: 120_000 }, () => {
  it("a line running on past its only loop (X – loop – M – Y): two trains, 25 minutes, never meeting, never let go", () => {
    const r = runOn();
    const es = trainsOn(r);
    const run = runner(r.w, es);
    const east = new Set(r.east);
    let through = false;
    let both = 0;
    for (let i = 0; i < 25 * 60 * SIM_HZ; i++) {
      run.step();
      if (i % 30 !== 0) continue;
      // A block out of the loop runs on through M to Y, the terminus.
      for (const e of es) {
        const c = r.economy.crossing.claimOf(e)?.map((x) => x.pieceId) ?? [];
        if (c.includes(r.m) && c.includes(r.y)) through = true;
      }
      // Never two trains on the single track beyond the loop at once.
      if (es.filter((e) => r.sim.findCar(e)!.train.bogies.some((b) => east.has(b.pieceId))).length > 1) both++;
    }
    expect(run.meetings).toEqual([]);
    expect(releases(r.economy)).toEqual([]);
    expect(through).toBe(true);
    expect(both).toBe(0);
    for (const e of es) expect(run.arrivals.get(e)!).toBeGreaterThan(30);
  });

  it("the same line with three trains (one in the loop): blocks never meet; one stop at a time (Phase 3b) livelocks", () => {
    const r = runOn();
    const es = trainsOn(r, true);
    const run = runner(r.w, es);
    run.run(25 * 60);
    expect(run.meetings).toEqual([]);
    expect(releases(r.economy)).toEqual([]);
    for (const e of es) expect(run.arrivals.get(e)!).toBeGreaterThan(25);
    // Claiming one stop to the next, trains claim into the single track beyond the loop from either end, wait at stops
    // in each other's way, and the safety net lets them go into each other.
    const old = runOn();
    old.economy.crossing.blocks = false;
    const t = trainsOn(old, true);
    const ro = runner(old.w, t);
    ro.run(25 * 60);
    expect(ro.meetings.length).toBeGreaterThan(20);
    expect(releases(old.economy).length).toBeGreaterThan(10);
  });

  for (const n of [2, 3] as const)
    it(`no passing place, ${n} trains: they take turns end to end, never meeting, never let go, arrivals rising`, () => {
      const { w, es, economy } = plain(n);
      const r = runner(w, es);
      r.run(5 * 60);
      const half = es.map((e) => r.arrivals.get(e)!);
      r.run(5 * 60);
      expect(r.meetings).toEqual([]);
      expect(releases(economy)).toEqual([]);
      es.forEach((e, k) => {
        expect(half[k], `train ${k} by 5 min`).toBeGreaterThan(2);
        expect(r.arrivals.get(e)!, `train ${k}, 5 to 10 min`).toBeGreaterThan(half[k] + 2);
      });
      expect(es.some((e) => r.waits.get(e)!.has("turn"))).toBe(true);
      for (const e of es) expect(r.waits.get(e)!).not.toContain("needs-loop");
      if (n === 3) {
        // Claiming one stop to the next (Phase 3b), the three livelock: they bounce off each other.
        const old = plain(3);
        old.economy.crossing.blocks = false;
        const ro = runner(old.w, old.es);
        ro.run(10 * 60);
        expect(ro.meetings.length).toBeGreaterThan(10);
      }
    });

  it("no passing place, a stop in the middle (X–M–Y–M), 3 trains: they take turns, never meeting", () => {
    const { w, es, economy } = plain(3, true);
    const r = runner(w, es);
    r.run(10 * 60);
    expect(r.meetings).toEqual([]);
    expect(releases(economy)).toEqual([]);
    for (const e of es) expect(r.arrivals.get(e)!).toBeGreaterThan(3);
  });

  it("the card of a train waiting its turn says the line has no passing loop", () => {
    const { w, es } = plain(2);
    const r = runner(w, es);
    const texts = new Set<string>();
    for (let i = 0; i < 3 * 60 * SIM_HZ; i++) {
      r.step();
      if (i % 10 === 0) for (const e of es) if (w.economy.crossWait(e)) texts.add(engineStatus(w.sim, w.economy, e, () => "Larkfield"));
    }
    expect(texts).toContain("Waiting its turn: the Red line has no passing loop");
  });

  it("a terminus turn-back always claims its way back: the one at Y goes back before any other train comes in", () => {
    const r = runOn();
    const es = trainsOn(r, true);
    const run = runner(r.w, es);
    const east = new Set(r.east);
    // Each time a train comes to Y, the next train onto the single track beyond the loop is that one, going back.
    let atY = -1;
    let inBehind = 0;
    let backs = 0;
    const onEast = (e: number) => r.sim.findCar(e)!.train.bogies.some((b) => east.has(b.pieceId));
    for (let i = 0; i < 20 * 60 * SIM_HZ; i++) {
      run.step();
      for (const e of es) {
        const ro = r.economy.routeOf(e)!;
        if (ro.at && r.economy.depot(ro.stops[ro.next % ro.stops.length].depotId)!.pieceId === r.y) atY = e;
      }
      if (atY !== -1) {
        for (const e of es) if (e !== atY && onEast(e)) inBehind++;
        if (!onEast(atY)) {
          backs++;
          atY = -1;
        }
      }
    }
    expect(backs).toBeGreaterThan(10);
    expect(inBehind).toBe(0);
    expect(run.meetings).toEqual([]);
    expect(releases(r.economy)).toEqual([]);
  });

  it("two loops (X – loop – M – loop – Y, X–M–Y–M): three trains, blocks loop to loop, never meeting, never let go", () => {
    const layout = new Layout();
    const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
    const l1 = loopOn(layout, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["straight-216"]);
    const mid = chain(layout, ["straight-216", "depot-sawmill", "straight-216", "straight-216"], connectorRef(l1.s2, 0));
    const l2 = loopOn(layout, connectorRef(mid[3], 1), ["straight-216", "straight-216"], ["straight-216"]);
    const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(l2.s2, 0));
    appendPiece(layout, "buffer-turnback", false, connectorRef(east[2], 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const dx = economy.addDepot("forest", x, 0);
    const dm = economy.addDepot("sawmill", mid[1], 0);
    const dy = economy.addDepot("town", east[2], 1);
    const w = { layout, sim, economy, dx } as unknown as World;
    const es = [train(w, west[0], true), train(w, east[0], false), train(w, mid[2], false)];
    const red = editLine(economy, es[0], (s) => s.push(...[dx, dm, dy, dm].map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
    for (const e of es.slice(1)) joinLine(economy, e, red.id);
    economy.routeOf(es[0])!.next = 0;
    economy.routeOf(es[1])!.next = 2;
    economy.routeOf(es[2])!.next = 2;
    const r = runner(w, es);
    const roads1 = new Set([...l1.main, ...l1.side]);
    const roads2 = new Set([...l2.main, ...l2.side]);
    let loopToLoop = false;
    for (let i = 0; i < 25 * 60 * SIM_HZ; i++) {
      r.step();
      if (i % 30 !== 0 || loopToLoop) continue;
      // A block from one loop through M to the other, standing there.
      for (const e of es) {
        const t = sim.findCar(e)!.train;
        const c = economy.crossing.claimOf(e)?.map((x) => x.pieceId) ?? [];
        if (t.bogies.some((b) => roads1.has(b.pieceId)) && c.includes(mid[1]) && c.some((p) => roads2.has(p))) loopToLoop = true;
      }
    }
    expect(loopToLoop).toBe(true);
    expect(r.meetings).toEqual([]);
    expect(releases(economy)).toEqual([]);
    for (const e of es) expect(r.arrivals.get(e)!).toBeGreaterThan(20);
  });

  it("a lone train runs exactly as without blocks (and without loops)", () => {
    const traces = (["blocks", "sections", "stops"] as const).map((how) => {
      const r = runOn();
      r.economy.crossing.blocks = how === "blocks";
      r.economy.crossing.loops = how !== "stops";
      const a = train(r.w, r.west[0], true);
      editLine(r.economy, a, (s) => s.push(...[r.dx, r.dm, r.dy].map((d) => ({ depotId: d.id, action: "auto" as const }))));
      const run = runner(r.w, [a]);
      const trace: string[] = [];
      for (let i = 0; i < 10 * 60 * SIM_HZ; i++) {
        run.step();
        if (i % 30 === 0) {
          const t = r.sim.findCar(a)!.train;
          expect(r.economy.crossing.steerAvoid(a, t)).toBeUndefined();
          trace.push(`${t.bogies[0].pieceId}:${t.bogies[0].s.toFixed(3)}`);
        }
      }
      expect(run.arrivals.get(a)!).toBeGreaterThan(10);
      return trace;
    });
    expect(traces[0]).toEqual(traces[1]);
    expect(traces[0]).toEqual(traces[2]);
  });

  it("the safety net still lets a train go when its line stands still (a signal held at red by hand), and logs it", () => {
    const r = runOn({ signal: true });
    const es = trainsOn(r);
    const run = runner(r.w, es);
    // Hold the signal beyond the loop at red: the train going east stops at it, holding its block, and the other waits.
    r.sim.toggleSignal(r.signal);
    for (let i = 0; i < 4 * 60 * SIM_HZ && releases(r.economy).length === 0; i++) run.step();
    const let_ = releases(r.economy);
    expect(let_.length).toBeGreaterThan(0);
    expect(let_[0].why).toBe("quiet");
    expect(r.economy.crossing.released.quiet).toBeGreaterThan(0);
    expect(let_.every((x) => es.includes(x.engine))).toBe(true);
  });

  it("other lines and unrouted trains are left alone by block working", () => {
    for (const how of ["other line", "unrouted"] as const) {
      const r = runOn();
      const a = train(r.w, r.west[0], true);
      const b = train(r.w, r.east[3], false);
      editLine(r.economy, a, (s) => s.push(...[r.dx, r.dm, r.dy].map((d) => ({ depotId: d.id, action: "auto" as const }))));
      if (how === "other line") editLine(r.economy, b, (s) => s.push(...[r.dy, r.dx].map((d) => ({ depotId: d.id, action: "auto" as const }))));
      const run = runner(r.w, [a, b]);
      for (let i = 0; i < 3 * 60 * SIM_HZ; i++) {
        run.step();
        if (i % 30 === 0) for (const e of [a, b]) expect(r.economy.crossing.steerAvoid(e, r.sim.findCar(e)!.train), how).toBeUndefined();
      }
      expect([...run.waits.get(a)!, ...run.waits.get(b)!], how).toEqual([]);
      expect(r.economy.crossing.releases, how).toEqual([]);
    }
  });

  it("a line's train ids change only when a train is turned round at the end of the line (never by crossing)", () => {
    // (QA: ids changing every ~30 s with two trains on a line. A train turned round at a turnback buffer, or short of a
    // train of its line at a terminus, is a new train in the sim, its cars keeping their ids; crossing keys everything by
    // engine car id. Nothing else re-creates a train here: no head-on turn-backs, no releases.)
    const r = runOn();
    const es = trainsOn(r);
    const run = runner(r.w, es);
    const ids = new Map(es.map((e) => [e, r.sim.findCar(e)!.train.id]));
    let changes = 0;
    let unexplained = 0;
    for (let i = 0; i < 10 * 60 * SIM_HZ; i++) {
      run.step();
      const turned = new Set<number>();
      for (const ev of r.sim.drainEvents()) if (ev.kind === "turned") turned.add(ev.newTrainId);
      for (const e of es) {
        const id = r.sim.findCar(e)!.train.id;
        if (id === ids.get(e)) continue;
        changes++;
        if (!turned.has(id)) unexplained++;
        ids.set(e, id);
      }
    }
    expect(changes).toBeGreaterThan(0);
    expect(unexplained).toBe(0);
    expect(run.meetings).toEqual([]);
    expect(releases(r.economy)).toEqual([]);
  });

  it("a lift on the dead-end branch beyond the last loop: two trains, no livelock, never let go", () => {
    const r = runOn({ lift: true });
    const es = trainsOn(r);
    const run = runner(r.w, es);
    run.run(5 * 60);
    const half = es.map((e) => run.arrivals.get(e)!);
    run.run(5 * 60);
    expect(run.meetings).toEqual([]);
    expect(releases(r.economy)).toEqual([]);
    es.forEach((e, k) => expect(run.arrivals.get(e)!, `train ${k}`).toBeGreaterThan(half[k]));
  });
});
