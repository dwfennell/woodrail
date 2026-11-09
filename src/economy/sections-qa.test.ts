import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ, type CarKind } from "../sim";
import { appendPiece, connectorRef, type PieceTypeId } from "../track";
import { editLine, joinLine, stopLine } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { putAway, type PutAway } from "../game/put-away";
import { Economy } from "./economy";
import { topologyOf, trainLength } from "./sections";
import { STUCK_S } from "./stalls";
import { next, waysFrom } from "../routing/graph";
import { ENV, type L, type Q, type T, cars, checked, clearTrains, invariantsHold, line0, one, pin, runsOrSays, scen, show, two } from "./sections-qa-testing";

describe("sections: QA's cases (P2 review)", { timeout: 300_000 }, () => {
  it("B1: a branching line, 1 loop, 3 trains, the third held on the branch: no head-ons, the others keep running", () => {
    for (const pre of ENV.PRE ? [["straight-216"] as PieceTypeId[]] : [null, ["straight-216"] as PieceTypeId[]])
      for (const at of ENV.AT ? [Number(ENV.AT)] : [0, 6]) {
        const q = line0({ loops: 1, ends: 1, pre, branch: ["curve-large", "straight-216", "straight-216", "depot-sawmill"], branchFlips: [true], eastT: pre ? ["straight-216"] : ["straight-216", "straight-216"] });
        const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 2, s: 200 }, { p: q.br!.bt[2], next: 0, s: 200, at: at || undefined }], [q.a, q.b, q.a, q.br!.z], 240);
        expect(r.meet, `pre ${!!pre} at ${at}`).toBe(0);
        // (The held one stands at the branch's end, a stop of the line: the others no longer turn back short of it
        // (routing §16 Q3) but wait for it, stuck, saying so.)
        expect(runsOrSays(r, 240, 4), `pre ${!!pre} at ${at}`).toEqual([]);
        expect(r.released).toBe(0);
        expect([...r.cards]).toContain("Waiting: lay 1 more passing loop for 3 trains, or remove a train");
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
      // (Its other road is no passing place: before, one runner ran, turning back short of the held one. Now none turns
      // back (routing §16 Q3): each that doesn't run stands saying what to do.)
      expect(runsOrSays(r, 300, 6), `${extra} extra`).toEqual([]);
      expect([...r.cards].some((c) => c.startsWith("Waiting: lay "))).toBe(true);
    }
  });

  it("N1: two trains face to face mid-line, no loop: one held, no head-on; neither turns back, each says what to do", () => {
    const q = line0({ loops: 0, ends: 4 });
    const r = scen(q, [{ p: q.west[2], next: 1 }, { p: q.east[0], next: 0, rev: true }], [q.a, q.b], 240);
    expect(r.meet).toBe(0);
    // (One held for room, the other stands short of it: stuck, too many trains. Before, the other turned back.)
    expect(runsOrSays(r, 240, 6)).toEqual([]);
    expect([...r.cards]).toContain("Stuck: this line has a train too many. Add a passing loop, or remove a train");
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
    // (Four trains, two loops: one held, on loop 0's side road. Before, the other three ran, turning back short of it;
    // now (routing §16 Q3) those it's in the way of stand, saying so; it says one more loop.)
    expect(runsOrSays(r, 300, 4)).toEqual([]);
    says(r, 1, 4);
  });
  /**
   * Trains that keep running in a park case now nothing turns back short of a held train (routing §16 Q3), where fewer
   * than before: those the held train is in the way of stand, stuck, their cards saying so (`runsOrSays`).
   */
  const RUNNERS_NOW: Record<string, number> = {
    "L1T3_heldSide": 0,
    "L1T3_heldMain": 0,
    "L1T3_spareSide (B3)": 0,
    "L2T5_heldBothL0": 0,
    "L2T5_spareBothL0 (B3)": 0,
    "T4_side0_at0": 0,
    "T4_side1_at30": 0,
    "T4_side0_at45": 0,
    "B4_l1side_at30": 0,
    "B4_l0side_at30": 0,
  };
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
      // (Fewer may run than before (`runners`, with turn-backs short of a held train): each that doesn't says why.)
      expect(r.arrivals.filter((a) => a > 5).length).toBeGreaterThanOrEqual(RUNNERS_NOW[nm] ?? runners);
      expect(runsOrSays(r, 600)).toEqual([]);
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
      // (Fewer may run than before (`runners`, with turn-backs short of a held train): each that doesn't says why.)
      expect(r.arrivals.filter((a) => a > 5).length).toBeGreaterThanOrEqual(RUNNERS_NOW[nm] ?? runners);
      expect(runsOrSays(r, 600)).toEqual([]);
      says(r, lay, trains);
    });
  // B5's state, set up directly: a runner between the loops with its nose on loop 1's switch, set for the main road, a
  // spare on that road (the side road free), a line-mate at the far end waiting on it, the third held at the near end.
  // On 4ffce95 the runner waited on no one named (−1) for good, and the line froze.
  it("B5: a runner on a switch set for a road a spare stands on: it says what it waits on; none turns back, each says what to do", () => {
    const { q, l1 } = two();
    q.L.setSwitchState(l1.s1, 0);
    const r = show(
      "B5 state",
      scen(q, [{ p: q.west[0], next: 0, s: 200 }, { p: q.east[0], next: 0, s: 200, rev: !!ENV.REV2 }, { p: l1.s1, next: 1, s: Number(ENV.S0 ?? 52), rev: !!ENV.REV }, { p: l1.main[l1.main.length - 1], spare: true, s: 100 }], [q.a, q.b], 240, cars),
    );
    if (ENV.SHOW) console.log(`B5STATE ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${r.meet}`);
    expect(r.meet).toBe(0);
    // (Before, one turned back and the line ran on; now (routing §16 Q3) they stand, saying so.)
    expect(runsOrSays(r, 240, 3)).toEqual([]);
  });
  // QA's B4 itself: a runner let into a loop's road, still in the section on its way there, and a train put down on that
  // road ahead of it. The newcomer isn't let in (the runner has the road); the runner stops short. Before, one of them
  // turned back; now neither does (routing §16 Q3): no bump, and each that doesn't deliver says what to do.
  for (const road of ["l0.side", "l0.main", "l1.side", "l1.main"] as const)
    it(`B4: a train put down on ${road} ahead of a runner on its way into that road: no bump; neither turns back, each says what to do`, () => {
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
      expect(runsOrSays(r, 360, 4)).toEqual([]);
    });
  // QA: a running train taken off its line (lever left on) runs on, no line's: the line's trains treat it as a train
  // in the way where it is, and wait for it while it moves.
  it("a running train taken off the line runs on among the line's trains: fewer bumps than 614de33, the line delivers more", () => {
    const { q, R3 } = two();
    // (It stops short of the line's trains, and they of it: none turns back now (routing §16 Q3), so they stand,
    // stuck, till the player puts one away, as the card says: `fix`.)
    const r = show("offline", scen(q, [{ ...R3[0], offAt: 30 }, R3[1], R3[2]], [q.a, q.b], 300, cars, [], true));
    if (ENV.SHOW) console.log(`OFFLINE meets ${r.meets.map((t) => t.toFixed(0)).join(",")}`);
    // (614de33: 3 + 2 arrivals, 66 bumps. Before this branch 6+: the stray turned back short of the line's trains; now it
    // waits, stuck, till the player puts it away.)
    expect(r.arrivals[1] + r.arrivals[2]).toBeGreaterThanOrEqual(5);
    expect(r.meet).toBeLessThanOrEqual(5);
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
      ],
        true,
      ),
    );
    const arr = r.E.map((e) => r.arrAt.filter((a) => a.e === e && a.t >= 90).length);
    const meets = r.meets.filter((t) => t >= 90).length;
    if (ENV.SHOW) console.log(`STOPLINE off e${off}: 90-300 s arrivals ${arr.join("/")} head-ons ${meets}`);
    if (ENV.SHOW) for (const e of r.E) console.log(`STOPLINE e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
    expect(off).toBeGreaterThan(0);
    // (QA: its card said "Turning back early: the end of the line is taken" about 25 s a run, and at a buffer "Turning
    // back at the end of the line". On no line it has no line's end: plain cards, "the track ends here".)
    // (Till the player's first Put away (`fix`): with one train left the line isn't managed, and its end is that of a
    // lone train's line again.)
    const fixed = r.fixes[0]?.t ?? Infinity;
    expect(new Set(r.cardLog.filter((x) => x.e === off && x.t > 91 && x.t < fixed).map((x) => x.c).filter((c) => /early|end of the line|[Ll]ay \d/.test(c)))).toEqual(new Set());
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
  // unring once picked a train to turn back, and a train with one standing right behind it in its slot couldn't. Nothing
  // turns a train back now (routing §16 Q3), but the case still mustn't run trains into each other. A spare is put right
  // behind a train waiting in a loop road.
  it("a spare put right behind a train waiting in a loop road: no head-ons after", () => {
    const { q, l0, l1, R3 } = two();
    const roads = [l0.main, l0.side, l1.main, l1.side];
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
      if (ENV.SHOW) console.log(`UNRING road ${road.join(",")}: put ${r.whenAt.toFixed(0)} -> ${r.arrivals.join("/")} stalls ${r.stalls}`);
      expect(r.meets.filter((t) => t > r.whenAt + 3).length).toBe(0);
    }
    expect(put).toBeGreaterThan(0);
  });
  // The same, built directly: a short train in loop 1's main road waiting on a spare ahead of it (stuck: the spare
  // won't move), a free slot behind it, but another spare right behind it in the road. It mustn't be picked to turn.
  // (Game Mode's harness, seeds 1 and 5: a people train on no line, lever on, between the line's two goods trains,
  // each waiting on it. It stood short of one, turned back, stood short of the other, on and on; standing with its lever
  // on, `unring` took it for one that will go, and no one gave way: they stood till picked up. Before: 88 s.)
  it("a train on no line between two of the line's trains waiting on it: none turns back; stuck, the player puts it away, they don't all stand", () => {
    const rows: string[] = [];
    for (const k of [0, 2, 3, 4])
      for (const off of [5, 40]) {
        const { q, l } = one();
        const ps = [q.west[0], l.main[0], l.main[1], l.side[0], l.main[1], q.east[0]];
        const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: ps[k], ps: [ps[k], ...ps], ss: [20, 100, 180], next: 1, offAt: off }], [q.a, q.b], 240, cars, [], true);
        if (ENV.SHOW) console.log(`LINELESS k${k} off${off}: line still ${r.lineStill.toFixed(0)} s, arrivals ${r.arrivals.join("/")}, meets ${r.meet}`);
        if (r.lineStill > 30) rows.push(`k${k} off${off}: the line's trains all stood ${r.lineStill.toFixed(0)} s`);
        if (r.arrivals[0] + r.arrivals[1] < 4) rows.push(`k${k} off${off}: ${r.arrivals.join("/")} arrivals`);
        expect(r.meet).toBeLessThanOrEqual(4);
      }
    expect(rows).toEqual([]);
  });
  it("a train boxed in by spares in its road waits on the one ahead, named, and stands", () => {
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
    if (ENV.SHOW) console.log(`BOXED ${r.arrivals.join("/")} stalls ${r.stalls} wait ${JSON.stringify(q.economy.sections.waitOf(r.E[1]))}`);
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
      expect(r.stalls).toBeLessThanOrEqual(3);
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
      if (ENV.SHOW) console.log(`B1 ${other}: stalls ${r.stalls} cards 400-600 s ${late.join("/")}`);
      expect(r.stalls).toBeLessThanOrEqual(3);
      for (const n of late) expect(n).toBe(1);
    });
  // QA's N1 on a2d072c: waiting on another line's train, the card looked that line up by the id waited on, its
  // first car: a wagon once it had reversed, on no line, so the card said "a train not on the line" (56 of 92).
  it("N1: waiting on another line's train, the card names its line, whichever way round it runs", () => {
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
    // (Named by its line, as the player sees it: "the train on the Blue line".)
    expect([...said.keys()].filter((c) => c.includes("no route"))).toEqual([]);
    expect([...said.keys()].some((c) => /^Waiting: the train on the [A-Za-z]+ line is in the way$/.test(c)), [...said.keys()].join(" | ")).toBe(true);
    void r;
  });
  // Game Mode's deadlock on main: a loop whose switches are pinned wasn't counted as a passing place at all, so the
  // line had room for one; a second train put down in front of the working one was held where it stood, and the
  // working one waited on it for good (with a third, a ring nobody could turn out of).
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
        if (ENV.SHOW) console.log(`PIN ${nm} at ${seedAt}: ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${r.meet} stalls ${r.stalls} cards ${[...r.cards].filter((c) => /pin|lay|Move/.test(c)).join(" | ")}`);
        // (The third is put down where there's room: with the line standing, none may be left for it.)
        expect(r.E.length).toBeGreaterThanOrEqual(Math.min(trains, 2));
        expect(r.meet).toBe(0);
        expect(r.longestRing < STUCK_S + 3 || runsOrSays(r, seedAt + 300).length === 0).toBe(true);
        const says = [...r.cards].some((c) => /unpin|[Ll]ay \d+ more/.test(c));
        expect(r.allStill < 60 || says, `all still ${r.allStill.toFixed(0)} s and no card says why`).toBe(true);
        if (roads[0] === roads[1]) {
          // (Pinned to one road both ways: no passing place. The card says what to do: unpin, not lay a loop.)
          expect([...r.cards].some((c) => c.endsWith("unpin the passing loop's switches so trains can pass"))).toBe(true);
          expect([...r.cards].filter((c) => /[Ll]ay \d+ more/.test(c))).toEqual([]);
        }
        // (Passing one way each way round: as good as an unpinned loop, two trains both running.)
        if (roads[0] !== roads[1] && trains === 2) expect(r.arrivals.filter((a) => a > 5).length).toBe(2);
        // (Two trains, the loop no passing place: one held. Before, the other ran, turning back short of it; now (routing
        // §16 Q3) it stands where the held one is in its way, and each card says to unpin.)
        if (roads[0] === roads[1] && trains === 2) expect(runsOrSays(r, seedAt + 300)).toEqual([]);
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
          // (Before, one ran, turning back short of the held one; now (routing §16 Q3) both stand, saying to unpin.)
          expect(runsOrSays(r, 300)).toEqual([]);
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
  // The third-train trap (QA's N1 setup): 3 trains on a 1-loop line deliver nothing, wherever one's held (on a loop's
  // road it takes the loop; elsewhere it's at an end, and both ends are stops). The newest is held, the player's told
  // once, and its card (and its line's) offers "Put away": back in the box, the other two run.
  describe("the third-train trap", () => {
    type Ev = { at: number; fn: (E: readonly number[]) => void };
    const n1 = (events: (q: Q) => Ev[] = () => [], secs = 300) => {
      const q = line0({ loops: 1, ends: 2 });
      const told: string[] = [];
      q.economy.sections.onFull = (lineId, room, trains, more) => told.push(`${lineId}:${room}/${trains}/${more}`);
      const r = scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }, { p: q.west[1], next: 1, s: 100, at: 30 }], [q.a, q.b], secs, cars, events(q));
      return { q, r, told };
    };
    // (A plain 2-train run on the same line: the rate to match once the third is put away.)
    const two = () => {
      const q = line0({ loops: 1, ends: 2 });
      return scen(q, [{ p: q.west[0], next: 1, s: 200 }, { p: q.east[0], next: 0, s: 200 }], [q.a, q.b], 300, cars);
    };
    const goodsIn = (r: ReturnType<typeof scen>, from: number, to: number) => r.goodsAt.filter((t) => t >= from && t < to).length;
    const held = (q: Q, E: readonly number[]) => E.map((e) => (q.sim.findCar(e) ? (q.economy.sections.heldForRoom(e) ? "held" : "room") : "gone")).join("/");

    it("the newest is held, and stays held: no hand-over moves its hold onto another (laden, where it can't be put away)", () => {
      const seen: string[] = [];
      const { q, r } = n1((q) => [35, 60, 120, 200, 299].map((at) => ({ at, fn: (E: readonly number[]) => void seen.push(held(q, E)) })));
      if (ENV.SHOW) console.log(`TRAP held ${seen.join(" ; ")} goods ${r.goodsAt.length} (after 60 s ${goodsIn(r, 60, 300)})`);
      // (Nor do the two with room say they're on their way to a stop the held one stands at: they can't reach it.)
      expect(r.cardLog.filter((x) => x.t > 60 && x.e !== r.E[2] && /^On its way to forest/.test(x.c)).map((x) => x.c)).toEqual([]);
      expect(seen).toEqual(Array(5).fill("room/room/held"));
      expect(r.meet).toBe(0);
      // (Nothing delivers: the trap. The held one's card says lay a loop; the one waiting on it, that the line is full.)
      expect(goodsIn(r, 60, 300)).toBe(0);
      const last = (e: number) => r.cardLog.filter((x) => x.e === e).at(-1)!.c;
      expect(last(r.E[2])).toBe("Waiting: lay 1 more passing loop for 3 trains, or remove a train");
      expect([...r.cards]).toContain("Waiting: the line is full. Lay 1 more passing loop");
      // ("Put away" on any of their cards puts the held one away.)
      for (const e of r.E) expect(q.economy.sections.putAwayFor(e)).toBe(r.E[2]);
    });

    it("the player's told once a line, with the line's numbers (not again when it's put away and back)", () => {
      let undo: PutAway | null = null;
      const { told } = n1(
        (q) => [
          { at: 120, fn: (E) => void (undo = putAway(q.sim, q.economy, E[2])) },
          { at: 120 + 1 / SIM_HZ, fn: () => void expect(undo!.restore()).toBe(true) },
        ],
        160,
      );
      expect(told).toEqual(["1:2/3/1"]);
    });

    // (QA's notes on 688c4b6: after a reload, the oldest train was held instead (the room worked out afresh, by where they
    // stand), and the player was told again. A save keeps each engine's place on its line, and that it was told.)
    it("after a reload, the same train stays held, and the player isn't told again", () => {
      const { q, r, told } = n1(() => [], 120);
      expect(told).toHaveLength(1);
      expect(held(q, r.E)).toBe("room/room/held");
      // Reloaded, as `deserializeWorld` puts it back: a fresh sim and economy on the same track, the trains where they
      // stood (in the order saved), their lines and stops, and what the save keeps of their places.
      const reload = (keep: boolean, heldIs = 2) => {
        const sim = new Sim(q.L);
        const economy = new Economy(q.L, sim);
        checked(economy);
        const depots = [...q.economy.allDepots()].map((d) => economy.addDepot(d.role, d.pieceId, d.townId));
        const told2: string[] = [];
        economy.sections.onFull = (lineId, room, trains, more) => told2.push(`${lineId}:${room}/${trains}/${more}`);
        const E2: number[] = [];
        let lineId = -1;
        for (const e of r.E) {
          const t = q.sim.findCar(e)!.train;
          const placed = sim.addTrain(t.cars.map((c) => c.kind), { ...t.bogies[0] });
          if (placed.kind !== "placed") throw new Error("not put back");
          const t2 = sim.getTrain(placed.trainId)!;
          t2.cars.forEach((c, i) => {
            if (t.cars[i].facing !== c.facing) sim.flipCar(c.id);
            if (c.kind === "engine") sim.setLever(c.id, t.cars[i].lever);
          });
          const e2 = t2.cars.find((c) => c.kind === "engine")!.id;
          E2.push(e2);
          const route = q.economy.routeOf(e)!;
          if (lineId === -1) lineId = editLine(economy, e2, (st) => st.push(...route.stops.map((x) => ({ depotId: depots[x.depotId].id, action: "auto" as const }))))!.id;
          else joinLine(economy, e2, lineId);
          economy.routeOf(e2)!.next = route.next;
          // (`heldIs` other than the one held: the save says so, and it's the save that decides, not where they stand.)
          const k = E2.length - 1;
          const place = heldIs === 2 ? q.economy.sections.savedPlace(e) : { joined: k === heldIs ? 99 : k + 1, held: k === heldIs };
          if (keep) economy.sections.restorePlace(e2, lineId, place);
        }
        if (keep && q.economy.sections.toldFullOn(q.economy.lineIdOf.get(r.E[0])!)) economy.sections.markToldFull(lineId);
        economy.sections.restored();
        const seen: string[] = [];
        for (let i = 0; i < 60 * SIM_HZ; i++) {
          sim.tick();
          economy.tick();
          if (i % (10 * SIM_HZ) === 0) seen.push(held({ sim, economy } as unknown as Q, E2));
        }
        return { seen, told2 };
      };
      const kept = reload(true);
      expect(kept.seen).toEqual(Array(6).fill("room/room/held"));
      expect(kept.told2).toEqual([]);
      // (The first one saved as the one held, say: the save's admission is kept, and steady. Before, it stayed held; now
      // the line stands stuck at the save (nothing turns back, routing §16 Q3), the third on the loop's road, so the room
      // left is one train fewer and the room rule (too many for the room left) holds that one instead, from the start.)
      const firstHeld = reload(true, 0).seen;
      if (ENV.SHOW) console.log(`RELOAD first held ${firstHeld.join(" ; ")}`);
      expect(new Set(firstHeld).size).toBe(1);
      // (Without what the save keeps, as before: another train held, and the player told again.)
      const lost = reload(false);
      if (ENV.SHOW) console.log(`RELOAD kept ${kept.seen.join(" ; ")} lost ${lost.seen.join(" ; ")} told ${lost.told2.join(",")}`);
      expect(lost.seen[0] !== "room/room/held" || lost.told2.length > 0).toBe(true);
    });

    it("Put away: the held train goes back in the box, the line counts 2, and the other two deliver as two trains do", () => {
      const base = two();
      let gone = false;
      const { q, r } = n1((q) => [
        {
          at: 90,
          fn: (E) => {
            const e = q.economy.sections.putAwayFor(E[0]);
            expect(e).toBe(E[2]);
            gone = putAway(q.sim, q.economy, e) !== null;
          },
        },
      ]);
      expect(gone).toBe(true);
      expect(q.sim.findCar(r.E[2])).toBeUndefined();
      expect(q.economy.lineIdOf.has(r.E[2])).toBe(false);
      expect(q.economy.lineIdOf.size).toBe(2);
      // (Over 150 s from the start, and from the put-away: the sawmill fills after some 24 loads, here and there.)
      const after = goodsIn(r, 90, 240);
      const plain = goodsIn(base, 0, 150);
      if (ENV.SHOW) console.log(`TRAP put away at 90 s: goods 90-240 s ${after} (a plain 2-train run, 0-150 s: ${plain}); 60-90 s, before it: ${goodsIn(r, 60, 90)}; goods at ${r.goodsAt.map((t) => t.toFixed(0)).join(",")} plain at ${base.goodsAt.map((t) => t.toFixed(0)).join(",")}`);
      expect(after).toBeGreaterThanOrEqual(plain);
      expect(r.meet).toBe(0);
    });

    it("undo brings it back where it stood, on its line, held again", () => {
      let undo: PutAway | null = null;
      const states: string[] = [];
      const { q, r } = n1(
        (q) => [
          { at: 90, fn: (E) => void (undo = putAway(q.sim, q.economy, E[2])) },
          { at: 90 + 1 / SIM_HZ, fn: (E) => void states.push(held(q, E)) },
          { at: 90 + 2 / SIM_HZ, fn: () => void expect(undo!.restore()).toBe(true) },
          { at: 100, fn: (E) => void states.push(held(q, E)) },
        ],
        110,
      );
      expect(states).toEqual(["room/room/gone", "room/room/held"]);
      expect(q.economy.lineIdOf.get(r.E[2])).toBe(q.economy.lineIdOf.get(r.E[0]));
      expect(r.meet).toBe(0);
    });
  });
  // Fix 2's case, built directly: no passing place (the loop pinned to one road both ways), the working train standing
  // at its end of the line, a second put down right in front of it on the single track, held for room where it
  // stands. 7034c25 handed the second the room and held the first: the second ran (13 arrivals) but delivered nothing,
  // the first held at the forest's end in its way. The hand-over is kept only where it lets a train deliver, so here
  // the newest stays held (the third-train trap): the cards say what to do (unpin), and "Put away" puts the second
  // away; then the first runs and delivers. (Game Mode's pinned harness, seeds 2027, 3, 1, 5: as on main.)
  for (const onLoop of [false, true])
    it(`held train in front of the working one at its line end (${onLoop ? "on the pinned loop" : "just past the end"}): the card says what to do, Put away frees it`, () => {
      const q = line0({ loops: 1, ends: 2 });
      const l = q.loops[0];
      pin(q, l, ["main", "main"]);
      const t0 = q.sim.ticks / SIM_HZ;
      const ahead = onLoop ? [l.main[0], l.main[1]] : [q.west[q.west.length - 1]];
      let away = -1;
      const r = show(
        `held in front ${onLoop}`,
        scen(q, [{ p: q.west[0], next: 1, s: 100, rev: true }, { p: ahead[0], ps: ahead, ss: [60, 100, 140], next: 1, s: 100, when: () => q.sim.ticks / SIM_HZ >= t0 + 1 }], [q.a, q.b], 300, cars, [
          ...(ENV.SHOW ? [1.5, 2, 3, 5, 10, 30, 60, 99].map((at) => ({ at, fn: (E: readonly number[]) => console.log(`INFRONT ${onLoop} t${at}: ${E.map((e) => `e${e} ${q.economy.sections.heldForRoom(e) ? "held" : "room"} @${[...new Set(q.sim.findCar(e)!.train.bogies.map((b) => b.pieceId))].join("+")} ${JSON.stringify(q.economy.sectionWait(e))}`).join(" ; ")}`) })) : []),
          {
            at: 100,
            fn: (E) => {
              away = q.economy.sections.putAwayFor(E[0]);
              if (away !== -1) putAway(q.sim, q.economy, away);
            },
          },
        ]),
      );
      const after = r.E.map((e) => r.arrAt.filter((x) => x.e === e && x.t >= 100).length);
      if (ENV.SHOW) console.log(`INFRONT ${onLoop}: ${r.arrivals.join("/")} after 100 s ${after.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} put ${r.whenAt} away ${away} cards ${[...r.cards].filter((c) => /pin|lay|full/.test(c)).join(" | ")}`);
      expect(r.E.length).toBe(2);
      expect(r.meet).toBe(0);
      // (The one put down last is held, and put away; the other runs after. On the loop it stands across a switch, in
      // a section: held there it would block the single track, so the first is held instead, and put away.)
      expect(away).toBe(onLoop ? r.E[0] : r.E[1]);
      expect(after[onLoop ? 1 : 0]).toBeGreaterThan(3);
      // (And delivers: loads unloaded after the put-away. Before it, none either way.)
      expect(r.goodsAt.filter((t) => t > 100).length).toBeGreaterThan(3);
      expect(r.goodsAt.filter((t) => t > 30 && t < 100).length).toBe(0);
      // (Before it's put away, the cards say what to do: unpin, or for the one put down, the same.)
      expect([...r.cards].some((c) => c.endsWith("unpin the passing loop's switches so trains can pass"))).toBe(true);
    });
});

invariantsHold();
