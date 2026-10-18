import { describe, expect, it } from "vitest";
import { CAR_SPECS, flipCursor, Sim, SIM_HZ, type CarKind, type Cursor } from "../sim";
import { appendPiece, connectorRef, getPieceDef, Layout, pathLength, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { loopOnLine, loopRoadAt, passingLoops } from "../game/passing-loop";
import { Economy } from "./economy";
import { STAND_SHORT, TAIL_CLEAR, trainLength } from "./crossing";
import { chain, loopOn, runner, train, twoTrainsOn, type World } from "./loop-fixtures";
import * as steering from "./steer";

/**
 * A single-track line from depot X to depot Y, turnbacks on both ends, with a passing loop mid-way (its main road
 * `main`, its other road round by `side`); with `station`, depot M on the line just west of the loop (a straight
 * between them, so a train standing at M is clear of the switch).
 *
 *   ⊐ X ══ ══ (M ══) S1 ══ main ══ S2 ══ ══ Y ⊏
 *                      ╲__ side __╱
 */
function line(opts: { main?: PieceTypeId[]; side?: PieceTypeId[]; station?: boolean } = {}) {
  const layout = new Layout();
  const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216", ...(opts.station ? (["depot-sawmill", "straight-216"] as const) : [])]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  const lead = opts.station ? west.pop()! : -1;
  const m = opts.station ? west.pop()! : -1;
  const loop = loopOn(layout, connectorRef(opts.station ? lead : west[1], 1), opts.main ?? ["straight-216", "straight-216"], opts.side ?? ["straight-216"]);
  const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(loop.s2, 0));
  const y = east[2];
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", x, 0);
  const dm = m !== -1 ? economy.addDepot("sawmill", m, 0) : null;
  const dy = economy.addDepot("town", y, 1);
  return { layout, sim, economy, dx, dm, dy, x, m, y, west, east, ...loop, roads: new Set([...loop.main, ...loop.side]) };
}

type L = ReturnType<typeof line>;

/**
 * Two trains on the X–Y line (or `stops`): A west of the loop heading for X, B east of it heading for Y (a piece
 * nearer the loop than A, so they don't come to it at the same moment every time).
 */
function two(w: L, cars?: CarKind[], stops = [w.dx.id, w.dy.id], aNext = 0, bNext = stops.length - 1) {
  return twoTrainsOn(w as unknown as World, w.west[0], w.east[0], stops, aNext, bNext, cars);
}

/**
 * Watch the loop: every stand in it (a train still on its roads for over half a second) with or without a wait at the
 * loop on its card, and whether, standing, the train was wholly on one road, clear of both switches by its length.
 */
function watcher(w: L, engines: readonly number[]) {
  const still = new Map<number, number>(engines.map((e) => [e, 0]));
  let unexplained = 0;
  let waitedTicks = 0;
  let fouled = 0;
  let checked = 0;
  const len = (pieceId: number, path: number) => {
    const p = w.layout.getPiece(pieceId)!;
    return pathLength(getPieceDef(p.type, p.flipped).paths[path].geom);
  };
  const loop = passingLoops(w.layout)[0];
  const roadAt = loopRoadAt(w.layout);
  /** How far (mm) from a cursor on a loop road, the way it points, to the end of the road (a switch). */
  const toSwitch = (c: Cursor) => {
    const at = roadAt.get(c.pieceId)!;
    const road = loop.roads[at.road].pieces;
    const p = w.layout.getPiece(c.pieceId)!;
    const path = getPieceDef(p.type, p.flipped).paths[c.pathIndex];
    const toB = (c.reversed ? path.to : path.from) === at.aEnd;
    let d = len(c.pieceId, c.pathIndex) - c.s;
    const i = road.indexOf(c.pieceId);
    for (let j = toB ? i + 1 : i - 1; j >= 0 && j < road.length; j += toB ? 1 : -1) d += len(road[j], 0);
    return d;
  };
  const tick = () => {
    for (const e of engines) {
      const t = w.sim.findCar(e)!.train;
      const inLoop = t.bogies.some((b) => w.roads.has(b.pieceId) || b.pieceId === w.s1 || b.pieceId === w.s2);
      const wait = w.economy.crossWait(e)?.wait;
      const atLoop = wait?.kind === "waiting" && wait.atLoop;
      if (atLoop) waitedTicks++;
      if (!inLoop || t.speed >= 1) {
        still.set(e, 0);
        continue;
      }
      still.set(e, still.get(e)! + 1);
      if (!atLoop && !w.economy.crossWait(e) && still.get(e)! >= SIM_HZ / 2) unexplained++;
      if (!atLoop || t.speed > 0) continue;
      // Standing at the loop: every axle on one road, the buffers clear of both switches.
      checked++;
      const road = w.main.includes(t.bogies[0].pieceId) ? w.main : w.side;
      if (!t.bogies.every((b) => road.includes(b.pieceId))) {
        fouled++;
        continue;
      }
      // How far each end's buffers are from the switch they face: the front's from the far switch by STAND_SHORT at
      // least (so its whole length is clear of it), the rear's clear of the near one.
      const lead = CAR_SPECS[t.cars[0].kind].bogieInset;
      const tail = CAR_SPECS[t.cars[t.cars.length - 1].kind].bogieInset;
      const rear = { ...t.bogies[t.bogies.length - 1] };
      flipCursor(w.layout, rear);
      if (toSwitch(t.bogies[0]) - lead < STAND_SHORT - 1 || toSwitch(rear) - tail < 0) fouled++;
    }
  };
  return { tick, unexplained: () => unexplained, waited: () => waitedTicks / SIM_HZ, fouled: () => fouled, checked: () => checked };
}

// (Minutes of play, tick by tick: slow on a loaded machine.)
describe("trains that wait for each other in passing loops (crossing, Phase 3b)", { timeout: 60_000 }, () => {
  it("the loop is found, both its roads long enough for a short train", () => {
    const w = line();
    const loops = passingLoops(w.layout);
    expect(loops).toHaveLength(1);
    const t = w.sim.getTrain((w.sim.addTrain(["engine", "timber"], { pieceId: w.west[0], pathIndex: 0, reversed: false, s: 100 }) as { trainId: number }).trainId)!;
    for (const r of loops[0].roads) expect(r.length).toBeGreaterThanOrEqual(trainLength(t) + STAND_SHORT + TAIL_CLEAR);
  });

  it("two trains on a there-and-back line with a loop mid-way pass at the loop, never meeting head on", () => {
    const w = line();
    const { a, b } = two(w);
    const r = runner(w as unknown as World, [a, b]);
    const watch = watcher(w, [a, b]);
    for (let i = 0; i < 25 * 60 * SIM_HZ; i++) {
      r.step();
      watch.tick();
    }
    expect(r.meetings).toEqual([]);
    expect(r.arrivals.get(a)!).toBeGreaterThan(30);
    expect(r.arrivals.get(b)!).toBeGreaterThan(30);
    // They waited for each other in the loop (and never said the line needs a loop)...
    expect(watch.waited()).toBeGreaterThan(0);
    for (const e of [a, b]) expect(r.waits.get(e)!).not.toContain("needs-loop");
    expect([...r.waits.get(a)!, ...r.waits.get(b)!].some((s) => s.endsWith(":loop"))).toBe(true);
    // ...and never stood in it but to wait, nor on or fouling a switch.
    expect(watch.unexplained()).toBe(0);
    expect(watch.checked()).toBeGreaterThan(0);
    expect(watch.fouled()).toBe(0);
    // Waiting only at stops (Phase 3a), the same line can't cross them: it needs a loop, and they meet.
    const old = line();
    old.economy.crossing.loops = false;
    const t = two(old);
    const ro = runner(old as unknown as World, [t.a, t.b]);
    ro.run(5 * 60);
    expect([...ro.waits.get(t.a)!, ...ro.waits.get(t.b)!]).toContain("needs-loop");
    expect(ro.meetings.length).toBeGreaterThan(0);
  });

  it("a loop at a one-platform middle station (X–M–Y–M): they cross there", () => {
    const w = line({ station: true });
    const stops = [w.dx.id, w.dm!.id, w.dy.id, w.dm!.id];
    const { a, b } = two(w, undefined, stops, 0, 2);
    const r = runner(w as unknown as World, [a, b]);
    const watch = watcher(w, [a, b]);
    for (let i = 0; i < 25 * 60 * SIM_HZ; i++) {
      r.step();
      watch.tick();
    }
    expect(r.meetings).toEqual([]);
    expect(r.arrivals.get(a)!).toBeGreaterThan(30);
    expect(r.arrivals.get(b)!).toBeGreaterThan(30);
    expect(watch.waited()).toBeGreaterThan(0);
    expect(watch.unexplained()).toBe(0);
    expect(watch.fouled()).toBe(0);
    for (const e of [a, b]) expect(r.waits.get(e)!).not.toContain("needs-loop");
    // The player's line is never changed.
    for (const e of [a, b]) expect(w.economy.routeOf(e)!.stops.map((s) => s.depotId)).toEqual(stops);
    // Waiting only at stops, they can't: both stop at M's one platform.
    const old = line({ station: true });
    old.economy.crossing.loops = false;
    const t = two(old, undefined, [old.dx.id, old.dm!.id, old.dy.id, old.dm!.id], 0, 2);
    const ro = runner(old as unknown as World, [t.a, t.b]);
    ro.run(5 * 60);
    expect([...ro.waits.get(t.a)!, ...ro.waits.get(t.b)!]).toContain("needs-loop");
  });

  it("three trains on X–M–Y–M with a loop each side of M: they pass in the loops and at M, never meeting head on", () => {
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
    const a = train(w, west[0], true);
    const b = train(w, east[0], false);
    const c = train(w, mid[2], false);
    const red = editLine(economy, a, (s) => s.push(...[dx, dm, dy, dm].map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
    joinLine(economy, b, red.id);
    joinLine(economy, c, red.id);
    economy.routeOf(a)!.next = 0;
    economy.routeOf(b)!.next = 2;
    economy.routeOf(c)!.next = 2;
    const r = runner(w, [a, b, c]);
    r.run(25 * 60);
    expect(r.meetings).toEqual([]);
    for (const e of [a, b, c]) {
      expect(r.arrivals.get(e)!).toBeGreaterThan(20);
      expect(r.waits.get(e)!).not.toContain("needs-loop");
    }
  });

  it("the 'Lay a passing loop' goal ticks for a loop the trains really cross at, and not for one they can't use", () => {
    // A bare loop mid-way between two stations: ticks, and two trains cross there (never meeting head on).
    const w = line();
    const { a, b } = two(w);
    expect(loopOnLine(w.economy)).toBe(true);
    const r = runner(w as unknown as World, [a, b]);
    r.run(10 * 60);
    expect(r.meetings).toEqual([]);
    expect([...r.waits.get(a)!, ...r.waits.get(b)!].some((s) => s.endsWith(":loop"))).toBe(true);
    // Too short for the line's trains: doesn't tick.
    const short = line({ main: ["straight-216"], side: [] });
    two(short, ["engine", "timber", "timber", "timber"]);
    expect(loopOnLine(short.economy)).toBe(false);
    // A pinned switch: no passing place, doesn't tick.
    const pinned = line();
    two(pinned);
    pinned.layout.setPinned(pinned.s2, true);
    expect(loopOnLine(pinned.economy)).toBe(false);
    // A loop whose one road is the only platform every train calls at (X–M–Y–M): the line never runs through it.
    const layout = new Layout();
    const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
    const l = loopOn(layout, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["depot-sawmill"]);
    const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], connectorRef(l.s2, 0));
    appendPiece(layout, "buffer-turnback", false, connectorRef(east[2], 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const [dx, dm, dy] = [economy.addDepot("forest", x, 0), economy.addDepot("sawmill", l.side[1], 0), economy.addDepot("town", east[2], 1)];
    const t = train({ layout, sim, economy, dx } as unknown as World, west[0], true);
    editLine(economy, t, (s) => s.push(...[dx, dm, dy, dm].map((d) => ({ depotId: d.id, action: "auto" as const }))));
    expect(loopOnLine(economy)).toBe(false);
    // The same loop on X–M–Y (one way calls at M, the other runs through on the main road): ticks.
    editLine(economy, t, (s) => s.splice(0, s.length, ...[dx, dm, dy].map((d) => ({ depotId: d.id, action: "auto" as const }))));
    expect(loopOnLine(economy)).toBe(true);
  });

  it("a lone train never changes its way: steering is given no hint, and it runs exactly as without loops", () => {
    const runs = [true, false].map((loops) => {
      const w = line();
      w.economy.crossing.loops = loops;
      const a = train(w as unknown as World, w.west[0], true);
      editLine(w.economy, a, (s) => s.push({ depotId: w.dx.id, action: "auto" }, { depotId: w.dy.id, action: "auto" }));
      const r = runner(w as unknown as World, [a]);
      const trace: string[] = [];
      for (let i = 0; i < 10 * 60 * SIM_HZ; i++) {
        r.step();
        if (i % 30 === 0) {
          const t = w.sim.findCar(a)!.train;
          expect(w.economy.crossing.steerAvoid(a, t)).toBeUndefined();
          trace.push(`${t.bogies[0].pieceId}:${t.bogies[0].s.toFixed(3)}:${w.layout.switchState(w.s1)}${w.layout.switchState(w.s2)}`);
        }
      }
      return { trace, arrivals: r.arrivals.get(a)! };
    });
    expect(runs[0].arrivals).toBeGreaterThan(10);
    expect(runs[0].trace).toEqual(runs[1].trace);
  });

  it("steer with the hint the economy gives a lone train sets every switch as without one", () => {
    const w = line();
    const a = train(w as unknown as World, w.west[0], true);
    editLine(w.economy, a, (s) => s.push({ depotId: w.dx.id, action: "auto" }, { depotId: w.dy.id, action: "auto" }));
    const r = runner(w as unknown as World, [a]);
    for (let i = 0; i < 3 * 60 * SIM_HZ; i++) {
      r.step();
      if (i % 60 !== 0) continue;
      const t = w.sim.findCar(a)!.train;
      const target = w.economy.depot(w.economy.routeOf(a)!.stops[w.economy.routeOf(a)!.next].depotId)!.pieceId;
      const before = [w.layout.switchState(w.s1), w.layout.switchState(w.s2)];
      const hinted = steering.steer(w.layout, t, true, target, w.economy.crossing.steerAvoid(a, t));
      const afterHint = [w.layout.switchState(w.s1), w.layout.switchState(w.s2)];
      w.layout.setSwitchState(w.s1, before[0]);
      w.layout.setSwitchState(w.s2, before[1]);
      const plain = steering.steer(w.layout, t, true, target);
      expect([hinted, ...afterHint]).toEqual([plain, w.layout.switchState(w.s1), w.layout.switchState(w.s2)]);
    }
  });

  it("a pinned entry switch wins: the trains wait at their stops as before (Phase 3a), never in the loop", () => {
    for (const pin of ["s1", "s2"] as const) {
      const w = line();
      w.layout.setPinned(w[pin], true);
      const { a, b } = two(w);
      const r = runner(w as unknown as World, [a, b]);
      let loopWait = 0;
      let needsLoop = false;
      for (let i = 0; i < 4 * 60 * SIM_HZ; i++) {
        r.step();
        for (const e of [a, b]) {
          const wait = w.economy.crossWait(e)?.wait;
          if (wait?.kind === "waiting" && wait.atLoop) loopWait++;
          if (wait?.kind === "needs-loop") needsLoop = true;
        }
      }
      expect(loopWait, pin).toBe(0);
      expect(needsLoop, pin).toBe(true);
    }
  });

  it("a loop too short for the train: it waits at the stop before it, as before", () => {
    // Main road one straight, the other just its two curves: a four-car train is longer than either road.
    const w = line({ main: ["straight-216"], side: [] });
    const cars: CarKind[] = ["engine", "timber", "timber", "timber"];
    const roads = passingLoops(w.layout)[0].roads;
    const { a, b } = two(w, cars);
    const len = trainLength(w.sim.findCar(a)!.train);
    for (const road of roads) expect(road.length).toBeLessThan(len + STAND_SHORT + TAIL_CLEAR);
    const r = runner(w as unknown as World, [a, b]);
    let loopWait = 0;
    let atStop = 0;
    for (let i = 0; i < 4 * 60 * SIM_HZ; i++) {
      r.step();
      for (const e of [a, b]) {
        const wait = w.economy.crossWait(e)?.wait;
        if (wait?.kind === "waiting" && wait.atLoop) loopWait++;
        if (wait && !(wait.kind === "waiting" && wait.atLoop) && w.economy.routeOf(e)!.at) atStop++;
      }
    }
    expect(loopWait).toBe(0);
    expect(atStop).toBeGreaterThan(0);
  });

  it("the engine card says it waits at the loop for the train of its line", () => {
    const w = line();
    const { a, b } = two(w);
    const r = runner(w as unknown as World, [a, b]);
    const texts = new Set<string>();
    const names = (id: number) => (id === w.dx.id ? "Larkfield" : "Elderwick");
    for (let i = 0; i < 5 * 60 * SIM_HZ; i++) {
      r.step();
      for (const e of [a, b]) if (w.economy.crossWait(e)?.wait.kind === "waiting") texts.add(engineStatus(w.sim, w.economy, e, names));
    }
    expect(texts).toContain("Waiting at the loop for the Red line train");
  });

  it("other lines and unrouted trains are left alone (they meet as before)", () => {
    for (const how of ["other line", "unrouted"] as const) {
      const w = line();
      const a = train(w as unknown as World, w.west[0], true);
      const b = train(w as unknown as World, w.east[1], false);
      editLine(w.economy, a, (s) => s.push({ depotId: w.dx.id, action: "auto" }, { depotId: w.dy.id, action: "auto" }));
      if (how === "other line") {
        editLine(w.economy, b, (s) => s.push({ depotId: w.dy.id, action: "auto" }, { depotId: w.dx.id, action: "auto" }));
        expect(w.economy.lineIdOf.get(b)).not.toBe(w.economy.lineIdOf.get(a));
      }
      const r = runner(w as unknown as World, [a, b]);
      for (let i = 0; i < 4 * 60 * SIM_HZ; i++) {
        r.step();
        for (const e of [a, b]) {
          expect(w.economy.crossing.steerAvoid(e, w.sim.findCar(e)!.train), how).toBeUndefined();
        }
      }
      expect([...r.waits.get(a)!, ...r.waits.get(b)!], how).toEqual([]);
      expect(r.meetings.length, how).toBeGreaterThan(0);
    }
  });

  it("rebuilt from where the trains are after a load: one waiting in the loop still waits there", () => {
    const w = line();
    const { a, b } = two(w);
    const r = runner(w as unknown as World, [a, b]);
    let waiting = -1;
    for (let i = 0; i < 5 * 60 * SIM_HZ && waiting === -1; i++) {
      r.step();
      for (const e of [a, b]) {
        const wait = w.economy.crossWait(e)?.wait;
        if (wait?.kind === "waiting" && wait.atLoop && w.sim.findCar(e)!.train.speed === 0) waiting = e;
      }
    }
    expect(waiting).not.toBe(-1);
    const nextOf = (e: number) => w.economy.routeOf(e)!.next;
    const nexts = new Map([a, b].map((e) => [e, nextOf(e)]));
    const pieceOf = (e: number) => w.sim.findCar(e)!.train.bogies[0].pieceId;
    const stoodAt = pieceOf(waiting);
    // "Load": a fresh economy on the same track and trains, its depots and line as saved, each heading where it was.
    const economy = new Economy(w.layout, w.sim);
    const dx = economy.addDepot("forest", w.x, 0);
    const dy = economy.addDepot("town", w.y, 1);
    const red = editLine(economy, a, (s) => s.push({ depotId: dx.id, action: "auto" }, { depotId: dy.id, action: "auto" }))!;
    joinLine(economy, b, red.id);
    for (const e of [a, b]) economy.routeOf(e)!.next = nexts.get(e)!;
    const w2 = { ...w, economy, dx, dy };
    const r2 = runner(w2 as unknown as World, [a, b]);
    // It stays in the loop till the other has passed it, and they never meet.
    let passed = false;
    let waited = 0;
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      r2.step();
      const stands = w.sim.findCar(waiting)!.train.speed === 0;
      if (!passed) {
        // (Till it goes on, it stands where it was, waiting for the other.)
        if (!stands) passed = true;
        else {
          expect(pieceOf(waiting)).toBe(stoodAt);
          if (economy.crossWait(waiting)?.wait) waited++;
        }
      }
    }
    expect(passed).toBe(true);
    expect(waited).toBeGreaterThan(0);
    expect(r2.meetings).toEqual([]);
  });
});

/**
 * X—(middle)—Y, turnbacks on both ends: `plain` nothing in the middle; `loopstop` a loop with depot M on its other
 * road (line X–M–Y); `bare` a loop with nothing on it (line X–Y). `n` trains: A heading for X, B for Y, and a third
 * (east of B, facing west) for the middle stop or Y.
 */
function jamWorld(kind: "plain" | "loopstop" | "bare", n: 2 | 3) {
  const layout = new Layout();
  const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  let from = connectorRef(west[1], 1);
  let m = -1;
  if (kind !== "plain") {
    const l = loopOn(layout, from, ["straight-216", "straight-216"], [kind === "loopstop" ? "depot-sawmill" : "straight-216"]);
    if (kind === "loopstop") m = l.side[1];
    from = connectorRef(l.s2, 0);
  }
  const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], from);
  appendPiece(layout, "buffer-turnback", false, connectorRef(east[2], 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot("forest", x, 0);
  const dm = m >= 0 ? economy.addDepot("sawmill", m, 0) : null;
  const dy = economy.addDepot("town", east[2], 1);
  const w = { layout, sim, economy, dx } as unknown as World;
  const stops = dm ? [dx, dm, dy] : [dx, dy];
  const es = [train(w, west[0], true), train(w, east[0], false), ...(n > 2 ? [train(w, east[1], true)] : [])];
  const red = editLine(economy, es[0], (s) => s.push(...stops.map((d) => ({ depotId: d.id, action: "auto" as const }))))!;
  for (const e of es.slice(1)) joinLine(economy, e, red.id);
  economy.routeOf(es[0])!.next = 0;
  economy.routeOf(es[1])!.next = stops.length - 1;
  if (n > 2) economy.routeOf(es[2])!.next = 1;
  return { w, es };
}

describe("crossing never jams for good (QA B1)", { timeout: 60_000 }, () => {
  for (const [kind, n] of [
    ["plain", 2],
    ["loopstop", 2],
    ["loopstop", 3],
    ["bare", 2],
    ["bare", 3],
  ] as const) {
    it(`${kind === "plain" ? "no passing place" : kind === "bare" ? "a bare loop" : "a loop with a stop"}, ${n} trains: arrivals keep rising over 10 minutes`, () => {
      const { w, es } = jamWorld(kind, n);
      const r = runner(w, es);
      r.run(5 * 60);
      const half = es.map((e) => r.arrivals.get(e)!);
      r.run(5 * 60);
      es.forEach((e, k) => {
        expect(half[k], `train ${k} by 5 min`).toBeGreaterThan(0);
        expect(r.arrivals.get(e)!, `train ${k}, 5 to 10 min`).toBeGreaterThan(half[k]);
      });
      // With a loop, two trains of a line never meet head on.
      if (kind !== "plain" && n === 2) expect(r.meetings).toEqual([]);
    });
  }

  it("no passing place: a hold ends when the train waited for turns back, so they don't bounce for ever", () => {
    // After the mutual wait one is let go; it meets the other at its stop and turns back, and the other, waiting for
    // it, goes too (they follow each other) instead of holding while it bounces off every few seconds.
    const { w, es } = jamWorld("plain", 2);
    const r = runner(w, es);
    r.run(10 * 60);
    expect(r.meetings.length).toBeLessThan(30);
  });

  it("a train stood still against a train of its line says it waits for that train, never 'something's in the way'", () => {
    const { w, es } = jamWorld("plain", 2);
    const r = runner(w, es);
    const texts = new Set<string>();
    for (let i = 0; i < 6 * 60 * SIM_HZ; i++) {
      r.step();
      if (i % 10 === 0) for (const e of es) texts.add(engineStatus(w.sim, w.economy, e, () => "Larkfield"));
    }
    expect(texts).not.toContain("Waiting: something's in the way");
    expect([...texts].some((t) => t.startsWith("Waiting for the Red line train"))).toBe(true);
  });
});
