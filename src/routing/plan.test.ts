import { describe, expect, it } from "vitest";
import { Layout, getPieceDef } from "../track";
import { distanceTo, next, wayToward, waysFrom } from "./graph";
import { MM_COSTS, PIECE_COSTS, plan, planChoice, PUSH_FACTOR, REVERSE_COST } from "./plan";
import * as S from "./scenarios";

/**
 * The plan search (step 3, spec §3.1): a Dijkstra over (piece, entry, engine leading). With piece-count costs it must
 * choose at points as today's steering does (`wayToward` by `distanceTo`), so that step 4 can swap it in unchanged.
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Every scenario's layout, and 40 fuzz layouts. */
function layouts(): { name: string; layout: Layout }[] {
  const out = [...S.KID, ...S.OTHERS].map((s) => {
    const layout = new Layout();
    s.build(layout);
    return { name: s.name, layout };
  });
  for (let seed = 1; seed <= 40; seed++) {
    const layout = new Layout();
    S.fuzz(seed, 60).build(layout);
    out.push({ name: `fuzz ${seed}`, layout });
  }
  return out;
}

/** Every choice at points: (points, entry) with two or more ways out. */
function choices(layout: Layout) {
  const out: { pieceId: number; entry: number; ways: ReturnType<typeof waysFrom> }[] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const n = getPieceDef(p.type, p.flipped).connectors.length;
    for (let entry = 0; entry < n; entry++) {
      const ways = waysFrom(layout, id, entry);
      if (ways.length > 1) out.push({ pieceId: id, entry, ways });
    }
  }
  return out;
}

describe("plan search, piece-count costs (step 3)", () => {
  it("chooses at every points, from every end, for every target, as today's steering does", () => {
    let compared = 0;
    let overcounted = 0;
    const differ: string[] = [];
    for (const { name, layout } of layouts()) {
      for (const c of choices(layout)) {
        for (const target of layout.pieceIds()) {
          if (target === c.pieceId) continue;
          for (const lead of [true, false]) {
            const today = wayToward(layout, c.pieceId, c.ways, target);
            const costs: number[] = [];
            const planned = planChoice(layout, c.pieceId, lead, c.ways, target, PIECE_COSTS, costs);
            compared++;
            if (today === planned) continue;
            // (Today's distance after each way; the plan's cost through it is one more, when today's is right.)
            const d = c.ways.map((w) => {
              const n = next(layout, c.pieceId, w.exit);
              return !n ? -1 : n.pieceId === target ? 0 : distanceTo(layout, n, target);
            });
            const overcount = d.some((x, k) => x >= 0 && x + 1 > costs[k]);
            if (name === S.balloonBehindOpenRoad.name && overcount) overcounted++;
            else differ.push(`${name}: points ${c.pieceId} in at ${c.entry} for ${target}: today ${today}, plan ${planned}`);
          }
        }
      }
    }
    if (ENV.SHOW) console.log(`plan vs today: ${compared} choices, ${overcounted} differ where distanceTo overcounts, ${differ.length} otherwise`);
    expect(compared).toBeGreaterThan(5000);
    // Only where distanceTo overcounts (the balloon behind points with an open road: see scenarios.ts).
    expect(differ.slice(0, 10)).toEqual([]);
    expect(overcounted).toBeGreaterThan(0);
  });

  it("costs what distanceTo counts, or less, from every end of every piece; less only where distanceTo overcounts", () => {
    let fewer = 0;
    let states = 0;
    for (const { name, layout } of layouts()) {
      for (const id of layout.pieceIds()) {
        const p = layout.getPiece(id)!;
        for (let entry = 0; entry < getPieceDef(p.type, p.flipped).connectors.length; entry++) {
          for (const target of layout.pieceIds()) {
            const d = distanceTo(layout, { pieceId: id, entry }, target);
            const found = plan(layout, { pieceId: id, entry, lead: true }, target, PIECE_COSTS);
            states++;
            expect(found === null, `${id}/${entry} → ${target}`).toBe(d === -1);
            if (!found) continue;
            expect(found.cost).toBeLessThanOrEqual(d);
            if (found.cost < d) {
              expect(name).toBe(S.balloonBehindOpenRoad.name);
              fewer++;
            }
          }
        }
      }
    }
    expect(states).toBeGreaterThan(10000);
    // (distanceTo marks a state seen as it's pushed, so a turn-back pushed first hides a later, shorter way to it: the
    // balloon behind points with an open road, and no other layout here.)
    expect(fewer).toBeGreaterThan(0);
  });

  it("its steps join up, piece to piece, and end beside the target", () => {
    for (const { layout } of layouts().slice(0, 12)) {
      const ids = [...layout.pieceIds()];
      for (const from of ids) {
        const p = layout.getPiece(from)!;
        const ends = getPieceDef(p.type, p.flipped).connectors.length;
        for (let entry = 0; entry < ends; entry++) {
          const found = plan(layout, { pieceId: from, entry, lead: true }, ids[ids.length - 1], PIECE_COSTS);
          if (!found || found.steps.length === 0) continue;
          let at = { pieceId: from, entry };
          for (const s of found.steps) {
            expect(s.pieceId).toBe(at.pieceId);
            expect(s.entry).toBe(at.entry);
            const n = s.reverse ? next(layout, s.pieceId, s.entry) : next(layout, s.pieceId, s.exit);
            expect(n).not.toBeNull();
            at = n!;
          }
          expect(at.pieceId).toBe(ids[ids.length - 1]);
        }
      }
    }
  });
});

describe("plan search, mm costs (step 6)", () => {
  it("a reverse costs REVERSE_COST and the run back; engine-last running costs PUSH_FACTOR more", () => {
    // The shuttle: stop A ══ … ══ stop B, buffers at both ends. From A's first straight heading for the buffer at A, to B.
    const layout = new Layout();
    S.shuttle.build(layout);
    const ids = [...layout.pieceIds()];
    const a = ids[0];
    const first = ids[1];
    const b = ids.find((id) => id !== a && layout.getPiece(id)!.type === "depot-forest")!;
    // In at A's straight from the far side: heading toward A and the buffer, so it must turn back.
    const towardA = next(layout, a, 1)!;
    expect(towardA.pieceId).toBe(first);
    const ahead = plan(layout, { pieceId: first, entry: towardA.entry === 0 ? 1 : 0, lead: true }, b, MM_COSTS)!;
    const back = plan(layout, { pieceId: first, entry: towardA.entry, lead: true }, b, MM_COSTS)!;
    expect(ahead.steps.some((s) => s.reverse)).toBe(true);
    expect(back.steps.some((s) => s.reverse)).toBe(false);
    expect(ahead.cost).toBeGreaterThan(back.cost + REVERSE_COST);
    // Engine-last the whole way: PUSH_FACTOR times as dear.
    const pushed = plan(layout, { pieceId: first, entry: towardA.entry, lead: false }, b, MM_COSTS)!;
    expect(pushed.cost).toBeCloseTo(back.cost * PUSH_FACTOR, 6);
    // With piece-count costs, pushing costs no more (today's search doesn't know which way the engine faces).
    expect(plan(layout, { pieceId: first, entry: towardA.entry, lead: false }, b, PIECE_COSTS)!.cost).toBe(plan(layout, { pieceId: first, entry: towardA.entry, lead: true }, b, PIECE_COSTS)!.cost);
  });
});

describe("plan search, forward costs (step 6)", () => {
  it("in mm, round a balloon, a wye's loop or an oval; by piece counts, back from a dead-end spur", () => {
    for (const s of S.FORWARD.filter((f) => f !== S.pushingShuttle)) {
      const layout = new Layout();
      const built = s.build(layout);
      const spur = new Set(built.watch);
      // From the stop it's come to (heading on, path 0 forward: in at connector 0), to the other one, behind it.
      const t = built.trains[0];
      const from = t.stops![t.next ?? 0];
      const to = t.stops!.find((id) => id !== from)!;
      const intoSpur = (p: ReturnType<typeof plan>) => p!.steps.some((st) => spur.has(st.pieceId));
      const mm = plan(layout, { pieceId: from, entry: 0, lead: true }, to, MM_COSTS)!;
      const pieces = plan(layout, { pieceId: from, entry: 0, lead: true }, to, PIECE_COSTS)!;
      expect(intoSpur(mm), s.name).toBe(false);
      expect(mm.steps.some((st) => st.reverse), s.name).toBe(false);
      expect(intoSpur(pieces), s.name).toBe(true);
    }
  });

  it("the end-of-line flip keeps the engine leading, so a plan never starts pushing", () => {
    const layout = new Layout();
    S.shuttle.build(layout);
    const ids = [...layout.pieceIds()].filter((id) => layout.getPiece(id)!.type === "depot-forest");
    // From A heading for its buffer, to B: a reverse at A, then led all the way.
    const p = plan(layout, { pieceId: ids[0], entry: 1, lead: true }, ids[1], MM_COSTS)!;
    expect(p.steps.some((st) => st.reverse)).toBe(true);
    const pushed = plan(layout, { pieceId: ids[0], entry: 1, lead: false }, ids[1], MM_COSTS)!;
    expect(pushed.cost).toBeCloseTo(p.cost * PUSH_FACTOR, 6);
  });
});

describe("plan search's cost", () => {
  it("a plan across the biggest fuzz layout takes well under 1 ms (warm-up, then the median of many)", () => {
    const all = layouts();
    const { layout } = all.reduce((m, l) => (l.layout.pieceCount > m.layout.pieceCount ? l : m));
    const ids = [...layout.pieceIds()];
    const pairs = ids.flatMap((from) => ids.map((to) => [from, to]));
    const time = () => {
      const t0 = performance.now();
      for (const [from, to] of pairs) plan(layout, { pieceId: from, entry: 0, lead: true }, to);
      return (performance.now() - t0) / pairs.length;
    };
    time();
    const runs = [0, 1, 2, 3, 4].map(time).sort((x, y) => x - y);
    if (ENV.SHOW) console.log(`plan: ${layout.pieceCount} pieces, ${pairs.length} plans, median ${(runs[2] * 1000).toFixed(1)} µs a plan`);
    expect(runs[2]).toBeLessThan(1);
  });
});
