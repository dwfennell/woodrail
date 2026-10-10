import { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE, SPATIAL_CELL_SIZE } from "./constants";
import { angleDiff, transformPose, type Pose } from "./math";
import { getPieceDef, MAX_CONNECTORS, type ConnectorKind, type PieceTypeId } from "./pieces";
import { SpatialHash } from "./spatial-hash";

export const connectorRef = (pieceId: number, index: number): number => pieceId * MAX_CONNECTORS + index;
export const pieceOfRef = (ref: number): number => Math.floor(ref / MAX_CONNECTORS);
export const indexOfRef = (ref: number): number => ref % MAX_CONNECTORS;

export interface PlacedPiece {
  readonly id: number;
  readonly type: PieceTypeId;
  readonly flipped: boolean;
  readonly pose: Pose;
  readonly y: number;
}

/** A seated peg/socket pair. a < b; errors record how far from perfectly seated it is. */
export interface Joint {
  readonly a: number;
  readonly b: number;
  readonly posError: number;
  readonly angleError: number;
}

export interface WorldConnector {
  x: number;
  z: number;
  heading: number;
  y: number;
  kind: ConnectorKind;
}

export const createWorldConnector = (): WorldConnector => ({ x: 0, z: 0, heading: 0, y: 0, kind: "peg" });

const scratchA = createWorldConnector();
const scratchB = createWorldConnector();
const candidates: number[] = [];

export class Layout {
  private nextId = 1;
  private readonly pieces = new Map<number, PlacedPiece>();
  private readonly joinedTo = new Map<number, number>();
  private readonly jointMap = new Map<number, Joint>();
  private readonly freeConnectors = new SpatialHash(SPATIAL_CELL_SIZE);
  private readonly switchStates = new Map<number, number>();

  get pieceCount(): number {
    return this.pieces.size;
  }

  get jointCount(): number {
    return this.jointMap.size;
  }

  pieceIds(): IterableIterator<number> {
    return this.pieces.keys();
  }

  getPiece(id: number): PlacedPiece | undefined {
    return this.pieces.get(id);
  }

  joints(): IterableIterator<Joint> {
    return this.jointMap.values();
  }

  addPiece(type: PieceTypeId, pose: Pose, y = 0, flipped = false): number {
    const id = this.nextId++;
    this.pieces.set(id, { id, type, flipped, pose: { ...pose }, y });
    this.seatAll(id);
    return id;
  }

  removePiece(id: number): boolean {
    if (!this.pieces.has(id)) return false;
    this.detachAll(id);
    this.pieces.delete(id);
    this.switchStates.delete(id);
    return true;
  }

  movePiece(id: number, pose: Pose, y: number): boolean {
    const piece = this.pieces.get(id);
    if (!piece) return false;
    this.detachAll(id);
    this.pieces.set(id, { ...piece, pose: { ...pose }, y });
    this.seatAll(id);
    return true;
  }

  worldConnector(ref: number, out: WorldConnector): WorldConnector {
    const piece = this.pieces.get(pieceOfRef(ref));
    if (!piece) throw new Error(`worldConnector: no piece for connector ref ${ref}`);
    const c = getPieceDef(piece.type, piece.flipped).connectors[indexOfRef(ref)];
    transformPose(piece.pose, c.pose, out);
    out.y = piece.y + c.y;
    out.kind = c.kind;
    return out;
  }

  joinedConnector(ref: number): number {
    return this.joinedTo.get(ref) ?? -1;
  }

  jointAt(ref: number): Joint | undefined {
    const other = this.joinedTo.get(ref);
    return other === undefined ? undefined : this.jointMap.get(Math.min(ref, other));
  }

  queryFreeConnectors(x: number, z: number, radius: number, out: number[]): number {
    return this.freeConnectors.query(x, z, radius, out);
  }

  switchState(pieceId: number): number {
    return this.switchStates.get(pieceId) ?? 0;
  }

  setSwitchState(pieceId: number, state: number): void {
    this.switchStates.set(pieceId, state);
  }

  private seatAll(id: number): void {
    const piece = this.pieces.get(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) this.seatConnector(connectorRef(id, i));
  }

  private seatConnector(ref: number): void {
    const w = this.worldConnector(ref, scratchA);
    const self = pieceOfRef(ref);
    const n = this.freeConnectors.query(w.x, w.z, JOINT_POS_TOLERANCE, candidates);
    let best = -1;
    let bestPos = Infinity;
    let bestAngle = 0;
    for (let i = 0; i < n; i++) {
      const other = candidates[i];
      if (pieceOfRef(other) === self) continue;
      const o = this.worldConnector(other, scratchB);
      if (o.kind === w.kind) continue;
      const pos = Math.hypot(o.x - w.x, o.z - w.z);
      if (pos > JOINT_POS_TOLERANCE || Math.abs(o.y - w.y) > JOINT_POS_TOLERANCE) continue;
      const angle = angleDiff(w.heading, o.heading + Math.PI);
      if (angle > JOINT_ANGLE_TOLERANCE) continue;
      if (pos < bestPos) {
        best = other;
        bestPos = pos;
        bestAngle = angle;
      }
    }
    if (best === -1) {
      this.freeConnectors.insert(ref, w.x, w.z);
      return;
    }
    this.freeConnectors.remove(best);
    this.joinedTo.set(ref, best);
    this.joinedTo.set(best, ref);
    const a = Math.min(ref, best);
    this.jointMap.set(a, { a, b: Math.max(ref, best), posError: bestPos, angleError: bestAngle });
  }

  private detachAll(id: number): void {
    const piece = this.pieces.get(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    for (let i = 0; i < count; i++) {
      const ref = connectorRef(id, i);
      const partner = this.joinedTo.get(ref);
      if (partner === undefined) {
        this.freeConnectors.remove(ref);
        continue;
      }
      this.joinedTo.delete(ref);
      this.joinedTo.delete(partner);
      this.jointMap.delete(Math.min(ref, partner));
      const pw = this.worldConnector(partner, scratchB);
      this.freeConnectors.insert(partner, pw.x, pw.z);
    }
  }
}
