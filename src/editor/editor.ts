import type { Sim } from "../sim";
import { getPieceDef, type Layout, type PieceTypeId, type Pose } from "../track";

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
}

const HISTORY_LIMIT = 100;

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
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  place(type: PieceTypeId, pose: Pose, y: number, flipped: boolean): number {
    let id = -1;
    this.run({
      do: () => {
        if (id === -1) id = this.layout.addPiece(type, pose, y, flipped);
        else this.layout.restorePiece(id, type, pose, y, flipped);
      },
      undo: () => {
        this.layout.removePiece(id);
      },
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
  move(id: number, pose: Pose, y: number, from?: { pose: Pose; y: number }): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    const start = from ?? { pose: rec.pose, y: rec.y };
    this.run({
      do: () => {
        this.layout.dropPiece(id, pose, y);
      },
      undo: () => {
        this.layout.dropPiece(id, start.pose, start.y);
      },
      moves: [id],
    });
    return true;
  }

  rotate(id: number, delta: number): boolean {
    const rec = this.record(id);
    if (!rec) return false;
    const c = pieceCentre(this.layout, id);
    return this.move(id, poseForCentre(rec.type, rec.flipped, c.x, c.z, rec.pose.heading + delta), rec.y);
  }

  flip(id: number): boolean {
    const rec = this.record(id);
    if (!rec || !getPieceDef(rec.type, false).flippable) return false;
    const swap = (flipped: boolean) => {
      this.layout.removePiece(id);
      this.layout.restorePiece(id, rec.type, rec.pose, rec.y, flipped);
    };
    this.run({ do: () => swap(!rec.flipped), undo: () => swap(rec.flipped), moves: [id] });
    return true;
  }

  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return;
    c.undo();
    this.redoStack.push(c);
    this.changed(c.moves);
  }

  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return;
    c.do();
    this.undoStack.push(c);
    this.changed(c.moves);
  }

  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private run(c: Command): void {
    c.do();
    this.undoStack.push(c);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed(c.moves);
  }

  private changed(moves: number[] = []): void {
    this.sim.trackChanged(moves);
    this.onChange();
  }

  private record(id: number): PieceRecord | null {
    const p = this.layout.getPiece(id);
    return p ? { id, type: p.type, pose: { ...p.pose }, y: p.y, flipped: p.flipped } : null;
  }
}
