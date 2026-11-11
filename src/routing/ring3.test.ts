import { describe, expect, it } from "vitest";
import { connectorRef, indexOfRef, Layout, pieceOfRef, type PieceTypeId } from "../track";
import { getPieceDef } from "../track/pieces";
import { chain } from "../economy/loop-fixtures";
import { SIM_HZ } from "../sim";
import { HarnessRun, INVARIANTS, signal, type Scenario, type ScriptedEvent, type TrainSpec } from "./harness";
import { oracle, type OracleResult } from "./stalls-oracle";
import { oTrains, snapshot, track } from "./stalls-dump";

/**
 * A ring cut into three blocks by signals (docs/agents/stalls-verify-2026-11-10.md, "A ring in three blocks"): the
 * user's question, "two trains on a ring in three blocks: should they move?" Yes, when both run the same way round:
 * two trains in three blocks always leave the block ahead of one of them free. Three trains (one a block) can't move,
 * nor can two that face each other on a ring.
 *
 * The ring: ▣A ══ ══ ══ (half round) ▣B ══ ══ ══ (half round) back to A, 16 pieces, cut at three joints by a pair of
 * signals each (a post each way, as the tray drops them) or by one signal each facing the way the trains run. Each case
 * runs 30 game minutes with every train invariant on, and is searched by the dispatcher oracle (`stalls-oracle.ts`)
 * with the signals' blocks.
 *
 *   npx vitest run src/routing/ring3.test.ts                                   (about 1 min)
 *   RING3_OUT=.ring3 npx vitest run --silent=false src/routing/ring3.test.ts   (and dump each case for the sketch)
 */
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs")) as { mkdirSync(path: string, o: { recursive: boolean }): void; writeFileSync(path: string, text: string): void };
const ENV: Record<string, string | undefined> = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const OUT = ENV.RING3_OUT;
const SECONDS = 30 * 60;

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";
const STOP: PieceTypeId = "depot-forest";
const CARS = ["engine", "timber", "timber"] as const;

/** The ring's pieces in running order (a train put down unreversed runs 0 → 1 → …), and the stops A and B. */
function ring(layout: Layout) {
  const ids = chain(layout, [STOP, S, S, S, C, C, C, C, STOP, S, S, S, C, C, C, C]);
  if (layout.joinedConnector(connectorRef(ids[0], 0)) === -1) throw new Error("the ring doesn't close");
  return { ids, a: ids[0], b: ids[8] };
}

/** The joints cut: after pieces 1, 6 and 11 (blocks of 5, 5 and 6 pieces: 2–6, 7–11, 12–1). */
const CUTS = [1, 6, 11];
/**
 * With nothing to stop them, two trains put down apart keep apart: the harness has no dwell at stops, so a follower
 * never comes up to the train ahead. To see it wait at a signal, the player holds one cut's signal red by hand for `HOLD`
 * s every `EVERY` s (a tap, then a tap to let go): the first train to come to it stands there, the other comes up behind
 * and waits at the auto red of the block before (a signal no one holds).
 */
const EVERY = 240;
const HOLD = 15;
/** A piece in the middle of each block. */
const MID = [4, 9, 14];

type Signals = "pairs" | "singles" | "none";
interface Case {
  name: string;
  signals: Signals;
  /** Per train: the block it starts in (0–2), whether it faces back (runs the other way round), its line. */
  trains: { block: number; back?: boolean; line?: number; hand?: boolean }[];
  /** What it should do: every train keeps delivering, or a stall said on the card. */
  expect: "deliver" | "stall";
  /** The card's stall today (`Stuck["kind"]`), and the one it should say where they differ. */
  card?: string;
  shouldSay?: string;
}

const CASES: Case[] = [
  { name: "1a one line, two trains the same way, pairs", signals: "pairs", trains: [{ block: 0, line: 1 }, { block: 1, line: 1 }], expect: "deliver" },
  { name: "1b one line, two trains the same way, single signals", signals: "singles", trains: [{ block: 0, line: 1 }, { block: 1, line: 1 }], expect: "deliver" },
  { name: "1c one line, two trains the same way, nose to tail in next blocks, pairs", signals: "pairs", trains: [{ block: 0, line: 1 }, { block: 2, line: 1 }], expect: "deliver" },
  { name: "2a own lines, two trains the same way, pairs", signals: "pairs", trains: [{ block: 0 }, { block: 1 }], expect: "deliver" },
  { name: "2b own lines, two trains the same way, single signals", signals: "singles", trains: [{ block: 0 }, { block: 1 }], expect: "deliver" },
  { name: "2c a hand-run train catching up a routed one, pairs", signals: "pairs", trains: [{ block: 0 }, { block: 2, hand: true }], expect: "deliver" },
  { name: "2d a hand-run train catching up a routed one, single signals", signals: "singles", trains: [{ block: 0 }, { block: 2, hand: true }], expect: "deliver" },
  { name: "3a one line, three trains (one a block), pairs", signals: "pairs", trains: [{ block: 0, line: 1 }, { block: 1, line: 1 }, { block: 2, line: 1 }], expect: "stall", card: "signals" },
  { name: "3b own lines, three trains (one a block), single signals", signals: "singles", trains: [{ block: 0 }, { block: 1 }, { block: 2 }], expect: "stall", card: "signals" },
  { name: "3c one line, two trains facing each other, pairs", signals: "pairs", trains: [{ block: 0, line: 1 }, { block: 1, back: true, line: 1 }], expect: "stall", card: "signals", shouldSay: "in-way" },
  { name: "3d own lines, two trains facing each other, single signals", signals: "singles", trains: [{ block: 0 }, { block: 1, back: true }], expect: "stall", card: "signals", shouldSay: "in-way" },
  { name: "3e control: one line, three trains, no signals", signals: "none", trains: [{ block: 0, line: 1 }, { block: 1, line: 1 }, { block: 2, line: 1 }], expect: "deliver" },
];

function scenario(c: Case): Scenario {
  return {
    name: c.name,
    seconds: SECONDS,
    heldFree: true,
    build: (layout) => {
      const r = ring(layout);
      const forward: number[] = [];
      for (const i of CUTS) {
        if (c.signals === "none") continue;
        // (Guards a train leaving piece i by its end 1: one running the way they're put down.)
        forward.push(signal(layout, r.ids[i], 1));
        if (c.signals === "pairs") signal(layout, r.ids[i + 1], 0);
      }
      const trains: TrainSpec[] = c.trains.map((t) => ({ pieceId: r.ids[MID[t.block]], reversed: !!t.back, stops: t.hand ? undefined : [r.a, r.b], line: t.line, cars: [...CARS] }));
      const events: ScriptedEvent[] = [];
      if (c.expect === "deliver" && forward.length > 0)
        for (let at = 120; at < SECONDS - 60; at += EVERY) {
          events.push({ at, do: (run) => run.holdSignal(forward[0], true) });
          events.push({ at: at + HOLD, do: (run) => run.holdSignal(forward[0], false) });
        }
      return { trains, events };
    },
  };
}

/** Signal blocks, piece → block: pieces joined by a joint with no signal on it either way. */
function blocksOfLayout(layout: Layout): Map<number, number> {
  const parent = new Map<number, number>();
  const find = (p: number): number => {
    let q = p;
    while (parent.has(q) && parent.get(q) !== q) q = parent.get(q)!;
    return q;
  };
  for (const id of layout.pieceIds()) parent.set(id, id);
  for (const j of layout.joints()) if (!layout.signalAt(j.a) && !layout.signalAt(j.b)) parent.set(find(pieceOfRef(j.a)), find(pieceOfRef(j.b)));
  const out = new Map<number, number>();
  for (const id of layout.pieceIds()) out.set(id, find(id));
  return out;
}

interface Result {
  arrivals: number[];
  begun: number;
  why: (string | null)[];
  broke: string[];
  /** The booking core in shadow's disagreements (heldFree: test-only, routing redesign step 2), apart from the game's own checks. */
  heldFree: string[];
  longestStill: number[];
  /** Times a train came to a stand (lever on, not at a stop), by where its front was: at a signal's joint, on or before points, elsewhere. */
  stands: { signal: number; auto: number; points: number; other: number };
  oracle: OracleResult;
}

const isSwitch = (layout: Layout, p: number) => {
  const piece = layout.getPiece(p);
  return !!piece && getPieceDef(piece.type, piece.flipped).paths.length > 1;
};

async function play(c: Case): Promise<Result> {
  const layout = new Layout();
  const h = new HarnessRun(layout, scenario(c));
  const start = oTrains(h);
  const blocks = c.signals === "none" ? undefined : blocksOfLayout(layout);
  const o = oracle(layout, start, "any", 400_000, blocks);
  const startSnap = snapshot(h);
  const stands = { signal: 0, auto: 0, points: 0, other: 0 };
  const moving = h.engines.map(() => true);
  let stallAt = -1;
  let atStall: ReturnType<typeof snapshot> | null = null;
  // (For the sketch: the first time one waits at an auto red.)
  let waitAt = -1;
  let atWait: ReturnType<typeof snapshot> | null = null;
  let report = h.run(0);
  for (let s = 0; s < SECONDS * 4; s++) {
    report = h.run(0.25);
    h.engines.forEach((engine, k) => {
      const t = h.sim.findCar(engine)?.train;
      if (!t) return;
      const still = Math.abs(t.speed) < 1;
      if (still && moving[k] && !h.routes.get(engine)?.at) {
        const e = oTrains(h)[k].elems;
        const f = e[e.length - 1];
        if (e.some((x) => isSwitch(layout, x.p))) stands.points++;
        else if (f.ex >= 0 && layout.signalAt(connectorRef(f.p, f.ex))) {
          stands.signal++;
          if (!layout.signalAt(connectorRef(f.p, f.ex))!.held) {
            stands.auto++;
            if (!atWait) {
              waitAt = (s + 1) / 4;
              atWait = snapshot(h);
            }
          }
        }
        else stands.other++;
      }
      moving[k] = !still;
    });
    if (ENV.RING3_TRACE && c.name.startsWith(ENV.RING3_TRACE) && s % 8 === 0 && s < 400)
      console.log(`t=${(s + 1) / 4}: ${snapshot(h).map((x) => ("gone" in x ? "gone" : `t${x.k}@${x.pieces.join(">")} v${x.speed} ${x.heldHow ?? ""}`)).join(" | ")}`);
    if (stallAt < 0 && h.engines.some((e) => h.stalls.stuckOf(e))) {
      stallAt = (s + 1) / 4;
      atStall = snapshot(h);
    }
  }
  const said = (k: (typeof INVARIANTS)[number]) => `${k} ×${report.broke[k].count}: ${report.broke[k].first[0]}`;
  const broke = INVARIANTS.filter((k) => k !== "heldFree" && report.broke[k].count > 0).map(said);
  const heldFree = report.broke.heldFree.count > 0 ? [said("heldFree")] : [];
  const res: Result = { arrivals: report.arrivals, begun: report.stalls.begun, why: report.stalls.why, broke, heldFree, longestStill: report.longestStill, stands, oracle: o };
  if (OUT) {
    const { mkdirSync, writeFileSync } = await fs();
    mkdirSync(OUT, { recursive: true });
    const sig = [...layout.signals()].map((m) => ({ piece: pieceOfRef(m.at), end: indexOfRef(m.at) }));
    const n = CASES.indexOf(c) + 1;
    const panel = atStall ? `at the stall (${stallAt} s)` : atWait ? `waiting at an auto red (${waitAt} s)` : "at the end (30 min)";
    const doc = { seed: n, name: c.name, panel, oracle: { startAny: o, stallAny: o }, stallAt, start: startSnap, atStall: atStall ?? atWait, end: snapshot(h), track: track(layout), signals: sig, arrivals: report.arrivals, begun: report.stalls.begun };
    writeFileSync(`${OUT}/seed-${n}.json`, JSON.stringify(doc));
  }
  console.log(`${c.name}: stops ${res.arrivals.join("/")}; stalls ${res.begun} (${res.why.join(",")}); stands at signals ${stands.signal} (${stands.auto} at an auto red), on points ${stands.points}, elsewhere ${stands.other}; longest still ${res.longestStill.map((x) => (x / SIM_HZ).toFixed(1)).join("/")} s; broke [${broke.join("; ")}]${heldFree.length ? ` shadow [${heldFree[0]}]` : ""}; oracle ${o.best}/${start.length} (${o.states} states)`);
  return res;
}

describe("a ring in three blocks", () => {
  for (const c of CASES)
    it(c.name, async () => {
      const r = await play(c);
      expect(r.broke).toEqual([]);
      expect(r.stands.points).toBe(0);
      // (heldFree, the booking core in shadow, isn't asserted: it reads only a signal held red, not an auto block's red,
      // so it books a follower on into a block another train is in. Today's game holds it there, rightly.)
      if (c.expect === "deliver") {
        expect(r.begun).toBe(0);
        c.trains.forEach((t, k) => {
          if (!t.hand) expect(r.arrivals[k]).toBeGreaterThan(100);
          // (In ticks: no stand over 20 s.)
          expect(r.longestStill[k]).toBeLessThan(20 * SIM_HZ);
        });
        expect(r.oracle.best).toBe(c.trains.length);
        // (Every stand at a signal, and each time the held one is, the other train at an auto red behind it. A train
        // at the held signal stands with its tail on stop A, so its stand counts as at a stop.)
        expect(r.stands.other).toBe(0);
        if (c.signals !== "none") expect(r.stands.auto).toBeGreaterThanOrEqual(Math.floor((SECONDS - 180) / EVERY));
      } else {
        expect(r.begun).toBeGreaterThan(0);
        expect(r.oracle.best).toBeLessThan(c.trains.length);
        for (const w of r.why) expect(w).toBe(c.card);
      }
    }, 300_000);
});

/**
 * Two trains facing each other on the ring: the card says "too many trains for these signals. Add a signal", and no
 * signal lets them pass; moving one is the fix ("in-way"). Fails today, by design: the proposed fix (stalls.ts, a ring of
 * waits with two trains nose to nose isn't "signals") is docs/agents/stalls-verify/exp4-head-on-card.patch.
 */
describe("a ring in three blocks: the card for two trains nose to nose", () => {
  for (const c of CASES.filter((c) => c.shouldSay))
    it.fails(`${c.name} says ${c.shouldSay}`, async () => {
      const r = await play(c);
      for (const w of r.why) expect(w).toBe(c.shouldSay);
    }, 300_000);
});
