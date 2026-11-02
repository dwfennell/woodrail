import { BufferAttribute, Matrix4, Mesh, Vector3, type BufferGeometry, type Material } from "three";

/**
 * The models with clock faces whose hands show the player's real local time (`ClockView`): each is drawn bare of its
 * hands (nodes named "hour" and "minute", see `clockHandsOf`), its hands drawn live. A test checks every model with
 * such nodes is here.
 */
export const CLOCK_ASSETS: ReadonlySet<string> = new Set([
  "bldg-station-clock",
  "bldg-grand-terminus",
  "bldg-platform-furnished",
  "bldg-town-hall",
  "bldg-market-hall",
  "bldg-library",
  "bldg-college",
  "scene-clock-post",
]);

/** The names of a clock's hands in its model. */
export const HAND_NAMES: ReadonlySet<string> = new Set(["hour", "minute"]);

/** One hand: its parts merged by material in its own frame, pointing at twelve and turning about its own x. */
export interface ClockHand {
  readonly kind: "hour" | "minute";
  /** The hand's frame in its model's (its rest pose): turned by `handTurn(angle)` after this, it shows `angle`. */
  readonly base: Matrix4;
  readonly parts: readonly { geometry: BufferGeometry; material: Material }[];
}

/** A clock model's hands (all its faces'). */
export interface ClockHands {
  readonly hands: readonly ClockHand[];
}

/**
 * A clock's hands, as angles (radians, clockwise from twelve) for a local time of day: the minute hand on its minute,
 * the hour hand on its hour and the minutes past it (at half past two, halfway from two to three).
 */
export function handAngles(hours: number, minutes: number): { hour: number; minute: number } {
  const m = Math.floor(minutes) % 60;
  return { hour: (((hours % 12) + m / 60) / 12) * Math.PI * 2, minute: (m / 60) * Math.PI * 2 };
}

/** How long (ms) from `now` to the start of the next minute (a whole minute when it's exactly on one). */
export function msToNextMinute(now: Date): number {
  return 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
}

const turnM = new Matrix4();

/**
 * A hand's matrix in world space: the clock at `clock` (its model's frame in the world), the hand at `angle` (clockwise
 * from twelve, as its face is seen): its rest frame turned about its x (the face's axis, pointing out of the face).
 */
export function handMatrix(clock: Matrix4, hand: ClockHand, angle: number, out: Matrix4): Matrix4 {
  return out.multiplyMatrices(clock, hand.base).multiply(turnM.makeRotationX(-angle));
}

/** The angle a hand of `kind` shows, from the angles of a time. */
export const angleOf = (kind: "hour" | "minute", a: { hour: number; minute: number }): number => (kind === "hour" ? a.hour : a.minute);

/**
 * A clock's hands as meshes at the time `at`, in its model's frame (for a model drawn whole once: a held kit piece, its
 * tray picture). Their geometry is shared: not to be disposed.
 */
export function posedHands(hands: ClockHands, at: Date): Mesh[] {
  const a = handAngles(at.getHours(), at.getMinutes());
  const out: Mesh[] = [];
  const m = new Matrix4();
  for (const hand of hands.hands) {
    handMatrix(IDENTITY, hand, angleOf(hand.kind, a), m);
    for (const p of hand.parts) {
      const mesh = new Mesh(p.geometry, p.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(m);
      mesh.receiveShadow = true;
      mesh.userData.sharedGeometry = true;
      out.push(mesh);
    }
  }
  return out;
}

const IDENTITY = new Matrix4();

/**
 * Pull a flat clock's hands out of its merged geometry (the map's station-house clock, tools/blender/dressing.py
 * `station_clock`: its marks, hands and pivot all one dark piece): its connected pieces, of which the hands are the
 * two long ones (`minLong` mm or longer), the minute's the longer. The face looks along +z, centred on the origin, twelve
 * at +y. Returns the rest (marks and pivot, in the same space) and the hands, each in its own frame (pointing at twelve,
 * turning about its x, as a Blender clock's). Null if there aren't two such pieces.
 */
export function splitFlatHands(g: BufferGeometry, minLong = 2.5): { rest: BufferGeometry; hands: { kind: "hour" | "minute"; base: Matrix4; geometry: BufferGeometry }[] } | null {
  const pieces = connectedPieces(g);
  const long: { piece: BufferGeometry; length: number; angle: number }[] = [];
  const keep: BufferGeometry[] = [];
  for (const piece of pieces) {
    piece.computeBoundingBox();
    const bb = piece.boundingBox!;
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    if (Math.max(sx, sy) < minLong) {
      keep.push(piece);
      continue;
    }
    // Which way it points from the pivot (clockwise from twelve, seen from +z): its far end's.
    const c = bb.getCenter(new Vector3());
    long.push({ piece, length: Math.max(sx, sy), angle: Math.atan2(c.x, c.y) });
  }
  if (long.length !== 2) return null;
  long.sort((a, b) => a.length - b.length);
  // A hand's frame: x out of the face (+z), y at twelve (+y), z toward nine (−x).
  const base = new Matrix4().makeRotationY(-Math.PI / 2);
  const toHand = base.clone().invert();
  const hands = long.map(({ piece, angle }, k) => ({
    kind: (k === 0 ? "hour" : "minute") as "hour" | "minute",
    base: base.clone(),
    // Turned back to twelve (anticlockwise by its angle, seen from +z), then into the hand's frame.
    geometry: piece.rotateZ(angle).applyMatrix4(toHand),
  }));
  return { rest: mergeAll(keep, g), hands };
}

/** A geometry's connected pieces (triangles sharing a corner, by position), each a non-indexed geometry of its own. */
function connectedPieces(g: BufferGeometry): BufferGeometry[] {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const corners = index ? index.count : pos.count;
  const vertexAt = (k: number) => (index ? index.getX(k) : k);
  const parent = new Int32Array(pos.count).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  // Corners at the same place are one (a mesh's split normals and seams).
  const at = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
    const was = at.get(key);
    if (was === undefined) at.set(key, i);
    else join(i, was);
  }
  for (let k = 0; k < corners; k += 3) {
    join(vertexAt(k), vertexAt(k + 1));
    join(vertexAt(k), vertexAt(k + 2));
  }
  const byRoot = new Map<number, number[]>();
  for (let k = 0; k < corners; k += 3) {
    const r = find(vertexAt(k));
    let list = byRoot.get(r);
    if (!list) byRoot.set(r, (list = []));
    list.push(vertexAt(k), vertexAt(k + 1), vertexAt(k + 2));
  }
  return [...byRoot.values()].map((verts) => pick(g, verts));
}

/** A non-indexed geometry of the given vertices of `g` (every attribute it has). */
function pick(g: BufferGeometry, verts: readonly number[]): BufferGeometry {
  const out = g.clone();
  out.setIndex(null);
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    const size = a.itemSize;
    const arr = new Float32Array(verts.length * size);
    verts.forEach((v, k) => {
      for (let c = 0; c < size; c++) arr[k * size + c] = a.getComponent(v, c);
    });
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  out.groups.length = 0;
  return out;
}

/** Non-indexed pieces back in one geometry (the attributes `like` has). */
function mergeAll(pieces: readonly BufferGeometry[], like: BufferGeometry): BufferGeometry {
  const out = like.clone();
  out.setIndex(null);
  out.groups.length = 0;
  for (const name of Object.keys(like.attributes)) {
    const size = like.getAttribute(name).itemSize;
    const n = pieces.reduce((s, p) => s + p.getAttribute(name).count, 0);
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const p of pieces) {
      const a = p.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new BufferAttribute(arr, size));
  }
  return out;
}
