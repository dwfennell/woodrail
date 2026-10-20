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
  | { kind: "room"; lineId: number; trains: number; loops: number; more: number };

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
}

/** One step of a move's way: a piece, the path along it, and the end it comes in by. */
interface Step {
  pieceId: number;
  path: number;
  entry: number;
}

interface Move {
  section: number;
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
    if (net === 0) return Infinity;
    let st = this.states.get(engine);
    if (!st) {
      st = { engine, trainId: train.id, frontKey: -1, tailPiece: -1, slot: -1, beyond: Infinity, exitPiece: -1, exitEntry: -1, move: null, wait: null, askedAt: -Infinity, waitSince: -1, outBy: -1, topo: info.topo };
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
      if (st.move) return Infinity;
      if (now - st.askedAt < CHECK_TICKS) return st.wait ? 0 : Infinity;
      st.askedAt = now;
      return this.recover(st, info, train, front) ? Infinity : 0;
    }
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

  /** Does it hold the move on from the slot it's in (granted at this slot's end)? */
  private ownsAhead(st: TrainState): boolean {
    return !!st.move && !st.move.free && st.move.steps.length > 0 && st.move.steps[0].pieceId === st.exitPiece;
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
    if (slot === undefined) return;
    let exit = front.reversed ? path.from : (path.to ?? -1);
    let beyond = -STAND_SHORT;
    let at = front.pieceId;
    for (let k = 0; k < SEARCH; k++) {
      const n = next(layout, at, exit);
      if (!n) return;
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
  private wayOn(st: TrainState, info: LineInfo, start: { pieceId: number; entry: number }, firstPath = -1): { steps: Step[]; section: number; dest: number; outBy: number; blockedBy: number } | null {
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
    const section = topo.sectionOf.get(start.pieceId) ?? -1;
    let at: { pieceId: number; entry: number } | null = start;
    for (let k = 0; at && k < SEARCH; k++) {
      const slot = topo.slotOf.get(at.pieceId);
      if (slot !== undefined) {
        const s = topo.slots[slot];
        if (s.kind === "end") {
          const u = this.slotUser(info, slot, st.engine);
          return { steps, section, dest: u === -1 ? slot : -1, outBy: -1, blockedBy: u };
        }
        const loop = topo.loops[s.loop];
        const prev = steps[steps.length - 1];
        const outBy = prev?.pieceId === loop.a ? loop.b : loop.a;
        let blockedBy = -1;
        // The road steering takes, else the other one, if it has room and the facing switch can send it there; and
        // never a second train into a loop going out the same way as the one there (a loop holds two only to pass).
        for (const r of s.road === 0 ? loop.roads : [loop.roads[1], loop.roads[0]]) {
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
            const w = waysFrom(layout, prev.pieceId, prev.entry).find((x) => {
              const n = next(layout, prev.pieceId, x.exit);
              return !!n && topo.slotOf.get(n.pieceId) === r;
            });
            if (!w) continue;
            prev.path = w.path;
          }
          return { steps, section, dest: r, outBy, blockedBy: -1 };
        }
        return { steps, section, dest: -1, outBy, blockedBy };
      }
      const ways = waysFrom(layout, at.pieceId, at.entry);
      if (ways.length === 0) return null;
      let w = ways[0];
      if (k === 0 && firstPath !== -1) w = ways.find((x) => x.path === firstPath) ?? w;
      else if (ways.length > 1) {
        const best = wayToward(layout, at.pieceId, ways, target, dist);
        w = best === -1 ? (ways[layout.switchState(at.pieceId) % ways.length] ?? ways[0]) : ways[best];
      }
      steps.push({ pieceId: at.pieceId, path: w.path, entry: at.entry });
      at = next(layout, at.pieceId, w.exit);
    }
    return null;
  }

  /** The train of the line (other than `engine`) on a slot, or on its way there; −1 if none. */
  private slotUser(info: LineInfo, slot: number, engine: number): number {
    const pieces = info.topo.slots[slot].pieces;
    for (const u of info.engines) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && !m.free && m.dest === slot) return u;
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
      if (m && !m.free && m.section === section) return u;
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
      const loops = Math.max(0, info.loops);
      this.hold(st, { kind: "room", lineId: this.host.lineOf(st.engine), trains: info.engines.length, loops, more: info.engines.length - 1 - loops });
      return false;
    }
    const u = this.sectionUser(info, section, st.engine);
    if (u !== -1) {
      this.hold(st, { kind: "section", engine: u });
      return false;
    }
    const way = this.wayOn(st, info, { pieceId: st.exitPiece, entry: st.exitEntry });
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
    const way = this.wayOn(st, info, { pieceId: front.pieceId, entry }, front.pathIndex);
    if (!way) return true;
    const mine = new Set(train.bogies.map((b) => b.pieceId));
    const ahead = new Set(way.steps.map((s) => s.pieceId));
    for (const u of info.engines) {
      if (u === st.engine) continue;
      const t = this.sim.findCar(u)?.train;
      if (!t) continue;
      // On its way ahead.
      if (t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) return this.recoverWait(st, u);
      // Coming the other way through it (its move's way runs over where this one stands, the other way round).
      const m = this.states.get(u)?.move;
      if (m && !m.free && m.section === way.section && m.steps.some((s) => mine.has(s.pieceId) && way.steps.some((w) => w.pieceId === s.pieceId && w.entry !== s.entry))) return this.recoverWait(st, u);
    }
    if (way.dest === -1) return this.recoverWait(st, way.blockedBy);
    this.grant(st, way);
    return true;
  }

  /** A train in a section waits for `u`; a mutual wait that lasts is let go (the safety net, logged). */
  private recoverWait(st: TrainState, u: number): boolean {
    this.hold(st, { kind: "section", engine: u });
    const other = this.states.get(u)?.wait;
    const mutual = !!other && other.kind !== "room" && other.engine === st.engine;
    if (mutual && this.sim.ticks - st.waitSince > MUTUAL_S * 120) {
      // (Let go with no slot at its end: it runs on, meets the other and turns back as before, then asks again.)
      this.released++;
      st.wait = null;
      st.waitSince = -1;
      st.move = { section: -1, dest: -1, outBy: -1, steps: [], follow: () => false, aim: -1, free: true, since: this.sim.ticks };
      return true;
    }
    return false;
  }

  private hold(st: TrainState, wait: BlockWait): void {
    if (!st.wait) st.waitSince = this.sim.ticks;
    st.wait = wait;
    this.refused++;
  }

  private grant(st: TrainState, way: { steps: Step[]; section: number; dest: number; outBy: number }): void {
    const keys = new Set(way.steps.map((s) => s.pieceId * 8 + s.path));
    let aim = -1;
    for (const p of st.topo.slots[way.dest].pieces) {
      aim = p;
      break;
    }
    st.move = { section: way.section, dest: way.dest, outBy: way.outBy, steps: way.steps, follow: (pieceId, path) => keys.has(pieceId * 8 + path), aim, free: false, since: this.sim.ticks };
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

  /** Why a train is held (null: it isn't). */
  waitOf(engine: number): BlockWait | null {
    if (!this.enabled) return null;
    return this.states.get(engine)?.wait ?? null;
  }

  /** Where a train's front is (a slot id, or −1 in a section) and its move, for tests. */
  stateOf(engine: number): { slot: number; move: { section: number; dest: number } | null; exit: number; beyond: number } | null {
    const st = this.states.get(engine);
    return st ? { slot: st.slot, move: st.move && !st.move.free ? { section: st.move.section, dest: st.move.dest } : null, exit: st.exitPiece, beyond: Math.round(st.beyond) } : null;
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
    if (managed) {
      const order = [...engines].sort((a, b) => this.firstSeen.get(a)! - this.firstSeen.get(b)!);
      admitted = new Set(order.slice(0, loops + 1));
      // Trains gone from the line give up what they held.
      for (const [e, st] of this.states) if (this.host.lineOf(e) === lineId && !engines.includes(e)) this.states.delete(st.engine);
    }
    info = { engines, topo, loops, admitted, managed };
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
