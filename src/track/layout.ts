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
const detachScratch: number[] = [];

export class Layout {
  private nextId = 1;
  private readonly pieces = new Map<number, PlacedPiece>();
  private readonly joinedTo = new Map<number, number>();
  private readonly jointMap = new Map<number, Joint>();
  private readonly freeConnectors = new SpatialHash(SPATIAL_CELL_SIZE);
  private readonly switchStates = new Map<number, number>();
  private readonly lifted = new Set<number>();

  get pieceCount(): number {
    return this.pieces.size;
  }

  /**
   * Bumped whenever the track changes: a piece added, taken up, lifted or put down, or a joint made or parted (not a
   * nudge, which keeps the joints). With `routingVersion`, what a cache of ways along the track is keyed on.
   */
  revision = 0;

  /**
   * Bumped when the ways a routed train can be sent change without the track changing: a switch pinned or unpinned, a
   * pinned switch or a deck set, a deck starting or ending a turn. (Not an unpinned switch thrown: `switchesVersion`
   * counts those too, and steering throws them all the time.)
   */
  routingVersion = 0;

  /** Bumped whenever a piece is added or taken away (not moved): for caches of which pieces are on the map. */
  piecesVersion = 0;

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
    this.revision++;
    this.pieces.set(id, { id, type, flipped, pose: { ...pose }, y });
    this.piecesVersion++;
    this.seatAll(id);
    return id;
  }

  /** Re-add a piece under a specific id (undo, loading saves). Returns false if the id is taken. */
  restorePiece(id: number, type: PieceTypeId, pose: Pose, y: number, flipped: boolean): boolean {
    if (this.pieces.has(id)) return false;
    this.revision++;
    this.pieces.set(id, { id, type, flipped, pose: { ...pose }, y });
    this.piecesVersion++;
    if (id >= this.nextId) this.nextId = id + 1;
    this.seatAll(id);
    // A pin taken up with the piece comes back with it (undoing its removal), if it's still a switch.
    if (this.unpinned.delete(id)) this.setPinned(id, true);
    return true;
  }

  removePiece(id: number): boolean {
    if (!this.pieces.has(id)) return false;
    this.revision++;
    if (!this.lifted.delete(id)) this.detachAll(id);
    this.pieces.delete(id);
    this.piecesVersion++;
    this.switchStates.delete(id);
    if (this.pinned.delete(id)) {
      this.unpinned.add(id);
      this.switchesVersion++;
      this.routingVersion++;
    }
    return true;
  }

  movePiece(id: number, pose: Pose, y: number): boolean {
    if (!this.liftPiece(id)) return false;
    return this.dropPiece(id, pose, y);
  }

  /** Take a piece out of the joint graph (e.g. while it is being dragged). Its neighbours become free. */
  liftPiece(id: number): boolean {
    if (!this.pieces.has(id)) return false;
    if (this.lifted.has(id)) return true;
    this.revision++;
    this.detachAll(id);
    this.lifted.add(id);
    return true;
  }

  /** Put a lifted piece down at a new pose (mirrored or not, if given) and seat it. */
  dropPiece(id: number, pose: Pose, y: number, flipped?: boolean): boolean {
    const piece = this.pieces.get(id);
    if (!piece) return false;
    this.revision++;
    if (!this.lifted.has(id)) this.detachAll(id);
    this.lifted.delete(id);
    this.pieces.set(id, { ...piece, pose: { ...pose }, y, flipped: flipped ?? piece.flipped });
    this.seatAll(id);
    return true;
  }

  /**
   * Shift seated pieces by small amounts (joint play taken up) without changing which joints are seated: poses are
   * replaced, free connectors re-indexed and the seating errors of their joints recomputed.
   */
  nudgePieces(poses: ReadonlyMap<number, Pose>): void {
    for (const [id, pose] of poses) {
      const piece = this.pieces.get(id);
      if (!piece || this.lifted.has(id)) continue;
      this.pieces.set(id, { ...piece, pose: { ...pose } });
    }
    for (const id of poses.keys()) {
      const piece = this.pieces.get(id);
      if (!piece || this.lifted.has(id)) continue;
      const count = getPieceDef(piece.type, piece.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(id, i);
        const partner = this.joinedTo.get(ref);
        const w = this.worldConnector(ref, scratchA);
        if (partner === undefined) {
          this.freeConnectors.remove(ref);
          this.freeConnectors.insert(ref, w.x, w.z);
          continue;
        }
        const o = this.worldConnector(partner, scratchB);
        const a = Math.min(ref, partner);
        this.jointMap.set(a, {
          a,
          b: Math.max(ref, partner),
          posError: Math.hypot(o.x - w.x, o.z - w.z),
          angleError: angleDiff(w.heading, o.heading + Math.PI),
        });
      }
    }
  }

  isLifted(id: number): boolean {
    return this.lifted.has(id);
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
    this.switchesVersion++;
    if (this.pinned.has(pieceId)) this.routingVersion++;
    else {
      const p = this.pieces.get(pieceId);
      if (p && getPieceDef(p.type, p.flipped).gated) this.routingVersion++;
    }
  }

  /** Bumped whenever a switch state is set, or a switch is pinned or unpinned (a turntable's deck follows it: `KitView`). */
  switchesVersion = 0;

  /** Switches pinned: routed engines don't throw them (`steer`), and a way to a stop sees only the route they're set to. */
  private readonly pinned = new Set<number>();
  /** Pins of pieces taken up, kept so that putting the piece back (undo) brings its pin back. Ids aren't reused. */
  private readonly unpinned = new Set<number>();

  /** How many switches are pinned (none: a search needn't ask about each one). */
  get pinnedCount(): number {
    return this.pinned.size;
  }

  isPinned(pieceId: number): boolean {
    return this.pinned.size > 0 && this.pinned.has(pieceId);
  }

  /** Pin a switch, or unpin it. A piece that isn't a switch (or isn't there) is left unpinned. */
  setPinned(pieceId: number, on: boolean): void {
    if (on) {
      const piece = this.pieces.get(pieceId);
      if (!piece || !getPieceDef(piece.type, piece.flipped).isSwitch || this.pinned.has(pieceId)) return;
      this.pinned.add(pieceId);
    } else if (!this.pinned.delete(pieceId)) return;
    this.switchesVersion++;
    this.routingVersion++;
  }

  /** The pinned switches' ids (for saving). */
  pinnedIds(): IterableIterator<number> {
    return this.pinned.values();
  }

  /** Decks on their way to their next road (turning: they join nothing yet). Not saved: a loaded deck is there. */
  private readonly turning = new Set<number>();

  deckTurning(pieceId: number): boolean {
    return this.turning.size > 0 && this.turning.has(pieceId);
  }

  setDeckTurning(pieceId: number, on: boolean): void {
    if (on ? this.turning.has(pieceId) : !this.turning.has(pieceId)) return;
    if (on) this.turning.add(pieceId);
    else this.turning.delete(pieceId);
    this.routingVersion++;
  }

  /** Seat a free connector on a free one within the joint tolerance, if there is one (a near miss just closed). */
  seatFree(ref: number): boolean {
    if (this.joinedTo.has(ref) || !this.pieces.has(pieceOfRef(ref)) || this.lifted.has(pieceOfRef(ref))) return false;
    this.freeConnectors.remove(ref);
    this.seatConnector(ref);
    return this.joinedTo.has(ref);
  }

  /** Part a joint (undoing a near miss closed): both ends become free where they are. */
  unseat(ref: number): void {
    const partner = this.joinedTo.get(ref);
    if (partner === undefined) return;
    this.revision++;
    this.joinedTo.delete(ref);
    this.joinedTo.delete(partner);
    this.jointMap.delete(Math.min(ref, partner));
    for (const r of [ref, partner]) {
      const w = this.worldConnector(r, scratchA);
      this.freeConnectors.insert(r, w.x, w.z);
    }
  }

  /** Part every joint between the pieces `ids` and track outside them; returns the parted ends on their side. */
  partFrom(ids: ReadonlySet<number>): number[] {
    const parted: number[] = [];
    for (const id of ids) {
      const piece = this.pieces.get(id);
      if (!piece || this.lifted.has(id)) continue;
      const count = getPieceDef(piece.type, piece.flipped).connectors.length;
      for (let i = 0; i < count; i++) {
        const ref = connectorRef(id, i);
        const partner = this.joinedTo.get(ref);
        if (partner === undefined || ids.has(pieceOfRef(partner))) continue;
        this.unseat(ref);
        parted.push(ref);
      }
    }
    return parted;
  }

  /** Seat each free end of the pieces `ids` that now meets a free end; returns the ends seated. */
  seatEnds(ids: Iterable<number>): number[] {
    const seated: number[] = [];
    for (const id of ids) {
      const piece = this.pieces.get(id);
      if (!piece) continue;
      const count = getPieceDef(piece.type, piece.flipped).connectors.length;
      for (let i = 0; i < count; i++) if (this.seatFree(connectorRef(id, i))) seated.push(connectorRef(id, i));
    }
    return seated;
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
      // Peg or hole alike: any two ends that meet join (a joint is drawn as a peg in a hole whichever they are).
      const o = this.worldConnector(other, scratchB);
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
    this.revision++;
    this.joinedTo.set(ref, best);
    this.joinedTo.set(best, ref);
    const a = Math.min(ref, best);
    this.jointMap.set(a, { a, b: Math.max(ref, best), posError: bestPos, angleError: bestAngle });
  }

  private detachAll(id: number): void {
    const piece = this.pieces.get(id)!;
    const count = getPieceDef(piece.type, piece.flipped).connectors.length;
    // First take every own connector out of the graph, so freed partners cannot re-seat onto this piece.
    const partners = detachScratch;
    partners.length = 0;
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
      partners.push(partner);
    }
    // Freed partners may now meet another free connector at the same spot (overlapping pieces).
    for (let i = 0; i < partners.length; i++) this.seatConnector(partners[i]);
  }
}
