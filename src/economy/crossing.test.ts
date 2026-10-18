import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { editLine, joinLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { Economy, type DepotRole } from "./economy";
import { LOOP_WAIT_S } from "./crossing";
import { chain, runner, train } from "./loop-fixtures";

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

// (Minutes of play, tick by tick: slow on a loaded machine.)
describe("trains that wait for each other (crossing)", { timeout: 60_000 }, () => {
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
      // (At M, or inside the loop short of its far switch: Phase 3c's blocks run on through M to the far switch.)
      expect([...r.waits.get(e)!].some((x) => x.startsWith(`waiting@${w.dy.id}:moving`))).toBe(true);
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

  // (Phase 3c changed these two: with no passing place the line is one block, end to end, and its trains take turns at
  // its ends; before, both waited saying the line needs a passing loop, and after 30 s the first was let go into a
  // head-on meeting.)
  it("with no passing place (X-M-Y-M): the trains take turns end to end, never meeting, never let go", () => {
    const w = line("middle");
    const stops = [w.dx.id, w.dm!.id, w.dy.id, w.dm!.id];
    const { a, b } = twoTrains(w, stops, 0, 2);
    const r = runner(w, [a, b]);
    r.run(5 * 60);
    const half = [a, b].map((e) => r.arrivals.get(e)!);
    r.run(5 * 60);
    expect(r.meetings).toEqual([]);
    expect(w.economy.crossing.released).toMatchObject({ quiet: 0, turned: 0, stalled: 0, mutual: 0 });
    [a, b].forEach((e, k) => {
      expect(half[k], `train ${k} by 5 min`).toBeGreaterThan(2);
      expect(r.arrivals.get(e)!, `train ${k}, 5 to 10 min`).toBeGreaterThan(half[k] + 2);
      expect(r.waits.get(e)!).toContain("turn");
      expect(r.waits.get(e)!).not.toContain("needs-loop");
    });
    // The player's line is never changed: each still runs the stops it was given, in order.
    for (const e of [a, b]) expect(w.economy.routeOf(e)!.stops.map((s) => s.depotId)).toEqual(stops);
  });

  it("a line of two stops with no passing place: the trains take turns, saying so, and never meet", () => {
    const w = line("plain");
    const { a, b } = twoTrains(w, [w.dx.id, w.dy.id], 0, 1);
    const r = runner(w, [a, b]);
    r.run(10 * 60);
    expect(r.meetings).toEqual([]);
    expect(w.economy.crossing.releases).toEqual([]);
    for (const e of [a, b]) {
      expect(r.arrivals.get(e)!).toBeGreaterThan(8);
      expect(r.waits.get(e)!).toEqual(new Set(["turn"]));
    }
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

  // (Phase 3c: the block runs on through M, a stop on the loop's other road, to the loop's far switch: before, the claim
  // ended at M and was let go there.)
  it("a claim is let go behind the train's tail, piece by piece; its block runs on through M to the loop's far switch", () => {
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
    // (It stands in the loop short of its far switch: the switch isn't claimed yet.)
    expect(claim!.map((c) => c.pieceId)).not.toContain(w.s2);
    expect(claim!.findIndex((c) => c.pieceId === w.m)).toBeLessThan(claim!.length - 1);
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
    // At M, a stop inside its block: it holds the rest of it (from M to the far switch), and nothing behind.
    expect(w.economy.routeOf(a)!.next).toBe(1);
    const atM = w.economy.crossing.claimOf(a)!.map((c) => c.pieceId);
    expect(atM).toContain(w.m);
    expect(atM).not.toContain(w.s2);
    for (const p of [w.x, w.west[0], w.west[1]]) expect(atM).not.toContain(p);
  });

  it("claims are rebuilt from where the trains are (nothing saved): a new economy on the same track holds as before", () => {
    const w = line("loop");
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    // Till one train waits for the other (Phase 3c: in the loop, by M, or at its end of the line; before, at M), the
    // other running with its block claimed.
    let waiting = -1;
    for (let i = 0; i < 300 * SIM_HZ && waiting === -1; i++) {
      r.step();
      for (const e of [a, b]) {
        const u = e === a ? b : a;
        if (w.economy.crossWait(e)?.wait.kind === "waiting" && !w.economy.routeOf(u)!.at && w.sim.findCar(u)!.train.speed > 1 && w.economy.crossing.claimOf(u)) waiting = e;
      }
    }
    expect(waiting).not.toBe(-1);
    const other = waiting === a ? b : a;
    const nexts = new Map([a, b].map((e) => [e, w.economy.routeOf(e)!.next]));
    const claim = w.economy.crossing.claimOf(other)!.map((c) => c.pieceId);
    // "Load": a fresh economy (as a loaded game has), its depots and line as saved, each train heading where it was.
    const economy = new Economy(w.layout, w.sim);
    const dx = economy.addDepot("forest", w.x, 0);
    const dm = economy.addDepot("sawmill", w.m, 0);
    const dy = economy.addDepot("town", w.y, 1);
    const stops = [dx, dm, dy].map((d) => ({ depotId: d.id, action: "auto" as const }));
    const red = editLine(economy, waiting, (s) => s.push(...stops))!;
    joinLine(economy, other, red.id);
    for (const e of [a, b]) economy.routeOf(e)!.next = nexts.get(e)!;
    // The train between stops claims its way from its tail on (the same as it had, less what its tail has cleared)...
    expect(economy.crossing.claimOf(other)!.map((c) => c.pieceId)).toEqual(claim.slice(claim.length - economy.crossing.claimOf(other)!.length));
    // ...and the waiting one still waits for it (once it's done at its stop again, a new economy working it afresh),
    // and they never meet.
    const w2 = { ...w, economy, dx, dm, dy };
    const r2 = runner(w2, [a, b]);
    let waited = false;
    for (let i = 0; i < 30 * SIM_HZ && !waited; i++) {
      r2.step();
      const wait = economy.crossWait(waiting)?.wait;
      waited = wait?.kind === "waiting" && wait.engine === other;
    }
    expect(waited).toBe(true);
    r2.run(60);
    expect(r2.meetings).toEqual([]);
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
    // Waiting at M for the train from Y (waiting only at stops, Phase 3a: with Phase 3b the train from Y waits on the
    // loop's main road instead of at Y: see loops.test.ts).
    const w = line("loop");
    w.economy.crossing.loops = false;
    const { a, b } = twoTrains(w, [w.dx.id, w.dm!.id, w.dy.id], 0, 2);
    const r = runner(w, [a, b]);
    const texts = new Set<string>();
    for (let i = 0; i < 300 * SIM_HZ; i++) {
      r.step();
      for (const e of [a, b]) if (w.economy.crossWait(e)) texts.add(engineStatus(w.sim, w.economy, e, names(w)));
    }
    expect(texts).toContain("Waiting for the Red line train from Elderwick");
    expect(texts).toContain("Waiting for the Red line train at Larkfield");
    // No passing place (Phase 3c): it waits its turn.
    const n = line("plain");
    const t = twoTrains(n, [n.dx.id, n.dy.id], 0, 1);
    const rn = runner(n, [t.a, t.b]);
    let said = "";
    for (let i = 0; i < 60 * SIM_HZ && !said; i++) {
      rn.step();
      for (const e of [t.a, t.b]) if (!said && n.economy.crossWait(e)?.wait.kind === "turn") said = engineStatus(n.sim, n.economy, e, names(n));
    }
    expect(said).toBe("Waiting its turn: the Red line has no passing loop");
    // Waiting only at stops (Phase 3a, for comparison), the two stand in each other's way: the line needs a passing loop.
    const o = line("plain");
    o.economy.crossing.loops = false;
    const to = twoTrains(o, [o.dx.id, o.dy.id], 0, 1);
    const ro = runner(o, [to.a, to.b]);
    said = "";
    for (let i = 0; i < 60 * SIM_HZ && !said; i++) {
      ro.step();
      if (o.economy.crossWait(to.a)?.wait.kind === "needs-loop") said = engineStatus(o.sim, o.economy, to.a, names(o));
    }
    expect(said).toBe("The Red line needs a passing loop");
  });
});

describe("crossing: claims kept true to the track", { timeout: 60_000 }, () => {
  /**
   * Run till A has left X with its claim to M; A's front still short of west[1]. `stopsOnly`: trains wait only at stops
   * (Phase 3a: B doesn't wait on the loop's main road, where a switch thrown in front of A would send it).
   */
  function leftX(stopsOnly = false) {
    const w = line("loop");
    w.economy.crossing.loops = !stopsOnly;
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
    const { w, a, r } = leftX(true);
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

  // (With blocks, Phase 3c, these two take turns instead: the mutual wait and its release are Phase 3b's, kept as the
  // safety net, so looked at here with blocks off.)
  it("a mutual wait's status clears once the first-ready train is let go, and the release is logged", () => {
    const w = line("plain");
    w.economy.crossing.blocks = false;
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
    expect(w.economy.crossing.released.mutual).toBe(1);
    expect(w.economy.crossing.releases).toEqual([expect.objectContaining({ engine: gone, why: "mutual", atLoop: false })]);
  });
});
