/**
 * The routing cases (docs/agents/routing-cases.md): every combination worth a look of track, signals, trains, where
 * they're put down and where they stop, generated, not picked by hand. Each is a small layout a player could lay; the
 * dispatcher oracle (oracle.ts) says whether its trains can keep running under the game's rules, and the game must
 * agree (judge.ts). Test-only.
 *
 * Families:
 * - **trains**: each track with 1 train up to one more than it has room for, the same way or opposed, on one line, each
 *   its own, hand-run, or a routed one among hand-run ones; put down spread out, stopping at the ends.
 * - **signals**: lines and rings with a pair of signals, a pair at each cut for 2, 3 and 4 blocks, single one-way signals,
 *   pairs at both ends of each loop road, a pair inside a loop's main road (issue #31), a pair just before points; two
 *   trains and three.
 * - **placement**: nose to tail, facing each other, one standing on points, one straddling a signal.
 * - **stops**: mid-line, in a loop's side road, beyond points (a siding, a branch, a platform, the other track).
 * - **lengths**: an engine alone, and a train too long for a loop's main road.
 * - **the user's ring**: two trains the same way round a ring in three blocks (a must-pass), and its dead variants.
 * - **fuzz**: one or more of the long fuzz's stalled seeds from each of its groups (docs/agents/stalls-verify-2026-11-10.md).
 */
import { connectorRef, pieceOfRef, type Layout } from "../../track";
import type { CarKind } from "../../sim";
import type { Scenario, TrainSpec } from "../harness";
import { fuzz } from "../scenarios";
import { TOPOLOGIES, type StopKind, type Topo } from "./topologies";

export type SignalKind = "none" | "pair" | "blocks2" | "blocks3" | "blocks4" | "oneway3" | "loopEnds" | "inLoop" | "beforePoints";
export type Lines = "one" | "own" | "hand" | "mix";
export type Dir = "same" | "opposed";
export type Placement = "spread" | "tail" | "facing" | "points" | "straddle";
export type Length = "short" | "normal" | "long";

export interface Case {
  id: string;
  family: "trains" | "signals" | "placement" | "stops" | "lengths" | "ring" | "fuzz";
  topo: string;
  stops: StopKind;
  signals: SignalKind;
  n: number;
  dir: Dir;
  lines: Lines;
  place: Placement;
  length: Length;
  /** A long fuzz seed (family "fuzz": its own layout and trains). */
  seed?: number;
}

const CARS: Record<Length, CarKind[]> = {
  short: ["engine"],
  normal: ["engine", "timber", "timber"],
  long: ["engine", "timber", "timber", "timber", "timber", "timber"],
};

/** The most trains each track is tried with: one more than it can hold running, by rule of thumb (a line: its loops + 2 ends; a ring: its loops + 2). */
const MAX_N: Record<string, number> = {
  line0: 2,
  line1: 3,
  line2: 3,
  line3: 3,
  siding: 3,
  "line1+siding": 3,
  "siding-spare": 3,
  "line1+siding-spare": 3,
  "terminus-spare": 3,
  "wye-spare": 3,
  "branch-spare": 3,
  ring0: 3,
  ring1: 3,
  ring2: 3,
  branch: 3,
  terminus: 3,
  wye: 3,
  double: 3,
  crossing: 2,
};

const name = (c: Omit<Case, "id">): string =>
  c.seed !== undefined
    ? `fuzz seed ${c.seed}`
    : [c.topo, `${c.n}×${c.lines}`, c.n > 1 ? c.dir : "", c.place !== "spread" ? c.place : "", c.signals !== "none" ? `sig:${c.signals}` : "", c.stops !== "ends" ? `stops:${c.stops}` : "", c.length !== "normal" ? c.length : ""]
        .filter(Boolean)
        .join(" ");

/** The long fuzz's stalled seeds, a few from each group (stalls-verify report): no loop, one loop, own lines, head on, the game's own. */
export const FUZZ_SEEDS = [7, 94, 19, 37, 34, 136, 149, 91, 42, 77, 190, 161, 111, 126, 165, 125, 60, 189];

export function allCases(): Case[] {
  const out: Case[] = [];
  const seen = new Set<string>();
  const add = (c: Omit<Case, "id">) => {
    const id = name(c);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, ...c });
  };
  const base = { stops: "ends" as StopKind, signals: "none" as SignalKind, place: "spread" as Placement, length: "normal" as Length };
  // The user's ring: two trains the same way round a ring in three blocks; three, and two facing, can't.
  for (const signals of ["blocks3", "oneway3"] as SignalKind[])
    for (const lines of ["one", "own", "mix"] as Lines[]) {
      add({ family: "ring", topo: "ring0", n: 2, dir: "same", lines, ...base, signals });
      add({ family: "ring", topo: "ring0", n: 3, dir: "same", lines, ...base, signals });
      add({ family: "ring", topo: "ring0", n: 2, dir: "opposed", lines, ...base, signals });
    }
  // Trains: every track, 1 train up to one too many, every way of running them.
  for (const topo of Object.keys(TOPOLOGIES))
    for (let n = 1; n <= MAX_N[topo]; n++)
      for (const dir of n === 1 ? (["same"] as Dir[]) : (["same", "opposed"] as Dir[]))
        for (const lines of n === 1 ? (["one", "hand"] as Lines[]) : n === 2 ? (["one", "own", "hand", "mix"] as Lines[]) : (["one", "mix"] as Lines[])) add({ family: "trains", topo, n, dir, lines, ...base });
  // Signals: on lines and rings, two trains (and three where three fit), the same way and opposed.
  const sigs: SignalKind[] = ["pair", "blocks2", "blocks3", "blocks4", "oneway3", "loopEnds", "inLoop", "beforePoints"];
  for (const topo of ["line0", "line1", "ring0", "ring1"])
    for (const signals of sigs) {
      if ((signals === "loopEnds" || signals === "inLoop" || signals === "beforePoints") && topo.endsWith("0")) continue;
      if (signals === "blocks4" && topo.startsWith("line")) continue;
      for (const n of topo === "line0" ? [2] : [2, 3])
        for (const dir of ["same", "opposed"] as Dir[]) for (const lines of n === 2 && dir === "same" ? (["one", "own"] as Lines[]) : (["one"] as Lines[])) add({ family: "signals", topo, n, dir, lines, ...base, signals });
    }
  // Placement.
  for (const topo of ["line0", "line1", "ring0", "ring1"])
    for (const place of ["tail", "facing", "points", "straddle"] as Placement[]) {
      if (place === "points" && topo === "ring0") continue;
      for (const lines of ["one", "hand"] as Lines[]) add({ family: "placement", topo, n: 2, dir: place === "facing" ? "opposed" : "same", lines, ...base, place, signals: place === "straddle" ? "blocks3" : "none" });
    }
  // Stops.
  const stopsOf: [string, StopKind][] = [
    ["line1", "mid"],
    ["line1", "loop"],
    ["line2", "mid"],
    ["line2", "loop"],
    ["siding", "far"],
    ["line1+siding", "far"],
    ["branch", "far"],
    ["terminus", "far"],
    ["wye", "far"],
    ["double", "far"],
  ];
  for (const [topo, stops] of stopsOf)
    for (const n of [1, 2])
      for (const lines of n === 1 ? (["one"] as Lines[]) : (["one", "own"] as Lines[]))
        for (const dir of n === 1 ? (["same"] as Dir[]) : (["same", "opposed"] as Dir[])) add({ family: "stops", topo, n, dir, lines, ...base, stops });
  // Lengths.
  for (const topo of ["line1", "line2", "ring1"]) for (const length of ["short", "long"] as Length[]) add({ family: "lengths", topo, n: 2, dir: "opposed", lines: "one", ...base, length });
  for (const seed of FUZZ_SEEDS) add({ family: "fuzz", topo: "fuzz", n: 0, dir: "same", lines: "one", ...base, seed });
  return out;
}

/** Up to `n` joints spread evenly along `joints`, as a ring is cut into `n` blocks (a line into n + 1 needs n). */
function spread(joints: number[], n: number): number[] {
  if (n <= 0 || joints.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(joints[Math.floor(((i + 0.5) * joints.length) / n)]);
  return [...new Set(out)];
}

/** Signals: a pair (a post each way, as the tray drops them) on each joint, or one post facing the main way. */
function lay(layout: Layout, refs: number[], pairs: boolean): void {
  for (const ref of refs) {
    layout.addSignal(ref);
    if (pairs) {
      const other = layout.joinedConnector(ref);
      if (other !== -1) layout.addSignal(other);
    }
  }
}

function laySignals(layout: Layout, t: Topo, kind: SignalKind): number[] {
  const cuts = (blocks: number) => spread(t.joints, t.ring ? blocks : blocks - 1);
  let refs: number[] = [];
  let pairs = true;
  if (kind === "pair") refs = spread(t.joints, 1);
  else if (kind === "blocks2") refs = cuts(2);
  else if (kind === "blocks3") refs = cuts(3);
  else if (kind === "blocks4") refs = cuts(4);
  else if (kind === "oneway3") {
    refs = cuts(3);
    pairs = false;
  } else if (kind === "loopEnds") refs = t.loopEnds;
  else if (kind === "inLoop") refs = t.inLoop;
  else if (kind === "beforePoints" && t.beforePoints !== null) refs = [t.beforePoints];
  lay(layout, refs, pairs);
  return refs;
}

/** Where each train goes on `places`: the indexes, and which run forward. */
function placeAt(c: Case, t: Topo, cuts: number[]): { i: number; forward: boolean; alt?: boolean }[] {
  const P = t.places.length;
  const dirOf = (k: number) => (c.dir === "same" ? true : k % 2 === 0);
  if (c.place === "tail") return Array.from({ length: c.n }, (_, k) => ({ i: Math.min(P - 1, 1 + 2 * k), forward: true }));
  if (c.place === "facing") return [{ i: Math.floor(P / 2) - 2, forward: true }, { i: Math.floor(P / 2) + 1, forward: false }].slice(0, c.n);
  if (c.place === "straddle") {
    // (The first train put down just past a cut, its tail back over the joint; the rest spread.)
    const cut = cuts[0];
    const after = cut === undefined ? 1 : t.places.indexOf(pieceOfRef(cut)) + 1;
    const out = [{ i: Math.min(P - 1, after), forward: true }];
    for (let k = 1; k < c.n; k++) out.push({ i: (after + Math.floor((k * P) / c.n)) % P, forward: dirOf(k) });
    return out;
  }
  // (Spread: evenly along, at least a piece apart; trains of a second route on the other line where there is one.)
  if (t.alt && (c.stops === "far" || c.topo === "crossing" || c.topo === "double") && c.lines !== "one")
    return Array.from({ length: c.n }, (_, k) => ({ i: k % 2 === 0 ? 1 : 1, forward: dirOf(k), alt: k % 2 === 1 }));
  return Array.from({ length: c.n }, (_, k) => ({ i: Math.min(P - 1, Math.floor(((k + 0.5) * P) / c.n)), forward: dirOf(k) }));
}

/** How long a case runs (game s): long enough for a stall to be said (`STARVED_S`, 120 s) and a few trips end to end. */
export function secondsOf(c: Case, t?: Topo): number {
  if (c.seed !== undefined) return 300;
  const pieces = t ? t.places.length * 1.5 : 20;
  return Math.max(150, Math.round(pieces * 2 * 3));
}

export function scenarioOf(c: Case): { scenario: Scenario; topo: () => Topo | null; cuts: () => number[] } {
  if (c.seed !== undefined) return { scenario: fuzz(c.seed, secondsOf(c)), topo: () => null, cuts: () => [] };
  let topo: Topo | null = null;
  let cuts: number[] = [];
  const scenario: Scenario = {
    name: c.id,
    seconds: 0,
    heldFree: true,
    build: (layout) => {
      const t = TOPOLOGIES[c.topo](layout, c.stops);
      topo = t;
      cuts = laySignals(layout, t, c.signals);
      const route = t.stops[c.stops] ?? t.stops.ends!;
      const at = placeAt(c, t, cuts);
      const trains: TrainSpec[] = at.map((a, k) => {
        const line = a.alt ? t.alt! : t;
        const i = Math.max(0, Math.min(line.places.length - 1, a.i));
        const fwd = line.fwd[i];
        // (Hand-run: no route. Mix: the first routed, the rest hand-run. Own: each its own line, same stops.)
        const hand = c.lines === "hand" || (c.lines === "mix" && k > 0);
        const stops = a.alt ? t.stops.far : route;
        const piece = c.place === "points" && k === 0 && t.points !== null ? t.points : line.places[i];
        return {
          pieceId: piece,
          reversed: a.forward ? !fwd : fwd,
          s: c.place === "straddle" && k === 0 ? 40 : undefined,
          cars: CARS[c.length],
          stops: hand ? undefined : stops,
          // (Heading the way it faces: its next stop the one ahead, the route's last going forward.)
          next: a.forward ? 1 : 0,
          line: hand ? undefined : c.lines === "one" || c.lines === "mix" ? 1 : undefined,
          optional: true,
        };
      });
      return { trains };
    },
  };
  return {
    scenario,
    topo: () => topo,
    cuts: () => cuts,
  };
}

export { connectorRef };
