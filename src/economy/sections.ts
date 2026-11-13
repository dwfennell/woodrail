import { connectorRef, getPieceDef, indexOfRef, offersChoice, pathLength, pathLengthOf, pieceOfRef, pointsWayFrom, type Layout } from "../track";
import { ACCELERATION, ADV_OK, advanceCursor, CAR_SPECS, COUPLER_GAP, createAdvance, flipCursor, SIM_HZ, stopDistance, trainOn, type Cursor, type Sim, type Train } from "../sim";
import { next, SEARCH, walkOn, waysFrom } from "../routing/graph";
import { plan, planWay, type KeepTest } from "../routing/plan";
import type { AvoidTest } from "../routing/router";
import { deadEndsOf, mouthWay } from "../routing/dead-ends";
import { engineOf, trainLength } from "../sim/train-cars";

/**
 * Sections and slots: trains that wait for each other on single track (token working; a line's own, and lines sharing
 * track). See
 * docs/superpowers/specs/2026-10-20-crossing-rethink.md.
 *
 * - **Slots** are places a train can stand without blocking anyone: each road of a passing loop (both roads long
 *   enough for the line's longest train, neither switch pinned), and each line end: the track from a buffer (or an
 *   open end) back to the first switch. On a line with no switch at all, each end up to and including its first stop.
 *   A slot holds one train.
 * - **Sections** are the rest: the track between slots (the switches too), each a connected stretch.
 * - **A move**: a train in a slot comes up to the slot's end (its front about to leave it) and asks for the section
 *   ahead and a slot at its far end. It's granted only if no other train of its line holds that section or stands in
 *   it, and the far slot has room: no train of the line on it or on its way to it, and, for a loop road, the loop's other
 *   road isn't held by a train going out the same way (a loop holds two trains only when they pass). Otherwise it
 *   stands at the slot's end (short of the switch) and asks again. The section is let go once the train's tail is out
 *   of it. Stops in a section are called at inside the move.
 * - **Turning** happens only in slots: trains turn back only at line ends (the sim's buffers), which are slots; a granted
 *   move never meets a train of its line head on, and nothing here turns a train. A wait that can't end (a ring, a
 *   line over room whose held train is in the way) is never broken by turning a train back (routing spec §16 Q3): the
 *   trains stand, and economy/stalls.ts says why on their cards.
 * - **Room rule**: a line takes one train more than it has passing loops on its way (a loop per extra train), and one
 *   more again once it has a loop where both its ends fit its longest train (each end waits a train: 3 trains on one
 *   loop). The rest are held (never sent into a section), with the reason (`waitOf`: kind "room", and how many loops to
 *   lay).
 * - **A train in a section with no move** (put down there, a loaded game, a second train joining the line) asks for
 *   the rest of its way to the slot ahead; it waits only for a train of its line on that way, or coming the other way.
 * - **Lines sharing track** (single-line working across lines, routing spec §16 Q3 follow-up): lines whose ways run
 *   through a slot or section in common are one network (`network`). Their trains share one topology (for the longest
 *   of them) and each asks for its moves among them all (`LineInfo.users`), so two lines' trains never meet head on in a
 *   section: they meet at a passing loop, each on its own road, as one line's do. A line of one train is managed then
 *   too. The room rule stays each line's own (its trains, its loops). A train on no line with its lever on, on such a
 *   network, works it as well (`LineInfo.loose`), going the way the points lie: it's sent only onto the road its points
 *   lie for, and a line's train meeting it at a loop takes the other road (`restRoad`).
 * - **A lone train** (or a line with no slot on its way, alone on its network) is left alone: the cost is a map lookup,
 *   and it runs exactly as without sections.
 *
 * Cost: slots and sections are worked out once per layout revision (and routing version, and road length). Per tick,
 * a train of a managed line costs a few lookups: what's ahead of it is worked out again only when its front comes onto
 * another piece, and a waiting train asks again every `CHECK_TICKS`.
 */

/** A dead end a train's way was found to go into, free, stays its claim this long (ticks) unless it asks again. */
const CLAIM_TICKS = 3 * 12;
/** How far ahead (mm) a train in a section looks for points to stand short of (`edgeAhead`). */
const EDGE_LOOK = 600;
/** A waiting train stands this far (mm) short of the end of its slot. */
export const STAND_SHORT = 6;
/** A loop road must be this much (mm) longer than a train for the train to stand on it, clear of both switches. */
export const ROAD_MARGIN = 2 * STAND_SHORT;
/** A train asks for its move this far (mm) before it would start to brake for the slot's end. */
const ASK_LOOK = 24;
/** A train waiting this long (s) at its slot's end keeps what it waits for from later askers (`firstCome`). */
export const FIRST_COME_S = 10;
/** How long (sim ticks, 2 s) `convoy` keeps a probe's "no slot that way" for the same train, signal, stop and points. */
const PROBE_KEEP = 240;
/** How often (sim ticks) a waiting train asks again. */
export const CHECK_TICKS = 12;
/** How far ahead (pieces) a hand-run train coming onto a line's track works its single track from (`comesInto`). */
const COMES_INTO = 3;
/** Every switch as it lies: the one way a train with no route runs through it. */
const LIES = () => true;
/** How long (s) a line's train waits for a line-mate going its way before a signal is suggested (signals spec §7). */
export const FOLLOW_HINT_S = 20;

/**
 * A slot (see the header): a loop road, a line end, or a signal's waiting point (signals spec §3.2): the plain track in
 * front of a signal the player placed, back to the next signal or points (`signalSlots`). Trains going a signal's way
 * stop there (`ways`: its `out` end is the far side of the signal's joint), if they fit; a pair of signals makes it a
 * waiting point both ways. Trains going against every signal of it, or too long for it, run through it with what's
 * either side as one move (`Way.through`).
 */
export interface Slot {
  id: number;
  kind: "road" | "end" | "signal";
  /** For a road: its loop (index in `Topology.loops`) and which road; −1 for a line end. */
  loop: number;
  road: number;
  pieces: ReadonlySet<number>;
  length: number;
  /** A waiting point's: the signal's joint end (`Signal.at`), the end past it (a connector ref), and its back end, the
   * end of its last piece trains going its way come in by. −1 for other slots. */
  mark?: number;
  out?: number;
  back?: number;
  /** A waiting point's ways in, one per mark it waits trains for (the first is `mark`/`out`/`back`). */
  ways?: SignalWay[];
}

export interface Loop {
  a: number;
  b: number;
  roads: [number, number];
  /**
   * The roads (slot ids) a train coming in at `a`, and at `b`, may be sent onto to pass. A pinned switch sends every
   * train coming at it from its stem one way; trains coming in at the other end then keep to the other road, else the
   * two would meet on the one road with no way round (see `findLoops`).
   */
  into: [number[], number[]];
}

export interface Topology {
  slots: Slot[];
  loops: Loop[];
  slotOf: ReadonlyMap<number, number>;
  sectionOf: ReadonlyMap<number, number>;
  sections: number;
  /** Loops pinned so every train takes the same road (no passing place, see `findLoops`): their pieces. */
  pinnedLoops: { a: number; b: number; pieces: number[] }[];
}

/** Why a train is held (for its card, later). */
export type BlockWait =
  /** Its section is held, or stood in, by that train of its line. */
  | { kind: "section"; engine: number }
  /** The slot ahead (a loop road, a line end) is full or on another's way: waiting for that train. */
  | { kind: "slot"; engine: number }
  /** The line has more trains than places to pass: `trains`, `loops` passing loops; lay `more` more (or take a train off). */
  | { kind: "room"; lineId: number; trains: number; loops: number; more: number; spare: boolean; parked: boolean; other: boolean; pinned: boolean }
  /** That train of its line was put down facing it in the same slot: each waits on the other (a stall: see stalls.ts). */
  | { kind: "facing"; engine: number };

/** What sections read of the economy. */
export interface SectionsHost {
  /** The line an engine runs (−1: none). */
  lineOf(engine: number): number;
  /** The engines of a line on the track now (not derailed), in a steady order. */
  live(lineId: number): readonly number[];
  /** The stop piece a routed engine steers for now (−1: none). */
  target(engine: number): number;
  /** The pieces of a line's stops (for counting its loops), and a key that changes when they do. */
  stopPieces(lineId: number): readonly number[];
  /** The net drive of a train toward its front (only the sign matters). */
  drive(train: Train): number;
  /** Move an engine's route on past its stops on these pieces (they can't be reached now). */
  skipStops(engine: number, pieces: ReadonlySet<number>): void;
  /** Are these two pieces tracks of the same depot (a depot of several tracks)? A train there calls at its stop. */
  sameDepot?(a: number, b: number): boolean;
  /** The way points lie once trains have passed (the router's default; as they lie now if not given). */
  restsAt?(pieceId: number): number;
  /**
   * A routed engine's aims round one lap from its aim now (`target` first): the stops and via points it heads for, in
   * order (see `circling`). Without it, its `target` alone.
   */
  lap?(engine: number): readonly number[];
  /** The ways a routed engine's line keeps (stickiness: the router's `ways`), so a move is granted the way it'll take. */
  keep?(engine: number): KeepTest | undefined;
}

/** One step of a move's way: a piece, the path along it, and the end it comes in by. */
interface Step {
  pieceId: number;
  path: number;
  entry: number;
}

interface Move {
  /** The sections it holds (more than one when it runs through a loop that's no passing place: see `Way.through`). */
  sections: number[];
  /** The slot it goes to (−1: a move with no slot at its end, let go). */
  dest: number;
  /** For a loop road: the switch it leaves the loop by (−1: n/a). */
  outBy: number;
  steps: Step[];
  /** Pieces and paths of its way (steering's `follow`), and a piece beyond them to aim at. */
  follow: AvoidTest;
  aim: number;
  /** When (sim tick) it was granted. */
  since: number;
  /** Loop roads it runs through without stopping (a loop whose other road holds a train with no room). */
  through: number[];
}

/**
 * A way's `dest` when it ends at a dead end: short of a train its line has no room for (or a loop both of whose roads
 * such trains hold). Never granted: the train waits where it is for the held one (`deadEndWait`), and its stops beyond
 * (`Way.deadEnd`) can't be reached while the line is full (`unreachable`).
 */
const DEAD_END = -2;
/** How far on (pieces) a train whose front is off another's way is followed, to see if it comes onto it head on (`sameWayAhead`). */
const FOLLOW_LOOK = 48;

/** `Sections.circling`'s walk: whether it circles, and the piece ends (piece × 8 + end) it comes in by and goes out by. */
interface Circuit {
  yes: boolean;
  ins: ReadonlySet<number>;
  outs: ReadonlySet<number>;
}
const NOT_CIRCLING: Circuit = { yes: false, ins: new Set(), outs: new Set() };
const NO_AIMS: readonly number[] = [];

/** A way through a section (`Sections.wayOn`): its steps, the slot it ends at (or −1: full; `DEAD_END`), and why not. */
interface Way {
  steps: Step[];
  sections: number[];
  through: number[];
  dest: number;
  outBy: number;
  blockedBy: number;
  deadEnd?: ReadonlySet<number>;
  /** Stopped at a dead end's mouth (another train in there): it may come up to the points outside, and stand short. */
  mouth?: boolean;
}

interface TrainState {
  engine: number;
  trainId: number;
  /** Its front's piece, path and way, as last looked (`-1`: not yet). */
  frontKey: number;
  tailPiece: number;
  /** Where its front is: a slot id, or −1 in a section. */
  slot: number;
  /** In a slot: how far (mm) from the end of its front piece to where it stands short of the slot's end (Infinity: no end ahead). */
  beyond: number;
  /** The piece just past its slot's end, and the end it's entered by. */
  exitPiece: number;
  exitEntry: number;
  move: Move | null;
  wait: BlockWait | null;
  askedAt: number;
  waitSince: number;
  /** The switch it leaves its loop road by (it stands in, or was put down in, a loop road), −1 if not known. */
  outBy: number;
  /** The topology its slot and move are on (another: worked out afresh). */
  topo: Topology;
  /** In a slot: the pieces from its front on to the slot's end (to see a train put down facing it). */
  ahead: Set<number>;
  /** When it last looked for a train facing it, and whether it's holding for one. */
  facedAt: number;
  faceHold: boolean;
  /** What lay past its last dead end (its stops there can't be reached while the line is full). */
  lastDead: ReadonlySet<number> | null;
  /** In a section: how far (mm) past its front's piece the next points or crossing ahead begin (Infinity: none near). */
  edge: number;
  /** The front (`frontKey`) it last asked from as it came up to them. */
  nearAsked: number;
  /** A dead end its way goes into, found free (−1: none), and when: going in, it's in there for others (`inDeadEnd`). */
  claim: number;
  claimAt: number;
}

// --- Topology ---------------------------------------------------------------------------------------------------

const NONE_PINNED = () => false;
const MAX_ROAD = 40;

const lengthOfPath = pathLengthOf;

function roadTo(layout: Layout, pieceId: number, exit: number): { switchId: number; entry: number; pieces: number[]; length: number } | null {
  const pieces: number[] = [];
  let length = 0;
  let at = next(layout, pieceId, exit);
  for (let k = 0; at && k < MAX_ROAD; k++) {
    if (at.pieceId === pieceId) return null;
    const piece = layout.getPiece(at.pieceId);
    if (!piece) return null;
    const def = getPieceDef(piece.type, piece.flipped);
    if (def.isSwitch) return { switchId: at.pieceId, entry: at.entry, pieces, length };
    const ways = waysFrom(layout, at.pieceId, at.entry, NONE_PINNED);
    if (ways.length !== 1) return null;
    pieces.push(at.pieceId);
    length += pathLength(def.paths[ways[0].path].geom);
    at = next(layout, at.pieceId, ways[0].exit);
  }
  return null;
}

/**
 * Passing loops a train of `minRoad` mm fits in: both roads long enough, and trains coming at it from each end able
 * to take different roads. A pinned switch sends a train coming at it from its stem onto the one road it's set to:
 * both switches pinned to the same road, every train runs through by that one road (no passing: listed in `pinned`
 * instead); pinned to opposite roads, it's a one-way loop, each way its own road, and passes as well as any. One
 * pinned, the other free: trains in at the free end keep to the other road (`into`), so it's one-way too.
 */
function findLoops(layout: Layout, minRoad: number, pinned: { a: number; b: number; pieces: number[] }[] = []): { a: number; b: number; roads: [number[], number[]]; lengths: [number, number]; into: [number[], number[]] }[] {
  const out: { a: number; b: number; roads: [number[], number[]]; lengths: [number, number]; into: [number[], number[]] }[] = [];
  const seen = new Set<string>();
  const used = new Set<number>();
  for (const id of layout.pieceIds()) {
    const piece = layout.getPiece(id)!;
    const def = getPieceDef(piece.type, piece.flipped);
    if (!def.isSwitch) continue;
    for (let stem = 0; stem < def.connectors.length; stem++) {
      const ways = waysFrom(layout, id, stem, NONE_PINNED);
      for (let i = 0; i < ways.length; i++)
        for (let j = i + 1; j < ways.length; j++) {
          const r1 = roadTo(layout, id, ways[i].exit);
          const r2 = roadTo(layout, id, ways[j].exit);
          if (!r1 || !r2 || r1.switchId !== r2.switchId || r1.switchId === id || r1.entry === r2.entry) continue;
          const w1 = waysFrom(layout, r1.switchId, r1.entry, NONE_PINNED);
          const w2 = waysFrom(layout, r2.switchId, r2.entry, NONE_PINNED);
          if (!w1.some((x) => w2.some((y) => y.exit === x.exit))) continue;
          const key = `${Math.min(id, r1.switchId)}:${Math.max(id, r1.switchId)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (r1.pieces.length === 0 || r2.pieces.length === 0 || r1.length < minRoad || r2.length < minRoad) continue;
          // (Which roads a train coming in at each end can take: a pinned switch, only the one it's set to.)
          const intoA = new Set<number>([0, 1]);
          if (layout.isPinned(id)) {
            const set = waysFrom(layout, id, stem)[0];
            intoA.clear();
            if (set?.exit === ways[i].exit) intoA.add(0);
            if (set?.exit === ways[j].exit) intoA.add(1);
          }
          const intoB = new Set<number>([0, 1]);
          const stemB = w1.find((x) => w2.some((y) => y.exit === x.exit))!.exit;
          if (layout.isPinned(r1.switchId)) {
            const set = waysFrom(layout, r1.switchId, stemB)[0];
            intoB.clear();
            if (set?.exit === r1.entry) intoB.add(0);
            if (set?.exit === r2.entry) intoB.add(1);
          }
          // (One end pinned, the other free: trains in at the free end keep to the road the pinned end doesn't send
          // its trains onto. Trailing through a pinned switch is fine (a train from the far road runs through it, as
          // through any switch, whichever way it's set): only the road a train is sent onto matters.)
          if (intoA.size === 1 && intoB.size === 2) intoB.delete([...intoA][0]);
          if (intoB.size === 1 && intoA.size === 2) intoA.delete([...intoB][0]);
          if (![...intoA].some((x) => [...intoB].some((y) => y !== x))) {
            pinned.push({ a: id, b: r1.switchId, pieces: [id, r1.switchId, ...r1.pieces, ...r2.pieces] });
            continue;
          }
          if ([...r1.pieces, ...r2.pieces].some((p) => used.has(p))) continue;
          for (const p of [...r1.pieces, ...r2.pieces]) used.add(p);
          out.push({ a: id, b: r1.switchId, roads: [r1.pieces, r2.pieces], lengths: [r1.length, r2.length], into: [[...intoA], [...intoB]] });
        }
    }
  }
  return out;
}

/** Does a piece offer a choice of way (a switch, a deck, a lift: `track/points.ts` `offersChoice`)? */
function branches(layout: Layout, pieceId: number): boolean {
  const p = layout.getPiece(pieceId);
  return !!p && offersChoice(getPieceDef(p.type, p.flipped));
}

/** Is a piece a stop (a depot or a station)? */
function isStopPiece(layout: Layout, pieceId: number): boolean {
  const t = layout.getPiece(pieceId)?.type ?? "";
  // (A town's station upgraded in place is a big station's kit: still a stop.)
  return t.startsWith("depot") || t.startsWith("station") || t === "kit-two-platform-station" || t === "kit-grand-terminus" || t.startsWith("kit-grand-central-");
}

function buildTopology(layout: Layout, minRoad: number): Topology {
  const slots: Slot[] = [];
  const loops: Loop[] = [];
  const slotOf = new Map<number, number>();
  const pinnedLoops: { a: number; b: number; pieces: number[] }[] = [];
  for (const l of findLoops(layout, minRoad, pinnedLoops)) {
    const roads: number[] = [];
    l.roads.forEach((pieces, road) => {
      const id = slots.length;
      slots.push({ id, kind: "road", loop: loops.length, road, pieces: new Set(pieces), length: l.lengths[road] });
      for (const p of pieces) slotOf.set(p, id);
      roads.push(id);
    });
    loops.push({ a: l.a, b: l.b, roads: [roads[0], roads[1]], into: [l.into[0].map((r) => roads[r]), l.into[1].map((r) => roads[r])] });
  }
  // Line ends: from each end (a buffer, or an end joined to nothing) back to the first piece with a choice of way.
  for (const id of layout.pieceIds()) {
    if (slotOf.has(id) || branches(layout, id)) continue;
    const piece = layout.getPiece(id)!;
    const def = getPieceDef(piece.type, piece.flipped);
    for (let c = 0; c < def.connectors.length; c++) {
      const buffer = def.paths.some((pa) => pa.to === null && pa.from === c);
      if (!buffer && next(layout, id, c) !== null) continue;
      // Walk in from this end: through this piece to its other end (a buffer: out by the end its path starts at).
      const stretch: number[] = [id];
      const pa0 = def.paths.find((x) => x.from === c || x.to === c);
      let exit0 = -1;
      if (pa0) exit0 = buffer ? c : pa0.from === c ? (pa0.to ?? -1) : pa0.from;
      let at: { pieceId: number; entry: number } | null = next(layout, id, exit0);
      let walledOff = false;
      for (let k = 0; at && k < SEARCH; k++) {
        // (Into the other end's slot of a line with no switch: that's no wall.)
        const there = slotOf.get(at.pieceId);
        if (there !== undefined && slots[there].kind === "end") break;
        if (there !== undefined || branches(layout, at.pieceId) || stretch.includes(at.pieceId)) {
          walledOff = true;
          break;
        }
        stretch.push(at.pieceId);
        const p = layout.getPiece(at.pieceId)!;
        const d = getPieceDef(p.type, p.flipped);
        // (On through the piece: the path from the end it's entered by.)
        const pa = d.paths.find((x) => x.from === at!.entry || x.to === at!.entry);
        const exit = !pa ? -1 : pa.from === at.entry ? (pa.to ?? -1) : pa.from;
        at = next(layout, at.pieceId, exit);
      }
      let pieces = stretch;
      if (!walledOff) {
        // No switch between the two ends (a plain line): this end up to and including its first stop.
        const k = stretch.findIndex((p) => isStopPiece(layout, p));
        pieces = stretch.slice(0, (k === -1 ? 0 : k) + 1);
        // (Too short a line to have two ends apart: no slot.)
        if (pieces.length >= stretch.length) continue;
      }
      if (pieces.length === 0 || pieces.some((p) => slotOf.has(p))) continue;
      const sid = slots.length;
      let length = 0;
      for (const p of pieces) length += lengthOfPath(layout, p, 0);
      slots.push({ id: sid, kind: "end", loop: -1, road: -1, pieces: new Set(pieces), length });
      for (const p of pieces) slotOf.set(p, sid);
    }
  }
  // Signals' waiting points: the plain track between signals (and between a signal and points).
  if (layout.signalCount > 0) signalSlots(layout, slots, slotOf);
  // Sections: the rest, in connected stretches.
  const sectionOf = new Map<number, number>();
  let sections = 0;
  for (const id of layout.pieceIds()) {
    if (slotOf.has(id) || sectionOf.has(id)) continue;
    const s = sections++;
    const stack = [id];
    sectionOf.set(id, s);
    while (stack.length > 0) {
      const at = stack.pop()!;
      const p = layout.getPiece(at)!;
      const d = getPieceDef(p.type, p.flipped);
      for (let c = 0; c < d.connectors.length; c++) {
        const n = next(layout, at, c);
        if (!n || slotOf.has(n.pieceId) || sectionOf.has(n.pieceId)) continue;
        sectionOf.set(n.pieceId, s);
        stack.push(n.pieceId);
      }
    }
  }
  return { slots, loops, slotOf, sectionOf, sections, pinnedLoops };
}

/** A piece that bounds a train's wait in a section: points (a choice of way), a turntable, or a crossing. */
function blockEdge(layout: Layout, pieceId: number): boolean {
  if (branches(layout, pieceId)) return true;
  const p = layout.getPiece(pieceId);
  return !!p && getPieceDef(p.type, p.flipped).paths.length > 1;
}

/**
 * Waiting points (the user, 2026-11-09: "they should just claim to the next signal"): each stretch of plain track
 * between two joints that carry signal marks (or a mark and points), none of it in another slot, is one slot. Each
 * mark whose approach it is gives it a way in (`SignalWay`): a mark facing out of its far end for trains going that way,
 * and, with a pair one each way, the other mark at its near end for trains going the other way. So both signals of a
 * pair are waiting points, and a train's move ends at the next signal it comes to going its way. Its whole length is
 * kept (`Slot.length`): a train that doesn't fit, clear of points, runs through it (`wayOn`) as through a section. One
 * shorter than the shortest train (an engine alone) is no slot: the sim still holds trains at its signals.
 */
function signalSlots(layout: Layout, slots: Slot[], slotOf: Map<number, number>): void {
  // (Joint ends that carry a mark, either side of the joint: a waiting point's track ends there.)
  const marked = new Set<number>();
  for (const m of layout.signals()) {
    marked.add(m.at);
    const o = layout.joinedConnector(m.at);
    if (o !== -1) marked.add(o);
  }
  const found = new Map<string, { ways: SignalWay[]; pieces: number[]; length: number }>();
  const taken = new Map<number, string>();
  for (const m of [...layout.signals()].sort((a, b) => a.id - b.id)) {
    const out = layout.joinedConnector(m.at);
    if (out === -1) continue;
    const pieces: number[] = [];
    let length = 0;
    let id = pieceOfRef(m.at);
    let exit = indexOfRef(m.at);
    let back = -1;
    let ended = false;
    for (let k = 0; k < MAX_ROAD; k++) {
      if (slotOf.has(id) || pieces.includes(id) || branches(layout, id)) {
        ended = pieces.length > 0;
        break;
      }
      const p = layout.getPiece(id);
      if (!p) break;
      const def = getPieceDef(p.type, p.flipped);
      const path = def.paths.find((x) => x.to === exit || (x.from === exit && x.to !== null));
      if (!path || path.to === null) break;
      const entry = path.to === exit ? path.from : path.to;
      pieces.push(id);
      length += pathLength(path.geom);
      back = connectorRef(id, entry);
      const n = next(layout, id, entry);
      // (A buffer or an open end behind it: a line end's, not a waiting point.)
      if (!n) break;
      if (marked.has(back)) {
        ended = true;
        break;
      }
      id = n.pieceId;
      exit = n.entry;
      if (k === MAX_ROAD - 1) ended = true;
    }
    if (!ended || length < SIGNAL_MIN_ROAD) continue;
    const key = [...pieces].sort((a, b) => a - b).join(",");
    const hit = found.get(key);
    if (hit) {
      hit.ways.push({ mark: m.at, out, back });
      continue;
    }
    // (Overlapping another's track without being the same stretch: the later one is a block boundary only.)
    if (pieces.some((p) => taken.has(p))) continue;
    for (const p of pieces) taken.set(p, key);
    found.set(key, { ways: [{ mark: m.at, out, back }], pieces, length });
  }
  for (const f of found.values()) {
    const id = slots.length;
    const w = f.ways[0];
    slots.push({ id, kind: "signal", loop: -1, road: -1, pieces: new Set(f.pieces), length: f.length, mark: w.mark, out: w.out, back: w.back, ways: f.ways });
    for (const p of f.pieces) slotOf.set(p, id);
  }
}

/** The shortest track a waiting point can be: an engine alone, clear of points. */
const SIGNAL_MIN_ROAD = CAR_SPECS.engine.length + 2 * STAND_SHORT;

/** A waiting point's way in for trains going one mark's way (`Slot.ways`). */
export interface SignalWay {
  /** The mark's joint end (`Signal.at`). */
  mark: number;
  /** The end past it (a connector ref), where the train goes out. */
  out: number;
  /** The waiting point's other end, where trains going this way come in. */
  back: number;
}

/** The way of a waiting point a train is in, by the end it goes out by (a connector ref); undefined: none. */
export function signalWayOut(slot: Slot, out: number): SignalWay | undefined {
  return slot.ways?.find((w) => w.out === out);
}

/** A key for the signal marks' places (the topology depends on them: waiting points), cached by `signalsVersion`. */
export function marksKey(layout: Layout): string {
  if (layout.signalCount === 0) return "";
  const hit = marksKeys.get(layout);
  if (hit && hit.v === layout.signalsVersion) return hit.key;
  const key = `|s${[...layout.signals()].map((m) => m.at).sort((a, b) => a - b).join(",")}`;
  marksKeys.set(layout, { v: layout.signalsVersion, key });
  return key;
}
const marksKeys = new WeakMap<Layout, { v: number; key: string }>();

const topoCache = new WeakMap<Layout, { key: string; byRoad: Map<number, Topology> }>();

/** The layout's slots and sections for trains of `trainLength` mm (cached per revision, pins and length). */
export function topologyOf(layout: Layout, trainLength: number): Topology {
  // (Pinned switches, and the way each is set, decide which loops pass: part of the key. There are few.)
  let pins = "";
  for (const id of layout.pinnedIds()) pins += `,${id}:${layout.switchState(id)}`;
  const key = `${layout.revision}${pins}${marksKey(layout)}`;
  let hit = topoCache.get(layout);
  if (!hit || hit.key !== key) topoCache.set(layout, (hit = { key, byRoad: new Map() }));
  // (Bucketed, so trains a few mm apart share one.)
  const minRoad = Math.ceil((trainLength + ROAD_MARGIN) / 16) * 16;
  let t = hit.byRoad.get(minRoad);
  if (!t) hit.byRoad.set(minRoad, (t = buildTopology(layout, minRoad)));
  return t;
}

/** A train's length (mm), buffer face to buffer face (`sim/train-cars.ts`; kept here for its importers). */
export { trainLength };

// --- The controller ---------------------------------------------------------------------------------------------

interface LineInfo {
  engines: readonly number[];
  /**
   * Every train that works the line's single track with it: its own and those of the other lines sharing its network
   * (`network`), each asking for its moves as the line's own do (single-line working across lines). Its own first.
   */
  users: readonly number[];
  /** Of those, the trains on no line with their levers on (by their engines): they go the way the points lie. */
  loose: readonly number[];
  topo: Topology;
  /** Its passing loops (on its stops' ways), and how many trains it takes; admitted engines. */
  loops: number;
  admitted: ReadonlySet<number>;
  managed: boolean;
  /** Loops (indices in the topology) a train with no room stands on a road of: no passing place for the others. */
  blocked: ReadonlySet<number>;
  /** Trains the line has no room for (for cards: how many more loops). */
  more: number;
  /**
   * Every train working its track goes round circuits one way round, none against another (`oneWayRound`): its routed
   * trains may follow each other (`follows`), and the room rule isn't applied.
   */
  oneWay: boolean;
  /** Every other train on the track (not this line's, nor a line's sharing its network): where it stands, it's in the way. */
  foreign: readonly Train[];
  /** A loop of its line has a train not on the line standing on each road: only moving one helps (see `line`). */
  spareCut: boolean;
  /** A train not on the line stands on a road of one of its loops (moving it gives the loop back). */
  parked: boolean;
  /** The trains not on it standing on its loops' roads are all another line's, running it ("another train"). */
  other: boolean;
  /**
   * Where trains not on the line are running: the slots and sections they're in and the next ones ahead of them
   * (any way at a switch), each with the train's first car. The line's trains keep out of these (see `zoneOf`).
   */
  zone: { slots: ReadonlyMap<number, number>; sections: ReadonlyMap<number, number> };
}

export class Sections {
  /** Off: nothing is held (for comparisons). */
  enabled = true;
  /**
   * Off: each line works its own single track alone, other lines' trains and those on no line only in its way where they
   * are (as before single-line working across lines; for the harness's router cases and comparisons).
   */
  shared = true;
  /**
   * Off: no first-come order (`firstCome`), and a wait at a loop names whichever train it last looked at (as before;
   * for comparisons, and the stalls test of a train kept waiting by one going round non-stop).
   */
  fair = true;
  private readonly states = new Map<number, TrainState>();
  private lineTick = -1;
  private readonly lineInfo = new Map<number, LineInfo>();
  /** The trains each line has room for (kept: see `line`). */
  private readonly admitted = new Map<number, Set<number>>();
  /** Per line: what `line` last worked out of its room (see there), and for what. */
  private readonly slow = new Map<number, { key: string; topo: Topology; blocked: ReadonlySet<number>; more: number; spareCut: boolean; parked: boolean; other: boolean; oneWay: boolean }>();
  /** When each engine was first seen on its line (for the room rule: the first ones are let run). */
  private readonly firstSeen = new Map<number, number>();
  /**
   * When each engine last came onto its line's track: put down, joined, or back from the hand or the box (a count).
   * The room rule holds the newest: the one the player has just added, and can put away again.
   */
  private readonly joinedAt = new Map<number, number>();
  private joins = 0;
  /** Each line's trains on the track as last seen (to tell which have just come). */
  private readonly seenOn = new Map<number, ReadonlySet<number>>();
  /** Lines whose player has been told, once, that a train put on it has no room (see `onFull`). */
  private readonly toldFull = new Set<number>();
  /**
   * Told once a line, when a train comes onto it with no room for it: how many trains it has room for, how many it
   * has, and how many more loops would run them all.
   */
  onFull: ((lineId: number, room: number, trains: number, more: number) => void) | null = null;
  /** Loops on each line's way, by its stops and the track's revisions. */
  // (`n` is as last asked (`shared` or not: see `loopsOn`); `plain` and `withSignals` are both, worked out together.)
  private readonly loopCount = new Map<number, { stops: readonly number[]; revision: number; topo: Topology; slotCount: number; n: number; plain: number; withSignals: number; set: ReadonlySet<number>; way: ReadonlySet<number>; regions: ReadonlySet<number>; pinnedLoop: boolean }>();
  /** Engines just granted a move: steer them now. */
  readonly steerSoon = new Set<number>();
  /**
   * Safety-net releases: none now. The 30 s net that let one of a mutual wait run on (to meet the other and turn back)
   * went with the turn-backs (routing §16 Q3); such a wait is a stall (stalls.ts). Kept at 0 for reports' columns.
   */
  readonly released = 0;
  /** Trains on no line standing short of a train ahead (see `clearCap`): since when (tick). */
  private readonly clearHeld = new Map<number, number>();
  /** The train each of those stands short of (its id), and the tick it last did. */
  private readonly clearBy = new Map<number, { by: number; tick: number }>();
  /** The last tick a line was managed (see `clearCap`). */
  private managedTick = -Infinity;
  /** Moves given up for a train come to stand on their way (see `cutMoves`). */
  cut = 0;
  /** Moves granted, and asks refused (counters for tests and the play-through). */
  granted = 0;
  refused = 0;
  /** Time spent in `cap` (ms) and calls, when `timing` is on. */
  timing = false;
  capMs = 0;
  capCalls = 0;

  constructor(
    private readonly layout: Layout,
    private readonly sim: Sim,
    private readonly host: SectionsHost,
  ) {
    // (A turn round ends a train's stand here: looked at afresh, its clear-ahead hold gone, as with a new id.)
    sim.onTurnedRound?.((id) => {
      this.clearHeld.delete(id);
      this.clearBy.delete(id);
      for (const st of this.states.values()) if (st.trainId === id) st.trainId = -1;
    });
  }

  /** Is a train on a managed line's network now (a line of two or more trains, its slots and sections)? */
  managing(engineCarId: number): boolean {
    if (!this.enabled || this.sim.ticks - this.managedTick > 1) return false;
    // (Only a managed line whose network it's on: a train on a layout of its own is no line's business.)
    const t = this.sim.findCar(engineCarId)?.train;
    if (!t) return false;
    for (const [lineId, info] of this.lineInfo) {
      if (!info.managed) continue;
      const regions = this.loopCount.get(lineId)?.regions;
      if (regions && t.bogies.some((b) => regions.has(regionOf(info.topo, b.pieceId) ?? NaN))) return true;
    }
    return false;
  }

  /** The speed limit sections put on a powered train (Infinity: none). */
  cap(train: Train): number {
    if (!this.enabled) return Infinity;
    if (!this.timing) return this.capWith(train);
    const t0 = performance.now();
    try {
      return this.capWith(train);
    } finally {
      this.capMs += performance.now() - t0;
      this.capCalls++;
    }
  }

  /**
   * `capIn`, and for a train of a managed line with trains not on it about: short of any of those ahead of it too. A
   * train on no line goes where it likes, into a loop road the line's train is in: the line's slots don't keep them
   * apart there, and they met head on (QA's N2).
   */
  private capWith(train: Train): number {
    const c = this.capIn(train);
    if (c === 0) return 0;
    const lineId = this.lineIdOfTrain(train);
    if (lineId < 0) return c;
    const info = this.lineInfo.get(lineId);
    if (!info?.managed || info.foreign.length === 0) return c;
    return Math.min(c, this.clearCap(train, info.foreign, false));
  }

  /** The line of a train's first engine on one (−1: none). */
  private lineIdOfTrain(train: Train): number {
    for (const car of train.cars) {
      if (car.kind !== "engine") continue;
      const l = this.host.lineOf(car.id);
      if (l >= 0) return l;
    }
    return -1;
  }

  private capIn(train: Train): number {
    let engine = -1;
    let lineId = -1;
    for (const car of train.cars) {
      if (car.kind !== "engine") continue;
      const l = this.host.lineOf(car.id);
      if (l >= 0) {
        engine = car.id;
        lineId = l;
        break;
      }
    }
    // (A train on no line, running where a line is managed: it stops short of a train ahead of it, whatever train. On a
    // managed line's network, it works the single track with the line's trains too, going the way the points lie.)
    if (engine === -1) {
      const working = this.shared && this.sim.trainCount > 1 ? this.workingFor(train) : null;
      if (!working) {
        // (Taken off its line: what it held, and why it waited, are forgotten.)
        for (const car of train.cars) if (car.kind === "engine") this.states.delete(car.id);
        return this.sim.ticks - this.managedTick <= 1 ? this.clearCap(train) : Infinity;
      }
      const c = this.clearCap(train);
      if (c === 0) return 0;
      return Math.min(c, this.capOf(train, working.engine, working.info));
    }
    const info = this.line(lineId);
    if (!info.managed) {
      this.states.delete(engine);
      return Infinity;
    }
    return this.capOf(train, engine, info);
  }

  /**
   * A train on no line with its lever on, on a managed line's network (one of its `users`): the line's info, and the
   * engine it's named by; null if it's on none.
   */
  private workingFor(train: Train): { engine: number; info: LineInfo } | null {
    const engine = engineOf(train);
    for (const l of this.netLines()) {
      const info = this.line(l);
      if (info.managed && info.loose.includes(engine)) return { engine, info };
    }
    return null;
  }

  /** The lines with a train on the track now (once a tick). */
  private netLines(): readonly number[] {
    if (this.linesTick === this.sim.ticks) return this.linesNow;
    this.linesTick = this.sim.ticks;
    const out = new Set<number>();
    for (const t of this.sim.trains()) {
      if (t.derailed) continue;
      for (const car of t.cars) {
        if (car.kind !== "engine") continue;
        const l = this.host.lineOf(car.id);
        if (l >= 0) {
          out.add(l);
          break;
        }
      }
    }
    this.linesNow = [...out];
    return this.linesNow;
  }
  private linesTick = -1;
  private linesNow: readonly number[] = [];

  /** Sections' limit for a train working a managed line's single track (its own, a line's sharing it, or on no line). */
  private capOf(train: Train, engine: number, info: LineInfo): number {
    const net = this.host.drive(train);
    // (Turning back: the sim counts it down standing; a limit of 0 then would read as a crane holding it.)
    if (net === 0 || train.turnback >= 0) return Infinity;
    let st = this.states.get(engine);
    if (!st) {
      st = { engine, trainId: train.id, frontKey: -1, tailPiece: -1, slot: -1, beyond: Infinity, exitPiece: -1, exitEntry: -1, move: null, wait: null, askedAt: -Infinity, waitSince: -1, outBy: -1, topo: info.topo, ahead: new Set(), facedAt: -Infinity, faceHold: false, lastDead: null, edge: Infinity, nearAsked: -1, claim: -1, claimAt: -Infinity };
      this.states.set(engine, st);
    }
    const topo = info.topo;
    // (The track changed: where everything is, worked out afresh; a move on the old track is given up.)
    if (st.topo !== topo) {
      st.topo = topo;
      st.move = null;
      st.frontKey = -1;
    }
    const front = this.front(train, net < 0);
    const frontKey = (front.pieceId * 8 + front.pathIndex) * 2 + (front.reversed ? 1 : 0);
    if (frontKey !== st.frontKey || st.trainId !== train.id) {
      st.frontKey = frontKey;
      st.trainId = train.id;
      this.look(st, topo, front);
    }
    const now = this.sim.ticks;
    // In a section.
    if (st.slot === -1) {
      if (st.move) return Infinity;
      // (Points or a crossing ahead: asked again as it comes up to them, and held, it stands short of them, never on
      // them (routing spec §5 rule 9: a train held on points is in the way of every train that goes over them).)
      const lead = net < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
      const room = st.edge === Infinity ? Infinity : lengthOfPath(this.layout, front.pieceId, front.pathIndex) - front.s + st.edge - CAR_SPECS[lead.kind].bogieInset - STAND_SHORT;
      const short = (r: number) => (r === Infinity ? 0 : r > 0 ? Math.sqrt(2 * ACCELERATION * r) : 0);
      const near = room <= stopDistance(train.speed) + ASK_LOOK;
      if (now - st.askedAt < CHECK_TICKS && !(near && !st.wait && st.nearAsked !== st.frontKey)) return st.wait ? short(room) : Infinity;
      st.askedAt = now;
      if (near) st.nearAsked = st.frontKey;
      if (!this.recover(st, info, train, front)) return short(room);
      // (Nothing in its way now: what it last waited for is over. Kept, it held the train between looks for good (a
      // train on no line going round a ring, its way no slot: `recover` let it go, the old wait stood it still; 2026-11-05).)
      if (st.wait && !st.move) {
        st.wait = null;
        st.waitSince = -1;
      }
      return Infinity;
    }
    // In a slot, with a train of its line put down facing it on the way to the slot's end: one gives way.
    if (this.facing(st, info, train)) return 0;
    // In a slot, with its move on from it granted.
    if (this.ownsAhead(st)) return Infinity;
    if (st.beyond === Infinity) return Infinity;
    const lead = net < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    const room = lengthOfPath(this.layout, front.pieceId, front.pathIndex) - front.s + st.beyond - CAR_SPECS[lead.kind].bogieInset;
    // (Or standing at a red signal short of its slot's end, one that's no waiting point (a pair in a line end): it asks
    // from there. A path signal shows clear only once the router has its way locked, which waits for this grant, so
    // asking only at the slot's end it stood at the signal for good, and the line's train waiting for its slot too
    // (signals audit, 2026-11-06). Not at one held by hand: there it holds nothing ahead (signals spec §3.3).)
    const atRed = room > 0 && train.speed < 1 && this.sim.atRedSignal(train.id) && !this.sim.redHeldByHand(train.id);
    if ((atRed || room <= stopDistance(train.speed) + ASK_LOOK) && now - st.askedAt >= CHECK_TICKS) {
      st.askedAt = now;
      if (this.ask(st, info)) {
        // (Nothing to ask for on this way: it isn't gated here.)
        if (!st.move) st.beyond = Infinity;
        return Infinity;
      }
    }
    return room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
  }

  /**
   * A train of its line put down facing it in its slot, on the way to the slot's end (looked at every `CHECK_TICKS`):
   * each waits on the other, nose to nose (nothing turns either back, routing spec §16 Q3: a stall, said on their
   * cards by stalls.ts, till the player moves one). True: it's held.
   */
  private facing(st: TrainState, info: LineInfo, train: Train): boolean {
    const now = this.sim.ticks;
    if (now - st.facedAt < CHECK_TICKS) return st.faceHold;
    st.facedAt = now;
    st.faceHold = false;
    // (One the line has no room for is held for that, whatever stands by it: its card says how many loops to lay.)
    const why = (w: BlockWait): BlockWait => (this.hasRoom(info, st.engine) ? w : this.roomWait(st, info));
    const slotPieces = st.topo.slots[st.slot].pieces;
    // (A train not on the line standing ahead of it in its slot: it waits behind it, not running into it.)
    for (const t of info.foreign) {
      if (t.speed >= 1 || !t.bogies.some((b) => st.ahead.has(b.pieceId) && !train.bogies.some((x) => x.pieceId === b.pieceId && x.s === b.s))) continue;
      st.faceHold = true;
      this.hold(st, why({ kind: "slot", engine: engineOf(t) }));
      return true;
    }
    // (Any train standing just past its slot's end, its own move not granted on through it: it waits short of it, not
    // running up to the end of the slot into its overhang.)
    if (st.exitPiece !== -1 && !this.ownsAhead(st))
      for (const t of this.sim.trains()) {
        if (t === train || t.speed >= 1 || !t.bogies.some((b) => b.pieceId === st.exitPiece)) continue;
        const u = engineOf(t);
        st.faceHold = true;
        this.hold(st, why({ kind: "slot", engine: u }));
        return true;
      }
    for (const u of info.users) {
      if (u === st.engine) continue;
      const tu = this.sim.findCar(u)?.train;
      if (!tu || !tu.bogies.some((b) => slotPieces.has(b.pieceId))) continue;
      const mineOn = train.bogies.map((b) => b.pieceId);
      const ahead = tu.bogies.some((b) => st.ahead.has(b.pieceId) && !mineOn.includes(b.pieceId));
      if (!ahead) continue;
      // (Facing: each on the other's way. One behind the other the same way only follows. Worked out from where the
      // other stands, so one not asked for a limit yet (held by a crane, say) counts too.)
      const theirs = this.aheadIn(tu, st.slot, st.topo);
      if (!theirs || !mineOn.some((p) => theirs.ahead.has(p))) {
        // (Not facing it, but standing ahead of it in the slot: it waits behind, not running into it.)
        if (tu.speed < 1) {
          st.faceHold = true;
          this.hold(st, why({ kind: "slot", engine: u }));
          return true;
        }
        continue;
      }
      st.faceHold = true;
      this.hold(st, why({ kind: "facing", engine: u }));
      return true;
    }
    if (st.wait?.kind === "facing") st.wait = null;
    return false;
  }

  /** The pieces of slot `slot` from a train's front to the slot's end, and whether the slot has an end that way. */
  private aheadIn(train: Train, slot: number, topo: Topology): { ahead: Set<number>; exit: boolean } | null {
    const { layout } = this;
    const net = this.host.drive(train);
    if (net === 0) return null;
    const front = this.front(train, net < 0);
    if (topo.slotOf.get(front.pieceId) !== slot) return null;
    const ahead = new Set<number>([front.pieceId]);
    const piece = layout.getPiece(front.pieceId);
    if (!piece) return null;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    let exit = front.reversed ? path.from : (path.to ?? -1);
    let at = front.pieceId;
    for (let k = 0; k < SEARCH; k++) {
      const n = next(layout, at, exit);
      if (!n) return { ahead, exit: false };
      if (topo.slotOf.get(n.pieceId) !== slot) return { ahead, exit: true };
      ahead.add(n.pieceId);
      const ways = waysFrom(layout, n.pieceId, n.entry);
      if (ways.length !== 1) return { ahead, exit: true };
      at = n.pieceId;
      exit = ways[0].exit;
    }
    return { ahead, exit: true };
  }

  /** Does it hold the move on from the slot it's in (granted at this slot's end)? */
  private ownsAhead(st: TrainState): boolean {
    const m = st.move;
    if (!m || st.exitPiece === -1) return false;
    // (Or the slot it's going to is next: out of a waiting point straight into it, no section between, or out of one it
    // runs through, too short for it, into the one it stands in across both.)
    return m.steps.some((x) => x.pieceId === st.exitPiece) || (m.dest >= 0 && !!st.topo.slots[m.dest]?.pieces.has(st.exitPiece));
  }

  /** The cursor at a train's front, pointing the way it goes. */
  private front(train: Train, back: boolean): Cursor {
    const c: Cursor = { ...(back ? train.bogies[train.bogies.length - 1] : train.bogies[0]) };
    if (back) flipCursor(this.layout, c);
    return c;
  }

  /** Its front came onto another piece: where it is, how far to its slot's end, and whether its move is over. */
  private look(st: TrainState, topo: Topology, front: Cursor): void {
    const { layout } = this;
    const slot = topo.slotOf.get(front.pieceId);
    st.slot = slot ?? -1;
    st.beyond = Infinity;
    st.exitPiece = -1;
    st.exitEntry = -1;
    st.askedAt = -Infinity;
    const piece = layout.getPiece(front.pieceId);
    if (!piece) return;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    const m = st.move;
    if (m) {
      if (slot !== undefined) {
        // At its move's far slot: the move is over. (Its tail still in the section keeps others out:
        // they look at where trains stand, too.) Back in the slot it set out from (turned round): given up.
        if (slot === m.dest || !this.onWay(m, front.pieceId)) st.move = null;
      } else {
        // In the section, off its way, or going the other way along it (turned round): given up; it asks afresh.
        const entry = front.reversed ? (path.to ?? -1) : path.from;
        if (!m.steps.some((s) => s.pieceId === front.pieceId && s.entry === entry)) st.move = null;
      }
    }
    st.ahead.clear();
    st.edge = Infinity;
    if (slot === undefined) {
      st.edge = this.edgeAhead(front);
      return;
    }
    // (On a loop's road with its stop on the other road (it was sent round by the free road): it can't call there
    // this time; its route goes on to the stop after.)
    const sl = topo.slots[slot];
    if (sl.kind === "road") {
      const loop = topo.loops[sl.loop];
      const other = topo.slots[loop.roads[0] === slot ? loop.roads[1] : loop.roads[0]].pieces;
      const target = this.host.target(st.engine);
      // (Not when this road is a track of the same depot as its stop: depot tracks. It calls there.)
      if (target >= 0 && other.has(target) && !sl.pieces.has(target) && ![...sl.pieces].some((p) => this.host.sameDepot?.(p, target))) this.host.skipStops(st.engine, other);
    }
    st.ahead.add(front.pieceId);
    let exit = front.reversed ? path.from : (path.to ?? -1);
    let beyond = -STAND_SHORT;
    let at = front.pieceId;
    for (let k = 0; k < SEARCH; k++) {
      const n = next(layout, at, exit);
      if (!n) return;
      if (topo.slotOf.get(n.pieceId) === slot) st.ahead.add(n.pieceId);
      if (topo.slotOf.get(n.pieceId) !== slot) {
        st.beyond = beyond;
        st.exitPiece = n.pieceId;
        st.exitEntry = n.entry;
        if (topo.slots[slot].kind === "road") st.outBy = n.pieceId;
        return;
      }
      const ways = waysFrom(layout, n.pieceId, n.entry);
      if (ways.length !== 1) return;
      beyond += lengthOfPath(layout, n.pieceId, ways[0].path);
      at = n.pieceId;
      exit = ways[0].exit;
    }
  }

  /**
   * From a front in a section, as the points lie: how far (mm) past its piece the next points or crossing begin, within
   * `EDGE_LOOK` (Infinity: none). Worked out as its front comes onto a piece.
   */
  private edgeAhead(front: Cursor): number {
    const { layout } = this;
    const piece = layout.getPiece(front.pieceId);
    if (!piece) return Infinity;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    let d = 0;
    let found = Infinity;
    walkOn(
      layout,
      front.pieceId,
      front.reversed ? path.from : (path.to ?? -1),
      (id, _entry, ways) => {
        if (blockEdge(layout, id)) {
          found = d;
          return false;
        }
        if (ways.length !== 1 || ways[0].exit < 0) return false;
        d += lengthOfPath(layout, id, ways[0].path);
        return d <= EDGE_LOOK;
      },
      SEARCH,
    );
    return found;
  }

  /** Is train `u` all on `standing`'s pieces and none on way `along`? */
  private offWay(u: number, along: ReadonlyMap<number, number>, standing: ReadonlySet<number>): boolean {
    const t = this.sim.findCar(u)?.train;
    return !!t && t.bogies.every((b) => standing.has(b.pieceId)) && !t.bogies.some((b) => along.has(b.pieceId));
  }

  /** Is train `u` standing, with no move held? */
  private standing(u: number): boolean {
    if (this.states.get(u)?.move) return false;
    const t = this.sim.findCar(u)?.train;
    return !!t && t.speed < 1;
  }

  /** Is `engine`'s train in a dead-end region (so going anywhere, it's coming out)? */
  private comingOut(engine: number): boolean {
    const t = this.sim.findCar(engine)?.train;
    if (!t) return false;
    const ends = deadEndsOf(this.layout);
    return ends.mouths.length > 0 && t.bogies.some((b) => ends.regionOf.has(b.pieceId));
  }

  /** Is train `u` off way `along`, or on it ahead going the same way (`sameWayAhead`)? */
  private clearOrAhead(u: number, along: ReadonlyMap<number, number>): boolean {
    const t = this.sim.findCar(u)?.train;
    if (!t) return true;
    return !t.bogies.some((b) => along.has(b.pieceId)) || this.sameWayAhead(u, along);
  }

  /**
   * The train (by name) in dead-end region `r`, or with a move granted into it, other than `engine`'s; −1: none.
   */
  private inDeadEnd(r: number, engine: number, own: Train | undefined): number {
    const ends = deadEndsOf(this.layout);
    const pieces = ends.mouths[r].pieces;
    for (const t of this.sim.trains()) {
      if (t === own || t.derailed) continue;
      if (t.bogies.some((b) => pieces.has(b.pieceId))) return engineOf(t);
    }
    const now = this.sim.ticks;
    for (const [u, st] of this.states) {
      if (u === engine) continue;
      if (st.claim === r && now - st.claimAt <= CLAIM_TICKS && this.sim.findCar(u)) return u;
      if (st.move?.steps.some((x) => pieces.has(x.pieceId))) return u;
    }
    return -1;
  }

  /**
   * At points just outside a dead end's mouth, come onto from it (coming out): the way `w`, unless a train stands or
   * comes on its road facing this one and another way has none (`mouthWay`; for a routed train, one that still reaches
   * `target`). Elsewhere `w`.
   */
  private outOfDeadEnd(own: Train | undefined, at: { pieceId: number; entry: number }, ways: readonly { option: number; path: number; exit: number }[], w: { option: number; path: number; exit: number }, target: number): { option: number; path: number; exit: number } {
    const reaches = target < 0 ? undefined : (x: { option: number; path: number; exit: number }) => planWay(this.layout, at.pieceId, at.entry, [{ option: 0, path: x.path, exit: x.exit }], target) !== -1;
    const o = mouthWay(this.layout, this.sim, own, at.pieceId, at.entry, ways, w.option, reaches);
    return o === w.option ? w : (ways.find((x) => x.option === o) ?? w);
  }

  /** Along a way's steps from its first (the train's front piece): how far (mm) past it the first points begin. */
  private edgeOn(steps: readonly Step[]): number {
    let d = 0;
    for (let i = 1; i < steps.length; i++) {
      if (blockEdge(this.layout, steps[i].pieceId)) return d;
      d += lengthOfPath(this.layout, steps[i].pieceId, steps[i].path);
    }
    return Infinity;
  }

  /** Is a piece on a move's way (its steps, or the slot it goes to)? */
  private onWay(m: Move, pieceId: number): boolean {
    return m.steps.some((s) => s.pieceId === pieceId);
  }

  /**
   * The way from the piece just past its slot's end (or from its front, in a section) through the section to the
   * next slot, choosing at each switch as steering would (for its stop), and at a loop's facing switch a road with
   * room. Null if it reaches no slot. `dest` −1: the slot ahead is full (`blockedBy` is in it, or on its way there).
   */
  private wayOn(st: TrainState, info: LineInfo, start: { pieceId: number; entry: number }, firstPath = -1, short: ReadonlySet<number> | null = null, depth = 0): Way | null {
    const { layout } = this;
    const topo = info.topo;
    let target = this.host.target(st.engine);
    const keep = this.host.keep?.(st.engine);
    const loose = this.host.lineOf(st.engine) < 0;
    // (Past its stop on the way (a stop in a section is called at inside the move), its way goes on toward the one
    // after, as the router aims it, not as the points lie: 2026-11-06, a train at a mill in a section was taken on into
    // the hopper shuttle's loop beyond it, which it never goes to, and waited there for good. Only where lines share
    // track (`network`), where the road as the points lie is often another line's: on a line's own track, with trains
    // on no line about, the way as they lie let it follow one going round a ring, as before. Making the two agree
    // there too waits for planning a train the way the traffic goes (the town-ring fuzz with a loop: 4 of 29 seeds
    // came to no stop).)
    const aims = loose || !this.network().has(this.host.lineOf(st.engine)) ? null : (this.host.lap?.(st.engine) ?? null);
    let aim = aims ? aims.indexOf(target) : -1;
    const steps: Step[] = [];
    const sections: number[] = [];
    const through: number[] = [];
    // (A switch under the train itself goes the way it lies: steering never throws one under a train.)
    const under = new Map<number, number>();
    const own = this.sim.findCar(st.engine)?.train;
    if (own) for (const b of own.bogies) under.set(b.pieceId, b.pathIndex);
    let at: { pieceId: number; entry: number } | null = start;
    const ends = deadEndsOf(layout);
    let lastRegion = -1;
    // A dead end short of `at`: its way cut back clear of switches; what's past where it stands, passed over.
    // (Named: the train given, else one standing on `on` (a train on no line there is the end of the line too), else
    // the first the line has no room for.)
    const deadEnd = (blockedBy: number, on: ReadonlySet<number>): Way => {
      const kept = this.shortOfSwitch(steps, own ? trainLength(own) : 0);
      if (blockedBy === -1) blockedBy = this.standingOn(on, own);
      return { steps: kept, sections, through, dest: DEAD_END, outBy: -1, blockedBy: blockedBy !== -1 ? blockedBy : this.heldOf(info, st.engine), deadEnd: this.beyondOf(at!, steps.slice(kept.length).map((x) => x.pieceId)) };
    };
    for (let k = 0; at && k < SEARCH; k++) {
      // A train with no room standing ahead: a dead end short of it (the rest of the way on, and its stops, passed over).
      if (short?.has(at.pieceId)) {
        return deadEnd(-1, new Set([at.pieceId]));
      }
      // Into a dead end at its mouth (routing spec §5 rule 8): only while no other train is in it or going in.
      if (depth === 0) {
        const r = ends.regionOf.get(at.pieceId);
        if (r !== undefined && r !== lastRegion && !own?.bogies.some((b) => ends.regionOf.get(b.pieceId) === r)) {
          const u = this.inDeadEnd(r, st.engine, own);
          if (u !== -1) return { steps, sections, through, dest: -1, outBy: -1, blockedBy: u, mouth: true };
          // (Free: it's going in. Claimed while it asks again on its way there, so no other goes in meanwhile.)
          st.claim = r;
          st.claimAt = this.sim.ticks;
        }
        lastRegion = r ?? -1;
      }
      const slot = topo.slotOf.get(at.pieceId);
      if (slot !== undefined) {
        const s = topo.slots[slot];
        if (s.kind === "signal") {
          // (Who's there matters only for its own way, not a probe's (`convoy`): not looked for then.)
          const u = depth === 0 ? this.slotUser(info, slot, st.engine) : -1;
          // Going a signal's way, and it fits there clear of points: it waits there, if the way on past the signal can
          // take it after the train ahead (`convoy`). (Probing the way on for `convoy`: on through it, whoever's there.)
          const inBy = connectorRef(at.pieceId, at.entry);
          const way = depth === 0 ? s.ways?.find((w) => w.back === inBy) : undefined;
          if (way && (!own || s.length + this.plainBehind(steps, through, topo) >= trainLength(own) + ROAD_MARGIN)) {
            if (u !== -1) return { steps, sections, through, dest: -1, outBy: -1, blockedBy: u };
            const c = this.convoy(st, info, way);
            return { steps, sections, through, dest: c === -1 ? slot : -1, outBy: -1, blockedBy: c };
          }
          // Against it: through it, holding it and the sections either side as one move, to the slot after.
          if (u !== -1 && depth === 0) return { steps, sections, through, dest: -1, outBy: -1, blockedBy: u };
          through.push(slot);
          for (let r = 0; at && r < SEARCH && topo.slotOf.get(at.pieceId) === slot; r++) {
            const ways = waysFrom(layout, at.pieceId, at.entry);
            if (ways.length !== 1) return null;
            steps.push({ pieceId: at.pieceId, path: ways[0].path, entry: at.entry });
            at = next(layout, at.pieceId, ways[0].exit);
          }
          continue;
        }
        if (s.kind === "end") {
          const u = this.slotUser(info, slot, st.engine);
          // (Held there for want of room on the line: it won't move, so the section before it is a dead end, turned
          // back in.)
          if (u !== -1 && !this.hasRoom(info, u)) return deadEnd(u, s.pieces);
          return { steps, sections, through, dest: u === -1 ? slot : -1, outBy: -1, blockedBy: u };
        }
        const loop = topo.loops[s.loop];
        const prev = steps[steps.length - 1];
        const outBy = prev?.pieceId === loop.a ? loop.b : loop.a;
        let blockedBy = -1;
        let keepSameWay = false;
        // A loop with a train the line has no room for standing on one road: no passing place. It runs through by the
        // other road, holding it and the section beyond as one move, to the slot after.
        if (info.blocked.has(s.loop)) {
          const free = loop.roads.find((r) => !this.heldOnRoad(info, r));
          // (Both roads held: the loop is the end of the line from here, a dead end short of it.)
          if (free === undefined) return deadEnd(-1, new Set(loop.roads.flatMap((r) => [...topo.slots[r].pieces])));
          const u = this.slotUser(info, free, st.engine);
          if (u !== -1 || !prev) return { steps, sections, through, dest: -1, outBy, blockedBy: u };
          // (A train on no line can't be sent onto the free road: the points lie for the held one's.)
          if (loose && free !== slot) return { steps, sections, through, dest: -1, outBy, blockedBy: this.slotUser(info, slot, st.engine) };
          if (free !== slot) {
            // (Its switch set for the other road, under it: that road's train is what it waits on.)
            if (under.has(prev.pieceId)) return { steps, sections, through, dest: -1, outBy, blockedBy: this.slotUser(info, slot, st.engine) };
            const w = waysFrom(layout, prev.pieceId, prev.entry).find((x) => {
              const n = next(layout, prev.pieceId, x.exit);
              return !!n && topo.slotOf.get(n.pieceId) === free;
            });
            if (!w) return { steps, sections, through, dest: -1, outBy, blockedBy: this.slotUser(info, slot, st.engine) };
            prev.path = w.path;
            at = next(layout, prev.pieceId, w.exit);
          }
          through.push(free);
          // Along the road to its far switch.
          for (let r = 0; at && r < SEARCH && topo.slotOf.get(at.pieceId) === free; r++) {
            const ways = waysFrom(layout, at.pieceId, at.entry);
            if (ways.length !== 1) return null;
            steps.push({ pieceId: at.pieceId, path: ways[0].path, entry: at.entry });
            at = next(layout, at.pieceId, ways[0].exit);
          }
          continue;
        }
        // The road steering takes, else the other one, if it has room and the facing switch can send it there; and
        // never a second train into a loop going out the same way as the one there (a loop holds two only to pass).
        // (Its stop on one of the roads: that road, or wait for it. It would only run past its stop on the other.)
        // (Unless the one on it waits for this one: then either road, so they don't wait on each other for good.)
        let calls = loop.roads.find((r) => topo.slots[r].pieces.has(target));
        if (calls !== undefined) {
          const u = this.slotUser(info, calls, st.engine);
          const w = u === -1 ? null : this.states.get(u)?.wait;
          if (w && "engine" in w && w.engine === st.engine) calls = undefined;
        }
        // (Only the roads trains in at this end may take: with the far end pinned, the one its trains don't use.)
        const into = prev?.pieceId === loop.a ? loop.into[0] : prev?.pieceId === loop.b ? loop.into[1] : loop.roads;
        // (A train on no line goes the way the points lie: only that road.)
        let roads = loose ? [slot] : calls !== undefined ? [calls] : s.road === 0 ? loop.roads : [loop.roads[1], loop.roads[0]];
        // (A train on no line about: the road it would come onto at the far end, the way those points rest, last. They
        // pass there, each on its own road.)
        if (!loose && roads.length === 2 && info.loose.length > 0 && this.restRoad(topo, loop, outBy) === roads[0]) roads = [roads[1], roads[0]];
        // (A road with a train on it, one it may follow out, after an empty one: behind it, it waits for that train to
        // go, and that one may wait for what this one holds (issue #32: a goods train was sent in behind a timber train
        // standing in a loop, the other road empty, and four trains stood in a ring of waits for good).)
        if (!loose && calls === undefined && roads.length === 2 && this.slotUser(info, roads[0], st.engine) !== -1 && this.slotUser(info, roads[1], st.engine) === -1) roads = [roads[1], roads[0]];
        for (const r of roads) {
          if (r !== calls && !into.includes(r)) continue;
          // (One it may follow, going out the same way, isn't in its way: see `follows`.)
          const u = this.slotUser(info, r, st.engine, outBy);
          if (u !== -1) {
            if (!keepSameWay) {
              blockedBy = u;
              keepSameWay = this.fair && !this.underWay(u) && this.outByOf(u, r) === outBy;
            }
            continue;
          }
          const other = r === loop.roads[0] ? loop.roads[1] : loop.roads[0];
          const o = this.slotUser(info, other, st.engine, outBy);
          // (Unless the one there waits, by way of others or not, for this one: each in a loop, each wanting the other's,
          // they'd stand for good. It comes in beside it, and the one there goes on into the loop this one has left.)
          if (o !== -1 && this.outByOf(o, other) === outBy && !this.waitsFor(o, st.engine)) {
            blockedBy = o;
            // (A train going out the same way, standing on either road, is named over one passing through (`fair`):
            // it's what the wait is really on, and naming it lets `waitsFor` see two such trains each waiting for the
            // other's loop.)
            keepSameWay = this.fair && !this.underWay(o);
            continue;
          }
          if (prev && r !== slot) {
            if (under.has(prev.pieceId)) continue;
            const w = waysFrom(layout, prev.pieceId, prev.entry).find((x) => {
              const n = next(layout, prev.pieceId, x.exit);
              return !!n && topo.slotOf.get(n.pieceId) === r;
            });
            if (!w) continue;
            prev.path = w.path;
          }
          return { steps, sections, through, dest: r, outBy, blockedBy: -1 };
        }
        return { steps, sections, through, dest: -1, outBy, blockedBy };
      }
      const sec = topo.sectionOf.get(at.pieceId);
      if (sec !== undefined && !sections.includes(sec)) sections.push(sec);
      const ways = waysFrom(layout, at.pieceId, at.entry);
      if (ways.length === 0) return null;
      let w = ways[0];
      if (k === 0 && firstPath !== -1) w = ways.find((x) => x.path === firstPath) ?? w;
      else if (ways.length > 1 && under.has(at.pieceId)) {
        const p = under.get(at.pieceId);
        w = ways.find((x) => x.path === p) ?? w;
      }
      else if (ways.length > 1) {
        // (The router's choice: the plan's way to its stop.)
        const best = target < 0 ? -1 : planWay(layout, at.pieceId, at.entry, ways, target, undefined, keep?.(at.pieceId, at.entry, target));
        w = best === -1 ? (ways[pointsWayFrom(layout, at.pieceId, at.entry, ways.length)] ?? ways[0]) : ways[best];
        w = this.outOfDeadEnd(own, at, ways, w, best === -1 ? -1 : target);
      }
      steps.push({ pieceId: at.pieceId, path: w.path, entry: at.entry });
      // (The same place again next (a line's last stop and its first): on to the one after that.)
      if (aims && aim >= 0 && aims.length > 1 && at.pieceId === target)
        for (let k = 0; k < aims.length && target === at.pieceId; k++) target = aims[(aim = (aim + 1) % aims.length)];
      at = next(layout, at.pieceId, w.exit);
    }
    return null;
  }

  /**
   * The plain track just behind a waiting point on a way (mm): its last steps, back to where they leave a section, in
   * waiting points it runs through (signal stretches, joined at signal joints, no points in them). A train too long
   * for the waiting point alone may stand there across them, its front at the signal (the user's forgiving placement:
   * "don't be too particular about where trains stand"; points are never under it). Its move holds them already.
   */
  private plainBehind(steps: readonly Step[], through: readonly number[], topo: Topology): number {
    let room = 0;
    for (let k = steps.length - 1; k >= 0; k--) {
      const sl = topo.slotOf.get(steps[k].pieceId);
      if (sl === undefined || topo.slots[sl].kind !== "signal" || !through.includes(sl)) break;
      room += lengthOfPath(this.layout, steps[k].pieceId, steps[k].path);
    }
    return room;
  }

  /**
   * May a train going a waiting point's way (`sig`) stop there, its way on past the signal not yet free (signals spec
   * §3.2)? Only if, once the trains ahead have gone on, the way on can take it: a passing loop is next (it passes any
   * train coming back there), or a waiting point its way (the same asked of it), or a line end with no other train in
   * it or on the way there. Else it would stand there in the way of a train coming back from that line end, each
   * waiting on the other. −1: yes; else the train it waits for (or `heldOf`'s).
   */
  private readonly probedNone = new Map<string, { topo: Topology; tick: number }>();

  private convoy(st: TrainState, info: LineInfo, sig: SignalWay): number {
    const topo = info.topo;
    if (sig.out < 0) return this.heldOf(info, st.engine);
    const start = { pieceId: pieceOfRef(sig.out), entry: indexOfRef(sig.out) };
    // (A probe that came to no slot (a ring of waiting points, its stop on it) walks its whole `SEARCH`: the answer
    // kept a while for the same train, signal, stop, track and points. With every signal a waiting point it's asked
    // far more often: on #32's map 3 ms a probe, 230 of them in 300 s, a quarter of the sim's time uncached.)
    const key = `${st.engine}:${sig.mark}:${this.host.target(st.engine)}:${this.layout.switchesVersion}`;
    const none = this.probedNone.get(key);
    if (none && none.topo === topo && this.sim.ticks - none.tick < PROBE_KEEP) return this.heldOf(info, st.engine);
    // (Probed: on through any waiting points, to the next loop or line end.)
    const way = this.wayOn(st, info, start, -1, null, 1);
    if (!way) {
      if (this.probedNone.size > 256) this.probedNone.clear();
      this.probedNone.set(key, { topo, tick: this.sim.ticks });
    }
    if (!way || way.dest === DEAD_END) return way && way.blockedBy !== -1 ? way.blockedBy : this.heldOf(info, st.engine);
    // (The slot the way comes to, taken or not.)
    let reached = topo.slotOf.get(start.pieceId);
    const last = way.steps[way.steps.length - 1];
    if (last) {
      const w = waysFrom(this.layout, last.pieceId, last.entry).find((x) => x.path === last.path);
      const n = w ? next(this.layout, last.pieceId, w.exit) : null;
      reached = n ? topo.slotOf.get(n.pieceId) : undefined;
    }
    if (reached === undefined || topo.slots[reached].kind === "signal") return way.blockedBy !== -1 ? way.blockedBy : this.heldOf(info, st.engine);
    const r = topo.slots[reached];
    if (r.kind === "road") {
      if (info.blocked.has(r.loop)) return way.blockedBy !== -1 ? way.blockedBy : this.heldOf(info, st.engine);
      // (A train on the way there coming the other way, or standing in a waiting point on it facing this one: between
      // two loops neither could pass the other, and with a pair of signals mid-line both would wait nose to nose for
      // good. One going the same way ahead is only followed. 2026-11-09: one pair mid-line, two trains of one line
      // starting toward each other: 0 stops in 900 s without this, 20 each with it, as before pairs were waiting points.)
      return this.comingAt(st.engine, info, this.alongOf(way.steps, topo, false));
    }
    // (A line end: nobody there, nor on the way there, nor in the waiting points between, either way.)
    for (const x of way.sections) {
      const u = this.sectionUser(info, x, st.engine);
      if (u !== -1) return u;
    }
    for (const x of [...way.through, reached]) {
      const u = this.slotUser(info, x, st.engine);
      if (u !== -1) return u;
    }
    return -1;
  }

  /**
   * A dead end's way, ending short of its last switch, with room for the whole train between it and the switch before
   * (the stops past it, `Way.deadEnd`, are those it can't reach while the line is full).
   */
  private shortOfSwitch(steps: Step[], length: number): Step[] {
    let j = steps.length;
    for (;;) {
      let k = j - 1;
      while (k >= 0 && !branches(this.layout, steps[k].pieceId)) k--;
      if (k < 0) return steps.slice(0, j);
      // Steps k+1 .. j-1 lie between the switch at k and the one cut off at j.
      let room = 0;
      for (let x = k + 1; x < j; x++) room += lengthOfPath(this.layout, steps[x].pieceId, steps[x].path);
      if (j < steps.length && room >= length + ROAD_MARGIN) return steps.slice(0, j);
      j = k;
    }
  }

  /**
   * Everything beyond a dead end: the track ahead from `at` (entered by its end `entry`), every way on, never back
   * (and `also`: the cut-off end of the way to it). The stops there can't be reached now; the route passes over them.
   */
  private beyondOf(at: { pieceId: number; entry: number }, also: Iterable<number>): Set<number> {
    const { layout } = this;
    const out = new Set<number>(also);
    const seen = new Set<number>();
    const stack = [at];
    while (stack.length > 0 && seen.size < SEARCH) {
      const n = stack.pop()!;
      const key = n.pieceId * 8 + n.entry;
      if (seen.has(key)) continue;
      seen.add(key);
      out.add(n.pieceId);
      for (const w of waysFrom(layout, n.pieceId, n.entry, () => false)) {
        const m = next(layout, n.pieceId, w.exit);
        if (m) stack.push(m);
      }
    }
    return out;
  }

  /**
   * The pieces trains of the line with no room stand on in a section, if they're all there is in it (no other train
   * on it, or holding it); null otherwise.
   */
  private heldIn(info: LineInfo, section: number, engine: number): Set<number> | null {
    const out = new Set<number>();
    for (const u of info.users) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && m.sections.includes(section)) return null;
      const t = this.sim.findCar(u)?.train;
      if (!t || !t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) continue;
      if (this.hasRoom(info, u) || t.speed >= 1) return null;
      for (const b of t.bogies) out.add(b.pieceId);
    }
    // (A train not on the line standing there is the end of the line too; one running there, it waits for.)
    for (const t of info.foreign) {
      if (!t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) continue;
      if (t.speed >= 1) return null;
      for (const b of t.bogies) out.add(b.pieceId);
    }
    return out.size > 0 ? out : null;
  }

  private roomWait(st: TrainState, info: LineInfo): BlockWait {
    const loops = Math.max(0, info.loops - info.blocked.size);
    // (A line stood still for a parked train: every train of it says to move that, as moving it is what works. `more`
    // 0: it has room for them all, this one waits its turn; no loop to ask for.)
    return { kind: "room", lineId: this.host.lineOf(st.engine), trains: info.engines.length, loops, more: info.more, spare: info.spareCut, parked: info.parked, other: info.other, pinned: this.pinnedLoopOn(st.engine) };
  }

  /** Does a train the line has no room for stand on this loop road? */
  private heldOnRoad(info: LineInfo, road: number): boolean {
    const pieces = info.topo.slots[road].pieces;
    for (const u of info.users) {
      if (this.hasRoom(info, u)) continue;
      const t = this.sim.findCar(u)?.train;
      if (t && t.speed < 1 && t.bogies.some((b) => pieces.has(b.pieceId))) return true;
    }
    for (const t of info.foreign) if (t.speed < 1 && t.bogies.some((b) => pieces.has(b.pieceId))) return true;
    return false;
  }

  /**
   * The train of the line (other than `engine`) on a slot, or on its way there; −1 if none. `outBy` (a loop road's): one
   * that `engine` may follow (`follows`) going out of the road by that same switch isn't in its way, and is passed over.
   */
  private slotUser(info: LineInfo, slot: number, engine: number, outBy = -1): number {
    const pieces = info.topo.slots[slot].pieces;
    for (const u of info.users) {
      if (u === engine) continue;
      if (outBy !== -1 && this.follows(info, engine, u) && this.outByOf(u, slot) === outBy) continue;
      const m = this.states.get(u)?.move;
      if (m && (m.dest === slot || m.through.includes(slot))) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => pieces.has(b.pieceId))) return u;
    }
    // (Any other train standing or running there, on the line or not: its first car stands for it.)
    for (const t of info.foreign) if (t.bogies.some((b) => pieces.has(b.pieceId))) return engineOf(t);
    return info.zone.slots.get(slot) ?? -1;
  }

  /**
   * May `engine`'s train follow `u`'s, going the same way, into a section or loop road it's in (or on its way to)? The one
   * ahead must go round a circuit from where it is (`circling`: it never comes to the end of the track, so never turns
   * back into the one behind), and both must have room. Then where one of them is a train on no line (`LineInfo.loose`):
   * a hand-run train goes on as the points lie and never stops at a slot for good, so token working with it is only to
   * keep the two from meeting head on (play-test 2026-11-01, src/play/bugmaps/route-stuck.txt: hand-run trains running
   * round a ring one behind another stood in one section together the moment a line came to manage it, each waiting on
   * the next, round the ring). And where both are routed trains each going round a circuit, and every train working
   * the track goes round one way (`LineInfo.oneWay`; the user, 2026-11-02: "let line trains on circuits follow each
   * other too"): a line's trains on a ring follow round as hand-run ones do.
   * Trains going the same way don't meet head on; the sim keeps the one behind back from the one ahead (`followCap`: the
   * gap while it moves, close behind once it stands). A train going the other way, or one that will turn back at a line
   * end (a convoy into a dead end), keeps single-line working: one to a section.
   */
  private follows(info: LineInfo, engine: number, u: number): boolean {
    if (!this.hasRoom(info, engine) || !this.hasRoom(info, u) || !this.circling(u)) return false;
    if (info.loose.includes(engine) || info.loose.includes(u)) return true;
    // (Two routed trains: only where nobody on the track could meet them head on. Else a train going round the other way
    // could wait for ever for a section the two never both leave: single-line working keeps it its turn.)
    return info.oneWay && this.circling(engine);
  }

  /** Could `engine`, asking with train `u` in its way, follow it (so it's worth working out its way: `follows`)? */
  private mayFollow(info: LineInfo, engine: number, u: number): boolean {
    if (info.loose.length > 0) return true;
    return info.oneWay && u >= 0 && info.users.includes(u) && this.circling(engine) && this.circling(u);
  }

  /**
   * Does train `u` go on round a circuit from where it is, never coming to the end of the track (so never turning back
   * into a train behind it)? Its way as the points lie (a train on no line), or as its route's plan takes it at points
   * leg by leg round its stops (a line's: `SectionsHost.lap`), followed till it comes back onto a piece the way it was
   * before with the same aim (a circuit: true) or to an end (false). Cached by its front, the layout, the points and its
   * aims.
   */
  private circling(u: number): boolean {
    return this.circuitOf(u)?.yes ?? false;
  }

  /** `circling`'s walk for train `u`: whether it circles, and the ends of pieces it comes in by and goes out by (null: no train). */
  private circuitOf(u: number): Circuit | null {
    const t = this.sim.findCar(u)?.train;
    if (!t) return null;
    const net = this.host.drive(t);
    if (net === 0) return NOT_CIRCLING;
    const f = this.front(t, net < 0);
    const aims = this.host.lineOf(u) >= 0 ? (this.host.lap?.(u) ?? [this.host.target(u)]) : NO_AIMS;
    if (this.host.lineOf(u) >= 0 && aims.length === 0) return NOT_CIRCLING;
    const key = `${f.pieceId}.${f.pathIndex}.${f.reversed ? 1 : 0}|${this.layout.revision}|${this.layout.switchesVersion}|${aims.join(",")}`;
    const hit = this.circlingOf.get(u);
    if (hit && hit.key === key) return hit.c;
    const c = this.circuitFrom(f, aims);
    this.circlingOf.set(u, { key, c });
    return c;
  }
  private readonly circlingOf = new Map<number, { key: string; c: Circuit }>();

  private circuitFrom(f: Cursor, aims: readonly number[]): Circuit {
    const { layout } = this;
    const piece = layout.getPiece(f.pieceId);
    if (!piece) return NOT_CIRCLING;
    const path = getPieceDef(piece.type, piece.flipped).paths[f.pathIndex];
    let at = f.pieceId;
    let exit = f.reversed ? path.from : (path.to ?? -1);
    const entry0 = f.reversed ? (path.to ?? 7) : path.from;
    const ins = new Set<number>([at * 8 + entry0]);
    const outs = new Set<number>([at * 8 + exit]);
    const n0 = Math.max(1, aims.length);
    let j = 0;
    const seen = new Set<number>([(at * 8 + entry0) * n0 + j]);
    for (let k = 0; k < SEARCH * n0; k++) {
      const n = next(layout, at, exit);
      if (!n) return NOT_CIRCLING;
      // (Come to its aim: on toward the one after.)
      for (let s = 0; s < aims.length && aims[j] === n.pieceId; s++) j = (j + 1) % aims.length;
      const ways = waysFrom(layout, n.pieceId, n.entry);
      if (ways.length === 0) return NOT_CIRCLING;
      const key = (n.pieceId * 8 + n.entry) * n0 + j;
      if (seen.has(key)) return { yes: true, ins, outs };
      seen.add(key);
      const target = aims.length > 0 ? aims[j] : -1;
      let w = ways[0];
      if (ways.length > 1) {
        const best = target < 0 ? -1 : planWay(layout, n.pieceId, n.entry, ways, target);
        w = best === -1 ? (ways[pointsWayFrom(layout, n.pieceId, n.entry, ways.length)] ?? ways[0]) : ways[best];
      }
      if (w.exit < 0) return NOT_CIRCLING;
      ins.add(n.pieceId * 8 + n.entry);
      outs.add(n.pieceId * 8 + w.exit);
      at = n.pieceId;
      exit = w.exit;
    }
    return NOT_CIRCLING;
  }

  /**
   * Do all these trains (a line's network's users) go round circuits that never run a piece the other way round from one
   * another (one coming in by an end another goes out by: they could meet head on)? Then they only ever follow one
   * another, and a line of them needs no passing loop per train (the room rule's loops + 1 isn't applied: `line`).
   */
  private oneWayRound(users: readonly number[]): boolean {
    const cs: Circuit[] = [];
    for (const u of users) {
      const c = this.circuitOf(u);
      if (!c) continue;
      if (!c.yes) return false;
      cs.push(c);
    }
    for (let a = 0; a < cs.length; a++)
      for (let b = a + 1; b < cs.length; b++) {
        for (const x of cs[a].ins) if (cs[b].outs.has(x)) return false;
        for (const x of cs[b].ins) if (cs[a].outs.has(x)) return false;
      }
    return true;
  }

  /**
   * Is train `u` going the same way along `along` (piece → the end it's come onto by) ahead: its front on it, not heading
   * out by the end `along` comes in by (the same way, or joining it at points), and any move it holds never along it
   * the other way round? False if its front isn't on it (it may be coming onto it from elsewhere, or standing across it).
   */
  private sameWayAhead(u: number, along: ReadonlyMap<number, number>): boolean {
    const t = this.sim.findCar(u)?.train;
    if (!t) return false;
    const net = this.host.drive(t);
    if (net === 0) return false;
    const f = this.front(t, net < 0);
    const piece = this.layout.getPiece(f.pieceId);
    if (!piece) return false;
    const path = getPieceDef(piece.type, piece.flipped).paths[f.pathIndex];
    let exit = f.reversed ? path.from : (path.to ?? -1);
    const e = along.get(f.pieceId);
    if (e !== undefined) {
      if (exit === e) return false;
    } else {
      // (Its front off the way: where it runs on to as the points lie, till it comes onto the way (the same way round,
      // or it's in the way) or runs out of look.)
      let at = f.pieceId;
      for (let k = 0; k < FOLLOW_LOOK; k++) {
        const n = next(this.layout, at, exit);
        if (!n) break;
        const ways = waysFrom(this.layout, n.pieceId, n.entry);
        if (ways.length === 0) break;
        const w = ways[pointsWayFrom(this.layout, n.pieceId, n.entry, ways.length)] ?? ways[0];
        const on = along.get(n.pieceId);
        if (on !== undefined) {
          if (w.exit === on) return false;
          break;
        }
        at = n.pieceId;
        exit = w.exit;
      }
    }
    const m = this.states.get(u)?.move;
    return !m || !m.steps.some((s) => along.get(s.pieceId) === this.exitOf(s));
  }

  /**
   * Is train `u`, on no line, going round a circuit with no move held, clear of a way (`along`: piece → the end it's come
   * onto by): not on it, and never running a piece of it the other way round (coming at it head on)? Then it isn't in
   * that way, though it's in the section: a ring is one section, and a train going round it non-stop would keep it for
   * good (2026-11-05, the town-ring fuzz: a routed train waiting in a loop to go round the other way stood for ever).
   * Going the same way it only ever follows, or is followed, and the sim keeps them apart.
   */
  private clearOfCircling(u: number, along: ReadonlyMap<number, number>): boolean {
    if (this.states.get(u)?.move) return false;
    const c = this.circuitOf(u);
    if (!c?.yes) return false;
    const t = this.sim.findCar(u)?.train;
    if (!t || t.bogies.some((b) => along.has(b.pieceId))) return false;
    for (const [p, e] of along) if (c.outs.has(p * 8 + e)) return false;
    return true;
  }

  /**
   * A train's way from `start` as steering would take it (the plan's way at points to its stop, a switch under it as it
   * lies), up to its stop's piece, a slot, or the end: piece → the end it comes onto it by. For a way that reaches no
   * slot (`wayOn` null), so a train going round a ring can be judged clear of it (`clearOfCircling`).
   */
  private walkAlong(st: TrainState, start: { pieceId: number; entry: number }, topo: Topology): Map<number, number> {
    const { layout } = this;
    const out = new Map<number, number>();
    const target = this.host.target(st.engine);
    const keep = this.host.keep?.(st.engine);
    const own = this.sim.findCar(st.engine)?.train;
    let at: { pieceId: number; entry: number } | null = start;
    for (let k = 0; at && k < SEARCH && !out.has(at.pieceId); k++) {
      out.set(at.pieceId, at.entry);
      if (at.pieceId === target || topo.slotOf.has(at.pieceId)) break;
      const ways = waysFrom(layout, at.pieceId, at.entry);
      if (ways.length === 0) break;
      let w = ways[0];
      const p = at.pieceId;
      const under = own?.bogies.find((b) => b.pieceId === p);
      if (ways.length > 1 && under) w = ways.find((x) => x.path === under.pathIndex) ?? w;
      else if (ways.length > 1) {
        const best = target < 0 ? -1 : planWay(layout, at.pieceId, at.entry, ways, target, undefined, keep?.(at.pieceId, at.entry, target));
        w = best === -1 ? (ways[pointsWayFrom(layout, at.pieceId, at.entry, ways.length)] ?? ways[0]) : ways[best];
        w = this.outOfDeadEnd(own, at, ways, w, best === -1 ? -1 : target);
      }
      at = next(layout, at.pieceId, w.exit);
    }
    return out;
  }

  /** The end a step leaves its piece by (−1: a buffer). */
  private exitOf(s: Step): number {
    const piece = this.layout.getPiece(s.pieceId);
    if (!piece) return -1;
    const path = getPieceDef(piece.type, piece.flipped).paths[s.path];
    return path.from === s.entry ? (path.to ?? -1) : path.from;
  }

  /**
   * A way's steps, and on through the slot it comes to (the one road the points send it onto), as piece → the end each
   * is come onto by.
   */
  private alongOf(steps: readonly Step[], topo: Topology, intoSlot = true): Map<number, number> {
    const out = new Map<number, number>();
    for (const s of steps) if (!out.has(s.pieceId)) out.set(s.pieceId, s.entry);
    const last = steps[steps.length - 1];
    if (!last || !intoSlot) return out;
    let at = next(this.layout, last.pieceId, this.exitOf(last));
    const slot = at ? topo.slotOf.get(at.pieceId) : undefined;
    for (let k = 0; at && slot !== undefined && k < SEARCH && topo.slotOf.get(at.pieceId) === slot && !out.has(at.pieceId); k++) {
      out.set(at.pieceId, at.entry);
      const ways = waysFrom(this.layout, at.pieceId, at.entry);
      if (ways.length !== 1) break;
      at = next(this.layout, at.pieceId, ways[0].exit);
    }
    return out;
  }

  /**
   * The first other train on a way (`along`: piece → the end it's come onto by), or holding a move over it, that isn't
   * going the same way ahead (`sameWayAhead`): one coming at a train taking that way head on. −1: none.
   */
  private comingAt(engine: number, info: LineInfo, along: ReadonlyMap<number, number>): number {
    if (along.size === 0) return -1;
    for (const u of info.users) {
      if (u === engine) continue;
      const t = this.sim.findCar(u)?.train;
      const m = this.states.get(u)?.move;
      const on = !!t && t.bogies.some((b) => along.has(b.pieceId));
      if ((on || !!m?.steps.some((x) => along.has(x.pieceId))) && !this.sameWayAhead(u, along)) return u;
    }
    for (const t of info.foreign) if (t.bogies.some((b) => along.has(b.pieceId)) && !this.sameWayAhead(engineOf(t), along)) return engineOf(t);
    return -1;
  }

  /** Is train `u` under way (moving, or holding a move)? */
  private underWay(u: number): boolean {
    return (this.sim.findCar(u)?.train.speed ?? 0) >= 1 || !!this.states.get(u)?.move;
  }

  /** Does train `u` stand waiting, held by sections, on `engine` (directly, or along a chain of such waits)? */
  private waitsFor(u: number, engine: number): boolean {
    const seen = new Set<number>();
    for (let x = u; !seen.has(x); ) {
      seen.add(x);
      const w = this.states.get(x);
      if (!w || w.move || !w.wait || !("engine" in w.wait)) return false;
      if (w.wait.engine === engine) return true;
      x = w.wait.engine;
    }
    return false;
  }

  /** The switch train `u` leaves loop road `slot` by. */
  private outByOf(u: number, slot: number): number {
    const st = this.states.get(u);
    if (st?.move && st.move.dest === slot) return st.move.outBy;
    return st?.outBy ?? -1;
  }

  /**
   * The train of the line (other than `engine`) holding a move through a section, or standing in it; −1 if none.
   * `along` (its way through the section, piece → the end it comes onto it by): one it may follow (`follows`) going the
   * same way ahead of it there isn't in its way, and is passed over.
   */
  private sectionUser(info: LineInfo, section: number, engine: number, along?: ReadonlyMap<number, number>, standing?: ReadonlySet<number>): number {
    for (const u of info.users) {
      if (u === engine) continue;
      // (Standing in the section with no room (`heldIn`), off its way: not in it.)
      if (along && standing && this.offWay(u, along, standing)) continue;
      if (along && this.follows(info, engine, u) && this.sameWayAhead(u, along)) continue;
      if (along && info.loose.includes(u) && this.clearOfCircling(u, along)) continue;
      // (Coming out of a dead end: a train standing outside, waiting to go in, isn't in its way unless it stands on its
      // way out (it takes a road clear of one facing it: `outOfDeadEnd`); one ahead the same way, it follows.)
      if (along && this.standing(u) && this.comingOut(engine) && this.clearOrAhead(u, along)) continue;
      const m = this.states.get(u)?.move;
      if (m && m.sections.includes(section)) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) return u;
    }
    // (A train not working the track (standing, on no line or another's): in the way only on its way, once that's
    // known (`along`). A section can be most of the map: #29, "blocked by a train all the way on the other side".)
    for (const t of info.foreign) if (t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section && (!along || along.has(b.pieceId)))) return engineOf(t);
    return info.zone.sections.get(section) ?? -1;
  }

  /** Ask for the move on from its slot: true if granted (or nothing to ask). */
  private ask(st: TrainState, info: LineInfo): boolean {
    const topo = info.topo;
    if (st.exitPiece === -1) return true;
    // (At a waiting point whose signal the player holds at red: it asks for nothing past it, so it holds nothing
    // ahead; the sim stands it at the signal, and its card says why (signals spec §3.3, §6). Not a wait on a train.)
    const here = st.slot >= 0 ? topo.slots[st.slot] : undefined;
    const hereWay = here?.kind === "signal" ? signalWayOut(here, connectorRef(st.exitPiece, st.exitEntry)) : undefined;
    if (hereWay && this.layout.signalAt(hereWay.mark)?.held) {
      st.wait = null;
      st.waitSince = -1;
      return false;
    }
    const section = topo.sectionOf.get(st.exitPiece);
    // (Out of a waiting point straight into another slot (signals closer together than a section): a move to it, with
    // no section between.)
    if (section === undefined && topo.slotOf.get(st.exitPiece) === undefined) return true;
    if (!this.hasRoom(info, st.engine)) {
      this.hold(st, this.roomWait(st, info));
      return false;
    }
    let u = section === undefined ? -1 : this.sectionUser(info, section, st.engine);
    // (Only trains the line has no room for standing in it: a dead end short of them; it waits here for them.)
    const short = u === -1 || section === undefined ? null : this.heldIn(info, section, st.engine);
    // (Trains on no line about: those in it going its way ahead of it, it may follow (`follows`).)
    let along: Map<number, number> | undefined;
    let ahead: Way | null = null;
    if (u !== -1 && !short && (this.mayFollow(info, st.engine, u) || this.comingOut(st.engine) || !info.users.includes(u))) {
      ahead = this.wayOn(st, info, { pieceId: st.exitPiece, entry: st.exitEntry });
      if (ahead && ahead.dest !== DEAD_END) {
        along = this.alongOf(ahead.steps, topo);
        u = this.sectionUser(info, section!, st.engine, along);
      } else if (!ahead && (info.loose.includes(u) || this.comingOut(st.engine) || !info.users.includes(u))) {
        // (Its way reaches no slot (its stop on a ring): walked to its stop, for a train on no line going round there
        // to be in its way only if it's on it, or comes at it head on: `clearOfCircling`.)
        along = this.walkAlong(st, { pieceId: st.exitPiece, entry: st.exitEntry }, topo);
        u = this.sectionUser(info, section!, st.engine, along);
      }
    }
    if (u !== -1 && !short) {
      this.hold(st, { kind: "section", engine: u });
      return false;
    }
    const way = ahead ?? this.wayOn(st, info, { pieceId: st.exitPiece, entry: st.exitEntry }, -1, short);
    if (short && way?.dest !== DEAD_END) {
      // (Its way doesn't run into them (standing, with no room or not on the line): they're not in its way. Any other
      // train on it, or coming, is: #29, a train parked across the map held every move through the one big section.)
      const v = way ? this.sectionUser(info, section!, st.engine, along ?? this.alongOf(way.steps, topo), short) : u;
      if (v !== -1) {
        this.hold(st, { kind: "section", engine: v });
        return false;
      }
    }
    // A dead end ahead (a train its line has no room for in the way): it waits here, in its slot, for that train.
    if (way?.dest === DEAD_END) return this.deadEndWait(st, info, way);
    // (Running through a loop that's no passing place: the sections beyond it must be free too.)
    if (way && way.dest !== -1)
      for (const x of way.sections) {
        const v = x === section ? -1 : this.sectionUser(info, x, st.engine, along ?? (info.loose.length > 0 || (info.oneWay && this.circling(st.engine)) ? (along = this.alongOf(way.steps, topo)) : undefined));
        if (v !== -1) {
          this.hold(st, { kind: "section", engine: v });
          return false;
        }
      }
    // (No slot ahead on this way: not one of the line's ways; left alone.)
    if (!way) return true;
    if (way.dest === -1) {
      this.hold(st, { kind: "slot", engine: way.blockedBy });
      return false;
    }
    // (First come, first served: a train that has waited long for this stretch or this loop goes first.)
    const first = this.firstCome(st, info, way);
    if (first !== -1) {
      this.hold(st, { kind: "section", engine: first });
      return false;
    }
    this.grant(st, way);
    return true;
  }

  /**
   * Does a train on no line, its lever on, run into the line's track (`regions`) within `COMES_INTO` pieces ahead, the
   * way the points lie (as it will run: it has no route to set them)? Then it works the line's single track from there,
   * asking for the way short of the points it comes on by, not once it's on them (stalls-verify 2026-11-10, fuzz seed
   * 161: one coming out of a siding was held with its front on the points, the line's only way through, and the line's
   * train stood for good). The user's rule: points are never a place to wait.
   */
  private comesInto(t: Train, topo: Topology, regions: ReadonlySet<number>): boolean {
    const front = this.front(t, this.host.drive(t) < 0);
    const piece = this.layout.getPiece(front.pieceId);
    if (!piece) return false;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    let at = { p: front.pieceId, exit: front.reversed ? path.from : (path.to ?? -1) };
    for (let i = 0; i < COMES_INTO; i++) {
      const n = next(this.layout, at.p, at.exit);
      if (!n) return false;
      if (regions.has(regionOf(topo, n.pieceId) ?? NaN)) return true;
      const way = waysFrom(this.layout, n.pieceId, n.entry, LIES)[0];
      if (!way || way.exit < 0) return false;
      at = { p: n.pieceId, exit: way.exit };
    }
    return false;
  }

  /**
   * First come, first served (routing spec §5 rule 4, for sections and slots): a train of the line's network that has
   * stood waiting at its slot's end `FIRST_COME_S` or more, and longer than this one, keeps what it waits for: the
   * sections of its way and the loop (or line end) it goes to. A later ask for any of them waits for it (−1: none such).
   * Without this a train going round non-stop could take the one free loop road each time it came by, and one waiting
   * for that road stood for good (`ringLinesBothWays`). Not for one that waits, by way of others or not, for this one,
   * nor one whose way runs into the slot this one stands in: then this one must go first.
   */
  private firstCome(st: TrainState, info: LineInfo, way: Way): number {
    if (!this.fair) return -1;
    // (Only between trains on passing loops' roads, for a loop road: what one going round non-stop takes each time.)
    const topo = info.topo;
    if (st.slot < 0 || topo.slots[st.slot]?.kind !== "road" || way.dest < 0 || topo.slots[way.dest]?.kind !== "road") return -1;
    const now = this.sim.ticks;
    const mine = st.wait && st.waitSince >= 0 ? st.waitSince : now;
    let best = -1;
    let bestSince = Infinity;
    for (const u of info.users) {
      if (u === st.engine) continue;
      const w = this.states.get(u);
      if (!w || w.move || !w.wait || w.slot < 0 || w.exitPiece < 0 || w.waitSince < 0 || topo.slots[w.slot]?.kind !== "road") continue;
      if (w.wait.kind !== "section" && w.wait.kind !== "slot") continue;
      if (now - w.waitSince < FIRST_COME_S * 120 || w.waitSince >= mine || w.waitSince >= bestSince) continue;
      // (Waiting on this one by way of others: this one goes first. Straight on this one is fine: what this one holds
      // of the stretch is let go behind it, and the slot it stands in is looked at below.)
      if (!this.hasRoom(info, u) || (w.wait.engine !== st.engine && this.waitsFor(u, st.engine))) continue;
      const theirs = this.wantOf(w, info);
      if (!theirs || (st.slot >= 0 && theirs.slots.includes(st.slot))) continue;
      if (theirs.slots.includes(way.dest)) {
        best = u;
        bestSince = w.waitSince;
      }
    }
    return best;
  }

  /** What a waiting train wants (`firstCome`): the sections of its way on, and the slots it could go to at its end. */
  private wantOf(w: TrainState, info: LineInfo): { sections: readonly number[]; slots: readonly number[] } | null {
    const hit = this.wants.get(w.engine);
    if (hit && hit.tick === w.askedAt && hit.topo === info.topo) return hit.want;
    const way = this.wayOn(w, info, { pieceId: w.exitPiece, entry: w.exitEntry });
    let want: { sections: readonly number[]; slots: readonly number[] } | null = null;
    if (way && way.dest !== DEAD_END) {
      const topo = info.topo;
      let slots: number[] = [];
      if (way.dest >= 0) {
        const d = topo.slots[way.dest];
        slots = d.kind === "road" ? [...topo.loops[d.loop].roads] : [way.dest];
      } else {
        // (Held short of the slot: the one the way comes to, and for a loop road both its roads.)
        const last = way.steps[way.steps.length - 1];
        const pw = last ? waysFrom(this.layout, last.pieceId, last.entry).find((x) => x.path === last.path) : undefined;
        const n = last && pw ? next(this.layout, last.pieceId, pw.exit) : null;
        const sl = n ? topo.slotOf.get(n.pieceId) : undefined;
        if (sl !== undefined) slots = topo.slots[sl].kind === "road" ? [...topo.loops[topo.slots[sl].loop].roads] : [sl];
      }
      want = { sections: way.sections, slots };
    }
    this.wants.set(w.engine, { tick: w.askedAt, topo: info.topo, want });
    return want;
  }
  private readonly wants = new Map<number, { tick: number; topo: Topology; want: { sections: readonly number[]; slots: readonly number[] } | null }>();

  /** In a section with no move: the rest of its way to the slot ahead, unless a train of its line is on it, or coming. */
  private recover(st: TrainState, info: LineInfo, train: Train, front: Cursor): boolean {
    const { layout } = this;
    const piece = layout.getPiece(front.pieceId);
    if (!piece) return true;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    const entry = front.reversed ? (path.to ?? -1) : path.from;
    const mine = new Set(train.bogies.map((b) => b.pieceId));
    // (Trains with no room standing in this section are the end of the line for one that has room: a dead end short
    // of them; it waits where it stands for them.)
    const section = info.topo.sectionOf.get(front.pieceId);
    const short = this.hasRoom(info, st.engine) && section !== undefined ? this.heldIn(info, section, st.engine) : null;
    if (short) for (const p of mine) short.delete(p);
    const way = this.wayOn(st, info, { pieceId: front.pieceId, entry }, front.pathIndex, short && short.size > 0 ? short : null);
    if (!way) return true;
    if (way.dest === DEAD_END) return this.deadEndWait(st, info, way);
    const ahead = new Set(way.steps.map((s) => s.pieceId));
    let along = info.loose.length > 0 || (info.oneWay && this.circling(st.engine)) ? this.alongOf(way.steps, info.topo) : null;
    for (const u of info.users) {
      if (u === st.engine) continue;
      const t = this.sim.findCar(u)?.train;
      if (!t || (short && !this.hasRoom(info, u))) continue;
      // On its way ahead. (Unless it may follow it, going its way: see `follows`.)
      if (t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) {
        if (along && this.follows(info, st.engine, u) && this.sameWayAhead(u, along)) continue;
        // (Coming out of a dead end: one standing ahead the same way, it follows.)
        if (this.standing(u) && this.comingOut(st.engine) && this.sameWayAhead(u, along ?? (along = this.alongOf(way.steps, info.topo)))) continue;
        return this.recoverWait(st, u, info);
      }
      // Coming the other way through it (its move's way runs over where this one stands, the other way round).
      const m = this.states.get(u)?.move;
      // (With one it may follow, only one heading out by the end it comes in by: two coming together at points the same
      // way only follow.)
      const exact = along !== null && this.follows(info, st.engine, u);
      if (m && m.sections.some((x) => way.sections.includes(x)) && m.steps.some((s) => mine.has(s.pieceId) && way.steps.some((w) => w.pieceId === s.pieceId && (exact ? this.exitOf(s) === w.entry : w.entry !== s.entry)))) return this.recoverWait(st, u, info);
    }
    // (A train not on the line running on its way ahead: wait for it, as for one of the line's.)
    for (const t of info.foreign) if (t.speed >= 1 && t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) return this.recoverWait(st, engineOf(t), info);
    if (way.dest === -1) {
      // (Held at a dead end's mouth: its way up to there is clear (nothing above stopped it); it comes up to the points
      // outside the mouth and stands short of them.)
      if (way.mouth) st.edge = this.edgeOn(way.steps);
      return this.recoverWait(st, way.blockedBy !== -1 ? way.blockedBy : this.inWayOf(way, train, info), info);
    }
    this.grant(st, way);
    return true;
  }

  /**
   * The train in a way it can't take, when the way-finder doesn't name one: the first other train (of the line or
   * not) on its steps or in the slot it would go to; −1 if none.
   */
  private inWayOf(way: Way, own: Train, info: LineInfo): number {
    const pieces = new Set(way.steps.map((x) => x.pieceId));
    for (const r of [...way.through, way.dest]) if (r >= 0) for (const p of info.topo.slots[r]?.pieces ?? []) pieces.add(p);
    const t = trainOn(this.sim, pieces, { except: own });
    return t ? engineOf(t) : -1;
  }

  /**
   * A dead end ahead (see `DEAD_END`): it holds nothing new and waits where it is for the train its line has no room for
   * (never turning back short of it, routing spec §16 Q3). Its stops past it can't be reached while the line is full.
   */
  private deadEndWait(st: TrainState, info: LineInfo, way: Way): false {
    st.lastDead = way.deadEnd ?? null;
    // (One the line has no room for is held for that: its card says how many loops to lay.)
    this.hold(st, this.hasRoom(info, st.engine) ? { kind: "slot", engine: way.blockedBy } : this.roomWait(st, info));
    return false;
  }

  /** The first train standing (not running) with an axle on `pieces`, other than `own`, by its name; −1: none. */
  private standingOn(pieces: ReadonlySet<number>, own: Train | undefined): number {
    const t = trainOn(this.sim, pieces, { except: own, standing: true });
    return t ? engineOf(t) : -1;
  }

  /** The first train of the line it has no room for (other than `engine`), standing on the track; −1: none. */
  private heldOf(info: LineInfo, engine: number): number {
    for (const u of info.users) if (u !== engine && !this.hasRoom(info, u) && this.sim.findCar(u)) return u;
    return -1;
  }

  /** A train in a section waits for `u` (a mutual wait is a stall: nothing lets either go, see stalls.ts). */
  private recoverWait(st: TrainState, u: number, info?: LineInfo): boolean {
    // (A train the line has no room for stays where it is, held: the others treat it as the end of the line.)
    if (info && !this.hasRoom(info, st.engine)) {
      this.hold(st, this.roomWait(st, info));
      return false;
    }
    this.hold(st, { kind: "section", engine: u });
    return false;
  }

  private hold(st: TrainState, wait: BlockWait): void {
    if (!st.wait) st.waitSince = this.sim.ticks;
    st.wait = wait;
    this.refused++;
  }

  private grant(st: TrainState, way: Way): void {
    const keys = new Set(way.steps.map((s) => s.pieceId * 8 + s.path));
    let aim = way.steps.length > 0 ? way.steps[way.steps.length - 1].pieceId : -1;
    if (way.dest >= 0)
      for (const p of st.topo.slots[way.dest].pieces) {
        aim = p;
        break;
      }
    st.move = { sections: way.sections, through: way.through, dest: way.dest, outBy: way.outBy, steps: way.steps, follow: (pieceId, path) => keys.has(pieceId * 8 + path), aim, since: this.sim.ticks };
    st.wait = null;
    st.waitSince = -1;
    this.granted++;
    this.steerSoon.add(st.engine);
  }

  /**
   * The train standing in (or coming to) the waiting point of the signal at this joint end (`Signal.at`), going its way,
   * with no move granted on past it: −1 if none. The sim shows that signal red then, so the green the player sees is
   * sections' grant (signals spec §3.2). Worked out once a tick, from where trains are as sections last looked.
   */
  gateAt(ref: number): number {
    this.refreshGate();
    return this.gate.get(ref) ?? -1;
  }

  /** Goes up whenever `gateAt` would answer differently (the sim's aspects are worked out again only then). */
  gateVersion(): number {
    this.refreshGate();
    return this.gateVer;
  }

  private refreshGate(): void {
    if (this.gateTick === this.sim.ticks) return;
    this.gateTick = this.sim.ticks;
    const now = this.gateNext;
    now.clear();
    if (this.enabled && this.layout.signalCount > 0)
      for (const st of this.states.values()) {
        if (st.slot < 0 || st.exitPiece < 0) continue;
        const sl = st.topo.slots[st.slot];
        if (!sl) continue;
        // (A waiting point's signal; or a signal the player put at the far end of another slot (a loop road's, a line
        // end's), facing out of it: held at its end, the train is held at that signal too, and it shows red to it.)
        let mark = sl.kind === "signal" ? (signalWayOut(sl, connectorRef(st.exitPiece, st.exitEntry))?.mark ?? -1) : -1;
        if (sl.kind !== "signal") {
          const at = this.layout.joinedConnector(connectorRef(st.exitPiece, st.exitEntry));
          if (at !== -1 && sl.pieces.has(pieceOfRef(at)) && this.layout.signalAt(at)) mark = at;
        }
        if (mark === -1 || this.ownsAhead(st)) continue;
        const t = this.sim.getTrain(st.trainId);
        if (!t || t.derailed || !t.bogies.some((b) => sl.pieces.has(b.pieceId))) continue;
        now.set(mark, t.id);
      }
    let same = now.size === this.gate.size;
    if (same) for (const [k, v] of now) if (this.gate.get(k) !== v) same = false;
    if (same) return;
    this.gateNext = this.gate;
    this.gate = now;
    this.gateVer++;
  }
  private gateTick = -1;
  private gateVer = 0;
  private gate = new Map<number, number>();
  private gateNext = new Map<number, number>();

  /**
   * Where a signal would let a line's trains follow each other (signals spec §7): a train of a line standing at its
   * slot's end for `FOLLOW_HINT_S` or more, waiting for a train of its line that's going the same way through the stretch
   * ahead, on a stretch long enough to split (plain track for the longest train, and room, either side of a joint). The
   * joint end nearest the middle of that run (facing the way they go), or −1. Looked at by the game now and then (once
   * a second, till told).
   */
  followSpot(): number {
    if (!this.enabled) return -1;
    for (const st of this.states.values()) {
      const w = st.wait;
      if (!w || (w.kind !== "section" && w.kind !== "slot") || st.slot < 0 || st.exitPiece < 0 || st.waitSince < 0) continue;
      const line = this.host.lineOf(st.engine);
      if (line < 0 || this.host.lineOf(w.engine) !== line) continue;
      const info = this.lineInfo.get(line);
      if (!info?.managed) continue;
      const way = this.wayOn(st, info, { pieceId: st.exitPiece, entry: st.exitEntry });
      if (!way) continue;
      // (The one it waits for: going through the stretch ahead its way, or the other way, as its move has it.)
      const lead = this.states.get(w.engine)?.move;
      let same = false;
      let against = false;
      if (lead)
        for (const x of lead.steps) {
          const y = way.steps.find((z) => z.pieceId === x.pieceId);
          if (!y) continue;
          if (y.entry === x.entry) same = true;
          else against = true;
        }
      // (Seen going ahead its way during this wait: noted, by when the wait began.)
      if (same && !against) this.sawLead.set(st.engine, st.waitSince);
      if (this.sawLead.get(st.engine) !== st.waitSince || this.sim.ticks - st.waitSince < FOLLOW_HINT_S * SIM_HZ) continue;
      // (Not one coming back toward it now: into its slot or its loop, or through the stretch the other way.)
      if (lead) {
        const here = st.topo.slots[st.slot];
        const dest = lead.dest >= 0 ? st.topo.slots[lead.dest] : undefined;
        if (against || lead.dest === st.slot || lead.through.includes(st.slot) || (dest && here.kind === "road" && dest.kind === "road" && dest.loop === here.loop)) continue;
      }
      let longest = 0;
      for (const u of info.users) {
        const t = this.sim.findCar(u)?.train;
        if (t) longest = Math.max(longest, trainLength(t));
      }
      const spot = this.splitAt(way.steps, longest + ROAD_MARGIN);
      if (spot !== -1) return spot;
    }
    return -1;
  }

  /** Trains seen waiting while the train they wait for went ahead their way (by engine: that wait's start, `waitSince`). */
  private readonly sawLead = new Map<number, number>();

  /** The joint end along these steps with plain track at least `need` either side, nearest the middle; −1: none. */
  private splitAt(steps: readonly Step[], need: number): number {
    const { layout } = this;
    const len: number[] = [];
    const plain: boolean[] = [];
    for (const x of steps) {
      plain.push(!branches(layout, x.pieceId));
      len.push(lengthOfPath(layout, x.pieceId, x.path));
    }
    const before: number[] = [];
    let run = 0;
    for (let k = 0; k < steps.length; k++) {
      run = plain[k] ? run + len[k] : 0;
      before.push(run);
    }
    const after: number[] = new Array(steps.length).fill(0);
    run = 0;
    for (let k = steps.length - 1; k >= 0; k--) {
      after[k] = run;
      run = plain[k] ? run + len[k] : 0;
    }
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < steps.length - 1; k++) {
      if (!plain[k] || before[k] < need || after[k] < need) continue;
      const w = waysFrom(layout, steps[k].pieceId, steps[k].entry).find((x) => x.path === steps[k].path);
      if (!w) continue;
      const ref = connectorRef(steps[k].pieceId, w.exit);
      if (layout.signalAt(ref)) continue;
      const d = Math.abs(before[k] - after[k]);
      if (d < bestD) {
        bestD = d;
        best = ref;
      }
    }
    return best;
  }

  /** Steering for a train holding a move: its way (`follow`), aimed at a piece of the slot it goes to. */
  steerHint(engine: number): { follow: AvoidTest; aim: number } | undefined {
    if (!this.enabled) return undefined;
    const m = this.states.get(engine)?.move;
    return m && m.aim !== -1 ? { follow: m.follow, aim: m.aim } : undefined;
  }

  /**
   * Is this a train of a line sections manage, with no move granted (routing §5.2)? It sets no points: only a granted
   * move's train does, so a train held on a branch never throws the points under another's move (QA B1).
   */
  awaitingGrant(engine: number): boolean {
    if (!this.enabled) return false;
    const st = this.states.get(engine);
    return !!st && !st.move;
  }

  /**
   * How full the engine's line is: trains it has no room for (and so how many more passing loops it needs), and its
   * trains; null if it has room for all of them (or isn't managed).
   */
  fullness(engine: number): { more: number; trains: number; spare: boolean; parked: boolean; other: boolean; pinned: boolean } | null {
    if (!this.enabled) return null;
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return null;
    const info = this.line(lineId);
    return info.managed && info.more > 0 ? { more: info.more, trains: info.engines.length, spare: info.spareCut, parked: info.parked, other: info.other, pinned: this.loopCount.get(lineId)?.pinnedLoop ?? false } : null;
  }

  /**
   * A train not on the engine's line standing on a road of one of its line's passing loops: the one to move (its name in
   * waits, a parked one before one with its lever on); −1 for none. For cards (who's in the way), not per tick.
   */
  spareOn(engine: number): number {
    if (!this.enabled) return -1;
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return -1;
    const info = this.line(lineId);
    const loops = this.loopCount.get(lineId);
    if (!info.managed || !loops) return -1;
    const { topo, set } = loops;
    let found = -1;
    for (const t of info.foreign) {
      if (t.speed >= 1) continue;
      const onRoad = t.bogies.some((x) => {
        const sl = topo.slotOf.get(x.pieceId);
        return sl !== undefined && topo.slots[sl].kind === "road" && set.has(topo.slots[sl].loop);
      });
      if (!onRoad) continue;
      if (this.host.drive(t) === 0) return engineOf(t);
      if (found === -1) found = engineOf(t);
    }
    return found;
  }

  /** Is the stop it's heading for beyond a train its line has no room for (it will wait short of it)? */
  unreachable(engine: number): boolean {
    const st = this.states.get(engine);
    if (!st) return false;
    const target = this.host.target(engine);
    // (Its stop held by a train of its line it has no room for, standing there: it can't get in.)
    if (this.heldAt(engine, target)) return true;
    // (Past a dead end it has waited short of, while its line is still full.)
    if (!st.lastDead) return false;
    if (!this.fullness(engine)) {
      st.lastDead = null;
      return false;
    }
    return st.lastDead.has(target);
  }

  /**
   * The train (its id) a train on no line stands short of where a line is managed (`clearCap`), waiting for it however
   * long; null: none.
   */
  clearWait(trainId: number): number | null {
    const c = this.clearBy.get(trainId);
    return c && c.tick >= this.sim.ticks - 1 && this.sim.getTrain(c.by) ? c.by : null;
  }

  /** Why a train is held (null: it isn't). */
  waitOf(engine: number): BlockWait | null {
    if (!this.enabled) return null;
    const w = this.states.get(engine)?.wait ?? null;
    // (Let in since it was held: no longer held for room, though it hasn't asked again yet.)
    if (w?.kind === "room") {
      const lineId = this.host.lineOf(engine);
      if (lineId >= 0 && this.line(lineId).admitted.has(engine)) return null;
    }
    return w;
  }

  /** Where a train's front is (a slot id, or −1 in a section) and its move, for tests. */
  stateOf(engine: number): { slot: number; move: { section: number; dest: number } | null; exit: number; beyond: number } | null {
    const st = this.states.get(engine);
    return st ? { slot: st.slot, move: st.move ? { section: st.move.sections[0], dest: st.move.dest } : null, exit: st.exitPiece, beyond: Math.round(st.beyond) } : null;
  }

  /** A line's trains, topology, loops and the trains it takes (looked at once a tick). */
  private line(lineId: number): LineInfo {
    if (this.lineTick !== this.sim.ticks) {
      this.lineTick = this.sim.ticks;
      this.lineInfo.clear();
    }
    let info = this.lineInfo.get(lineId);
    if (info) return info;
    const engines = this.host.live(lineId);
    // (Just come onto it, in the order of their ids when several come at once: the newest last. The line first looked at,
    // those it had already, as a save keeps them (`restorePlace`), aren't new: the same one stays the newest, and its
    // player isn't told again.)
    const was = this.seenOn.get(lineId);
    const fresh = engines.filter((e) => (was !== undefined && !was.has(e)) || !this.joinedAt.has(e)).sort((a, b) => a - b);
    for (const e of fresh) this.joinedAt.set(e, ++this.joins);
    if (fresh.length > 0 || !was || was.size !== engines.length) this.seenOn.set(lineId, new Set(engines));
    let longest = 0;
    for (const e of engines) {
      // (Car ids grow as trains are put down: the order they came to the track.)
      if (!this.firstSeen.has(e)) this.firstSeen.set(e, e);
      const t = this.sim.findCar(e)?.train;
      if (t) longest = Math.max(longest, trainLength(t));
    }
    // (Sharing its network with other lines: one topology for them all (for the longest train of any), and their trains
    // work the single track with its own.)
    const net = this.network().get(lineId);
    const topo = net ? net.topo : topologyOf(this.layout, longest);
    // (A line of one train with only signals' waiting points on its ways, sharing a network with a line managed here: it
    // takes its turns with theirs (`turns`). Else it was a train not on their line, never asked to wait, and one of
    // theirs whose way it kept crossing waited for good: 2026-11-06, a mill's hopper shuttle and a towns line.)
    const turns = (l: number) => !!net && this.host.live(l).length === 1 && net.lines.some((x) => x !== l && this.loopsOn(x, topo) >= 0);
    const loops = engines.length >= 2 || net || (this.shared && engines.length === 1 && this.sim.trainCount > 1) ? this.loopsOn(lineId, topo, turns(lineId)) : -1;
    const peers: number[] = [];
    if (net && loops >= 0) for (const l of net.lines) if (l !== lineId && this.loopsOn(l, topo, turns(l)) >= 0) peers.push(...this.host.live(l));
    // (Trains on no line with their levers on, on the network's slots and sections: they work its single track too.)
    // (And those about to come onto them, short of the points: `comesInto`.)
    const loose: number[] = [];
    const looseTrains: Train[] = [];
    if (this.shared && loops >= 0 && this.sim.trainCount > engines.length + peers.length) {
      const regions = new Set<number>(this.loopCount.get(lineId)?.regions ?? EMPTY);
      if (net) for (const l of net.lines) for (const r of this.loopCount.get(l)?.regions ?? EMPTY) regions.add(r);
      for (const t of this.sim.trains()) {
        if (t.derailed || this.host.drive(t) === 0 || !t.cars.some((c) => c.kind === "engine")) continue;
        if (t.cars.some((c) => c.kind === "engine" && this.host.lineOf(c.id) >= 0)) continue;
        if (!t.bogies.some((b) => regions.has(regionOf(topo, b.pieceId) ?? NaN)) && !this.comesInto(t, topo, regions)) continue;
        loose.push(engineOf(t));
        looseTrains.push(t);
      }
    }
    const managed = loops >= 0 && (engines.length >= 2 || peers.length > 0 || loose.length > 0);
    let admitted: Set<number> = new Set();
    let blocked: ReadonlySet<number> = EMPTY;
    let foreign: Train[] = [];
    let more = 0;
    let spareCut = false;
    let parked = false;
    let other = false;
    let oneWay = false;
    if (managed) {
      // Every other train on the track (another line's, or one standing on its own) is in the way where it stands.
      const mine = new Set([...engines, ...peers].map((e) => this.sim.findCar(e)?.train.id ?? -1));
      for (const t of looseTrains) mine.add(t.id);
      for (const t of this.sim.trains()) if (!t.derailed && !mine.has(t.id)) foreign.push(t);
      // Which trains it has room for: kept once given (a train is never left without room mid-way), more let in as
      // room allows, in the order they came to the line. Room: a train more than its passing loops (and one more for
      // its two ends: `roomOf`), less the loops a standing train it has no room for (or one not on the line) takes a
      // road of.
      admitted = this.admitted.get(lineId) ?? new Set();
      this.admitted.set(lineId, admitted);
      for (const e of [...admitted]) if (!engines.includes(e)) admitted.delete(e);
      // (Worked out afresh every `CHECK_TICKS`, or as soon as a train comes onto or leaves the line, or the track or the
      // trains not on the line change; in between, as last worked out.)
      const key = `${engines.join(",")}|${foreign.map((t) => t.id).join(",")}`;
      const last = this.slow.get(lineId);
      if (last && last.key === key && last.topo === topo && this.sim.ticks % CHECK_TICKS !== 0) {
        blocked = last.blocked;
        more = last.more;
        spareCut = last.spareCut;
        parked = last.parked;
        other = last.other;
        oneWay = last.oneWay;
      } else {
        const order = [...engines].sort((a, b) => this.firstSeen.get(a)! - this.firstSeen.get(b)!);
        // (The loops whose roads hold a train standing that has no room (`adm`: those with room), or one not on the line.)
        // (Only its own loops: one on another line's way is none of its room.)
        const own = this.loopCount.get(lineId)?.set ?? EMPTY;
        let byParked = false;
        const roadsHeld = (adm: ReadonlySet<number>) => {
          const b = new Set<number>();
          byParked = false;
          // (One of its own it has no room for counts moving or not: it's held, and stops where it is.)
          const mark = (t: Train, moving = false) => {
            if (!moving && t.speed >= 1) return;
            for (const x of t.bogies) {
              const sl = topo.slotOf.get(x.pieceId);
              if (sl !== undefined && topo.slots[sl].kind === "road" && own.has(topo.slots[sl].loop)) b.add(topo.slots[sl].loop);
            }
          };
          for (const e of engines) {
            if (adm.has(e)) continue;
            const t = this.sim.findCar(e)?.train;
            if (t) mark(t, true);
          }
          // (Loops a train not on the line stands on: lost to the line however many it lays, whoever else is there.)
          const lineHeld = new Set(b);
          b.clear();
          for (const t of foreign) {
            const before = b.size;
            mark(t);
            // (Whether every one of them is another line's, running it: then it's "another train", not a parked one.)
            if (b.size > before && !(t.cars.some((c) => c.kind === "engine" && this.host.lineOf(c.id) >= 0) && this.host.drive(t) !== 0)) byParked = true;
          }
          const gone = b.size;
          for (const x of lineHeld) b.add(x);
          return { b, gone };
        };
        // (Every train working its track going round circuits one way (none could ever meet another head on: they only
        // follow, `follows`): room for all of them, however many loops (the user, 2026-11-02: a line of 3 on a ring with
        // one loop was held "too many", though they could just follow round). Else a train more than its loops, and
        // one more for its ends.)
        oneWay = this.oneWayRound([...engines, ...peers, ...loose]);
        // (The line's two ends are waiting places too, where its longest train fits in each: with a passing loop, they
        // make room for a train more (3 trains on one loop: 4 places, the free one moving round like the gap in a
        // sliding puzzle; stalls-verify 2026-11-10). Not with no loop: no train passes then. Nor with a loop pinned so
        // each road is one way, or one a train not on the line stands on: there the trains can't trade places so.)
        const ends = this.endsOn(lineId, topo, longest) >= 2 && [...own].every((l) => topo.loops[l].into.every((x) => x.length > 1)) ? 1 : 0;
        const roomOf = (adm: ReadonlySet<number>) => {
          if (oneWay) return engines.length;
          const h = roadsHeld(adm);
          return Math.max(1, loops - h.b.size + 1 + (loops >= 1 && h.gone === 0 ? ends : 0));
        };
        // (Passing loops to lay for all its trains, past those a train not on the line stands on; 0 if it has room
        // for them all once its own held trains are let in.)
        const toLay = (gone: number) => {
          const free = loops - gone;
          const need = engines.length - 1 - (gone === 0 ? ends : 0) - free;
          return engines.length < 2 ? 0 : free < 1 ? Math.max(1, need) : Math.max(0, need);
        };
        // (Let in first those whose holding would block most: one in a section holds the single track; one at a line end
        // holds its stop; one standing on a loop's road costs only that loop, and is let in last.)
        const where = (e: number): number => {
          const t = this.sim.findCar(e)?.train;
          if (!t) return 9;
          let road = false;
          let end = false;
          let sec = false;
          for (const x of t.bogies) {
            const sl = topo.slotOf.get(x.pieceId);
            if (sl === undefined || topo.slots[sl].kind === "signal") sec = true;
            else if (topo.slots[sl].kind === "road") road = true;
            else end = true;
          }
          return sec ? 0 : end ? 1 : road ? 2 : 3;
        };
        // (The newest last: the one held when room runs out is the one just put on the line. The player put it there,
        // and can take it off again (its card's Remove, or picked up).)
        const newest = (a: number, b: number) => (this.joinedAt.get(a) ?? 0) - (this.joinedAt.get(b) ?? 0);
        // (Those whose holding would block most first, as `where` says; of those alike, the newest last.)
        const byWhere = (a: number, b: number) => where(a) - where(b) || newest(a, b);
        // (Not one standing where a train let in is on its way to: the other has it; this one is the end of its way.)
        const inWay = (e: number, adm: ReadonlySet<number>): boolean => {
          const t = this.sim.findCar(e)?.train;
          if (!t) return false;
          for (const u of adm) {
            const m = this.states.get(u)?.move;
            if (!m) continue;
            const dest = m.dest >= 0 ? topo.slots[m.dest]?.pieces : undefined;
            if (t.bogies.some((b) => m.steps.some((x) => x.pieceId === b.pieceId) || !!dest?.has(b.pieceId))) return true;
          }
          return false;
        };
        // Let in as many as there's room for, counting the room one frees itself (one standing alone on a loop's road
        // gives that loop back once let in). Twice round: one let in may make room for one passed over before.
        const fill = (adm: Set<number>, not = -1) => {
          const asked = order.filter((e) => !adm.has(e) && e !== not).sort(byWhere);
          for (const e of [...asked, ...asked]) {
            if (adm.has(e) || inWay(e, adm)) continue;
            adm.add(e);
            if (adm.size > roomOf(adm)) adm.delete(e);
          }
        };
        fill(admitted);
        // (A train just come with no room for it: the player's told once a line what the line has room for.)
        if (this.onFull && !this.toldFull.has(lineId) && fresh.some((e) => !admitted.has(e))) {
          this.toldFull.add(lineId);
          const room = roomOf(admitted);
          this.onFull(lineId, room, engines.length, Math.max(1, toLay(roadsHeld(admitted).gone)));
        }
        // Too many for the room left (a train came to stand on a loop's road): one gives up its room, never mid-way (only
        // one standing with no move, never one in a section: held there it'd block the line). The one whose giving up
        // lets the most run (others may be let in then), then one at a line end, then the one that came last.
        const stops = new Set(this.host.stopPieces(lineId));
        const onStop = (e: number) => !!this.sim.findCar(e)?.train.bogies.some((b) => stops.has(b.pieceId));
        for (let k = 0; k < engines.length && admitted.size > roomOf(admitted); k++) {
          // (One still running in a slot is weighed too: if it's the best, the others wait for it to stand.)
          const can = [...admitted].filter((e) => {
            const st = this.states.get(e);
            if (st?.move) return false;
            const w = where(e);
            return w === 1 || w === 2;
          });
          let best: { e: number; adm: Set<number>; n: number } | null = null;
          for (const e of can) {
            const adm = new Set(admitted);
            adm.delete(e);
            fill(adm, e);
            const n = adm.size <= roomOf(adm) ? adm.size : -1;
            // (Of those letting as many run: one off its stops first (held on a stop, that stop is lost to the others).)
            // (Of those letting as many run: one off its stops first (held on a stop, that stop is lost to the others),
            // then by where it stands, then the newest.)
            const cmp = !best ? -1 : n !== best.n ? best.n - n : onStop(e) !== onStop(best.e) ? (onStop(e) ? 1 : -1) : where(e) !== where(best.e) ? where(e) - where(best.e) : newest(best.e, e);
            const better = cmp < 0;
            if (better) best = { e, adm, n };
          }
          if (!best || (this.sim.findCar(best.e)?.train.speed ?? 0) >= 1) break;
          admitted.clear();
          for (const e of best.adm) admitted.add(e);
        }
        // One standing at a line end with no move gives its room to more than one held on loops' roads (each gives its
        // loop back once let in). Looked at every `CHECK_TICKS`.
        if (this.sim.ticks % CHECK_TICKS === 0 && admitted.size < engines.length)
          for (const e of [...admitted]) {
            const st = this.states.get(e);
            if ((st?.move) || where(e) !== 1 || (this.sim.findCar(e)?.train.speed ?? 1) >= 1) continue;
            const adm = new Set(admitted);
            adm.delete(e);
            fill(adm, e);
            if (adm.size <= admitted.size || adm.size > roomOf(adm)) continue;
            admitted.clear();
            for (const x of adm) admitted.add(x);
            break;
          }
        const held = roadsHeld(admitted);
        blocked = held.b;
        // A loop with a train not on the line standing on each of its roads cuts the line in two: no loop laid elsewhere
        // gets a train past it. Only moving one of those trains does.
        for (const l of own) {
          let roads = 0;
          let taken = 0;
          for (const sl of topo.slots) {
            if (sl.kind !== "road" || sl.loop !== l) continue;
            roads++;
            if (foreign.some((t) => t.speed < 1 && t.bogies.some((x) => sl.pieces.has(x.pieceId)))) taken++;
          }
          if (roads > 0 && taken === roads) spareCut = true;
        }
        // (So does one left standing, lever off, in a section on its way: on the single track there.)
        const way = this.loopCount.get(lineId)?.way ?? EMPTY;
        for (const t of foreign)
          if (t.speed < 1 && this.host.drive(t) === 0 && t.bogies.some((x) => way.has(x.pieceId) && topo.sectionOf.has(x.pieceId))) spareCut = true;
        // (Loops to lay: enough for its trains with its ends (`toLay`), past those a train not on the line stands on.
        // Its own held trains count as trains: once there's room they're let in and give their loop back.)
        if (engines.length > admitted.size) more = toLay(held.gone);
        parked = held.gone > 0;
        other = parked && !byParked;
        this.slow.set(lineId, { key, topo, blocked, more, spareCut, parked, other, oneWay });
      }
      // Trains gone from the line give up what they held.
      for (const [e, st] of this.states) if (this.host.lineOf(e) === lineId && !engines.includes(e)) this.states.delete(st.engine);
    }
    const zone = { slots: new Map<number, number>(), sections: new Map<number, number>() };
    if (managed) for (const t of foreign) if (t.speed >= 1) this.zoneOf(t, topo, zone);
    info = { engines, users: peers.length + loose.length > 0 ? [...engines, ...peers, ...loose] : engines, loose, topo, loops, admitted, managed, blocked, more, oneWay, foreign, spareCut, parked, other, zone };
    this.lineInfo.set(lineId, info);
    if (managed) {
      this.managedTick = this.sim.ticks;
      if (this.sim.ticks % 3 === 0) this.cutMoves(info);
    }
    return info;
  }

  /**
   * The road of a loop a train on no line coming at it from outside through switch `sw` (one of its two) takes: the way
   * the points rest (−1: not known).
   */
  private restRoad(topo: Topology, loop: Loop, sw: number): number {
    const { layout } = this;
    const piece = layout.getPiece(sw);
    if (!piece) return -1;
    const def = getPieceDef(piece.type, piece.flipped);
    for (let c = 0; c < def.connectors.length; c++) {
      const n = next(layout, sw, c);
      const sl = n ? topo.slotOf.get(n.pieceId) : undefined;
      if (sl !== undefined && (sl === loop.roads[0] || sl === loop.roads[1])) continue;
      const ways = waysFrom(layout, sw, c);
      if (ways.length === 0) continue;
      const w = ways.length > 1 ? ways[(this.host.restsAt?.(sw) ?? layout.switchState(sw)) % ways.length] : ways[0];
      const m = next(layout, sw, w.exit);
      return (m && topo.slotOf.get(m.pieceId)) ?? -1;
    }
    return -1;
  }

  /** Does its line have room for `u`, one of the line's users (its own train, or one of a line sharing its network)? */
  private hasRoom(info: LineInfo, u: number): boolean {
    if (info.engines.includes(u)) return info.admitted.has(u);
    const lineId = this.host.lineOf(u);
    if (lineId < 0) return true;
    const other = this.line(lineId);
    return !other.managed || other.admitted.has(u);
  }

  /**
   * Lines sharing track (single-line working across lines): lines whose ways run through a slot or section in common
   * (in the topology for the longest train of any line) are one network, transitively. Each such line's trains use one
   * topology, for the network's longest train, and ask for their moves among every train of the network's lines (its
   * `users`), so two lines' trains meet at a passing loop, taking its different roads, as one line's do. A line on
   * track of its own isn't in it: it runs exactly as before. Worked out again only when the track, the pins, the lines'
   * stops or their trains change (a key per tick: a few lookups a line); nothing with fewer than two trains on lines.
   */
  private network(): ReadonlyMap<number, { topo: Topology; lines: readonly number[] }> {
    if (this.netTick === this.sim.ticks) return this.netOf;
    this.netTick = this.sim.ticks;
    this.netOf = this.shared ? this.networkNow() : NO_NETWORK;
    return this.netOf;
  }
  private netTick = -1;
  private netOf: ReadonlyMap<number, { topo: Topology; lines: readonly number[] }> = new Map();

  private networkNow(): ReadonlyMap<number, { topo: Topology; lines: readonly number[] }> {
    const engines: number[] = [];
    for (const t of this.sim.trains()) {
      if (t.derailed) continue;
      for (const car of t.cars)
        if (car.kind === "engine" && this.host.lineOf(car.id) >= 0) {
          engines.push(car.id);
          break;
        }
    }
    if (engines.length < 2) return NO_NETWORK;
    const longest = new Map<number, number>();
    for (const e of engines) {
      const l = this.host.lineOf(e);
      const len = trainLength(this.sim.findCar(e)!.train);
      longest.set(l, Math.max(longest.get(l) ?? 0, Math.ceil((len + ROAD_MARGIN) / 16)));
    }
    if (longest.size < 2) return NO_NETWORK;
    let pins = "";
    for (const id of this.layout.pinnedIds()) pins += `,${id}:${this.layout.switchState(id)}`;
    const lines = [...longest.keys()].sort((a, b) => a - b);
    let key = `${this.layout.revision}${pins}${marksKey(this.layout)}`;
    for (const l of lines) key += `|${l}:${longest.get(l)}:${this.host.stopPieces(l).join(",")}`;
    if (this.net?.key === key) return this.net.of;
    // (Regions, in the topology for the longest train of all: those its ways run through.)
    let all = 0;
    for (const n of longest.values()) all = Math.max(all, n);
    const wide = topologyOf(this.layout, all * 16 - ROAD_MARGIN);
    const regions = new Map<number, Set<number>>();
    for (const l of lines) {
      const r = new Set<number>();
      for (const p of this.wayOf(l)) {
        const x = regionOf(wide, p);
        if (x !== null) r.add(x);
      }
      regions.set(l, r);
    }
    // (Joined where they share one, transitively.)
    const root = new Map<number, number>(lines.map((l) => [l, l]));
    const find = (l: number): number => {
      while (root.get(l) !== l) l = root.get(l)!;
      return l;
    };
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const a = regions.get(lines[i])!;
        const b = regions.get(lines[j])!;
        let shared = false;
        for (const x of a)
          if (b.has(x)) {
            shared = true;
            break;
          }
        if (shared) root.set(find(lines[j]), find(lines[i]));
      }
    const groups = new Map<number, number[]>();
    for (const l of lines) {
      const g = groups.get(find(l)) ?? [];
      g.push(l);
      groups.set(find(l), g);
    }
    const of = new Map<number, { topo: Topology; lines: readonly number[] }>();
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      let n = 0;
      for (const l of g) n = Math.max(n, longest.get(l)!);
      const topo = topologyOf(this.layout, n * 16 - ROAD_MARGIN);
      for (const l of g) of.set(l, { topo, lines: g });
    }
    this.net = { key, of };
    return of;
  }
  private net: { key: string; of: ReadonlyMap<number, { topo: Topology; lines: readonly number[] }> } | null = null;

  /**
   * The speed a train may run at to stop short of the nearest other train ahead of it (Infinity: none within its
   * stopping distance). For trains on no line, where a line is managed: the line's trains keep out of its way, and it
   * doesn't run into them while they do.
   */
  private clearCap(train: Train, among: readonly Train[] | null = null, own = true): number {
    const net = this.host.drive(train);
    if (net === 0 || train.turnback >= 0) return Infinity;
    const c = this.front(train, net < 0);
    const lead = net < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    const gap = 2 * CAR_SPECS[lead.kind].bogieInset + COUPLER_GAP;
    const look = stopDistance(train.speed) + gap + 4 * CLEAR_STEP;
    const others: Train[] = [];
    if (among) {
      for (const t of among) if (t !== train && !t.derailed) others.push(t);
    } else
      for (const t of this.sim.trains()) if (t !== train && !t.derailed) others.push(t);
    if (others.length === 0) return Infinity;
    const held = own ? this.clearHeld.get(train.id) : undefined;
    if (own) this.clearHeld.delete(train.id);
    let walked = 0;
    for (let k = 0; walked <= look; k++) {
      if (k > 0) {
        advanceCursor(this.layout, c, CLEAR_STEP, null, clearAdv);
        walked += clearAdv.moved;
      }
      const len = lengthOfPath(this.layout, c.pieceId, c.pathIndex);
      const g = c.reversed ? len - c.s : c.s;
      for (const t of others)
        for (const b of t.bogies) {
          if (b.pieceId !== c.pieceId || b.pathIndex !== c.pathIndex) continue;
          const gb = b.reversed ? len - b.s : b.s;
          if (Math.abs(gb - g) <= CLEAR_STEP) {
            const room = walked - gap;
            // (Within a step of it: as good as there; the sim may hold it touching.)
            if (room > CLEAR_STEP) {
              // (Edging up as the one ahead edges on, still close behind it: the wait goes on, since it began.)
              if (held !== undefined && room <= 2 * CLEAR_STEP) this.clearHeld.set(train.id, held);
              return Math.sqrt(2 * ACCELERATION * (room - CLEAR_STEP));
            }
            // (A line's train: it waits there, its line's sections say when it goes.)
            if (!own) return 0;
            // (A train on no line: it waits for that one, however long (routing spec §16 Q3), saying who for.)
            this.clearHeld.set(train.id, held ?? this.sim.ticks);
            this.clearBy.set(train.id, { by: t.id, tick: this.sim.ticks });
            if (this.clearBy.size > 4 * this.sim.trainCount) for (const [id, c] of this.clearBy) if (c.tick < this.sim.ticks - 1) this.clearBy.delete(id);
            return 0;
          }
        }
      if (k > 0 && (clearAdv.status !== ADV_OK || clearAdv.moved === 0)) return Infinity;
    }
    return Infinity;
  }

  /**
   * A train not on the line, running: the slots and sections it's in, and those it may run into next (each way out of
   * a switch it comes to, as the line can't tell where it's going), into `zone`.
   */
  private zoneOf(t: Train, topo: Topology, zone: { slots: Map<number, number>; sections: Map<number, number> }): void {
    const { layout } = this;
    const id = engineOf(t);
    const mark = (pieceId: number): string => {
      const sl = topo.slotOf.get(pieceId);
      if (sl !== undefined) {
        zone.slots.set(sl, id);
        return `s${sl}`;
      }
      const sc = topo.sectionOf.get(pieceId);
      if (sc !== undefined) {
        zone.sections.set(sc, id);
        return `c${sc}`;
      }
      return "";
    };
    const here = new Set<string>();
    for (const b of t.bogies) here.add(mark(b.pieceId));
    const net = this.host.drive(t);
    if (net === 0) return;
    const c = this.front(t, net < 0);
    const piece = layout.getPiece(c.pieceId);
    if (!piece) return;
    const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
    // (On ahead into the next slot or section, and the one past that: far enough to stop for it.)
    const todo: { pieceId: number; exit: number; depth: number; region: string }[] = [{ pieceId: c.pieceId, exit: c.reversed ? path.from : (path.to ?? -1), depth: 0, region: mark(c.pieceId) }];
    const seen = new Set<number>();
    for (let k = 0; k < SEARCH && todo.length; k++) {
      const at = todo.pop()!;
      const n = next(layout, at.pieceId, at.exit);
      if (!n || seen.has(n.pieceId * 8 + n.entry)) continue;
      seen.add(n.pieceId * 8 + n.entry);
      const region = mark(n.pieceId);
      const depth = region !== at.region && !here.has(region) ? at.depth + 1 : at.depth;
      if (depth > 2) continue;
      for (const w of waysFrom(layout, n.pieceId, n.entry, () => false)) todo.push({ pieceId: n.pieceId, exit: w.exit, depth, region });
    }
  }

  /**
   * A train put down (or come to stand) on the way ahead of a move, or in the slot it's going to: the move is given up,
   * and it asks again (it stops, and waits as for any train in its way). Only standing trains count, and
   * held ones (they stop where they are): a granted way has no other train of the line with room moving on it, and one
   * not on the line moving is waited for elsewhere.
   */
  private cutMoves(info: LineInfo): void {
    let any = false;
    const movers = info.loose.length > 0 ? [...info.admitted, ...info.loose] : info.admitted;
    for (const e of movers) {
      const m = this.states.get(e)?.move;
      if (m) any = true;
    }
    if (!any) return;
    const standing: Train[] = [];
    // (One of its own with no room counts moving or not: it's held, and stops where it is.)
    for (const e of info.users) {
      const t = this.sim.findCar(e)?.train;
      if (t && (t.speed < 1 || !this.hasRoom(info, e))) standing.push(t);
    }
    for (const t of info.foreign) if (t.speed < 1) standing.push(t);
    const zoned = info.zone.slots.size + info.zone.sections.size > 0;
    if (standing.length === 0 && !zoned) return;
    for (const e of movers) {
      const st = this.states.get(e);
      const m = st?.move;
      if (!st || !m) continue;
      const own = this.sim.findCar(e)?.train;
      if (!own) continue;
      const mine = new Set(own.bogies.map((b) => b.pieceId));
      // (From its front on.)
      let from = 0;
      for (let k = m.steps.length - 1; k >= 0; k--)
        if (mine.has(m.steps[k].pieceId)) {
          from = k;
          break;
        }
      const ahead = new Set<number>();
      for (let k = from; k < m.steps.length; k++) if (!mine.has(m.steps[k].pieceId)) ahead.add(m.steps[k].pieceId);
      if (m.dest >= 0) for (const p of st.topo.slots[m.dest]?.pieces ?? []) if (!mine.has(p)) ahead.add(p);
      if (ahead.size === 0) continue;
      // (Or a train not on the line running into its way: the slot it's going to, or a section it holds.)
      const intoZone = zoned && ((m.dest >= 0 && info.zone.slots.has(m.dest)) || m.sections.some((x) => info.zone.sections.has(x)) || m.through.some((x) => info.zone.slots.has(x)));
      if (!intoZone && !standing.some((t) => t !== own && t.bogies.some((b) => ahead.has(b.pieceId)))) continue;
      st.move = null;
      st.askedAt = -Infinity;
      st.frontKey = -1;
      this.cut++;
    }
  }

  /** A line's ends (end slots on its way) its longest train, `length` mm, fits in. */
  private endsOn(lineId: number, topo: Topology, length: number): number {
    const way = this.loopCount.get(lineId)?.way;
    if (!way) return 0;
    let n = 0;
    for (const sl of topo.slots) {
      if (sl.kind !== "end" || sl.length < length) continue;
      for (const p of sl.pieces)
        if (way.has(p)) {
          n++;
          break;
        }
    }
    return n;
  }

  /** Is a loop on its line's way pinned so it's no passing place (see `findLoops`)? */
  private pinnedLoopOn(engine: number): boolean {
    return this.loopCount.get(this.host.lineOf(engine))?.pinnedLoop ?? false;
  }

  /**
   * Passing loops on a line's ways between its stops (−1: none of its ways touch a slot: it's left alone). `shared`:
   * signals' waiting points count as slots too (a one-train line taking turns in a network: see `line`).
   */
  private loopsOn(lineId: number, topo: Topology, shared = false): number {
    const stops = this.host.stopPieces(lineId);
    const hit = this.loopCount.get(lineId);
    // (Kept by its stops, the track's revision and the topology (pinning a loop's switches changes it, not the track's
    // revision). Only the count depends on `shared`, so both are worked out at once: `line` asks for a line both ways
    // in a tick (`turns`), and keyed by `shared` too it was worked out afresh at every ask.)
    if (hit && hit.topo === topo && hit.revision === this.layout.revision && hit.slotCount === topo.slots.length && sameNumbers(hit.stops, stops)) {
      hit.n = shared ? hit.withSignals : hit.plain;
      return hit.n;
    }
    const loops = new Set<number>();
    const way = this.wayOf(lineId);
    let slots = 0;
    let signalSlots = 0;
    for (const piece of way) {
      const s = topo.slotOf.get(piece);
      if (s === undefined) continue;
      // (A waiting point alone doesn't make a line managed: an oval with signals is the sim's block working, §3.4.)
      // (Sharing a network with other lines, signals' waiting points count too: it takes its turns with theirs.)
      if (topo.slots[s].kind !== "signal") slots++;
      else signalSlots++;
      if (topo.slots[s].kind === "road") loops.add(topo.slots[s].loop);
    }
    const plain = slots === 0 ? -1 : loops.size;
    const withSignals = slots + signalSlots === 0 ? -1 : loops.size;
    const n = shared ? withSignals : plain;
    // (Its network: the slots and sections its ways run through, and its loops' other roads. A train elsewhere, on
    // track it doesn't use or a layout of its own, is none of its business.)
    const regions = new Set<number>();
    for (const p of way) {
      const r = regionOf(topo, p);
      if (r !== null) regions.add(r);
    }
    for (const sl of topo.slots) if (sl.kind === "road" && loops.has(sl.loop)) regions.add(sl.id);
    // (A dead end its ways go into, all of it: a train anywhere in there is in its way going in (routing spec §5 rule 8).)
    const ends = deadEndsOf(this.layout);
    if (ends.mouths.length > 0) {
      const touched = new Set<number>();
      for (const p of way) {
        const r = ends.regionOf.get(p);
        if (r !== undefined) touched.add(r);
      }
      for (const r of touched)
        for (const p of ends.mouths[r].pieces) {
          const x = regionOf(topo, p);
          if (x !== null) regions.add(x);
        }
    }
    // (A loop on its way pinned so every train takes one road: no passing place till it's unpinned.)
    const pinnedLoop = topo.pinnedLoops.some((pl) => pl.pieces.some((p) => way.has(p)));
    this.loopCount.set(lineId, { stops, revision: this.layout.revision, topo, slotCount: topo.slots.length, n, plain, withSignals, set: loops, way, regions, pinnedLoop });
    return n;
  }

  /** The pieces of a line's ways between its stops (cached by its stops and the track's revision). */
  private wayOf(lineId: number): ReadonlySet<number> {
    const stops = this.host.stopPieces(lineId);
    const key = `${stops.join(",")}|${this.layout.revision}`;
    const hit = this.ways.get(lineId);
    if (hit && hit.key === key) return hit.way;
    const way = new Set<number>();
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i];
      const b = stops[(i + 1) % stops.length];
      if (a === b) continue;
      for (const piece of this.wayPieces(a, b)) way.add(piece);
    }
    this.ways.set(lineId, { key, way });
    return way;
  }
  private readonly ways = new Map<number, { key: string; way: ReadonlySet<number> }>();

  /** The pieces a train goes over from stop piece `from` to stop piece `to`, whichever way out of `from` reaches it. */
  private wayPieces(from: number, to: number): number[] {
    const { layout } = this;
    const out: number[] = [];
    const p = layout.getPiece(from);
    if (!p) return out;
    const def = getPieceDef(p.type, p.flipped);
    for (let c = 0; c < def.connectors.length; c++) {
      if (!plan(layout, { pieceId: from, entry: c, lead: true }, to)) continue;
      let at: { pieceId: number; entry: number } | null = { pieceId: from, entry: c };
      const seen = new Set<number>();
      for (let k = 0; at && k < SEARCH && at.pieceId !== to; k++) {
        const key = at.pieceId * 8 + at.entry;
        if (seen.has(key)) break;
        seen.add(key);
        out.push(at.pieceId);
        const ways = waysFrom(layout, at.pieceId, at.entry);
        if (ways.length === 0) break;
        const best: number = ways.length > 1 ? planWay(layout, at.pieceId, at.entry, ways, to) : 0;
        const w: { exit: number } = ways[best === -1 ? 0 : best];
        // (The end of the line: back the way it came.)
        at = next(layout, at.pieceId, w.exit) ?? next(layout, at.pieceId, at.entry);
      }
    }
    return out;
  }

  /** Forget engines no longer routed (the economy prunes). */
  prune(engines: ReadonlySet<number>): void {
    for (const e of [...this.states.keys()]) if (!engines.has(e)) this.states.delete(e);
    // (A wait on a train taken off the track (put away, say) is over: it asks again at once.)
    for (const st of this.states.values())
      if (st.wait && "engine" in st.wait && st.wait.engine >= 0 && !this.sim.findCar(st.wait.engine)) {
        st.wait = null;
        st.waitSince = -1;
        st.askedAt = -Infinity;
      }
    for (const e of [...this.joinedAt.keys()]) if (!engines.has(e)) this.joinedAt.delete(e);
  }

  /** Does a train this engine's line has no room for stand on this piece, or at the line end it's at? */
  private heldAt(engine: number, pieceId: number): boolean {
    const lineId = this.host.lineOf(engine);
    if (lineId < 0 || pieceId < 0) return false;
    const info = this.line(lineId);
    if (!info.managed || !info.admitted.has(engine)) return false;
    for (const e of info.engines) {
      if (info.admitted.has(e)) continue;
      const t = this.sim.findCar(e)?.train;
      if (!t) continue;
      for (const b of t.bogies) {
        if (b.pieceId === pieceId) return true;
        const sl = info.topo.slotOf.get(b.pieceId);
        if (sl !== undefined && info.topo.slots[sl].kind === "end" && info.topo.slots[sl].pieces.has(pieceId)) return true;
      }
    }
    return false;
  }

  /** Passing loops on a line's ways, as last worked out (−1: not known, or none of its ways touch a slot). */
  passingLoops(lineId: number): number {
    return this.loopCount.get(lineId)?.n ?? -1;
  }

  /** Is this engine one its line has no room for (held where it stands)? */
  heldForRoom(engine: number): boolean {
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return false;
    const info = this.line(lineId);
    return info.managed && info.engines.includes(engine) && !info.admitted.has(engine);
  }

  /**
   * What a save keeps of an engine's place on its line: when it came (`joinedAt`: the newest is the one held), and
   * whether its line has no room for it now.
   */
  savedPlace(engine: number): { joined?: number; held?: true } {
    const joined = this.joinedAt.get(engine);
    const lineId = this.host.lineOf(engine);
    const info = this.enabled && lineId >= 0 ? this.line(lineId) : null;
    const held = !!info?.managed && info.engines.includes(engine) && !info.admitted.has(engine);
    return { ...(joined !== undefined ? { joined } : {}), ...(held ? { held: true as const } : {}) };
  }

  /** A loaded engine's place on its line, as saved (`savedPlace`): when it came, and (not held) that it has room. */
  restorePlace(engine: number, lineId: number, place: { joined?: number; held?: boolean }): void {
    if (place.joined !== undefined) {
      this.joinedAt.set(engine, place.joined);
      this.joins = Math.max(this.joins, place.joined);
    }
    if (place.held) this.heldOnLoad.add(lineId);
    else {
      let adm = this.admitted.get(lineId);
      if (!adm) this.admitted.set(lineId, (adm = new Set()));
      adm.add(engine);
    }
  }

  /**
   * Loading done: lines with no train held keep no admission of their own from the save (worked out afresh, as
   * ever); those with one held keep theirs, so the same train stays held.
   */
  restored(): void {
    for (const lineId of [...this.admitted.keys()]) if (!this.heldOnLoad.has(lineId)) this.admitted.delete(lineId);
    this.heldOnLoad.clear();
  }
  private readonly heldOnLoad = new Set<number>();

  /** Has this line's player been told it's full (`onFull`)? Kept in a save, so it isn't said again. */
  toldFullOn(lineId: number): boolean {
    return this.toldFull.has(lineId);
  }

  markToldFull(lineId: number): void {
    this.toldFull.add(lineId);
  }

  putAwayFor(engine: number): number {
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return -1;
    const info = this.line(lineId);
    if (!info.managed || !info.engines.includes(engine)) return -1;
    let best = -1;
    for (const e of info.engines) {
      if (info.admitted.has(e)) continue;
      if (e === engine) return e;
      if (best === -1 || (this.joinedAt.get(e) ?? 0) > (this.joinedAt.get(best) ?? 0)) best = e;
    }
    return best;
  }
}

const EMPTY: ReadonlySet<number> = new Set();
const NO_NETWORK: ReadonlyMap<number, { topo: Topology; lines: readonly number[] }> = new Map();

/** The same numbers in the same order? */
function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A piece's slot (its id) or section (−1 − its id), as one number; null for a piece in neither. */
function regionOf(topo: Topology, pieceId: number): number | null {
  const sl = topo.slotOf.get(pieceId);
  if (sl !== undefined) return sl;
  const sc = topo.sectionOf.get(pieceId);
  return sc !== undefined ? -1 - sc : null;
}
/** The step (mm) `clearCap` looks ahead by. */
const CLEAR_STEP = 16;
const clearAdv = createAdvance();
