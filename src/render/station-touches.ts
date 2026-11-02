import { BoxGeometry, CanvasTexture, Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type BufferGeometry } from "three";
import type { Town } from "../landscape";
import { rng } from "../lib/rng";
import { TRACK_WIDTH, type PieceTypeId } from "../track";
import type { BoardRow } from "../game/departures";
import { partPieces } from "./blender-models";
import { PLATFORM_Y, pegLook, stationPoint, waitingSpots, type PegLook } from "./dressing/buildings";
import type { Materials } from "./materials";

/**
 * The stations' little touches, drawn apart from the batched scenery because they move:
 * - **People who react.** As a train halts at a town's station, the few people nearest the top of its platform's queue
 *   (stand-ins for those peg dolls, which are held back by a draw range: `LandscapeView.holdWaiting`) lean toward it;
 *   someone getting on hops into the coach, someone getting off hops down onto the platform and goes. Only the station
 *   a train is at, and only for its stop: when it sets off they settle back and the stand-ins go.
 * - **A guard with a flag** on each big station (the two-platform station and the terminus): the flag goes up as a
 *   train sets off (the host plays a soft whistle).
 * - **A departure board** on each big station: the trains due and where they head next, painted on a small canvas
 *   only when its rows change (`setBoard`, from `Economy.nextVersion`), never per frame.
 *
 * Nothing here runs per frame unless something is moving: `update` is asked only while `busy`, or on a frame with
 * station events, and says "moving" only while a lean, hop or flag is under way.
 */

/** The big stations: a guard and a departure board each. */
export const BIG_STATIONS: ReadonlySet<PieceTypeId> = new Set<PieceTypeId>(["kit-two-platform-station", "kit-grand-terminus"]);

/** Where on a big station (its piece's frame: `t` along, `l` across, `y` up from the rails) the guard and board stand. */
const BIG_SPOTS: Readonly<Record<string, { guard: [number, number, number]; board: [number, number, number, number] }>> = {
  // The guard on the near platform by the building's end, the board near the end of the far platform, facing the line
  // (its face's normal is the board's +z: turned π, it looks back across to the second road).
  "kit-two-platform-station": { guard: [34, -27, 10], board: [22, 110, 10, Math.PI] },
  // The guard on the first island platform, the board on the concourse facing down the roads (−t: turned −π/2).
  "kit-grand-terminus": { guard: [150, 36, 10], board: [238, 72, 10, -Math.PI / 2] },
};

/** Most people turning to a train at once (the top of the queue: they get on first). */
const REACT_MAX = 4;
/** How far a doll leans toward the train (radians). */
const LEAN = 0.2;
/** A hop between platform and coach (s), and how high it arcs (mm). */
const HOP_S = 0.5;
const HOP_UP = 9;
/** Someone off a train stands this long on the platform (s), then shrinks away over `GO_S`. */
const STAND_S = 0.7;
const GO_S = 0.3;
/** The guard's flag: up (s), held while it waves (s), down (s). */
const FLAG_UP_S = 0.3;
const FLAG_HOLD_S = 1.4;
const FLAG_DOWN_S = 0.35;
/** The flag's angle down at the guard's side and raised (about the axis across the guard). */
const FLAG_DOWN = Math.PI - 0.3;
const FLAG_RAISED = -0.25;
const GUARD_COAT = "#1f2f57";
const FLAG_GREEN = "#3c8f4e";
const BOARD_W = 512;
const BOARD_H = 256;

export interface TouchesHost {
  /** The town whose station is this piece, if any. */
  townAt(pieceId: number): Town | undefined;
  /** A car's middle in the world (null: gone). */
  carPoint(carId: number): { x: number; y: number; z: number } | null;
  /** A train's front car's middle (null: gone). */
  trainPoint(trainId: number): { x: number; y: number; z: number } | null;
  /** How many dolls a town's platform shows now. */
  waitingShown(townId: number): number;
  /** Hold back a town's platform dolls from the `from`th on (null: none). */
  holdWaiting(townId: number, from: number | null): void;
}

type Hop = "stand" | "on" | "off";

interface Doll {
  readonly root: Group;
  /** Spot index on the platform (−1: someone getting off). */
  readonly index: number;
  mode: Hop;
  /** Seconds into its hop (or, off the train, since it landed). */
  t: number;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  lean: number;
}

interface Visit {
  readonly town: Town;
  readonly pieceId: number;
  trainId: number;
  dolls: Doll[];
  /** The platform's dolls from this one on are drawn here (stand-ins), not in the batch. */
  heldFrom: number;
  /** Where they lean toward. */
  target: { x: number; z: number };
  /** The train set off: they lean back, then the visit ends. */
  leaving: boolean;
}

interface Big {
  readonly pieceId: number;
  readonly key: string;
  readonly root: Group;
  readonly flag: Group;
  readonly cloth: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  readonly geometries: BufferGeometry[];
  readonly boardMat: MeshStandardMaterial;
  rows: string;
  /** Times its board was painted (the e2e checks it's only on a change). */
  paints: number;
  /** Seconds since the flag began to go up (−1: down). */
  flagT: number;
}

export interface PlacedBig {
  readonly id: number;
  readonly type: PieceTypeId;
  readonly flipped: boolean;
  readonly pose: { readonly x: number; readonly z: number; readonly heading: number };
  readonly y: number;
}

export class StationTouchesView {
  readonly group = new Group();
  private readonly visits = new Map<number, Visit>();
  private readonly bigs = new Map<number, Big>();
  /** Someone getting off: their looks, drawn in turn. */
  private readonly offLooks = rng(7177);
  /** Big stations' flags just raised: the host whistles for each (drained by `departedBig`). */
  private readonly whistles: { x: number; z: number }[] = [];
  /** Station events heard, by kind (for the e2e's account of a stop). */
  private readonly heard: Record<string, number> = { halted: 0, on: 0, off: 0, left: 0, town: 0 };

  constructor(
    private readonly mats: Materials,
    private readonly host: TouchesHost,
    private readonly calm: () => boolean = reducedMotion,
  ) {}

  /** Did the last `update` move anything (a lean, a hop, a flag)? */
  private moving = false;

  /**
   * Anything moving (`update` is asked each frame only then, or with station events). A stop where everyone has
   * turned to the train and stands still isn't: nothing is asked of it until the next event.
   */
  get busy(): boolean {
    return this.moving;
  }

  /** A stop under way at any station (the people there are stand-ins). */
  get visiting(): boolean {
    return this.visits.size > 0;
  }

  /** Flags raised since last asked, where (the host's whistle). */
  drainWhistles(): readonly { x: number; z: number }[] {
    const out = this.whistles.slice();
    this.whistles.length = 0;
    return out;
  }

  /** A station event (see `StationEvent`). */
  event(kind: "halted" | "on" | "off" | "left", pieceId: number, trainId: number, carId: number): void {
    this.heard[kind]++;
    const big = this.bigs.get(pieceId);
    if (kind === "left" && big) {
      big.flagT = 0;
      const p = big.root.position;
      this.whistles.push({ x: p.x, z: p.z });
    }
    const town = this.host.townAt(pieceId);
    if (!town) return;
    this.heard.town++;
    let v = this.visits.get(town.id);
    if (kind === "halted") {
      const at = (carId >= 0 ? this.host.carPoint(carId) : null) ?? this.host.trainPoint(trainId);
      // Another train, or this one back after setting off: a fresh stop, from the people waiting now.
      if (v && (v.leaving || v.trainId !== trainId)) {
        this.endVisit(v);
        v = undefined;
      }
      if (!v) v = this.startVisit(town, pieceId, trainId);
      v.trainId = trainId;
      v.leaving = false;
      if (at) v.target = { x: at.x, z: at.z };
      return;
    }
    if (!v || v.trainId !== trainId) return;
    if (kind === "left") {
      v.leaving = true;
      return;
    }
    const car = this.host.carPoint(carId);
    if (car) v.target = { x: car.x, z: car.z };
    const door = car ? { x: car.x, y: car.y + 12, z: car.z } : null;
    if (kind === "on") this.board(v, door);
    else if (door) this.alight(v, door);
  }

  /** Frame step: true while something moves (draw again), "changed" for a last frame, or "idle". */
  update(dt: number): "moving" | "changed" | "idle" {
    let moving = false;
    let changed = false;
    const calm = this.calm();
    for (const v of [...this.visits.values()]) {
      let w = 0;
      for (const d of v.dolls) {
        const r = this.stepDoll(d, v, dt, calm);
        if (r === "gone") {
          d.root.removeFromParent();
          disposeDoll(d.root);
          changed = true;
          continue;
        }
        if (r === "moving") moving = true;
        v.dolls[w++] = d;
      }
      v.dolls.length = w;
      // Set off, everyone settled (none hopping): the stand-ins go, the batch draws them again.
      if (v.leaving && !v.dolls.some((d) => d.mode !== "stand" || Math.abs(d.lean) > 0.002)) {
        this.endVisit(v);
        changed = true;
      }
    }
    for (const b of this.bigs.values()) {
      if (b.flagT < 0) continue;
      b.flagT += dt;
      const t = b.flagT;
      const end = FLAG_UP_S + FLAG_HOLD_S + FLAG_DOWN_S;
      if (t >= end) {
        b.flagT = -1;
        b.flag.rotation.z = FLAG_DOWN;
        b.cloth.rotation.y = 0;
        changed = true;
        continue;
      }
      // Reduced motion: up and down, no swing or wave.
      if (calm) b.flag.rotation.z = t < FLAG_UP_S + FLAG_HOLD_S ? FLAG_RAISED : FLAG_DOWN;
      else {
        const up = t < FLAG_UP_S ? ease(t / FLAG_UP_S) : t < FLAG_UP_S + FLAG_HOLD_S ? 1 : 1 - ease((t - FLAG_UP_S - FLAG_HOLD_S) / FLAG_DOWN_S);
        b.flag.rotation.z = FLAG_DOWN + (FLAG_RAISED - FLAG_DOWN) * up;
        b.cloth.rotation.y = up > 0.9 ? Math.sin(t * 13) * 0.35 : 0;
      }
      moving = true;
    }
    this.moving = moving;
    return moving ? "moving" : changed ? "changed" : "idle";
  }

  /** A stop over: the stand-ins go, the batch draws its dolls again. */
  private endVisit(v: Visit): void {
    for (const d of v.dolls) {
      d.root.removeFromParent();
      disposeDoll(d.root);
    }
    this.host.holdWaiting(v.town.id, null);
    this.visits.delete(v.town.id);
  }

  /** Put the big stations' guards and boards on these pieces (the rest go). Cheap when none changed. */
  syncBigs(pieces: Iterable<PlacedBig>): boolean {
    let changed = false;
    const seen = new Set<number>();
    for (const p of pieces) {
      const spots = BIG_SPOTS[p.type];
      if (!spots) continue;
      seen.add(p.id);
      const key = `${p.type}:${p.flipped}:${p.pose.x}:${p.pose.z}:${p.pose.heading}:${p.y}`;
      const had = this.bigs.get(p.id);
      if (had?.key === key) continue;
      if (had) this.dropBig(had);
      this.bigs.set(p.id, this.makeBig(p, key, spots));
      changed = true;
    }
    for (const b of [...this.bigs.values()]) {
      if (seen.has(b.pieceId)) continue;
      this.dropBig(b);
      this.bigs.delete(b.pieceId);
      changed = true;
    }
    return changed;
  }

  /** The big stations' pieces now. */
  bigPieces(): number[] {
    return [...this.bigs.keys()];
  }

  /** What a big station's board shows (painted only when the rows change). True if it was painted. */
  setBoard(pieceId: number, rows: readonly BoardRow[]): boolean {
    const b = this.bigs.get(pieceId);
    if (!b) return false;
    const key = rows.map((r) => `${r.colour}${r.text}`).join("|");
    if (key === b.rows) return false;
    b.rows = key;
    b.paints++;
    paintBoard(b.canvas, rows);
    b.texture.needsUpdate = true;
    return true;
  }

  /** Everything back as it was at once (a new map, Sandbox ↔ Game). */
  clear(): void {
    for (const v of [...this.visits.values()]) this.endVisit(v);
    this.moving = false;
    for (const b of this.bigs.values()) this.dropBig(b);
    this.bigs.clear();
    this.whistles.length = 0;
  }

  /** For tests and the e2e: what's going on. */
  state() {
    return {
      visits: [...this.visits.values()].map((v) => ({
        townId: v.town.id,
        pieceId: v.pieceId,
        heldFrom: v.heldFrom,
        leaving: v.leaving,
        dolls: v.dolls.map((d) => ({ index: d.index, mode: d.mode, lean: d.lean })),
      })),
      heard: { ...this.heard },
      bigs: [...this.bigs.values()].map((b) => ({ pieceId: b.pieceId, rows: b.rows, paints: b.paints, flagUp: b.flagT >= 0, flag: b.flag.rotation.z, wave: b.cloth.rotation.y })),
    };
  }

  private startVisit(town: Town, pieceId: number, trainId: number): Visit {
    const shown = this.host.waitingShown(town.id);
    const from = Math.max(0, shown - REACT_MAX);
    const { spots } = waitingSpots(town, shown);
    const v: Visit = { town, pieceId, trainId, dolls: [], heldFrom: from, target: stationPoint(town, 108, 0), leaving: false };
    for (let k = from; k < shown; k++) {
      const s = spots[k];
      const p = stationPoint(town, s.t, s.lateral);
      v.dolls.push(this.makeDoll(s.look, k, { x: p.x, y: PLATFORM_Y, z: p.z }, -town.station.heading));
    }
    this.host.holdWaiting(town.id, from);
    this.visits.set(town.id, v);
    return v;
  }

  /** Someone gets on: the doll at the top of the queue hops into the coach (one from the batch if none is standing). */
  private board(v: Visit, door: { x: number; y: number; z: number } | null): void {
    let d: Doll | undefined;
    for (const o of v.dolls) if (o.mode === "stand" && o.index >= 0 && (!d || o.index > d.index)) d = o;
    if (!d && v.heldFrom > 0) {
      // More getting on than stood in: the next one down comes out of the batch.
      const k = --v.heldFrom;
      const s = waitingSpots(v.town, k + 1).spots[k];
      const p = stationPoint(v.town, s.t, s.lateral);
      d = this.makeDoll(s.look, k, { x: p.x, y: PLATFORM_Y, z: p.z }, -v.town.station.heading);
      v.dolls.push(d);
      this.host.holdWaiting(v.town.id, v.heldFrom);
    }
    if (!d) return;
    if (!door || this.calm()) {
      // Reduced motion (or no coach to hop to): they're just on board.
      d.mode = "on";
      d.t = HOP_S;
      return;
    }
    d.mode = "on";
    d.t = 0;
    d.from = { x: d.root.position.x, y: d.root.position.y, z: d.root.position.z };
    d.to = door;
  }

  /** Someone gets off: a doll hops down from the coach onto the platform beside it, stands a moment, and goes. */
  private alight(v: Visit, door: { x: number; y: number; z: number }): void {
    if (this.calm()) return;
    const s = v.town.station;
    const dx = Math.cos(s.heading);
    const dz = Math.sin(s.heading);
    // Beside the coach, on the platform's side of the line.
    const t = Math.max(20, Math.min(196, (door.x - s.x) * dx + (door.z - s.z) * dz));
    const side = (TRACK_WIDTH / 2 + 8) * (v.town.upgraded ? -1 : 1);
    const p = stationPoint(v.town, t, side);
    const d = this.makeDoll(pegLook(this.offLooks), -1, door, -s.heading);
    d.mode = "off";
    d.t = 0;
    d.from = door;
    d.to = { x: p.x, y: PLATFORM_Y, z: p.z };
    v.dolls.push(d);
  }

  private stepDoll(d: Doll, v: Visit, dt: number, calm: boolean): "moving" | "still" | "gone" {
    if (d.mode === "on") {
      d.t += dt;
      if (d.t >= HOP_S) return "gone";
      hopTo(d, d.t / HOP_S, true);
      return "moving";
    }
    if (d.mode === "off") {
      d.t += dt;
      if (d.t < HOP_S) {
        hopTo(d, d.t / HOP_S, false);
        return "moving";
      }
      const after = d.t - HOP_S;
      if (after >= STAND_S + GO_S) return "gone";
      d.root.position.set(d.to.x, d.to.y, d.to.z);
      d.root.scale.setScalar(after < STAND_S ? 1 : 1 - (after - STAND_S) / GO_S);
      return "moving";
    }
    // Standing: lean toward the train (back upright as it leaves); turned at once with reduced motion.
    const want = v.leaving ? 0 : LEAN;
    const yaw = Math.atan2(v.target.x - d.root.position.x, v.target.z - d.root.position.z);
    d.root.rotation.y = yaw;
    if (Math.abs(want - d.lean) < 0.002) {
      if (d.lean === want) return "still";
      d.lean = want;
      d.root.rotation.x = d.lean;
      return "moving";
    }
    d.lean = calm ? want : d.lean + (want - d.lean) * Math.min(1, dt * 7);
    d.root.rotation.x = d.lean;
    return "moving";
  }

  private makeDoll(look: PegLook, index: number, at: { x: number; y: number; z: number }, yaw: number): Doll {
    const root = new Group();
    root.rotation.order = "YXZ";
    root.rotation.y = yaw;
    root.position.set(at.x, at.y, at.z);
    for (const [g, m] of partPieces(this.mats, look.part, { coat: look.coat, hat: look.hat })) {
      const mesh = new Mesh(g, m);
      mesh.castShadow = true;
      root.add(mesh);
    }
    this.group.add(root);
    return { root, index, mode: "stand", t: 0, from: at, to: at, lean: 0 };
  }

  private makeBig(p: PlacedBig, key: string, spots: (typeof BIG_SPOTS)[string]): Big {
    const root = new Group();
    const geometries: BufferGeometry[] = [];
    const at = (t: number, l: number, h: number) => {
      const ll = p.flipped ? -l : l;
      const c = Math.cos(p.pose.heading);
      const s = Math.sin(p.pose.heading);
      return { x: p.pose.x + c * t - s * ll, y: p.y + h, z: p.pose.z + s * t + c * ll };
    };
    // The guard: a peg doll in a navy coat and cap, the flag in his hand at his side.
    const [gt, gl, gh] = spots.guard;
    const g = at(gt, gl, gh);
    root.position.set(g.x, g.y, g.z);
    root.rotation.y = -p.pose.heading;
    for (const [geo, m] of partPieces(this.mats, "peg-doll-hat", { coat: GUARD_COAT, hat: GUARD_COAT })) {
      const mesh = new Mesh(geo, m);
      mesh.castShadow = true;
      geometries.push(geo);
      root.add(mesh);
    }
    const flag = new Group();
    flag.position.set(4.2, 9.5, 0);
    flag.rotation.z = FLAG_DOWN;
    const stick = new CylinderGeometry(0.35, 0.35, 11, 6).translate(0, 5.5, 0);
    const clothGeo = new BoxGeometry(5.5, 3.8, 0.4).translate(2.75, 0, 0);
    geometries.push(stick, clothGeo);
    flag.add(new Mesh(stick, this.mats.naturalWood));
    const cloth = new Mesh(clothGeo, this.mats.lacquer(FLAG_GREEN));
    cloth.position.set(0.2, 9, 0);
    flag.add(cloth);
    root.add(flag);
    // The departure board: two posts and a framed board, its face a small canvas.
    const [bt, bl, bh, turn] = spots.board;
    const bp = at(bt, bl, bh);
    const board = new Group();
    board.rotation.y = p.flipped ? -turn : turn;
    // (In the root's frame, turned by the heading already.)
    const relX = bp.x - g.x;
    const relZ = bp.z - g.z;
    const c = Math.cos(p.pose.heading);
    const s = Math.sin(p.pose.heading);
    board.position.set(c * relX + s * relZ, bp.y - g.y, -s * relX + c * relZ);
    const post = new CylinderGeometry(0.8, 0.8, 26, 8).translate(0, 13, 0);
    const frame = new BoxGeometry(34, 18, 2.4).translate(0, 24, 0);
    const face = new PlaneGeometry(31, 15).translate(0, 24, 1.25);
    geometries.push(post, frame, face);
    for (const x of [-13, 13]) {
      const m = new Mesh(post, this.mats.naturalWood);
      m.position.x = x;
      m.castShadow = true;
      board.add(m);
    }
    const frameMesh = new Mesh(frame, this.mats.lacquer("#2f5d3a"));
    frameMesh.castShadow = true;
    board.add(frameMesh);
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_W;
    canvas.height = BOARD_H;
    paintBoard(canvas, []);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const boardMat = new MeshStandardMaterial({ map: texture, roughness: 0.6, emissiveMap: texture, emissive: new Color("#ffffff"), emissiveIntensity: 0.3 });
    board.add(new Mesh(face, boardMat));
    root.add(board);
    this.group.add(root);
    // (Its rows are painted by the next `setBoard`.)
    return { pieceId: p.id, key, root, flag, cloth, canvas, texture, geometries, boardMat, rows: "", paints: 0, flagT: -1 };
  }

  private dropBig(b: Big): void {
    b.root.removeFromParent();
    for (const g of b.geometries) g.dispose();
    b.texture.dispose();
    b.boardMat.dispose();
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ease(u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
}

/** A doll `u` (0–1) of the way along its hop, arcing up; getting on, it shrinks into the coach at the end. */
function hopTo(d: Doll, u: number, shrink: boolean): void {
  const e = ease(u);
  d.root.position.set(d.from.x + (d.to.x - d.from.x) * e, d.from.y + (d.to.y - d.from.y) * e + Math.sin(Math.PI * u) * HOP_UP, d.from.z + (d.to.z - d.from.z) * e);
  d.root.rotation.x = 0;
  d.root.scale.setScalar(shrink ? (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4 * 0.8) : u < 0.25 ? 0.3 + (u / 0.25) * 0.7 : 1);
}

/** A stand-in's geometry is its own copy (`partPieces`); its paints are shared. */
function disposeDoll(root: Group): void {
  for (const o of root.children) if (o instanceof Mesh) (o.geometry as BufferGeometry).dispose();
}

/** Paint a departure board: a header, and a row per train due (a dot of its line's colour and its words). */
export function paintBoard(canvas: HTMLCanvasElement, rows: readonly BoardRow[]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#24402b";
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.strokeStyle = "#f3e3c3";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, BOARD_W - 16, BOARD_H - 16);
  ctx.fillStyle = "#f3d27a";
  ctx.font = "800 40px Nunito, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("Trains due", BOARD_W / 2, 46, BOARD_W - 40);
  ctx.textAlign = "left";
  ctx.font = "800 38px Nunito, system-ui, sans-serif";
  if (rows.length === 0) {
    ctx.fillStyle = "#c9c1ad";
    ctx.textAlign = "center";
    ctx.fillText("None just now", BOARD_W / 2, 150, BOARD_W - 40);
    return;
  }
  rows.forEach((r, i) => {
    const y = 108 + i * 58;
    ctx.fillStyle = r.colour;
    ctx.beginPath();
    ctx.arc(44, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f8efdc";
    ctx.fillText(r.text, 72, y + 2, BOARD_W - 96);
  });
}
