import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { INVARIANTS, runScenario } from "./harness";
import { aimOf, passVias, resetVias, skipVias, type ViaProgress } from "./via";
import { planChoice, planWay, ROUTE_COSTS, sticks, STICK_MM, WayMemory } from "./plan";
import { waysFrom } from "./graph";
import { connectorRef } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import { twoWays } from "./scenarios";

/**
 * Via points and stickiness (routing spec §3.5, §3.1). The harness cases: two lines A ⇄ B over two ways between the
 * stops (a loop's two roads), for 30 game minutes.
 *
 *   npx vitest run src/routing/via.test.ts     (SHOW=1 prints the road counts)
 */
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe("via progress", () => {
  const vias = [[10, 11], [], [20]];
  const viasOf = (k: number) => vias[k];
  const onMap = (p: number) => p !== 99;
  it("aims at the vias into a stop in order, then the stop", () => {
    const r: ViaProgress = { next: 1 };
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(10);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501, 1)).toBe(11);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501, 2)).toBe(501);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501, 3)).toBe(-1);
    passVias(r, 3, viasOf, onMap, 10);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(11);
    // (Its front somewhere else: nothing passed.)
    passVias(r, 3, viasOf, onMap, 12);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(11);
    passVias(r, 3, viasOf, onMap, 11);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(501);
  });
  it("wraps round: the last stop's vias lead into the first; a stop with none goes straight there", () => {
    expect(aimOf({ next: 0 }, 3, 0, viasOf, onMap, 500)).toBe(20);
    expect(aimOf({ next: 2 }, 3, 2, viasOf, onMap, 502)).toBe(502);
  });
  it("starts afresh on the way to the next stop, and on the same stop's next lap", () => {
    const r: ViaProgress = { next: 1 };
    passVias(r, 3, viasOf, onMap, 10);
    passVias(r, 3, viasOf, onMap, 11);
    r.next = 2;
    resetVias(r);
    r.next = 1;
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(10);
    // (A one-stop route round a loop: its vias again each lap.)
    const one: ViaProgress = { next: 0 };
    passVias(one, 1, () => [7], onMap, 7);
    expect(aimOf(one, 1, 0, () => [7], onMap, 400)).toBe(400);
    resetVias(one);
    expect(aimOf(one, 1, 0, () => [7], onMap, 400)).toBe(7);
  });
  it("passes over vias taken up, and those sections send it past by another road", () => {
    const gone = [[99, 11]];
    expect(aimOf({ next: 0 }, 1, 0, () => gone[0], onMap, 400)).toBe(11);
    const r: ViaProgress = { next: 1 };
    expect(skipVias(r, 3, viasOf, new Set([10]))).toBe(true);
    expect(aimOf(r, 3, 1, viasOf, onMap, 501)).toBe(11);
    expect(skipVias(r, 3, viasOf, new Set([10]))).toBe(false);
  });
});

describe("stickiness", () => {
  it("planWay keeps the line's last way where it costs nearly the best (and only there); memory per line", () => {
    const l = new Layout();
    const [, w] = chain(l, ["depot-forest", "straight-216"]);
    const loop = loopOn(l, connectorRef(w, 1), ["straight-216", "straight-216"], ["straight-216"]);
    const [, b] = chain(l, ["straight-216", "depot-forest"], connectorRef(loop.s2, 0));
    const ways = waysFrom(l, loop.s1, 0);
    const costs: number[] = [];
    const best = planChoice(l, loop.s1, true, ways, b, ROUTE_COSTS, costs);
    const other = ways.find((x) => x.option !== best)!.option;
    expect(planWay(l, loop.s1, 0, ways, b)).toBe(best);
    expect(planWay(l, loop.s1, 0, ways, b, undefined, best)).toBe(best);
    // (Cached or not, the same answer.)
    expect(planWay(l, loop.s1, 0, ways, b, undefined, other)).toBe(sticks(costs[other], costs[best]) ? other : best);
    expect(planWay(l, loop.s1, 0, ways, b, undefined, other)).toBe(sticks(costs[other], costs[best]) ? other : best);
    const m = new WayMemory();
    m.set(1, loop.s1, 0, b, other);
    expect(m.of(1)(loop.s1, 0, b)?.way?.option).toBe(other);
    expect(m.of(2)(loop.s1, 0, b)).toBeUndefined();
    m.forget(1);
    expect(m.get(1, loop.s1, 0, b)).toBeUndefined();
  });
  it("keeps a way costing nearly the best, not one much dearer", () => {
    expect(sticks(1000, 1000)).toBe(true);
    expect(sticks(1100 + STICK_MM, 1000)).toBe(true);
    expect(sticks(1200 + STICK_MM, 1000)).toBe(false);
    expect(sticks(Infinity, 1000)).toBe(false);
  });
});

describe("two ways between the stops (harness, 30 game minutes)", () => {
  const free = twoWays(false);
  const kept = twoWays(true);
  const rFree = runScenario(new Layout(), free.scenario);
  const rKept = runScenario(new Layout(), kept.scenario);
  const lone = twoWays(false, true);
  const loneVia = twoWays(true, true);
  const rLone = runScenario(new Layout(), lone.scenario);
  const rLoneVia = runScenario(new Layout(), loneVia.scenario);
  if (ENV.SHOW) for (const [c, r] of [[free, rFree], [kept, rKept], [lone, rLone], [loneVia, rLoneVia]] as const) console.log(c.scenario.name, c.log, r.arrivals);
  it("no via points: the two lines' trains get mixed up, each on both ways", () => {
    for (const k of [0, 1]) {
      expect(free.log.top[k]).toBeGreaterThan(0);
      expect(free.log.bottom[k]).toBeGreaterThan(0);
    }
  });
  it("a via point on each line's way: Red always on the top, Blue always on the bottom", () => {
    expect(kept.log.top[0]).toBeGreaterThanOrEqual(80);
    expect(kept.log.bottom[0]).toBe(0);
    expect(kept.log.bottom[1]).toBeGreaterThanOrEqual(80);
    expect(kept.log.top[1]).toBe(0);
  });
  it("a via point on each: they deliver, never stuck, and no invariant broken (0 wrong roads)", () => {
    rKept.arrivals.forEach((a) => expect(a).toBeGreaterThanOrEqual(80));
    for (const k of INVARIANTS) expect(rKept.broke[k].count, `${k}: ${rKept.broke[k].first.join("; ")}`).toBe(0);
    expect(rKept.stalls.begun).toBe(0);
  });
  it("one train: the shorter way without a via, the via's way with one (every lap)", () => {
    expect(lone.log.top[0]).toBe(0);
    expect(lone.log.bottom[0]).toBeGreaterThanOrEqual(80);
    expect(loneVia.log.bottom[0]).toBe(0);
    expect(loneVia.log.top[0]).toBeGreaterThanOrEqual(80);
    for (const r of [rLone, rLoneVia]) for (const k of INVARIANTS) expect(r.broke[k].count, `${k}: ${r.broke[k].first.join("; ")}`).toBe(0);
  });
});
