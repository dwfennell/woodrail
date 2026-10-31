import { getPieceDef, pathLength, type Layout } from "../track";
import { ACCELERATION, ADV_OK, advanceCursor, CAR_SPECS, COUPLER_GAP, createAdvance, flipCursor, type Cursor, type Sim, type Train } from "../sim";
import { next, SEARCH, waysFrom } from "../routing/graph";
import { plan, planWay } from "../routing/plan";
import type { AvoidTest } from "../routing/router";

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
 * - **Room rule**: a line takes one train more than it has passing loops on its way (a loop per extra train). The
 *   rest are held (never sent into a section), with the reason (`waitOf`: kind "room", and how many loops to lay).
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

/** A waiting train stands this far (mm) short of the end of its slot. */
export const STAND_SHORT = 6;
/** A loop road must be this much (mm) longer than a train for the train to stand on it, clear of both switches. */
export const ROAD_MARGIN = 2 * STAND_SHORT;
/** A train asks for its move this far (mm) before it would start to brake for the slot's end. */
const ASK_LOOK = 24;
/** How often (sim ticks) a waiting train asks again. */
export const CHECK_TICKS = 12;

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
  /** The way points lie once trains have passed (the router's default; as they lie now if not given). */
  restsAt?(pieceId: number): number;
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
  /** What lay past its last dead end (its stops there can't be reached while the line is full). */
  lastDead: ReadonlySet<number> | null;
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

const topoCache = new WeakMap<Layout, { key: string; byRoad: Map<number, Topology> }>();

/** The layout's slots and sections for trains of `trainLength` mm (cached per revision, pins and length). */
export function topologyOf(layout: Layout, trainLength: number): Topology {
  // (Pinned switches, and the way each is set, decide which loops pass: part of the key. There are few.)
  let pins = "";
  for (const id of layout.pinnedIds()) pins += `,${id}:${layout.switchState(id)}`;
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
  private readonly states = new Map<number, TrainState>();
  private lineTick = -1;
  private readonly lineInfo = new Map<number, LineInfo>();
  /** The trains each line has room for (kept: see `line`). */
  private readonly admitted = new Map<number, Set<number>>();
  /** Per line: what `line` last worked out of its room (see there), and for what. */
  private readonly slow = new Map<number, { key: string; topo: Topology; blocked: ReadonlySet<number>; more: number; spareCut: boolean; parked: boolean; other: boolean }>();
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
  private readonly loopCount = new Map<number, { key: string; topo: Topology; n: number; set: ReadonlySet<number>; way: ReadonlySet<number>; regions: ReadonlySet<number>; pinnedLoop: boolean }>();
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
  ) {}

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
      const working = this.shared && this.sim.trainIds().length > 1 ? this.workingFor(train) : null;
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
    const engine = nameOf(train);
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
    for (const id of this.sim.trainIds()) {
      const t = this.sim.getTrain(id);
      if (!t || t.derailed) continue;
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
      st = { engine, trainId: train.id, frontKey: -1, tailPiece: -1, slot: -1, beyond: Infinity, exitPiece: -1, exitEntry: -1, move: null, wait: null, askedAt: -Infinity, waitSince: -1, outBy: -1, topo: info.topo, ahead: new Set(), facedAt: -Infinity, faceHold: false, lastDead: null };
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
      this.hold(st, why({ kind: "slot", engine: nameOf(t) }));
      return true;
    }
    // (Any train standing just past its slot's end, its own move not granted on through it: it waits short of it, not
    // running up to the end of the slot into its overhang.)
    if (st.exitPiece !== -1 && !this.ownsAhead(st))
      for (const id of this.sim.trainIds()) {
        const t = this.sim.getTrain(id);
        if (!t || t === train || t.speed >= 1 || !t.bogies.some((b) => b.pieceId === st.exitPiece)) continue;
        const u = nameOf(t);
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
    return !!st.move && st.exitPiece !== -1 && st.move.steps.some((x) => x.pieceId === st.exitPiece);
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
    const loose = this.host.lineOf(st.engine) < 0;
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
      return { steps: kept, sections, through, dest: DEAD_END, outBy: -1, blockedBy: blockedBy !== -1 ? blockedBy : this.heldOf(info, st.engine), deadEnd: this.beyondOf(at!, steps.slice(kept.length).map((x) => x.pieceId)) };
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
          if (u !== -1 && !this.hasRoom(info, u)) return deadEnd(u);
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
        for (const r of roads) {
          if (r !== calls && !into.includes(r)) continue;
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
        // (The router's choice: the plan's way to its stop.)
        const best = target < 0 ? -1 : planWay(layout, at.pieceId, at.entry, ways, target);
        w = best === -1 ? (ways[layout.switchState(at.pieceId) % ways.length] ?? ways[0]) : ways[best];
      }
      steps.push({ pieceId: at.pieceId, path: w.path, entry: at.entry });
      at = next(layout, at.pieceId, w.exit);
    }
    return null;
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
    // (A line stood still for a parked train: every train of it says to move that, as moving it is what works.)
    return { kind: "room", lineId: this.host.lineOf(st.engine), trains: info.engines.length, loops, more: Math.max(1, info.more), spare: info.spareCut, parked: info.parked, other: info.other, pinned: this.pinnedLoopOn(st.engine) };
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

  /** The train of the line (other than `engine`) on a slot, or on its way there; −1 if none. */
  private slotUser(info: LineInfo, slot: number, engine: number): number {
    const pieces = info.topo.slots[slot].pieces;
    for (const u of info.users) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && (m.dest === slot || m.through.includes(slot))) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => pieces.has(b.pieceId))) return u;
    }
    // (Any other train standing or running there, on the line or not: its first car stands for it.)
    for (const t of info.foreign) if (t.bogies.some((b) => pieces.has(b.pieceId))) return nameOf(t);
    return info.zone.slots.get(slot) ?? -1;
  }

  /** The switch train `u` leaves loop road `slot` by. */
  private outByOf(u: number, slot: number): number {
    const st = this.states.get(u);
    if (st?.move && st.move.dest === slot) return st.move.outBy;
    return st?.outBy ?? -1;
  }

  /** The train of the line (other than `engine`) holding a move through a section, or standing in it; −1 if none. */
  private sectionUser(info: LineInfo, section: number, engine: number): number {
    for (const u of info.users) {
      if (u === engine) continue;
      const m = this.states.get(u)?.move;
      if (m && m.sections.includes(section)) return u;
      const t = this.sim.findCar(u)?.train;
      if (t && t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) return u;
    }
    for (const t of info.foreign) if (t.bogies.some((b) => info.topo.sectionOf.get(b.pieceId) === section)) return nameOf(t);
    return info.zone.sections.get(section) ?? -1;
  }

  /** Ask for the move on from its slot: true if granted (or nothing to ask). */
  private ask(st: TrainState, info: LineInfo): boolean {
    const topo = info.topo;
    if (st.exitPiece === -1) return true;
    const section = topo.sectionOf.get(st.exitPiece);
    if (section === undefined) return true;
    if (!this.hasRoom(info, st.engine)) {
      this.hold(st, this.roomWait(st, info));
      return false;
    }
    const u = this.sectionUser(info, section, st.engine);
    // (Only trains the line has no room for standing in it: a dead end short of them; it waits here for them.)
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
    // A dead end ahead (a train its line has no room for in the way): it waits here, in its slot, for that train.
    if (way?.dest === DEAD_END) return this.deadEndWait(st, info, way);
    // (Running through a loop that's no passing place: the sections beyond it must be free too.)
    if (way && way.dest !== -1)
      for (const x of way.sections) {
        const v = x === section ? -1 : this.sectionUser(info, x, st.engine);
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
    // of them; it waits where it stands for them.)
    const section = info.topo.sectionOf.get(front.pieceId);
    const short = this.hasRoom(info, st.engine) && section !== undefined ? this.heldIn(info, section, st.engine) : null;
    if (short) for (const p of mine) short.delete(p);
    const way = this.wayOn(st, info, { pieceId: front.pieceId, entry }, front.pathIndex, short && short.size > 0 ? short : null);
    if (!way) return true;
    if (way.dest === DEAD_END) return this.deadEndWait(st, info, way);
    const ahead = new Set(way.steps.map((s) => s.pieceId));
    for (const u of info.users) {
      if (u === st.engine) continue;
      const t = this.sim.findCar(u)?.train;
      if (!t || (short && !this.hasRoom(info, u))) continue;
      // On its way ahead.
      if (t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) return this.recoverWait(st, u, info);
      // Coming the other way through it (its move's way runs over where this one stands, the other way round).
      const m = this.states.get(u)?.move;
      if (m && m.sections.some((x) => way.sections.includes(x)) && m.steps.some((s) => mine.has(s.pieceId) && way.steps.some((w) => w.pieceId === s.pieceId && w.entry !== s.entry))) return this.recoverWait(st, u, info);
    }
    // (A train not on the line running on its way ahead: wait for it, as for one of the line's.)
    for (const t of info.foreign) if (t.speed >= 1 && t.bogies.some((b) => ahead.has(b.pieceId) && !mine.has(b.pieceId))) return this.recoverWait(st, nameOf(t), info);
    if (way.dest === -1) return this.recoverWait(st, way.blockedBy !== -1 ? way.blockedBy : this.inWayOf(way, train, info), info);
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
    for (const id of this.sim.trainIds()) {
      const t = this.sim.getTrain(id);
      if (!t || t === own || !t.bogies.some((b) => pieces.has(b.pieceId))) continue;
      return nameOf(t);
    }
    return -1;
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
    const loops = engines.length >= 2 || net || (this.shared && engines.length === 1 && this.sim.trainIds().length > 1) ? this.loopsOn(lineId, topo) : -1;
    const peers: number[] = [];
    if (net && loops >= 0) for (const l of net.lines) if (l !== lineId && this.loopsOn(l, topo) >= 0) peers.push(...this.host.live(l));
    // (Trains on no line with their levers on, on the network's slots and sections: they work its single track too.)
    const loose: number[] = [];
    const looseTrains: Train[] = [];
    if (this.shared && loops >= 0 && this.sim.trainIds().length > engines.length + peers.length) {
      const regions = new Set<number>(this.loopCount.get(lineId)?.regions ?? EMPTY);
      if (net) for (const l of net.lines) for (const r of this.loopCount.get(l)?.regions ?? EMPTY) regions.add(r);
      for (const id of this.sim.trainIds()) {
        const t = this.sim.getTrain(id);
        if (!t || t.derailed || this.host.drive(t) === 0 || !t.cars.some((c) => c.kind === "engine")) continue;
        if (t.cars.some((c) => c.kind === "engine" && this.host.lineOf(c.id) >= 0)) continue;
        if (!t.bogies.some((b) => regions.has(regionOf(topo, b.pieceId) ?? NaN))) continue;
        loose.push(nameOf(t));
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
    if (managed) {
      // Every other train on the track (another line's, or one standing on its own) is in the way where it stands.
      const mine = new Set([...engines, ...peers].map((e) => this.sim.findCar(e)?.train.id ?? -1));
      for (const t of looseTrains) mine.add(t.id);
      for (const id of this.sim.trainIds()) {
        const t = this.sim.getTrain(id);
        if (t && !t.derailed && !mine.has(id)) foreign.push(t);
      }
      // Which trains it has room for: kept once given (a train is never left without room mid-way), more let in as
      // room allows, in the order they came to the line. Room: a train more than its passing loops, less the loops a
      // standing train it has no room for (or one not on the line) takes a road of.
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
        const roomOf = (adm: ReadonlySet<number>) => Math.max(1, loops - roadsHeld(adm).b.size + 1);
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
            if (sl === undefined) sec = true;
            else if (topo.slots[sl].kind === "road") road = true;
            else end = true;
          }
          return sec ? 0 : end ? 1 : road ? 2 : 3;
        };
        // (The newest last: the one held when room runs out is the one just put on the line. The player put it there,
        // and can take it off again: "Put away" on its card.)
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
          this.onFull(lineId, room, engines.length, Math.max(1, engines.length - room));
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
        // (Loops to lay: enough for a loop between each two of its trains, past those a train not on the line stands on.
        // Its own held trains count as trains: once there's room they're let in and give their loop back.)
        if (engines.length > admitted.size) more = Math.max(1, engines.length - 1 - (loops - held.gone));
        parked = held.gone > 0;
        other = parked && !byParked;
        this.slow.set(lineId, { key, topo, blocked, more, spareCut, parked, other });
      }
      // Trains gone from the line give up what they held.
      for (const [e, st] of this.states) if (this.host.lineOf(e) === lineId && !engines.includes(e)) this.states.delete(st.engine);
    }
    const zone = { slots: new Map<number, number>(), sections: new Map<number, number>() };
    if (managed) for (const t of foreign) if (t.speed >= 1) this.zoneOf(t, topo, zone);
    info = { engines, users: peers.length + loose.length > 0 ? [...engines, ...peers, ...loose] : engines, loose, topo, loops, admitted, managed, blocked, more, foreign, spareCut, parked, other, zone };
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
    for (const id of this.sim.trainIds()) {
      const t = this.sim.getTrain(id);
      if (!t || t.derailed) continue;
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
    let key = `${this.layout.revision}${pins}`;
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
    const look = (train.speed * train.speed) / (2 * ACCELERATION) + gap + 4 * CLEAR_STEP;
    const others: Train[] = [];
    if (among) {
      for (const t of among) if (t !== train && !t.derailed) others.push(t);
    } else
      for (const id of this.sim.trainIds()) {
        const t = this.sim.getTrain(id);
        if (t && t !== train && !t.derailed) others.push(t);
      }
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
            if (this.clearBy.size > 4 * this.sim.trainIds().length) for (const [id, c] of this.clearBy) if (c.tick < this.sim.ticks - 1) this.clearBy.delete(id);
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
    const id = nameOf(t);
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

  /** Is a loop on its line's way pinned so it's no passing place (see `findLoops`)? */
  private pinnedLoopOn(engine: number): boolean {
    return this.loopCount.get(this.host.lineOf(engine))?.pinnedLoop ?? false;
  }

  /** Passing loops on a line's ways between its stops (−1: none of its ways touch a slot: it's left alone). */
  private loopsOn(lineId: number, topo: Topology): number {
    const stops = this.host.stopPieces(lineId);
    const key = `${stops.join(",")}|${this.layout.revision}:${topo.slots.length}`;
    const hit = this.loopCount.get(lineId);
    // (The same topology too: pinning a loop's switches changes it, not the track's revision.)
    if (hit && hit.key === key && hit.topo === topo) return hit.n;
    const loops = new Set<number>();
    const way = this.wayOf(lineId);
    let slots = 0;
    for (const piece of way) {
      const s = topo.slotOf.get(piece);
      if (s === undefined) continue;
      slots++;
      if (topo.slots[s].kind === "road") loops.add(topo.slots[s].loop);
    }
    const n = slots === 0 ? -1 : loops.size;
    // (Its network: the slots and sections its ways run through, and its loops' other roads. A train elsewhere, on
    // track it doesn't use or a layout of its own, is none of its business.)
    const regions = new Set<number>();
    for (const p of way) {
      const r = regionOf(topo, p);
      if (r !== null) regions.add(r);
    }
    for (const sl of topo.slots) if (sl.kind === "road" && loops.has(sl.loop)) regions.add(sl.id);
    // (A loop on its way pinned so every train takes one road: no passing place till it's unpinned.)
    const pinnedLoop = topo.pinnedLoops.some((pl) => pl.pieces.some((p) => way.has(p)));
    this.loopCount.set(lineId, { key, topo, n, set: loops, way, regions, pinnedLoop });
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

/**
 * The id a train not on the line is named by in waits: its (first) engine's, so it can be looked up (its line, its
 * card), whichever way round it runs: its first car is a wagon once it's reversed. Its first car when it has none.
 */
function nameOf(t: Train): number {
  return t.cars.find((c) => c.kind === "engine")?.id ?? t.cars[0].id;
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
