import { describe, expect, it } from "vitest";
import { blocksOf, type Block } from "../game/signal-place";
import { rng } from "../lib/rng";
import { getPieceDef, Layout, pieceOfRef } from "../track";
import { markKey } from "../sim";
import { HarnessRun, INVARIANTS, type Report, type Scenario } from "./harness";
import { fuzz, ringFuzz } from "./scenarios";

/**
 * Signals laid as a player lays them (signals audit, 2026-11-06), over the loop fixtures and the rings: pairs (one post
 * each way on a joint, as the tray drops them) and the odd lone one, on joints of plain track. The plain fuzz with marks
 * (harness-fuzz.test.ts) deals lone marks only, and its `redRun`/`blockOne` read the sim's own blocks, so a block worked
 * out wrong (a pair's, empty: both posts green whatever stood past them) broke nothing there. Here every tick, against
 * blocks worked out apart from the sim (the tint's, `blocksOf`):
 *
 * - **greenOnTrain:** a plain block's signal (working by itself) never shows clear for two ticks running with a train on
 *   its block.
 * - **redForNothing:** a train never stands at a plain block's red for more than two ticks with its block clear of other
 *   trains, the signal not held, and no grant it waits for (`Sections.gateAt`).
 * - Every harness invariant (`redRun`: no train runs a red; `deadlock`), and a stall only with a signal ring or where the
 *   seed stalls without signals. (A ring through a signal laid inside a passing loop's road, a train held at it with its
 *   tail over the loop's points, is said "loop-signal": that signal is the one to move. Ring fuzz seeds 2 and 6.)
 *
 * Waits at a waiting point for a grant with nothing on the block (`gatedEmpty`) are a line's trains keeping to single-line
 * working beyond the block, not a fault in themselves: the longest is reported (`SIGNAL_FUZZ_SHOW=1`), not checked.
 *
 *   npx vitest run src/routing/signal-fuzz.test.ts                      (8 + 8 seeds × 4 min: about 20 s)
 *   SIGNAL_FUZZ=100 SIGNAL_FUZZ_SECONDS=1200 npx vitest run --silent=false src/routing/signal-fuzz.test.ts
 */

const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const SEEDS = Number(ENV.SIGNAL_FUZZ ?? 8);
const SECONDS = Number(ENV.SIGNAL_FUZZ_SECONDS ?? 240);
const LONG = ENV.SIGNAL_FUZZ !== undefined;
const SHOW = !!ENV.SIGNAL_FUZZ_SHOW || LONG;

interface Found {
  greenOnTrain: string[];
  redForNothing: string[];
  /** The longest wait (s) at a waiting point's red with its block clear (for the grant), and where. */
  gatedEmpty: { s: number; at: string };
}

/** A joint of plain track: neither piece points, a crossing, a buffer or a station (where a player puts a signal). */
function plainJoint(layout: Layout, a: number, b: number): boolean {
  for (const id of [pieceOfRef(a), pieceOfRef(b)]) {
    const p = layout.getPiece(id);
    if (!p) return false;
    const def = getPieceDef(p.type, p.flipped);
    if (def.paths.length !== 1 || def.signal || p.type.startsWith("depot") || p.type === "buffer") return false;
  }
  return true;
}

/** 1 to 4 places on plain joints: a pair there (a post each way) four times in five, else one post, facing either way. */
function laySignals(layout: Layout, seed: number): void {
  const r = rng(seed * 7 + 101);
  const joints = [...layout.joints()].filter((j) => plainJoint(layout, j.a, j.b));
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n && joints.length > 0; i++) {
    const j = joints.splice(Math.floor(r() * joints.length), 1)[0];
    if (r() < 0.8) {
      layout.addSignal(j.a);
      layout.addSignal(j.b);
    } else layout.addSignal(r() < 0.5 ? j.a : j.b);
  }
}

function watched(sc: Scenario, seed: number, found: Found): Scenario {
  return {
    ...sc,
    name: `${sc.name} with pairs`,
    build: (layout) => {
      const b = sc.build(layout);
      laySignals(layout, seed);
      // (Each mark's block, the tint's way, and whether it has points or a crossing in it; found again on a change.)
      let at = "";
      let blocks = new Map<number, { block: Block; junction: boolean }>();
      const greenRun = new Map<number, number>();
      const redRun = new Map<number, number>();
      const gatedSince = new Map<number, number>();
      const check = (run: HarnessRun): boolean => {
        const { sim, sections } = run;
        const key = `${layout.revision}:${layout.jointsVersion}:${layout.signalsVersion}`;
        if (key !== at) {
          at = key;
          blocks = new Map();
          for (const m of layout.signals()) {
            const block = blocksOf(layout, m.at, m.id).ahead;
            let junction = false;
            for (const id of block.keys()) {
              const p = layout.getPiece(id);
              if (p && getPieceDef(p.type, p.flipped).paths.length > 1) junction = true;
            }
            blocks.set(m.id, { block, junction });
          }
        }
        const on = (block: Block, self: number): number => {
          for (const id of sim.trainIds()) {
            if (id === self) continue;
            const t = sim.getTrain(id)!;
            if (!t.derailed && t.bogies.some((q) => block.has(q.pieceId))) return id;
          }
          return -1;
        };
        const tick = run.sim.ticks;
        for (const m of layout.signals()) {
          const g = blocks.get(m.id);
          if (!g || g.junction || m.held || m.forced) continue;
          const by = on(g.block, -1);
          const n = by !== -1 && sim.markClear(m.id) ? (greenRun.get(m.id) ?? 0) + 1 : 0;
          greenRun.set(m.id, n);
          if (n === 3) found.greenOnTrain.push(`${sc.name}: signal ${m.id} (piece ${pieceOfRef(m.at)}) green with train ${by} on its block, tick ${tick}`);
        }
        for (const id of sim.trainIds()) {
          if (!sim.atRedSignal(id)) {
            redRun.delete(id);
            gatedSince.delete(id);
            continue;
          }
          const k = sim.redSignalKeyAhead(id);
          const m = [...layout.signals()].find((x) => markKey(x.id) === k);
          const g = m && blocks.get(m.id);
          if (!m || !g || g.junction || m.held || on(g.block, id) !== -1) {
            redRun.delete(id);
            gatedSince.delete(id);
            continue;
          }
          if (sections.gateAt(m.at) !== -1) {
            redRun.delete(id);
            const since = gatedSince.get(id) ?? tick;
            gatedSince.set(id, since);
            const s = (tick - since) / 120;
            if (s > found.gatedEmpty.s) found.gatedEmpty = { s, at: `${sc.name}: train ${id} at signal ${m.id}` };
            continue;
          }
          const n = (redRun.get(id) ?? 0) + 1;
          redRun.set(id, n);
          if (n === 3) found.redForNothing.push(`${sc.name}: train ${id} stands at signal ${m.id}'s red with its block clear, tick ${tick}`);
        }
        return false;
      };
      return { ...b, events: [...(b.events ?? []), { when: check, do: () => {} }] };
    },
  };
}

describe(`signal fuzz: pairs laid as a player does, ${SEEDS} + ${SEEDS} seeds × ${SECONDS} s`, () => {
  type Run = { marked: Report; plain: Report; found: Found };
  let runs: Run[] | undefined;
  const run = () =>
    (runs ??= [
      ...Array.from({ length: SEEDS }, (_, k) => ({ seed: 1 + k, sc: fuzz(1 + k, SECONDS) })),
      ...Array.from({ length: SEEDS }, (_, k) => ({ seed: 1 + k, sc: ringFuzz(1 + k, SECONDS) })),
    ].map(({ seed, sc }) => {
      const found: Found = { greenOnTrain: [], redForNothing: [], gatedEmpty: { s: 0, at: "" } };
      const marked = new HarnessRun(new Layout(), watched(sc, seed, found)).run(SECONDS);
      const plain = new HarnessRun(new Layout(), sc).run(SECONDS);
      if (SHOW) {
        const broke = INVARIANTS.filter((i) => marked.broke[i].count > 0);
        console.log(
          `${marked.name}: stops ${marked.arrivals.join("/")} (without ${plain.arrivals.join("/")}); stalls ${marked.stalls.begun} (${marked.stalls.why.map((w) => w ?? "-").join("/")}) without ${plain.stalls.begun}` +
            `; longest wait for a grant at a clear block ${found.gatedEmpty.s.toFixed(1)} s${broke.length ? `; broke ${broke.join(",")}` : ""}`,
        );
      }
      return { marked, plain, found };
    }));
  const timeout = LONG ? 24 * 3600_000 : 180_000;
  it("greenOnTrain: a plain block's signal is never green with a train on its block", () => {
    expect(run().flatMap((r) => r.found.greenOnTrain)).toEqual([]);
  }, timeout);
  it("redForNothing: no train stands at a red whose block is clear, not held, with no grant to wait for", () => {
    expect(run().flatMap((r) => r.found.redForNothing)).toEqual([]);
  }, timeout);
  for (const inv of INVARIANTS)
    it(inv, () => {
      expect(run().filter((r) => r.marked.broke[inv].count > 0).map((r) => `${r.marked.name}: ${r.marked.broke[inv].first[0]}`)).toEqual([]);
    }, timeout);
  it("a stall only with a signal ring (or where the seed stalls without signals)", () => {
    const odd = run().filter((r) => r.marked.stalls.begun > 0 && r.plain.stalls.begun === 0 && r.marked.stalls.why.some((w) => w !== null && w !== "signals" && w !== "loop-signal"));
    expect(odd.map((r) => `${r.marked.name}: ${r.marked.stalls.why.join("/")}`)).toEqual([]);
  }, timeout);
  it("the pairs were tested: blocks with trains in them, and trains held at a red", () => {
    // (A guard on the fuzz itself: it laid signals that trains came to.)
    expect(run().reduce((n, r) => n + r.marked.signalPasses, 0)).toBeGreaterThan(SEEDS * 4);
  }, timeout);
});

describe("signal fuzz: cases it found (signals audit, 2026-11-06)", () => {
  it("fuzz seed 11: a pair in a line end before points, two trains of a line: they run (the one at the pair asks for its move from there)", () => {
    // (The train in the line end stood at the pair's red, a path signal: clear only once the router locked its way,
    // which waited on sections' grant, asked for only at the slot's end ~216 mm on. The other waited in the loop for
    // that line end: stuck for good, 1 stop each against 25 without the signals.)
    const found: Found = { greenOnTrain: [], redForNothing: [], gatedEmpty: { s: 0, at: "" } };
    const r = new HarnessRun(new Layout(), watched(fuzz(11, 300), 11, found)).run(300);
    expect(r.stalls.begun).toBe(0);
    for (const a of r.arrivals) expect(a).toBeGreaterThan(8);
    expect([...found.greenOnTrain, ...found.redForNothing]).toEqual([]);
  }, 60_000);
});

