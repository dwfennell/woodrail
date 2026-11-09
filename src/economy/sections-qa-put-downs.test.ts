import { describe, expect, it } from "vitest";
import { STUCK_S } from "./stalls";
import { ENV, type T, cars, invariantsHold, line0, runsOrSays, scen, two } from "./sections-qa-testing";

// QA's random put-downs and trains taken off their line (split from sections-qa.test.ts).
describe("sections: QA's B2/B3 park cases", { timeout: 600_000 }, () => {
  // The invariant again, with two trains put down at random (seeded) on loop roads or line ends, and a spare among
  // them now and then: whatever the line can or can't do then, no ring of waits outlasts its breaking, and no train
  // bumps another bar one put down in front of a moving one.
  it("random put-downs: no head-ons; a ring of waits that lasts is said on the cards", () => {
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
      const unsaid = runsOrSays(r, 300, 3);
      if (meets > 0 || (r.longestRing > STUCK_S + 3 && unsaid.length > 0)) bad.push(`seed ${seed}: ring ${r.longestRing.toFixed(1)} s, meets ${meets}; unsaid ${unsaid.join("; ")}`);
    }
    expect(bad).toEqual([]);
  });
  // (Random put-downs, seed 16: two spares put down at 90 s, one standing in the section ahead of a line train. It
  // waits short of it, a dead end, naming the spare: once it named no one (−1), for minutes.)
  it("random put-downs, seed 16: a wait short of a spare standing ahead names the spare", () => {
    let x = 16 * 7919;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const { q, l0, l1, R3 } = two();
    const spots = [l0.side[1], l0.main[0], l1.side[1], l1.main[0], q.middle[0][0], q.west[0], q.east[0]];
    const extra: T[] = [0, 1].map(() => ({ p: spots[Math.floor(rnd() * spots.length)], next: rnd() < 0.5 ? 0 : 1, s: 100, at: 2 + Math.floor(rnd() * 120), spare: rnd() < 0.2 }));
    const ghosts: string[] = [];
    let named = 0;
    const events = Array.from({ length: 298 }, (_, k) => ({
      at: 2 + k,
      fn: (E: readonly number[]) => {
        for (const e of E) {
          const w = q.economy.sections.waitOf(e);
          if (!w || !("engine" in w)) continue;
          if (q.sim.findCar(w.engine)) named++;
          else ghosts.push(`${2 + k} s: ${e} waits (${w.kind}) for ${w.engine}`);
        }
      },
    }));
    scen(q, [...R3, ...extra], [q.a, q.b], 300, cars, events);
    expect(ghosts.slice(0, 4)).toEqual([]);
    expect(named).toBeGreaterThan(0);
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
  // QA's N2: a running train taken off its line at 5 s, put down anywhere on a 1-loop line among the line's two. The
  // line's train in a loop road ran head on into it (the line's slots don't keep a train on no line out): two real
  // bumps 2.3 s apart, the second as it turned back into it again. On origin/main (7385861) 15 of these placements
  // bumped so. Now a line's train stops short of a train not on its line ahead of it, as that one does of it.
  it("QA's N2: a train taken off its line, anywhere among the line's two: no head-ons; where they stand, they say why", () => {
    const rows: string[] = [];
    for (const ends of ENV.ENDS ? [Number(ENV.ENDS)] : [1, 2])
      for (let p0 = ENV.P0 ? Number(ENV.P0) : 0; p0 < (ENV.P0 ? Number(ENV.P0) + 1 : 16); p0++)
        for (const s0 of ENV.S0 ? [Number(ENV.S0)] : [20, 100, 180]) {
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
          // (Nothing turns back now (routing §16 Q3): where they don't deliver, they say why.)
          const unsaid = runsOrSays({ ...r, E: r.E.slice(0, 2) }, 240, 1);
          if (r.arrivals[0] + r.arrivals[1] < 3 && unsaid.length > 0) rows.push(`ends ${ends}, piece ${p0} at ${s0}: ${r.arrivals.join("/")} arrivals; ${unsaid.join("; ")}`);
        }
    expect(rows).toEqual([]);
  });
});

invariantsHold();
