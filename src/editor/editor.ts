import type { Sim } from "../sim";
import {
  type Anchor,
  connectorRef,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
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
}

const HISTORY_LIMIT = 100;
/** How far apart (mm) and how far from facing (radians) two free ends may be for the track to be pulled together. */
const NEAR_MISS_REACH = 45;
const NEAR_MISS_ANGLE = (12 * Math.PI) / 180;

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

  /** Called when pieces that give (stations, depots) were nudged by a change, its undo or its redo. */
  onNudge: ((ids: number[]) => void) | null = null;

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

  remove(id: number): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    this.run({
      do: () => {
        this.layout.removePiece(id);
      },
      undo: () => {
        this.layout.restorePiece(rec.id, rec.type, rec.pose, rec.y, rec.flipped);
      },
    });
    return true;
  }

  /** Move a piece (it may currently be lifted for dragging; `from` is where it was picked up). */
  /** Move a piece; `flipped`, when given, is how it lands (a ramp may swap its ends to fit where it's put). */
  move(id: number, pose: Pose, y: number, from?: { pose: Pose; y: number }, risers: readonly RiserAt[] = [], flipped?: boolean): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    const start = from ?? { pose: rec.pose, y: rec.y };
    const wasFlipped = rec.flipped;
    const supports = this.supports(risers);
    this.run({
      do: () => {
        supports.add();
        this.layout.dropPiece(id, pose, y, flipped);
      },
      undo: () => {
        this.layout.dropPiece(id, start.pose, start.y, wasFlipped);
        supports.remove();
      },
      moves: [id],
      seats: () => [id],
    });
    return true;
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
    this.run({ do: () => swap(!rec.flipped, flippedPose), undo: () => swap(rec.flipped, rec.pose), moves: [id], seats: () => [id] });
    return true;
  }

  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.changed(c);
  }

  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return;
    c.do();
    this.undoStack.push(c);
    this.changed(c);
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private run(c: Command): void {
    c.do();
    if (c.seats) {
      const seeds = c.seats();
      c = this.takeUpPlay(c, seeds);
      c = this.joinFacingHoles(c, seeds);
    }
    this.undoStack.push(c);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed(c);
  }

  private changed(c: Command): void {
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
    const pinned = (id: number) => (this.fixed(id) && !this.give(id)) || this.sim.pieceOccupied(id);
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
          if (b.kind === a.kind || !facing || Math.abs(b.y - a.y) > 2 || d > NEAR_MISS_REACH || d >= bestDistance) continue;
          best = other;
          bestDistance = d;
        }
        if (best !== -1) out.push([ref, best]);
      }
    }
    return out;
  }

  /**
   * Two track ends whose holes meet can't join (each wants a peg): put a dog-bone joiner between any such pair at
   * the pieces just put down. The joiners join the command (undo takes them up with it).
   */
  private joinFacingHoles(c: Command, seeds: number[]): Command {
    const placed: { id: number; pose: Pose; y: number }[] = [];
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
        if (a.kind !== "socket") continue;
        const n = this.layout.queryFreeConnectors(a.x, a.z, JOINT_POS_TOLERANCE, near);
        for (let k = 0; k < n; k++) {
          const other = near[k];
          if (pieceOfRef(other) === id || this.layout.joinedConnector(other) !== -1) continue;
          this.layout.worldConnector(other, b);
          const facing = Math.abs(normalizeAngle(b.heading - a.heading - Math.PI)) < JOINT_ANGLE_TOLERANCE;
          if (b.kind !== "socket" || !facing || Math.abs(b.y - a.y) > 2 || Math.hypot(b.x - a.x, b.z - a.z) > JOINT_POS_TOLERANCE) continue;
          // Its first peg goes in this hole, pointing back into this piece; the second into the other's.
          const pose = { x: (a.x + b.x) / 2 - Math.cos(a.heading) * 0.5, z: (a.z + b.z) / 2 - Math.sin(a.heading) * 0.5, heading: a.heading };
          const joiner = this.layout.addPiece("joiner", pose, a.y);
          placed.push({ id: joiner, pose, y: a.y });
          break;
        }
      }
    }
    if (placed.length === 0) return c;
    return {
      do: () => {
        c.do();
        for (const j of placed) this.layout.restorePiece(j.id, "joiner", j.pose, j.y, false);
      },
      undo: () => {
        for (const j of placed) this.layout.removePiece(j.id);
        c.undo();
      },
      moves: c.moves,
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
    return p ? { id, type: p.type, pose: { ...p.pose }, y: p.y, flipped: p.flipped } : null;
  }
}
