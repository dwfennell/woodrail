import { getPieceDef, pathLength, type Layout } from "../track";
import { ACCELERATION, CAR_SPECS, COUPLER_GAP, flipCursor, type Cursor, type Sim, type Train } from "../sim";
import { distanceTo, next, SEARCH, waysFrom, wayToward, type AvoidTest } from "./steer";

/**
 * Sections and slots: trains of a line that wait for each other (token working on a single line). See
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
 *   move never meets a train of its line head on, and nothing here turns a train.
 * - **Room rule**: a line takes one train more than it has passing loops on its way (a loop per extra train). The
 *   rest are held (never sent into a section), with the reason (`waitOf`: kind "room", and how many loops to lay).
 * - **A train in a section with no move** (put down there, a loaded game, a second train joining the line) asks for
 *   the rest of its way to the slot ahead; it waits only for a train of its line on that way, or coming the other way.
 * - **A lone train** (or a line with no slot on its way) is left alone: the cost is a map lookup, and it runs exactly as
 *   without sections.
 *
 * Cost: slots and sections are worked out once per layout revision (and routing version, and road length). Per tick,
 * a train of a managed line costs a few lookups: what's ahead of it is worked out again only when its front comes onto
 * another piece, and a waiting train asks again every `CHECK_TICKS`.
 */

/** A waiting train stands this far (mm) short of the end of its slot. */
export const STAND_SHORT = 6;
/** A loop road must be this much (mm) longer than a train for the train to stand on it, clear of both switches. */
export const ROAD_MARGIN = 2 * STAND_SHORT;
/** A train asks for its move this far (mm) before it would start to brake for the slot's end. */
const ASK_LOOK = 24;
/** How often (sim ticks) a waiting train asks again. */
export const CHECK_TICKS = 12;
/** Two trains each waiting on the other this long (s), one of them in a section with no move: one is let go (logged). */
export const MUTUAL_S = 30;

/** A slot (see the header): a loop road, or a line end. */
export interface Slot {
  id: number;
  kind: "road" | "end";
  /** For a road: its loop (index in `Topology.loops`) and which road; −1 for a line end. */
  loop: number;
  road: number;
  pieces: ReadonlySet<number>;
  length: number;
}

export interface Loop {
  a: number;
  b: number;
  roads: [number, number];
}

export interface Topology {
  slots: Slot[];
  loops: Loop[];
  slotOf: ReadonlyMap<number, number>;
  sectionOf: ReadonlyMap<number, number>;
  sections: number;
}

/** Why a train is held (for its card, later). */
export type BlockWait =
  /** Its section is held, or stood in, by that train of its line. */
  | { kind: "section"; engine: number }
  /** The slot ahead (a loop road, a line end) is full or on another's way: waiting for that train. */
  | { kind: "slot"; engine: number }
  /** The line has more trains than places to pass: `trains`, `loops` passing loops; lay `more` more (or take a train off). */
  | { kind: "room"; lineId: number; trains: number; loops: number; more: number }
  /** That train of its line was put down facing it in the same slot: one gives way (this one turns back, or waits). */
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
  /** Let go (the safety net): it isn't checked against others, and holds nothing but its way. */
  free: boolean;
  /** When (sim tick) it was granted or let go. */
  since: number;
  /**
   * A dead end (`dest` is `DEAD_END`): the line end ahead is held by a train its line has no room for, so the move runs
   * to the section's far end, short of that line end, and turns back there (the section is its alone). The line end's
   * pieces: the stops on it are passed over.
   */
  deadEnd?: ReadonlySet<number>;
  /** Loop roads it runs through without stopping (a loop whose other road holds a train with no room). */
  through: number[];
}

/** A move's `dest` when it ends at a dead end (see `Move.deadEnd`). */
const DEAD_END = -2;

/** A way through a section (`Sections.wayOn`): its steps, the slot it ends at (or −1: full; `DEAD_END`), and why not. */
interface Way {
  steps: Step[];
  sections: number[];
  through: number[];
  dest: number;
  outBy: number;
  blockedBy: number;
  deadEnd?: ReadonlySet<number>;
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
}

// --- Topology ---------------------------------------------------------------------------------------------------

const NONE_PINNED = () => false;
const MAX_ROAD = 40;

function lengthOfPath(layout: Layout, pieceId: number, path: number): number {
  const p = layout.getPiece(pieceId)!;
  return pathLength(getPieceDef(p.type, p.flipped).paths[path].geom);
}

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

/** Passing loops a train of `minRoad` mm fits in: both roads long enough, neither switch pinned. */
function findLoops(layout: Layout, minRoad: number): { a: number; b: number; roads: [number[], number[]]; lengths: [number, number] }[] {
  const out: { a: number; b: number; roads: [number[], number[]]; lengths: [number, number] }[] = [];
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
          if (layout.isPinned(id) || layout.isPinned(r1.switchId)) continue;
          if (r1.pieces.length === 0 || r2.pieces.length === 0 || r1.length < minRoad || r2.length < minRoad) continue;
          if ([...r1.pieces, ...r2.pieces].some((p) => used.has(p))) continue;
          for (const p of [...r1.pieces, ...r2.pieces]) used.add(p);
          out.push({ a: id, b: r1.switchId, roads: [r1.pieces, r2.pieces], lengths: [r1.length, r2.length] });
        }
    }
  }
  return out;
}

/** Does a piece offer a choice of way (a switch, a deck, a lift)? */
function branches(layout: Layout, pieceId: number): boolean {
  const p = layout.getPiece(pieceId);
  if (!p) return false;
  const def = getPieceDef(p.type, p.flipped);
  if (def.isSwitch || def.gated) return true;
  // (Two or more paths from one end: a choice. A buffer's turn-back path, or a crossing's two, is none.)
  for (let c = 0; c < def.connectors.length; c++) {
    let n = 0;
    for (const pa of def.paths) if (pa.from === c || pa.to === c) n++;
    if (n > 1) return true;
  }
  return false;
}

/** Is a piece a stop (a depot or a station)? */
function isStopPiece(layout: Layout, pieceId: number): boolean {
  const t = layout.getPiece(pieceId)?.type ?? "";
  return t.startsWith("depot") || t.startsWith("station");
}

function buildTopology(layout: Layout, minRoad: number): Topology {
  const slots: Slot[] = [];
  const loops: Loop[] = [];
  const slotOf = new Map<number, number>();
  for (const l of findLoops(layout, minRoad)) {
    const roads: number[] = [];
    l.roads.forEach((pieces, road) => {
      const id = slots.length;
      slots.push({ id, kind: "road", loop: loops.length, road, pieces: new Set(pieces), length: l.lengths[road] });
      for (const p of pieces) slotOf.set(p, id);
      roads.push(id);
    });
    loops.push({ a: l.a, b: l.b, roads: [roads[0], roads[1]] });
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
  return { slots, loops, slotOf, sectionOf, sections };
}

const topoCache = new WeakMap<Layout, { key: string; byRoad: Map<number, Topology> }>();

/** The layout's slots and sections for trains of `trainLength` mm (cached per revision, pins and length). */
export function topologyOf(layout: Layout, trainLength: number): Topology {
  // (A pinned loop switch makes the loop no passing place: pins are part of the key. There are few.)
  let pins = "";
  for (const id of layout.pinnedIds()) pins += `,${id}`;
  const key = `${layout.revision}${pins}`;
  let hit = topoCache.get(layout);
  if (!hit || hit.key !== key) topoCache.set(layout, (hit = { key, byRoad: new Map() }));
  // (Bucketed, so trains a few mm apart share one.)
  const minRoad = Math.ceil((trainLength + ROAD_MARGIN) / 16) * 16;
  let t = hit.byRoad.get(minRoad);
  if (!t) hit.byRoad.set(minRoad, (t = buildTopology(layout, minRoad)));
  return t;
}

/** A train's length (mm), buffer face to buffer face. */
export function trainLength(train: Train): number {
  let len = 0;
  for (const c of train.cars) len += CAR_SPECS[c.kind].length;
  return len + COUPLER_GAP * Math.max(0, train.cars.length - 1);
}

// --- The controller ---------------------------------------------------------------------------------------------

interface LineInfo {
  engines: readonly number[];
  topo: Topology;
  /** Its passing loops (on its stops' ways), and how many trains it takes; admitted engines. */
  loops: number;
  admitted: ReadonlySet<number>;
  managed: boolean;
  /** Loops (indices in the topology) a train with no room stands on a road of: no passing place for the others. */
  blocked: ReadonlySet<number>;
  /** Trains the line has no room for (for cards: how many more loops). */
  more: number;
}

export class Sections {
  /** Off: nothing is held (for comparisons). */
  enabled = true;
  private readonly states = new Map<number, TrainState>();
  private lineTick = -1;
  private readonly lineInfo = new Map<number, LineInfo>();
  /** When each engine was first seen on its line (for the room rule: the first ones are let run). */
  private readonly firstSeen = new Map<number, number>();
  private seenCount = 0;
  /** Loops on each line's way, by its stops and the track's revisions. */
  private readonly loopCount = new Map<number, { key: string; n: number }>();
  /** Engines just granted a move: steer them now. */
  readonly steerSoon = new Set<number>();
  /** Safety-net releases (a mutual wait with a train in a section and no move), for the play-through and tests. */
  released = 0;
  /** Turns back short of a line end held by a train with no room (`deadEndCap`), and give-ways to a train put down facing. */
  turnedShort = 0;
  gaveWay = 0;
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
  ) {}

  /** The speed limit sections put on a powered train (Infinity: none). */
  cap(train: Train): number {
    if (!this.enabled) return Infinity;
    if (!this.timing) return this.capIn(train);
    const t0 = performance.now();
    try {
      return this.capIn(train);
    } finally {
      this.capMs += performance.now() - t0;
      this.capCalls++;
    }
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
    if (engine === -1) return Infinity;
    const info = this.line(lineId);
    if (!info.managed) {
      this.states.delete(engine);
      return Infinity;
    }
    const net = this.host.drive(train);
    // (Turning back: the sim counts it down standing; a limit of 0 then would read as a crane holding it.)
    if (net === 0 || train.turnback >= 0) return Infinity;
    let st = this.states.get(engine);
    if (!st) {
      st = { engine, trainId: train.id, frontKey: -1, tailPiece: -1, slot: -1, beyond: Infinity, exitPiece: -1, exitEntry: -1, move: null, wait: null, askedAt: -Infinity, waitSince: -1, outBy: -1, topo: info.topo, ahead: new Set(), facedAt: -Infinity, faceHold: false };
      this.states.set(engine, st);
    }
    const topo = info.topo;
    // (The track changed: where everything is, worked out afresh; a move on the old track is given up.)
    if (st.topo !== topo) {
      st.topo = topo;
      st.move = null;
      st.frontKey = -1;
    }
    // (Let go, and it has met the other and turned back since: the release is over; it asks again.)
    if (st.move?.free && train.lastTurn && train.lastTurn.tick > st.move.since) st.move = null;
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
      if (st.move?.dest === DEAD_END) return this.deadEndCap(st, info, train, front, net < 0);
      if (st.move) return Infinity;
      if (now - st.askedAt < CHECK_TICKS) return st.wait ? 0 : Infinity;
      st.askedAt = now;
      return this.recover(st, info, train, front) ? Infinity : 0;
    }
    // In a slot, with a train of its line put down facing it on the way to the slot's end: one gives way.
    if (this.facing(st, info, train)) return 0;
    // In a slot, with its move on from it granted.
    if (this.ownsAhead(st)) return Infinity;
    if (st.beyond === Infinity) return Infinity;
    const lead = net < 0 ? train.cars[train.cars.length - 1] : train.cars[0];
    const room = lengthOfPath(this.layout, front.pieceId, front.pathIndex) - front.s + st.beyond - CAR_SPECS[lead.kind].bogieInset;
    if (room <= (train.speed * train.speed) / (2 * ACCELERATION) + ASK_LOOK && now - st.askedAt >= CHECK_TICKS) {
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
   * Running to a dead end (see `Move.deadEnd`): it brakes to stand short of the line end held there, then, its route
   * moved on past the stops on that line end, turns back once the way back has a slot for it (in the section it holds).
   */
  private deadEndCap(st: TrainState, info: LineInfo, train: Train, front: Cursor, back: boolean): number {
    const m = st.move!;
    const { layout } = this;
    const i = m.steps.findIndex((x) => x.pieceId === front.pieceId);
    if (i === -1) {
      st.move = null;
      return 0;
    }
    let beyond = -STAND_SHORT;
    for (let k = i + 1; k < m.steps.length; k++) beyond += lengthOfPath(layout, m.steps[k].pieceId, m.steps[k].path);
    const lead = back ? train.cars[train.cars.length - 1] : train.cars[0];
    const room = lengthOfPath(layout, front.pieceId, front.pathIndex) - front.s + beyond - CAR_SPECS[lead.kind].bogieInset;
    if (room > 1 || train.speed >= 1) return room > 0 ? Math.sqrt(2 * ACCELERATION * room) : 0;
    const now = this.sim.ticks;
    if (now - st.askedAt < CHECK_TICKS) return 0;
    st.askedAt = now;
    this.host.skipStops(st.engine, m.deadEnd!);
    // The way back from where its tail is, facing back.
    const c = this.front(train, !back);
    const piece = layout.getPiece(c.pieceId);
    if (!piece) return 0;
    const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
    const way = this.wayOn(st, info, { pieceId: c.pieceId, entry: c.reversed ? (path.to ?? -1) : path.from }, c.pathIndex);
    if (!way || way.dest < 0) {
      this.hold(st, { kind: "slot", engine: way?.blockedBy ?? -1 });
      return 0;
    }
    this.grant(st, way);
    this.sim.turnBack(train.id);
    this.turnedShort++;
    return 0;
  }

  /**
   * A train of its line put down facing it in its slot, on the way to the slot's end (looked at every `CHECK_TICKS`):
   * one gives way. The one heading for the line end turns back (it then heads out, ahead of the other), else the one
   * that came to the line later; the other waits till it's turned. True: it's held.
   */
  private facing(st: TrainState, info: LineInfo, train: Train): boolean {
    const now = this.sim.ticks;
    if (now - st.facedAt < CHECK_TICKS) return st.faceHold;
    st.facedAt = now;
    st.faceHold = false;
    const slotPieces = st.topo.slots[st.slot].pieces;
    for (const u of info.engines) {
      if (u === st.engine) continue;
      const tu = this.sim.findCar(u)?.train;
      if (!tu || !tu.bogies.some((b) => slotPieces.has(b.pieceId))) continue;
      const mineOn = train.bogies.map((b) => b.pieceId);
      const ahead = tu.bogies.some((b) => st.ahead.has(b.pieceId) && !mineOn.includes(b.pieceId));
      if (!ahead) continue;
      // (Facing: each on the other's way. One behind the other the same way only follows. Worked out from where the
      // other stands, so one not asked for a limit yet (held by a crane, say) counts too.)
      const theirs = this.aheadIn(tu, st.slot, st.topo);
      if (!theirs || !mineOn.some((p) => theirs.ahead.has(p))) continue;
      const give = st.exitPiece === -1 ? true : !theirs.exit ? false : (this.firstSeen.get(st.engine) ?? 0) > (this.firstSeen.get(u) ?? Infinity);
      if (give && train.speed < 1 && this.sim.turnBack(train.id)) this.gaveWay++;
      st.faceHold = true;
      this.hold(st, { kind: "facing", engine: u });
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
    return !!st.move && !st.move.free && st.exitPiece !== -1 && st.move.steps.some((x) => x.pieceId === st.exitPiece);
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
        // At its move's far slot (or let go, at any): the move is over. (Its tail still in the section keeps others out:
        // they look at where trains stand, too.) Back in the slot it set out from (turned round): given up.
        if (m.free || slot === m.dest || !this.onWay(m, front.pieceId)) st.move = null;
      } else if (!m.free) {
        // In the section, off its way, or going the other way along it (turned round): given up; it asks afresh.
        const entry = front.reversed ? (path.to ?? -1) : path.from;
        if (!m.steps.some((s) => s.pieceId === front.pieceId && s.entry === entry)) st.move = null;
      }
    }
    st.ahead.clear();
    if (slot === undefined) return;
    // (On a loop's road with its stop on the other road (it was sent round by the free road): it can't call there
    // this time; its route goes on to the stop after.)
    const sl = topo.slots[slot];
    if (sl.kind === "road") {
      const loop = topo.loops[sl.loop];
      const other = topo.slots[loop.roads[0] === slot ? loop.roads[1] : loop.roads[0]].pieces;
      const target = this.host.target(st.engine);
      if (target >= 0 && other.has(target) && !sl.pieces.has(target)) this.host.skipStops(st.engine, other);
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

  /** Is a piece on a move's way (its steps, or the slot it goes to)? */
  private onWay(m: Move, pieceId: number): boolean {
    return m.steps.some((s) => s.pieceId === pieceId);
  }

  /**
   * The way from the piece just past its slot's end (or from its front, in a section) through the section to the
   * next slot, choosing at each switch as steering would (for its stop), and at a loop's facing switch a road with
   * room. Null if it reaches no slot. `dest` −1: the slot ahead is full (`blockedBy` is in it, or on its way there).
   */
  private wayOn(st: TrainState, info: LineInfo, start: { pieceId: number; entry: number }, firstPath = -1, short: ReadonlySet<number> | null = null): Way | null {
    const { layout } = this;
    const topo = info.topo;
    const target = this.host.target(st.engine);
    const memo = new Map<number, number>();
    const dist = (at: { pieceId: number; entry: number }) => {
      const k = at.pieceId * 8 + at.entry;
      let d = memo.get(k);
      if (d === undefined) memo.set(k, (d = target < 0 ? -1 : distanceTo(layout, at, target)));
      return d;
    };
    const steps: Step[] = [];
    const sections: number[] = [];
    const through: number[] = [];
    // (A switch under the train itself goes the way it lies: steering never throws one under a train.)
    const under = new Map<number, number>();
    const own = this.sim.findCar(st.engine)?.train;
    if (own) for (const b of own.bogies) under.set(b.pieceId, b.pathIndex);
    let at: { pieceId: number; entry: number } | null = start;
    // A dead end short of `at`: its way cut back clear of switches; what's past where it stands, passed over.
    const deadEnd = (blockedBy: number): Way => {
      const kept = this.shortOfSwitch(steps, own ? trainLength(own) : 0);
      return { steps: kept, sections, through, dest: DEAD_END, outBy: -1, blockedBy, deadEnd: this.beyondOf(at!, steps.slice(kept.length).map((x) => x.pieceId)) };
    };
    for (let k = 0; at && k < SEARCH; k++) {
      // A train with no room standing ahead: a dead end short of it (the rest of the way on, and its stops, passed over).
      if (short?.has(at.pieceId)) {
        return deadEnd(-1);
      }
      const slot = topo.slotOf.get(at.pieceId);
      if (slot !== undefined) {
        const s = topo.slots[slot];
        if (s.kind === "end") {
          const u = this.slotUser(info, slot, st.engine);
          // (Held there for want of room on the line: it won't move, so the section before it is a dead end, turned
          // back in.)
          if (u !== -1 && !info.admitted.has(u)) return deadEnd(u);
          return { steps, sections, through, dest: u === -1 ? slot : -1, outBy: -1, blockedBy: u };
        }
        const loop = topo.loops[s.loop];
        const prev = steps[steps.length - 1];
        const outBy = prev?.pieceId === loop.a ? loop.b : loop.a;
        let blockedBy = -1;
        // A loop with a train the line has no room for standing on one road: no passing place. It runs through by the
        // other road, holding it and the section beyond as one move, to the slot after.
        if (info.blocked.has(s.loop)) {
          const free = loop.roads.find((r) => !this.heldOnRoad(info, r));
          // (Both roads held: the loop is the end of the line from here, a dead end short of it.)
          if (free === undefined) return deadEnd(-1);
          const u = this.slotUser(info, free, st.engine);
          if (u !== -1 || !prev) return { steps, sections, through, dest: -1, outBy, blockedBy: u };
          if (free !== slot) {
            if (under.has(prev.pieceId)) return { steps, sections, through, dest: -1, outBy, blockedBy: -1 };
            const w = waysFrom(layout, prev.pieceId, prev.entry).find((x) => {
              const n = next(layout, prev.pieceId, x.exit);
              return !!n && topo.slotOf.get(n.pieceId) === free;
            });
            if (!w) return { steps, sections, through, dest: -1, outBy, blockedBy: -1 };
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
          if (w && w.kind !== "room" && w.engine === st.engine) calls = undefined;
        }
        for (const r of calls !== undefined ? [calls] : s.road === 0 ? loop.roads : [loop.roads[1], loop.roads[0]]) {
          const u = this.slotUser(info, r, st.engine);
          if (u !== -1) {
            blockedBy = u;
            continue;
          }
          const other = r === loop.roads[0] ? loop.roads[1] : loop.roads[0];
          const o = this.slotUser(info, other, st.engine);
          if (o !== -1 && this.outByOf(o, other) === outBy) {
            blockedBy = o;
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
        const best = wayToward(layout, at.pieceId, ways, target, dist);
        w = best === -1 ? (ways[layout.switchState(at.pieceId) % ways.length] ?? ways[0]) : ways[best];
      }
      steps.push({ pieceId: at.pieceId, path: w.path, entry: at.entry });
      at = next(layout, at.pieceId, w.exit);
    }
    return null;
  }

  /**
   * A dead end's way, ending short of its last switch, with room for the whole train between it and the switch before
   * (a train turns back clear of switches: turned round over one, the sim would lay its cars down both roads).
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
    for (const u of info.engines) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && !m.free && m.sections.includes(section)) return null;
      const t = this.sim.findCar(u)?.train;
      if (!t || !t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) continue;
      if (info.admitted.has(u) || t.speed >= 1) return null;
      for (const b of t.bogies) out.add(b.pieceId);
    }
    return out.size > 0 ? out : null;
  }

  private roomWait(st: TrainState, info: LineInfo): BlockWait {
    const loops = Math.max(0, info.loops - info.blocked.size);
    return { kind: "room", lineId: this.host.lineOf(st.engine), trains: info.engines.length, loops, more: Math.max(1, info.more) };
  }

  /** Does a train the line has no room for stand on this loop road? */
  private heldOnRoad(info: LineInfo, road: number): boolean {
    const pieces = info.topo.slots[road].pieces;
    for (const u of info.engines) {
      if (info.admitted.has(u)) continue;
      const t = this.sim.findCar(u)?.train;
      if (t && t.speed < 1 && t.bogies.some((b) => pieces.has(b.pieceId))) return true;
    }
    return false;
  }

  /** The train of the line (other than `engine`) on a slot, or on its way there; −1 if none. */
  private slotUser(info: LineInfo, slot: number, engine: number): number {
    const pieces = info.topo.slots[slot].pieces;
    for (const u of info.engines) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && !m.free && (m.dest === slot || m.through.includes(slot))) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => pieces.has(b.pieceId))) return u;
    }
    return -1;
  }

  /** The switch train `u` leaves loop road `slot` by. */
  private outByOf(u: number, slot: number): number {
    const st = this.states.get(u);
    if (st?.move && !st.move.free && st.move.dest === slot) return st.move.outBy;
    return st?.outBy ?? -1;
  }

  /** The train of the line (other than `engine`) holding a move through a section, or standing in it; −1 if none. */
  private sectionUser(info: LineInfo, section: number, engine: number): number {
    for (const u of info.engines) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && !m.free && m.sections.includes(section)) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) return u;
    }
    return -1;
  }

  /** Ask for the move on from its slot: true if granted (or nothing to ask). */
  private ask(st: TrainState, info: LineInfo): boolean {
    const topo = info.topo;
    if (st.exitPiece === -1) return true;
    const section = topo.sectionOf.get(st.exitPiece);
    if (section === undefined) return true;
    if (!info.admitted.has(st.engine)) {
      this.hold(st, this.roomWait(st, info));
      return false;
    }
    const u = this.sectionUser(info, section, st.engine);
    // (Only trains the line has no room for standing in it: it's a dead end short of them, for this one alone.)
    const short = u === -1 ? null : this.heldIn(info, section, st.engine);
    if (u !== -1 && !short) {
      this.hold(st, { kind: "section", engine: u });
      return false;
    }
    const way = this.wayOn(st, info, { pieceId: st.exitPiece, entry: st.exitEntry }, -1, short);
    if (short && way?.dest !== DEAD_END) {
      this.hold(st, { kind: "section", engine: u });
      return false;
    }
    // A dead end straight past its slot's end: it turns back here, in its slot, its route on past the stops beyond.
    // (Running through a loop that's no passing place: the sections beyond it must be free too.)
    if (way && way.dest !== -1)
      for (const x of way.sections) {
        const v = x === section ? -1 : this.sectionUser(info, x, st.engine);
        if (v !== -1) {
          this.hold(st, { kind: "section", engine: v });
          return false;
        }
      }
    if (way?.dest === DEAD_END && way.steps.length === 0) {
      const train = this.sim.findCar(st.engine)?.train;
      this.host.skipStops(st.engine, way.deadEnd!);
      if (train && train.speed < 1 && this.sim.turnBack(train.id)) this.turnedShort++;
      this.hold(st, { kind: "slot", engine: way.blockedBy });
      return false;
    }
    // (No slot ahead on this way: not one of the line's ways; left alone.)
    if (!way) return true;
    if (way.dest === -1) {
      this.hold(st, { kind: "slot", engine: way.blockedBy });
      return false;
    }
    this.grant(st, way);
    return true;
  }

  /** In a section with no move: the rest of its way to the slot ahead, unless a train of its line is on it, or coming. */
  private recover(st: TrainState, info: LineInfo, train: Train, front: Cursor): boolean {
    const { layout } = this;
    const piece = layout.getPiece(front.pieceId);
    if (!piece) return true;
    const path = getPieceDef(piece.type, piece.flipped).paths[front.pathIndex];
    const entry = front.reversed ? (path.to ?? -1) : path.from;
    const mine = new Set(train.bogies.map((b) => b.pieceId));
    // (Trains with no room standing in this section are the end of the line for one that has room: a dead end short
    // of them; it turns back where it stands if one is right ahead.)
    const section = info.topo.sectionOf.get(front.pieceId);
    const short = info.admitted.has(st.engine) && section !== undefined ? this.heldIn(info, section, st.engine) : null;
    if (short) for (const p of mine) short.delete(p);
    const way = this.wayOn(st, info, { pieceId: front.pieceId, entry }, front.pathIndex, short && short.size > 0 ? short : null);
    if (!way) return true;
    if (way.dest === DEAD_END && way.steps.filter((x) => !mine.has(x.pieceId)).length === 0) {
      this.host.skipStops(st.engine, way.deadEnd!);
      if (train.speed < 1 && this.sim.turnBack(train.id)) this.turnedShort++;
      this.hold(st, { kind: "slot", engine: way.blockedBy });
      return false;
    }
    const ahead = new Set(way.steps.map((s) => s.pieceId));
    for (const u of info.engines) {
      if (u === st.engine) continue;
      const t = this.sim.findCar(u)?.train;
      if (!t || (short && !info.admitted.has(u))) continue;
      // On its way ahead.
      if (t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) return this.recoverWait(st, u, info);
      // Coming the other way through it (its move's way runs over where this one stands, the other way round).
      const m = this.states.get(u)?.move;
      if (m && !m.free && m.sections.some((x) => way.sections.includes(x)) && m.steps.some((s) => mine.has(s.pieceId) && way.steps.some((w) => w.pieceId === s.pieceId && w.entry !== s.entry))) return this.recoverWait(st, u, info);
    }
    if (way.dest === -1) return this.recoverWait(st, way.blockedBy, info);
    this.grant(st, way);
    return true;
  }

  /** A train in a section waits for `u`; a mutual wait that lasts is let go (the safety net, logged). */
  private recoverWait(st: TrainState, u: number, info?: LineInfo): boolean {
    // (A train the line has no room for stays where it is, held: the others treat it as the end of the line.)
    if (info && !info.admitted.has(st.engine)) {
      this.hold(st, this.roomWait(st, info));
      return false;
    }
    this.hold(st, { kind: "section", engine: u });
    const other = this.states.get(u)?.wait;
    const mutual = !!other && other.kind !== "room" && other.engine === st.engine;
    if (mutual && this.sim.ticks - st.waitSince > MUTUAL_S * 120) {
      // (Let go with no slot at its end: it runs on, meets the other and turns back as before, then asks again.)
      this.released++;
      st.wait = null;
      st.waitSince = -1;
      st.move = { sections: [], through: [], dest: -1, outBy: -1, steps: [], follow: () => false, aim: -1, free: true, since: this.sim.ticks };
      return true;
    }
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
    st.move = { sections: way.sections, through: way.through, dest: way.dest, outBy: way.outBy, steps: way.steps, follow: (pieceId, path) => keys.has(pieceId * 8 + path), aim, free: false, since: this.sim.ticks, deadEnd: way.deadEnd };
    st.wait = null;
    st.waitSince = -1;
    this.granted++;
    this.steerSoon.add(st.engine);
  }

  /** Steering for a train holding a move: its way (`follow`), aimed at a piece of the slot it goes to. */
  steerHint(engine: number): { follow: AvoidTest; aim: number } | undefined {
    if (!this.enabled) return undefined;
    const m = this.states.get(engine)?.move;
    return m && !m.free && m.aim !== -1 ? { follow: m.follow, aim: m.aim } : undefined;
  }

  /**
   * Is a switch on the granted way of another train of this engine's line (its move's steps)? Then this one mustn't
   * throw it: steering for a held train (or one still short of its move) would send that train onto a road it doesn't
   * hold (QA B1: a train held on a branch set the loop's switch back under the move of one coming in).
   */
  switchHeld(engine: number, pieceId: number): boolean {
    if (!this.enabled) return false;
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return false;
    for (const [u, st] of this.states) {
      if (u === engine || !st.move || st.move.free) continue;
      if (st.move.steps.some((x) => x.pieceId === pieceId) && this.host.lineOf(u) === lineId) return true;
    }
    return false;
  }

  /**
   * How full the engine's line is: trains it has no room for (and so how many more passing loops it needs), and its
   * trains; null if it has room for all of them (or isn't managed).
   */
  fullness(engine: number): { more: number; trains: number } | null {
    if (!this.enabled) return null;
    const lineId = this.host.lineOf(engine);
    if (lineId < 0) return null;
    const info = this.line(lineId);
    return info.managed && info.more > 0 ? { more: info.more, trains: info.engines.length } : null;
  }

  /** Is the stop it's heading for beyond a train its line has no room for (it will turn back short of it)? */
  unreachable(engine: number): boolean {
    const m = this.states.get(engine)?.move;
    return !!m && m.dest === DEAD_END && !!m.deadEnd && m.deadEnd.has(this.host.target(engine));
  }

  /** Why a train is held (null: it isn't). */
  waitOf(engine: number): BlockWait | null {
    if (!this.enabled) return null;
    return this.states.get(engine)?.wait ?? null;
  }

  /** Where a train's front is (a slot id, or −1 in a section) and its move, for tests. */
  stateOf(engine: number): { slot: number; move: { section: number; dest: number } | null; exit: number; beyond: number } | null {
    const st = this.states.get(engine);
    return st ? { slot: st.slot, move: st.move && !st.move.free ? { section: st.move.sections[0], dest: st.move.dest } : null, exit: st.exitPiece, beyond: Math.round(st.beyond) } : null;
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
    let longest = 0;
    for (const e of engines) {
      if (!this.firstSeen.has(e)) this.firstSeen.set(e, this.seenCount++);
      const t = this.sim.findCar(e)?.train;
      if (t) longest = Math.max(longest, trainLength(t));
    }
    const topo = topologyOf(this.layout, longest);
    const loops = engines.length >= 2 ? this.loopsOn(lineId, topo) : -1;
    const managed = engines.length >= 2 && loops >= 0;
    let admitted: ReadonlySet<number> = EMPTY;
    let blocked: ReadonlySet<number> = EMPTY;
    if (managed) {
      const order = [...engines].sort((a, b) => this.firstSeen.get(a)! - this.firstSeen.get(b)!);
      admitted = new Set(order.slice(0, loops + 1));
      // A train with no room standing on a loop's road makes that loop no passing place: one train fewer has room.
      for (let k = 0; k < 3; k++) {
        const b = new Set<number>();
        for (const e of engines) {
          if (admitted.has(e)) continue;
          const t = this.sim.findCar(e)?.train;
          if (!t || t.speed >= 1) continue;
          for (const x of t.bogies) {
            const sl = topo.slotOf.get(x.pieceId);
            if (sl !== undefined && topo.slots[sl].kind === "road") b.add(topo.slots[sl].loop);
          }
        }
        blocked = b;
        const next = new Set(order.slice(0, Math.max(1, loops - b.size + 1)));
        if (next.size === admitted.size) break;
        admitted = next;
      }
      // Trains gone from the line give up what they held.
      for (const [e, st] of this.states) if (this.host.lineOf(e) === lineId && !engines.includes(e)) this.states.delete(st.engine);
    }
    info = { engines, topo, loops, admitted, managed, blocked, more: Math.max(0, engines.length - admitted.size) };
    this.lineInfo.set(lineId, info);
    return info;
  }

  /** Passing loops on a line's ways between its stops (−1: none of its ways touch a slot: it's left alone). */
  private loopsOn(lineId: number, topo: Topology): number {
    const stops = this.host.stopPieces(lineId);
    const key = `${stops.join(",")}|${this.layout.revision}:${topo.slots.length}`;
    const hit = this.loopCount.get(lineId);
    if (hit && hit.key === key) return hit.n;
    const loops = new Set<number>();
    let slots = 0;
    for (let i = 0; i < stops.length; i++) {
      const a = stops[i];
      const b = stops[(i + 1) % stops.length];
      if (a === b) continue;
      for (const piece of this.wayPieces(a, b)) {
        const s = topo.slotOf.get(piece);
        if (s === undefined) continue;
        slots++;
        if (topo.slots[s].kind === "road") loops.add(topo.slots[s].loop);
      }
    }
    const n = slots === 0 ? -1 : loops.size;
    this.loopCount.set(lineId, { key, n });
    return n;
  }

  /** The pieces a train goes over from stop piece `from` to stop piece `to`, whichever way out of `from` reaches it. */
  private wayPieces(from: number, to: number): number[] {
    const { layout } = this;
    const out: number[] = [];
    const p = layout.getPiece(from);
    if (!p) return out;
    const def = getPieceDef(p.type, p.flipped);
    for (let c = 0; c < def.connectors.length; c++) {
      if (distanceTo(layout, { pieceId: from, entry: c }, to) < 0) continue;
      const memo = new Map<number, number>();
      const dist = (x: { pieceId: number; entry: number }) => {
        const k = x.pieceId * 8 + x.entry;
        let d = memo.get(k);
        if (d === undefined) memo.set(k, (d = distanceTo(layout, x, to)));
        return d;
      };
      let at: { pieceId: number; entry: number } | null = { pieceId: from, entry: c };
      const seen = new Set<number>();
      for (let k = 0; at && k < SEARCH && at.pieceId !== to; k++) {
        const key = at.pieceId * 8 + at.entry;
        if (seen.has(key)) break;
        seen.add(key);
        out.push(at.pieceId);
        const ways = waysFrom(layout, at.pieceId, at.entry);
        if (ways.length === 0) break;
        const best: number = ways.length > 1 ? wayToward(layout, at.pieceId, ways, to, dist) : 0;
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
  }
}

const EMPTY: ReadonlySet<number> = new Set();
