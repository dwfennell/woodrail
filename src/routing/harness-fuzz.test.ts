import { describe, expect, it } from "vitest";
import { Layout } from "../track";
import { HarnessRun, INVARIANTS, type Invariant, type Report, type Scenario, type TrainSpec } from "./harness";
import { fuzz, ringFuzz } from "./scenarios";

/**
 * Seeded fuzz over the loop fixtures (spec §12): random lines (0–2 passing loops, stops on loop roads, a dead-end
 * siding), 1–3 trains on one line or each on its own, switches left either way, lever taps. Every invariant is
 * checked; any today's router doesn't meet would be an expected failure naming the step expected to fix it (none since
 * step 4's restore).
 *
 *   npx vitest run src/routing/harness-fuzz.test.ts                         (8 seeds × 5 min: a few seconds)
 *   ROUTING_FUZZ=200 ROUTING_FUZZ_SECONDS=1800 npx vitest run --silent=false src/routing/harness-fuzz.test.ts
 *                                                                           (long: prints a line per seed that broke one,
 *                                                                           and one per seed where a stall began)
 *   npm run fuzz:long                                                       (the long one, sharded over the cores:
 *                                                                           scripts/fuzz-long.mjs; for release points)
 *
 * ROUTING_FUZZ_FIRST: the first seed (default 1), so a shard runs seeds FIRST .. FIRST + ROUTING_FUZZ − 1.
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.ROUTING_FUZZ ?? 8);
const FIRST = Number(ENV.ROUTING_FUZZ_FIRST ?? 1);
const SECONDS = Number(ENV.ROUTING_FUZZ_SECONDS ?? 300);
const LONG = ENV.ROUTING_FUZZ !== undefined;

/** Expected to fail today, and the step expected to fix each (spec §13). */
const FAILS: Partial<Record<Invariant, string>> = {};

describe(`routing fuzz: ${SEEDS} seeds${FIRST !== 1 ? ` from ${FIRST}` : ""} × ${SECONDS} s`, () => {
  let reports: Report[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      const seed = FIRST + k;
      const h = new HarnessRun(new Layout(), fuzz(seed, SECONDS));
      const r = h.run(SECONDS);
      const broke = INVARIANTS.filter((i) => r.broke[i].count > 0);
      if (LONG && broke.length > 0) console.log(`seed ${seed}: ${broke.map((i) => `${i} ×${r.broke[i].count} (${r.broke[i].first[0]})`).join("; ")}`);
      // (Stalls: waits that can't end now nothing turns a train back (§16 Q3), each seed where one began.)
      if (LONG && r.stalls.begun > 0) console.log(`seed ${seed} stalls: ${r.stalls.begun} begun, stuck ${r.stalls.stuck.map((s) => (s / 120).toFixed(0)).join("/")} s (${r.stalls.why.map((w) => w ?? "-").join("/")}); stops ${r.arrivals.join("/")}; waits ${r.waits}`);
      return r;
    }));
  for (const inv of INVARIANTS) {
    const check = () => {
      const broke = run().filter((r) => r.broke[inv].count > 0);
      expect(broke.map((r) => `${r.name}: ${r.broke[inv].first[0]}`)).toEqual([]);
    };
    const step = FAILS[inv];
    const timeout = LONG ? 24 * 3600_000 : 60_000;
    if (step) it.fails(`${inv} (expected to fail until ${step})`, check, timeout);
    else it(inv, check, timeout);
  }
  // (A layout the fuzz deals that jams from the start (a train too many for the line, two lines head on) delivers
  // nothing now nothing turns a train back (§16 Q3): its trains must then be said to be stuck, on their cards.)
  // A hand-run train (no stops: the fuzz deals one a fifth of the time when lines aren't shared) comes to no stop by
  // design; a run of only such trains delivers by running end to end, so it counts once one has turned at an end. (Seeds 9, 41,
  // 106 and 140 are a lone hand-run train shuttling 57–150 times in 30 min: they failed this check for want of a stop.)
  it("trains deliver: at least one stop come to (or end run to, hand-run) in each run, or its trains are said to be stuck", () => {
    // (With any routed train in the run, as before: a stop come to. Only hand-run trains: an end run to.)
    const delivers = (r: Report) =>
      r.routed.some(Boolean) ? r.arrivals.some((a, k) => r.routed[k] && a > 0) : r.turns.some((t) => t.buffer + t["open-end"] > 0);
    expect(run().filter((r) => !delivers(r) && r.stalls.begun === 0).map((r) => r.name)).toEqual([]);
  });
});

/**
 * The same seeds with 0 to 6 signal marks on random joints (signals spec §10.1): every invariant holds (`redRun` and
 * `blockOne` too), and a stall the seed doesn't have without them is a ring of signals (kind "signals").
 */
describe(`routing fuzz with signals: ${SEEDS} seeds${FIRST !== 1 ? ` from ${FIRST}` : ""} × ${SECONDS} s`, () => {
  let reports: { plain: Report; marked: Report }[] | undefined;
  const run = () =>
    (reports ??= Array.from({ length: SEEDS }, (_, k) => {
      // (FIRST + k, as the plain fuzz: a shard of `npm run fuzz:long` once ran seeds 1 .. ROUTING_FUZZ here whatever its
      // FIRST, so every shard ran the same seeds with signals and those past the first shard's never ran.)
      const seed = FIRST + k;
      const marked = new HarnessRun(new Layout(), fuzz(seed, SECONDS, true)).run(SECONDS);
      const plain = new HarnessRun(new Layout(), fuzz(seed, SECONDS)).run(SECONDS);
      if (LONG) {
        const broke = INVARIANTS.filter((i) => marked.broke[i].count > 0);
        if (broke.length > 0) console.log(`seed ${seed} with signals: ${broke.map((i) => `${i} ×${marked.broke[i].count} (${marked.broke[i].first[0]})`).join("; ")}`);
      }
      return { plain, marked };
    }));
  const timeout = LONG ? 24 * 3600_000 : 120_000;
  for (const inv of INVARIANTS)
    it(inv, () => {
      expect(
        run()
          .filter((r) => r.marked.broke[inv].count > 0)
          .map((r) => `${r.marked.name}: ${r.marked.broke[inv].first[0]}`),
      ).toEqual([]);
    }, timeout);
  it("a stall only with a signal ring (or where the seed stalls without signals)", () => {
    const odd = run().filter((r) => r.marked.stalls.begun > 0 && r.plain.stalls.begun === 0 && r.marked.stalls.why.some((w) => w !== null && w !== "signals"));
    expect(odd.map((r) => `${r.marked.name}: ${r.marked.stalls.why.join("/")}`)).toEqual([]);
  }, timeout);
});

/**
 * A route never makes it worse (the user, 2026-11-01: "The game shouldn't feel broken as soon as you add a route"): each
 * seed's layout and trains run twice, every train hand-run, and train 0 given a route (its own, else the first stop to
 * the last), the rest hand-run. With the route there must be no stall where all hand-run had none, and the stops come
 * to (every train's, a depot piece coming under it) must not drop by half or more. Over the fuzz's lines and over rings
 * (`ringFuzz`: hand-run trains one behind another round a ring with a passing loop, as on the user's map). On the rings
 * a third run, a line: 2 or 3 of the trains (by the seed) routed on one line A ⇄ B, the rest hand-run (the user,
 * 2026-11-02: line trains on a circuit follow each other, no room rule there). `ROUTE_WORSE=1` prints each seed's numbers.
 */
describe(`a route never makes it worse: ${SEEDS} seeds × ${SECONDS} s, lines and rings`, () => {
  type Run = { stalls: number; visits: number; why: string };
  type Pair = { name: string; hand: Run; routed: Run; line?: Run; lineOf?: number };
  const handRun = (t: TrainSpec): TrainSpec => ({ ...t, stops: undefined, line: undefined, next: undefined, vias: undefined });
  /** `routed`: how many trains get a route (0: all hand-run; 1: train 0; more: the first that many, on one line). */
  const variant = (sc: Scenario, routed: number): Scenario => ({
    ...sc,
    name: `${sc.name} (${routed === 0 ? "all hand-run" : routed === 1 ? "train 0 routed" : `a line of ${routed}`})`,
    build: (layout) => {
      const b = sc.build(layout);
      const depots = [...layout.pieceIds()].filter((id) => layout.getPiece(id)!.type.startsWith("depot"));
      const trains = b.trains.map((t, k) =>
        routed === 1 && k === 0
          ? { ...t, stops: t.stops ?? [depots[0], depots[depots.length - 1]], line: t.stops ? t.line : undefined, next: t.next ?? 0 }
          : routed > 1 && k < routed
            ? { ...t, stops: [depots[0], depots[depots.length - 1]], line: 1, next: k % 2, vias: undefined }
            : handRun(t),
      );
      // (Stops come to: a depot piece newly under a train, counted every tick for every train.)
      const under = new Map<number, Set<number>>();
      let visits = 0;
      const count = (run: HarnessRun) => {
        for (const id of run.sim.trainIds()) {
          const t = run.sim.getTrain(id)!;
          const key = t.cars[0].id;
          const was = under.get(key) ?? new Set<number>();
          const now = new Set<number>();
          for (const q of t.bogies) if (layout.getPiece(q.pieceId)?.type.startsWith("depot")) now.add(q.pieceId);
          for (const p of now) if (!was.has(p)) visits++;
          under.set(key, now);
        }
        (count as unknown as { visits: number }).visits = visits;
        return false;
      };
      counters.set(layout, count as unknown as { visits: number });
      return { ...b, trains, events: [...(b.events ?? []), { when: count, do: () => {} }] };
    },
  });
  const counters = new WeakMap<Layout, { visits: number }>();
  const once = (sc: Scenario): Run => {
    const layout = new Layout();
    const r = new HarnessRun(layout, sc).run(SECONDS);
    return { stalls: r.stalls.begun, visits: counters.get(layout)?.visits ?? 0, why: r.stalls.why.map((w) => w ?? "-").join("/") };
  };
  /** The trains a ring seed puts down (its line takes 2 or 3 of them, never more than there are). */
  const trainsOf = (sc: Scenario): number => sc.build(new Layout()).trains.length;
  const show = (r: Run) => `${r.visits} stops, ${r.stalls} stalls (${r.why})`;
  let pairs: Pair[] | undefined;
  const run = () =>
    (pairs ??= [
      ...Array.from({ length: SEEDS }, (_, k) => ({ sc: fuzz(FIRST + k, SECONDS), lineOf: 0 })),
      ...Array.from({ length: SEEDS }, (_, k) => {
        const sc = ringFuzz(FIRST + k, SECONDS);
        return { sc, lineOf: Math.min(trainsOf(sc), 2 + ((FIRST + k) % 2)) };
      }),
    ].map(({ sc, lineOf }) => {
      const pair: Pair = { name: sc.name, hand: once(variant(sc, 0)), routed: once(variant(sc, 1)) };
      if (lineOf >= 2) {
        pair.line = once(variant(sc, lineOf));
        pair.lineOf = lineOf;
      }
      if (ENV.ROUTE_WORSE || (LONG && worse(pair))) console.log(`${pair.name}: all hand-run ${show(pair.hand)}; train 0 routed ${show(pair.routed)}${pair.line ? `; a line of ${pair.lineOf} ${show(pair.line)}` : ""}${worse(pair) ? `  WORSE: ${worse(pair)}` : ""}`);
      return pair;
    }));
  const worseThan = (hand: Run, r: Run, what: string): string[] => {
    const out: string[] = [];
    if (r.stalls > 0 && hand.stalls === 0) out.push(`${what}: a new stall`);
    if (r.visits * 2 <= hand.visits && hand.visits >= 4) out.push(`${what}: stops ${hand.visits} → ${r.visits}`);
    return out;
  };
  const worse = (p: Pair): string => [...worseThan(p.hand, p.routed, "routed"), ...(p.line ? worseThan(p.hand, p.line, `line of ${p.lineOf}`) : [])].join(", ");
  const timeout = LONG ? 24 * 3600_000 : 180_000;
  it("no stall the all-hand-run run doesn't have, and no drop by half in stops come to (but the known ones)", () => {
    expect(run().filter((p) => worse(p) && !(p.name in KNOWN_WORSE)).map((p) => `${p.name}: ${worse(p)}`)).toEqual([]);
  }, timeout);
  it("the known ones still are (a fix takes its entry off)", () => {
    expect(run().filter((p) => p.name in KNOWN_WORSE && !worse(p)).map((p) => p.name)).toEqual([]);
  }, timeout);
  it("the rings' lines run: every ring seed's line of 2 or 3 comes to its stops", () => {
    const lines = run().filter((p) => p.line);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((p) => p.line!.visits < 4).map((p) => `${p.name}: ${show(p.line!)}`)).toEqual([]);
  }, timeout);
});

/**
 * Seeds a route still makes worse (100 + 100 seeds × 1800 s, 2026-11-01; 200 + 200, 2026-11-02), each with why: the
 * user's decision B (2026-11-02, rail-road.md): kept. All are hand-run trains running as a convoy into a dead end: the one behind pulls up behind
 * the one standing at the end and turns there too (routing spec §16 Q9), and they go back together. With a route, the
 * line's single-line working lets one train into a stretch of single track at a time (or one into a line end), so the
 * two stand, said stuck, the card's fix a passing loop.
 */
const KNOWN_WORSE: Record<string, string> = {
  "fuzz seed 74": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  "fuzz seed 77": "two trains put down in one line end, a third hand-run: hand-run they convoy into the end",
  "fuzz seed 79": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  // (Seeds 101–200, first run long on claude/route-follow-lines, 2026-11-02; the same on its base. The user's decision B:
  // convoys into a dead end stay one train to a section, the card's fix a passing loop.)
  "fuzz seed 121": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  "fuzz seed 127": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  "fuzz seed 135": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  "fuzz seed 183": "two trains on a plain line, no points: hand-run a convoy end to end; routed, both in its one section",
  // (2026-11-05, giving way, stalls.ts: on main both runs stalled (1 stop each). All hand-run, one now gives way and they
  // run on (26 stops); routed, it's a true deadlock, said stuck as before: the hand-run train stands between the routed
  // one and its stop at the line's end, with no room to turn there, and the siding's points trail for it.)
  "fuzz seed 7": "a hand-run train boxed in between the routed one and its stop at the line's end: stuck, as on main",
};
