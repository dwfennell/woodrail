import { describe, expect, it } from "vitest";
import { Sim, SIM_DT, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { CARGO } from "./cargo";
import { Economy, type DepotRole } from "./economy";
import { LOOP_WAIT_S } from "./crossing";

/** Lay `types` end to end on from connector `from` (or from the origin); their ids. */
function chain(layout: Layout, types: readonly PieceTypeId[], from = -1, flips: readonly boolean[] = []): number[] {
  const ids: number[] = [];
  let ref = from;
  types.forEach((t, k) => {
    const id = ref === -1 ? layout.addPiece(t, { x: 0, z: 0, heading: 0 }) : appendPiece(layout, t, !!flips[k], ref);
    ids.push(id);
    ref = connectorRef(id, 1);
  });
  return ids;
}

/**
 * A single-track line from depot X to depot Y, turnbacks on both ends, with in the middle: (`loop`) a passing loop, the
 * main road straight through and the other road round by depot M; (`plain`) nothing; (`middle`) depot M on the line.
 *
 *   loop:   ⊐ X ══ S1 ════════ S2 ══ Y ⊏      middle:   ⊐ X ══ M ══ Y ⊏
 *                    ╲__ M __╱
 */
function line(kind: "loop" | "plain" | "middle", roles: { x: DepotRole; m: DepotRole; y: DepotRole } = { x: "forest", m: "sawmill", y: "town" }) {
  const loop = kind === "loop";
  const layout = new Layout();
  const [x, ...west] = chain(layout, ["depot-forest", "straight-216", "straight-216"]);
  const bx = appendPiece(layout, "buffer-turnback", false, connectorRef(x, 0));
  let m = -1;
  let s1 = -1;
  let s2 = -1;
  let mainEnd: number;
  if (loop) {
    s1 = appendPiece(layout, "switch", false, connectorRef(west[west.length - 1], 1));
    const main = chain(layout, ["straight-216", "straight-216"], connectorRef(s1, 1));
    // The other road: off the switch's curve, a curve back to run alongside, M, and a curve in toward the main road.
    const [c1] = chain(layout, ["curve-large"], connectorRef(s1, 2), [true]);
    m = appendPiece(layout, "depot-sawmill", false, connectorRef(c1, 1));
    const [c2] = chain(layout, ["curve-large"], connectorRef(m, 1), [true]);
    s2 = appendPiece(layout, "switch", true, connectorRef(c2, 1), 2);
    mainEnd = s2;
    if (layout.joinedConnector(connectorRef(s2, 1)) !== connectorRef(main[1], 1)) throw new Error("loop doesn't close");
  } else if (kind === "middle") mainEnd = m = appendPiece(layout, "depot-sawmill", false, connectorRef(west[west.length - 1], 1));
  else mainEnd = west[west.length - 1];
  const fromEnd = loop ? connectorRef(s2, 0) : connectorRef(mainEnd, 1);
  const east = chain(layout, ["straight-216", "straight-216", "depot-forest"], fromEnd);
  const y = east[2];
  appendPiece(layout, "buffer-turnback", false, connectorRef(y, 1));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const dx = economy.addDepot(roles.x, x, 0);
  const dm = m !== -1 ? economy.addDepot(roles.m, m, 0) : null;
  const dy = economy.addDepot(roles.y, y, 1);
  return { layout, sim, economy, bx, x, m, y, s1, s2, west, east, dx, dm, dy };
}

type World = ReturnType<typeof line>;

/** A train of `cars` on piece `pieceId`, facing along its path (or back, `reversed`), its lever on. */
function train(w: World, pieceId: number, reversed: boolean, cars: CarKind[] = ["engine", "timber"], s = 100): number {
  const placed = w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed, s });
  if (placed.kind !== "placed") throw new Error("no room");
  const engine = w.sim.getTrain(placed.trainId)!.cars[0].id;
  w.sim.setLever(engine, 1);
  return engine;
}

/** Run `seconds`; counts head-on meetings (a train turned back by another) and every cross wait seen, by engine. */
function runner(w: World, engines: readonly number[], topUp = true) {
  const meetings: { tick: number; engine: number }[] = [];
  const waits = new Map<number, Set<string>>(engines.map((e) => [e, new Set()]));
  const arrivals = new Map<number, number>(engines.map((e) => [e, 0]));
  const lastTurn = new Map<number, number>();
  let t = 0;
  const step = () => {
    if (topUp && w.dx) w.dx.piles[CARGO.log.index] = Math.max(w.dx.piles[CARGO.log.index], 6);
    const before = engines.map((e) => w.economy.routeOf(e)?.at ?? false);
    w.sim.tick();
    w.economy.tick();
    t++;
    engines.forEach((e, k) => {
      const tr = w.sim.findCar(e)?.train;
      const turn = tr?.lastTurn;
      if (turn?.cause === "train" && lastTurn.get(e) !== turn.tick) {
        lastTurn.set(e, turn.tick);
        meetings.push({ tick: t, engine: e });
      }
      const wait = w.economy.crossWait(e);
      if (wait) waits.get(e)!.add(wait.wait.kind === "needs-loop" ? "needs-loop" : `waiting@${wait.wait.depotId}:${wait.wait.moving ? "moving" : "standing"}`);
      if (!before[k] && w.economy.routeOf(e)?.at) arrivals.set(e, arrivals.get(e)! + 1);
    });
  };
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * SIM_HZ; i++) step();
  };
  return { meetings, waits, arrivals, step, run, now: () => t * SIM_DT };
}

/** Two trains on one line of `stops` (depot ids): A west of the middle facing X, B east of it facing Y. */
function twoTrains(w: World, stops: number[], aNext: number, bNext: number) {
  const a = train(w, w.west[0], true);
  const b = train(w, w.east[1], false);
  const red = editLine(w.economy, a, (s) => s.push(...stops.map((depotId) => ({ depotId, action: "auto" as const }))))!;
  joinLine(w.economy, b, red.id);
  w.economy.routeOf(a)!.next = aNext;
  w.economy.routeOf(b)!.next = bNext;
  return { a, b, red };
}

describe("trains that wait for each other (crossing)", () => {
  it("the passing loop closes (the layout the tests run on)", () => {
    const w = line("loop");
    expect(w.layout.joinedConnector(connectorRef(w.s1, 2))).not.toBe(-1);
    expect(w.layout.joinedConnector(connectorRef(w.s2, 2))).not.toBe(-1);
  });


  it("two trains of a line with a passing loop at its middle stop cross there, and never meet head on", () => {
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    r.run(25 * 60);
    expect(r.meetings).toEqual([]);
    // Both kept going round: many visits each.
    expect(r.arrivals.get(a)!).toBeGreaterThan(20);
    expect(r.arrivals.get(b)!).toBeGreaterThan(20);
    // They waited for each other: at M (on the loop) for the other coming from Y, and never "needs a passing loop".
    for (const e of [a, b]) {
      expect(r.waits.get(e)!).toContain(`waiting@${w.dy.id}:moving`);
      expect(r.waits.get(e)!).not.toContain("needs-loop");
    }
    // The same with crossing turned off: they meet head on.
    const off = line("loop");
    off.economy.crossing.enabled = false;
    const t = twoTrains(off, [off.dx.id, off.dm!.id, off.dy.id], 0, 2);
    const ro = runner(off, [t.a, t.b]);
    ro.run(5 * 60);
    expect(ro.meetings.length).toBeGreaterThan(0);
  });

  it("with no passing place: both wait saying the line needs a passing loop, then the first is let go as before", () => {
    const w = line("middle");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id, w.dm!.id], 0, 2);
    const r = runner(w, [a, b]);
    let loopAt = -1;
    for (let i = 0; i < 180 * SIM_HZ && r.meetings.length === 0; i++) {
      r.step();
      if (loopAt < 0 && w.economy.crossWait(a)?.wait.kind === "needs-loop" && w.economy.crossWait(b)?.wait.kind === "needs-loop") loopAt = r.now();
    }
    expect(loopAt).toBeGreaterThan(0);
    // No meeting while they wait; the first is let go after LOOP_WAIT_S and they meet and turn back, as before.
    expect(r.meetings.length).toBeGreaterThan(0);
    expect(r.meetings[0].tick * SIM_DT).toBeGreaterThanOrEqual(loopAt + LOOP_WAIT_S - 1);
    // The player's line is never changed: each still runs the stops it was given, in order.
    for (const e of [a, b]) expect(w.economy.routeOf(e)!.stops.map((s) => s.depotId)).toEqual([w.dx.id, w.dm!.id, w.dy.id, w.dm!.id]);
    // Nothing freezes: the trains keep moving.
    r.run(60);
    expect([a, b].some((e) => w.sim.findCar(e)!.train.speed > 1 || r.meetings.length > 1)).toBe(true);
  });

  it("a line of two stops with no passing place: both wait, saying so; then the first is let go as before", () => {
    const w = line("plain");
    const { a, b } = twoTrains(w, [w.dx.id, w.dy.id], 0, 1);
    const r = runner(w, [a, b]);
    let loopAt = -1;
    let bothLoop = false;
    for (let i = 0; i < 120 * SIM_HZ && r.meetings.length === 0; i++) {
      r.step();
      const wa = w.economy.crossWait(a)?.wait.kind;
      const wb = w.economy.crossWait(b)?.wait.kind;
      if (loopAt < 0 && (wa === "needs-loop" || wb === "needs-loop")) loopAt = r.now();
      if (wa === "needs-loop" && wb === "needs-loop") bothLoop = true;
    }
    expect(loopAt).toBeGreaterThan(0);
    expect(bothLoop).toBe(true);
    // No meeting while they wait: only once the first is let go (as before: they meet and turn back).
    expect(r.meetings.length).toBeGreaterThan(0);
    expect(r.meetings[0].tick * SIM_DT).toBeGreaterThanOrEqual(loopAt + LOOP_WAIT_S - 1);
  });

  it("trains following each other the same way never wait for each other", () => {
    // An oval, both trains going round the same way: forest, sawmill.
    const layout = new Layout();
    const half: PieceTypeId[] = ["depot-forest", "straight-216", "straight-216", ...Array<PieceTypeId>(4).fill("curve-large")];
    const ids = chain(layout, [...half, "depot-sawmill", "straight-216", "straight-216", ...Array<PieceTypeId>(4).fill("curve-large")]);
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const forest = economy.addDepot("forest", ids[0], 0);
    const mill = economy.addDepot("sawmill", ids[half.length], 0);
    const w = { layout, sim, economy, dx: forest } as unknown as World;
    const a = train(w, ids[3], false);
    const b = train(w, ids[half.length + 3], false);
    const red = editLine(economy, a, (s) => s.push({ depotId: forest.id, action: "auto" }, { depotId: mill.id, action: "auto" }))!;
    joinLine(economy, b, red.id);
    const r = runner(w, [a, b]);
    r.run(10 * 60);
    expect(r.meetings).toEqual([]);
    expect([...r.waits.get(a)!, ...r.waits.get(b)!]).toEqual([]);
    expect(r.arrivals.get(a)!).toBeGreaterThan(10);
    expect(r.arrivals.get(b)!).toBeGreaterThan(10);
  });

  it("a claim is let go behind the train's tail, piece by piece, and ends when it comes to its stop", () => {
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    // Till A leaves X with a claim of its way to M.
    let claim: readonly { pieceId: number }[] | null = null;
    for (let i = 0; i < 120 * SIM_HZ && !claim; i++) {
      r.step();
      if (w.economy.routeOf(a)!.next === 1 && !w.economy.routeOf(a)!.at) claim = w.economy.crossing.claimOf(a);
    }
    expect(claim!.map((c) => c.pieceId)).toEqual(expect.arrayContaining([w.west[0], w.west[1], w.s1, w.m]));
    expect(claim!.at(-1)!.pieceId).toBe(w.m);
    // As it runs on, the pieces behind it are let go: the claim starts where its tail is.
    let seen = 0;
    while (!w.economy.routeOf(a)!.at) {
      r.step();
      const now = w.economy.crossing.claimOf(a);
      if (!now) break;
      const under = new Set(w.sim.findCar(a)!.train.bogies.map((x) => x.pieceId));
      expect(under.has(now[0].pieceId)).toBe(true);
      // (Pieces it has left behind are no longer claimed.)
      for (const p of [w.x, w.west[0], w.west[1]]) if (!under.has(p) && claim!.findIndex((c) => c.pieceId === p) < claim!.findIndex((c) => c.pieceId === now[0].pieceId)) expect(now.some((c) => c.pieceId === p)).toBe(false);
      seen = Math.max(seen, claim!.length - now.length);
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    // At M: no claim left.
    expect(w.economy.routeOf(a)!.next).toBe(1);
    expect(w.economy.crossing.claimOf(a)).toBe(null);
  });

  it("claims are rebuilt from where the trains are (nothing saved): a new economy on the same track holds as before", () => {
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    // Till one train waits at M for the other coming from Y.
    let waiting = -1;
    for (let i = 0; i < 300 * SIM_HZ && waiting === -1; i++) {
      r.step();
      for (const e of [a, b]) if (w.economy.crossWait(e)?.wait.kind === "waiting" && w.economy.routeOf(e)!.next === 1) waiting = e;
    }
    expect(waiting).not.toBe(-1);
    const other = waiting === a ? b : a;
    const claim = w.economy.crossing.claimOf(other)!.map((c) => c.pieceId);
    // "Load": a fresh economy (as a loaded game has), its depots and line as saved, each train heading where it was.
    const economy = new Economy(w.layout, w.sim);
    const dx = economy.addDepot("forest", w.x, 0);
    const dm = economy.addDepot("sawmill", w.m, 0);
    const dy = economy.addDepot("town", w.y, 1);
    const stops = [dx, dm, dy].map((d) => ({ depotId: d.id, action: "auto" as const }));
    const red = editLine(economy, waiting, (s) => s.push(...stops))!;
    joinLine(economy, other, red.id);
    economy.routeOf(waiting)!.next = 1;
    economy.routeOf(other)!.next = 0;
    // The train between stops claims its way from its tail on (the same as it had, less what its tail has cleared)...
    expect(economy.crossing.claimOf(other)!.map((c) => c.pieceId)).toEqual(claim.slice(claim.length - economy.crossing.claimOf(other)!.length));
    // ...and the one at M still waits for it.
    const w2 = { ...w, economy, dx, dm, dy };
    const r2 = runner(w2, [a, b]);
    r2.run(1);
    expect(economy.crossWait(waiting)?.wait).toMatchObject({ kind: "waiting", engine: other });
  });

  it("other lines and unrouted trains are left alone (they meet as before)", () => {
    for (const how of ["other line", "unrouted"] as const) {
      const w = line("plain");
      const a = train(w, w.west[0], true);
      const b = train(w, w.east[1], false);
      editLine(w.economy, a, (s) => s.push({ depotId: w.dx.id, action: "auto" }, { depotId: w.dy.id, action: "auto" }));
      if (how === "other line") {
        editLine(w.economy, b, (s) => s.push({ depotId: w.dy.id, action: "auto" }, { depotId: w.dx.id, action: "auto" }));
        expect(w.economy.lineIdOf.get(b)).not.toBe(w.economy.lineIdOf.get(a));
      }
      const r = runner(w, [a, b]);
      r.run(120);
      expect([...r.waits.get(a)!, ...r.waits.get(b)!], how).toEqual([]);
      expect(r.meetings.length, how).toBeGreaterThan(0);
    }
  });

  it("the engine card says what it waits for", () => {
    const names = (w: World) => (id: number) => (id === w.dx.id ? "Larkfield" : id === w.dy.id ? "Elderwick" : "the sawmill");
    // Waiting at M for the train from Y.
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    const texts = new Set<string>();
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      r.step();
      for (const e of [a, b]) if (w.economy.crossWait(e)) texts.add(engineStatus(w.sim, w.economy, e, names(w)));
    }
    expect(texts).toContain("Waiting for the Red line train from Elderwick");
    expect(texts).toContain("Waiting for the Red line train at Larkfield");
    // No passing place.
    const n = line("plain");
    const t = twoTrains(n, [n.dx.id, n.dy.id], 0, 1);
    const rn = runner(n, [t.a, t.b]);
    let said = "";
    for (let i = 0; i < 60 * SIM_HZ && !said; i++) {
      rn.step();
      if (n.economy.crossWait(t.a)?.wait.kind === "needs-loop") said = engineStatus(n.sim, n.economy, t.a, names(n));
    }
    expect(said).toBe("The Red line needs a passing loop");
  });
});

describe("crossing: claims kept true to the track", () => {
  /** Run till A has left X with its claim to M; A's front still short of west[1]. */
  function leftX() {
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    for (let i = 0; i < 120 * SIM_HZ; i++) {
      r.step();
      const ro = w.economy.routeOf(a)!;
      if (ro.next === 1 && !ro.at && w.economy.crossing.claimOf(a)) break;
    }
    return { w, a, b, r };
  }

  it("a straight in a claim spliced into a switch and a straight (new piece ids): the claim runs over the new pieces", () => {
    const { w, a } = leftX();
    const old = w.west[1];
    expect(w.sim.findCar(a)!.train.bogies.some((x) => x.pieceId === old)).toBe(false);
    expect(w.economy.crossing.claimOf(a)!.map((c) => c.pieceId)).toContain(old);
    // As junction drawing does: the straight taken up, a switch and a short straight laid in its place.
    const piece = w.layout.getPiece(old)!;
    w.layout.removePiece(old);
    const sw = w.layout.addPiece("switch", piece.pose, piece.y, false);
    const rest = appendPiece(w.layout, "straight-72", false, connectorRef(sw, 1));
    expect(w.layout.joinedConnector(connectorRef(rest, 1))).not.toBe(-1);
    w.sim.trackChanged();
    w.economy.prune();
    const claim = w.economy.crossing.claimOf(a)!.map((c) => c.pieceId);
    expect(claim).not.toContain(old);
    expect(claim).toEqual(expect.arrayContaining([sw, rest, w.s1, w.m]));
  });

  it("a train off its claimed way (a switch thrown under it) claims its way afresh from its tail", () => {
    const { w, a, r } = leftX();
    // The player throws the loop's first switch to the main road just ahead of it, and steering can't throw it back.
    w.layout.setSwitchState(w.s1, 0);
    const set = w.layout.setSwitchState.bind(w.layout);
    w.layout.setSwitchState = (id, state) => (id === w.s1 ? undefined : set(id, state));
    const before = w.economy.crossing.claimOf(a)!.map((c) => c.pieceId);
    expect(before).toContain(w.m);
    const main = Math.floor(w.layout.joinedConnector(connectorRef(w.s1, 1)) / 8);
    // Till its whole train is on the main road: none of its axles on any piece it claimed.
    for (let i = 0; i < 60 * SIM_HZ; i++) {
      r.step();
      const t = w.sim.findCar(a)!.train;
      if (t.bogies.every((x) => x.pieceId === main)) break;
    }
    const t = w.sim.findCar(a)!.train;
    expect(t.bogies.every((x) => x.pieceId === main)).toBe(true);
    const now = w.economy.crossing.claimOf(a)!;
    // Its claim now starts under it, on the main road, not where it was going to run.
    expect(now[0].pieceId).toBe(main);
    expect(now.map((c) => c.pieceId)).not.toContain(Math.floor(w.layout.joinedConnector(connectorRef(w.s1, 2)) / 8));
  });

  it("a mutual wait's status clears once the first-ready train is let go", () => {
    const w = line("plain");
    const { a, b } = twoTrains(w, [w.dx.id, w.dy.id], 0, 1);
    const r = runner(w, [a, b]);
    let loopAt = -1;
    for (let i = 0; i < 60 * SIM_HZ && loopAt < 0; i++) {
      r.step();
      if (w.economy.crossWait(a)?.wait.kind === "needs-loop" && w.economy.crossWait(b)?.wait.kind === "needs-loop") loopAt = r.now();
    }
    expect(loopAt).toBeGreaterThan(0);
    // Till one is let go (it starts moving): from then on, neither says the line needs a passing loop.
    let gone = -1;
    for (let i = 0; i < (LOOP_WAIT_S + 5) * SIM_HZ && gone < 0; i++) {
      r.step();
      for (const e of [a, b]) if (w.sim.findCar(e)!.train.speed > 1) gone = e;
    }
    expect(gone).not.toBe(-1);
    for (let i = 0; i < 2 * SIM_HZ; i++) {
      r.step();
      for (const e of [a, b]) expect(w.economy.crossWait(e)?.wait.kind).not.toBe("needs-loop");
    }
    expect(w.economy.crossWait(gone)).toBe(null);
  });
});
