/**
 * One routing case judged (docs/agents/routing-cases.md): the dispatcher oracle's verdict on the trains as put down,
 * then the game (the routing harness: sim, sections, router, stalls, every train invariant) run for a few trips, and
 * where the two disagree. Test-only.
 */
import { getPieceDef, Layout } from "../../track";
import { HarnessRun, INVARIANTS } from "../harness";
import { oracle, type OracleResult } from "./oracle";
import { oTrains } from "./train-view";
import { scenarioOf, secondsOf, type Case } from "./cases";

/** What the game must do, by the oracle: every train keep running ("live"), or not all of them ("dead"; "partial": some could). */
export type Verdict = "live" | "dead" | "partial" | "unknown";

/**
 * Hand-run trains (all, or among a routed one) are the player's to run: no one dispatches them (they turn at every
 * buffer, take points as set, and the game throws points for one only to give way). The oracle's "live" for them says a
 * player with the levers could keep them going, not that the game must: so a stall there isn't a mismatch. What is: a
 * break, waiting on points, standing unsaid, a wrong card, and running where no way of setting the levers could.
 */

/**
 * A disagreement:
 * - **stalls-live**: the oracle says every train can keep running, and the game said one stuck. ":siding": only by
 *   a train turning at an end that isn't one of its stops (into a siding, a platform, behind another: to let one by).
 * - **starves-live**: the same, but a train just stood or crawled (under its floor of stops), said or not.
 * - **silent-dead**: the oracle says they can't all keep running, a train stood, and the game said nothing (not stuck,
 *   nor held by its line for want of room: that card says the line is full).
 * - **beats-oracle**: the oracle says they can't, and every train ran: the oracle's model is off for this layout.
 * - **waits-on-points**: a train said stuck, standing on points.
 * - **wrong-card**: "too many trains for these signals. Add a signal", where no signal would help (dead without them too).
 * - **break:…**: a train invariant broke (all but heldFree, the booking core in shadow).
 */
export type Mismatch = "stalls-live" | "stalls-live:siding" | "starves-live" | "silent-dead" | "beats-oracle" | "waits-on-points" | "wrong-card" | `break:${string}`;

export interface Judged {
  id: string;
  verdict: Verdict;
  oracle: { best: number; n: number; states: number; own?: number; noSignals?: number; free?: number };
  /** The game: stops per train (hand-run: −1), how far each ran (m), a stall said (and when, s), why each was stuck. */
  game: { stops: number[]; ran: number[]; stallAt: number; why: (string | null)[]; room: boolean[]; broke: string[]; heldFree: number };
  mismatches: Mismatch[];
  seconds: number;
  ms: number;
  /** Of which building and the oracle's first search took. */
  oracleMs: number;
}

const isSwitch = (layout: Layout, p: number) => {
  const piece = layout.getPiece(p);
  return !!piece && getPieceDef(piece.type, piece.flipped).paths.length > 1;
};

/** In the run's second half (still running, not just at the start): stops a routed train must make, metres a hand-run one must run. */
const FLOOR_STOPS = 1;
const FLOOR_RUN_M = 2;
const MAX_STATES = 60_000;

export function judge(c: Case): Judged {
  const t0 = performance.now();
  const layout = new Layout();
  const { scenario, topo } = scenarioOf(c);
  const h = new HarnessRun(layout, scenario);
  const seconds = secondsOf(c, topo() ?? undefined);
  const n = h.engines.length;
  const start = oTrains(h);
  const signals = layout.signalCount > 0;
  const o: OracleResult = oracle(layout, start, "any", MAX_STATES, signals);
  const noSig = signals && o.best < n ? oracle(layout, start, "any", MAX_STATES) : undefined;
  // (With hand-run trains: they take points as set (the verdict), or any way (`free`: no one throws them for a hand-run
  // train, but the game does to give way). The game must fall between: running where they could as set, and not
  // running where they couldn't any way.)
  const hand = start.some((t) => !t.stops);
  const free = hand ? oracle(layout, start, "any", MAX_STATES, signals, true) : o;
  const verdict: Verdict = o.capped ? "unknown" : o.best === n ? "live" : o.best === 0 ? "dead" : "partial";

  const tOracle = performance.now() - t0;
  const ran = h.engines.map(() => 0);
  // (At half time: stops and metres so far, so the floors count the second half.)
  let half: { stops: number[]; ran: number[] } | null = null;
  let stallAt = -1;
  let addSignalCard = false;
  let onPoints = false;
  let report = h.run(0);
  const step = 1;
  // (Once a stall is said, 20 s more show what follows (a wait on points, a break); then the outcome is known.)
  let ranFor = seconds;
  for (let s = 0; s < seconds; s += step) {
    if (stallAt >= 0 && s > stallAt + 20) {
      ranFor = s;
      break;
    }
    report = h.run(step);
    if (!half && s >= seconds / 2 && stallAt < 0) half = { stops: [...report.arrivals], ran: [...ran] };
    h.engines.forEach((engine, k) => {
      const tr = h.sim.findCar(engine)?.train;
      if (!tr) return;
      ran[k] += (Math.abs(tr.speed) * step) / 1000;
      const st = h.stalls.stuckOf(engine);
      // (The "Add a signal" card: too many trains for the signals, not two facing each other between them.)
      if (st?.kind === "signals" && !st.headOn) addSignalCard = true;
      if (st) {
        if (stallAt < 0) stallAt = s + step;
        // (Not one put down there that never moved: "standing on points at the start" is the player's doing.)
        if (Math.abs(tr.speed) < 1 && ran[k] > 0.3 && tr.bogies.some((b) => isSwitch(layout, b.pieceId))) onPoints = true;
      }
    });
  }
  const routed = h.engines.map((e) => h.routes.has(e));
  const stops = report.arrivals.map((a, k) => (routed[k] ? a : -1));
  const mid = half ?? { stops: report.arrivals.map(() => 0), ran: ran.map(() => 0) };
  // (Under its floor: in the second half, or (the run cut short by a stall) said stuck or held for room now.)
  const belowAt = h.engines.map((e, k) =>
    stallAt >= 0 ? !!h.stalls.stuckOf(e) || h.sections.heldForRoom(e) : routed[k] ? report.arrivals[k] - mid.stops[k] < FLOOR_STOPS : ran[k] - mid.ran[k] < FLOOR_RUN_M,
  );
  const below = belowAt.some(Boolean);
  // (Told: a train under its floor said stuck, or held by its line for want of room: its card says the line is full.)
  const told = h.engines.every((e, k) => !belowAt[k] || !!h.stalls.stuckOf(e) || h.sections.heldForRoom(e));
  const broke = INVARIANTS.filter((k) => k !== "heldFree" && report.broke[k].count > 0).map((k) => `${k}: ${report.broke[k].first[0] ?? ""}`);
  const stalled = report.stalls.begun > 0;

  // (Own ends: a routed train turning only at its own stops' ends, not ducking into a siding to let another by.)
  const own = verdict !== "live" || stalled ? oracle(layout, start, "own", MAX_STATES, signals) : undefined;
  const mismatches: Mismatch[] = [];
  if (verdict === "live" && hand) {
    // (The player's: see above.)
  } else if (verdict === "live") {
    if (stalled) mismatches.push(own && own.best < n ? "stalls-live:siding" : "stalls-live");
    else if (below) mismatches.push("starves-live");
  } else if (verdict === "dead" || verdict === "partial") {
    if (below && !told) mismatches.push("silent-dead");
    if (!below && !(free.best === n && !free.capped)) mismatches.push("beats-oracle");
  }
  if (onPoints) mismatches.push("waits-on-points");
  if (addSignalCard && noSig && noSig.best < n) mismatches.push("wrong-card");
  for (const k of INVARIANTS) if (k !== "heldFree" && report.broke[k].count > 0) mismatches.push(`break:${k}`);

  return {
    id: c.id,
    verdict,
    oracle: { best: o.best, n, states: o.states, own: own?.best, noSignals: noSig?.best, free: hand ? free.best : undefined },
    game: { stops, ran: ran.map((x) => Math.round(x * 10) / 10), stallAt, why: report.stalls.why, room: h.engines.map((e) => h.sections.heldForRoom(e)), broke, heldFree: report.broke.heldFree.count },
    mismatches,
    seconds: ranFor,
    ms: Math.round(performance.now() - t0),
    oracleMs: Math.round(tOracle),
  };
}
