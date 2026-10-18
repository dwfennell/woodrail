import type { Sim } from "../sim";
import {
  type Anchor,
  connectorRef,
  getPieceDef,
  normalizeAngle,
  pieceOfRef,
  relaxJoints,
  solveParentPose,
  transformPose,
  type Layout,
  type PieceTypeId,
  type Pose,
  type WorldConnector,
} from "../track";

interface PieceRecord {
  id: number;
  type: PieceTypeId;
  pose: Pose;
  y: number;
  flipped: boolean;
  /** Its switch state, if not 0 (a turntable's deck's road, a lift's platform at its high end): put back with it. */
  switchState?: number;
}

interface Command {
  do(): void;
  undo(): void;
  /** Existing pieces this command moves or reshapes (trains standing on them derail). */
  moves?: number[];
  /** Pieces this command put down: joint play near them is taken up afterwards (part of the same undo step). */
  seats?: () => number[];
  /** Changes only props (not the track): undo and redo skip the track's work and tell `onPropsChange`. */
  props?: boolean;
  /** Changes the land (squares' heights): undo and redo tell `onLandChange` the plots to redraw. */
  land?: () => number[];
  /** Changes only road pieces: done, undone and redone, it tells `onRoadsChange` the plots (and whether trees went). */
  roads?: { slots: number[]; trees: boolean };
}

const HISTORY_LIMIT = 100;
/** How far apart (mm) and how far from facing (radians) two free ends may be for the track to be pulled together. */
const NEAR_MISS_REACH = 45;
const NEAR_MISS_ANGLE = (12 * Math.PI) / 180;

/** A piece to put down along with an edit. */
export interface Placement {
  type: PieceTypeId;
  pose: Pose;
  y: number;
  flipped?: boolean;
}

/** A riser to put down under a piece. */
export interface RiserAt {
  pose: Pose;
  y: number;
}

/** Piece-local centre: the mean of its connector positions (origin for pieces without connectors). */
export function localCentre(type: PieceTypeId, flipped: boolean): { x: number; z: number } {
  const cs = getPieceDef(type, flipped).connectors;
  if (cs.length === 0) return { x: 0, z: 0 };
  let x = 0;
  let z = 0;
  for (const c of cs) {
    x += c.pose.x;
    z += c.pose.z;
  }
  return { x: x / cs.length, z: z / cs.length };
}

/** World (plan) centre of a placed piece. */
export function pieceCentre(layout: Layout, id: number): { x: number; z: number } {
  const p = layout.getPiece(id)!;
  const c = localCentre(p.type, p.flipped);
  const ch = Math.cos(p.pose.heading);
  const sh = Math.sin(p.pose.heading);
  return { x: p.pose.x + c.x * ch - c.z * sh, z: p.pose.z + c.x * sh + c.z * ch };
}

/** World (plan) centre of a piece at `pose`. */
export function poseCentre(type: PieceTypeId, flipped: boolean, pose: Pose): { x: number; z: number } {
  const c = localCentre(type, flipped);
  const ch = Math.cos(pose.heading);
  const sh = Math.sin(pose.heading);
  return { x: pose.x + c.x * ch - c.z * sh, z: pose.z + c.x * sh + c.z * ch };
}

/** The pose that puts a piece's centre at (x, z) with the given heading. */
export function poseForCentre(type: PieceTypeId, flipped: boolean, x: number, z: number, heading: number): Pose {
  const c = localCentre(type, flipped);
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  return { x: x - (c.x * ch - c.z * sh), z: z - (c.x * sh + c.z * ch), heading };
}

/** Undoable track edits. Every change notifies the simulation (trains on removed track derail) and `onChange`. */
export class Editor {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(
    private readonly layout: Layout,
    private readonly sim: Sim,
    private readonly onChange: () => void,
    /** Pieces that never shift to take up joint play (stations, depots). Track under a train never shifts either. */
    private readonly fixed: (pieceId: number) => boolean = () => false,
    /** Of those, the ones that may give a little (see `Anchor`): their home, and how far they may go from it. */
    private readonly give: (pieceId: number) => Anchor | null = () => null,
  ) {}

  /** Called when an edit, undo or redo was refused: it would have taken up or moved this lift while it's held (`run`). */
  onHeld: ((liftId: number) => void) | null = null;

  /** Called when pieces that give (stations, depots) were nudged by a change, its undo or its redo. */
  onNudge: ((ids: number[]) => void) | null = null;

  /** Called when track is put down or moved (not undone), with the pieces it put down. */
  onTrackEdit: ((ids: number[]) => void) | null = null;

  /** Called after a props-only edit is done, undone or redone (instead of `onChange`). */
  onPropsChange: (() => void) | null = null;

  /** Called after a land edit is undone or redone, with the plots it changed (the editor redraws its own edits). */
  onLandChange: ((slots: number[]) => void) | null = null;

  /** Record a land edit, already done (by the caller, who redrew it), as one undo step. `slots` gives its plots. */
  recordLand(c: { do(): void; undo(): void; slots: () => number[] }): void {
    this.undoStack.push({ do: c.do, undo: c.undo, land: c.slots });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.onPropsChange?.();
  }

  /** Called after a road edit is done, undone or redone, with its plots and whether it cleared or brought back trees. */
  onRoadsChange: ((slots: number[], trees: boolean) => void) | null = null;

  /** Do a road edit (pieces on squares) as one undo step. */
  editRoads(c: { do(): void; undo(): void; slots: number[]; trees: boolean }): void {
    this.run({ do: c.do, undo: c.undo, roads: { slots: c.slots, trees: c.trees } });
  }

  /** Do a props edit as one undo step. */
  editProps(c: { do(): void; undo(): void }): void {
    this.run({ ...c, props: true });
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Place a piece, with any risers it rests on (`risers`, added in the same undo step). */
  place(type: PieceTypeId, pose: Pose, y: number, flipped: boolean, risers: readonly RiserAt[] = []): number {
    let id = -1;
    const supports = this.supports(risers);
    this.run({
      do: () => {
        supports.add();
        if (id === -1) id = this.layout.addPiece(type, pose, y, flipped);
        else this.layout.restorePiece(id, type, pose, y, flipped);
      },
      undo: () => {
        this.layout.removePiece(id);
        supports.remove();
      },
      seats: () => [id],
    });
    return id;
  }

  /** Place a run of pieces (a drawn line), in order, as one undo step. Returns their ids. */
  placeRun(pieces: readonly { type: PieceTypeId; pose: Pose; y: number; flipped: boolean }[]): number[] {
    const ids: number[] = [];
    this.run({
      do: () => {
        pieces.forEach((p, i) => {
          if (ids[i] === undefined) ids[i] = this.layout.addPiece(p.type, p.pose, p.y, p.flipped);
          else this.layout.restorePiece(ids[i], p.type, p.pose, p.y, p.flipped);
        });
      },
      undo: () => {
        for (let i = ids.length - 1; i >= 0; i--) this.layout.removePiece(ids[i]);
      },
      seats: () => [...ids],
    });
    return ids;
  }

  /** Take up a piece. False if there's none, or it may not be taken up now (see `run`). */
  remove(id: number): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    return this.run({
      do: () => {
        this.layout.removePiece(id);
      },
      undo: () => {
        this.restore(rec);
      },
    });
  }

  /** Move a piece (it may currently be lifted for dragging; `from` is where it was picked up). */
  /**
   * Pieces pushed a little, together (a run of track pulled along): from `before` to `after`, keeping their joints.
   * Their ends may then close near misses (a run's tail pulled up to a station). One undo step.
   */
  nudge(before: ReadonlyMap<number, Pose>, after: ReadonlyMap<number, Pose>): void {
    const ids = [...after.keys()];
    this.run({
      do: () => this.layout.nudgePieces(after),
      undo: () => this.layout.nudgePieces(before),
      moves: ids,
      seats: () => ids,
    });
  }

  /**
   * Move pieces together, rigidly (a selection dragged or turned): from `before` to `after`. Joints among them hold;
   * joints to other track part, and their free ends seat wherever they now meet track. One undo step.
   */
  moveGroup(before: ReadonlyMap<number, Pose>, after: ReadonlyMap<number, Pose>): void {
    const ids = new Set(after.keys());
    let parted: number[] = [];
    let seated: number[] = [];
    this.run({
      do: () => {
        parted = this.layout.partFrom(ids);
        this.layout.nudgePieces(after);
        seated = this.layout.seatEnds(ids);
      },
      undo: () => {
        for (const ref of seated) this.layout.unseat(ref);
        this.layout.nudgePieces(before);
        for (const ref of parted) this.layout.seatFree(ref);
      },
      moves: [...ids],
      seats: () => [...ids],
    });
  }

  /** Take up several pieces at once (one undo step). */
  removeGroup(ids: readonly number[]): boolean {
    const recs = ids.map((id) => this.record(id)).filter((r): r is PieceRecord => r !== null);
    if (recs.length === 0) return false;
    return this.run({
      do: () => {
        for (const r of recs) this.layout.removePiece(r.id);
      },
      undo: () => {
        for (const r of recs) this.restore(r);
      },
    });
  }

  /**
   * Put a piece down in place of others (a depot dropped onto the straights of a line): they're taken up and it goes
   * down where they were, joined to the track either side. With `move`, it's that piece moved there (it may be lifted
   * for dragging; `move.from` is where it was picked up), else a new one. `fill`: pieces put down where a moved piece
   * was (straights closing the gap a depot leaves in a line). One undo step: undo puts the straights back.
   * Returns the piece's id.
   */
  replace(
    covers: readonly number[],
    type: PieceTypeId,
    pose: Pose,
    y: number,
    flipped: boolean,
    move?: { id: number; from: { pose: Pose; y: number } },
    fill: readonly Placement[] = [],
  ): number {
    const recs = covers.map((id) => this.record(id)).filter((r): r is PieceRecord => r !== null);
    const was = move ? this.record(move.id) : null;
    let id = move?.id ?? -1;
    const filler = this.filler(fill);
    this.run({
      do: () => {
        for (const r of recs) this.layout.removePiece(r.id);
        if (move) this.layout.dropPiece(id, pose, y, flipped);
        else if (id === -1) id = this.layout.addPiece(type, pose, y, flipped);
        else this.layout.restorePiece(id, type, pose, y, flipped);
        filler.add();
      },
      undo: () => {
        filler.remove();
        if (move) this.layout.dropPiece(id, move.from.pose, move.from.y, was?.flipped);
        else this.layout.removePiece(id);
        for (const r of recs) this.layout.restorePiece(r.id, r.type, r.pose, r.y, r.flipped);
      },
      moves: move ? [move.id] : [],
      seats: () => [id, ...filler.ids],
    });
    return id;
  }

  /**
   * Move a piece; `flipped`, when given, is how it lands (a ramp may swap its ends to fit where it's put). `fill`:
   * pieces put down where it was, in the same undo step (straights closing the gap a depot leaves in a line).
   */
  move(id: number, pose: Pose, y: number, from?: { pose: Pose; y: number }, risers: readonly RiserAt[] = [], flipped?: boolean, fill: readonly Placement[] = []): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    const start = from ?? { pose: rec.pose, y: rec.y };
    const wasFlipped = rec.flipped;
    const supports = this.supports(risers);
    const filler = this.filler(fill);
    return this.run({
      do: () => {
        supports.add();
        this.layout.dropPiece(id, pose, y, flipped);
        filler.add();
      },
      undo: () => {
        filler.remove();
        this.layout.dropPiece(id, start.pose, start.y, wasFlipped);
        supports.remove();
      },
      moves: [id],
      seats: () => [id, ...filler.ids],
    });
  }

  rotate(id: number, delta: number): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    const c = pieceCentre(this.layout, id);
    return this.move(id, poseForCentre(rec.type, rec.flipped, c.x, c.z, rec.pose.heading + delta), rec.y);
  }

  /**
   * Where a piece goes when flipped: mirrored about an end that's joined to other track (else its first end), so that
   * end stays put and the piece bends the other way from it.
   */
  flippedPose(id: number): Pose | null {
    const rec = this.record(id);
    if (!rec) return null;
    const def = getPieceDef(rec.type, rec.flipped);
    let pivot = def.connectors.findIndex((_, i) => this.layout.joinedConnector(connectorRef(id, i)) !== -1);
    if (pivot === -1) pivot = 0;
    if (def.connectors.length === 0) return rec.pose;
    const end = transformPose(rec.pose, def.connectors[pivot].pose, { x: 0, z: 0, heading: 0 });
    return solveParentPose(getPieceDef(rec.type, !rec.flipped).connectors[pivot].pose, end, { x: 0, z: 0, heading: 0 });
  }

  flip(id: number): boolean {
    const rec = this.record(id);
    if (!rec || !getPieceDef(rec.type, false).flippable) return false;
    const flippedPose = this.flippedPose(id)!;
    const swap = (flipped: boolean, pose: Pose) => {
      this.layout.removePiece(id);
      this.layout.restorePiece(id, rec.type, pose, rec.y, flipped);
    };
    return this.run({ do: () => swap(!rec.flipped, flippedPose), undo: () => swap(rec.flipped, rec.pose), moves: [id], seats: () => [id] });
  }

  /** Undo the last edit. Refused, the history kept as it was, if it would take up or move a held lift (see `run`). */
  undo(): boolean {
    const c = this.undoStack[this.undoStack.length - 1];
    if (!c || !this.step(c, () => c.undo(), () => c.do())) return false;
    this.redoStack.push(this.undoStack.pop()!);
    this.changed(c);
    return true;
  }

  /** Redo the last edit undone. Refused, as `undo` is, if it would take up or move a held lift. */
  redo(): boolean {
    const c = this.redoStack[this.redoStack.length - 1];
    if (!c || !this.step(c, () => c.do(), () => c.undo())) return false;
    this.undoStack.push(this.redoStack.pop()!);
    this.changed(c);
    return true;
  }

  /** One way of an undo step (`go`), put straight back (`back`) and refused if it disturbed a held lift. */
  private step(c: Command, go: () => void, back: () => void): boolean {
    const held = c.props || c.land || c.roads ? null : this.held();
    go();
    if (!held) return true;
    const id = this.disturbed(held, c);
    if (id === -1) return true;
    back();
    this.onHeld?.(id);
    return false;
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Do an edit as one undo step. Refused (false, undone at once, `onHeld` told) if it would take up or move a lift
   * that's carrying a train or has one on it (`Sim.heldLifts`): the train would be left derailed in mid-air.
   */
  private run(c: Command): boolean {
    const held = c.props || c.land || c.roads ? null : this.held();
    c.do();
    if (held) {
      const id = this.disturbed(held, c);
      if (id !== -1) {
        c.undo();
        this.onHeld?.(id);
        return false;
      }
    }
    if (c.seats) {
      const seeds = c.seats();
      this.onTrackEdit?.(seeds);
      c = this.takeUpPlay(c, seeds);
    }
    this.undoStack.push(c);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed(c);
    return true;
  }

  private changed(c: Command): void {
    if (c.roads) {
      this.onRoadsChange?.(c.roads.slots, c.roads.trees);
      return;
    }
    if (c.land) {
      this.onLandChange?.(c.land());
      return;
    }
    if (c.props) {
      this.onPropsChange?.();
      return;
    }
    this.sim.trackChanged(c.moves ?? []);
    this.onChange();
  }

  /**
   * Spread any joint play the command left near `seeds` along the loose track around it, so no joint gapes. The
   * shift joins the command: redo puts the pieces back where they were shifted to, undo where they were before.
   */
  private takeUpPlay(c: Command, seeds: number[]): Command {
    const pinned = (id: number) => (this.fixed(id) && !this.give(id)) || this.sim.pieceOccupied(id) || !this.sim.liftFree(id);
    const anchor = (id: number) => (this.fixed(id) && !this.sim.pieceOccupied(id) ? this.give(id) : null);
    const nudged = (moved: Map<number, Pose>) => {
      const ids = [...moved.keys()].filter((id) => this.fixed(id));
      if (ids.length > 0) this.onNudge?.(ids);
    };
    const posesOf = (ids: Iterable<number>) => new Map([...ids].map((id) => [id, { ...this.layout.getPiece(id)!.pose }]));
    const wrap = (after: Map<number, Pose>, before: Map<number, Pose>, close: readonly number[]): Command => ({
      do: () => {
        c.do();
        this.layout.nudgePieces(after);
        for (const ref of close) this.layout.seatFree(ref);
        nudged(after);
      },
      undo: () => {
        // Near misses it closed part again (a pushed run isn't taken up, which would part them).
        for (const ref of close) this.layout.unseat(ref);
        this.layout.nudgePieces(before);
        c.undo();
        nudged(before);
      },
      moves: c.moves,
    });
    // Ends left a near miss apart (a loop closing a little off) are pulled together: the loose track around them
    // gives a little at each joint, as wooden track does when pushed. If that can't seat them, they stay apart.
    const near = this.nearMisses(seeds);
    if (near.length > 0) {
      const pulled = relaxJoints(this.layout, seeds, pinned, near, anchor);
      if (pulled.size > 0) {
        const before = posesOf(pulled.keys());
        this.layout.nudgePieces(pulled);
        const closed = near.map(([a]) => a).filter((ref) => this.layout.seatFree(ref));
        if (closed.length > 0) {
          nudged(pulled);
          return wrap(pulled, before, closed);
        }
        this.layout.nudgePieces(before);
      }
    }
    const after = relaxJoints(this.layout, seeds, pinned, [], anchor);
    if (after.size === 0) return c;
    const before = posesOf(after.keys());
    this.layout.nudgePieces(after);
    nudged(after);
    return wrap(after, before, []);
  }

  /**
   * Free ends of the pieces just put down that nearly meet another free end: of the other kind, at the same height,
   * facing it, but further off than the joint's play (`JOINT_POS_TOLERANCE`, `JOINT_ANGLE_TOLERANCE`).
   */
  private nearMisses(seeds: readonly number[]): [number, number][] {
    const out: [number, number][] = [];
    const a: WorldConnector = { x: 0, z: 0, heading: 0, y: 0, kind: "socket" };
    const b: WorldConnector = { x: 0, z: 0, heading: 0, y: 0, kind: "socket" };
    const near: number[] = [];
    for (const id of seeds) {
      const p = this.layout.getPiece(id);
      if (!p) continue;
      const count = getPieceDef(p.type, p.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(id, i);
        if (this.layout.joinedConnector(ref) !== -1) continue;
        this.layout.worldConnector(ref, a);
        const n = this.layout.queryFreeConnectors(a.x, a.z, NEAR_MISS_REACH, near);
        let best = -1;
        let bestDistance = Infinity;
        for (let k = 0; k < n; k++) {
          const other = near[k];
          if (pieceOfRef(other) === id || this.layout.joinedConnector(other) !== -1) continue;
          this.layout.worldConnector(other, b);
          const d = Math.hypot(b.x - a.x, b.z - a.z);
          const facing = Math.abs(normalizeAngle(b.heading - a.heading - Math.PI)) <= NEAR_MISS_ANGLE;
          if (!facing || Math.abs(b.y - a.y) > 2 || d > NEAR_MISS_REACH || d >= bestDistance) continue;
          best = other;
          bestDistance = d;
        }
        if (best !== -1) out.push([ref, best]);
      }
    }
    return out;
  }

  /** Pieces to put down with an edit (a fill): added the first time, restored with the same ids on redo. */
  private filler(fill: readonly Placement[]): { add(): void; remove(): void; ids: number[] } {
    const ids: number[] = [];
    return {
      ids,
      add: () => {
        fill.forEach((p, i) => {
          if (ids[i] === undefined) ids[i] = this.layout.addPiece(p.type, p.pose, p.y, p.flipped ?? false);
          else this.layout.restorePiece(ids[i], p.type, p.pose, p.y, p.flipped ?? false);
        });
      },
      remove: () => {
        for (let i = ids.length - 1; i >= 0; i--) this.layout.removePiece(ids[i]);
      },
    };
  }

  /** Risers to put down with a piece: added the first time, restored with the same ids on redo. */
  private supports(risers: readonly RiserAt[]): { add(): void; remove(): void } {
    const ids: number[] = [];
    return {
      add: () => {
        risers.forEach((r, i) => {
          if (ids[i] === undefined) ids[i] = this.layout.addPiece("riser", r.pose, r.y);
          else this.layout.restorePiece(ids[i], "riser", r.pose, r.y, false);
        });
      },
      remove: () => {
        for (const id of ids) this.layout.removePiece(id);
      },
    };
  }

  private record(id: number): PieceRecord | null {
    const p = this.layout.getPiece(id);
    if (!p) return null;
    const rec: PieceRecord = { id, type: p.type, pose: { ...p.pose }, y: p.y, flipped: p.flipped };
    const state = this.layout.switchState(id);
    if (state !== 0) rec.switchState = state;
    return rec;
  }

  /** Put a piece taken up back as it was (its switch state too: a lift's platform where it stood). */
  private restore(r: PieceRecord): void {
    if (this.layout.restorePiece(r.id, r.type, r.pose, r.y, r.flipped) && r.switchState !== undefined) this.layout.setSwitchState(r.id, r.switchState);
  }

  /**
   * The lifts that mustn't be taken up or moved now (`Sim.heldLifts`: carrying a train, going, or with a train on
   * one), as they stand; null if none (at once, on a layout without a lift).
   */
  private held(): PieceRecord[] | null {
    const ids = this.sim.heldLifts();
    return ids.length === 0 ? null : ids.map((id) => this.record(id)!);
  }

  /** The first of `held` that `c` took up, moved, turned or flipped (it's done), or −1. */
  private disturbed(held: readonly PieceRecord[], c: Command): number {
    for (const r of held) {
      const p = this.layout.getPiece(r.id);
      const moved = !p || this.layout.isLifted(r.id) || p.y !== r.y || p.flipped !== r.flipped || p.pose.x !== r.pose.x || p.pose.z !== r.pose.z || p.pose.heading !== r.pose.heading;
      if (moved || c.moves?.includes(r.id)) return r.id;
    }
    return -1;
  }
}
