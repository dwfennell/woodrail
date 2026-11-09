import { describe, expect, it } from "vitest";
import { STUCK_S } from "./stalls";
import { ENV, cars, clearTrains, invariantsHold, pin, qb5, runsOrSays, scen, two } from "./sections-qa-testing";

// QA's B5 sweeps: trains put down on the loops' roads run after run in one world (split from sections-qa.test.ts).
describe("sections: QA's B2/B3 park cases", { timeout: 600_000 }, () => {
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
          const says = [...r.cards].some((c) => /Lay \d+ more|lay \d+ more|Move it|unpin/.test(c)) || runsOrSays(r, at + 180, 3).length === 0;
          const line = `${kind} ${road} at ${at}: ov ${r.overlaps} ${r.overlapAt} goods ${r.goodsAt.length} ${r.arrivals.join("/")} still ${r.allStill.toFixed(0)} ring ${r.longestRing.toFixed(1)} meets ${meets} released ${r.released} stalls ${r.stalls} flips ${r.E.map((e) => r.flips.get(e) ?? 0).join("/")}`;
          if (ENV.SHOW) console.log(`B5 ${line}`);
          if (ENV.SHOW && ENV.CARDS) for (const e of r.E) console.log(`B5C e${e}`, [...(r.cardsOf.get(e) ?? [])].map(([c, n]) => `${c} x${n}`).join(" | "));
          if (meets > 0 || ((r.longestRing > STUCK_S + 3 || r.allStill > 60) && !says)) bad.push(line);
          if (r.stale > 0) bad.push(`${line}: ${r.stale} "lay" cards on trains with room`);
          // (QA: a spare can leave the line delivering nothing. Then the cards must say to move it.)
          const delivering = r.arrivals.slice(0, 3).some((a) => a > 3);
          if (kind === "spare" && !delivering && ![...r.cards].some((c) => /[Mm]ove (it|the parked train)$/.test(c))) bad.push(`${line}: no card saying to move it`);
          if (r.allStill > 60 && says && ENV.SHOW) console.log(`B5 still, but it says why: ${[...r.cards].filter((c) => /ay \d+ more|Move it|unpin/.test(c)).join(" | ")}`);
        }
    expect(bad).toEqual([]);
  });
  it("B5: QA's spare sweep, in order in one world: never all still for a minute", () => {
    expect(qb5(false)).toEqual([]);
  });
  // (Game Mode's idle head-on: with nothing to load or unload, trains run through the depots, and one turned back short
  // with its tail on a loop's switch it had trailed through from the side road, set for the main: the rest of it
  // followed the switch, the train split across both roads, and met the one coming the other way (l0.main T45).)
  it("B5: QA's spare sweep with the trains idle (laden, the sawmill full): no head-on, no train split across a loop", () => {
    expect(qb5(true, "l0.main")).toEqual([]);
  });
});

invariantsHold();
